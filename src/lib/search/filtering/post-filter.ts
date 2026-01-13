/**
 * Post-SQL Filtering
 * 
 * Applies filters using category-specific dictionaries built from category-filtered product sets.
 * This ensures filters only use values that actually exist in the filtered category.
 */

import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';
import type { CategoryDictionary, CategoryDictionaryMap } from './category-dictionaries';
import { extractConstraintValues, type ConstraintIntent } from '../../loveshackfancy/constraint-utils';

/**
 * Normalize a value for matching (lowercase, trim)
 */
function normalizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().trim();
}

/**
 * Fashion synonym mappings for attribute matching
 * Maps query terms to their equivalent product attribute values
 */
const FASHION_SYNONYMS: Record<string, string[]> = {
  // Sleeve synonyms
  'full': ['long'],
  'full sleeve': ['long'],
  'full sleeves': ['long'],
  'long': ['full'], // Bidirectional
  'long sleeve': ['full'],
  'long sleeves': ['full'],
};

/**
 * Get synonyms for a given value
 */
function getSynonyms(value: string): string[] {
  const normalized = normalizeValue(value);
  if (!normalized) return [];
  
  const synonyms = FASHION_SYNONYMS[normalized] || [];
  return synonyms;
}

/**
 * Match a single attribute value against query values using dictionary
 */
function matchAttributeValue(
  productValue: string | null,
  queryValues: string[],
  dictionary: Set<string>
): boolean {
  if (!productValue || queryValues.length === 0) return false;
  
  const normalizedProductValue = normalizeValue(productValue);
  if (!normalizedProductValue) return false;
  
  // Normalize query values
  const normalizedQueryValues = queryValues.map(normalizeValue).filter(Boolean) as string[];
  
  // Check if product value matches any query value (exact or partial)
  for (const queryValue of normalizedQueryValues) {
    // Exact match
    if (normalizedProductValue === queryValue) return true;
    
    // Check synonyms - if query value has synonyms, check if product value matches any synonym
    const querySynonyms = getSynonyms(queryValue);
    for (const synonym of querySynonyms) {
      if (normalizedProductValue === synonym) {
        // Validate that the synonym exists in dictionary
        if (dictionary.has(synonym)) return true;
      }
    }
    
    // Check if product value has synonyms that match query value
    const productSynonyms = getSynonyms(normalizedProductValue);
    for (const synonym of productSynonyms) {
      if (queryValue === synonym) {
        // Validate that the synonym exists in dictionary
        if (dictionary.has(synonym)) return true;
      }
    }
    
    // Partial match (contains)
    if (normalizedProductValue.includes(queryValue) || queryValue.includes(normalizedProductValue)) {
      // Validate against dictionary - only match if similar value exists in dictionary
      // This prevents false positives from partial matches on unrelated values
      const hasSimilarInDictionary = Array.from(dictionary).some(dictValue => 
        dictValue.includes(queryValue) || queryValue.includes(dictValue) ||
        normalizedProductValue.includes(dictValue) || dictValue.includes(normalizedProductValue)
      );
      if (hasSimilarInDictionary) return true;
    }
  }
  
  return false;
}

/**
 * Match color values (handles comma-separated enrichedColor)
 */
function matchColorValue(
  enrichedColor: string | null,
  color: string | null,
  queryValues: string[],
  dictionary: Set<string>
): boolean {
  if (queryValues.length === 0) return false;
  
  // Normalize query values
  const normalizedQueryValues = queryValues.map(normalizeValue).filter(Boolean) as string[];
  
  // Check enrichedColor (comma-separated)
  if (enrichedColor) {
    const enrichedTerms = enrichedColor
      .split(',')
      .map(term => normalizeValue(term))
      .filter(Boolean) as string[];
    
    for (const term of enrichedTerms) {
      for (const queryValue of normalizedQueryValues) {
        // Exact match
        if (term === queryValue) return true;
        
        // Partial match
        if (term.includes(queryValue) || queryValue.includes(term)) {
          // Validate against dictionary
          const hasSimilarInDictionary = Array.from(dictionary).some(dictValue => 
            dictValue.includes(queryValue) || queryValue.includes(dictValue) ||
            term.includes(dictValue) || dictValue.includes(term)
          );
          if (hasSimilarInDictionary) return true;
        }
      }
    }
  }
  
  // Check color column (fallback)
  if (color) {
    return matchAttributeValue(color, queryValues, dictionary);
  }
  
  return false;
}

