/**
 * Constraint Dictionaries
 * 
 * Loads and provides access to constraint dictionaries extracted from the database.
 * These dictionaries contain ONLY values that actually exist in the dataset.
 */

import constraintDictionariesJson from './constraint-dictionaries.json';

export type ConstraintDictionary = {
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
  collections: string[];
  seasons: string[];
  colorShade: string[];
  colorUndertone: string[];
  embellishments: string[];
  seasonalPalette: string[];
  inclusivitySizing: string[];
  extractedAt: string;
  totalProducts: number;
};

let dictionaries: ConstraintDictionary | null = null;

/**
 * Load constraint dictionaries from JSON file
 */
export function loadConstraintDictionaries(): ConstraintDictionary {
  if (!dictionaries) {
    dictionaries = constraintDictionariesJson as ConstraintDictionary;
  }
  return dictionaries;
}

/**
 * Get dictionary values for a specific constraint type
 */
export function getDictionaryForConstraintType(
  constraintType: 'colors' | 'materials' | 'occasions' | 'styles' | 
                   'patterns' | 'sizes' | 'lengths' | 'formalityLevel' | 'fits' | 'rises' |
                   'necklines' | 'sleeveLengths' | 'collections' | 'seasons' | 'colorShade' | 'colorUndertone' | 
                   'embellishments' | 'seasonalPalette' | 'inclusivitySizing'
): string[] {
  const dict = loadConstraintDictionaries();
  // Map constraint type to dictionary key (handle aliases)
  const dictKey = constraintType === 'sleeveLengths' ? 'sleeveLengths' : constraintType;
  return (dict as any)[dictKey] || [];
}

/**
 * Format dictionary for LLM prompt
 * Limits output to maxItems to avoid token limits
 */
export function formatDictionaryForPrompt(
  constraintType: string,
  maxItems: number = 100
): string {
  const values = getDictionaryForConstraintType(
    constraintType as any
  );
  
  if (values.length === 0) {
    return `No ${constraintType} values found in database.`;
  }
  
  const displayValues = values.slice(0, maxItems);
  const remaining = values.length - displayValues.length;
  
  let output = `${constraintType.toUpperCase()} (${values.length} total):\n`;
  output += displayValues.join(', ');
  
  if (remaining > 0) {
    output += `\n... and ${remaining} more`;
  }
  
  return output;
}

/**
 * Check if a value exists in the dictionary (case-insensitive)
 */
export function valueExistsInDictionary(
  constraintType: 'colors' | 'materials' | 'occasions' | 'styles' | 
                   'patterns' | 'sizes' | 'lengths' | 'formalityLevel' | 'fits' | 'rises' |
                   'necklines' | 'sleeveLengths' | 'collections' | 'seasons' | 'colorShade' | 'colorUndertone' | 
                   'embellishments' | 'seasonalPalette' | 'inclusivitySizing',
  value: string
): boolean {
  const dictionary = getDictionaryForConstraintType(constraintType);
  const valueLower = value.toLowerCase().trim();
  return dictionary.some(dictValue => dictValue.toLowerCase().trim() === valueLower);
}

/**
 * Find exact dictionary value (case-insensitive match, returns exact case from dictionary)
 */
export function findExactDictionaryValue(
  constraintType: 'colors' | 'materials' | 'occasions' | 'styles' | 
                   'patterns' | 'sizes' | 'lengths' | 'formalityLevel' | 'fits' | 'rises' |
                   'necklines' | 'sleeveLengths' | 'collections' | 'seasons' | 'colorShade' | 'embellishments' | 'inclusivitySizing',
  value: string
): string | null {
  const dictionary = getDictionaryForConstraintType(constraintType);
  const valueLower = value.toLowerCase().trim();
  const found = dictionary.find(dictValue => dictValue.toLowerCase().trim() === valueLower);
  return found || null;
}
