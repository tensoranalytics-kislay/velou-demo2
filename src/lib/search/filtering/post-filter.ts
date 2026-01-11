/**
 * Post-SQL Filtering
 * 
 * Applies filters using category-specific dictionaries built from category-filtered product sets.
 * This ensures filters only use values that actually exist in the filtered category.
 */

import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';
import type { CategoryDictionary, CategoryDictionaryMap } from './category-dictionaries';
import { extractConstraintValues } from '../../loveshackfancy/constraint-utils';

/**
 * Normalize a value for matching (lowercase, trim)
 */
function normalizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().trim();
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
  categoryDictionaries: CategoryDictionaryMap
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
    const filterResults: Record<string, { matched: boolean; productValue: string | null; queryValues: string[] }> = {};
    
    // Filter by colors
    if (filters.colors && filters.colors.length > 0) {
      const colorMatch = matchColorValue(
        product.enrichedColor,
        product.color,
        filters.colors,
        dictionary.availableColors
      );
      filterResults.colors = {
        matched: colorMatch,
        productValue: product.enrichedColor || product.color || null,
        queryValues: filters.colors,
      };
      if (!colorMatch) {
        matchesAllFilters = false;
      }
    }
    
    // Filter by lengths
    if (filters.lengths && filters.lengths.length > 0 && matchesAllFilters) {
      const lengthValue = product.length || 
        (product.attributes as any)?.length || 
        (product.attributes as any)?.Length;
      const lengthMatch = matchAttributeValue(
        lengthValue,
        filters.lengths,
        dictionary.availableLengths
      );
      filterResults.lengths = {
        matched: lengthMatch,
        productValue: lengthValue || null,
        queryValues: filters.lengths,
      };
      if (!lengthMatch) {
        matchesAllFilters = false;
      }
    }
    
    // Filter by sleeves
    if (filters.sleeves && filters.sleeves.length > 0 && matchesAllFilters) {
      const sleeveValue = product.sleeve || 
        (product.attributes as any)?.sleeve || 
        (product.attributes as any)?.Sleeve;
      const sleeveMatch = matchAttributeValue(
        sleeveValue,
        filters.sleeves,
        dictionary.availableSleeves
      );
      filterResults.sleeves = {
        matched: sleeveMatch,
        productValue: sleeveValue || null,
        queryValues: filters.sleeves,
      };
      if (!sleeveMatch) {
        matchesAllFilters = false;
      }
    }
    
    // Filter by necklines
    if (filters.necklines && filters.necklines.length > 0 && matchesAllFilters) {
      const necklineValue = product.neckline || 
        (product.attributes as any)?.neckline || 
        (product.attributes as any)?.Neckline;
      const necklineMatch = matchAttributeValue(
        necklineValue,
        filters.necklines,
        dictionary.availableNecklines
      );
      filterResults.necklines = {
        matched: necklineMatch,
        productValue: necklineValue || null,
        queryValues: filters.necklines,
      };
      if (!necklineMatch) {
        matchesAllFilters = false;
      }
    }
    
    // Filter by formality levels
    if (filters.formalityLevels && filters.formalityLevels.length > 0 && matchesAllFilters) {
      const formalityValue = product.formalityLevel || 
        (product.attributes as any)?.formalityLevel || 
        (product.attributes as any)?.FormalityLevel;
      const formalityMatch = matchAttributeValue(
        formalityValue,
        filters.formalityLevels,
        dictionary.availableFormalityLevels
      );
      filterResults.formalityLevels = {
        matched: formalityMatch,
        productValue: formalityValue || null,
        queryValues: filters.formalityLevels,
      };
      if (!formalityMatch) {
        matchesAllFilters = false;
      }
    }
    
    // Filter by color shades
    if (filters.colorShades && filters.colorShades.length > 0 && matchesAllFilters) {
      const colorShadeValue = product.colorShade || 
        (product.attributes as any)?.colorShade || 
        (product.attributes as any)?.ColorShade;
      const colorShadeMatch = matchAttributeValue(
        colorShadeValue,
        filters.colorShades,
        dictionary.availableColorShades
      );
      filterResults.colorShades = {
        matched: colorShadeMatch,
        productValue: colorShadeValue || null,
        queryValues: filters.colorShades,
      };
      if (!colorShadeMatch) {
        matchesAllFilters = false;
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
  
  logger.info('applyPostSQLFilters: completed', {
    originalCount: productIds.length,
    filteredCount: filteredIds.length,
    reductionPercentage: productIds.length > 0 
      ? ((productIds.length - filteredIds.length) / productIds.length * 100).toFixed(2) + '%'
      : '0%',
    filtersApplied: {
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

