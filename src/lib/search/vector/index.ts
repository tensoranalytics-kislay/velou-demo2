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
  filters?: { inStockOnly?: boolean; merchantId?: string; categories?: string[]; priceMinCents?: number; priceMaxCents?: number; colors?: string[]; ageGroups?: string[] },
  limit: number = 1000,
  queryHash?: string // Optional query hash for consistent but diverse variant selection
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
    
    // Add color filtering if provided (hard SQL-level filter)
    // Colors are stored in attributes->>'color' or attributes->extensible->color
    // Match case-insensitively for exact and partial matches
    if (filters?.colors && filters.colors.length > 0) {
      const colorOrConditions: string[] = [];
      filters.colors.forEach((color) => {
        // Try exact match first, then partial match
        // Match on attributes->>'color' OR attributes->extensible->>'color'
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        colorOrConditions.push(
          `(LOWER(COALESCE(p.attributes->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER($${partialParam}) OR (p.attributes->'extensible' IS NOT NULL AND (LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) LIKE LOWER($${partialParam}))))`
        );
        params.push(color); // Exact match
        params.push(`%${color}%`); // Partial match
        paramIndex += 2;
      });
      // Wrap all color conditions in parentheses with OR
      if (colorOrConditions.length > 0) {
        whereConditions.push(`(${colorOrConditions.join(' OR ')})`);
      }
    }
    
    // Add age group filtering if provided (hard SQL-level filter)
    // Age groups can be stored in attributes->>'ageGroup' or inferred from category/subcategory
    // This is CRITICAL for filtering kids vs adult products
    // We use INCLUSIVE matching (match compatible age groups) AND EXCLUSIVE filtering (exclude incompatible age groups)
    if (filters?.ageGroups && filters.ageGroups.length > 0) {
      const ageGroupOrConditions: string[] = [];
      const ageGroupExclusions: string[] = []; // Products to EXCLUDE (incompatible age groups)
      
      filters.ageGroups.forEach((ageGroup) => {
        const ageGroupLower = ageGroup.toLowerCase();
        
        // Build conditions for explicit ageGroup attribute
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        const attrCondition = `(LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($${partialParam}) OR (p.attributes->'extensible' IS NOT NULL AND (LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($${partialParam}))))`;
        
        // Build conditions for category/subcategory inference
        // For "adult" or "Adult": match categories containing "women", "men", "adult", "ladies", "gentlemen"
        // For "kids", "children", "toddler", "baby": match categories containing "kids", "children", "toddler", "baby", "infant", "youth", "junior"
        let categoryCondition = '';
        if (ageGroupLower === 'adult' || ageGroupLower === 'adults') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'kids' || ageGroupLower === 'children' || ageGroupLower === 'child' || ageGroupLower === 'kid') {
          categoryCondition = `(LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%youth%' OR LOWER(p."category") LIKE '%junior%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%youth%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%junior%')`;
          // EXCLUDE products explicitly in adult categories or with adult ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`);
        } else if (ageGroupLower === 'toddler' || ageGroupLower === 'toddlers') {
          categoryCondition = `(LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%')`;
          // EXCLUDE products explicitly in adult categories
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`);
        } else if (ageGroupLower === 'baby' || ageGroupLower === 'babies' || ageGroupLower === 'infant' || ageGroupLower === 'infants') {
          categoryCondition = `(LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%')`;
          // EXCLUDE products explicitly in adult categories
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`);
        }
        
        // Combine attribute and category conditions with OR
        if (categoryCondition) {
          ageGroupOrConditions.push(`(${attrCondition} OR ${categoryCondition})`);
        } else {
          ageGroupOrConditions.push(attrCondition);
        }
        
        params.push(ageGroup); // Exact match
        params.push(`%${ageGroup}%`); // Partial match
        paramIndex += 2;
      });
      
      // Build final age group condition: (INCLUDE compatible) AND (EXCLUDE incompatible)
      if (ageGroupOrConditions.length > 0) {
        let finalCondition = `(${ageGroupOrConditions.join(' OR ')})`;
        // Add exclusions if any
        if (ageGroupExclusions.length > 0) {
          finalCondition = `(${finalCondition} AND NOT (${ageGroupExclusions.join(' OR ')}))`;
        }
        whereConditions.push(finalCondition);
      }
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
    // Use query-dependent hash for variant selection: same query gets same variant, different queries get different variants
    const hashSeed = queryHash || '';
    const query = `
      WITH all_products AS (
        SELECT 
          p.id as "productId",
          ${dedupKeyExpr} as dedup_key,
          p."updatedAt",
          ABS(HASHTEXT(p.id || '${hashSeed}'))::float as selection_score
        FROM "Product" p
        WHERE ${whereConditions.join(' AND ')}
      ),
      deduplicated AS (
        SELECT 
          "productId",
          selection_score,
          ROW_NUMBER() OVER (
            PARTITION BY dedup_key
            ORDER BY selection_score DESC
          ) as dedup_rank
        FROM all_products
      )
      SELECT "productId"
      FROM deduplicated
      WHERE dedup_rank = 1
      ORDER BY selection_score DESC
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
      hasColorFilter: filters?.colors !== undefined && filters.colors.length > 0,
      colorCount: filters?.colors?.length || 0,
      hasAgeGroupFilter: filters?.ageGroups !== undefined && filters.ageGroups.length > 0,
      ageGroupCount: filters?.ageGroups?.length || 0,
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
  filters?: { inStockOnly?: boolean; merchantId?: string; categories?: string[]; priceMinCents?: number; priceMaxCents?: number; colors?: string[]; ageGroups?: string[] },
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
    
    // Add color filtering if provided (hard SQL-level filter)
    // Colors are stored in attributes->>'color' or attributes->extensible->color
    // Match case-insensitively for exact and partial matches
    // Apply color filters even when productIds are provided (they were filtered in deduplication, but we need to ensure consistency)
    if (filters?.colors && filters.colors.length > 0) {
      const colorOrConditions: string[] = [];
      filters.colors.forEach((color) => {
        // Try exact match first, then partial match
        // Match on attributes->>'color' OR attributes->extensible->>'color'
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        colorOrConditions.push(
          `(LOWER(COALESCE(p.attributes->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER($${partialParam}) OR (p.attributes->'extensible' IS NOT NULL AND (LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) LIKE LOWER($${partialParam}))))`
        );
        params.push(color); // Exact match
        params.push(`%${color}%`); // Partial match
        paramIndex += 2;
      });
      // Wrap all color conditions in parentheses with OR
      if (colorOrConditions.length > 0) {
        whereConditions.push(`(${colorOrConditions.join(' OR ')})`);
      }
    }
    
    // Add age group filtering if provided (hard SQL-level filter)
    // Age groups can be stored in attributes->>'ageGroup' or inferred from category/subcategory
    // This is CRITICAL for filtering kids vs adult products
    // We use INCLUSIVE matching (match compatible age groups) AND EXCLUSIVE filtering (exclude incompatible age groups)
    // Apply age group filters even when productIds are provided (they were filtered in deduplication, but we need to ensure consistency)
    if (filters?.ageGroups && filters.ageGroups.length > 0) {
      const ageGroupOrConditions: string[] = [];
      const ageGroupExclusions: string[] = []; // Products to EXCLUDE (incompatible age groups)
      
      filters.ageGroups.forEach((ageGroup) => {
        const ageGroupLower = ageGroup.toLowerCase();
        
        // Build conditions for explicit ageGroup attribute
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        const attrCondition = `(LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($${partialParam}) OR (p.attributes->'extensible' IS NOT NULL AND (LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($${partialParam}))))`;
        
        // Build conditions for category/subcategory inference
        // For "adult" or "Adult": match categories containing "women", "men", "adult", "ladies", "gentlemen"
        // For "kids", "children", "toddler", "baby": match categories containing "kids", "children", "toddler", "baby", "infant", "youth", "junior"
        let categoryCondition = '';
        if (ageGroupLower === 'adult' || ageGroupLower === 'adults') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'kids' || ageGroupLower === 'children' || ageGroupLower === 'child' || ageGroupLower === 'kid') {
          categoryCondition = `(LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%youth%' OR LOWER(p."category") LIKE '%junior%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%youth%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%junior%')`;
          // EXCLUDE products explicitly in adult categories or with adult ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`);
        } else if (ageGroupLower === 'toddler' || ageGroupLower === 'toddlers') {
          categoryCondition = `(LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%')`;
          // EXCLUDE products explicitly in adult categories
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`);
        } else if (ageGroupLower === 'baby' || ageGroupLower === 'babies' || ageGroupLower === 'infant' || ageGroupLower === 'infants') {
          categoryCondition = `(LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%')`;
          // EXCLUDE products explicitly in adult categories
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`);
        }
        
        // Combine attribute and category conditions with OR
        if (categoryCondition) {
          ageGroupOrConditions.push(`(${attrCondition} OR ${categoryCondition})`);
        } else {
          ageGroupOrConditions.push(attrCondition);
        }
        
        params.push(ageGroup); // Exact match
        params.push(`%${ageGroup}%`); // Partial match
        paramIndex += 2;
      });
      
      // Build final age group condition: (INCLUDE compatible) AND (EXCLUDE incompatible)
      if (ageGroupOrConditions.length > 0) {
        let finalCondition = `(${ageGroupOrConditions.join(' OR ')})`;
        // Add exclusions if any
        if (ageGroupExclusions.length > 0) {
          finalCondition = `(${finalCondition} AND NOT (${ageGroupExclusions.join(' OR ')}))`;
        }
        whereConditions.push(finalCondition);
      }
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

