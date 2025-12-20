/**
 * Color Similarity using Embeddings
 * 
 * Uses embeddings to find semantically similar colors.
 * For example, "white" should match "beige", "ivory", "cream" but NOT "black".
 */

import { embedText } from '../search/vector/index';
import { LOVESHACKFANCY_ONTOLOGY } from './ontology';
import { logger } from '../telemetry/logger';

// Cache for color embeddings (computed once, reused)
let colorEmbeddingsCache: Map<string, number[]> | null = null;

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Get or compute embeddings for all colors in the ontology
 */
async function getColorEmbeddings(): Promise<Map<string, number[]>> {
  if (colorEmbeddingsCache) {
    return colorEmbeddingsCache;
  }
  
  const embeddings = new Map<string, number[]>();
  
  // Generate embeddings for all colors in parallel
  const colorEmbeddingPromises = LOVESHACKFANCY_ONTOLOGY.colors.map(async (color) => {
    try {
      const embedding = await embedText(color.toLowerCase());
      return { color, embedding };
    } catch (error) {
      logger.warn('color_similarity: failed to embed color', {
        color,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });
  
  const results = await Promise.all(colorEmbeddingPromises);
  
  for (const result of results) {
    if (result) {
      embeddings.set(result.color, result.embedding);
    }
  }
  
  // Cache for future use
  colorEmbeddingsCache = embeddings;
  
  logger.info('color_similarity: computed embeddings', {
    colorCount: embeddings.size,
    totalColors: LOVESHACKFANCY_ONTOLOGY.colors.length,
  });
  
  return embeddings;
}

/**
 * Find similar colors using embedding similarity
 * 
 * @param queryColors - Colors extracted from user query (e.g., ["White"])
 * @param similarityThreshold - Minimum similarity score (0-1) to include a color (default: 0.7)
 * @param maxSimilarColors - Maximum number of similar colors to return per query color (default: 5)
 * @returns Expanded array of colors including similar ones
 */
export async function expandColorsWithSimilarity(
  queryColors: string[],
  similarityThreshold: number = 0.7,
  maxSimilarColors: number = 5
): Promise<string[]> {
  if (queryColors.length === 0) {
    return [];
  }
  
  const colorEmbeddings = await getColorEmbeddings();
  const expandedColors = new Set<string>(queryColors); // Start with original colors
  
  // For each query color, find similar colors
  for (const queryColor of queryColors) {
    const queryColorLower = queryColor.toLowerCase();
    const queryEmbedding = colorEmbeddings.get(queryColor);
    
    if (!queryEmbedding) {
      // If query color not in ontology, try to embed it
      try {
        const embedded = await embedText(queryColorLower);
        const similarities: Array<{ color: string; similarity: number }> = [];
        
        // Compare with all ontology colors
        for (const [ontologyColor, ontologyEmbedding] of Array.from(colorEmbeddings.entries())) {
          const similarity = cosineSimilarity(embedded, ontologyEmbedding);
          if (similarity >= similarityThreshold) {
            similarities.push({ color: ontologyColor, similarity });
          }
        }
        
        // Sort by similarity and take top N
        similarities.sort((a, b) => b.similarity - a.similarity);
        for (const { color } of similarities.slice(0, maxSimilarColors)) {
          expandedColors.add(color);
        }
      } catch (error) {
        logger.warn('color_similarity: failed to embed query color', {
          queryColor,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback: keep original color
        expandedColors.add(queryColor);
      }
      continue;
    }
    
    // Find similar colors from ontology
    const similarities: Array<{ color: string; similarity: number }> = [];
    
    for (const [ontologyColor, ontologyEmbedding] of Array.from(colorEmbeddings.entries())) {
      // Skip the same color
      if (ontologyColor.toLowerCase() === queryColorLower) {
        continue;
      }
      
      const similarity = cosineSimilarity(queryEmbedding, ontologyEmbedding);
      if (similarity >= similarityThreshold) {
        similarities.push({ color: ontologyColor, similarity });
      }
      
      // Log high similarity matches for debugging (even if below threshold)
      if (similarity >= 0.7) {
        logger.debug('color_similarity: high_similarity_match', {
          queryColor,
          ontologyColor,
          similarity,
          aboveThreshold: similarity >= similarityThreshold,
        });
      }
    }
    
    // Sort by similarity and take top N
    similarities.sort((a, b) => b.similarity - a.similarity);
    for (const { color } of similarities.slice(0, maxSimilarColors)) {
      expandedColors.add(color);
    }
  }
  
  const expandedArray = Array.from(expandedColors);
  
  logger.debug('color_similarity: expanded colors', {
    originalColors: queryColors,
    expandedColors: expandedArray,
    expansionCount: expandedArray.length - queryColors.length,
  });
  
  return expandedArray;
}

