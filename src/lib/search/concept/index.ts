/**
 * Concept Index - In-Memory Inverted Index
 * 
 * Builds an in-memory inverted index from StructuredLoccitaneAttributes
 * for fast concept-based product retrieval.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 1.2)
 */

import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';
import type { StructuredLoccitaneAttributes } from '../../loccitane/attributeParser';

export type ConceptIndex = {
  concerns: Map<string, Set<string>>; // canonical concern -> Set<productId>
  skinTypes: Map<string, Set<string>>; // skin type -> Set<productId>
  applicationAreas: Map<string, Set<string>>; // application area -> Set<productId>
  ingredients: Map<string, Set<string>>; // canonical ingredient -> Set<productId>
  madeWithout: Map<string, Set<string>>; // made without -> Set<productId>
  productTypes: Map<string, Set<string>>; // product type -> Set<productId>
};

/**
 * Build concept index from all L'Occitane products for a merchant
 * 
 * Loads products with loccitaneStructured attributes and builds
 * inverted index maps for fast concept-based lookup.
 * 
 * @param merchantId - Optional merchant ID to filter products. If not provided, loads all products.
 * @returns ConceptIndex with inverted index maps
 */
export async function buildConceptIndex(merchantId?: string): Promise<ConceptIndex> {
  const index: ConceptIndex = {
    concerns: new Map(),
    skinTypes: new Map(),
    applicationAreas: new Map(),
    ingredients: new Map(),
    madeWithout: new Map(),
    productTypes: new Map(),
  };
  
  try {
    // Use raw SQL to query for products with loccitaneStructured attributes
    // Prisma's JSONB querying can be complex, so we use SQL for clarity
    const query = merchantId
      ? `
        SELECT 
          p.id,
          p.attributes
        FROM "Product" p
        WHERE p."isActive" = true
          AND p."merchantId" = $1
          AND p.attributes->'loccitaneStructured' IS NOT NULL
      `
      : `
        SELECT 
          p.id,
          p.attributes
        FROM "Product" p
        WHERE p."isActive" = true
          AND p.attributes->'loccitaneStructured' IS NOT NULL
      `;
    
    const products = await prisma.$queryRawUnsafe<Array<{
      id: string;
      attributes: unknown;
    }>>(
      query,
      ...(merchantId ? [merchantId] : [])
    );
    
    logger.debug('buildConceptIndex: loading products', {
      merchantId,
      productCount: products.length,
    });
    
    // Helper to add product ID to a map entry
    const addToIndex = (map: Map<string, Set<string>>, key: string, productId: string) => {
      const normalizedKey = key.toLowerCase().trim();
      if (!normalizedKey) return;
      
      if (!map.has(normalizedKey)) {
        map.set(normalizedKey, new Set());
      }
      map.get(normalizedKey)!.add(productId);
    };
    
    // Process each product
    for (const product of products) {
      const attrs = product.attributes as { loccitaneStructured?: StructuredLoccitaneAttributes } | null;
      if (!attrs?.loccitaneStructured) continue;
      
      const structured = attrs.loccitaneStructured;
      
      // Index canonical concerns
      for (const concern of structured.canonicalConcerns) {
        addToIndex(index.concerns, concern, product.id);
      }
      
      // Index skin types
      for (const skinType of structured.skinTypes) {
        addToIndex(index.skinTypes, skinType, product.id);
      }
      
      // Index hair types (we don't have a separate map, but could add if needed)
      
      // Index application areas
      for (const area of structured.applicationAreas) {
        addToIndex(index.applicationAreas, area, product.id);
      }
      
      // Index canonical ingredients
      for (const ingredient of structured.canonicalIngredients) {
        addToIndex(index.ingredients, ingredient, product.id);
      }
      
      // Index made without
      for (const madeWithout of structured.madeWithout) {
        addToIndex(index.madeWithout, madeWithout, product.id);
      }
      
      // Index product type
      if (structured.productType) {
        addToIndex(index.productTypes, structured.productType, product.id);
      }
    }
    
    logger.info('buildConceptIndex: index built', {
      merchantId,
      productCount: products.length,
      concernsCount: index.concerns.size,
      skinTypesCount: index.skinTypes.size,
      applicationAreasCount: index.applicationAreas.size,
      ingredientsCount: index.ingredients.size,
      madeWithoutCount: index.madeWithout.size,
      productTypesCount: index.productTypes.size,
    });
    
    return index;
  } catch (error) {
    logger.error('buildConceptIndex: error building index', {
      error: error instanceof Error ? error.message : String(error),
      merchantId,
    });
    throw error;
  }
}

/**
 * Search concept index by constraints
 * 
 * Returns union of product IDs matching any of the provided constraints.
 * Product IDs are returned in deterministic order (sorted) for consistency.
 * 
 * @param index - The concept index to search
 * @param constraints - Search constraints
 * @returns Array of product IDs (sorted, deterministic order)
 */
export function searchConceptIndex(
  index: ConceptIndex,
  constraints: {
    concerns?: string[];
    skinTypes?: string[];
    applicationAreas?: string[];
    ingredients?: string[];
    madeWithout?: string[];
    productTypes?: string[];
  }
): string[] {
  const candidateIds = new Set<string>();
  
  // Helper to add products from a map entry
  const addFromIndex = (map: Map<string, Set<string>>, keys: string[]) => {
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().trim();
      const productIds = map.get(normalizedKey);
      if (productIds) {
        for (const productId of productIds) {
          candidateIds.add(productId);
        }
      }
    }
  };
  
  // Collect product IDs from all matching constraints
  if (constraints.concerns?.length) {
    addFromIndex(index.concerns, constraints.concerns);
  }
  
  if (constraints.skinTypes?.length) {
    addFromIndex(index.skinTypes, constraints.skinTypes);
  }
  
  if (constraints.applicationAreas?.length) {
    addFromIndex(index.applicationAreas, constraints.applicationAreas);
  }
  
  if (constraints.ingredients?.length) {
    addFromIndex(index.ingredients, constraints.ingredients);
  }
  
  if (constraints.madeWithout?.length) {
    addFromIndex(index.madeWithout, constraints.madeWithout);
  }
  
  if (constraints.productTypes?.length) {
    addFromIndex(index.productTypes, constraints.productTypes);
  }
  
  // Return sorted array for deterministic order
  return Array.from(candidateIds).sort();
}

