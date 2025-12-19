/**
 * SQL-Based Constraint Ranking
 * 
 * Builds SQL expressions for constraint matching and ranking products
 * in the database, combining vector similarity with constraint scores.
 */

import type { QueryConstraints } from '../query-parser';
import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';
import type { SearchResultItem } from '../../search/types';

export type ProductWithScore = SearchResultItem & {
  finalScore: number;
  vectorScore: number;
  constraintScore: number;
};

/**
 * Build SQL expression for matching a JSONB attribute against query values
 * Handles both single values and arrays
 */
function buildAttributeMatchSQL(
  keyName: string,
  queryValues: string[],
  paramIndex: number
): { sql: string; params: string[]; nextParamIndex: number } {
  if (!queryValues || queryValues.length === 0) {
    return { sql: '0', params: [], nextParamIndex: paramIndex };
  }

  const params: string[] = [];
  let currentParamIndex = paramIndex;

  // Build array of normalized query values and embed directly in SQL
  // Use VALUES clause instead of ARRAY to avoid Prisma parameter issues
  const normalizedValues = queryValues.map(v => v.toLowerCase().trim());
  const valuesClause = normalizedValues.map(v => `('${v.replace(/'/g, "''")}')`).join(', ');
  const arrayParam = `(VALUES ${valuesClause}) AS qv(qv_val)`;

  // Try both string and array paths (e.g., color vs colors)
  // Check if attribute value (string or array) matches any query value
  const sql = `
    CASE
      -- Check direct string match (exact) - try string path first
      WHEN LOWER(COALESCE(p.attributes->>'${keyName}', '')) IN (SELECT qv_val FROM ${arrayParam}) THEN 1.0
      -- Check if attribute value contains any query value (fuzzy match) - string path
      WHEN LOWER(COALESCE(p.attributes->>'${keyName}', '')) != '' AND EXISTS (
        SELECT 1 FROM ${arrayParam}
        WHERE LOWER(p.attributes->>'${keyName}') LIKE '%' || qv_val || '%'
           OR qv_val LIKE '%' || LOWER(p.attributes->>'${keyName}') || '%'
      ) THEN 0.8
      -- Check JSONB array field (e.g., attributes->'colors')
      WHEN jsonb_typeof(COALESCE(p.attributes->'${keyName}', 'null'::jsonb)) = 'array' THEN
        CASE
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(p.attributes->'${keyName}') AS attr_val
            CROSS JOIN ${arrayParam}
            WHERE LOWER(attr_val) = qv_val
          ) THEN 1.0
          WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(p.attributes->'${keyName}') AS attr_val
            CROSS JOIN ${arrayParam}
            WHERE LOWER(attr_val) LIKE '%' || qv_val || '%'
               OR qv_val LIKE '%' || LOWER(attr_val) || '%'
          ) THEN 0.8
          ELSE 0
        END
      ELSE 0
    END
  `;

  return { sql, params, nextParamIndex: paramIndex }; // No param used, so return original index
}

/**
 * Build SQL expression for size matching (handles size abbreviations)
 */
function buildSizeMatchSQL(
  querySizes: string[],
  paramIndex: number
): { sql: string; params: string[]; nextParamIndex: number } {
  if (!querySizes || querySizes.length === 0) {
    return { sql: '0', params: [], nextParamIndex: paramIndex };
  }

  const params: string[] = [];
  let currentParamIndex = paramIndex;

  const normalizedSizes = querySizes.map(s => s.toLowerCase().trim());
  // Use VALUES clause instead of ARRAY to avoid Prisma parameter issues
  const valuesClause = normalizedSizes.map(s => `('${s.replace(/'/g, "''")}')`).join(', ');
  const arrayParam = `(VALUES ${valuesClause}) AS qs(qs_val)`;

  // Check sizes or size attribute (can be string or array)
  const sql = `
    CASE
      -- Check direct match in sizes array
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.attributes->'sizes', p.attributes->'size', '[]'::jsonb)) AS size_val
        CROSS JOIN ${arrayParam}
        WHERE LOWER(size_val) = qs_val
      ) THEN 1.0
      -- Check size abbreviation match (S, M, L, etc.)
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.attributes->'sizes', p.attributes->'size', '[]'::jsonb)) AS size_val
        CROSS JOIN ${arrayParam}
        WHERE LOWER(size_val) LIKE qs_val || '%' OR qs_val LIKE LOWER(size_val) || '%'
      ) THEN 0.9
      -- Check partial match
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.attributes->'sizes', p.attributes->'size', '[]'::jsonb)) AS size_val
        CROSS JOIN ${arrayParam}
        WHERE LOWER(size_val) LIKE '%' || qs_val || '%' OR qs_val LIKE '%' || LOWER(size_val) || '%'
      ) THEN 0.7
      ELSE 0
    END
  `;

  return { sql, params, nextParamIndex: paramIndex }; // No param used, so return original index
}

