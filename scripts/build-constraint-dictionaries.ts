/**
 * Builds global dictionaries of all unique constraint values from the database
 * These dictionaries are used by the LLM to find closest matches
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

type ConstraintDictionary = {
  colors: string[];
  materials: string[];
  occasions: string[];
  styles: string[];
  patterns: string[];
  sizes: string[];
  lengths: string[];
  formalityLevel: string[];
  fits: string[]; // for jeans/pants fit types
  rises: string[]; // for rise/waist placement
  necklines: string[]; // neckline types
  sleeveLengths: string[]; // sleeve lengths
  seasons: string[]; // season values
  colorShade: string[]; // color shade values
  colorUndertone: string[]; // NEW: color undertone values
  embellishments: string[]; // embellishment types
  collections: string[]; // collection names
  seasonalPalette: string[]; // NEW: seasonal palette values
  // Metadata
  extractedAt: string;
  totalProducts: number;
};

/**
 * Normalize a value (trim, preserve case)
 */
function normalizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract values from comma-separated string
 */
function extractCommaSeparatedValues(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(v => normalizeValue(v))
    .filter((v): v is string => v !== null);
}

/**
 * Extract values from array or single value
 */
function extractArrayOrSingleValue(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(v => normalizeValue(String(v)))
      .filter((v): v is string => v !== null);
  }
  const normalized = normalizeValue(String(value));
  return normalized ? [normalized] : [];
}

