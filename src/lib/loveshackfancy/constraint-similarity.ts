/**
 * Constraint Similarity Expansion
 * 
 * Uses embeddings to find semantically similar values for all constraint types.
 * This enables "strong" intent constraints to include similar values (e.g., "cotton" → "linen", "silk").
 */

import { embedText } from '../search/vector/index';
import { LOVESHACKFANCY_ONTOLOGY } from './ontology';
import { logger } from '../telemetry/logger';
import type { ConstraintWithIntent } from './constraint-utils';

// Cache for embeddings (computed once per constraint type, reused)
const embeddingsCache = new Map<string, Map<string, number[]>>();

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
 * Get or compute embeddings for a constraint type's ontology values
 */
async function getEmbeddingsForConstraintType(
  constraintType: string,
  ontologyValues: readonly string[]
): Promise<Map<string, number[]>> {
  const cacheKey = constraintType;
  
  if (embeddingsCache.has(cacheKey)) {
    return embeddingsCache.get(cacheKey)!;
  }
  
  const embeddings = new Map<string, number[]>();
  
  // Generate embeddings for all values in parallel
  const embeddingPromises = ontologyValues.map(async (value) => {
    try {
      const embedding = await embedText(value.toLowerCase());
      return { value, embedding };
    } catch (error) {
      logger.warn('constraint_similarity: failed to embed value', {
        constraintType,
        value,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });
  
  const results = await Promise.all(embeddingPromises);
  
  for (const result of results) {
    if (result) {
      embeddings.set(result.value, result.embedding);
    }
  }
  
  // Cache for future use
  embeddingsCache.set(cacheKey, embeddings);
  
  logger.info('constraint_similarity: computed embeddings', {
    constraintType,
    valueCount: embeddings.size,
    totalValues: ontologyValues.length,
  });
  
  return embeddings;
}

/**
 * Expand constraint values with similar values using embeddings
 */
async function expandValuesWithSimilarity(
  constraintType: string,
  queryValues: string[],
  ontologyValues: readonly string[],
  similarityThreshold: number = 0.7,
  maxSimilarValues: number = 5
): Promise<string[]> {
  if (queryValues.length === 0) {
    return [];
  }
  
  const valueEmbeddings = await getEmbeddingsForConstraintType(constraintType, ontologyValues);
  const expandedValues = new Set<string>(queryValues); // Start with original values
  
  // For each query value, find similar values
  for (const queryValue of queryValues) {
    const queryValueLower = queryValue.toLowerCase();
    const queryEmbedding = valueEmbeddings.get(queryValue);
    
    if (!queryEmbedding) {
      // If query value not in ontology, try to embed it
      try {
        const embedded = await embedText(queryValueLower);
        const similarities: Array<{ value: string; similarity: number }> = [];
        
        // Compare with all ontology values
        for (const [ontologyValue, ontologyEmbedding] of Array.from(valueEmbeddings.entries())) {
          const similarity = cosineSimilarity(embedded, ontologyEmbedding);
          if (similarity >= similarityThreshold) {
            similarities.push({ value: ontologyValue, similarity });
          }
        }
        
        // Sort by similarity and take top N
        similarities.sort((a, b) => b.similarity - a.similarity);
        for (const { value } of similarities.slice(0, maxSimilarValues)) {
          expandedValues.add(value);
        }
      } catch (error) {
        logger.warn('constraint_similarity: failed to embed query value', {
          constraintType,
          queryValue,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback: keep original value
        expandedValues.add(queryValue);
      }
      continue;
    }
    
    // Find similar values from ontology
    const similarities: Array<{ value: string; similarity: number }> = [];
    
    for (const [ontologyValue, ontologyEmbedding] of Array.from(valueEmbeddings.entries())) {
      // Skip the same value
      if (ontologyValue.toLowerCase() === queryValueLower) {
        continue;
      }
      
      const similarity = cosineSimilarity(queryEmbedding, ontologyEmbedding);
      if (similarity >= similarityThreshold) {
        similarities.push({ value: ontologyValue, similarity });
      }
    }
    
    // Sort by similarity and take top N
    similarities.sort((a, b) => b.similarity - a.similarity);
    for (const { value } of similarities.slice(0, maxSimilarValues)) {
      expandedValues.add(value);
    }
  }
  
  const expandedArray = Array.from(expandedValues);
  
  logger.debug('constraint_similarity: expanded values', {
    constraintType,
    originalValues: queryValues,
    expandedValues: expandedArray,
    expansionCount: expandedArray.length - queryValues.length,
  });
  
  return expandedArray;
}

/**
 * Expand colors with similarity (reuses existing color similarity function)
 */
export async function expandColorsWithSimilarity(
  queryColors: string[],
  similarityThreshold: number = 0.7,
  maxSimilarColors: number = 5
): Promise<string[]> {
  // Reuse existing color similarity implementation
  const { expandColorsWithSimilarity: expandColors } = await import('./color-similarity');
  return expandColors(queryColors, similarityThreshold, maxSimilarColors);
}

/**
 * Expand materials with similarity
 */
export async function expandMaterialsWithSimilarity(
  queryMaterials: string[],
  similarityThreshold: number = 0.7,
  maxSimilarMaterials: number = 5
): Promise<string[]> {
  return expandValuesWithSimilarity(
    'materials',
    queryMaterials,
    LOVESHACKFANCY_ONTOLOGY.materials,
    similarityThreshold,
    maxSimilarMaterials
  );
}

/**
 * Expand occasions with similarity
 */
export async function expandOccasionsWithSimilarity(
  queryOccasions: string[],
  similarityThreshold: number = 0.7,
  maxSimilarOccasions: number = 5
): Promise<string[]> {
  return expandValuesWithSimilarity(
    'occasions',
    queryOccasions,
    LOVESHACKFANCY_ONTOLOGY.occasions,
    similarityThreshold,
    maxSimilarOccasions
  );
}

/**
 * Expand styles with similarity
 */
export async function expandStylesWithSimilarity(
  queryStyles: string[],
  similarityThreshold: number = 0.7,
  maxSimilarStyles: number = 5
): Promise<string[]> {
  return expandValuesWithSimilarity(
    'styles',
    queryStyles,
    LOVESHACKFANCY_ONTOLOGY.styles,
    similarityThreshold,
    maxSimilarStyles
  );
}

/**
 * Expand patterns with similarity
 */
export async function expandPatternsWithSimilarity(
  queryPatterns: string[],
  similarityThreshold: number = 0.7,
  maxSimilarPatterns: number = 5
): Promise<string[]> {
  return expandValuesWithSimilarity(
    'patterns',
    queryPatterns,
    LOVESHACKFANCY_ONTOLOGY.patterns,
    similarityThreshold,
    maxSimilarPatterns
  );
}

/**
 * Expand sizes with similarity
 */
export async function expandSizesWithSimilarity(
  querySizes: string[],
  similarityThreshold: number = 0.75, // Higher threshold for sizes (more strict)
  maxSimilarSizes: number = 3 // Fewer similar sizes (sizes are more discrete)
): Promise<string[]> {
  return expandValuesWithSimilarity(
    'sizes',
    querySizes,
    LOVESHACKFANCY_ONTOLOGY.sizes,
    similarityThreshold,
    maxSimilarSizes
  );
}

/**
 * Expand lengths with similarity
 */
export async function expandLengthsWithSimilarity(
  queryLengths: string[],
  similarityThreshold: number = 0.7,
  maxSimilarLengths: number = 3
): Promise<string[]> {
  return expandValuesWithSimilarity(
    'lengths',
    queryLengths,
    LOVESHACKFANCY_ONTOLOGY.lengths,
    similarityThreshold,
    maxSimilarLengths
  );
}

/**
 * Expand formality levels with similarity
 */
export async function expandFormalityLevelWithSimilarity(
  queryFormalityLevels: string[],
  similarityThreshold: number = 0.7,
  maxSimilarLevels: number = 3
): Promise<string[]> {
  // Formality levels are typically: "Casual", "Semi-Formal", "Formal", "Black Tie"
  // We'll use a simple ontology for now (can be expanded)
  const formalityOntology = ['Casual', 'Semi-Formal', 'Formal', 'Black Tie', 'Business Casual', 'Cocktail'];
  return expandValuesWithSimilarity(
    'formalityLevel',
    queryFormalityLevels,
    formalityOntology,
    similarityThreshold,
    maxSimilarLevels
  );
}

/**
 * Main function to expand constraints with similarity based on intent
 * Routes to type-specific expanders
 */
export async function expandConstraintWithSimilarity<T extends ConstraintWithIntent>(
  constraint: T | null | undefined,
  constraintType: string
): Promise<T | null | undefined> {
  if (!constraint || constraint.intent !== 'strong') {
    // Only expand for 'strong' intent
    return constraint;
  }
  
  if (constraint.similarValues && constraint.similarValues.length > 0) {
    // Already expanded
    return constraint;
  }
  
  try {
    let expandedValues: string[] = [];
    
    switch (constraintType) {
      case 'colors':
        expandedValues = await expandColorsWithSimilarity(
          constraint.values as string[],
          0.8, // Higher threshold for colors
          5
        );
        break;
      case 'materials':
        expandedValues = await expandMaterialsWithSimilarity(
          constraint.values as string[],
          0.7,
          5
        );
        break;
      case 'occasions':
        expandedValues = await expandOccasionsWithSimilarity(
          constraint.values as string[],
          0.7,
          5
        );
        break;
      case 'styles':
        expandedValues = await expandStylesWithSimilarity(
          constraint.values as string[],
          0.7,
          5
        );
        break;
      case 'patterns':
        expandedValues = await expandPatternsWithSimilarity(
          constraint.values as string[],
          0.7,
          5
        );
        break;
      case 'sizes':
        expandedValues = await expandSizesWithSimilarity(
          constraint.values as string[],
          0.75,
          3
        );
        break;
      case 'lengths':
        expandedValues = await expandLengthsWithSimilarity(
          constraint.values as string[],
          0.7,
          3
        );
        break;
      case 'formalityLevel':
        expandedValues = await expandFormalityLevelWithSimilarity(
          constraint.values as string[],
          0.7,
          3
        );
        break;
      default:
        // For other constraint types, return as-is (no expansion)
        logger.debug('constraint_similarity: no expansion for constraint type', {
          constraintType,
        });
        return constraint;
    }
    
    // Remove original values from expanded values (they're already in constraint.values)
    const similarValues = expandedValues.filter(
      v => !(constraint.values as string[]).some(orig => orig.toLowerCase() === v.toLowerCase())
    );
    
    if (similarValues.length > 0) {
      return {
        ...constraint,
        similarValues,
      } as T;
    }
    
    return constraint;
  } catch (error) {
    logger.warn('constraint_similarity: expansion failed', {
      constraintType,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback: return constraint as-is
    return constraint;
  }
}