/**
 * Map sleeveLengths constraint values to sleeve column values
 * Example: "Short Sleeve" → "Short", "Long Sleeve" → "Long", "Sleeveless" → "Sleeveless"
 */
function mapSleeveLengthsToSleeves(sleeveLengths: string[]): string[] {
  const sleeveMapping: Record<string, string> = {
    'short sleeve': 'short',
    'long sleeve': 'long',
    'full sleeve': 'long',
    'full sleeves': 'long',
    'full': 'long',
    'three-quarter sleeve': 'three-quarter',
    'three quarter sleeve': 'three-quarter',
    'cap sleeve': 'short',
    'flutter sleeve': 'short',
    'sleeveless': 'sleeveless',
    'no sleeve': 'sleeveless',
    'off shoulder': 'sleeveless',
    'strapless': 'sleeveless',
  };
  
  return sleeveLengths.map(length => {
    const normalized = normalizeValue(length);
    if (!normalized) return length;
    
    // Check mapping
    const mapped = sleeveMapping[normalized];
    if (mapped) return mapped;
    
    // If no mapping, try to extract base term (e.g., "Short Sleeve" → "Short")
    const words = normalized.split(/\s+/);
    if (words.length > 1 && words[words.length - 1] === 'sleeve') {
      return words.slice(0, -1).join(' ');
    }
    
    // Return original if no mapping found
    return normalized;
  });
}

/**
 * Apply post-SQL filters using category-specific dictionaries
 * 
 * @param productIds - Array of product IDs from category-filtered set
 * @param filters - Filter values to apply
 * @param filterIntents - Optional intent information for each filter (if not provided, defaults to 'required' for backward compatibility)
 * @param categoryDictionaries - Category-specific dictionaries
 * @returns Array of product IDs that match all specified filters
 */
