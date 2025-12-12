/**
 * Vector Search Index
 * 
 * Semantic search using pgvector and OpenAI embeddings.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 1.2)
 */

import { env } from '../../config';
import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';

// Embedding model configuration (uses config layer)
const EMBEDDING_MODEL = env.embeddingModel;
const EMBEDDING_DIMENSIONS = 1536; // text-embedding-3-small uses 1536 dimensions

class EmbeddingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Generate embedding for text using OpenAI embeddings API
 * 
 * Uses the configured embedding model (default: text-embedding-3-small)
 * to generate a vector embedding for the input text.
 * 
 * @param text - Text to embed
 * @returns Array of numbers representing the embedding vector (1536 dimensions)
 */
export async function embedText(text: string): Promise<number[]> {
  if (!env.openaiApiKey) {
    throw new EmbeddingError('OPENAI_API_KEY is required for embeddings');
  }
  
  if (!text || text.trim().length === 0) {
    throw new EmbeddingError('Text cannot be empty');
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });
    
    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new EmbeddingError(
        `OpenAI embeddings API error: ${response.status} ${response.statusText}`,
        errorBody
      );
    }
    
    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
      error?: { message?: string };
    };
    
    if (data.error) {
      throw new EmbeddingError(
        `OpenAI embeddings API error: ${data.error.message ?? 'Unknown error'}`
      );
    }
    
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) {
      throw new EmbeddingError('OpenAI embeddings API returned empty embedding');
    }
    
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      logger.warn('embedText: unexpected embedding dimensions', {
        expected: EMBEDDING_DIMENSIONS,
        actual: embedding.length,
      });
    }
    
    return embedding;
  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error;
    }
    throw new EmbeddingError(
      `Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Vector similarity search using pgvector
 * 
 * Searches for products with embeddings similar to the query embedding
 * using cosine similarity (pgvector's <=> operator).
 * 
 * Returns top N product IDs with their similarity scores (higher = more similar).
 * 
 * @param queryEmbedding - Query embedding vector (1536 dimensions)
 * @param limit - Maximum number of results to return
 * @param filters - Optional filters (inStockOnly, merchantId)
 * @returns Array of { productId, similarity } sorted by similarity (descending)
 */
export async function searchVectorIndex(
  queryEmbedding: number[],
  limit: number,
  filters?: { inStockOnly?: boolean; merchantId?: string }
): Promise<Array<{ productId: string; similarity: number }>> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `Query embedding must have ${EMBEDDING_DIMENSIONS} dimensions, got ${queryEmbedding.length}`
    );
  }
  
  if (limit <= 0 || limit > 1000) {
    throw new EmbeddingError(`Limit must be between 1 and 1000, got ${limit}`);
  }
  
  try {
    // Build WHERE clause for filters
    const whereConditions: string[] = ['p.embedding IS NOT NULL', 'p."isActive" = true'];
    const params: unknown[] = [];
    
    // Embedding vector (must be first param)
    params.push(JSON.stringify(queryEmbedding));
    
    // Build WHERE conditions with parameterized queries
    let paramIndex = 2; // Start at $2 (embedding is $1)
    
    if (filters?.merchantId) {
      whereConditions.push(`p."merchantId" = $${paramIndex}`);
      params.push(filters.merchantId);
      paramIndex++;
    }
    
    if (filters?.inStockOnly) {
      whereConditions.push(`p."stockStatus" = 'in_stock'`);
    }
    
    // Add limit parameter
    whereConditions.push(`LIMIT $${paramIndex}`);
    params.push(limit);
    
    const whereClause = whereConditions.slice(0, -1).join(' AND '); // All except LIMIT
    const limitClause = whereConditions[whereConditions.length - 1]; // Just the LIMIT
    
    // pgvector cosine distance: 1 - cosine_similarity
    // We use (1 - (embedding <=> query_embedding)) to get similarity (0-1, higher = more similar)
    // The <=> operator returns cosine distance, so we subtract from 1 to get similarity
    const query = `
      SELECT 
        p.id as "productId",
        1 - (p.embedding <=> $1::vector) as similarity
      FROM "Product" p
      WHERE ${whereClause}
      ORDER BY p.embedding <=> $1::vector
      ${limitClause}
    `;
    
    logger.debug('searchVectorIndex: executing query', {
      limit,
      filters,
      paramCount: params.length,
    });
    
    const results = await prisma.$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
      query,
      ...params
    );
    
    logger.debug('searchVectorIndex: results found', {
      count: results.length,
    });
    
    return results;
  } catch (error) {
    logger.error('searchVectorIndex: error executing search', {
      error: error instanceof Error ? error.message : String(error),
      limit,
      filters,
    });
    throw new EmbeddingError(
      `Failed to search vector index: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

