import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';
import categoryDictionariesJson from '../src/lib/loveshackfancy/category-dictionaries.json';

interface CategoryConstraintDictionary {
  [category: string]: {
    colors: string[];
    materials: string[];
    sizes: string[];
    occasions: string[];
    seasons: string[];
    styles: string[];
    patterns: string[];
    lengths: string[];
    formalityLevel: string[];
    fits: string[];
    rises: string[];
    necklines: string[];
    sleeveLengths: string[];
    colorShade: string[];
    colorUndertone: string[];
    embellishments: string[];
    collections: string[];
    seasonalPalette: string[];
    inclusivitySizing: string[];
  };
}

/**
 * Normalize a value (trim, preserve case)
 */
function normalizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim() || null;
}

/**
 * Extract comma-separated values from a string
 */
function extractCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0);
}

/**
 * Extract array or single value (handles both formats)
 */
function extractArrayOrSingleValue(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => normalizeValue(String(v))).filter((v): v is string => v !== null);
  }
  const normalized = normalizeValue(String(value));
  return normalized ? [normalized] : [];
}

async function buildCategoryConstraintDictionaries(): Promise<CategoryConstraintDictionary> {
  console.log('📊 Building Category-Specific Constraint Dictionaries...\n');
  console.log('   (ALL constraint types for 38 major categories)\n');

  await prisma.$connect();

  // Get major categories from category-dictionaries.json (first ~40, filter out unnormalized)
  const { categories } = categoryDictionariesJson as { categories: string[] };
  const majorCategories = categories.slice(0, 40).filter(cat => !cat.includes('|'));

  console.log(`   Processing ${majorCategories.length} major categories\n`);

  const dictionaries: CategoryConstraintDictionary = {};

  for (const category of majorCategories) {
    // Get all products for this category with ALL needed columns
    const products = await prisma.product.findMany({
      where: {
        category,
        isActive: true,
      },
      select: {
        // Colors
        enrichedColor: true,
        color: true,
        // Materials
        material: true,
        fabric: true,
        fabricFamily: true,
        // Lengths
        length: true,
        // Formality
        formalityLevel: true,
        // Occasions
        occasion: true,
        occasionContext: true,
        // Fits
        fit: true,
        fitPreference: true,
        // Rise
        riseWaist: true,
        // Seasons
        season: true,
        seasonalCues: true,
        seasonalPalette: true,
        // Necklines and sleeves
        neckline: true,
        sleeve: true,
        // Color attributes
        colorShade: true,
        colorUndertone: true,
        // Style/silhouette
        silhouetteCut: true,
        // Inclusivity sizing
        inclusivitySizing: true,
        // All other attributes in JSONB
        attributes: true,
      },
    });

    // Initialize sets for all constraint types
    const constraintSets = {
      colors: new Set<string>(),
      materials: new Set<string>(),
      sizes: new Set<string>(),
      occasions: new Set<string>(),
      seasons: new Set<string>(),
      styles: new Set<string>(),
      patterns: new Set<string>(),
      lengths: new Set<string>(),
      formalityLevel: new Set<string>(),
      fits: new Set<string>(),
      rises: new Set<string>(),
      necklines: new Set<string>(),
      sleeveLengths: new Set<string>(),
      colorShade: new Set<string>(),
      colorUndertone: new Set<string>(),
      embellishments: new Set<string>(),
      collections: new Set<string>(),
      seasonalPalette: new Set<string>(),
      inclusivitySizing: new Set<string>(),
    };

    for (const product of products) {
      const attrs = product.attributes as any;

      // Extract colors
      if (product.enrichedColor) {
        extractCommaSeparatedValues(product.enrichedColor).forEach(c => constraintSets.colors.add(c));
      }
      if (product.color) {
        const normalized = normalizeValue(product.color);
        if (normalized) constraintSets.colors.add(normalized);
      }
      const attrColor = attrs?.color || attrs?.Color;
      if (attrColor) {
        extractArrayOrSingleValue(attrColor).forEach(c => constraintSets.colors.add(c));
      }

      // Extract materials
      if (product.material) {
        const normalized = normalizeValue(product.material);
        if (normalized) constraintSets.materials.add(normalized);
      }
      if (product.fabric) {
        const normalized = normalizeValue(product.fabric);
        if (normalized) constraintSets.materials.add(normalized);
      }
      const attrMaterial = attrs?.material || attrs?.Material || attrs?.fabric || attrs?.Fabric;
      if (attrMaterial) {
        extractArrayOrSingleValue(attrMaterial).forEach(m => constraintSets.materials.add(m));
      }

      // Extract sizes (from attributes.sizes - comma-separated)
      const attrSize = attrs?.sizes || attrs?.size || attrs?.Sizes || attrs?.Size;
      if (attrSize) {
        const sizeValue = String(attrSize);
        if (sizeValue.includes(',') || sizeValue.includes('/')) {
          sizeValue.split(/[,\/]/).map(s => s.trim()).filter(s => s.length > 0).forEach(s => constraintSets.sizes.add(s));
        } else {
          const normalized = normalizeValue(sizeValue);
          if (normalized) constraintSets.sizes.add(normalized);
        }
      }

      // Extract occasions
      if (product.occasion) {
        if (product.occasion.includes(',')) {
          extractCommaSeparatedValues(product.occasion).forEach(occ => {
            const normalized = normalizeValue(occ);
            if (normalized) constraintSets.occasions.add(normalized);
          });
        } else {
          const normalized = normalizeValue(product.occasion);
          if (normalized) constraintSets.occasions.add(normalized);
        }
      }
      if (product.occasionContext && Array.isArray(product.occasionContext)) {
        product.occasionContext.forEach(occ => {
          if (occ && typeof occ === 'string') {
            const normalized = normalizeValue(occ);
            if (normalized) constraintSets.occasions.add(normalized);
          }
        });
      }
      const attrOccasion = attrs?.occasion || attrs?.Occasion;
      if (attrOccasion) {
        extractArrayOrSingleValue(attrOccasion).forEach(o => constraintSets.occasions.add(o));
      }

      // Extract seasons
      if (product.season) {
        const normalized = normalizeValue(product.season);
        if (normalized) constraintSets.seasons.add(normalized);
      }
      if (product.seasonalCues) {
        const normalized = normalizeValue(product.seasonalCues);
        if (normalized) {
          extractCommaSeparatedValues(normalized).forEach(v => constraintSets.seasons.add(v));
        }
      }
      const attrSeason = attrs?.season || attrs?.Season || attrs?.seasonal_cues || attrs?.seasonalCues;
      if (attrSeason) {
        extractArrayOrSingleValue(attrSeason).forEach(s => constraintSets.seasons.add(s));
      }

      // Extract styles (from silhouetteCut and attributes)
      if (product.silhouetteCut) {
        const normalized = normalizeValue(product.silhouetteCut);
        if (normalized) constraintSets.styles.add(normalized);
      }
      const attrStyle = attrs?.style || attrs?.Style || attrs?.style_labels || attrs?.styleLabels;
      if (attrStyle) {
        extractArrayOrSingleValue(attrStyle).forEach(s => constraintSets.styles.add(s));
      }

      // Extract patterns
      const attrPattern = attrs?.pattern || attrs?.Pattern || attrs?.pattern_print || attrs?.patternPrint;
      if (attrPattern) {
        extractArrayOrSingleValue(attrPattern).forEach(p => constraintSets.patterns.add(p));
      }

      // Extract lengths
      if (product.length) {
        const normalized = normalizeValue(product.length);
        if (normalized) constraintSets.lengths.add(normalized);
      }
      const attrLength = attrs?.length || attrs?.Length;
      if (attrLength) {
        extractArrayOrSingleValue(attrLength).forEach(l => constraintSets.lengths.add(l));
      }

      // Extract formalityLevel
      if (product.formalityLevel) {
        const normalized = normalizeValue(product.formalityLevel);
        if (normalized) constraintSets.formalityLevel.add(normalized);
      }
      const attrFormality = attrs?.formalityLevel || attrs?.FormalityLevel;
      if (attrFormality) {
        extractArrayOrSingleValue(attrFormality).forEach(f => constraintSets.formalityLevel.add(f));
      }

      // Extract fits
      if (product.fit) {
        const normalized = normalizeValue(product.fit);
        if (normalized) constraintSets.fits.add(normalized);
      }
      if (product.fitPreference) {
        const normalized = normalizeValue(product.fitPreference);
        if (normalized) constraintSets.fits.add(normalized);
      }
      const attrFit = attrs?.fit || attrs?.Fit || attrs?.fit_preference || attrs?.fitPreference;
      if (attrFit) {
        extractArrayOrSingleValue(attrFit).forEach(f => constraintSets.fits.add(f));
      }

      // Extract rises
      if (product.riseWaist) {
        const normalized = normalizeValue(product.riseWaist);
        if (normalized) constraintSets.rises.add(normalized);
      }
      const attrRise = attrs?.rise || attrs?.Rise || attrs?.rise_waist || attrs?.riseWaist;
      if (attrRise) {
        extractArrayOrSingleValue(attrRise).forEach(r => constraintSets.rises.add(r));
      }

      // Extract necklines
      if (product.neckline) {
        const normalized = normalizeValue(product.neckline);
        if (normalized) constraintSets.necklines.add(normalized);
      }
      const attrNeckline = attrs?.neckline || attrs?.Neckline || attrs?.neckline_depth || attrs?.necklineDepth;
      if (attrNeckline) {
        extractArrayOrSingleValue(attrNeckline).forEach(n => constraintSets.necklines.add(n));
      }

      // Extract sleeveLengths
      if (product.sleeve) {
        const normalized = normalizeValue(product.sleeve);
        if (normalized) constraintSets.sleeveLengths.add(normalized);
      }
      const attrSleeve = attrs?.sleeve || attrs?.Sleeve || attrs?.sleeveLength || attrs?.sleeve_length;
      if (attrSleeve) {
        extractArrayOrSingleValue(attrSleeve).forEach(s => constraintSets.sleeveLengths.add(s));
      }

      // Extract colorShade
      if (product.colorShade) {
        const normalized = normalizeValue(product.colorShade);
        if (normalized) constraintSets.colorShade.add(normalized);
      }
      const attrColorShade = attrs?.colorShade || attrs?.color_shade || attrs?.ColorShade;
      if (attrColorShade) {
        extractArrayOrSingleValue(attrColorShade).forEach(cs => constraintSets.colorShade.add(cs));
      }

      // Extract colorUndertone
      if (product.colorUndertone) {
        const normalized = normalizeValue(product.colorUndertone);
        if (normalized) constraintSets.colorUndertone.add(normalized);
      }
      const attrColorUndertone = attrs?.colorUndertone || attrs?.color_undertone || attrs?.ColorUndertone;
      if (attrColorUndertone) {
        extractArrayOrSingleValue(attrColorUndertone).forEach(cu => constraintSets.colorUndertone.add(cu));
      }

      // Extract embellishments
      const attrEmbellishments = attrs?.embellishments || attrs?.embellishment || attrs?.detailing || attrs?.Detailing;
      if (attrEmbellishments) {
        extractArrayOrSingleValue(attrEmbellishments).forEach(e => constraintSets.embellishments.add(e));
      }

      // Extract collections
      const attrCollection = attrs?.collection || attrs?.collections || attrs?.Collection || attrs?.Collections;
      if (attrCollection) {
        extractArrayOrSingleValue(attrCollection).forEach(c => constraintSets.collections.add(c));
      }

      // Extract seasonalPalette
      if (product.seasonalPalette) {
        const normalized = normalizeValue(product.seasonalPalette);
        if (normalized) constraintSets.seasonalPalette.add(normalized);
      }

      // Extract inclusivitySizing
      if (product.inclusivitySizing) {
        // inclusivitySizing is a string (not array), but may contain comma-separated values
        if (product.inclusivitySizing.includes(',')) {
          extractCommaSeparatedValues(product.inclusivitySizing).forEach(v => {
            const normalized = normalizeValue(v);
            if (normalized) constraintSets.inclusivitySizing.add(normalized);
          });
        } else {
          const normalized = normalizeValue(product.inclusivitySizing);
          if (normalized) constraintSets.inclusivitySizing.add(normalized);
        }
      }
      const attrInclusivitySizing = attrs?.inclusivitySizing || attrs?.InclusivitySizing || attrs?.inclusivity_sizing;
      if (attrInclusivitySizing) {
        extractArrayOrSingleValue(attrInclusivitySizing).forEach(v => {
          const normalized = normalizeValue(v);
          if (normalized) constraintSets.inclusivitySizing.add(normalized);
        });
      }
    }

    dictionaries[category] = {
      colors: Array.from(constraintSets.colors).sort(),
      materials: Array.from(constraintSets.materials).sort(),
      sizes: Array.from(constraintSets.sizes).sort(),
      occasions: Array.from(constraintSets.occasions).sort(),
      seasons: Array.from(constraintSets.seasons).sort(),
      styles: Array.from(constraintSets.styles).sort(),
      patterns: Array.from(constraintSets.patterns).sort(),
      lengths: Array.from(constraintSets.lengths).sort(),
      formalityLevel: Array.from(constraintSets.formalityLevel).sort(),
      fits: Array.from(constraintSets.fits).sort(),
      rises: Array.from(constraintSets.rises).sort(),
      necklines: Array.from(constraintSets.necklines).sort(),
      sleeveLengths: Array.from(constraintSets.sleeveLengths).sort(),
      colorShade: Array.from(constraintSets.colorShade).sort(),
      colorUndertone: Array.from(constraintSets.colorUndertone).sort(),
      embellishments: Array.from(constraintSets.embellishments).sort(),
      collections: Array.from(constraintSets.collections).sort(),
      seasonalPalette: Array.from(constraintSets.seasonalPalette).sort(),
      inclusivitySizing: Array.from(constraintSets.inclusivitySizing).sort(),
    };

    const c = constraintSets;
    console.log(`   ${category.padEnd(30)} - Colors: ${c.colors.size.toString().padStart(3)}, Materials: ${c.materials.size.toString().padStart(3)}, Occasions: ${c.occasions.size.toString().padStart(2)}, Seasons: ${c.seasons.size.toString().padStart(2)}, Styles: ${c.styles.size.toString().padStart(2)}, Sizes: ${c.sizes.size.toString().padStart(2)}`);
  }

  console.log(`\n✅ Built dictionaries for ${Object.keys(dictionaries).length} categories\n`);

  return dictionaries;
}