/**
 * Build SQL expression for price matching
 */
function buildPriceMatchSQL(
  priceMinCents: number | undefined,
  priceMaxCents: number | undefined,
  paramIndex: number
): { sql: string; params: unknown[]; nextParamIndex: number } {
  const params: unknown[] = [];
  let currentParamIndex = paramIndex;

  if (!priceMinCents && !priceMaxCents) {
    return { sql: '0', params: [], nextParamIndex: paramIndex };
  }

  let sql = 'CASE ';
  
  if (priceMinCents && priceMaxCents) {
    params.push(priceMinCents, priceMaxCents);
    sql += `WHEN p."priceCents" BETWEEN $${currentParamIndex} AND $${currentParamIndex + 1} THEN 1.0 `;
    currentParamIndex += 2;
    // Close to range (within 20%)
    sql += `WHEN p."priceCents" <= $${currentParamIndex - 1} * 1.2 AND p."priceCents" >= $${currentParamIndex - 2} * 0.8 THEN 0.5 `;
  } else if (priceMinCents) {
    params.push(priceMinCents);
    sql += `WHEN p."priceCents" >= $${currentParamIndex} THEN 1.0 `;
    currentParamIndex++;
    sql += `WHEN p."priceCents" >= $${currentParamIndex - 1} * 0.8 THEN 0.5 `;
  } else if (priceMaxCents) {
    params.push(priceMaxCents);
    sql += `WHEN p."priceCents" <= $${currentParamIndex} THEN 1.0 `;
    currentParamIndex++;
    sql += `WHEN p."priceCents" <= $${currentParamIndex - 1} * 1.2 THEN 0.5 `;
  }
  
  sql += 'ELSE 0 END';
  
  return { sql, params, nextParamIndex: currentParamIndex };
}

/**
 * Build constraint scoring SQL expression
 * Returns SQL that calculates weighted constraint match scores
 */
