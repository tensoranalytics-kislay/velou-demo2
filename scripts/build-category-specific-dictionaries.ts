/**
 * Pre-build Category-Specific Dictionaries
 * 
 * Builds dictionaries for ALL category/subcategory combinations and saves to JSON.
 * These dictionaries are used for post-SQL filtering and will be loaded from cache
 * instead of being built on-demand for each query.
 * 
 * OPTIMIZED: Loads all products at once, then groups in memory (much faster than per-category queries)
 */

import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../src/lib/telemetry/logger';

/**
 * Serializable version of CategoryDictionary (Sets/Maps converted to arrays/objects)
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

/**
 * Normalize a value for dictionary storage (lowercase, trim)
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
      if (normalized) colors.add(normalized);
    });
  }
  
  // Parse color column
  if (color) {
    const normalized = normalizeValue(color);
    if (normalized) colors.add(normalized);
  }
  
  return Array.from(colors);
}

/**
 * Extract attribute value from column or JSONB attributes
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

async function buildAllCategorySpecificDictionaries(merchantId: string): Promise<PreBuiltDictionaries> {
  console.log('📊 Building Pre-Built Category-Specific Dictionaries...\n');
  console.log(`   Merchant ID: ${merchantId}\n`);

  await prisma.$connect();

  // OPTIMIZATION: Load ALL products at once instead of querying per category
  console.log('   Loading all products from database...');
  const allProducts = await prisma.$queryRawUnsafe<Array<{
    id: string;
    category: string | null;
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
    occasionContext: string[] | null;
    season: string | null;
    riseWaist: string | null;
    silhouetteCut: string | null;
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
  }>>(`
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
      p."occasionContext",
      p."season",
      p."riseWaist",
      p."silhouetteCut",
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
    WHERE p."merchantId" = $1
      AND p."isActive" = true
  `, merchantId);

  console.log(`   Loaded ${allProducts.length} products\n`);
  console.log('   Grouping products by category/subcategory...\n');

  // Group products by category/subcategory in memory
  const productsByCategory = new Map<string, typeof allProducts>();
  for (const product of allProducts) {
    const category = product.category || '';
    const subcategory = product.subcategory || null;
    const key = subcategory ? `${category}|${subcategory}` : `${category}|`;
    
    if (!productsByCategory.has(key)) {
      productsByCategory.set(key, []);
    }
    productsByCategory.get(key)!.push(product);
  }

  console.log(`   Found ${productsByCategory.size} category/subcategory combinations\n`);
  console.log('   Building dictionaries...\n');

  const dictionaries: PreBuiltDictionaries = {
    metadata: {
      buildDate: new Date().toISOString(),
      totalCategories: productsByCategory.size,
      totalProducts: allProducts.length,
    },
  };

  let processedCount = 0;

  for (const [key, products] of productsByCategory) {
    const [category, subcategoryStr] = key.split('|');
    const subcategory = subcategoryStr || null;

    processedCount++;
    if (processedCount % 50 === 0) {
      console.log(`   Processing ${processedCount}/${productsByCategory.size}...`);
    }

    // Initialize dictionary
    const dictionary: SerializableCategoryDictionary = {
      category: category || '',
      subcategory,
      availableColors: [],
      colorFrequency: {},
      availableLengths: [],
      lengthFrequency: {},
      availableSleeves: [],
      sleeveFrequency: {},
      availableNecklines: [],
      necklineFrequency: {},
      availableFormalityLevels: [],
      formalityLevelFrequency: {},
      availableColorShades: [],
      colorShadeFrequency: {},
      availableFits: [],
      fitFrequency: {},
      availableMaterials: [],
      materialFrequency: {},
      availableOccasions: [],
      occasionFrequency: {},
      availableSeasons: [],
      seasonFrequency: {},
      availableStyles: [],
      styleFrequency: {},
      availablePatterns: [],
      patternFrequency: {},
      availableSizes: [],
      sizeFrequency: {},
      availableRises: [],
      riseFrequency: {},
      productCount: products.length,
    };

    // Process each product
    for (const product of products) {
      // Extract colors
      const colorValues = extractColorValues(product.enrichedColor, product.color);
      for (const color of colorValues) {
        if (!dictionary.availableColors.includes(color)) {
          dictionary.availableColors.push(color);
        }
        dictionary.colorFrequency[color] = (dictionary.colorFrequency[color] || 0) + 1;
      }

      // Extract length
      const lengthValue = extractAttributeValue(product.length, product.attr_length, product.attr_Length_capital);
      if (lengthValue && !dictionary.availableLengths.includes(lengthValue)) {
        dictionary.availableLengths.push(lengthValue);
        dictionary.lengthFrequency[lengthValue] = (dictionary.lengthFrequency[lengthValue] || 0) + 1;
      }

      // Extract sleeve
      const sleeveValue = extractAttributeValue(product.sleeve, product.attr_sleeve, product.attr_Sleeve_capital);
      if (sleeveValue && !dictionary.availableSleeves.includes(sleeveValue)) {
        dictionary.availableSleeves.push(sleeveValue);
        dictionary.sleeveFrequency[sleeveValue] = (dictionary.sleeveFrequency[sleeveValue] || 0) + 1;
      }

      // Extract neckline
      const necklineValue = extractAttributeValue(product.neckline, product.attr_neckline, product.attr_Neckline_capital);
      if (necklineValue && !dictionary.availableNecklines.includes(necklineValue)) {
        dictionary.availableNecklines.push(necklineValue);
        dictionary.necklineFrequency[necklineValue] = (dictionary.necklineFrequency[necklineValue] || 0) + 1;
      }

      // Extract formality level
      const formalityValue = extractAttributeValue(product.formalityLevel, product.attr_formalityLevel, product.attr_FormalityLevel_capital);
      if (formalityValue && !dictionary.availableFormalityLevels.includes(formalityValue)) {
        dictionary.availableFormalityLevels.push(formalityValue);
        dictionary.formalityLevelFrequency[formalityValue] = (dictionary.formalityLevelFrequency[formalityValue] || 0) + 1;
      }

      // Extract color shade
      const colorShadeValue = extractAttributeValue(product.colorShade, product.attr_colorShade, product.attr_ColorShade_capital);
      if (colorShadeValue && !dictionary.availableColorShades.includes(colorShadeValue)) {
        dictionary.availableColorShades.push(colorShadeValue);
        dictionary.colorShadeFrequency[colorShadeValue] = (dictionary.colorShadeFrequency[colorShadeValue] || 0) + 1;
      }

      // Extract fit
      const fitValue = extractAttributeValue(product.fit, product.attr_fit, product.attr_Fit_capital);
      if (fitValue && !dictionary.availableFits.includes(fitValue)) {
        dictionary.availableFits.push(fitValue);
        dictionary.fitFrequency[fitValue] = (dictionary.fitFrequency[fitValue] || 0) + 1;
      }

      // Extract materials
      const materialValue = extractAttributeValue(product.material, product.attr_material, product.attr_Material_capital);
      if (materialValue && !dictionary.availableMaterials.includes(materialValue)) {
        dictionary.availableMaterials.push(materialValue);
        dictionary.materialFrequency[materialValue] = (dictionary.materialFrequency[materialValue] || 0) + 1;
      }
      const fabricValue = extractAttributeValue(product.fabric, product.attr_fabric, product.attr_Fabric_capital);
      if (fabricValue && !dictionary.availableMaterials.includes(fabricValue)) {
        dictionary.availableMaterials.push(fabricValue);
        dictionary.materialFrequency[fabricValue] = (dictionary.materialFrequency[fabricValue] || 0) + 1;
      }

      // Extract occasions
      // PRIMARY SOURCE: occasionContext column (array type) - e.g., ["Work", "Casual", "Wedding"]
      // FALLBACK: occasion column (string) or attributes->>'occasion' / attributes->>'Occasion'
      const occasionValues = new Set<string>();
      
      // Check occasionContext array (PRIMARY SOURCE)
      if (product.occasionContext && Array.isArray(product.occasionContext)) {
        for (const occ of product.occasionContext) {
          if (occ && typeof occ === 'string') {
            const normalized = normalizeValue(occ);
            if (normalized) occasionValues.add(normalized);
          }
        }
      }
      
      // Check occasion column (fallback)
      const occasionValue = extractAttributeValue(product.occasion, product.attr_occasion, product.attr_Occasion_capital);
      if (occasionValue) {
        occasionValues.add(occasionValue);
      }
      
      // Add all occasion values to dictionary
      for (const occ of occasionValues) {
        if (!dictionary.availableOccasions.includes(occ)) {
          dictionary.availableOccasions.push(occ);
          dictionary.occasionFrequency[occ] = (dictionary.occasionFrequency[occ] || 0) + 1;
        }
      }

      // Extract seasons
      const seasonValue = extractAttributeValue(product.season, product.attr_season, product.attr_Season_capital);
      if (seasonValue && !dictionary.availableSeasons.includes(seasonValue)) {
        dictionary.availableSeasons.push(seasonValue);
        dictionary.seasonFrequency[seasonValue] = (dictionary.seasonFrequency[seasonValue] || 0) + 1;
      }

      // Extract styles
      // PRIMARY SOURCE: silhouetteCut column (e.g., "A-Line", "Wrap", "Fit and Flare")
      // FALLBACK: attributes->>'style' or attributes->>'Style'
      const styleValue = extractAttributeValue(product.silhouetteCut, product.attr_style, product.attr_Style_capital);
      if (styleValue && !dictionary.availableStyles.includes(styleValue)) {
        dictionary.availableStyles.push(styleValue);
        dictionary.styleFrequency[styleValue] = (dictionary.styleFrequency[styleValue] || 0) + 1;
      }

      // Extract patterns
      const patternValue = extractAttributeValue(null, product.attr_pattern, product.attr_Pattern_capital);
      if (patternValue && !dictionary.availablePatterns.includes(patternValue)) {
        dictionary.availablePatterns.push(patternValue);
        dictionary.patternFrequency[patternValue] = (dictionary.patternFrequency[patternValue] || 0) + 1;
      }

      // Extract sizes
      const sizeValue = extractAttributeValue(null, product.attr_size, product.attr_Size_capital);
      if (sizeValue && !dictionary.availableSizes.includes(sizeValue)) {
        dictionary.availableSizes.push(sizeValue);
        dictionary.sizeFrequency[sizeValue] = (dictionary.sizeFrequency[sizeValue] || 0) + 1;
      }

      // Extract rises
      const riseValue = extractAttributeValue(product.riseWaist, product.attr_riseWaist || product.attr_rise, product.attr_RiseWaist_capital || product.attr_Rise_capital);
      if (riseValue && !dictionary.availableRises.includes(riseValue)) {
        dictionary.availableRises.push(riseValue);
        dictionary.riseFrequency[riseValue] = (dictionary.riseFrequency[riseValue] || 0) + 1;
      }
    }

    // Sort arrays for consistency
    dictionary.availableColors.sort();
    dictionary.availableLengths.sort();
    dictionary.availableSleeves.sort();
    dictionary.availableNecklines.sort();
    dictionary.availableFormalityLevels.sort();
    dictionary.availableColorShades.sort();
    dictionary.availableFits.sort();
    dictionary.availableMaterials.sort();
    dictionary.availableOccasions.sort();
    dictionary.availableSeasons.sort();
    dictionary.availableStyles.sort();
    dictionary.availablePatterns.sort();
    dictionary.availableSizes.sort();
    dictionary.availableRises.sort();

    dictionaries[key] = dictionary;
  }

  console.log(`\n✅ Built ${Object.keys(dictionaries).length - 1} dictionaries`);
  console.log(`   Total products processed: ${dictionaries.metadata.totalProducts}\n`);

  return dictionaries;
}

async function main() {
  const merchantId = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  try {
    const dictionaries = await buildAllCategorySpecificDictionaries(merchantId);
    
    const outputPath = join(process.cwd(), 'src/lib/search/filtering/category-specific-dictionaries.json');
    writeFileSync(outputPath, JSON.stringify(dictionaries, null, 2));
    
    console.log(`✅ Dictionaries saved to: ${outputPath}`);
    const fileSizeMB = (JSON.stringify(dictionaries).length / 1024 / 1024).toFixed(2);
    console.log(`   File size: ${fileSizeMB} MB\n`);
    
  } catch (error) {
    console.error('❌ Error building dictionaries:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
