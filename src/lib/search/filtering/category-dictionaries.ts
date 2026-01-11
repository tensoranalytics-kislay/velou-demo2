/**
 * Category-Specific Dictionaries
 * 
 * Builds dictionaries of available attribute values (colors, lengths, sleeves, etc.)
 * from category-filtered product sets. These dictionaries are used for post-SQL filtering
 * to ensure filters only use values that actually exist in the filtered category.
 */

import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';

/**
 * Category-specific dictionary containing available attribute values
 */
export type CategoryDictionary = {
  category: string;
  subcategory: string | null;
  
  // Color dictionary (normalized lowercase)
  availableColors: Set<string>;
  colorFrequency: Map<string, number>;
  
  // Length dictionary (normalized lowercase)
  availableLengths: Set<string>;
  lengthFrequency: Map<string, number>;
  
  // Sleeve dictionary (normalized lowercase)
  availableSleeves: Set<string>;
  sleeveFrequency: Map<string, number>;
  
  // Neckline dictionary (normalized lowercase)
  availableNecklines: Set<string>;
  necklineFrequency: Map<string, number>;
  
  // Formality level dictionary (normalized lowercase)
  availableFormalityLevels: Set<string>;
  formalityLevelFrequency: Map<string, number>;
  
  // Color shade dictionary (normalized lowercase)
  availableColorShades: Set<string>;
  colorShadeFrequency: Map<string, number>;
  
  productCount: number;
};

/**
 * Map of category/subcategory combinations to their dictionaries
 * Key format: "category|subcategory" or "category|" (when subcategory is null)
 */
export type CategoryDictionaryMap = Map<string, CategoryDictionary>;

/**
 * Normalize a value for dictionary storage (lowercase, trim, deduplicate)
 */
function normalizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().trim();
}

/**
 * Extract and normalize color values from enrichedColor (comma-separated) and color column
 */
function extractColorValues(enrichedColor: string | null, color: string | null): string[] {
  const colors = new Set<string>();
  
  // Parse enrichedColor (comma-separated)
  if (enrichedColor) {
    enrichedColor.split(',').forEach(term => {
      const normalized = normalizeValue(term);
      if (normalized) {
        colors.add(normalized);
      }
    });
  }
  
  // Parse color column (fallback)
  if (color) {
    const normalized = normalizeValue(color);
    if (normalized) {
      colors.add(normalized);
    }
  }
  
  return Array.from(colors);
}

/**
 * Extract attribute value from column or JSONB fallback
 */
function extractAttributeValue(
  columnValue: string | null,
  attrValue: string | null,
  attrValueCapital: string | null
): string | null {
  if (columnValue) return normalizeValue(columnValue);
  if (attrValue) return normalizeValue(attrValue);
  if (attrValueCapital) return normalizeValue(attrValueCapital);
  return null;
}

/**
 * Build category-specific dictionaries from a set of product IDs
 * 
 * @param productIds - Array of product IDs from category-filtered set
 * @param merchantId - Merchant ID for filtering
 * @returns Map of category/subcategory combinations to their dictionaries
 */