function buildConstraintScoreSQL(
  constraints: QueryConstraints,
  startParamIndex: number
): { sql: string; params: unknown[]; nextParamIndex: number } {
  const params: unknown[] = [];
  let currentParamIndex = startParamIndex;
  const scoreExpressions: string[] = [];
  const weights: number[] = [];

  // Color (weight: 1.0)
  if (constraints.colors && constraints.colors.length > 0) {
    const colorMatch = buildAttributeMatchSQL(
      'color',
      constraints.colors,
      currentParamIndex
    );
    scoreExpressions.push(`(${colorMatch.sql} * 1.0)`);
    params.push(...colorMatch.params);
    weights.push(1.0);
    currentParamIndex = colorMatch.nextParamIndex;
  }

  // Size (weight: 0.8)
  if (constraints.sizes && constraints.sizes.length > 0) {
    const sizeMatch = buildSizeMatchSQL(constraints.sizes, currentParamIndex);
    scoreExpressions.push(`(${sizeMatch.sql} * 0.8)`);
    params.push(...sizeMatch.params);
    weights.push(0.8);
    currentParamIndex = sizeMatch.nextParamIndex;
  }

  // Occasion (weight: 0.6)
  if (constraints.occasions && constraints.occasions.length > 0) {
    const occasionMatch = buildAttributeMatchSQL(
      'occasion',
      constraints.occasions,
      currentParamIndex
    );
    scoreExpressions.push(`(${occasionMatch.sql} * 0.6)`);
    params.push(...occasionMatch.params);
    weights.push(0.6);
    currentParamIndex = occasionMatch.nextParamIndex;
  }

  // Style (weight: 0.4)
  if (constraints.styles && constraints.styles.length > 0) {
    const styleMatch = buildAttributeMatchSQL(
      'style',
      constraints.styles,
      currentParamIndex
    );
    scoreExpressions.push(`(${styleMatch.sql} * 0.4)`);
    params.push(...styleMatch.params);
    weights.push(0.4);
    currentParamIndex = styleMatch.nextParamIndex;
  }

  // Pattern (weight: 0.4)
  if (constraints.patterns && constraints.patterns.length > 0) {
    const patternMatch = buildAttributeMatchSQL(
      'pattern',
      constraints.patterns,
      currentParamIndex
    );
    scoreExpressions.push(`(${patternMatch.sql} * 0.4)`);
    params.push(...patternMatch.params);
    weights.push(0.4);
    currentParamIndex = patternMatch.nextParamIndex;
  }

  // Season (weight: 0.3)
  if (constraints.seasons && constraints.seasons.length > 0) {
    const seasonMatch = buildAttributeMatchSQL(
      'season',
      constraints.seasons,
      currentParamIndex
    );
    scoreExpressions.push(`(${seasonMatch.sql} * 0.3)`);
    params.push(...seasonMatch.params);
    weights.push(0.3);
    currentParamIndex = seasonMatch.nextParamIndex;
  }

  // Material (weight: 0.2)
  if (constraints.materials && constraints.materials.length > 0) {
    const materialMatch = buildAttributeMatchSQL(
      'material',
      constraints.materials,
      currentParamIndex
    );
    scoreExpressions.push(`(${materialMatch.sql} * 0.2)`);
    params.push(...materialMatch.params);
    weights.push(0.2);
    currentParamIndex = materialMatch.nextParamIndex;
  }

  // Fit (weight: 0.2)
  if (constraints.fits && constraints.fits.length > 0) {
    const fitMatch = buildAttributeMatchSQL(
      'fit',
      constraints.fits,
      currentParamIndex
    );
    scoreExpressions.push(`(${fitMatch.sql} * 0.2)`);
    params.push(...fitMatch.params);
    weights.push(0.2);
    currentParamIndex = fitMatch.nextParamIndex;
  }

  // Collection (weight: 0.2)
  if (constraints.collections && constraints.collections.length > 0) {
    const collectionMatch = buildAttributeMatchSQL(
      'collection',
      constraints.collections,
      currentParamIndex
    );
    scoreExpressions.push(`(${collectionMatch.sql} * 0.2)`);
    params.push(...collectionMatch.params);
    weights.push(0.2);
    currentParamIndex = collectionMatch.nextParamIndex;
  }

  // AgeGroups (weight: 1.0 - high priority for filtering)
  // Note: ageGroups is not in QueryConstraints type, so this is skipped
  // if ('ageGroups' in constraints && constraints.ageGroups && (constraints as any).ageGroups.length > 0) {
  //   const ageGroupMatch = buildAttributeMatchSQL(
  //     'ageGroup',
  //     (constraints as any).ageGroups,
  //     currentParamIndex
  //   );
  //   scoreExpressions.push(`(${ageGroupMatch.sql} * 1.0)`);
  //   params.push(...ageGroupMatch.params);
  //   weights.push(1.0);
  //   currentParamIndex = ageGroupMatch.nextParamIndex;
  // }

  // Genders (weight: 1.0 - high priority for filtering)
  // Note: genders is not in QueryConstraints type, so this is skipped
  // if ('genders' in constraints && constraints.genders && (constraints as any).genders.length > 0) {
  //   const genderMatch = buildAttributeMatchSQL(
  //     'gender',
  //     (constraints as any).genders,
  //     currentParamIndex
  //   );
  //   scoreExpressions.push(`(${genderMatch.sql} * 1.0)`);
  //   params.push(...genderMatch.params);
  //   weights.push(1.0);
  //   currentParamIndex = genderMatch.nextParamIndex;
  // }

  // Price (weight: 0.3)
  // Convert null to undefined for buildPriceMatchSQL (null = explicitly removed, undefined = not set)
  const priceMin = constraints.priceMinCents === null ? undefined : constraints.priceMinCents;
  const priceMax = constraints.priceMaxCents === null ? undefined : constraints.priceMaxCents;
  if (priceMin || priceMax) {
    const priceMatch = buildPriceMatchSQL(
      priceMin,
      priceMax,
      currentParamIndex
    );
    scoreExpressions.push(`(${priceMatch.sql} * 0.3)`);
    params.push(...priceMatch.params);
    weights.push(0.3);
    currentParamIndex = priceMatch.nextParamIndex;
  }

  if (scoreExpressions.length === 0) {
    return { sql: '0', params: [], nextParamIndex: startParamIndex };
  }

  // Calculate weighted average: sum of (score * weight) / sum of weights (for non-zero scores)
  // We need to track which scores are non-zero to calculate the denominator correctly
  const sumExpression = scoreExpressions.join(' + ');
  
  // Build weight sum expression: sum weights only for non-zero scores
  const weightSumParts: string[] = [];
  let exprIndex = 0;
  for (let i = 0; i < weights.length; i++) {
    // Extract the base score expression (without weight multiplication)
    const baseExpr = scoreExpressions[exprIndex].replace(/^\(/, '').replace(/ \* \d+\.\d+\)$/, '');
    weightSumParts.push(`CASE WHEN (${baseExpr}) > 0 THEN ${weights[i]} ELSE 0 END`);
    exprIndex++;
  }
  const weightSumExpression = weightSumParts.join(' + ');

  const sql = `
    CASE
      WHEN (${weightSumExpression}) = 0 THEN 0
      ELSE (${sumExpression}) / NULLIF((${weightSumExpression}), 0)
    END
  `;

  return { sql, params, nextParamIndex: currentParamIndex };
}

