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

/**
 * Deduplicate products by category filter
 * 
 * Applies category filters and returns deduplicated product IDs.
 * This is used as the first step in the pipeline: Category Filter → Deduplication → Vector Search
 * 
 * Uses the same deduplication key logic as vector search:
 * parent_id > shopifyProductId > related_id > sourceId pattern > product id (fallback)
 * 
 * @param filters - Optional filters (inStockOnly, merchantId, categories)
 * @param limit - Optional limit on how many deduplicated products to return (default: 1000)
 * @returns Array of deduplicated product IDs
 */
export async function deduplicateProductsByCategory(
  filters?: { inStockOnly?: boolean; merchantId?: string; categories?: string[]; priceMinCents?: number; priceMaxCents?: number },
  limit: number = 1000
): Promise<string[]> {
  try {
    // Build WHERE clause for filters
    const whereConditions: string[] = ['p."isActive" = true'];
    const params: unknown[] = [];
    let paramIndex = 1;
    
    if (filters?.merchantId) {
      whereConditions.push(`p."merchantId" = $${paramIndex}`);
      params.push(filters.merchantId);
      paramIndex++;
    }
    
    if (filters?.inStockOnly) {
      whereConditions.push(`p."stockStatus" = 'in_stock'`);
    }
    
    // Add price filtering if provided (hard SQL-level filter)
    // Price filtering is IMPORTANT and should be applied at the same stage as category filtering
    // Only add condition if value is a valid number (not null or undefined)
    if (filters?.priceMinCents !== undefined && filters.priceMinCents !== null && typeof filters.priceMinCents === 'number') {
      whereConditions.push(`p."priceCents" >= $${paramIndex}`);
      params.push(filters.priceMinCents);
      paramIndex++;
    }
    
    if (filters?.priceMaxCents !== undefined && filters.priceMaxCents !== null && typeof filters.priceMaxCents === 'number') {
      whereConditions.push(`p."priceCents" <= $${paramIndex}`);
      params.push(filters.priceMaxCents);
      paramIndex++;
    }
    
    // Add category filtering if provided (hard SQL-level filter)
    // Filter by top 3 categories using OR conditions (case-insensitive matching)
    // Match on both exact category name and partial matches (for flexibility)
    if (filters?.categories && filters.categories.length > 0) {
      const categoryOrConditions: string[] = [];
      filters.categories.forEach((cat) => {
        // Try exact match first, then partial match
        // Match on category field (exact or contains) OR subcategory field (exact or contains)
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        categoryOrConditions.push(
          `(LOWER(p."category") = LOWER($${exactParam}) OR LOWER(p."category") LIKE LOWER($${partialParam}) OR LOWER(COALESCE(p."subcategory", '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($${partialParam}))`
        );
        params.push(cat); // Exact match
        params.push(`%${cat}%`); // Partial match
        paramIndex += 2;
      });
      // Wrap all category conditions in parentheses with OR
      if (categoryOrConditions.length > 0) {
        whereConditions.push(`(${categoryOrConditions.join(' OR ')})`);
      }
    }
    
    // Build deduplication key expression
    // Priority: parent_id > shopifyProductId > related_id > sourceId pattern > product id (fallback)
    const dedupKeyExpr = `
      COALESCE(
        NULLIF(p.attributes->>'parent_id', ''),
        NULLIF(p."shopifyProductId"::text, ''),
        NULLIF(p.attributes->>'shopifyProductId', ''),
        NULLIF(p.attributes->>'related_id', ''),
        CASE
          WHEN p."sourceId" IS NOT NULL AND p."sourceId" != ''
          THEN regexp_replace(p."sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          WHEN p.attributes->>'sourceId' IS NOT NULL AND p.attributes->>'sourceId' != ''
          THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          ELSE p.id
        END
      )
    `;
    
    // Build the deduplication query
    // We want to get one product per dedup_key group
    // Since we don't have similarity scores yet, we'll just pick the first one (by id or updatedAt)
    const query = `
      WITH all_products AS (
        SELECT 
          p.id as "productId",
          ${dedupKeyExpr} as dedup_key,
          p."updatedAt"
        FROM "Product" p
        WHERE ${whereConditions.join(' AND ')}
      ),
      deduplicated AS (
        SELECT 
          "productId",
          ROW_NUMBER() OVER (
            PARTITION BY dedup_key
            ORDER BY "updatedAt" DESC
          ) as dedup_rank
        FROM all_products
      )
      SELECT "productId"
      FROM deduplicated
      WHERE dedup_rank = 1
      LIMIT $${paramIndex}
    `;
    
    // Add limit parameter
    params.push(limit);
    
    logger.info('deduplicateProductsByCategory: executing query', {
      filters,
      limit,
      categoryCount: filters?.categories?.length || 0,
      hasPriceFilter: filters?.priceMinCents !== undefined || filters?.priceMaxCents !== undefined,
      priceMinCents: filters?.priceMinCents,
      priceMaxCents: filters?.priceMaxCents,
      paramCount: params.length,
    });
    
    const results = await prisma.$queryRawUnsafe<Array<{ productId: string }>>(
      query,
      ...params
    );
    
    const productIds = results.map(r => r.productId);
    
    logger.info('deduplicateProductsByCategory: results found', {
      count: productIds.length,
      requestedLimit: limit,
      categoryCount: filters?.categories?.length || 0,
    });
    
    return productIds;
  } catch (error) {
    logger.error('deduplicateProductsByCategory: error executing query', {
      error: error instanceof Error ? error.message : String(error),
      filters,
      limit,
    });
    throw new EmbeddingError(
      `Failed to deduplicate products by category: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Vector similarity search with SQL-based deduplication
 * 
 * Deduplicates products at the SQL level using common IDs (parent_id, shopifyProductId, related_id)
 * before returning results. This is more efficient than loading all products and deduplicating in-memory.
 * 
 * Uses SQL window functions to keep only the best product (highest similarity) from each group.
 * 
 * @param queryEmbedding - Query embedding vector (1536 dimensions)
 * @param limit - Maximum number of UNIQUE products to return (after deduplication)
 * @param filters - Optional filters (inStockOnly, merchantId)
 * @param preDeduplicationLimit - How many products to consider before deduplication (default: limit * 3)
 * @param productIds - Optional pre-deduplicated product IDs to search within (if provided, deduplication is skipped)
 * @returns Array of { productId, similarity } sorted by similarity (descending), already deduplicated
 */
export async function searchVectorIndexWithDeduplication(
  queryEmbedding: number[],
  limit: number,
  filters?: { inStockOnly?: boolean; merchantId?: string; categories?: string[]; priceMinCents?: number; priceMaxCents?: number },
  preDeduplicationLimit?: number,
  productIds?: string[] // NEW: pre-deduplicated product IDs to search within
): Promise<Array<{ productId: string; similarity: number }>> {
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `Query embedding must have ${EMBEDDING_DIMENSIONS} dimensions, got ${queryEmbedding.length}`
    );
  }
  
  if (limit <= 0 || limit > 1000) {
    throw new EmbeddingError(`Limit must be between 1 and 1000, got ${limit}`);
  }
  
  // If productIds provided, we skip deduplication (already done)
  // Otherwise, use pre-deduplication limit to account for variants
  const preDedupLimit = productIds ? undefined : (preDeduplicationLimit || limit * 3);
  
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
    
    // Add price filtering if provided (hard SQL-level filter)
    // Price filtering is IMPORTANT and should be applied at the same stage as category filtering
    // Apply price filters even when productIds are provided (they were filtered in deduplication, but we need to ensure consistency)
    // Only add condition if value is a valid number (not null or undefined)
    if (filters?.priceMinCents !== undefined && filters.priceMinCents !== null && typeof filters.priceMinCents === 'number') {
      whereConditions.push(`p."priceCents" >= $${paramIndex}`);
      params.push(filters.priceMinCents);
      paramIndex++;
    }
    
    if (filters?.priceMaxCents !== undefined && filters.priceMaxCents !== null && typeof filters.priceMaxCents === 'number') {
      whereConditions.push(`p."priceCents" <= $${paramIndex}`);
      params.push(filters.priceMaxCents);
      paramIndex++;
    }
    
    // If productIds provided, filter to only those IDs (deduplication already done)
    if (productIds && productIds.length > 0) {
      // Build PostgreSQL array literal for product IDs
      const productIdsArrayLiteral = productIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
      whereConditions.push(`p.id = ANY(ARRAY[${productIdsArrayLiteral}]::text[])`);
      // No need to add to params since we're using array literal
    } else {
      // Only apply category filtering if productIds not provided
      // (categories already applied in deduplication step)
      if (filters?.categories && filters.categories.length > 0) {
        const categoryOrConditions: string[] = [];
        filters.categories.forEach((cat) => {
          // Try exact match first, then partial match
          // Match on category field (exact or contains) OR subcategory field (exact or contains)
          const exactParam = paramIndex;
          const partialParam = paramIndex + 1;
          categoryOrConditions.push(
            `(LOWER(p."category") = LOWER($${exactParam}) OR LOWER(p."category") LIKE LOWER($${partialParam}) OR LOWER(COALESCE(p."subcategory", '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($${partialParam}))`
          );
          params.push(cat); // Exact match
          params.push(`%${cat}%`); // Partial match
          paramIndex += 2;
        });
        // Wrap all category conditions in parentheses with OR
        if (categoryOrConditions.length > 0) {
          whereConditions.push(`(${categoryOrConditions.join(' OR ')})`);
        }
      }
    }
    
    // Build query - simplified if productIds provided (no deduplication needed)
    let query: string;
    
    if (productIds && productIds.length > 0) {
      // Simple query: just vector similarity search on pre-deduplicated IDs
      query = `
        SELECT 
          p.id as "productId",
          1 - (p.embedding <=> $1::vector) as similarity
        FROM "Product" p
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY p.embedding <=> $1::vector
        LIMIT $${paramIndex}
      `;
      params.push(limit);
    } else {
      // Original query with deduplication CTEs
      // Build deduplication key expression
      // Priority: parent_id > shopifyProductId > related_id > sourceId pattern > product id (fallback)
      const dedupKeyExpr = `
        COALESCE(
          NULLIF(p.attributes->>'parent_id', ''),
          NULLIF(p."shopifyProductId"::text, ''),
          NULLIF(p.attributes->>'shopifyProductId', ''),
          NULLIF(p.attributes->>'related_id', ''),
          CASE
            WHEN p."sourceId" IS NOT NULL AND p."sourceId" != ''
            THEN regexp_replace(p."sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
            WHEN p.attributes->>'sourceId' IS NOT NULL AND p.attributes->>'sourceId' != ''
            THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
            ELSE p.id
          END
        )
      `;
      
      query = `
        WITH ranked_products AS (
          SELECT 
            p.id as "productId",
            1 - (p.embedding <=> $1::vector) as similarity,
            ${dedupKeyExpr} as dedup_key
          FROM "Product" p
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY p.embedding <=> $1::vector
          LIMIT $${paramIndex}
        ),
        deduplicated AS (
          SELECT 
            "productId",
            similarity,
            ROW_NUMBER() OVER (
              PARTITION BY dedup_key
              ORDER BY similarity DESC
            ) as dedup_rank
          FROM ranked_products
        )
        SELECT 
          "productId",
          similarity
        FROM deduplicated
        WHERE dedup_rank = 1
        ORDER BY similarity DESC
        LIMIT $${paramIndex + 1}
      `;
      
      // Add limit parameters
      params.push(preDedupLimit!); // Pre-deduplication limit
      params.push(limit); // Final limit after deduplication
    }
    
    // Log query execution
    if (productIds && productIds.length > 0) {
      logger.info('searchVectorIndexWithDeduplication: using pre-deduplicated product IDs', {
        productIdsCount: productIds.length,
        limit,
        filters: { inStockOnly: filters?.inStockOnly, merchantId: filters?.merchantId },
      });
    } else {
      // Log category filter application (only if not using pre-deduplicated IDs)
      if (filters?.categories && filters.categories.length > 0) {
        logger.info('category_filter_applied_in_vector_search', {
          categories: filters.categories,
          categoryCount: filters.categories.length,
          filterType: 'hard_sql_level',
          whereClausePreview: whereConditions.filter(c => c.includes('category') || c.includes('subcategory')).join(' AND '),
        });
      }
    }
    
    logger.debug('searchVectorIndexWithDeduplication: executing query', {
      limit,
      preDedupLimit,
      filters,
      hasPriceFilter: filters?.priceMinCents !== undefined || filters?.priceMaxCents !== undefined,
      priceMinCents: filters?.priceMinCents,
      priceMaxCents: filters?.priceMaxCents,
      paramCount: params.length,
      hasPreDeduplicatedIds: !!(productIds && productIds.length > 0),
      productIdsCount: productIds?.length || 0,
      categoryFilter: filters?.categories,
      categoryCount: filters?.categories?.length || 0,
      hasCategoryFilter: !!(filters?.categories && filters.categories.length > 0),
      whereClause: whereConditions.join(' AND '),
    });
    
    const results = await prisma.$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
      query,
      ...params
    );
    
    logger.info('searchVectorIndexWithDeduplication: results found', {
      count: results.length,
      requestedLimit: limit,
      preDedupLimit,
      hasPreDeduplicatedIds: !!(productIds && productIds.length > 0),
      deduplicationRate: preDedupLimit && preDedupLimit > 0 ? ((preDedupLimit - results.length) / preDedupLimit * 100).toFixed(1) + '%' : 'N/A',
    });
    
    return results;
  } catch (error) {
    logger.error('searchVectorIndexWithDeduplication: error executing search', {
      error: error instanceof Error ? error.message : String(error),
      limit,
      filters,
    });
    throw new EmbeddingError(
      `Failed to search vector index with deduplication: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

