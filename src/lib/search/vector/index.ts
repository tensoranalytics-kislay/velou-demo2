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
  filters?: { inStockOnly?: boolean; merchantId?: string; categories?: string[]; priceMinCents?: number; priceMaxCents?: number; colors?: string[]; ageGroups?: string[]; excludedColors?: string[]; lengths?: string[] },
  limit: number = 1000,
  queryHash?: string, // Optional query hash for consistent but diverse variant selection
  skipColorFilter?: boolean // NEW: Skip color filtering if colors are text-only constraints
): Promise<string[]> {
  try {
    // Build WHERE clause for filters
    // CRITICAL: Filtering order must be: Category → Colors → Age Groups → Other filters
    // This ensures proper hard filtering hierarchy
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
    
    // STEP 1: Category filtering (FIRST - most restrictive)
    // Filter by top 3 categories using OR conditions (case-insensitive matching)
    // Check both category AND subcategory fields individually for maximum product coverage
    // This ensures products are found whether they're stored in category field or subcategory field
    if (filters?.categories && filters.categories.length > 0) {
      const categoryOrConditions: string[] = [];
      filters.categories.forEach((cat) => {
        // Try exact match first, then partial match
        // Match on BOTH category AND subcategory fields individually (exact or contains)
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        categoryOrConditions.push(
          `(
            LOWER(p."category") = LOWER($${exactParam}) 
            OR LOWER(p."category") LIKE LOWER($${partialParam})
            OR LOWER(COALESCE(p."subcategory", '')) = LOWER($${exactParam}) 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($${partialParam})
          )`
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
    
    // STEP 2: Color filtering (SECOND - after category)
    // Add color filtering if provided (hard SQL-level filter)
    // Colors are stored in:
    // 1. attributes->>'enriched_color' (string) - PRIMARY SOURCE - e.g., "Red, Bright Red, Vibrant Red"
    // 2. attributes->>'color' or attributes->'extensible'->>'color' (legacy fields) - FALLBACK
    // NOTE: variant_colors is NOT used for filtering - only enriched_color and legacy color fields
    // Match case-insensitively for exact and partial matches
    // Skip if skipColorFilter is true (colors are text-only constraints for this category)
    
    // Handle included colors (must match)
    if (filters?.colors && Array.isArray(filters.colors) && filters.colors.length > 0 && !skipColorFilter) {
      const colorOrConditions: string[] = [];
      filters.colors.forEach((color) => {
        // Try exact match first, then partial match
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        // Check enriched_color string (PRIMARY SOURCE)
        // Check legacy color fields (fallback)
        // NOTE: variant_colors is intentionally excluded from filtering
        colorOrConditions.push(
          `(
            -- Check enriched_color string (PRIMARY SOURCE - comma-separated terms)
            (LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE LOWER($${partialParam}))
            OR
            -- Check legacy color fields (fallback)
            (LOWER(COALESCE(p.attributes->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER($${partialParam}))
            OR
            (p.attributes->'extensible' IS NOT NULL AND 
             (LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) LIKE LOWER($${partialParam})))
          )`
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
    
    // Handle excluded colors (must NOT match)
    if (filters?.excludedColors && Array.isArray(filters.excludedColors) && filters.excludedColors.length > 0) {
      const excludedColorAndConditions: string[] = [];
      filters.excludedColors.forEach((color) => {
        // Try exact match first, then partial match
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        // Check enriched_color string (PRIMARY SOURCE)
        // Check legacy color fields (fallback)
        // NOTE: variant_colors is intentionally excluded from filtering
        // Use NOT to exclude products matching these colors
        excludedColorAndConditions.push(
          `NOT (
            -- Check enriched_color string (PRIMARY SOURCE)
            (LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE LOWER($${partialParam}))
            OR
            -- Check legacy color fields (fallback)
            (LOWER(COALESCE(p.attributes->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER($${partialParam}))
            OR
            (p.attributes->'extensible' IS NOT NULL AND 
             (LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) LIKE LOWER($${partialParam})))
          )`
        );
        params.push(color); // Exact match
        params.push(`%${color}%`); // Partial match
        paramIndex += 2;
      });
      // Wrap all excluded color conditions in parentheses with AND (all must be false)
      if (excludedColorAndConditions.length > 0) {
        whereConditions.push(`(${excludedColorAndConditions.join(' AND ')})`);
      }
    }
    
    // Add age group filtering if provided (hard SQL-level filter)
    // IMPORTANT: ageGroup attribute is OPTIONAL - products without ageGroup should still match via category
    // Age groups can be stored in attributes->>'ageGroup' or inferred from category/subcategory
    // This is CRITICAL for filtering kids vs adult products
    // We use INCLUSIVE matching (match compatible age groups via attribute OR category) 
    // AND EXCLUSIVE filtering (exclude incompatible age groups - only when explicitly set or in incompatible categories)
    if (filters?.ageGroups && filters.ageGroups.length > 0) {
      const ageGroupOrConditions: string[] = [];
      const ageGroupExclusions: string[] = []; // Products to EXCLUDE (incompatible age groups)
      
      filters.ageGroups.forEach((ageGroup) => {
        const ageGroupLower = ageGroup.toLowerCase();
        
        // Normalize "baby girl" and "baby boy" to "baby" for age group matching
        // "boy" and "girl" are gender indicators, not age group modifiers
        const normalizedAgeGroup = ageGroupLower === 'baby girl' || ageGroupLower === 'baby boy' 
          ? 'baby' 
          : ageGroupLower;
        
        // Build conditions for explicit ageGroup attribute (OPTIONAL - products without ageGroup can still match via category)
        // CRITICAL: Check both the database column (p."ageGroup") AND JSONB attributes for backward compatibility
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        const attrCondition = `(
          -- Check database column (primary source)
          LOWER(COALESCE(p."ageGroup", '')) = LOWER($${exactParam}) 
          OR LOWER(COALESCE(p."ageGroup", '')) LIKE LOWER($${partialParam})
          OR
          -- Check JSONB attributes (fallback for legacy data)
          LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($${exactParam}) 
          OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($${partialParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) = LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE LOWER($${partialParam})
          OR (p.attributes->'extensible' IS NOT NULL AND (
            LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($${exactParam}) 
            OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($${partialParam})
          ))
        )`;
        
        // Build conditions for category/subcategory inference
        // For "adult" or "Adult": match categories containing "women", "men", "adult", "ladies", "gentlemen"
        // For "women", "womens", "ladies": match categories containing "women", "ladies"
        // For "men", "mens", "gentlemen": match categories containing "men", "gentlemen"
        // For "kids", "children", "toddler", "baby": match categories containing "kids", "children", "toddler", "baby", "infant", "youth", "junior"
        let categoryCondition = '';
        if (normalizedAgeGroup === 'adult' || normalizedAgeGroup === 'adults') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'women' || ageGroupLower === 'womens' || ageGroupLower === 'ladies' || ageGroupLower === 'lady') {
          // Match categories containing "women", "ladies", "womens"
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'men' || ageGroupLower === 'mens' || ageGroupLower === 'gentlemen' || ageGroupLower === 'gentleman') {
          // Match categories containing "men", "gentlemen", "mens"
          categoryCondition = `(LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'kids' || ageGroupLower === 'children' || ageGroupLower === 'child' || ageGroupLower === 'kid') {
          categoryCondition = `(LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%youth%' OR LOWER(p."category") LIKE '%junior%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%youth%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%junior%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' OR LOWER(p.title) LIKE '%for women%' OR LOWER(p.title) LIKE '%for men%' OR LOWER(p.title) LIKE '%for ladies%' OR LOWER(p.title) LIKE '%for gentlemen%')`);
        } else if (ageGroupLower === 'teen' || ageGroupLower === 'teens' || ageGroupLower === 'teenager' || ageGroupLower === 'teenagers') {
          // CRITICAL: Teens (ages 13-19) should use ADULT categories (Women's Dresses, Tops, etc.), NOT kids categories
          // Teens are old enough for adult sizing and styles, but not for kids/toddler products
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`;
          // EXCLUDE products explicitly in kids categories (kids, children, toddler, baby)
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'toddler' || ageGroupLower === 'toddlers') {
          // CRITICAL: For "toddler" hard filter, match products with "Toddler" in age_group (including combinations like "Kids, Toddler" and "Baby, Toddler")
          // The attrCondition uses LIKE '%toddler%' which will match:
          //   - 'Toddler' (single value)
          //   - 'Kids, Toddler' (combination)
          //   - 'Baby, Toddler' (combination)
          // Do NOT include "kids" or "children" categories - those are too broad
          // This is a hard filter, so be precise
          categoryCondition = `(LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          // CRITICAL: Only exclude products with ONLY "Kids" age_group (not containing "Toddler")
          // DO NOT exclude products with "Kids, Toddler" - they should match!
          // CRITICAL: Do NOT exclude products with "for Women"/"for Men" in title if they're in toddler categories or have "Toddler" in ageGroup
          ageGroupExclusions.push(`(
            (LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
             AND NOT (LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE '%toddler%'))
            OR (LOWER(COALESCE(p.attributes->>'age_group', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
                AND NOT (LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE '%toddler%'))
            OR LOWER(p."category") LIKE '%women%' 
            OR LOWER(p."category") LIKE '%men%' 
            OR LOWER(p."category") LIKE '%adult%' 
            OR LOWER(p."category") LIKE '%ladies%' 
            OR LOWER(p."category") LIKE '%gentlemen%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' 
            OR (LOWER(p.title) LIKE '%for women%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for men%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for ladies%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for gentlemen%'
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
          )`);
        } else if (ageGroupLower === 'baby' || ageGroupLower === 'babies' || ageGroupLower === 'infant' || ageGroupLower === 'infants') {
          // CRITICAL: For "baby" hard filter, ONLY match products with "Baby" in age_group or in "baby"/"infant" categories
          // Do NOT include "kids" or "children" categories - those are too broad
          // This is a hard filter, so be precise
          categoryCondition = `(LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          // Also EXCLUDE products with ONLY "Kids" age_group (not "Baby" or "Baby, Toddler")
          ageGroupExclusions.push(`(
            LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(COALESCE(p.attributes->>'age_group', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(p."category") LIKE '%women%' 
            OR LOWER(p."category") LIKE '%men%' 
            OR LOWER(p."category") LIKE '%adult%' 
            OR LOWER(p."category") LIKE '%ladies%' 
            OR LOWER(p."category") LIKE '%gentlemen%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' 
            OR LOWER(p.title) LIKE '%for women%' 
            OR LOWER(p.title) LIKE '%for men%' 
            OR LOWER(p.title) LIKE '%for ladies%' 
            OR LOWER(p.title) LIKE '%for gentlemen%'
          )`);
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
        // CRITICAL: Age group exclusions MUST be applied even when category filter is present
        // This ensures products in adult categories are excluded even if category filter matches
        if (ageGroupExclusions.length > 0) {
          finalCondition = `(${finalCondition} AND NOT (${ageGroupExclusions.join(' OR ')}))`;
        }
        whereConditions.push(finalCondition);
        
        // Log age group exclusion for debugging
        if (ageGroupExclusions.length > 0) {
          logger.debug('age_group_exclusion_applied', {
            ageGroups: filters.ageGroups,
            exclusionCount: ageGroupExclusions.length,
            exclusionPreview: ageGroupExclusions[0]?.substring(0, 200) || 'N/A',
            note: 'Age group exclusion will exclude products in adult categories even if category filter matches',
          });
        }
      }
    }
    
    // Add length filtering if provided (hard SQL-level filter)
    // CRITICAL: Length is a hard filter - products must match the specified length(s)
    // Length can be stored in:
    // 1. p."length" database column (primary source) - e.g., "Mini", "Midi", "Maxi"
    // 2. attributes->>'length' or attributes->'Length' (fallback for legacy data)
    // Match case-insensitively for exact matches
    if (filters?.lengths && filters.lengths.length > 0) {
      const lengthOrConditions: string[] = [];
      filters.lengths.forEach((length) => {
        const exactParam = paramIndex;
        const lengthCondition = `(
          -- Check database column (primary source)
          LOWER(COALESCE(p."length", '')) = LOWER($${exactParam})
          OR
          -- Check JSONB attributes (fallback for legacy data)
          LOWER(COALESCE(p.attributes->>'length', '')) = LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->>'Length', '')) = LOWER($${exactParam})
          OR (p.attributes->'extensible' IS NOT NULL AND 
              LOWER(COALESCE(p.attributes->'extensible'->>'length', '')) = LOWER($${exactParam}))
        )`;
        lengthOrConditions.push(lengthCondition);
        params.push(length); // Exact match
        paramIndex += 1;
      });
      // Wrap all length conditions in parentheses with OR
      if (lengthOrConditions.length > 0) {
        whereConditions.push(`(${lengthOrConditions.join(' OR ')})`);
        logger.debug('length_filter_applied', {
          lengths: filters.lengths,
          lengthCount: filters.lengths.length,
          note: 'Length filter is applied as hard SQL filter - products must match specified length(s)',
        });
      }
    }
    
    // Add category filtering if provided (hard SQL-level filter)
    // NOTE: Category filter is applied AFTER age group exclusion
    // This means age group exclusion takes precedence - if a product is in an excluded category,
    // it will be filtered out even if it matches the category filter
    // Filter by top 3 categories using OR conditions (case-insensitive matching)
    // Only use category as hard SQL filter (subcategory is used for soft matching/ranking only)
    if (filters?.categories && filters.categories.length > 0) {
      const categoryOrConditions: string[] = [];
      filters.categories.forEach((cat) => {
        // Try exact match first, then partial match
        // Match on category field only (exact or contains)
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        categoryOrConditions.push(
          `(LOWER(p."category") = LOWER($${exactParam}) OR LOWER(p."category") LIKE LOWER($${partialParam}))`
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
    // Priority: extract shopifyProductId from product id > parent_id > shopifyProductId > related_id > sourceId pattern > product id (fallback)
    const dedupKeyExpr = `
      COALESCE(
        -- Extract the first numeric sequence (9+ digits) that appears after "shopify" (case-insensitive)
        -- This captures the Shopify product ID regardless of variant or pattern variations
        -- Pattern examples: loveshackfancy_Shopify_8203037769913_45309911892153
        --                   loveshackfancy_shopify_US_8203037769913_45309911892153
        (
          SELECT (regexp_match(p.id, '.*shopify[^0-9]*([0-9]{9,})', 'i'))[1]
        ),
        NULLIF(p.attributes->>'parent_id', ''),
        NULLIF(p.attributes->>'related_id', ''),
        NULLIF(p."shopifyProductId"::text, ''),
        NULLIF(p.attributes->>'shopifyProductId', ''),
        CASE
          WHEN p."sourceId" IS NOT NULL AND p."sourceId" != ''
          THEN regexp_replace(p."sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          WHEN p.attributes->>'sourceId' IS NOT NULL AND p.attributes->>'sourceId' != ''
          THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          ELSE NULL
        END,
        p.id
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
    
    // Build a preview of the WHERE clause for debugging
    const whereClausePreview = whereConditions
      .filter(c => c.includes('category') || c.includes('ageGroup') || c.includes('age') || c.includes('length'))
      .join(' AND ');
    
    logger.info('deduplicateProductsByCategory: executing query', {
      filters,
      limit,
      categoryCount: filters?.categories?.length || 0,
      categories: filters?.categories,
      hasPriceFilter: filters?.priceMinCents !== undefined || filters?.priceMaxCents !== undefined,
      priceMinCents: filters?.priceMinCents,
      priceMaxCents: filters?.priceMaxCents,
      hasColorFilter: filters?.colors !== undefined && filters.colors.length > 0,
      colorCount: filters?.colors?.length || 0,
      hasAgeGroupFilter: filters?.ageGroups !== undefined && filters.ageGroups.length > 0,
      ageGroups: filters?.ageGroups,
      ageGroupCount: filters?.ageGroups?.length || 0,
      hasLengthFilter: filters?.lengths !== undefined && filters.lengths.length > 0,
      lengths: filters?.lengths,
      lengthCount: filters?.lengths?.length || 0,
      paramCount: params.length,
      whereClausePreview: whereClausePreview || 'no category/age filters in preview',
      totalWhereConditions: whereConditions.length,
      fullWhereClause: whereConditions.join(' AND '), // Full WHERE clause for debugging
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
 * Deduplicate products by category filter (for post-SQL filtering mode)
 * 
 * This function only applies category/subcategory, ageGroups, and price filters in SQL.
 * Colors, lengths, sleeves, necklines, formalityLevels, and colorShades are INTENTIONALLY OMITTED
 * and will be applied via post-SQL filtering using category-specific dictionaries.
 * 
 * @param filters - Optional filters (categories, ageGroups, priceMinCents, priceMaxCents, merchantId, inStockOnly)
 * @param limit - Optional limit on how many deduplicated products to return (default: 1500)
 * @returns Array of deduplicated product IDs
 */
export async function deduplicateProductsByCategoryForPostFiltering(
  filters?: { 
    categories?: string[];
    ageGroups?: string[];
    priceMinCents?: number;
    priceMaxCents?: number;
    merchantId?: string;
    inStockOnly?: boolean;
  },
  limit: number = 1500
): Promise<string[]> {
  try {
    // Build WHERE clause for filters
    // CRITICAL: Only apply category, ageGroups, and price filters - skip post-filterable attributes
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
    
    // STEP 1: Category filtering (FIRST - most restrictive)
    // Filter by top 3 categories using OR conditions (case-insensitive matching)
    // Check both category AND subcategory fields individually for maximum product coverage
    if (filters?.categories && filters.categories.length > 0) {
      const categoryOrConditions: string[] = [];
      filters.categories.forEach((cat) => {
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        categoryOrConditions.push(
          `(
            LOWER(p."category") = LOWER($${exactParam}) 
            OR LOWER(p."category") LIKE LOWER($${partialParam})
            OR LOWER(COALESCE(p."subcategory", '')) = LOWER($${exactParam}) 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($${partialParam})
          )`
        );
        params.push(cat); // Exact match
        params.push(`%${cat}%`); // Partial match
        paramIndex += 2;
      });
      if (categoryOrConditions.length > 0) {
        whereConditions.push(`(${categoryOrConditions.join(' OR ')})`);
      }
    }
    
    // STEP 2: Age group filtering (same logic as deduplicateProductsByCategory)
    if (filters?.ageGroups && filters.ageGroups.length > 0) {
      const ageGroupOrConditions: string[] = [];
      const ageGroupExclusions: string[] = [];
      
      filters.ageGroups.forEach((ageGroup) => {
        const ageGroupLower = ageGroup.toLowerCase();
        const normalizedAgeGroup = ageGroupLower === 'baby girl' || ageGroupLower === 'baby boy' 
          ? 'baby' 
          : ageGroupLower;
        
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        const attrCondition = `(
          LOWER(COALESCE(p."ageGroup", '')) = LOWER($${exactParam}) 
          OR LOWER(COALESCE(p."ageGroup", '')) LIKE LOWER($${partialParam})
          OR
          LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($${exactParam}) 
          OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($${partialParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) = LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE LOWER($${partialParam})
          OR (p.attributes->'extensible' IS NOT NULL AND (
            LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($${exactParam}) 
            OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($${partialParam})
          ))
        )`;
        
        let categoryCondition = '';
        if (normalizedAgeGroup === 'adult' || normalizedAgeGroup === 'adults') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'women' || ageGroupLower === 'womens' || ageGroupLower === 'ladies' || ageGroupLower === 'lady') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'men' || ageGroupLower === 'mens' || ageGroupLower === 'gentlemen' || ageGroupLower === 'gentleman') {
          categoryCondition = `(LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'kids' || ageGroupLower === 'children' || ageGroupLower === 'child' || ageGroupLower === 'kid') {
          categoryCondition = `(LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%youth%' OR LOWER(p."category") LIKE '%junior%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%youth%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%junior%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' OR LOWER(p.title) LIKE '%for women%' OR LOWER(p.title) LIKE '%for men%' OR LOWER(p.title) LIKE '%for ladies%' OR LOWER(p.title) LIKE '%for gentlemen%')`);
        } else if (ageGroupLower === 'teen' || ageGroupLower === 'teens' || ageGroupLower === 'teenager' || ageGroupLower === 'teenagers') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'toddler' || ageGroupLower === 'toddlers') {
          categoryCondition = `(LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')`;
          ageGroupExclusions.push(`(
            (LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
             AND NOT (LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE '%toddler%'))
            OR (LOWER(COALESCE(p.attributes->>'age_group', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
                AND NOT (LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE '%toddler%'))
            OR LOWER(p."category") LIKE '%women%' 
            OR LOWER(p."category") LIKE '%men%' 
            OR LOWER(p."category") LIKE '%adult%' 
            OR LOWER(p."category") LIKE '%ladies%' 
            OR LOWER(p."category") LIKE '%gentlemen%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' 
            OR (LOWER(p.title) LIKE '%for women%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for men%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for ladies%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for gentlemen%'
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
          )`);
        } else if (ageGroupLower === 'baby' || ageGroupLower === 'babies' || ageGroupLower === 'infant' || ageGroupLower === 'infants') {
          categoryCondition = `(LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`;
          ageGroupExclusions.push(`(
            LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(COALESCE(p.attributes->>'age_group', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(p."category") LIKE '%women%' 
            OR LOWER(p."category") LIKE '%men%' 
            OR LOWER(p."category") LIKE '%adult%' 
            OR LOWER(p."category") LIKE '%ladies%' 
            OR LOWER(p."category") LIKE '%gentlemen%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' 
            OR LOWER(p.title) LIKE '%for women%' 
            OR LOWER(p.title) LIKE '%for men%' 
            OR LOWER(p.title) LIKE '%for ladies%' 
            OR LOWER(p.title) LIKE '%for gentlemen%'
          )`);
        }
        
        if (categoryCondition) {
          ageGroupOrConditions.push(`(${attrCondition} OR ${categoryCondition})`);
        } else {
          ageGroupOrConditions.push(attrCondition);
        }
        
        params.push(ageGroup); // Exact match
        params.push(`%${ageGroup}%`); // Partial match
        paramIndex += 2;
      });
      
      if (ageGroupOrConditions.length > 0) {
        let finalCondition = `(${ageGroupOrConditions.join(' OR ')})`;
        if (ageGroupExclusions.length > 0) {
          finalCondition = `(${finalCondition} AND NOT (${ageGroupExclusions.join(' OR ')}))`;
        }
        whereConditions.push(finalCondition);
      }
    }
    
    // STEP 3: Price filtering (if specified)
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
    
    // NOTE: Colors, lengths, sleeves, necklines, formalityLevels, and colorShades are INTENTIONALLY OMITTED
    // These will be applied via post-SQL filtering using category-specific dictionaries
    
    // Build deduplication key expression (same as deduplicateProductsByCategory)
    const dedupKeyExpr = `
      COALESCE(
        (
          SELECT (regexp_match(p.id, '.*shopify[^0-9]*([0-9]{9,})', 'i'))[1]
        ),
        NULLIF(p.attributes->>'parent_id', ''),
        NULLIF(p.attributes->>'related_id', ''),
        NULLIF(p."shopifyProductId"::text, ''),
        NULLIF(p.attributes->>'shopifyProductId', ''),
        CASE
          WHEN p."sourceId" IS NOT NULL AND p."sourceId" != ''
          THEN regexp_replace(p."sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          WHEN p.attributes->>'sourceId' IS NOT NULL AND p.attributes->>'sourceId' != ''
          THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          ELSE NULL
        END,
        p.id
      )
    `;
    
    // Build the deduplication query
    const query = `
      WITH all_products AS (
        SELECT 
          p.id as "productId",
          ${dedupKeyExpr} as dedup_key,
          p."updatedAt",
          ABS(HASHTEXT(p.id))::float as selection_score
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
    
    params.push(limit);
    
    logger.info('deduplicateProductsByCategoryForPostFiltering: executing query', {
      filters,
      limit,
      categoryCount: filters?.categories?.length || 0,
      categories: filters?.categories,
      hasPriceFilter: filters?.priceMinCents !== undefined || filters?.priceMaxCents !== undefined,
      priceMinCents: filters?.priceMinCents,
      priceMaxCents: filters?.priceMaxCents,
      hasAgeGroupFilter: filters?.ageGroups !== undefined && filters.ageGroups.length > 0,
      ageGroups: filters?.ageGroups,
      ageGroupCount: filters?.ageGroups?.length || 0,
      paramCount: params.length,
      whereClausePreview: whereConditions.join(' AND '),
      note: 'Post-filterable attributes (colors, lengths, sleeves, necklines, formalityLevels, colorShades) intentionally omitted from SQL filters',
    });
    
    const results = await prisma.$queryRawUnsafe<Array<{ productId: string }>>(
      query,
      ...params
    );
    
    const productIds = results.map(r => r.productId);
    
    logger.info('deduplicateProductsByCategoryForPostFiltering: results found', {
      count: productIds.length,
      requestedLimit: limit,
      categoryCount: filters?.categories?.length || 0,
    });
    
    return productIds;
  } catch (error) {
    logger.error('deduplicateProductsByCategoryForPostFiltering: error executing query', {
      error: error instanceof Error ? error.message : String(error),
      filters,
      limit,
    });
    throw new EmbeddingError(
      `Failed to deduplicate products by category for post-filtering: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Search products by keyword in titles/descriptions with category filter
 * 
 * Used as fallback when strict SQL filters return 0 results.
 * Searches for keywords in product titles and descriptions, then ranks by vector similarity.
 * 
 * @param keywords - Keywords to search for in titles/descriptions
 * @param categories - Categories to filter by
 * @param queryEmbedding - Optional query embedding for vector similarity ranking
 * @param limit - Maximum number of products to return
 * @param filters - Additional filters (merchant, stock, price, etc.)
 * @returns Array of product IDs with similarity scores
 */
export async function searchProductsByKeyword(
  keywords: string[],
  categories: string[],
  queryEmbedding?: number[],
  limit: number = 50,
  filters?: { inStockOnly?: boolean; merchantId?: string; priceMinCents?: number; priceMaxCents?: number; ageGroups?: string[] }
): Promise<Array<{ productId: string; similarity: number }>> {
  try {
    if (keywords.length === 0) {
      return [];
    }

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

    // Add price filtering if provided
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

    // Add age group filtering if provided (same logic as deduplicateProductsByCategory)
    // IMPORTANT: ageGroup attribute is OPTIONAL - products without ageGroup should still match via category
    if (filters?.ageGroups && filters.ageGroups.length > 0) {
      const ageGroupOrConditions: string[] = [];
      const ageGroupExclusions: string[] = [];

      filters.ageGroups.forEach((ageGroup) => {
        const ageGroupLower = ageGroup.toLowerCase();
        
        // Normalize "baby girl" and "baby boy" to "baby" for age group matching
        // "boy" and "girl" are gender indicators, not age group modifiers
        const normalizedAgeGroup = ageGroupLower === 'baby girl' || ageGroupLower === 'baby boy' 
          ? 'baby' 
          : ageGroupLower;
        
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        const attrCondition = `(
          LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($${exactParam}) 
          OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($${partialParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) = LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE LOWER($${partialParam})
          OR (p.attributes->'extensible' IS NOT NULL AND (
            LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($${exactParam}) 
            OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($${partialParam})
          ))
        )`;

        let categoryCondition = '';
        if (normalizedAgeGroup === 'adult' || normalizedAgeGroup === 'adults') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (normalizedAgeGroup === 'women' || normalizedAgeGroup === 'womens' || normalizedAgeGroup === 'ladies' || normalizedAgeGroup === 'lady') {
          // Match categories containing "women", "ladies", "womens"
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (normalizedAgeGroup === 'men' || normalizedAgeGroup === 'mens' || normalizedAgeGroup === 'gentlemen' || normalizedAgeGroup === 'gentleman') {
          // Match categories containing "men", "gentlemen", "mens"
          categoryCondition = `(LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (normalizedAgeGroup === 'kids' || normalizedAgeGroup === 'children' || normalizedAgeGroup === 'child' || normalizedAgeGroup === 'kid') {
          categoryCondition = `(LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%youth%' OR LOWER(p."category") LIKE '%junior%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%youth%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%junior%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' OR LOWER(p.title) LIKE '%for women%' OR LOWER(p.title) LIKE '%for men%' OR LOWER(p.title) LIKE '%for ladies%' OR LOWER(p.title) LIKE '%for gentlemen%')`);
        } else if (normalizedAgeGroup === 'teen' || normalizedAgeGroup === 'teens' || normalizedAgeGroup === 'teenager' || normalizedAgeGroup === 'teenagers') {
          // CRITICAL: Teens (ages 13-19) should use ADULT categories (Women's Dresses, Tops, etc.), NOT kids categories
          // Teens are old enough for adult sizing and styles, but not for kids/toddler products
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`;
          // EXCLUDE products explicitly in kids categories (kids, children, toddler, baby)
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (normalizedAgeGroup === 'toddler' || normalizedAgeGroup === 'toddlers') {
          // CRITICAL: For "toddler" hard filter, ONLY match products with "Toddler" in age_group or in "toddler" categories
          // Do NOT include "kids" or "children" categories - those are too broad
          // This is a hard filter, so be precise
          categoryCondition = `(LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          // Also EXCLUDE products with ONLY "Kids" age_group (not "Toddler" or "Baby, Toddler")
          ageGroupExclusions.push(`(
            LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(COALESCE(p.attributes->>'age_group', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(p."category") LIKE '%women%' 
            OR LOWER(p."category") LIKE '%men%' 
            OR LOWER(p."category") LIKE '%adult%' 
            OR LOWER(p."category") LIKE '%ladies%' 
            OR LOWER(p."category") LIKE '%gentlemen%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' 
            OR LOWER(p.title) LIKE '%for women%' 
            OR LOWER(p.title) LIKE '%for men%' 
            OR LOWER(p.title) LIKE '%for ladies%' 
            OR LOWER(p.title) LIKE '%for gentlemen%'
          )`);
        } else if (normalizedAgeGroup === 'baby' || normalizedAgeGroup === 'babies' || normalizedAgeGroup === 'infant' || normalizedAgeGroup === 'infants') {
          categoryCondition = `(LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%')`;
          // CRITICAL: EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          // This exclusion applies even when a category filter is present (age group takes precedence for age-appropriate filtering)
          // Also check title for "for Women", "for Men", etc. to catch incorrectly categorized products
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' OR LOWER(p.title) LIKE '%for women%' OR LOWER(p.title) LIKE '%for men%' OR LOWER(p.title) LIKE '%for ladies%' OR LOWER(p.title) LIKE '%for gentlemen%')`);
        }

        if (categoryCondition) {
          ageGroupOrConditions.push(`(${attrCondition} OR ${categoryCondition})`);
        } else {
          ageGroupOrConditions.push(attrCondition);
        }

        params.push(ageGroup);
        params.push(`%${ageGroup}%`);
        paramIndex += 2;
      });

      if (ageGroupOrConditions.length > 0) {
        let finalCondition = `(${ageGroupOrConditions.join(' OR ')})`;
        if (ageGroupExclusions.length > 0) {
          finalCondition = `(${finalCondition} AND NOT (${ageGroupExclusions.join(' OR ')}))`;
        }
        whereConditions.push(finalCondition);
      }
    }

    // Add category filtering
    if (categories.length > 0) {
      const categoryOrConditions: string[] = [];
      categories.forEach((cat) => {
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        categoryOrConditions.push(
          `(LOWER(p."category") = LOWER($${exactParam}) OR LOWER(p."category") LIKE LOWER($${partialParam}) OR LOWER(COALESCE(p."subcategory", '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($${partialParam}))`
        );
        params.push(cat);
        params.push(`%${cat}%`);
        paramIndex += 2;
      });
      if (categoryOrConditions.length > 0) {
        whereConditions.push(`(${categoryOrConditions.join(' OR ')})`);
      }
    }

    // Build keyword search conditions (search in title, description, and attributes)
    // For perfumes, keywords like "lavender" might be in attributes->>'scent', attributes->>'notes', etc.
    const keywordConditions: string[] = [];
    keywords.forEach((keyword) => {
      const titleParam = paramIndex;
      const descParam = paramIndex + 1;
      const attrParam = paramIndex + 2;
      keywordConditions.push(
        `(LOWER(p."title") LIKE LOWER($${titleParam}) OR LOWER(p."description") LIKE LOWER($${descParam}) OR LOWER(COALESCE(p.attributes::text, '')) LIKE LOWER($${attrParam}))`
      );
      params.push(`%${keyword}%`);
      params.push(`%${keyword}%`);
      params.push(`%${keyword}%`);
      paramIndex += 3;
    });

    if (keywordConditions.length === 0) {
      return [];
    }

    // Build query with optional vector similarity ranking
    let similarityExpr = '0.0::float';
    let similarityJoin = '';
    if (queryEmbedding && queryEmbedding.length > 0) {
      const embeddingArray = `[${queryEmbedding.join(',')}]`;
      similarityExpr = `(1 - (p.embedding <=> $${paramIndex}::vector))`;
      params.push(embeddingArray);
      paramIndex++;
    }

    const query = `
      SELECT 
        p.id as "productId",
        ${similarityExpr} as similarity
      FROM "Product" p
      ${similarityJoin}
      WHERE ${whereConditions.join(' AND ')} AND (${keywordConditions.join(' OR ')})
      ORDER BY similarity DESC, p."updatedAt" DESC
      LIMIT $${paramIndex}
    `;

    params.push(limit);

    logger.info('searchProductsByKeyword: executing query', {
      keywords,
      categories,
      limit,
      hasVectorRanking: !!queryEmbedding,
      paramCount: params.length,
    });

    const results = await prisma.$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
      query,
      ...params
    );

    logger.info('searchProductsByKeyword: results found', {
      count: results.length,
      requestedLimit: limit,
    });

    return results;
  } catch (error) {
    logger.error('searchProductsByKeyword: error executing query', {
      error: error instanceof Error ? error.message : String(error),
      keywords,
      categories,
      limit,
    });
    throw new EmbeddingError(
      `Failed to search products by keyword: ${error instanceof Error ? error.message : String(error)}`,
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
  filters?: { inStockOnly?: boolean; merchantId?: string; categories?: string[]; priceMinCents?: number; priceMaxCents?: number; colors?: string[]; ageGroups?: string[]; excludedColors?: string[]; lengths?: string[] },
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
    // Colors are stored in:
    // 1. attributes->>'enriched_color' (string) - PRIMARY SOURCE - e.g., "Red, Bright Red, Vibrant Red"
    // 2. attributes->>'color' or attributes->'extensible'->>'color' (legacy fields) - FALLBACK
    // NOTE: variant_colors is NOT used for filtering - only enriched_color and legacy color fields
    // Match case-insensitively for exact and partial matches
    // Apply color filters even when productIds are provided (they were filtered in deduplication, but we need to ensure consistency)
    
    // Handle included colors (must match)
    if (filters?.colors && Array.isArray(filters.colors) && filters.colors.length > 0) {
      const colorOrConditions: string[] = [];
      filters.colors.forEach((color) => {
        // Try exact match first, then partial match
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        // Check enriched_color string (PRIMARY SOURCE)
        // Check legacy color fields (fallback)
        // NOTE: variant_colors is intentionally excluded from filtering
        colorOrConditions.push(
          `(
            -- Check enriched_color string (PRIMARY SOURCE - comma-separated terms)
            (LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE LOWER($${partialParam}))
            OR
            -- Check legacy color fields (fallback)
            (LOWER(COALESCE(p.attributes->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER($${partialParam}))
            OR
            (p.attributes->'extensible' IS NOT NULL AND 
             (LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) LIKE LOWER($${partialParam})))
          )`
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
    
    // Handle excluded colors (must NOT match)
    if (filters?.excludedColors && Array.isArray(filters.excludedColors) && filters.excludedColors.length > 0) {
      const excludedColorAndConditions: string[] = [];
      filters.excludedColors.forEach((color) => {
        // Try exact match first, then partial match
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        // Check enriched_color string (PRIMARY SOURCE)
        // Check legacy color fields (fallback)
        // NOTE: variant_colors is intentionally excluded from filtering
        // Use NOT to exclude products matching these colors
        excludedColorAndConditions.push(
          `NOT (
            -- Check enriched_color string (PRIMARY SOURCE)
            (LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE LOWER($${partialParam}))
            OR
            -- Check legacy color fields (fallback)
            (LOWER(COALESCE(p.attributes->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->>'color', '')) LIKE LOWER($${partialParam}))
            OR
            (p.attributes->'extensible' IS NOT NULL AND 
             (LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) = LOWER($${exactParam}) OR LOWER(COALESCE(p.attributes->'extensible'->>'color', '')) LIKE LOWER($${partialParam})))
          )`
        );
        params.push(color); // Exact match
        params.push(`%${color}%`); // Partial match
        paramIndex += 2;
      });
      // Wrap all excluded color conditions in parentheses with AND (all must be false)
      if (excludedColorAndConditions.length > 0) {
        whereConditions.push(`(${excludedColorAndConditions.join(' AND ')})`);
      }
    }
    
    // Add age group filtering if provided (hard SQL-level filter)
    // IMPORTANT: ageGroup attribute is OPTIONAL - products without ageGroup should still match via category
    // Age groups can be stored in attributes->>'ageGroup' or inferred from category/subcategory
    // This is CRITICAL for filtering kids vs adult products
    // We use INCLUSIVE matching (match compatible age groups via attribute OR category) 
    // AND EXCLUSIVE filtering (exclude incompatible age groups - only when explicitly set or in incompatible categories)
    // Apply age group filters even when productIds are provided (they were filtered in deduplication, but we need to ensure consistency)
    if (filters?.ageGroups && filters.ageGroups.length > 0) {
      const ageGroupOrConditions: string[] = [];
      const ageGroupExclusions: string[] = []; // Products to EXCLUDE (incompatible age groups)
      
      filters.ageGroups.forEach((ageGroup) => {
        const ageGroupLower = ageGroup.toLowerCase();
        
        // Normalize "baby girl" and "baby boy" to "baby" for age group matching
        // "boy" and "girl" are gender indicators, not age group modifiers
        const normalizedAgeGroup = ageGroupLower === 'baby girl' || ageGroupLower === 'baby boy' 
          ? 'baby' 
          : ageGroupLower;
        
        // Build conditions for explicit ageGroup attribute (OPTIONAL - products without ageGroup can still match via category)
        // CRITICAL: Check both the database column (p."ageGroup") AND JSONB attributes for backward compatibility
        const exactParam = paramIndex;
        const partialParam = paramIndex + 1;
        const attrCondition = `(
          -- Check database column (primary source)
          LOWER(COALESCE(p."ageGroup", '')) = LOWER($${exactParam}) 
          OR LOWER(COALESCE(p."ageGroup", '')) LIKE LOWER($${partialParam})
          OR
          -- Check JSONB attributes (fallback for legacy data)
          LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($${exactParam}) 
          OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($${partialParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) = LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE LOWER($${partialParam})
          OR (p.attributes->'extensible' IS NOT NULL AND (
            LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($${exactParam}) 
            OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($${partialParam})
          ))
        )`;
        
        // Build conditions for category/subcategory inference
        // For "adult" or "Adult": match categories containing "women", "men", "adult", "ladies", "gentlemen"
        // For "women", "womens", "ladies": match categories containing "women", "ladies"
        // For "men", "mens", "gentlemen": match categories containing "men", "gentlemen"
        // For "kids", "children", "toddler", "baby": match categories containing "kids", "children", "toddler", "baby", "infant", "youth", "junior"
        let categoryCondition = '';
        if (normalizedAgeGroup === 'adult' || normalizedAgeGroup === 'adults') {
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'women' || ageGroupLower === 'womens' || ageGroupLower === 'ladies' || ageGroupLower === 'lady') {
          // Match categories containing "women", "ladies", "womens"
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'men' || ageGroupLower === 'mens' || ageGroupLower === 'gentlemen' || ageGroupLower === 'gentleman') {
          // Match categories containing "men", "gentlemen", "mens"
          categoryCondition = `(LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%')`;
          // EXCLUDE products explicitly in kids categories or with kids ageGroup
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'kids' || ageGroupLower === 'children' || ageGroupLower === 'child' || ageGroupLower === 'kid') {
          categoryCondition = `(LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%youth%' OR LOWER(p."category") LIKE '%junior%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%youth%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%junior%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen') OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%gentlemen%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' OR LOWER(p.title) LIKE '%for women%' OR LOWER(p.title) LIKE '%for men%' OR LOWER(p.title) LIKE '%for ladies%' OR LOWER(p.title) LIKE '%for gentlemen%')`);
        } else if (ageGroupLower === 'teen' || ageGroupLower === 'teens' || ageGroupLower === 'teenager' || ageGroupLower === 'teenagers') {
          // CRITICAL: Teens (ages 13-19) should use ADULT categories (Women's Dresses, Tops, etc.), NOT kids categories
          // Teens are old enough for adult sizing and styles, but not for kids/toddler products
          categoryCondition = `(LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%ladies%' OR LOWER(p."category") LIKE '%adult%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%')`;
          // EXCLUDE products explicitly in kids categories (kids, children, toddler, baby)
          ageGroupExclusions.push(`(LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('kids', 'children', 'child', 'kid', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants') OR LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR LOWER(p."category") LIKE '%child%' OR LOWER(p."category") LIKE '%toddler%' OR LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%children%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%child%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`);
        } else if (ageGroupLower === 'toddler' || ageGroupLower === 'toddlers') {
          // CRITICAL: For "toddler" hard filter, match products with "Toddler" in age_group (including combinations like "Kids, Toddler" and "Baby, Toddler")
          // The attrCondition uses LIKE '%toddler%' which will match:
          //   - 'Toddler' (single value)
          //   - 'Kids, Toddler' (combination)
          //   - 'Baby, Toddler' (combination)
          // Do NOT include "kids" or "children" categories - those are too broad
          // This is a hard filter, so be precise
          categoryCondition = `(LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          // CRITICAL: Only exclude products with ONLY "Kids" age_group (not containing "Toddler")
          // DO NOT exclude products with "Kids, Toddler" - they should match!
          // CRITICAL: Do NOT exclude products with "for Women"/"for Men" in title if they're in toddler categories or have "Toddler" in ageGroup
          ageGroupExclusions.push(`(
            (LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
             AND NOT (LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE '%toddler%'))
            OR (LOWER(COALESCE(p.attributes->>'age_group', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
                AND NOT (LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE '%toddler%'))
            OR LOWER(p."category") LIKE '%women%' 
            OR LOWER(p."category") LIKE '%men%' 
            OR LOWER(p."category") LIKE '%adult%' 
            OR LOWER(p."category") LIKE '%ladies%' 
            OR LOWER(p."category") LIKE '%gentlemen%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' 
            OR (LOWER(p.title) LIKE '%for women%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for men%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for ladies%' 
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
            OR (LOWER(p.title) LIKE '%for gentlemen%'
                AND NOT (LOWER(p."category") LIKE '%toddler%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%toddler%')
                AND NOT (LOWER(COALESCE(p."ageGroup", '')) LIKE '%toddler%'))
          )`);
        } else if (ageGroupLower === 'baby' || ageGroupLower === 'babies' || ageGroupLower === 'infant' || ageGroupLower === 'infants') {
          // CRITICAL: For "baby" hard filter, ONLY match products with "Baby" in age_group or in "baby"/"infant" categories
          // Do NOT include "kids" or "children" categories - those are too broad
          // This is a hard filter, so be precise
          categoryCondition = `(LOWER(p."category") LIKE '%baby%' OR LOWER(p."category") LIKE '%infant%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%baby%' OR LOWER(COALESCE(p."subcategory", '')) LIKE '%infant%')`;
          // EXCLUDE products explicitly in adult categories OR with "for Women"/"for Men" in title
          // Also EXCLUDE products with ONLY "Kids" age_group (not "Baby" or "Baby, Toddler")
          ageGroupExclusions.push(`(
            LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(COALESCE(p.attributes->>'age_group', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen', 'kids', 'children', 'child', 'kid')
            OR LOWER(p."category") LIKE '%women%' 
            OR LOWER(p."category") LIKE '%men%' 
            OR LOWER(p."category") LIKE '%adult%' 
            OR LOWER(p."category") LIKE '%ladies%' 
            OR LOWER(p."category") LIKE '%gentlemen%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%men%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%adult%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%ladies%' 
            OR LOWER(COALESCE(p."subcategory", '')) LIKE '%gentlemen%' 
            OR LOWER(p.title) LIKE '%for women%' 
            OR LOWER(p.title) LIKE '%for men%' 
            OR LOWER(p.title) LIKE '%for ladies%' 
            OR LOWER(p.title) LIKE '%for gentlemen%'
          )`);
        }
        
        // Combine attribute and category conditions with OR
        // IMPORTANT: ageGroup attribute is OPTIONAL - products without ageGroup should still match via category
        // This allows products with NULL/missing ageGroup to be included if category matches
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
      // CRITICAL: Only exclude products that EXPLICITLY have incompatible ageGroup attributes or are in incompatible categories
      // Products with NULL/missing ageGroup should be included if category matches (handled by OR condition above)
      if (ageGroupOrConditions.length > 0) {
        let finalCondition = `(${ageGroupOrConditions.join(' OR ')})`;
        // Add exclusions if any - only exclude when there's an explicit conflict
        if (ageGroupExclusions.length > 0) {
          finalCondition = `(${finalCondition} AND NOT (${ageGroupExclusions.join(' OR ')}))`;
        }
        whereConditions.push(finalCondition);
      }
    }
    
    // Add length filtering if provided (hard SQL-level filter)
    // CRITICAL: Length is a hard filter - products must match the specified length(s)
    // Length can be stored in:
    // 1. p."length" database column (primary source) - e.g., "Mini", "Midi", "Maxi"
    // 2. attributes->>'length' or attributes->'Length' (fallback for legacy data)
    // Match case-insensitively for exact matches
    // Apply length filters even when productIds are provided (they were filtered in deduplication, but we need to ensure consistency)
    if (filters?.lengths && filters.lengths.length > 0) {
      const lengthOrConditions: string[] = [];
      filters.lengths.forEach((length) => {
        const exactParam = paramIndex;
        const lengthCondition = `(
          -- Check database column (primary source)
          LOWER(COALESCE(p."length", '')) = LOWER($${exactParam})
          OR
          -- Check JSONB attributes (fallback for legacy data)
          LOWER(COALESCE(p.attributes->>'length', '')) = LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->>'Length', '')) = LOWER($${exactParam})
          OR (p.attributes->'extensible' IS NOT NULL AND 
              LOWER(COALESCE(p.attributes->'extensible'->>'length', '')) = LOWER($${exactParam}))
        )`;
        lengthOrConditions.push(lengthCondition);
        params.push(length); // Exact match
        paramIndex += 1;
      });
      // Wrap all length conditions in parentheses with OR
      if (lengthOrConditions.length > 0) {
        whereConditions.push(`(${lengthOrConditions.join(' OR ')})`);
        logger.debug('searchVectorIndexWithDeduplication: length_filter_applied', {
          lengths: filters.lengths,
          lengthCount: filters.lengths.length,
          note: 'Length filter is applied as hard SQL filter - products must match specified length(s)',
        });
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
      // Check both category AND subcategory fields individually for maximum product coverage
      // This ensures products are found whether they're stored in category field or subcategory field
      if (filters?.categories && filters.categories.length > 0) {
        const categoryOrConditions: string[] = [];
        filters.categories.forEach((cat) => {
          // Try exact match first, then partial match
          // Match on BOTH category AND subcategory fields individually (exact or contains)
          const exactParam = paramIndex;
          const partialParam = paramIndex + 1;
          categoryOrConditions.push(
            `(
              LOWER(p."category") = LOWER($${exactParam}) 
              OR LOWER(p."category") LIKE LOWER($${partialParam})
              OR LOWER(COALESCE(p."subcategory", '')) = LOWER($${exactParam}) 
              OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($${partialParam})
            )`
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
      // Priority: extract shopifyProductId from product id > parent_id > shopifyProductId > related_id > sourceId pattern > product id (fallback)
      const dedupKeyExpr = `
        COALESCE(
          -- Extract the first numeric sequence (9+ digits) that appears after "shopify" (case-insensitive)
          -- This captures the Shopify product ID regardless of variant or pattern variations
          -- Pattern examples: loveshackfancy_Shopify_8203037769913_45309911892153
          --                   loveshackfancy_shopify_US_8203037769913_45309911892153
          (
            SELECT (regexp_match(p.id, '.*shopify[^0-9]*([0-9]{9,})', 'i'))[1]
          ),
          NULLIF(p.attributes->>'parent_id', ''),
          NULLIF(p.attributes->>'related_id', ''),
          NULLIF(p."shopifyProductId"::text, ''),
          NULLIF(p.attributes->>'shopifyProductId', ''),
          CASE
            WHEN p."sourceId" IS NOT NULL AND p."sourceId" != ''
            THEN regexp_replace(p."sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
            WHEN p.attributes->>'sourceId' IS NOT NULL AND p.attributes->>'sourceId' != ''
            THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
            ELSE NULL
          END,
          p.id
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
