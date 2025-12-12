/**
 * Normalization utilities for L'Occitane product attributes
 * 
 * Provides consistent normalization for product types, ingredients, and other
 * attributes to enable accurate filtering and matching.
 */

/**
 * Normalize product type value for consistent matching
 * 
 * Maps common phrasings to canonical product type values used in the catalog.
 * Based on actual productType values from loccitaneStructured.
 * 
 * Handles both:
 * - Catalog values: "Hand Care", "Body Care" (with spaces)
 * - Classifier outputs: "hand_cream", "hand cream", "handCare"
 * 
 * Returns normalized value that can be compared for matching.
 */
export function normalizeProductType(value: string): string {
  if (!value) return '';
  
  // Normalize: lowercase, trim, collapse whitespace, replace spaces with underscore
  // This handles both "Hand Care" (catalog) and "hand_cream" (classifier) formats
  let normalized = value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_') // Replace all whitespace with underscore
    .replace(/[^\w_]/g, ''); // Remove non-word chars except underscore
  
  // Map common synonyms to actual catalog values
  // Based on actual productType values from catalog: Hand Care, Body Care, Lip Care, etc.
  // Note: Catalog uses values like "Hand Care", "Body Care", "Facial Cleanser", etc.
  // We normalize both user inputs and catalog values for comparison
  const typeMappings: Record<string, string> = {
    // Hand products -> Hand Care
    'hand_cream': 'hand_care',
    'handcreme': 'hand_care',
    'hand_balm': 'hand_care',
    'hand_care': 'hand_care',
    
    // Body products -> Body Care
    'body_oil': 'body_care',
    'body_lotion': 'body_care',
    'body_cream': 'body_care',
    'body_care': 'body_care',
    'body_balm': 'body_care',
    'body_wash': 'body_care',
    'liquid_soap': 'body_care', // Map liquid soap to body_care (shower/bath)
    'hand_wash': 'body_care',
    'soap': 'body_care',
    'shower_gel': 'body_care',
    'shower_oil': 'body_care',
    
    // Lip products -> Lip Care
    'lip_balm': 'lip_care',
    'lip_care': 'lip_care',
    'lip_stick': 'lip_care',
    'lip_gloss': 'lip_care',
    
    // Face products
    'face_serum': 'face_moisturizer',
    'serum': 'face_moisturizer',
    'face_cream': 'face_moisturizer',
    'face_moisturizer': 'face_moisturizer',
    'facial_cleanser': 'facial_cleanser',
    'face_cleanser': 'facial_cleanser',
    'cleanser': 'facial_cleanser',
    
    // Hair products
    'shampoo': 'shampoo',
    'conditioner': 'conditioner',
    'hair_treatment': 'hair_treatment',
    'scalp_treatment': 'scalp_treatment',
    
    // Eye products -> Eye Care
    'eye_cream': 'eye_care',
    'eye_care': 'eye_care',
    
    // Shaving products
    'shaving_cream': 'shaving_cream',
    'shaving_gel': 'shaving_gel',
    'shaving_balm': 'shaving_balm',
    'shaving_soap': 'shaving_soap',
    
    // Other
    'toner': 'toner',
    'perfume': 'perfume',
  };
  
  // Check for exact match first
  if (typeMappings[normalized]) {
    return typeMappings[normalized];
  }
  
  // Check for partial matches (e.g., "hand" in "hand_care", "liquid" in "liquid_soap")
  // Also handle cases where catalog value might be "Hand Care" (two words) vs "hand_cream" (user input)
  for (const [key, mapped] of Object.entries(typeMappings)) {
    // Check if normalized input contains the key or vice versa
    if (normalized.includes(key) || key.includes(normalized)) {
      return mapped;
    }
    // Also check if they share significant words (e.g., "hand" and "hand_care")
    const inputWords = normalized.split('_');
    const keyWords = key.split('_');
    const hasSharedWord = inputWords.some(w => keyWords.includes(w) && w.length > 2);
    if (hasSharedWord) {
      return mapped;
    }
  }
  
  // If no mapping found, return normalized value (will be compared as-is)
  return normalized;
}

/**
 * Normalize ingredient name for consistent matching
 * 
 * Lowercases, trims, removes common punctuation, but keeps enough detail
 * for substring matching to work.
 */
export function normalizeIngredient(value: string): string {
  if (!value) return '';
  
  return value
    .toLowerCase()
    .trim()
    .replace(/[%()]/g, '') // Remove % and parentheses
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/\s*,\s*/g, ' '); // Replace commas with space
}

/**
 * Normalize avoid ingredients list
 * 
 * Maps common ingredient avoidance terms to searchable forms.
 * Handles synonyms like "sulfates" / "sls" / "sodium lauryl sulfate".
 */
export function normalizeAvoidIngredients(avoid: string[]): string[] {
  if (!avoid || avoid.length === 0) return [];
  
  const normalized: string[] = [];
  
  for (const term of avoid) {
    const norm = normalizeIngredient(term);
    if (!norm) continue;
    
    // Map common synonyms
    // "sulfates" -> "sulfate" (to catch "Sodium Laureth Sulfate", "SLS", etc.)
    if (norm.includes('sulfate')) {
      normalized.push('sulfate');
    }
    // "parabens" -> "paraben"
    else if (norm.includes('paraben')) {
      normalized.push('paraben');
    }
    // "alcohol" -> "alcohol" (but might want to exclude "fatty alcohols" - for now keep simple)
    else if (norm.includes('alcohol') && !norm.includes('fatty')) {
      normalized.push('alcohol');
    }
    // "sls" -> "sulfate"
    else if (norm === 'sls' || norm.includes('sodium lauryl')) {
      normalized.push('sulfate');
    }
    // "sles" -> "sulfate"
    else if (norm === 'sles' || norm.includes('sodium laureth')) {
      normalized.push('sulfate');
    }
    // "phthalates" -> "phthalate"
    else if (norm.includes('phthalate')) {
      normalized.push('phthalate');
    }
    // Keep other terms as-is (normalized)
    else {
      normalized.push(norm);
    }
  }
  
  // Deduplicate
  return Array.from(new Set(normalized));
}