async function extractConstraintDictionaries(): Promise<ConstraintDictionary> {
  console.log('Loading products from database...');
  
  // Load all active products with needed columns
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      // Colors
      enrichedColor: true,
      color: true,
      attributes: true,
      
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
      
      // Fits (NEW)
      fit: true,
      fitPreference: true,
      
      // Rise (NEW)
      riseWaist: true,
      
      // Seasons
      season: true,
      seasonalCues: true, // Also extract from column (we already extract from attributes)
      seasonalPalette: true, // NEW: seasonal palette values
      
      // Necklines and sleeves
      neckline: true,
      sleeve: true,
      
      // Color attributes
      colorShade: true,
      colorUndertone: true, // NEW: color undertone values
      
      // Style/silhouette
      silhouetteCut: true, // NEW: contains style-related values like A-Line, Wrap, Fit and Flare
    },
  });

  console.log(`Loaded ${products.length} products`);

  const dictionaries = {
    colors: new Set<string>(),
    materials: new Set<string>(),
    occasions: new Set<string>(),
    styles: new Set<string>(),
    patterns: new Set<string>(),
    sizes: new Set<string>(),
    lengths: new Set<string>(),
    formalityLevel: new Set<string>(),
    fits: new Set<string>(),
    rises: new Set<string>(),
    necklines: new Set<string>(),
    sleeveLengths: new Set<string>(),
    seasons: new Set<string>(),
    colorShade: new Set<string>(),
    colorUndertone: new Set<string>(), // NEW
    embellishments: new Set<string>(),
    collections: new Set<string>(),
    seasonalPalette: new Set<string>(), // NEW
  };

  for (const product of products) {
    const attrs = product.attributes as any;

    // Extract colors
    if (product.enrichedColor) {
      const colors = extractCommaSeparatedValues(product.enrichedColor);
      colors.forEach(c => dictionaries.colors.add(c));
    }
    if (product.color) {
      const normalized = normalizeValue(product.color);
      if (normalized) dictionaries.colors.add(normalized);
    }
    const attrColor = attrs?.color || attrs?.Color;
    if (attrColor) {
      const colors = extractArrayOrSingleValue(attrColor);
      colors.forEach(c => dictionaries.colors.add(c));
    }

    // Extract materials
    if (product.material) {
      const normalized = normalizeValue(product.material);
      if (normalized) dictionaries.materials.add(normalized);
    }
    if (product.fabric) {
      const normalized = normalizeValue(product.fabric);
      if (normalized) dictionaries.materials.add(normalized);
    }
    const attrMaterial = attrs?.material || attrs?.Material || attrs?.fabric || attrs?.Fabric;
    if (attrMaterial) {
      const materials = extractArrayOrSingleValue(attrMaterial);
      materials.forEach(m => dictionaries.materials.add(m));
    }

    // Extract patterns
    const attrPattern = attrs?.pattern || attrs?.Pattern || attrs?.pattern_print || attrs?.patternPrint;
    if (attrPattern) {
      const patterns = extractArrayOrSingleValue(attrPattern);
      patterns.forEach(p => dictionaries.patterns.add(p));
    }

    // Extract styles - FROM MULTIPLE SOURCES
    // 1. From attributes.style_labels, style, Style, styleLabels
    const attrStyle = attrs?.style || attrs?.Style || attrs?.style_labels || attrs?.styleLabels;
    if (attrStyle) {
      const styles = extractArrayOrSingleValue(attrStyle);
      styles.forEach(s => dictionaries.styles.add(s));
    }
    // 2. CRITICAL: From silhouetteCut column - contains A-Line, Wrap, Fit and Flare, Empire, etc.
    if (product.silhouetteCut) {
      const normalized = normalizeValue(product.silhouetteCut);
      if (normalized) dictionaries.styles.add(normalized);
    }

    // Extract occasions
    if (product.occasion) {
      // Split comma-separated occasions from string column into individual occasions
      if (product.occasion.includes(',')) {
        const split = extractCommaSeparatedValues(product.occasion);
        split.forEach(occ => {
          const normalized = normalizeValue(occ);
          if (normalized) dictionaries.occasions.add(normalized);
        });
      } else {
        // Single occasion (no comma)
        const normalized = normalizeValue(product.occasion);
        if (normalized) dictionaries.occasions.add(normalized);
      }
    }
    if (product.occasionContext && Array.isArray(product.occasionContext)) {
      product.occasionContext.forEach(occ => {
        // Each array element should already be a single occasion, but check for commas just in case
        if (occ && typeof occ === 'string' && occ.includes(',')) {
          const split = extractCommaSeparatedValues(occ);
          split.forEach(singleOcc => {
            const normalized = normalizeValue(singleOcc);
            if (normalized) dictionaries.occasions.add(normalized);
          });
        } else {
          const normalized = normalizeValue(occ);
          if (normalized) dictionaries.occasions.add(normalized);
        }
      });
    }
    const attrOccasion = attrs?.occasion || attrs?.Occasion;
    if (attrOccasion) {
      const occasions = extractArrayOrSingleValue(attrOccasion);
      occasions.forEach(o => dictionaries.occasions.add(o));
    }

    // Extract sizes
    const attrSize = attrs?.sizes || attrs?.size || attrs?.Sizes || attrs?.Size;
    if (attrSize) {
      const sizes = extractArrayOrSingleValue(attrSize);
      sizes.forEach(s => dictionaries.sizes.add(s));
    }

    // Extract lengths
    if (product.length) {
      const normalized = normalizeValue(product.length);
      if (normalized) dictionaries.lengths.add(normalized);
    }
    const attrLength = attrs?.length || attrs?.Length;
    if (attrLength) {
      const lengths = extractArrayOrSingleValue(attrLength);
      lengths.forEach(l => dictionaries.lengths.add(l));
    }

    // Extract formalityLevel
    if (product.formalityLevel) {
      const normalized = normalizeValue(product.formalityLevel);
      if (normalized) dictionaries.formalityLevel.add(normalized);
    }
    const attrFormality = attrs?.formalityLevel || attrs?.FormalityLevel;
    if (attrFormality) {
      const formalityLevels = extractArrayOrSingleValue(attrFormality);
      formalityLevels.forEach(f => dictionaries.formalityLevel.add(f));
    }

    // Extract fits
    if (product.fit) {
      const normalized = normalizeValue(product.fit);
      if (normalized) dictionaries.fits.add(normalized);
    }
    if (product.fitPreference) {
      const normalized = normalizeValue(product.fitPreference);
      if (normalized) dictionaries.fits.add(normalized);
    }
    const attrFit = attrs?.fit || attrs?.Fit || attrs?.fit_preference || attrs?.fitPreference;
    if (attrFit) {
      const fits = extractArrayOrSingleValue(attrFit);
      fits.forEach(f => dictionaries.fits.add(f));
    }

    // Extract rises
    if (product.riseWaist) {
      const normalized = normalizeValue(product.riseWaist);
      if (normalized) dictionaries.rises.add(normalized);
    }
    const attrRise = attrs?.rise || attrs?.Rise || attrs?.rise_waist || attrs?.riseWaist;
    if (attrRise) {
      const rises = extractArrayOrSingleValue(attrRise);
      rises.forEach(r => dictionaries.rises.add(r));
    }

    // Extract necklines (NEW - was missing!)
    if (product.neckline) {
      const normalized = normalizeValue(product.neckline);
      if (normalized) dictionaries.necklines.add(normalized);
    }
    const attrNeckline = attrs?.neckline || attrs?.Neckline || attrs?.neckline_depth || attrs?.necklineDepth;
    if (attrNeckline) {
      const necklines = extractArrayOrSingleValue(attrNeckline);
      necklines.forEach(n => dictionaries.necklines.add(n));
    }

    // Extract sleeveLengths (NEW - was missing!)
    if (product.sleeve) {
      const normalized = normalizeValue(product.sleeve);
      if (normalized) dictionaries.sleeveLengths.add(normalized);
    }
    const attrSleeve = attrs?.sleeve || attrs?.Sleeve || attrs?.sleeveLength || attrs?.sleeve_length;
    if (attrSleeve) {
      const sleeves = extractArrayOrSingleValue(attrSleeve);
      sleeves.forEach(s => dictionaries.sleeveLengths.add(s));
    }

    // Extract seasons - FROM MULTIPLE SOURCES
    // 1. From season column
    if (product.season) {
      const normalized = normalizeValue(product.season);
      if (normalized) dictionaries.seasons.add(normalized);
    }
    // 2. From seasonalCues column
    if (product.seasonalCues) {
      const normalized = normalizeValue(product.seasonalCues);
      if (normalized) {
        // seasonalCues can be comma-separated like "Fall, Spring"
        const values = extractCommaSeparatedValues(normalized);
        values.forEach(v => dictionaries.seasons.add(v));
      }
    }
    // 3. From attributes
    const attrSeason = attrs?.season || attrs?.Season || attrs?.seasonal_cues || attrs?.seasonalCues;
    if (attrSeason) {
      const seasons = extractArrayOrSingleValue(attrSeason);
      seasons.forEach(s => dictionaries.seasons.add(s));
    }
    // 4. Extract seasonalPalette as separate constraint
    if (product.seasonalPalette) {
      const normalized = normalizeValue(product.seasonalPalette);
      if (normalized) dictionaries.seasonalPalette.add(normalized);
    }

    // Extract colorShade
    if (product.colorShade) {
      const normalized = normalizeValue(product.colorShade);
      if (normalized) dictionaries.colorShade.add(normalized);
    }
    const attrColorShade = attrs?.colorShade || attrs?.color_shade || attrs?.ColorShade;
    if (attrColorShade) {
      const colorShades = extractArrayOrSingleValue(attrColorShade);
      colorShades.forEach(cs => dictionaries.colorShade.add(cs));
    }

    // Extract colorUndertone (NEW - separate constraint)
    if (product.colorUndertone) {
      const normalized = normalizeValue(product.colorUndertone);
      if (normalized) dictionaries.colorUndertone.add(normalized);
    }
    const attrColorUndertone = attrs?.colorUndertone || attrs?.color_undertone || attrs?.ColorUndertone;
    if (attrColorUndertone) {
      const colorUndertones = extractArrayOrSingleValue(attrColorUndertone);
      colorUndertones.forEach(cu => dictionaries.colorUndertone.add(cu));
    }

    // Extract embellishments (NEW - from attributes)
    const attrEmbellishments = attrs?.embellishments || attrs?.embellishment || attrs?.detailing || attrs?.Detailing;
    if (attrEmbellishments) {
      const embellishments = extractArrayOrSingleValue(attrEmbellishments);
      embellishments.forEach(e => dictionaries.embellishments.add(e));
    }

    // Extract collections (NEW - from attributes)
    const attrCollection = attrs?.collection || attrs?.collections || attrs?.Collection || attrs?.Collections;
    if (attrCollection) {
      const collections = extractArrayOrSingleValue(attrCollection);
      collections.forEach(c => dictionaries.collections.add(c));
    }
  }

  const result: ConstraintDictionary = {
    colors: Array.from(dictionaries.colors).sort(),
    materials: Array.from(dictionaries.materials).sort(),
    occasions: Array.from(dictionaries.occasions).sort(),
    styles: Array.from(dictionaries.styles).sort(),
    patterns: Array.from(dictionaries.patterns).sort(),
    sizes: Array.from(dictionaries.sizes).sort(),
    lengths: Array.from(dictionaries.lengths).sort(),
    formalityLevel: Array.from(dictionaries.formalityLevel).sort(),
    fits: Array.from(dictionaries.fits).sort(),
    rises: Array.from(dictionaries.rises).sort(),
    necklines: Array.from(dictionaries.necklines).sort(),
    sleeveLengths: Array.from(dictionaries.sleeveLengths).sort(),
    seasons: Array.from(dictionaries.seasons).sort(),
    colorShade: Array.from(dictionaries.colorShade).sort(),
    colorUndertone: Array.from(dictionaries.colorUndertone).sort(), // NEW
    embellishments: Array.from(dictionaries.embellishments).sort(),
    collections: Array.from(dictionaries.collections).sort(),
    seasonalPalette: Array.from(dictionaries.seasonalPalette).sort(), // NEW
    extractedAt: new Date().toISOString(),
    totalProducts: products.length,
  };

  return result;
}

