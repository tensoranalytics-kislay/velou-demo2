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
import { normalizeProductType } from '../../loccitane/normalization';
import { normalizeIngredientCanonical, normalizeConcernCanonical } from '../../loccitane/classifier';

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
    // Only select id and the structured attributes JSONB field (not entire attributes object)
    // This is much faster than loading full product records
    const query = merchantId
      ? `
        SELECT 
          p.id,
          p.attributes->'loccitaneStructured' as "loccitaneStructured"
        FROM "Product" p
        WHERE p."isActive" = true
          AND p."merchantId" = $1
          AND p.attributes->'loccitaneStructured' IS NOT NULL
      `
      : `
        SELECT 
          p.id,
          p.attributes->'loccitaneStructured' as "loccitaneStructured"
        FROM "Product" p
        WHERE p."isActive" = true
          AND p.attributes->'loccitaneStructured' IS NOT NULL
      `;
    
    const loadStart = Date.now();
    const products = await prisma.$queryRawUnsafe<Array<{
      id: string;
      loccitaneStructured: unknown;
    }>>(
      query,
      ...(merchantId ? [merchantId] : [])
    );
    const loadDuration = Date.now() - loadStart;
    
    logger.debug('buildConceptIndex: loading products', {
      merchantId,
      productCount: products.length,
      loadDurationMs: loadDuration,
      loadDurationSeconds: Math.round(loadDuration / 1000),
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
    const processStart = Date.now();
    let processedCount = 0;
    for (const product of products) {
      // Product already has loccitaneStructured extracted from SQL query
      const structured = product.loccitaneStructured as StructuredLoccitaneAttributes | null;
      if (!structured) continue;
      processedCount++;
      
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
    
    const processDuration = Date.now() - processStart;
    const totalDuration = Date.now() - loadStart;
    
    logger.info('buildConceptIndex: index built', {
      merchantId,
      productCount: products.length,
      processedCount,
      concernsCount: index.concerns.size,
      skinTypesCount: index.skinTypes.size,
      applicationAreasCount: index.applicationAreas.size,
      ingredientsCount: index.ingredients.size,
      madeWithoutCount: index.madeWithout.size,
      productTypesCount: index.productTypes.size,
      loadDurationMs: loadDuration,
      processDurationMs: processDuration,
      totalDurationMs: totalDuration,
      loadDurationSeconds: Math.round(loadDuration / 1000),
      processDurationSeconds: Math.round(processDuration / 1000),
      totalDurationSeconds: Math.round(totalDuration / 1000),
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
  const lookupResults: Array<{ type: string; key: string; normalizedKey: string; found: boolean; productCount: number }> = [];
  
  // Helper to add products from a map entry
  // CRITICAL: Normalize constraint values before lookup to handle misspellings intelligently
  const addFromIndex = (map: Map<string, Set<string>>, keys: string[], constraintType: string) => {
    for (const key of keys) {
      // Normalize the key based on constraint type to handle misspellings
      // This ensures "lavendar" -> "lavender_oil", "face creme" -> "face_moisturizer", etc.
      let normalizedKey: string;
      if (constraintType === 'ingredients' || constraintType === 'madeWithout') {
        normalizedKey = normalizeIngredientCanonical(key).toLowerCase().trim();
      } else if (constraintType === 'concerns') {
        normalizedKey = normalizeConcernCanonical(key).toLowerCase().trim();
      } else if (constraintType === 'productTypes') {
        normalizedKey = normalizeProductType(key).toLowerCase().trim();
      } else {
        // For other types, use basic normalization
        normalizedKey = key.toLowerCase().trim();
      }
      const productIds = map.get(normalizedKey);
      const found = !!productIds;
      const productCount = productIds?.size || 0;
      
      lookupResults.push({
        type: constraintType,
        key,
        normalizedKey,
        found,
        productCount,
      });
      
      if (productIds) {
        for (const productId of productIds) {
          candidateIds.add(productId);
        }
      } else {
        // Try fuzzy matching for close keys (handle variations and misspellings)
        // Uses comprehensive string similarity to catch ALL types of typos, not just known ones
        const normalizedKeyNoSpaces = normalizedKey.replace(/[_\s-]/g, '');
        
        // Enhanced Levenshtein distance calculation (handles insertions, deletions, substitutions, transpositions)
        const levenshteinDistance = (s1: string, s2: string): number => {
          const len1 = s1.length;
          const len2 = s2.length;
          if (len1 === 0) return len2;
          if (len2 === 0) return len1;
          
          // Create matrix
          const matrix: number[][] = [];
          for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
          }
          for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
          }
          
          // Fill matrix
          for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
              const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
              matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
              );
              
              // Handle transpositions (e.g., "teh" -> "the")
              if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
              }
            }
          }
          
          return matrix[len1][len2];
        };
        
        // Calculate normalized similarity ratio (0-1, where 1 is identical)
        const similarity = (s1: string, s2: string): number => {
          const maxLen = Math.max(s1.length, s2.length);
          if (maxLen === 0) return 1;
          const distance = levenshteinDistance(s1, s2);
          return 1 - (distance / maxLen);
        };
        
        const fuzzyMatches = Array.from(map.keys()).filter(k => {
          const kNoSpaces = k.replace(/[_\s-]/g, '');
          
          // 1. Exact substring matches
          if (k.includes(normalizedKey) || normalizedKey.includes(k)) return true;
          
          // 2. Space/underscore/hyphen variations (e.g., "hand_cream" vs "hand cream")
          if (kNoSpaces === normalizedKeyNoSpaces) return true;
          
          // 3. Partial word matches (e.g., "gift set" matches "gift", "face cream" matches "cream")
          const normalizedWords = normalizedKey.split(/\s+|_/).filter(w => w.length > 2);
          const kWords = k.split(/\s+|_/).filter(w => w.length > 2);
          if (normalizedWords.some(w => k.includes(w)) || kWords.some(w => normalizedKey.includes(w))) {
            return true;
          }
          
          // 4. Smart typo detection using Levenshtein distance
          // For similar length strings, check character-level similarity
          const lengthDiff = Math.abs(k.length - normalizedKey.length);
          
          // Allow up to 30% length difference for typo matching
          if (lengthDiff <= Math.max(3, Math.floor(Math.max(k.length, normalizedKey.length) * 0.3))) {
            // Calculate similarity
            const sim = similarity(normalizedKey, k);
            // Accept if similarity >= 0.75 (allows up to 25% difference)
            // This catches: "lavendar"->"lavender", "almond"->"almond", "shampoo"->"shampo", etc.
            if (sim >= 0.75) return true;
            
            // Also check without spaces/underscores (e.g., "handcream" vs "hand_cream")
            const simNoSpaces = similarity(normalizedKeyNoSpaces, kNoSpaces);
            if (simNoSpaces >= 0.75) return true;
          }
          
          // 5. For shorter keys, be more lenient with similarity (shorter words have fewer characters to differ)
          if (normalizedKey.length <= 8 && k.length <= 8) {
            const sim = similarity(normalizedKey, k);
            // More lenient threshold for short words (e.g., "oily" vs "oily", "dry" vs "dri")
            if (sim >= 0.67) return true;
            
            const simNoSpaces = similarity(normalizedKeyNoSpaces, kNoSpaces);
            if (simNoSpaces >= 0.67) return true;
          }
          
          return false;
        });
        
        // Use first fuzzy match if found
        if (fuzzyMatches.length > 0) {
          const matchedKey = fuzzyMatches[0];
          const matchedProductIds = map.get(matchedKey);
          if (matchedProductIds) {
            for (const productId of matchedProductIds) {
              candidateIds.add(productId);
            }
            lookupResults[lookupResults.length - 1].found = true;
            lookupResults[lookupResults.length - 1].productCount = matchedProductIds.size;
            lookupResults[lookupResults.length - 1].normalizedKey = `${normalizedKey} (fuzzy→${matchedKey})`;
            logger.debug('searchConceptIndex: using fuzzy match', {
              constraintType,
              originalKey: key,
              normalizedKey,
              matchedKey,
              productCount: matchedProductIds.size,
            });
          }
        }
        
        // Log when key not found (even after fuzzy matching)
        if (fuzzyMatches.length === 0) {
          const sampleKeys = Array.from(map.keys()).slice(0, 10);
          logger.debug('searchConceptIndex: key not found in index', {
            constraintType,
            originalKey: key,
            normalizedKey,
            indexSize: map.size,
            sampleKeysInIndex: sampleKeys,
            allKeysForType: constraintType === 'productTypes' ? Array.from(map.keys()).sort() : undefined,
          });
        }
      }
    }
  };
  
  // Collect product IDs from all matching constraints
  if (constraints.concerns?.length) {
    addFromIndex(index.concerns, constraints.concerns, 'concerns');
  }
  
  if (constraints.skinTypes?.length) {
    addFromIndex(index.skinTypes, constraints.skinTypes, 'skinTypes');
  }
  
  if (constraints.applicationAreas?.length) {
    addFromIndex(index.applicationAreas, constraints.applicationAreas, 'applicationAreas');
  }
  
  if (constraints.ingredients?.length) {
    addFromIndex(index.ingredients, constraints.ingredients, 'ingredients');
  }
  
  if (constraints.madeWithout?.length) {
    addFromIndex(index.madeWithout, constraints.madeWithout, 'madeWithout');
  }
  
  if (constraints.productTypes?.length) {
    addFromIndex(index.productTypes, constraints.productTypes, 'productTypes');
  }
  
  // Log summary of lookups
  const totalLookups = lookupResults.length;
  const successfulLookups = lookupResults.filter(r => r.found).length;
  const totalProductsFound = lookupResults.reduce((sum, r) => sum + r.productCount, 0);
  
  logger.debug('searchConceptIndex: lookup summary', {
    totalLookups,
    successfulLookups,
    failedLookups: totalLookups - successfulLookups,
    totalProductsFound,
    uniqueProductsAfterUnion: candidateIds.size,
    lookupDetails: lookupResults,
  });
  
  // Return sorted array for deterministic order
  return Array.from(candidateIds).sort();
}