/**
 * Search vector index with constraint-based ranking and ID-based deduplication
 * 
 * This function combines vector similarity search with constraint matching
 * and deduplication in a single SQL query for optimal performance.
 * 
 * @param queryEmbedding - Query embedding vector (1536 dimensions)
 * @param productIds - Product IDs from vector search (already sorted by similarity)
 * @param constraints - Query constraints for ranking
 * @param limit - Maximum number of products to return (after deduplication)
 * @param filters - Optional filters (merchantId, inStockOnly)
 * @returns Products with final scores, already ranked and deduplicated
 */
export async function searchVectorIndexWithRanking(
  queryEmbedding: number[],
  productIds: string[],
  constraints: QueryConstraints | null,
  limit: number,
  filters?: { inStockOnly?: boolean; merchantId?: string }
): Promise<ProductWithScore[]> {
  if (productIds.length === 0) {
    return [];
  }

  if (limit <= 0 || limit > 100) {
    throw new Error(`Limit must be between 1 and 100, got ${limit}`);
  }

  try {
    const params: unknown[] = [];
    let paramIndex = 1;

    // Embedding vector (first parameter)
    params.push(JSON.stringify(queryEmbedding));
    paramIndex++;

    // Product IDs array - build as PostgreSQL array literal in SQL
    // Format: ARRAY['id1','id2']::text[] (Product.id is TEXT, not UUID)
    const productIdsArrayLiteral = productIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
    const productIdsCondition = `p.id = ANY(ARRAY[${productIdsArrayLiteral}]::text[])`;

    // Build WHERE conditions
    const whereConditions: string[] = [
      productIdsCondition,
      'p.embedding IS NOT NULL',
      'p."isActive" = true',
    ];

    if (filters?.merchantId) {
      params.push(filters.merchantId);
      whereConditions.push(`p."merchantId" = $${paramIndex}`);
      paramIndex++;
    }

    if (filters?.inStockOnly) {
      whereConditions.push(`p."stockStatus" = 'in_stock'`);
    }

    // Calculate vector similarity score
    const vectorScoreSQL = `1 - (p.embedding <=> $1::vector)`;

    // Calculate constraint score
    let constraintScoreSQL = '0';
    let constraintParams: unknown[] = [];
    let constraintParamIndex = paramIndex;

    if (constraints && Object.values(constraints).some(v => v !== null && (Array.isArray(v) ? v.length > 0 : true))) {
      const constraintMatch = buildConstraintScoreSQL(constraints, constraintParamIndex);
      constraintScoreSQL = constraintMatch.sql;
      constraintParams = constraintMatch.params;
      constraintParamIndex = constraintMatch.nextParamIndex;
    }

    // Add constraint params to main params array
    params.push(...constraintParams);
    const limitParamIndex = constraintParamIndex;

    // Calculate final score: vector_score + (constraint_boost * 0.3)
    // Constraint boost is capped at 0.3 (30% of base score)
    const finalScoreSQL = `
      LEAST(1.0, ${vectorScoreSQL} + (${constraintScoreSQL} * 0.3))
    `;


    // Build deduplication key expression (needs to be in the CTE)
    const dedupKeyExpr = `
      COALESCE(
        p.attributes->>'parent_id',
        p.attributes->>'shopifyProductId',
        p.attributes->>'related_id',
        CASE
          WHEN p.attributes->>'sourceId' IS NOT NULL
          THEN regexp_replace(p.attributes->>'sourceId', '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
          ELSE ''
        END,
        ''
      )
    `;

    // Build the full query with CTEs
    const query = `
      WITH ranked_products AS (
        SELECT 
          p.*,
          ${vectorScoreSQL} as vector_score,
          ${constraintScoreSQL} as constraint_score,
          ${finalScoreSQL} as final_score,
          ${dedupKeyExpr} as dedup_key
        FROM "Product" p
        WHERE ${whereConditions.join(' AND ')}
      ),
      deduplicated AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY dedup_key
            ORDER BY final_score DESC
          ) as dedup_rank
        FROM ranked_products
      )
      SELECT 
        id,
        title,
        description,
        category,
        subcategory,
        brand,
        "productUrl",
        "imageUrl",
        "priceCents",
        "salePriceCents",
        "stockStatus",
        attributes,
        embedding,
        vector_score as "vectorScore",
        constraint_score as "constraintScore",
        final_score as "finalScore"
      FROM deduplicated
      WHERE dedup_rank = 1
      ORDER BY final_score DESC
      LIMIT $${limitParamIndex}
    `;

    // Add limit param
    params.push(limit);

    logger.debug('searchVectorIndexWithRanking: executing query', {
      productIdsCount: productIds.length,
      limit,
      hasConstraints: !!constraints,
      paramCount: params.length,
    });

    const results = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      description: string | null;
      category: string;
      subcategory: string | null;
      brand: string | null;
      productUrl: string;
      imageUrl: string | null;
      priceCents: number;
      salePriceCents: number | null;
      stockStatus: string;
      attributes: unknown;
      embedding: unknown;
      vectorScore: number;
      constraintScore: number;
      finalScore: number;
    }>>(query, ...params);

    // Convert to SearchResultItem format
    const products: ProductWithScore[] = results.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
      category: row.category,
      subcategory: row.subcategory || undefined,
      brand: row.brand || undefined,
      productUrl: row.productUrl,
      imageUrl: row.imageUrl || '', // SearchResultItem requires string, not undefined
      priceCents: row.priceCents,
      salePriceCents: row.salePriceCents || undefined,
      currency: 'USD', // Default currency
      stockStatus: row.stockStatus as 'in_stock' | 'out_of_stock' | 'low_stock',
      attributes: row.attributes as SearchResultItem['attributes'],
      finalScore: row.finalScore,
      vectorScore: row.vectorScore,
      constraintScore: row.constraintScore,
    }));

    logger.info('searchVectorIndexWithRanking: results', {
      inputCount: productIds.length,
      outputCount: products.length,
      avgFinalScore: products.length > 0 
        ? products.reduce((sum, p) => sum + p.finalScore, 0) / products.length 
        : 0,
      avgConstraintScore: products.length > 0
        ? products.reduce((sum, p) => sum + p.constraintScore, 0) / products.length
        : 0,
    });

    return products;
  } catch (error) {
    logger.error('searchVectorIndexWithRanking: error', {
      error: error instanceof Error ? error.message : String(error),
      productIdsCount: productIds.length,
      limit,
    });
    throw error;
  }
}