export async function applyPostSQLFilters(
  productIds: string[],
  filters: {
    colors?: string[];
    lengths?: string[];
    sleeves?: string[];  // Maps from sleeveLengths constraint
    necklines?: string[];
    formalityLevels?: string[];
    colorShades?: string[];
  },
  categoryDictionaries: CategoryDictionaryMap,
  filterIntents?: {  // NEW: Optional intent information (moved after required parameter)
    colors?: ConstraintIntent | null;
    lengths?: ConstraintIntent | null;
    sleeves?: ConstraintIntent | null;
    necklines?: ConstraintIntent | null;
    formalityLevels?: ConstraintIntent | null;
    colorShades?: ConstraintIntent | null;
  }
): Promise<string[]> {
  if (!productIds || productIds.length === 0) {
    return [];
  }
  
  if (!categoryDictionaries || categoryDictionaries.size === 0) {
    logger.warn('applyPostSQLFilters: no category dictionaries provided, returning all product IDs');
    return productIds;
  }
  
  // If no filters provided, return all product IDs
  const hasFilters = filters.colors?.length || filters.lengths?.length || filters.sleeves?.length ||
    filters.necklines?.length || filters.formalityLevels?.length || filters.colorShades?.length;
  
  if (!hasFilters) {
    return productIds;
  }
  
  const filteredIds: string[] = [];
  
  // Load all products in batch for efficiency
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
    },
    select: {
      id: true,
      title: true,
      category: true,
      subcategory: true,
      enrichedColor: true,
      color: true,
      length: true,
      sleeve: true,
      neckline: true,
      formalityLevel: true,
      colorShade: true,
      attributes: true,
    },
  });
  
  logger.info('applyPostSQLFilters: processing products', {
    productIdsCount: productIds.length,
    productsLoaded: products.length,
    filtersProvided: {
      colors: filters.colors?.length || 0,
      colorValues: filters.colors,
      lengths: filters.lengths?.length || 0,
      lengthValues: filters.lengths,
      sleeves: filters.sleeves?.length || 0,
      sleeveValues: filters.sleeves,
      necklines: filters.necklines?.length || 0,
      necklineValues: filters.necklines,
      formalityLevels: filters.formalityLevels?.length || 0,
      formalityLevelValues: filters.formalityLevels,
      colorShades: filters.colorShades?.length || 0,
      colorShadeValues: filters.colorShades,
    },
    dictionaryCount: categoryDictionaries.size,
    dictionaryKeys: Array.from(categoryDictionaries.keys()),
  });
  
  // Process each product
  for (const product of products) {
    const categoryKey = product.subcategory 
      ? `${product.category}|${product.subcategory}`
      : `${product.category}|`;
    
    const dictionary = categoryDictionaries.get(categoryKey);
    
    // If no dictionary for this category, skip product (strict filtering)
    if (!dictionary) {
      logger.warn('applyPostSQLFilters: no dictionary for category', {
        productId: product.id,
        categoryKey,
        productCategory: product.category,
        productSubcategory: product.subcategory,
        availableDictionaryKeys: Array.from(categoryDictionaries.keys()),
        note: 'Product skipped due to missing category dictionary (strict filtering)',
      });
      continue;
    }
    
    let matchesAllFilters = true;
    const filterResults: Record<string, { matched: boolean; productValue: string | null; queryValues: string[]; intent?: ConstraintIntent | null }> = {};
    
    // Filter by colors - Intent-aware filtering
    if (filters.colors && filters.colors.length > 0) {
      const colorIntent = filterIntents?.colors;
      
      // Only apply as hard filter if intent is 'required' or 'excluded'
      // If no intent provided (undefined), default to 'required' for backward compatibility
      if (colorIntent === 'required' || colorIntent === 'excluded' || colorIntent === undefined) {
        const colorMatch = matchColorValue(
          product.enrichedColor,
          product.color,
          filters.colors,
          dictionary.availableColors
        );
        filterResults.colors = {
          matched: colorIntent === 'excluded' ? !colorMatch : colorMatch,
          productValue: product.enrichedColor || product.color || null,
          queryValues: filters.colors,
          intent: colorIntent || 'required', // Default to 'required' if undefined
        };
        if (colorIntent === 'excluded' ? colorMatch : !colorMatch) {
          matchesAllFilters = false;
        }
      } else {
        // 'strong' or 'preferred' - skip hard filtering, will be used in ranking
        filterResults.colors = {
          matched: true, // Don't filter out
          productValue: product.enrichedColor || product.color || null,
          queryValues: filters.colors,
          intent: colorIntent,
        };
      }
    }
    
    // Filter by lengths - Intent-aware filtering
    if (filters.lengths && filters.lengths.length > 0 && matchesAllFilters) {
      const lengthIntent = filterIntents?.lengths;
      
      // Only apply as hard filter if intent is 'required' or 'excluded'
      // If no intent provided (undefined), default to 'required' for backward compatibility
      if (lengthIntent === 'required' || lengthIntent === 'excluded' || lengthIntent === undefined) {
        const lengthValue = product.length || 
          (product.attributes as any)?.length || 
          (product.attributes as any)?.Length;
        const lengthMatch = matchAttributeValue(
          lengthValue,
          filters.lengths,
          dictionary.availableLengths
        );
        filterResults.lengths = {
          matched: lengthIntent === 'excluded' ? !lengthMatch : lengthMatch,
          productValue: lengthValue || null,
          queryValues: filters.lengths,
          intent: lengthIntent || 'required', // Default to 'required' if undefined
        };
        if (lengthIntent === 'excluded' ? lengthMatch : !lengthMatch) {
          matchesAllFilters = false;
        }
      } else {
        // 'strong' or 'preferred' - skip hard filtering, will be used in ranking
        const lengthValue = product.length || 
          (product.attributes as any)?.length || 
          (product.attributes as any)?.Length;
        filterResults.lengths = {
          matched: true, // Don't filter out
          productValue: lengthValue || null,
          queryValues: filters.lengths,
          intent: lengthIntent,
        };
      }
    }
    
    // Filter by sleeves - Intent-aware filtering
    if (filters.sleeves && filters.sleeves.length > 0 && matchesAllFilters) {
      const sleeveIntent = filterIntents?.sleeves;
      
      // Only apply as hard filter if intent is 'required' or 'excluded'
      // If no intent provided (undefined), default to 'required' for backward compatibility
      if (sleeveIntent === 'required' || sleeveIntent === 'excluded' || sleeveIntent === undefined) {
        const sleeveValue = product.sleeve || 
          (product.attributes as any)?.sleeve || 
          (product.attributes as any)?.Sleeve;
        const sleeveMatch = matchAttributeValue(
          sleeveValue,
          filters.sleeves,
          dictionary.availableSleeves
        );
        filterResults.sleeves = {
          matched: sleeveIntent === 'excluded' ? !sleeveMatch : sleeveMatch,
          productValue: sleeveValue || null,
          queryValues: filters.sleeves,
          intent: sleeveIntent || 'required', // Default to 'required' if undefined
        };
        if (sleeveIntent === 'excluded' ? sleeveMatch : !sleeveMatch) {
          matchesAllFilters = false;
        }
      } else {
        // 'strong' or 'preferred' - skip hard filtering, will be used in ranking
        const sleeveValue = product.sleeve || 
          (product.attributes as any)?.sleeve || 
          (product.attributes as any)?.Sleeve;
        filterResults.sleeves = {
          matched: true, // Don't filter out
          productValue: sleeveValue || null,
          queryValues: filters.sleeves,
          intent: sleeveIntent,
        };
      }
    }
    
    // Filter by necklines - Intent-aware filtering
    if (filters.necklines && filters.necklines.length > 0 && matchesAllFilters) {
      const necklineIntent = filterIntents?.necklines;
      
      // Only apply as hard filter if intent is 'required' or 'excluded'
      // If no intent provided (undefined), default to 'required' for backward compatibility
      if (necklineIntent === 'required' || necklineIntent === 'excluded' || necklineIntent === undefined) {
        const necklineValue = product.neckline || 
          (product.attributes as any)?.neckline || 
          (product.attributes as any)?.Neckline;
        const necklineMatch = matchAttributeValue(
          necklineValue,
          filters.necklines,
          dictionary.availableNecklines
        );
        filterResults.necklines = {
          matched: necklineIntent === 'excluded' ? !necklineMatch : necklineMatch,
          productValue: necklineValue || null,
          queryValues: filters.necklines,
          intent: necklineIntent || 'required', // Default to 'required' if undefined
        };
        if (necklineIntent === 'excluded' ? necklineMatch : !necklineMatch) {
          matchesAllFilters = false;
        }
      } else {
        // 'strong' or 'preferred' - skip hard filtering, will be used in ranking
        const necklineValue = product.neckline || 
          (product.attributes as any)?.neckline || 
          (product.attributes as any)?.Neckline;
        filterResults.necklines = {
          matched: true, // Don't filter out
          productValue: necklineValue || null,
          queryValues: filters.necklines,
          intent: necklineIntent,
        };
      }
    }
    
    // Filter by formality levels - Intent-aware filtering
    if (filters.formalityLevels && filters.formalityLevels.length > 0 && matchesAllFilters) {
      const formalityIntent = filterIntents?.formalityLevels;
      
      // Only apply as hard filter if intent is 'required' or 'excluded'
      // If no intent provided (undefined), default to 'required' for backward compatibility
      if (formalityIntent === 'required' || formalityIntent === 'excluded' || formalityIntent === undefined) {
        const formalityValue = product.formalityLevel || 
          (product.attributes as any)?.formalityLevel || 
          (product.attributes as any)?.FormalityLevel;
        const formalityMatch = matchAttributeValue(
          formalityValue,
          filters.formalityLevels,
          dictionary.availableFormalityLevels
        );
        filterResults.formalityLevels = {
          matched: formalityIntent === 'excluded' ? !formalityMatch : formalityMatch,
          productValue: formalityValue || null,
          queryValues: filters.formalityLevels,
          intent: formalityIntent || 'required', // Default to 'required' if undefined
        };
        if (formalityIntent === 'excluded' ? formalityMatch : !formalityMatch) {
          matchesAllFilters = false;
        }
      } else {
        // 'strong' or 'preferred' - skip hard filtering, will be used in ranking
        const formalityValue = product.formalityLevel || 
          (product.attributes as any)?.formalityLevel || 
          (product.attributes as any)?.FormalityLevel;
        filterResults.formalityLevels = {
          matched: true, // Don't filter out
          productValue: formalityValue || null,
          queryValues: filters.formalityLevels,
          intent: formalityIntent,
        };
      }
    }
    
    // Filter by color shades - Intent-aware filtering
    if (filters.colorShades && filters.colorShades.length > 0 && matchesAllFilters) {
      const colorShadeIntent = filterIntents?.colorShades;
      
      // Only apply as hard filter if intent is 'required' or 'excluded'
      // If no intent provided (undefined), default to 'required' for backward compatibility
      if (colorShadeIntent === 'required' || colorShadeIntent === 'excluded' || colorShadeIntent === undefined) {
        const colorShadeValue = product.colorShade || 
          (product.attributes as any)?.colorShade || 
          (product.attributes as any)?.ColorShade;
        const colorShadeMatch = matchAttributeValue(
          colorShadeValue,
          filters.colorShades,
          dictionary.availableColorShades
        );
        filterResults.colorShades = {
          matched: colorShadeIntent === 'excluded' ? !colorShadeMatch : colorShadeMatch,
          productValue: colorShadeValue || null,
          queryValues: filters.colorShades,
          intent: colorShadeIntent || 'required', // Default to 'required' if undefined
        };
        if (colorShadeIntent === 'excluded' ? colorShadeMatch : !colorShadeMatch) {
          matchesAllFilters = false;
        }
      } else {
        // 'strong' or 'preferred' - skip hard filtering, will be used in ranking
        const colorShadeValue = product.colorShade || 
          (product.attributes as any)?.colorShade || 
          (product.attributes as any)?.ColorShade;
        filterResults.colorShades = {
          matched: true, // Don't filter out
          productValue: colorShadeValue || null,
          queryValues: filters.colorShades,
          intent: colorShadeIntent,
        };
      }
    }
    
    if (matchesAllFilters) {
      filteredIds.push(product.id);
      logger.debug('applyPostSQLFilters: product_matched_all_filters', {
        productId: product.id,
        productTitle: product.title,
        categoryKey,
        filterResults,
      });
    } else {
      const failedFilters = Object.entries(filterResults)
        .filter(([_, result]) => !result.matched)
        .map(([filter, result]) => ({ filter, queryValues: result.queryValues, productValue: result.productValue }));
      logger.debug('applyPostSQLFilters: product_failed_filters', {
        productId: product.id,
        productTitle: product.title,
        categoryKey,
        failedFilters,
        allFilterResults: filterResults,
      });
    }
  }
  
  // Track which constraints were hard filtered vs soft ranking only
  const hardFiltered: string[] = [];
  const softRankingOnly: string[] = [];
  
  if (filters.colors && filters.colors.length > 0) {
    const intent = filterIntents?.colors;
    if (intent === 'required' || intent === 'excluded') {
      hardFiltered.push('colors');
    } else if (intent === 'strong' || intent === 'preferred') {
      softRankingOnly.push('colors');
    } else {
      // No intent provided - default to hard filter (backward compatibility)
      hardFiltered.push('colors');
    }
  }
  
  if (filters.lengths && filters.lengths.length > 0) {
    const intent = filterIntents?.lengths;
    if (intent === 'required' || intent === 'excluded') {
      hardFiltered.push('lengths');
    } else if (intent === 'strong' || intent === 'preferred') {
      softRankingOnly.push('lengths');
    } else {
      hardFiltered.push('lengths');
    }
  }
  
  if (filters.sleeves && filters.sleeves.length > 0) {
    const intent = filterIntents?.sleeves;
    if (intent === 'required' || intent === 'excluded') {
      hardFiltered.push('sleeves');
    } else if (intent === 'strong' || intent === 'preferred') {
      softRankingOnly.push('sleeves');
    } else {
      hardFiltered.push('sleeves');
    }
  }
  
  if (filters.necklines && filters.necklines.length > 0) {
    const intent = filterIntents?.necklines;
    if (intent === 'required' || intent === 'excluded') {
      hardFiltered.push('necklines');
    } else if (intent === 'strong' || intent === 'preferred') {
      softRankingOnly.push('necklines');
    } else {
      hardFiltered.push('necklines');
    }
  }
  
  if (filters.formalityLevels && filters.formalityLevels.length > 0) {
    const intent = filterIntents?.formalityLevels;
    if (intent === 'required' || intent === 'excluded') {
      hardFiltered.push('formalityLevels');
    } else if (intent === 'strong' || intent === 'preferred') {
      softRankingOnly.push('formalityLevels');
    } else {
      hardFiltered.push('formalityLevels');
    }
  }
  
  if (filters.colorShades && filters.colorShades.length > 0) {
    const intent = filterIntents?.colorShades;
    if (intent === 'required' || intent === 'excluded') {
      hardFiltered.push('colorShades');
    } else if (intent === 'strong' || intent === 'preferred') {
      softRankingOnly.push('colorShades');
    } else {
      hardFiltered.push('colorShades');
    }
  }

  logger.info('applyPostSQLFilters: completed', {
    originalCount: productIds.length,
    filteredCount: filteredIds.length,
    reductionPercentage: productIds.length > 0 
      ? ((productIds.length - filteredIds.length) / productIds.length * 100).toFixed(2) + '%'
      : '0%',
    filtersApplied: {
      colors: filters.colors?.length || 0,
      colorValues: filters.colors,
      colorIntent: filterIntents?.colors, // NEW
      lengths: filters.lengths?.length || 0,
      lengthValues: filters.lengths,
      lengthIntent: filterIntents?.lengths, // NEW
      sleeves: filters.sleeves?.length || 0,
      sleeveValues: filters.sleeves,
      sleeveIntent: filterIntents?.sleeves, // NEW
      necklines: filters.necklines?.length || 0,
      necklineValues: filters.necklines,
      necklineIntent: filterIntents?.necklines, // NEW
      formalityLevels: filters.formalityLevels?.length || 0,
      formalityLevelValues: filters.formalityLevels,
      formalityLevelIntent: filterIntents?.formalityLevels, // NEW
      colorShades: filters.colorShades?.length || 0,
      colorShadeValues: filters.colorShades,
      colorShadeIntent: filterIntents?.colorShades, // NEW
    },
    intentBasedFiltering: {
      hardFiltered: hardFiltered, // Constraints with required/excluded intent (applied as hard filters)
      softRankingOnly: softRankingOnly, // Constraints with strong/preferred intent (skipped filtering, used in ranking)
    },
    sampleFilteredIds: filteredIds.slice(0, 10),
  });
  
  return filteredIds;
}

/**
 * Helper function to map sleeveLengths constraint to sleeves for post-filtering
 */
export function extractSleeveFromSleeveLengths(sleeveLengths: string[] | null | undefined): string[] {
  if (!sleeveLengths || sleeveLengths.length === 0) return [];
  return mapSleeveLengthsToSleeves(sleeveLengths);
}