async function main() {
  try {
    console.log('Extracting constraint dictionaries from database...');
    const dictionaries = await extractConstraintDictionaries();
    
    const outputPath = join(process.cwd(), 'src/lib/loveshackfancy/constraint-dictionaries.json');
    writeFileSync(outputPath, JSON.stringify(dictionaries, null, 2));
    
    console.log('\n✅ Constraint dictionaries extracted:');
    console.log(`  Colors: ${dictionaries.colors.length}`);
    console.log(`  Materials: ${dictionaries.materials.length}`);
    console.log(`  Occasions: ${dictionaries.occasions.length}`);
    console.log(`  Styles: ${dictionaries.styles.length}`);
    console.log(`  Patterns: ${dictionaries.patterns.length}`);
    console.log(`  Sizes: ${dictionaries.sizes.length}`);
    console.log(`  Lengths: ${dictionaries.lengths.length}`);
    console.log(`  FormalityLevel: ${dictionaries.formalityLevel.length}`);
    console.log(`  Fits: ${dictionaries.fits.length}`);
    console.log(`  Rises: ${dictionaries.rises.length}`);
    console.log(`  Necklines: ${dictionaries.necklines.length}`);
    console.log(`  SleeveLengths: ${dictionaries.sleeveLengths.length}`);
    console.log(`  Seasons: ${dictionaries.seasons.length}`);
    console.log(`  ColorShade: ${dictionaries.colorShade.length}`);
    console.log(`  ColorUndertone: ${dictionaries.colorUndertone.length}`);
    console.log(`  Embellishments: ${dictionaries.embellishments.length}`);
    console.log(`  Collections: ${dictionaries.collections.length}`);
    console.log(`  SeasonalPalette: ${dictionaries.seasonalPalette.length}`);
    console.log(`  Total Products: ${dictionaries.totalProducts}`);
    console.log(`\nSaved to: ${outputPath}`);
  } catch (error) {
    console.error('Error extracting dictionaries:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
