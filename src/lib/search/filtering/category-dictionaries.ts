/**
 * Category-Specific Dictionaries
 * 
 * Loads pre-built dictionaries of available attribute values (colors, lengths, sleeves, etc.)
 * for category/subcategory combinations. These dictionaries are used for post-SQL filtering
 * to ensure filters only use values that actually exist in the filtered category.
 * 
 * Dictionaries are pre-built and cached - see scripts/build-category-specific-dictionaries.ts
 */

import { logger } from '../../telemetry/logger';
import preBuiltDictionariesJson from './category-specific-dictionaries.json';

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
 * Serializable version of CategoryDictionary (from JSON)
 */
type SerializableCategoryDictionary = {
  category: string;
  subcategory: string | null;
  availableColors: string[];
  colorFrequency: Record<string, number>;
  availableLengths: string[];
  lengthFrequency: Record<string, number>;
  availableSleeves: string[];
  sleeveFrequency: Record<string, number>;
  availableNecklines: string[];
  necklineFrequency: Record<string, number>;
  availableFormalityLevels: string[];
  formalityLevelFrequency: Record<string, number>;
  availableColorShades: string[];
  colorShadeFrequency: Record<string, number>;
  availableFits: string[];
  fitFrequency: Record<string, number>;
  availableMaterials: string[];
  materialFrequency: Record<string, number>;
  availableOccasions: string[];
  occasionFrequency: Record<string, number>;
  availableSeasons: string[];
  seasonFrequency: Record<string, number>;
  availableStyles: string[];
  styleFrequency: Record<string, number>;
  availablePatterns: string[];
  patternFrequency: Record<string, number>;
  availableSizes: string[];
  sizeFrequency: Record<string, number>;
  availableRises: string[];
  riseFrequency: Record<string, number>;
  productCount: number;
};

type PreBuiltDictionaries = {
  [key: string]: SerializableCategoryDictionary | {
    buildDate: string;
    totalCategories: number;
    totalProducts: number;
  }; // Key: "category|subcategory" or "category|", or "metadata"
};

// Cache for loaded dictionaries
let cachedDictionaries: Map<string, CategoryDictionary> | null = null;

/**
 * Convert serializable dictionary to CategoryDictionary (Sets/Maps)
 */
function deserializeDictionary(serialized: SerializableCategoryDictionary): CategoryDictionary {
  return {
    category: serialized.category,
    subcategory: serialized.subcategory,
    availableColors: new Set(serialized.availableColors),
    colorFrequency: new Map(Object.entries(serialized.colorFrequency)),
    availableLengths: new Set(serialized.availableLengths),
    lengthFrequency: new Map(Object.entries(serialized.lengthFrequency)),
    availableSleeves: new Set(serialized.availableSleeves),
    sleeveFrequency: new Map(Object.entries(serialized.sleeveFrequency)),
    availableNecklines: new Set(serialized.availableNecklines),
    necklineFrequency: new Map(Object.entries(serialized.necklineFrequency)),
    availableFormalityLevels: new Set(serialized.availableFormalityLevels),
    formalityLevelFrequency: new Map(Object.entries(serialized.formalityLevelFrequency)),
    availableColorShades: new Set(serialized.availableColorShades),
    colorShadeFrequency: new Map(Object.entries(serialized.colorShadeFrequency)),
    availableFits: new Set(serialized.availableFits),
    fitFrequency: new Map(Object.entries(serialized.fitFrequency)),
    availableMaterials: new Set(serialized.availableMaterials),
    materialFrequency: new Map(Object.entries(serialized.materialFrequency)),
    availableOccasions: new Set(serialized.availableOccasions),
    occasionFrequency: new Map(Object.entries(serialized.occasionFrequency)),
    availableSeasons: new Set(serialized.availableSeasons),
    seasonFrequency: new Map(Object.entries(serialized.seasonFrequency)),
    availableStyles: new Set(serialized.availableStyles),
    styleFrequency: new Map(Object.entries(serialized.styleFrequency)),
    availablePatterns: new Set(serialized.availablePatterns),
    patternFrequency: new Map(Object.entries(serialized.patternFrequency)),
    availableSizes: new Set(serialized.availableSizes),
    sizeFrequency: new Map(Object.entries(serialized.sizeFrequency)),
    availableRises: new Set(serialized.availableRises),
    riseFrequency: new Map(Object.entries(serialized.riseFrequency)),
    productCount: serialized.productCount,
  };
}

/**
 * Load pre-built dictionaries from JSON file
 */
function loadPreBuiltDictionaries(): Map<string, CategoryDictionary> {
  if (cachedDictionaries) {
    return cachedDictionaries;
  }

  const preBuilt = preBuiltDictionariesJson as PreBuiltDictionaries;
  cachedDictionaries = new Map();

  for (const [key, serialized] of Object.entries(preBuilt)) {
    if (key === 'metadata') continue;
    cachedDictionaries.set(key, deserializeDictionary(serialized as SerializableCategoryDictionary));
  }

  const metadata = preBuilt.metadata as { buildDate: string; totalCategories: number; totalProducts: number } | undefined;
  logger.info('loadPreBuiltDictionaries: loaded from cache', {
    dictionaryCount: cachedDictionaries.size,
    buildDate: metadata?.buildDate,
    totalCategories: metadata?.totalCategories,
    totalProducts: metadata?.totalProducts,
  });

  return cachedDictionaries;
}

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
 * Build category-specific dictionaries from categories
 * 
 * NOW USES PRE-BUILT CACHED DICTIONARIES instead of building on-demand.
 * This is much faster - dictionaries are loaded from JSON cache.
 * 
 * @param categories - Array of category names (e.g., ["Women's Dresses"])
 * @param merchantId - Merchant ID (for logging only)
 * @returns Map of category/subcategory combinations to their dictionaries
 */
export async function buildCategorySpecificDictionaries(
  categories: string[],
  merchantId: string
): Promise<CategoryDictionaryMap> {
  const dictionaryMap: CategoryDictionaryMap = new Map();
  
  if (!categories || categories.length === 0) {
    logger.warn('buildCategorySpecificDictionaries: no categories provided');
    return dictionaryMap;
  }
  
  try {
    // Load pre-built dictionaries from cache
    const allDictionaries = loadPreBuiltDictionaries();
    
    // For each category, load all dictionaries that match (including subcategories)
    // Key format: "category|subcategory" or "category|"
    for (const category of categories) {
      // Try exact category match (no subcategory)
      const categoryKey = `${category}|`;
      const categoryDict = allDictionaries.get(categoryKey);
      if (categoryDict) {
        dictionaryMap.set(categoryKey, categoryDict);
      }
      
      // Also load all subcategory dictionaries for this category
      for (const [key, dictionary] of allDictionaries.entries()) {
        if (dictionary.category === category && key !== categoryKey) {
          dictionaryMap.set(key, dictionary);
        }
      }
    }
    
    logger.info('buildCategorySpecificDictionaries: loaded from cache', {
      categoriesCount: categories.length,
      categories,
      dictionariesLoaded: dictionaryMap.size,
      merchantId,
      sampleKeys: Array.from(dictionaryMap.keys()).slice(0, 5),
    });
    
    return dictionaryMap;
  } catch (error) {
    logger.error('buildCategorySpecificDictionaries: error loading dictionaries from cache', {
      error: error instanceof Error ? error.message : String(error),
      categoriesCount: categories.length,
      categories,
      merchantId,
    });
    throw error;
  }
}
