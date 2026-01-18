/**
 * Age Group Normalizer
 * 
 * Maps user query age group mentions to canonical dataset values.
 * Ensures age groups extracted from queries match the exact values in the database.
 */

import { LOVESHACKFANCY_ONTOLOGY } from './ontology';

/**
 * Map user query terms to canonical age group values from the dataset
 */
const AGE_GROUP_MAPPING: Record<string, string[]> = {
  // Adult
  'adult': ['Adult'],
  'adults': ['Adult'],
  'women': ['Adult'],
  'womens': ['Adult'],
  'men': ['Adult'],
  'mens': ['Adult'],
  'ladies': ['Adult'],
  'gentlemen': ['Adult'],
  'woman': ['Adult'],
  'man': ['Adult'],
  'for women': ['Adult'],
  'for men': ['Adult'],
  'for ladies': ['Adult'],
  'for gentlemen': ['Adult'],
  // Body type descriptors that indicate Adult (not age group modifiers)
  'curvy women': ['Adult'],
  'curvy woman': ['Adult'],
  'curvy mom': ['Adult'],
  'curvy moms': ['Adult'],
  'curvy': ['Adult'], // When used as a descriptor for adult clothing
  
  // Kids
  'kids': ['Kids'],
  'kid': ['Kids'],
  'children': ['Kids'],
  'child': ['Kids'],
  'for kids': ['Kids'],
  'for children': ['Kids'],
  'for child': ['Kids'],
  // Age ranges that map to Kids
  '4-year-old': ['Kids'],
  '4 years old': ['Kids'],
  'age 4': ['Kids'],
  '5-year-old': ['Kids'],
  '5 years old': ['Kids'],
  'age 5': ['Kids'],
  '6-year-old': ['Kids'],
  '6 years old': ['Kids'],
  'age 6': ['Kids'],
  '7-year-old': ['Kids'],
  '7 years old': ['Kids'],
  'age 7': ['Kids'],
  '8-year-old': ['Kids'],
  '8 years old': ['Kids'],
  'age 8': ['Kids'],
  '9-year-old': ['Kids'],
  '9 years old': ['Kids'],
  'age 9': ['Kids'],
  '10-year-old': ['Tween'],
  '10 years old': ['Tween'],
  'age 10': ['Tween'],
  '11-year-old': ['Tween'],
  '11 years old': ['Tween'],
  'age 11': ['Tween'],
  '12-year-old': ['Tween'],
  '12 years old': ['Tween'],
  'age 12': ['Tween'],
  'for my 12 year old': ['Tween'],
  'for my 11 year old': ['Tween'],
  'for my 10 year old': ['Tween'],
  
  // Toddler
  'toddler': ['Toddler'],
  'toddlers': ['Toddler'],
  'for toddler': ['Toddler'],
  'for toddlers': ['Toddler'],
  '2-year-old': ['Toddler'],
  '2 years old': ['Kids, Toddler'], // Can be both
  'age 2': ['Toddler'],
  '3-year-old': ['Toddler'],
  '3 years old': ['Toddler'],
  'age 3': ['Toddler'],
  '1-3 year old': ['Toddler'],
  '1-3 years old': ['Toddler'],
  '1 to 3 year old': ['Toddler'],
  '1 to 3 years old': ['Toddler'],
  
  // Baby
  'baby': ['Baby'],
  'babies': ['Baby'],
  'infant': ['Baby'],
  'infants': ['Baby'],
  'for baby': ['Baby'],
  'for babies': ['Baby'],
  'baby girl': ['Baby'], // Gender is separate, age is Baby
  'baby boy': ['Baby'], // Gender is separate, age is Baby
  'for my baby': ['Baby'],
  'for my baby girl': ['Baby'],
  'for my baby boy': ['Baby'],
  '0-3 months': ['Baby'],
  '3-6 months': ['Baby'],
  '6-12 months': ['Baby'],
  '12-18 months': ['Baby'],
  '18-24 months': ['Baby'],
  
  // Teen
  'teen': ['Teen'],
  'teens': ['Teen'],
  'teenager': ['Teen'],
  'teenagers': ['Teen'],
  'teenage': ['Teen'],
  'for teen': ['Teen'],
  'for teens': ['Teen'],
  'for teenager': ['Teen'],
  'for teenagers': ['Teen'],
  'teenage girl': ['Teen'],
  'teenage boy': ['Teen'],
  'for teenage daughter': ['Teen'],
  'for teenage son': ['Teen'],
  '13-year-old': ['Teen'],
  '13 years old': ['Teen'],
  'age 13': ['Teen'],
  '14-year-old': ['Teen'],
  '14 years old': ['Teen'],
  'age 14': ['Teen'],
  '15-year-old': ['Teen'],
  '15 years old': ['Teen'],
  'age 15': ['Teen'],
  '16-year-old': ['Teen'],
  '16 years old': ['Teen'],
  'age 16': ['Teen'],
  '17-year-old': ['Teen'],
  '17 years old': ['Teen'],
  'age 17': ['Teen'],
  '18-year-old': ['Teen, Adult'], // Can be both
  '18 years old': ['Teen, Adult'],
  'age 18': ['Teen, Adult'],
  '19-year-old': ['Teen, Adult'],
  '19 years old': ['Teen, Adult'],
  'age 19': ['Teen, Adult'],
  'juvenile': ['Teen'],
  'youth': ['Teen'],
  'adolescent': ['Teen'],
  'young': ['Teen'],
  
  // Tween
  'tween': ['Tween'],
  'tweens': ['Tween'],
  'pre-teen': ['Tween'],
  'preteen': ['Tween'],
  'pre teen': ['Tween'],
  'for tween': ['Tween'],
  'for tweens': ['Tween'],
  'for pre-teen': ['Tween'],
};