async function main() {
  try {
    const dictionaries = await buildCategoryConstraintDictionaries();
    
    const outputPath = join(process.cwd(), 'src/lib/loveshackfancy/category-constraint-dictionaries.json');
    writeFileSync(outputPath, JSON.stringify(dictionaries, null, 2));
    
    console.log(`✅ Dictionary saved to: ${outputPath}\n`);
    
    // Show sample for Women's Dresses
    if (dictionaries["Women's Dresses"]) {
      const wd = dictionaries["Women's Dresses"];
      console.log(`📋 Sample - "Women's Dresses":\n`);
      console.log(`   Colors: ${wd.colors.length}`);
      console.log(`   Materials: ${wd.materials.length}`);
      console.log(`   Occasions: ${wd.occasions.length}`);
      console.log(`   Seasons: ${wd.seasons.length}`);
      console.log(`   Styles: ${wd.styles.length}`);
      console.log(`   Patterns: ${wd.patterns.length}`);
      console.log(`   Lengths: ${wd.lengths.length}`);
      console.log(`   FormalityLevel: ${wd.formalityLevel.length}`);
      console.log(`   Fits: ${wd.fits.length}`);
      console.log(`   Necklines: ${wd.necklines.length}`);
      console.log(`   SleeveLengths: ${wd.sleeveLengths.length}`);
      console.log(`   Sizes: ${wd.sizes.length}\n`);
    }
    
  } catch (error) {
    console.error('❌ Failed to build category constraint dictionaries:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
