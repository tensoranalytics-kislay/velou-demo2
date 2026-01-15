/**
 * Dictionary-Based Constraint Matching
 * 
 * Matches user queries to dictionary values with relaxed vs conservative selection
 * based on intent levels (required/strong/preferred/excluded)
 */

import { getDictionaryForConstraintType } from './constraint-dictionaries';
import type { ConstraintIntent } from './constraint-utils';

export type MatchStrategy = 'conservative' | 'moderate' | 'relaxed' | 'exclude';

/**
 * Map intent to matching strategy
 */
export function intentToStrategy(intent: ConstraintIntent): MatchStrategy {
  switch (intent) {
    case 'required':
      return 'conservative';
    case 'strong':
      return 'moderate';
    case 'preferred':
      return 'relaxed';
    case 'excluded':
      return 'exclude';
    default:
      return 'moderate';
  }
}

/**
 * Find exact dictionary value (case-insensitive match, returns exact case from dictionary)
 */
function findExactDictionaryValue(
  constraintType: 'colors' | 'materials' | 'occasions' | 'styles' | 
                   'patterns' | 'sizes' | 'lengths' | 'formalityLevel' | 'fits' | 'rises',
  value: string
): string | null {
  const dictionary = getDictionaryForConstraintType(constraintType);
  const valueLower = value.toLowerCase().trim();
  const found = dictionary.find(dictValue => dictValue.toLowerCase().trim() === valueLower);
  return found || null;
}

/**
 * Find closest matches in dictionary based on semantic similarity
 * 
 * Note: The actual semantic matching is done by the LLM in the prompt.
 * This function provides validation and strategy guidance for post-processing.
 */
export function findClosestMatches(
  queryValue: string,
  constraintType: 'colors' | 'materials' | 'occasions' | 'styles' | 
                   'patterns' | 'sizes' | 'lengths' | 'formalityLevel' | 'fits' | 'rises',
  strategy: MatchStrategy = 'moderate'
): string[] {
  const dictionary = getDictionaryForConstraintType(constraintType);
  const queryLower = queryValue.toLowerCase().trim();
  
  // Exact match
  const exactMatch = findExactDictionaryValue(constraintType, queryValue);
  
  if (strategy === 'conservative') {
    // Only exact match
    return exactMatch ? [exactMatch] : [];
  }
  
  if (strategy === 'exclude') {
    // Return values to exclude (exact match only for exclusion)
    return exactMatch ? [exactMatch] : [];
  }
  
  // For moderate/relaxed, find similar matches
  const similarMatches: string[] = [];
  
  if (exactMatch) {
    similarMatches.push(exactMatch);
  }
  
  // Find partial matches (contains, starts with, etc.)
  // This is a fallback - LLM does the main semantic matching
  for (const dictValue of dictionary) {
    if (exactMatch && dictValue === exactMatch) {
      continue; // Already added
    }
    
    const dictLower = dictValue.toLowerCase().trim();
    
    // Contains match (simple heuristic)
    if (dictLower.includes(queryLower) || queryLower.includes(dictLower)) {
      similarMatches.push(dictValue);
    }
  }
  
  // Apply strategy
  if (strategy === 'moderate') {
    // Exact + 1-2 similar (limit to 3 total)
    return similarMatches.slice(0, 3);
  } else {
    // Relaxed: all similar matches
    return similarMatches;
  }
}

/**
 * Validate and normalize constraint values against dictionary
 * Maps user-provided values to exact dictionary values (preserves case)
 */
export function validateConstraintValues(
  constraintType: 'colors' | 'materials' | 'occasions' | 'styles' | 
                   'patterns' | 'sizes' | 'lengths' | 'formalityLevel' | 'fits' | 'rises',
  values: string[] | null | undefined
): string[] | null {
  if (!values || values.length === 0) return null;
  
  const dictionary = getDictionaryForConstraintType(constraintType);
  const dictionaryLower = new Set(dictionary.map(v => v.toLowerCase().trim()));
  
  // Filter to only values that exist in dictionary (case-insensitive)
  const validValues: string[] = [];
  
  for (const value of values) {
    const valueLower = value.toLowerCase().trim();
    const dictValue = dictionary.find(d => d.toLowerCase().trim() === valueLower);
    if (dictValue) {
      validValues.push(dictValue); // Use exact dictionary value (preserve case)
    }
  }
  
  return validValues.length > 0 ? validValues : null;
}
