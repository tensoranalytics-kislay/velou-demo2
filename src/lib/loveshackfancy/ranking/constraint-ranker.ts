/**
 * Constraint-Based Ranking
 * 
 * Ranks products using weighted constraint matching instead of hard filtering.
 * This prevents over-filtering while ensuring products that match constraints
 * rank higher.
 */

import type { SearchResultItem } from '../../search/types';
import type { FashionConstraints } from '../classifier';
import { calculateConstraintMatchScore, type QueryContext, matchColor, matchMaterial, matchOccasion, matchPattern, matchSize, matchSeason, matchFit, matchCollection, matchAgeGroup, matchFormalityLevel, matchStyle } from './constraint-matcher';
import type { EnrichedColumnValues } from '../../search/filtering/attributes';
import type { ProductAttributes } from '../../search/types';
import { logger } from '../../telemetry/logger';
import { extractConstraintValues, extractConstraintIntent } from '../constraint-utils';

/**
 * Extract attribute value (handles both string and array formats)
 * Helper function for filtering logic
 */
function extractAttrValue(attrs: ProductAttributes | null | undefined, key: string): string | string[] | undefined {
  if (!attrs) return undefined;
  
  // Try capitalized key first (most common in LoveShackFancy: "Color", "Occasion", "Style")
  const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
  const capitalizedValue = (attrs as any)[capitalizedKey];
  if (capitalizedValue !== undefined && capitalizedValue !== null) {
    return Array.isArray(capitalizedValue) ? capitalizedValue : [capitalizedValue];
  }
  
  // Try direct key (as-is)
  const directValue = (attrs as any)[key];
  if (directValue !== undefined && directValue !== null) {
    return Array.isArray(directValue) ? directValue : [directValue];
  }
  
  // Try lowercase key
  const lowercaseKey = key.toLowerCase();
  const lowercaseValue = (attrs as any)[lowercaseKey];
  if (lowercaseValue !== undefined && lowercaseValue !== null) {
    return Array.isArray(lowercaseValue) ? lowercaseValue : [lowercaseValue];
  }
  
  // Try underscore-separated key
  const underscoreKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  const underscoreValue = (attrs as any)[underscoreKey];
  if (underscoreValue !== undefined && underscoreValue !== null) {
    return Array.isArray(underscoreValue) ? underscoreValue : [underscoreValue];
  }
  
  // Try extensible attributes (nested structure)
  const extensible = (attrs as any).extensible;
  if (extensible && typeof extensible === 'object') {
    if (extensible[capitalizedKey] !== undefined && extensible[capitalizedKey] !== null) {
      const extValue = extensible[capitalizedKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    if (extensible[key] !== undefined && extensible[key] !== null) {
      const extValue = extensible[key];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    if (extensible[lowercaseKey] !== undefined && extensible[lowercaseKey] !== null) {
      const extValue = extensible[lowercaseKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    if (extensible[underscoreKey] !== undefined && extensible[underscoreKey] !== null) {
      const extValue = extensible[underscoreKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
  }
  
  return undefined;
}

/**
 * Normalize string for comparison (lowercase, trim)
 */
function normalize(str: string): string {
  return str.toLowerCase().trim();
}

/**
 * Check if a value matches any of the query values (fuzzy matching)
 * Returns confidence score 0-1
 */
function fuzzyMatch(
  productValue: string | string[] | undefined,
  queryValues: string[]
): number {
  if (!productValue || queryValues.length === 0) return 0;
  
  const productValues = Array.isArray(productValue) ? productValue : [productValue];
  const normalizedQuery = queryValues.map(normalize);
  
  // Check for exact matches first (highest confidence)
  for (const pv of productValues) {
    const normalizedPv = normalize(String(pv));
    for (const qv of normalizedQuery) {
      if (normalizedPv === qv) {
        return 1.0; // Exact match
      }
      // Check if product value contains query value or vice versa
      if (normalizedPv.includes(qv) || qv.includes(normalizedPv)) {
        return 0.8; // Partial match
      }
    }
  }
  
  return 0;
}

export type ProductWithVectorScore = {
  product: SearchResultItem;
  vectorScore: number; // Vector similarity score (0-1)
};

export type ProductWithFinalScore = {
  product: SearchResultItem;
  finalScore: number; // Final score after constraint boost
  constraintScore: number; // Constraint match score (0-1)
};

/**
 * Rank products using constraint-based weighted scoring
 * 
 * Combines vector similarity with constraint matching:
 * - Base score: vector similarity (0-1)
 * - Constraint boost: weighted constraint match scores
 * - Final score: baseScore + (constraintBoost × maxBoostFactor)
 * 
 * This ensures:
 * - Products that match constraints rank higher
 * - Products without constraint matches still appear (no hard filtering)
 * - Constraint boost is capped to prevent over-weighting
 * 
 * @param products - Products with their vector similarity scores
 * @param constraints - Query constraints to match against
 * @param maxConstraintBoost - Maximum boost factor for constraints (default 0.6 = 60% of base score)
 * @param queryContext - Optional query context for dynamic weight adjustment
 * @returns Products ranked by final score (descending)
 */
export async function rankWithConstraints(
  products: ProductWithVectorScore[],
  constraints: FashionConstraints,
  maxConstraintBoost: number = 0.6,
  queryContext?: QueryContext
): Promise<ProductWithFinalScore[]> {
  if (products.length === 0) return [];
  
  // Check if we have any constraints to match
  const hasConstraints = Object.values(constraints).some(
    v => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  );
  
  if (!hasConstraints) {
    // No constraints, just use vector scores
    return products.map(p => ({
      product: p.product,
      finalScore: p.vectorScore,
      constraintScore: 0,
    }));
  }
  
  // PHASE 1: Hard filter products matching excluded constraints BEFORE scoring
  // Extract enriched columns for all products to use in filtering
  const productsWithEnriched = products.map(({ product }) => {
    const enrichedColumns: EnrichedColumnValues = {
      color: product.color ?? null,
      fabric: product.fabric ?? null,
      material: product.material ?? null,
      occasion: product.occasion ?? null,
      season: product.season ?? null,
      fit: product.fit ?? null,
      length: product.length ?? null,
      sleeve: product.sleeve ?? null,
      neckline: product.neckline ?? null,
      formalityLevel: product.formalityLevel ?? null,
      temperatureIntent: product.temperatureIntent ?? null,
      humidityFriendly: product.humidityFriendly ?? null,
      occasionContext: product.occasionContext ?? null,
      problemSolutions: product.problemSolutions ?? null,
      functionFeatures: product.functionFeatures ?? null,
      colorShade: product.colorShade ?? null,
      colorUndertone: product.colorUndertone ?? null,
      multicolor: product.multicolor ?? null,
      seasonalPalette: product.seasonalPalette ?? null,
      enrichedColor: product.enrichedColor ?? null,
      ageGroup: product.ageGroup ?? null,
    };
    return { product, enrichedColumns };
  });
  
  // Filter out products that match excluded constraints
  const filteredProductsWithEnriched = productsWithEnriched.filter(({ product, enrichedColumns }) => {
    const attrs = product.attributes;
    
    // Check each constraint type for excluded intent
    // Colors
    if (constraints.colors) {
      const intent = extractConstraintIntent(constraints.colors);
      if (intent === 'excluded') {
        const excludedColors = extractConstraintValues(constraints.colors) || [];
        if (excludedColors.length > 0) {
          const matchScore = matchColor(attrs, excludedColors, enrichedColumns);
          if (matchScore > 0) {
            return false; // Filter out - product matches excluded color
          }
        }
      }
    }
    
    // Materials
    if (constraints.materials) {
      const intent = extractConstraintIntent(constraints.materials);
      if (intent === 'excluded') {
        const excludedMaterials = extractConstraintValues(constraints.materials) || [];
        if (excludedMaterials.length > 0) {
          const matchScore = matchMaterial(attrs, excludedMaterials);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Patterns
    if (constraints.patterns) {
      const intent = extractConstraintIntent(constraints.patterns);
      if (intent === 'excluded') {
        const excludedPatterns = extractConstraintValues(constraints.patterns) || [];
        if (excludedPatterns.length > 0) {
          const matchScore = matchPattern(attrs, excludedPatterns);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Occasions
    if (constraints.occasions) {
      const intent = extractConstraintIntent(constraints.occasions);
      if (intent === 'excluded') {
        const excludedOccasions = extractConstraintValues(constraints.occasions) || [];
        if (excludedOccasions.length > 0) {
          const matchScore = matchOccasion(attrs, excludedOccasions, { 
            title: product.title, 
            description: product.description, 
            category: product.category, 
            subcategory: product.subcategory || undefined,
            attributes: product.attributes 
          }, enrichedColumns);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Sizes
    if (constraints.sizes) {
      const intent = extractConstraintIntent(constraints.sizes);
      if (intent === 'excluded') {
        const excludedSizes = extractConstraintValues(constraints.sizes) || [];
        if (excludedSizes.length > 0) {
          const matchScore = matchSize(attrs, excludedSizes);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Seasons
    if (constraints.seasons) {
      const intent = extractConstraintIntent(constraints.seasons);
      if (intent === 'excluded') {
        const excludedSeasons = extractConstraintValues(constraints.seasons) || [];
        if (excludedSeasons.length > 0) {
          const matchScore = matchSeason(attrs, excludedSeasons, enrichedColumns);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Fits
    if (constraints.fits) {
      const intent = extractConstraintIntent(constraints.fits);
      if (intent === 'excluded') {
        const excludedFits = extractConstraintValues(constraints.fits) || [];
        if (excludedFits.length > 0) {
          const matchScore = matchFit(attrs, excludedFits, enrichedColumns);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Lengths (use fuzzyMatch pattern from constraint-matcher)
    if (constraints.lengths) {
      const intent = extractConstraintIntent(constraints.lengths);
      if (intent === 'excluded') {
        const excludedLengths = extractConstraintValues(constraints.lengths) || [];
        if (excludedLengths.length > 0) {
          const dbLength = enrichedColumns?.length ?? null;
          const attrLength = extractAttrValue(attrs, 'length') || extractAttrValue(attrs, 'Length');
          const finalLength = dbLength || attrLength;
          if (finalLength) {
            const matchScore = fuzzyMatch(finalLength, excludedLengths);
            if (matchScore > 0) {
              return false; // Filter out
            }
          }
        }
      }
    }
    
    // Styles (use matchStyle pattern)
    if (constraints.styles) {
      const intent = extractConstraintIntent(constraints.styles);
      if (intent === 'excluded') {
        const excludedStyles = extractConstraintValues(constraints.styles) || [];
        if (excludedStyles.length > 0) {
          const matchScore = matchStyle(attrs, excludedStyles, { 
            title: product.title, 
            description: product.description, 
            category: product.category, 
            subcategory: product.subcategory || undefined,
            attributes: product.attributes 
          });
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Collections
    if (constraints.collections) {
      const intent = extractConstraintIntent(constraints.collections);
      if (intent === 'excluded') {
        const excludedCollections = extractConstraintValues(constraints.collections) || [];
        if (excludedCollections.length > 0) {
          const matchScore = matchCollection(attrs, excludedCollections);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    // Necklines (use fuzzyMatch pattern)
    if (constraints.necklines) {
      const intent = extractConstraintIntent(constraints.necklines);
      if (intent === 'excluded') {
        const excludedNecklines = extractConstraintValues(constraints.necklines) || [];
        if (excludedNecklines.length > 0) {
          const dbNeckline = enrichedColumns?.neckline ?? null;
          const attrNeckline = extractAttrValue(attrs, 'neckline') || extractAttrValue(attrs, 'Neckline');
          const finalNeckline = dbNeckline || attrNeckline;
          if (finalNeckline) {
            const matchScore = fuzzyMatch(finalNeckline, excludedNecklines);
            if (matchScore > 0) {
              return false; // Filter out
            }
          }
        }
      }
    }
    
    // SleeveLengths (use fuzzyMatch pattern)
    if (constraints.sleeveLengths) {
      const intent = extractConstraintIntent(constraints.sleeveLengths);
      if (intent === 'excluded') {
        const excludedSleeveLengths = extractConstraintValues(constraints.sleeveLengths) || [];
        if (excludedSleeveLengths.length > 0) {
          const dbSleeve = enrichedColumns?.sleeve ?? null;
          const attrSleeveLength = extractAttrValue(attrs, 'sleeveLength') || extractAttrValue(attrs, 'Sleeve Length') || extractAttrValue(attrs, 'sleeve');
          const finalSleeveLength = dbSleeve || attrSleeveLength;
          if (finalSleeveLength) {
            const matchScore = fuzzyMatch(finalSleeveLength, excludedSleeveLengths);
            if (matchScore > 0) {
              return false; // Filter out
            }
          }
        }
      }
    }
    
    // FormalityLevel
    if (constraints.formalityLevel) {
      const intent = extractConstraintIntent(constraints.formalityLevel);
      if (intent === 'excluded') {
        const excludedFormalityLevels = extractConstraintValues(constraints.formalityLevel) || [];
        if (excludedFormalityLevels.length > 0) {
          // Extract formalityLevel from product (database column or attributes)
          const dbFormalityLevel = enrichedColumns?.formalityLevel ?? null;
          const attrFormalityLevel = extractAttrValue(attrs, 'formalityLevel') || extractAttrValue(attrs, 'FormalityLevel');
          const finalFormalityLevel = dbFormalityLevel || attrFormalityLevel;
          if (finalFormalityLevel) {
            const matchScore = matchFormalityLevel(finalFormalityLevel, excludedFormalityLevels);
            if (matchScore > 0) {
              return false; // Filter out
            }
          }
        }
      }
    }
    
    // AgeGroups
    if (constraints.ageGroups) {
      const intent = extractConstraintIntent(constraints.ageGroups);
      if (intent === 'excluded') {
        const excludedAgeGroups = extractConstraintValues(constraints.ageGroups) || [];
        if (excludedAgeGroups.length > 0) {
          const matchScore = matchAgeGroup(product, excludedAgeGroups, enrichedColumns);
          if (matchScore > 0) {
            return false; // Filter out
          }
        }
      }
    }
    
    return true; // Keep product if no excluded matches
  });
  
  // Convert back to ProductWithVectorScore format
  const filteredProducts = filteredProductsWithEnriched.map(({ product }) => {
    const original = products.find(p => p.product.id === product.id);
    return original || { product, vectorScore: 0 };
  });
  
  // Log filtering results
  const filteredCount = products.length - filteredProducts.length;
  if (filteredCount > 0) {
    logger.info('excluded_constraints_hard_filtered', {
      originalCount: products.length,
      filteredCount: filteredProducts.length,
      removedCount: filteredCount,
      note: 'Products matching excluded constraints were hard filtered out',
    });
  }
  
  // Calculate constraint match scores first (to determine dynamic boost)
  // Using Promise.all() to allow event loop interleaving for better responsiveness
  const productsWithConstraintScores = await Promise.all(
    filteredProducts.map(async ({ product, vectorScore }) => {
      // Extract enriched columns from SearchResultItem for constraint matching
      // Extract ALL database columns first, then fallback to JSONB attributes
      const enrichedColumns: EnrichedColumnValues = {
        // Core indexed columns
        color: product.color ?? null,
        fabric: product.fabric ?? null,
        material: product.material ?? null,
        occasion: product.occasion ?? null,
        season: product.season ?? null,
        fit: product.fit ?? null,
        
        // Enriched attributes
        length: product.length ?? null,
        sleeve: product.sleeve ?? null,
        neckline: product.neckline ?? null,
        formalityLevel: product.formalityLevel ?? null,
        temperatureIntent: product.temperatureIntent ?? null,
        humidityFriendly: product.humidityFriendly ?? null,
        occasionContext: product.occasionContext ?? null,
        problemSolutions: product.problemSolutions ?? null,
        functionFeatures: product.functionFeatures ?? null,
        colorShade: product.colorShade ?? null,
        colorUndertone: product.colorUndertone ?? null,
        multicolor: product.multicolor ?? null,
        seasonalPalette: product.seasonalPalette ?? null,
        enrichedColor: product.enrichedColor ?? null,
        ageGroup: product.ageGroup ?? null,
      };
      
      // Calculate constraint score (synchronous, but wrapped in Promise for parallel processing)
      const constraintScore = calculateConstraintMatchScore(
        product, // Pass full product object so ageGroup can be inferred from title/description
        constraints,
        queryContext, // Pass query context for dynamic weight adjustment
        enrichedColumns // Pass enriched columns for database column matching (occasion, occasionContext, etc.)
      );
      
      return {
        product,
        vectorScore,
        constraintScore,
      };
    })
  );
  
  // Calculate average constraint score to determine dynamic boost
  const avgConstraintScore = productsWithConstraintScores.reduce((sum, p) => sum + p.constraintScore, 0) / productsWithConstraintScores.length;
  const minConstraintScore = Math.min(...productsWithConstraintScores.map(p => p.constraintScore));
  const maxConstraintScore = Math.max(...productsWithConstraintScores.map(p => p.constraintScore));
  
  // Dynamic boost: higher boost (0.8) if constraints match well, lower boost (0.4) if they don't
  // This allows good constraint matches to outrank pure vector similarity
  const effectiveBoost = avgConstraintScore > 0.3 ? 0.8 : 0.4;
  
  // Calculate final scores with dynamic boost
  const productsWithScores: ProductWithFinalScore[] = productsWithConstraintScores.map(({ product, vectorScore, constraintScore }) => {
    // Calculate constraint boost using dynamic effective boost
    const constraintBoost = constraintScore * effectiveBoost;
    
    // Final score: base vector score + constraint boost
    // This ensures products matching constraints rank higher, but don't completely
    // dominate if they have low vector similarity
    const finalScore = Math.min(1.0, vectorScore + constraintBoost);
    
    return {
      product,
      finalScore,
      constraintScore,
    };
  });
  
  // Sort by final score (descending)
  productsWithScores.sort((a, b) => b.finalScore - a.finalScore);
  
  // Log top 5 products with detailed scores
  const topProducts = productsWithScores.slice(0, 5).map((p, idx) => ({
    rank: idx + 1,
    productId: p.product.id,
    productTitle: p.product.title?.substring(0, 80),
    vectorScore: productsWithConstraintScores.find(pc => pc.product.id === p.product.id)?.vectorScore || 0,
    constraintScore: p.constraintScore,
    constraintBoost: p.constraintScore * effectiveBoost,
    finalScore: p.finalScore,
  }));
  
  logger.info('constraint_ranking_applied', {
    productCount: productsWithScores.length,
    avgConstraintScore,
    minConstraintScore,
    maxConstraintScore,
    effectiveBoost,
    avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.finalScore, 0) / productsWithScores.length,
    topFinalScore: productsWithScores[0]?.finalScore,
    constraintFields: Object.keys(constraints).filter(k => constraints[k as keyof FashionConstraints] !== null && constraints[k as keyof FashionConstraints] !== undefined),
    topProducts,
    constraintValues: {
      colors: constraints.colors,
      patterns: constraints.patterns,
      occasions: constraints.occasions,
      materials: constraints.materials,
      sizes: constraints.sizes,
      ageGroups: constraints.ageGroups,
      priceMinCents: constraints.priceMinCents,
      priceMaxCents: constraints.priceMaxCents,
    },
  });
  
  logger.debug('constraint_ranking_applied', {
    productCount: productsWithScores.length,
    avgConstraintScore,
    effectiveBoost,
    avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.finalScore, 0) / productsWithScores.length,
    topFinalScore: productsWithScores[0]?.finalScore,
    constraintFields: Object.keys(constraints).filter(k => constraints[k as keyof FashionConstraints] !== null && constraints[k as keyof FashionConstraints] !== undefined),
  });
  
  return productsWithScores;
}
