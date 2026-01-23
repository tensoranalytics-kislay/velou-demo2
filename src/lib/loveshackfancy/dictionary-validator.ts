/**
 * Dictionary Validator
 * 
 * Validates and filters constraints to ONLY use values from the dataset dictionary.
 * This ensures classification results match exact dataset values before filtering.
 */

import { LOVESHACKFANCY_ONTOLOGY } from './ontology';

/**
 * Validate age groups against dataset dictionary
 * Returns only values that exist in the ontology
 */
export function validateAgeGroups(ageGroups: string[] | null | undefined): string[] {
  if (!ageGroups || ageGroups.length === 0) return [];
  
  const validAgeGroups: string[] = [];
  const ontologyAgeGroupsLower = LOVESHACKFANCY_ONTOLOGY.ageGroups.map(ag => ag.toLowerCase());
  
  for (const ageGroup of ageGroups) {
    const ageGroupLower = ageGroup.toLowerCase();
    // Find exact match in ontology (case-insensitive)
    const match = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(
      ag => ag.toLowerCase() === ageGroupLower
    );
    if (match) {
      validAgeGroups.push(match); // Use canonical value from ontology
    } else {
      // Check if it's a combination (e.g., "Baby, Toddler")
      const parts = ageGroup.split(',').map(p => p.trim());
      const matchedParts: string[] = [];
      for (const part of parts) {
        const partMatch = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(
          ag => ag.toLowerCase() === part.toLowerCase()
        );
        if (partMatch) {
          matchedParts.push(partMatch);
        }
      }
      // If all parts match, check if the combination exists in ontology
      if (matchedParts.length === parts.length) {
        const combination = matchedParts.join(', ');
        const combinationMatch = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(
          ag => ag.toLowerCase() === combination.toLowerCase()
        );
        if (combinationMatch) {
          validAgeGroups.push(combinationMatch);
        }
      }
    }
  }
  
  return Array.from(new Set(validAgeGroups)); // Remove duplicates
}

/**
 * Validate colors against dataset dictionary
 * Returns only values that exist in the constraint dictionary (not ontology)
 * Uses flexible matching like validateConstraintValues
 */
export function validateColors(colors: string[] | null | undefined): string[] {
  if (!colors || colors.length === 0) return [];
  
  // Use validateConstraintValues for colors to get exact dictionary values
  // This ensures we use the actual constraint dictionary, not the ontology
  const { validateConstraintValues } = require('./dictionary-matcher');
  const validated = validateConstraintValues('colors', colors);
  
  return validated || [];
}

/**
 * Validate categories against dataset dictionary
 * Returns only values that exist in the ontology or known category list
 * 
 * Note: Categories are not in the ontology, so we validate against a known list
 * This should be updated with actual categories from the dataset
 */
export function validateCategories(categories: string[] | null | undefined): string[] {
  if (!categories || categories.length === 0) return [];
  
  // Known categories from the dataset (should be extracted from actual data)
  // For now, we'll do case-insensitive matching and return as-is if it looks valid
  // TODO: Extract actual category list from database
  const validCategories: string[] = [];
  
  for (const category of categories) {
    // Basic validation: non-empty, reasonable length
    if (category && category.trim().length > 0 && category.length < 100) {
      validCategories.push(category.trim());
    }
  }
  
  return Array.from(new Set(validCategories)); // Remove duplicates
}

/**
 * Validate all constraints against dataset dictionaries
 * This should be called BEFORE filtering to ensure only dictionary values are used
 */
export function validateConstraints(constraints: {
  ageGroups?: string[] | null;
  colors?: string[] | null;
  categories?: string[] | null;
}): {
  ageGroups: string[];
  colors: string[];
  categories: string[];
} {
  return {
    ageGroups: validateAgeGroups(constraints.ageGroups),
    colors: validateColors(constraints.colors),
    categories: validateCategories(constraints.categories),
  };
}