export async function buildCategorySpecificDictionaries(
  productIds: string[],
  merchantId: string
): Promise<CategoryDictionaryMap> {
  const dictionaryMap: CategoryDictionaryMap = new Map();
  
  if (!productIds || productIds.length === 0) {
    logger.warn('buildCategorySpecificDictionaries: no product IDs provided');
    return dictionaryMap;
  }
  
  try {
    // Build PostgreSQL array literal for product IDs (escape single quotes)
    const productIdsArrayLiteral = productIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
    
    // Build query string
    const query = `
      SELECT 
        p.id,
        p."category",
        p."subcategory",
        p."enrichedColor",
        p."color",
        p."length",
        p."sleeve",
        p."neckline",
        p."formalityLevel",
        p."colorShade",
        p.attributes->>'length' as attr_length,
        p.attributes->>'Length' as attr_Length_capital,
        p.attributes->>'sleeve' as attr_sleeve,
        p.attributes->>'Sleeve' as attr_Sleeve_capital,
        p.attributes->>'neckline' as attr_neckline,
        p.attributes->>'Neckline' as attr_Neckline_capital,
        p.attributes->>'formalityLevel' as attr_formalityLevel,
        p.attributes->>'FormalityLevel' as attr_FormalityLevel_capital,
        p.attributes->>'colorShade' as attr_colorShade,
        p.attributes->>'ColorShade' as attr_ColorShade_capital
      FROM "Product" p
      WHERE p.id = ANY(ARRAY[${productIdsArrayLiteral}]::text[])
        AND p."merchantId" = $1
        AND p."isActive" = true
    `;
    
    // Load products with only needed columns
    const products = await prisma.$queryRawUnsafe<Array<{
      id: string;
      category: string;
      subcategory: string | null;
      enrichedColor: string | null;
      color: string | null;
      length: string | null;
      sleeve: string | null;
      neckline: string | null;
      formalityLevel: string | null;
      colorShade: string | null;
      attr_length: string | null;
      attr_Length_capital: string | null;
      attr_sleeve: string | null;
      attr_Sleeve_capital: string | null;
      attr_neckline: string | null;
      attr_Neckline_capital: string | null;
      attr_formalityLevel: string | null;
      attr_FormalityLevel_capital: string | null;
      attr_colorShade: string | null;
      attr_ColorShade_capital: string | null;
    }>>(query, merchantId);
    
    logger.info('buildCategorySpecificDictionaries: loaded products', {
      productIdsCount: productIds.length,
      loadedProductsCount: products.length,
      merchantId,
      sampleProductIds: productIds.slice(0, 5),
    });
    
    // Group products by (category, subcategory) combination
    const categoryGroups = new Map<string, typeof products>();
    
    for (const product of products) {
      const key = product.subcategory 
        ? `${product.category}|${product.subcategory}`
        : `${product.category}|`;
      
      if (!categoryGroups.has(key)) {
        categoryGroups.set(key, []);
      }
      categoryGroups.get(key)!.push(product);
    }
    
    // Build dictionary for each category group
    for (const [key, groupProducts] of categoryGroups) {
      const [category, subcategory] = key.split('|');
      
      const dictionary: CategoryDictionary = {
        category,
        subcategory: subcategory || null,
        availableColors: new Set<string>(),
        colorFrequency: new Map<string, number>(),
        availableLengths: new Set<string>(),
        lengthFrequency: new Map<string, number>(),
        availableSleeves: new Set<string>(),
        sleeveFrequency: new Map<string, number>(),
        availableNecklines: new Set<string>(),
        necklineFrequency: new Map<string, number>(),
        availableFormalityLevels: new Set<string>(),
        formalityLevelFrequency: new Map<string, number>(),
        availableColorShades: new Set<string>(),
        colorShadeFrequency: new Map<string, number>(),
        productCount: groupProducts.length,
      };
      
      // Process each product in the group
      for (const product of groupProducts) {
        // Extract colors
        const colorValues = extractColorValues(product.enrichedColor, product.color);
        for (const color of colorValues) {
          dictionary.availableColors.add(color);
          dictionary.colorFrequency.set(color, (dictionary.colorFrequency.get(color) || 0) + 1);
        }
        
        // Extract length
        const lengthValue = extractAttributeValue(
          product.length,
          product.attr_length,
          product.attr_Length_capital
        );
        if (lengthValue) {
          dictionary.availableLengths.add(lengthValue);
          dictionary.lengthFrequency.set(lengthValue, (dictionary.lengthFrequency.get(lengthValue) || 0) + 1);
        }
        
        // Extract sleeve
        const sleeveValue = extractAttributeValue(
          product.sleeve,
          product.attr_sleeve,
          product.attr_Sleeve_capital
        );
        if (sleeveValue) {
          dictionary.availableSleeves.add(sleeveValue);
          dictionary.sleeveFrequency.set(sleeveValue, (dictionary.sleeveFrequency.get(sleeveValue) || 0) + 1);
        }
        
        // Extract neckline
        const necklineValue = extractAttributeValue(
          product.neckline,
          product.attr_neckline,
          product.attr_Neckline_capital
        );
        if (necklineValue) {
          dictionary.availableNecklines.add(necklineValue);
          dictionary.necklineFrequency.set(necklineValue, (dictionary.necklineFrequency.get(necklineValue) || 0) + 1);
        }
        
        // Extract formality level
        const formalityValue = extractAttributeValue(
          product.formalityLevel,
          product.attr_formalityLevel,
          product.attr_FormalityLevel_capital
        );
        if (formalityValue) {
          dictionary.availableFormalityLevels.add(formalityValue);
          dictionary.formalityLevelFrequency.set(formalityValue, (dictionary.formalityLevelFrequency.get(formalityValue) || 0) + 1);
        }
        
        // Extract color shade
        const colorShadeValue = extractAttributeValue(
          product.colorShade,
          product.attr_colorShade,
          product.attr_ColorShade_capital
        );
        if (colorShadeValue) {
          dictionary.availableColorShades.add(colorShadeValue);
          dictionary.colorShadeFrequency.set(colorShadeValue, (dictionary.colorShadeFrequency.get(colorShadeValue) || 0) + 1);
        }
      }
      
      dictionaryMap.set(key, dictionary);
      
      logger.info('buildCategorySpecificDictionaries: built dictionary', {
        key,
        category,
        subcategory: subcategory || null,
        productCount: groupProducts.length,
        colorCount: dictionary.availableColors.size,
        sampleColors: Array.from(dictionary.availableColors).slice(0, 10),
        lengthCount: dictionary.availableLengths.size,
        sampleLengths: Array.from(dictionary.availableLengths),
        sleeveCount: dictionary.availableSleeves.size,
        sampleSleeves: Array.from(dictionary.availableSleeves),
        necklineCount: dictionary.availableNecklines.size,
        sampleNecklines: Array.from(dictionary.availableNecklines),
        formalityLevelCount: dictionary.availableFormalityLevels.size,
        sampleFormalityLevels: Array.from(dictionary.availableFormalityLevels),
        colorShadeCount: dictionary.availableColorShades.size,
        sampleColorShades: Array.from(dictionary.availableColorShades),
        colorFrequency: Object.fromEntries(Array.from(dictionary.colorFrequency.entries()).slice(0, 5)),
        lengthFrequency: Object.fromEntries(Array.from(dictionary.lengthFrequency.entries())),
        sleeveFrequency: Object.fromEntries(Array.from(dictionary.sleeveFrequency.entries())),
        necklineFrequency: Object.fromEntries(Array.from(dictionary.necklineFrequency.entries())),
        formalityLevelFrequency: Object.fromEntries(Array.from(dictionary.formalityLevelFrequency.entries())),
        colorShadeFrequency: Object.fromEntries(Array.from(dictionary.colorShadeFrequency.entries())),
      });
    }
    
    return dictionaryMap;
  } catch (error) {
    logger.error('buildCategorySpecificDictionaries: error building dictionaries', {
      error: error instanceof Error ? error.message : String(error),
      productIdsCount: productIds.length,
      merchantId,
    });
    throw error;
  }
}
