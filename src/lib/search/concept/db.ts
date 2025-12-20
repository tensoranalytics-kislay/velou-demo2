/**
 * Concept Index Database Search
 * 
 * Searches concept index directly from database using SQL queries.
 * This is faster than loading the full index into memory for large catalogs.
 */

import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';

export type FashionConceptConstraints = {
  styles?: string[] | null;
  occasions?: string[] | null;
  patterns?: string[] | null;
  materials?: string[] | null;
  collections?: string[] | null;
  lengths?: string[] | null;
  necklines?: string[] | null;
  sleeveLengths?: string[] | null;
  embellishments?: string[] | null;
  fits?: string[] | null;
};

/**
 * Search concept index directly from database
 * 
 * Uses SQL queries to find products matching fashion attributes.
 * Searches in the attributes JSONB field for matching values.
 * 
 * @param constraints - Fashion concept constraints
 * @param merchantId - Optional merchant ID to filter products
 * @returns Array of product IDs matching the constraints
 */
export async function searchConceptIndexFromDB(
  constraints: FashionConceptConstraints,
  merchantId?: string
): Promise<string[]> {
  const startTime = Date.now();
  
  try {
    // Build WHERE conditions for each constraint type
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Add merchant filter if provided
    if (merchantId) {
      conditions.push(`p."merchantId" = $${paramIndex}`);
      params.push(merchantId);
      paramIndex++;
    }

    // Add active product filter
    conditions.push(`p."isActive" = $${paramIndex}`);
    params.push(true);
    paramIndex++;

    // Build JSONB path queries for each constraint type
    // path uses -> (returns JSONB), textPath uses ->> (returns text) for comparisons
    const attributePaths = [
      { key: 'styles', path: 'attributes->\'Style\'', textPath: 'attributes->>\'Style\'' },
      { key: 'occasions', path: 'attributes->\'Occasion\'', textPath: 'attributes->>\'Occasion\'' },
      { key: 'patterns', path: 'attributes->\'Pattern\'', textPath: 'attributes->>\'Pattern\'' },
      { key: 'materials', path: 'attributes->\'Material\'', textPath: 'attributes->>\'Material\'' },
      { key: 'collections', path: 'attributes->\'Collection\'', textPath: 'attributes->>\'Collection\'' },
      { key: 'lengths', path: 'attributes->\'Length\'', textPath: 'attributes->>\'Length\'' },
      { key: 'necklines', path: 'attributes->\'Neckline\'', textPath: 'attributes->>\'Neckline\'' },
      { key: 'sleeveLengths', path: 'attributes->\'Sleeve Length\'', textPath: 'attributes->>\'Sleeve Length\'' },
      { key: 'embellishments', path: 'attributes->\'Embellishment\'', textPath: 'attributes->>\'Embellishment\'' },
      { key: 'fits', path: 'attributes->\'Fit\'', textPath: 'attributes->>\'Fit\'' },
    ];

    const constraintConditions: string[] = [];

    for (const { key, path, textPath } of attributePaths) {
      const values = constraints[key as keyof FashionConceptConstraints];
      if (values && Array.isArray(values) && values.length > 0) {
        // Handle array values in JSONB - check if any value in the array matches
        // CRITICAL: Check if the field is an array before trying to extract elements
        // If it's a scalar (string), jsonb_array_elements_text will fail
        const valueConditions = values.map((value, idx) => {
          const param = `$${paramIndex}`;
          paramIndex++;
          params.push(value);
          // Check if the JSONB field contains the value (handles both string and array)
          // Use textPath (->>) for text comparisons, path (->) for array extraction
          // Only use jsonb_array_elements_text if the field is actually an array
          return `(
            ${textPath} = ${param} OR
            ${textPath} LIKE ${param} || '%' OR
            ${textPath} LIKE '%' || ${param} || '%' OR
            (
              jsonb_typeof(${path}) = 'array' AND
              EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(${path}) AS elem
                WHERE elem = ${param}
              )
            )
          )`;
        });
        constraintConditions.push(`(${valueConditions.join(' OR ')})`);
      }
    }

    // If we have constraint conditions, add them
    if (constraintConditions.length > 0) {
      conditions.push(`(${constraintConditions.join(' OR ')})`);
      
      logger.info('searchConceptIndexFromDB: constraint_conditions', {
        merchantId,
        constraintCount: constraintConditions.length,
        constraints: Object.keys(constraints).filter(k => {
          const val = constraints[k as keyof FashionConceptConstraints];
          return val && Array.isArray(val) && val.length > 0;
        }),
        constraintValues: {
          patterns: constraints.patterns,
          styles: constraints.styles,
          occasions: constraints.occasions,
          materials: constraints.materials,
        },
        sqlConditions: constraintConditions,
        params: params.slice(0, 5), // First 5 params for debugging
      });
    } else {
      // No constraints - return empty array
      logger.debug('searchConceptIndexFromDB: no constraints provided', {
        merchantId,
      });
      return [];
    }

    // Build final query
    const query = `
      SELECT DISTINCT p.id
      FROM "Product" p
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.id
    `;

    logger.debug('searchConceptIndexFromDB: executing query', {
      merchantId,
      constraintCount: constraintConditions.length,
      query: query.substring(0, 200),
    });

    const results = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      query,
      ...params
    );

    const productIds = results.map(r => r.id);
    const duration = Date.now() - startTime;

    logger.debug('searchConceptIndexFromDB: complete', {
      merchantId,
      productCount: productIds.length,
      durationMs: duration,
    });

    return productIds;
  } catch (error) {
    logger.error('searchConceptIndexFromDB: failed', {
      error: error instanceof Error ? error.message : String(error),
      merchantId,
    });
    throw error;
  }
}
