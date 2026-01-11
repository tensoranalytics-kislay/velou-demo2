/**
 * Age Group Matcher
 * 
 * Matches query age groups against product age groups with hierarchical matching.
 * Supports:
 * - Exact match: "Adult" matches "Adult"
 * - Hierarchical: "Adult" includes "18+ years"
 * - Multiple values: "Kids, Teen" matches both "Kids" and "Teen"
 * - Age ranges: "2-3 years" matches "Baby, Toddler" (overlap logic)
 */

/**
 * Match a query age group against product age group
 * 
 * @param productAgeGroup - Product age group (e.g., "Adult", "Kids", "Baby, Toddler", "18+ years")
 * @param queryAgeGroup - Age group from user query (e.g., "adult", "kids", "5-year-old")
 * @returns true if age groups match, false otherwise
 */
export function matchAgeGroup(
  productAgeGroup: string | null | undefined,
  queryAgeGroup: string
): boolean {
  if (!productAgeGroup) return false;
  
  const productLower = productAgeGroup.toLowerCase().trim();
  const queryLower = queryAgeGroup.toLowerCase().trim();
  
  // Exact match (case-insensitive)
  if (productLower === queryLower) return true;
  
  // Hierarchical matching: "Adult" includes "18+ years", "18+", etc.
  if (queryLower === 'adult' || queryLower.includes('adult')) {
    if (productLower === 'adult' || 
        productLower.includes('18+') || 
        productLower.includes('adult')) {
      return true;
    }
  }
  
  // "Kids" includes "Children", "Child", age ranges like "4-5 years", "6-8 years"
  if (queryLower === 'kids' || queryLower === 'children' || queryLower === 'child') {
    if (productLower.includes('kids') || 
        productLower.includes('children') || 
        productLower.includes('child') ||
        /^\d+-\d+\s*years?/.test(productLower)) { // Age ranges like "4-5 years"
      return true;
    }
  }
  
  // "Baby" or "Toddler" matching
  if (queryLower === 'baby' || queryLower === 'toddler' || queryLower === 'infant') {
    if (productLower.includes('baby') || 
        productLower.includes('toddler') || 
        productLower.includes('infant')) {
      return true;
    }
  }
  
  // "Teen" or "Teenager" matching (typically maps to Adult categories in dataset)
  if (queryLower === 'teen' || queryLower === 'teenager' || queryLower.includes('teen')) {
    if (productLower.includes('teen') || 
        productLower.includes('teenager') ||
        productLower === 'adult') { // Teens use adult categories
      return true;
    }
  }
  
  // Multiple values: "Kids, Teen" matches both "Kids" and "Teen"
  const productGroups = productLower.split(',').map(g => g.trim());
  if (productGroups.includes(queryLower)) return true;
  
  // Partial match: query "5-year-old" matches product "Kids" or "4-5 years"
  if (queryLower.includes('year') || queryLower.includes('old')) {
    // Extract age number from query (e.g., "5-year-old" → 5)
    const ageMatch = queryLower.match(/(\d+)/);
    if (ageMatch) {
      const queryAge = parseInt(ageMatch[1], 10);
      
      // Check if product has age range that includes this age
      for (const group of productGroups) {
        // Match age ranges like "4-5 years", "6-8 years"
        const rangeMatch = group.match(/(\d+)-(\d+)\s*years?/);
        if (rangeMatch) {
          const minAge = parseInt(rangeMatch[1], 10);
          const maxAge = parseInt(rangeMatch[2], 10);
          if (queryAge >= minAge && queryAge <= maxAge) {
            return true;
          }
        }
        
        // Match single age like "5 years"
        const singleAgeMatch = group.match(/^(\d+)\s*years?$/);
        if (singleAgeMatch) {
          const productAge = parseInt(singleAgeMatch[1], 10);
          if (Math.abs(queryAge - productAge) <= 1) { // Allow ±1 year tolerance
            return true;
          }
        }
      }
      
      // Age-based category matching
      if (queryAge < 2 && (productLower.includes('baby') || productLower.includes('infant'))) {
        return true;
      }
      if (queryAge >= 2 && queryAge < 13 && (productLower.includes('kids') || productLower.includes('children'))) {
        return true;
      }
      if (queryAge >= 13 && queryAge < 18 && (productLower.includes('teen') || productLower === 'adult')) {
        return true;
      }
      if (queryAge >= 18 && (productLower === 'adult' || productLower.includes('18+'))) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Match multiple query age groups (OR logic)
 * 
 * Returns true if ANY of the query age groups match the product
 * 
 * @param productAgeGroup - Product age group
 * @param queryAgeGroups - Array of age groups from user query
 * @returns true if any age group matches, false otherwise
 */
export function matchAnyAgeGroup(
  productAgeGroup: string | null | undefined,
  queryAgeGroups: string[]
): boolean {
  if (queryAgeGroups.length === 0) return true; // No age constraint
  
  return queryAgeGroups.some(queryAgeGroup => matchAgeGroup(productAgeGroup, queryAgeGroup));
}


