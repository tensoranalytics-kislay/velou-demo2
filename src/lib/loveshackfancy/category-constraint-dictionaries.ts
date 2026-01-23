/**
 * Category-Specific Constraint Dictionaries
 * 
 * Loads and merges category-specific dictionaries for ALL constraint types.
 * These are pre-built from the database and stored in JSON format.
 */

import categoryConstraintDictionariesJson from './category-constraint-dictionaries.json';

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
    setVsSingle?: string[]; // Optional - "Set" or "Single"
    inclusivitySizing?: string[]; // Optional - may not exist in all category dictionaries yet
  };
}

let dictionaries: CategoryConstraintDictionary | null = null;

export function loadCategoryConstraintDictionaries(): CategoryConstraintDictionary {
  if (!dictionaries) {
    dictionaries = categoryConstraintDictionariesJson as CategoryConstraintDictionary;
  }
  return dictionaries;
}

/**
 * Merge constraint dictionaries for multiple categories
 * Deduplicates values and returns combined arrays for ALL constraint types
 */
export function mergeCategoryConstraintDictionaries(
  categories: string[]
): {
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
  setVsSingle: string[];
  inclusivitySizing: string[];
} {
  const dict = loadCategoryConstraintDictionaries();
  
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
    setVsSingle: new Set<string>(),
    inclusivitySizing: new Set<string>(),
  };

  for (const category of categories) {
    const categoryDict = dict[category];
    if (!categoryDict) {
      continue;
    }

    categoryDict.colors.forEach(c => constraintSets.colors.add(c));
    categoryDict.materials.forEach(m => constraintSets.materials.add(m));
    categoryDict.sizes.forEach(s => constraintSets.sizes.add(s));
    categoryDict.occasions.forEach(o => constraintSets.occasions.add(o));
    categoryDict.seasons.forEach(s => constraintSets.seasons.add(s));
    categoryDict.styles.forEach(s => constraintSets.styles.add(s));
    categoryDict.patterns.forEach(p => constraintSets.patterns.add(p));
    categoryDict.lengths.forEach(l => constraintSets.lengths.add(l));
    categoryDict.formalityLevel.forEach(f => constraintSets.formalityLevel.add(f));
    categoryDict.fits.forEach(f => constraintSets.fits.add(f));
    categoryDict.rises.forEach(r => constraintSets.rises.add(r));
    categoryDict.necklines.forEach(n => constraintSets.necklines.add(n));
    categoryDict.sleeveLengths.forEach(s => constraintSets.sleeveLengths.add(s));
    categoryDict.colorShade.forEach(c => constraintSets.colorShade.add(c));
    categoryDict.colorUndertone.forEach(c => constraintSets.colorUndertone.add(c));
    categoryDict.embellishments.forEach(e => constraintSets.embellishments.add(e));
    categoryDict.collections.forEach(c => constraintSets.collections.add(c));
    categoryDict.seasonalPalette.forEach(s => constraintSets.seasonalPalette.add(s));
    if (categoryDict.setVsSingle) {
      categoryDict.setVsSingle.forEach(s => constraintSets.setVsSingle.add(s));
    }
    if (categoryDict.inclusivitySizing) {
      categoryDict.inclusivitySizing.forEach(i => constraintSets.inclusivitySizing.add(i));
    }
  }

  return {
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
    setVsSingle: Array.from(constraintSets.setVsSingle).sort(),
    inclusivitySizing: Array.from(constraintSets.inclusivitySizing).sort(),
  };
}

/**
 * Format category-specific constraint values for LLM prompt
 */
export function formatCategoryConstraintForPrompt(
  constraintType: 'colors' | 'materials' | 'sizes' | 'occasions' | 'seasons' | 'styles' | 
                   'patterns' | 'lengths' | 'formalityLevel' | 'fits' | 'rises' | 'necklines' | 
                   'sleeveLengths' | 'colorShade' | 'colorUndertone' | 'embellishments' | 
                   'collections' | 'seasonalPalette' | 'setVsSingle' | 'inclusivitySizing',
  categories: string[]
): string {
  if (categories.length === 0) {
    return `No ${constraintType} available (no categories classified).`;
  }

  const merged = mergeCategoryConstraintDictionaries(categories);
  const values = merged[constraintType];

  if (values.length === 0) {
    return `No ${constraintType} found for categories: ${categories.join(', ')}.`;
  }

  // Show all values (category-specific dictionaries are smaller)
  let output = `${constraintType.toUpperCase()} (${values.length} total from ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}):\n`;
  output += values.join(', ');

  return output;
}
