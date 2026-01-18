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
  
  // Fit dictionary (normalized lowercase)
  availableFits: Set<string>;
  fitFrequency: Map<string, number>;
  
  // Materials dictionary (normalized lowercase)
  availableMaterials: Set<string>;
  materialFrequency: Map<string, number>;
  
  // Occasions dictionary (normalized lowercase)
  availableOccasions: Set<string>;
  occasionFrequency: Map<string, number>;
  
  // Seasons dictionary (normalized lowercase)
  availableSeasons: Set<string>;
  seasonFrequency: Map<string, number>;
  
  // Styles dictionary (normalized lowercase)
  availableStyles: Set<string>;
  styleFrequency: Map<string, number>;
  
  // Patterns dictionary (normalized lowercase)
  availablePatterns: Set<string>;
  patternFrequency: Map<string, number>;
  
  // Sizes dictionary (normalized lowercase)
  availableSizes: Set<string>;
  sizeFrequency: Map<string, number>;
  
  // Rises dictionary (normalized lowercase)
  availableRises: Set<string>;
  riseFrequency: Map<string, number>;
  
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
        p."fit",
        p."material",
        p."fabric",
        p."occasion",
        p."season",
        p."riseWaist",
        p.attributes->>'length' as attr_length,
        p.attributes->>'Length' as attr_Length_capital,
        p.attributes->>'sleeve' as attr_sleeve,
        p.attributes->>'Sleeve' as attr_Sleeve_capital,
        p.attributes->>'neckline' as attr_neckline,
        p.attributes->>'Neckline' as attr_Neckline_capital,
        p.attributes->>'formalityLevel' as attr_formalityLevel,
        p.attributes->>'FormalityLevel' as attr_FormalityLevel_capital,
        p.attributes->>'colorShade' as attr_colorShade,
        p.attributes->>'ColorShade' as attr_ColorShade_capital,
        p.attributes->>'fit' as attr_fit,
        p.attributes->>'Fit' as attr_Fit_capital,
        p.attributes->>'material' as attr_material,
        p.attributes->>'Material' as attr_Material_capital,
        p.attributes->>'fabric' as attr_fabric,
        p.attributes->>'Fabric' as attr_Fabric_capital,
        p.attributes->>'occasion' as attr_occasion,
        p.attributes->>'Occasion' as attr_Occasion_capital,
        p.attributes->>'season' as attr_season,
        p.attributes->>'Season' as attr_Season_capital,
        p.attributes->>'style' as attr_style,
        p.attributes->>'Style' as attr_Style_capital,
        p.attributes->>'pattern' as attr_pattern,
        p.attributes->>'Pattern' as attr_Pattern_capital,
        p.attributes->>'size' as attr_size,
        p.attributes->>'Size' as attr_Size_capital,
        p.attributes->>'riseWaist' as attr_riseWaist,
        p.attributes->>'RiseWaist' as attr_RiseWaist_capital,
        p.attributes->>'rise' as attr_rise,
        p.attributes->>'Rise' as attr_Rise_capital
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
      fit: string | null;
      material: string | null;
      fabric: string | null;
      occasion: string | null;
      season: string | null;
      riseWaist: string | null;
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
      attr_fit: string | null;
      attr_Fit_capital: string | null;
      attr_material: string | null;
      attr_Material_capital: string | null;
      attr_fabric: string | null;
      attr_Fabric_capital: string | null;
      attr_occasion: string | null;
      attr_Occasion_capital: string | null;
      attr_season: string | null;
      attr_Season_capital: string | null;
      attr_style: string | null;
      attr_Style_capital: string | null;
      attr_pattern: string | null;
      attr_Pattern_capital: string | null;
      attr_size: string | null;
      attr_Size_capital: string | null;
      attr_riseWaist: string | null;
      attr_RiseWaist_capital: string | null;
      attr_rise: string | null;
      attr_Rise_capital: string | null;
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
        availableFits: new Set<string>(),
        fitFrequency: new Map<string, number>(),
        availableMaterials: new Set<string>(),
        materialFrequency: new Map<string, number>(),
        availableOccasions: new Set<string>(),
        occasionFrequency: new Map<string, number>(),
        availableSeasons: new Set<string>(),
        seasonFrequency: new Map<string, number>(),
        availableStyles: new Set<string>(),
        styleFrequency: new Map<string, number>(),
        availablePatterns: new Set<string>(),
        patternFrequency: new Map<string, number>(),
        availableSizes: new Set<string>(),
        sizeFrequency: new Map<string, number>(),
        availableRises: new Set<string>(),
        riseFrequency: new Map<string, number>(),
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
        
        // Extract fit
        const fitValue = extractAttributeValue(
          product.fit,
          product.attr_fit,
          product.attr_Fit_capital
        );
        if (fitValue) {
          dictionary.availableFits.add(fitValue);
          dictionary.fitFrequency.set(fitValue, (dictionary.fitFrequency.get(fitValue) || 0) + 1);
        }
        
        // Extract materials (from material or fabric columns)
        const materialValue = extractAttributeValue(
          product.material,
          product.attr_material,
          product.attr_Material_capital
        );
        if (materialValue) {
          dictionary.availableMaterials.add(materialValue);
          dictionary.materialFrequency.set(materialValue, (dictionary.materialFrequency.get(materialValue) || 0) + 1);
        }
        const fabricValue = extractAttributeValue(
          product.fabric,
          product.attr_fabric,
          product.attr_Fabric_capital
        );
        if (fabricValue) {
          dictionary.availableMaterials.add(fabricValue);
          dictionary.materialFrequency.set(fabricValue, (dictionary.materialFrequency.get(fabricValue) || 0) + 1);
        }
        
        // Extract occasions
        const occasionValue = extractAttributeValue(
          product.occasion,
          product.attr_occasion,
          product.attr_Occasion_capital
        );
        if (occasionValue) {
          dictionary.availableOccasions.add(occasionValue);
          dictionary.occasionFrequency.set(occasionValue, (dictionary.occasionFrequency.get(occasionValue) || 0) + 1);
        }
        
        // Extract seasons
        const seasonValue = extractAttributeValue(
          product.season,
          product.attr_season,
          product.attr_Season_capital
        );
        if (seasonValue) {
          dictionary.availableSeasons.add(seasonValue);
          dictionary.seasonFrequency.set(seasonValue, (dictionary.seasonFrequency.get(seasonValue) || 0) + 1);
        }
        
        // Extract styles
        const styleValue = extractAttributeValue(
          null,
          product.attr_style,
          product.attr_Style_capital
        );
        if (styleValue) {
          dictionary.availableStyles.add(styleValue);
          dictionary.styleFrequency.set(styleValue, (dictionary.styleFrequency.get(styleValue) || 0) + 1);
        }
        
        // Extract patterns
        const patternValue = extractAttributeValue(
          null,
          product.attr_pattern,
          product.attr_Pattern_capital
        );
        if (patternValue) {
          dictionary.availablePatterns.add(patternValue);
          dictionary.patternFrequency.set(patternValue, (dictionary.patternFrequency.get(patternValue) || 0) + 1);
        }
        
        // Extract sizes
        const sizeValue = extractAttributeValue(
          null,
          product.attr_size,
          product.attr_Size_capital
        );
        if (sizeValue) {
          dictionary.availableSizes.add(sizeValue);
          dictionary.sizeFrequency.set(sizeValue, (dictionary.sizeFrequency.get(sizeValue) || 0) + 1);
        }
        
        // Extract rises (from riseWaist column or attributes)
        const riseValue = extractAttributeValue(
          product.riseWaist,
          product.attr_riseWaist || product.attr_rise,
          product.attr_RiseWaist_capital || product.attr_Rise_capital
        );
        if (riseValue) {
          dictionary.availableRises.add(riseValue);
          dictionary.riseFrequency.set(riseValue, (dictionary.riseFrequency.get(riseValue) || 0) + 1);
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
        fitCount: dictionary.availableFits.size,
        sampleFits: Array.from(dictionary.availableFits),
        materialCount: dictionary.availableMaterials.size,
        sampleMaterials: Array.from(dictionary.availableMaterials).slice(0, 10),
        occasionCount: dictionary.availableOccasions.size,
        sampleOccasions: Array.from(dictionary.availableOccasions),
        seasonCount: dictionary.availableSeasons.size,
        sampleSeasons: Array.from(dictionary.availableSeasons),
        styleCount: dictionary.availableStyles.size,
        sampleStyles: Array.from(dictionary.availableStyles).slice(0, 10),
        patternCount: dictionary.availablePatterns.size,
        samplePatterns: Array.from(dictionary.availablePatterns).slice(0, 10),
        sizeCount: dictionary.availableSizes.size,
        sampleSizes: Array.from(dictionary.availableSizes).slice(0, 10),
        riseCount: dictionary.availableRises.size,
        sampleRises: Array.from(dictionary.availableRises),
        colorFrequency: Object.fromEntries(Array.from(dictionary.colorFrequency.entries()).slice(0, 5)),
        lengthFrequency: Object.fromEntries(Array.from(dictionary.lengthFrequency.entries())),
        sleeveFrequency: Object.fromEntries(Array.from(dictionary.sleeveFrequency.entries())),
        necklineFrequency: Object.fromEntries(Array.from(dictionary.necklineFrequency.entries())),
        formalityLevelFrequency: Object.fromEntries(Array.from(dictionary.formalityLevelFrequency.entries())),
        colorShadeFrequency: Object.fromEntries(Array.from(dictionary.colorShadeFrequency.entries())),
        fitFrequency: Object.fromEntries(Array.from(dictionary.fitFrequency.entries())),
        materialFrequency: Object.fromEntries(Array.from(dictionary.materialFrequency.entries()).slice(0, 5)),
        occasionFrequency: Object.fromEntries(Array.from(dictionary.occasionFrequency.entries())),
        seasonFrequency: Object.fromEntries(Array.from(dictionary.seasonFrequency.entries())),
        styleFrequency: Object.fromEntries(Array.from(dictionary.styleFrequency.entries()).slice(0, 5)),
        patternFrequency: Object.fromEntries(Array.from(dictionary.patternFrequency.entries()).slice(0, 5)),
        sizeFrequency: Object.fromEntries(Array.from(dictionary.sizeFrequency.entries()).slice(0, 5)),
        riseFrequency: Object.fromEntries(Array.from(dictionary.riseFrequency.entries())),
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
