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
      
      // Lengths
      length: true,
      
      // Formality
      formalityLevel: true,
      
      // Occasions
      occasion: true,
      occasionContext: true,
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

    // Extract styles
    const attrStyle = attrs?.style || attrs?.Style;
    if (attrStyle) {
      const styles = extractArrayOrSingleValue(attrStyle);
      styles.forEach(s => dictionaries.styles.add(s));
    }

    // Extract occasions
    if (product.occasion) {
      const normalized = normalizeValue(product.occasion);
      if (normalized) dictionaries.occasions.add(normalized);
    }
    if (product.occasionContext && Array.isArray(product.occasionContext)) {
      product.occasionContext.forEach(occ => {
        const normalized = normalizeValue(occ);
        if (normalized) dictionaries.occasions.add(normalized);
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
