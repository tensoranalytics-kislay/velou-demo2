#!/usr/bin/env tsx

/**
 * Rebuild Constraint Dictionaries After Category Normalization
 * 
 * This script rebuilds all constraint dictionaries now that categories are normalized.
 * It will extract unique values from all normalized categories.
 */

import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_FILE = join(process.cwd(), 'src/lib/loveshackfancy/constraint-dictionaries.json');

interface ConstraintDictionaries {
  colors: string[];
  materials: string[];
  occasions: string[];
  styles: string[];
  patterns: string[];
  sizes: string[];
  lengths: string[];
  formalityLevel: string[];
  fits: string[];
  rises: string[];
  necklines: string[];
  sleeveLengths: string[];
  seasons: string[];
  colorShade: string[];
  colorUndertone: string[];
  embellishments: string[];
  collections: string[];
  seasonalPalette: string[];
}

function extractCommaSeparatedValues(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0);
}

function extractArrayOrSingleValue(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(v => typeof v === 'string' ? v : String(v))
      .filter(v => v.length > 0);
  }
  if (typeof value === 'string') {
    // Handle comma-separated strings in arrays
    return extractCommaSeparatedValues(value);
  }
  return [];
}

async function buildDictionaries(): Promise<ConstraintDictionaries> {
  console.log('📚 Building constraint dictionaries from normalized categories...\n');

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      color: true,
      enrichedColor: true,
      material: true,
      occasionContext: true,
      seasonalCues: true,
      length: true,
      sleeve: true,
      neckline: true,
      formalityLevel: true,
      colorShade: true,
      colorUndertone: true,
      attributes: true,
      category: true,
      subcategory: true,
    },
  });

  console.log(`   Loaded ${products.length} products\n`);

  const dictionaries: ConstraintDictionaries = {
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
    colorUndertone: new Set<string>(),
    embellishments: new Set<string>(),
    collections: new Set<string>(),
    seasonalPalette: new Set<string>(),
  };

  for (const product of products) {
    // Colors
    if (product.color) dictionaries.colors.add(product.color.trim());
    if (product.enrichedColor) {
      extractCommaSeparatedValues(product.enrichedColor).forEach(c => dictionaries.colors.add(c.trim()));
    }

    // Materials
    if (product.material) {
      extractCommaSeparatedValues(product.material).forEach(m => dictionaries.materials.add(m.trim()));
    }

    // Occasions (now in array format)
    if (product.occasionContext) {
      extractArrayOrSingleValue(product.occasionContext).forEach(o => {
        dictionaries.occasions.add(o.trim());
      });
    }

    // Lengths
    if (product.length) dictionaries.lengths.add(product.length.trim());

    // Sleeves
    if (product.sleeve) dictionaries.sleeveLengths.add(product.sleeve.trim());

    // Necklines
    if (product.neckline) dictionaries.necklines.add(product.neckline.trim());

    // Formality
    if (product.formalityLevel) dictionaries.formalityLevel.add(product.formalityLevel.trim());

    // Color shade/undertone
    if (product.colorShade) dictionaries.colorShade.add(product.colorShade.trim());
    if (product.colorUndertone) dictionaries.colorUndertone.add(product.colorUndertone.trim());

    // Seasons
    if (product.seasonalCues) {
      extractArrayOrSingleValue(product.seasonalCues).forEach(s => dictionaries.seasons.add(s.trim()));
    }

    // From attributes JSONB
    if (product.attributes) {
      const attrs = typeof product.attributes === 'string' 
        ? JSON.parse(product.attributes) 
        : product.attributes;

      if (attrs.style_labels) {
        extractArrayOrSingleValue(attrs.style_labels).forEach(s => dictionaries.styles.add(s.trim()));
      }
      if (attrs.pattern_print) {
        extractArrayOrSingleValue(attrs.pattern_print).forEach(p => dictionaries.patterns.add(p.trim()));
      }
      if (attrs.fit_preference) {
        extractArrayOrSingleValue(attrs.fit_preference).forEach(f => dictionaries.fits.add(f.trim()));
      }
      if (attrs.rise_waist) {
        extractArrayOrSingleValue(attrs.rise_waist).forEach(r => dictionaries.rises.add(r.trim()));
      }
      if (attrs.detailing) {
        extractArrayOrSingleValue(attrs.detailing).forEach(e => dictionaries.embellishments.add(e.trim()));
      }
    }
  }

  // Convert Sets to sorted arrays
  return {
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
    colorUndertone: Array.from(dictionaries.colorUndertone).sort(),
    embellishments: Array.from(dictionaries.embellishments).sort(),
    collections: Array.from(dictionaries.collections).sort(),
    seasonalPalette: Array.from(dictionaries.seasonalPalette).sort(),
  };
}

async function main() {
  console.log('🎯 Rebuild Constraint Dictionaries\n');
  console.log('   After category normalization, rebuilding all dictionaries...\n');

  try {
    const dictionaries = await buildDictionaries();

    console.log('✅ Constraint dictionaries extracted:\n');
    console.log(`   Colors: ${dictionaries.colors.length}`);
    console.log(`   Materials: ${dictionaries.materials.length}`);
    console.log(`   Occasions: ${dictionaries.occasions.length}`);
    console.log(`   Styles: ${dictionaries.styles.length}`);
    console.log(`   Patterns: ${dictionaries.patterns.length}`);
    console.log(`   Sizes: ${dictionaries.sizes.length}`);
    console.log(`   Lengths: ${dictionaries.lengths.length}`);
    console.log(`   FormalityLevel: ${dictionaries.formalityLevel.length}`);
    console.log(`   Fits: ${dictionaries.fits.length}`);
    console.log(`   Rises: ${dictionaries.rises.length}`);
    console.log(`   Necklines: ${dictionaries.necklines.length}`);
    console.log(`   SleeveLengths: ${dictionaries.sleeveLengths.length}`);
    console.log(`   Seasons: ${dictionaries.seasons.length}`);
    console.log(`   ColorShade: ${dictionaries.colorShade.length}`);
    console.log(`   ColorUndertone: ${dictionaries.colorUndertone.length}`);
    console.log(`   Embellishments: ${dictionaries.embellishments.length}`);
    console.log(`   Collections: ${dictionaries.collections.length}`);
    console.log(`   SeasonalPalette: ${dictionaries.seasonalPalette.length}\n`);

    writeFileSync(OUTPUT_FILE, JSON.stringify(dictionaries, null, 2));
    console.log(`💾 Saved to: ${OUTPUT_FILE}\n`);

    console.log('✅ Dictionaries rebuilt successfully!\n');
  } catch (error) {
    console.error('\n❌ Failed to build dictionaries:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