/**
 * Normalize age group values from user query to match dataset values
 * 
 * @param ageGroups - Age groups extracted from query (may be lowercase or non-canonical)
 * @returns Normalized age groups matching dataset values
 */
export function normalizeAgeGroups(ageGroups: string[] | null | undefined): string[] {
  if (!ageGroups || ageGroups.length === 0) return [];
  
  const normalized = new Set<string>();
  
  for (const ageGroup of ageGroups) {
    const lower = ageGroup.toLowerCase().trim();
    
    // Check direct mapping
    if (AGE_GROUP_MAPPING[lower]) {
      AGE_GROUP_MAPPING[lower].forEach(ag => normalized.add(ag));
      continue;
    }
    
    // Check if it's already a canonical value (case-insensitive)
    const canonicalMatch = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(
      ag => ag.toLowerCase() === lower
    );
    if (canonicalMatch) {
      normalized.add(canonicalMatch);
      continue;
    }
    
    // Check partial matches for combinations
    // e.g., "kids, teen" should match "Kids, Teen"
    const parts = lower.split(',').map(p => p.trim());
    const matchedCanonical = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(ag => {
      const agParts = ag.toLowerCase().split(',').map(p => p.trim());
      return parts.every(part => agParts.some(agPart => agPart.includes(part) || part.includes(agPart)));
    });
    if (matchedCanonical) {
      normalized.add(matchedCanonical);
      continue;
    }
    
    // Fallback: try to match individual words
    // e.g., "toddler" should match "Toddler" or "Baby, Toddler"
    for (const part of parts) {
      const wordMatch = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(ag =>
        ag.toLowerCase().includes(part) || part.includes(ag.toLowerCase().split(',')[0])
      );
      if (wordMatch) {
        normalized.add(wordMatch);
      }
    }
  }
  
  return Array.from(normalized);
}

/**
 * Get all canonical age group values from the dataset
 */
export function getCanonicalAgeGroups(): readonly string[] {
  return LOVESHACKFANCY_ONTOLOGY.ageGroups;
}

/**
 * Check if an age group value is canonical (exists in dataset)
 */
export function isCanonicalAgeGroup(ageGroup: string): boolean {
  return LOVESHACKFANCY_ONTOLOGY.ageGroups.some(
    ag => ag.toLowerCase() === ageGroup.toLowerCase()
  );
}

/**
 * Validate age groups - filter to only canonical values
 * Returns empty array if no valid age groups found
 */
export function validateAgeGroups(ageGroups: string[] | null | undefined): string[] {
  if (!ageGroups || ageGroups.length === 0) return [];
  
  // Normalize first, then validate against canonical values
  const normalized = normalizeAgeGroups(ageGroups);
  
  // Filter to only canonical values
  return normalized.filter(ag => isCanonicalAgeGroup(ag));
}