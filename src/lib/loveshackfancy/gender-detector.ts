/**
 * Gender Detection & Clarification Logic
 * 
 * Detects gender from query text and determines whether to ask for clarification.
 * Used by the orchestrator to decide whether to show gender selection UI.
 */

import { getCategoryGender, type Gender } from '../catalog/category-gender-map';

/**
 * Detect gender from query text using keyword matching
 * Returns 'male', 'female', or null if ambiguous
 */
export function detectGenderFromQuery(query: string): 'male' | 'female' | null {
  const lower = query.toLowerCase();
  
  // Male indicators (check these first as they're more specific)
  const maleIndicators = [
    /\bmen'?s\b/,
    /\bfor\s+men\b/,
    /\bfor\s+him\b/,
    /\bboyfriend\b/,
    /\bhusband\b/,
    /\bfather\b/,
    /\bdad\b/,
    /\bguy\b/,
    /\bmen\b/,
    /\bman\b/,
    /\bmale\b/,
    /\bgentleman\b/,
    /\bgentlemen\b/,
  ];
  
  if (maleIndicators.some(regex => regex.test(lower))) {
    return 'male';
  }
  
  // Female indicators
  const femaleIndicators = [
    /\bwomen'?s\b/,
    /\bfor\s+women\b/,
    /\bfor\s+her\b/,
    /\bgirlfriend\b/,
    /\bwife\b/,
    /\bmother\b/,
    /\bmom\b/,
    /\blady\b/,
    /\bladies\b/,
    /\bgirl\b/,
    /\bfemale\b/,
    /\bwoman\b/,
  ];
  
  if (femaleIndicators.some(regex => regex.test(lower))) {
    return 'female';
  }
  
  return null; // Ambiguous
}

/**
 * Determine if gender clarification is needed
 *
 * Clarification rules:
 * - If classifier OR query already provides a specific gender → NO clarification.
 * - Otherwise, look at topCategories:
 *   - If ALL mapped to the same non-unisex gender (via DB-driven map / heuristics) → NO clarification.
 *   - If any category has no clear gender mapping or categories map to different genders → ASK.
 */
export function shouldClarifyGender(
  query: string,
  topCategories: string[],
  classifiedGender?: 'male' | 'female' | 'unisex' | null
): boolean {
  // 1. If classifier already determined a specific gender, no clarification needed
  if (classifiedGender && classifiedGender !== 'unisex') {
    return false;
  }
  
  // 2. If query has explicit gender signal, no clarification needed
  const detectedGender = detectGenderFromQuery(query);
  if (detectedGender) {
    return false;
  }
  
  // 3. Inspect categories using DB-driven gender map
  const genders = new Set<Gender>();
  let hasUnknownCategory = false;

  for (const category of topCategories) {
    const gender = getCategoryGender(category);
    if (!gender) {
      hasUnknownCategory = true;
      continue;
    }
    if (gender !== 'unisex') {
      genders.add(gender);
    }
  }

  // If we saw more than one concrete gender across categories → ambiguous, ask.
  if (genders.has('male') && genders.has('female')) {
    return true;
  }

  // If we have at least one clearly single-gender category and no conflicting ones,
  // treat that as inferred and skip clarification.
  if (genders.size === 1 && !hasUnknownCategory) {
    return false;
  }

  // Otherwise (only unknown/mixed/unisex categories) → ask for clarification.
  return true;
}

/**
 * Resolve final gender from multiple sources
 * Priority: classified > detected > dominant from categories
 */
export function resolveGender(
  query: string,
  topCategories: string[],
  classifiedGender?: 'male' | 'female' | 'unisex' | null
): 'male' | 'female' | 'unisex' | null {
  // 1. Detect from query keywords (latest user phrasing wins if it contradicts classifier)
  const detectedGender = detectGenderFromQuery(query);

  // If both classifier and query disagree, prefer the explicit query signal
  if (
    detectedGender &&
    classifiedGender &&
    classifiedGender !== 'unisex' &&
    detectedGender !== classifiedGender
  ) {
    return detectedGender;
  }

  // 2. If classifier already set a specific gender and query doesn't contradict, keep it
  if (classifiedGender && classifiedGender !== 'unisex') {
    return classifiedGender;
  }

  // 3. Otherwise, if query gave us a gender, use it
  if (detectedGender) {
    return detectedGender;
  }
  
  // 4. If all categories are same gender, use that as a fallback
  const genders = new Set<Gender>();
  for (const category of topCategories) {
    const catGender = getCategoryGender(category);
    if (catGender && catGender !== 'unisex') {
      genders.add(catGender);
    }
  }
  
  if (genders.size === 1) {
    return Array.from(genders)[0];
  }
  
  // 5. Mixed or unclear - return null
  return null;
}
