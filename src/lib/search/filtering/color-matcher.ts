/**
 * Multi-Level Color Matcher
 * 
 * Matches query colors against products using a priority system:
 * 1. enriched_color (PRIMARY SOURCE) - user-friendly terms like "White, Bright White, Pure White"
 * 2. color field (FALLBACK) - single color value
 * 
 * NOTE: variant_colors is NOT used for color matching - only enriched_color and legacy color field
 * Supports partial matching and case-insensitive comparison.
 */

export type ProductColorData = {
  enrichedColor?: string | null;
  variantColors?: string[] | null; // Kept for backward compatibility but not used for matching
  color?: string | null;
};

/**
 * Match a query color against product color data
 * 
 * Uses priority order: enriched_color → color (legacy)
 * NOTE: variant_colors is intentionally excluded from matching
 * Supports partial matching (e.g., "red" matches "Bright Red", "Crimson")
 * 
 * @param product - Product color data
 * @param queryColor - Color from user query (e.g., "red", "white", "navy blue")
 * @returns true if color matches, false otherwise
 */
export function matchColor(
  product: ProductColorData,
  queryColor: string
): boolean {
  const queryLower = queryColor.toLowerCase().trim();
  
  // Priority 1: enriched_color (PRIMARY SOURCE - comma-separated user-friendly terms)
  // Example: "White, Bright White, Pure White, Snow White"
  if (product.enrichedColor) {
    const enrichedTerms = product.enrichedColor
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
    
    // Check if any enriched term matches (partial or exact)
    for (const term of enrichedTerms) {
      if (term === queryLower || 
          term.includes(queryLower) || 
          queryLower.includes(term)) {
        return true;
      }
    }
  }
  
  // Priority 2: color field (FALLBACK - legacy single color value)
  // Example: "White"
  // NOTE: variant_colors is intentionally excluded from matching
  if (product.color) {
    const colorLower = product.color.toLowerCase().trim();
    if (colorLower === queryLower || 
        colorLower.includes(queryLower) || 
        queryLower.includes(colorLower)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Match multiple query colors (OR logic)
 * 
 * Returns true if ANY of the query colors match the product
 * 
 * @param product - Product color data
 * @param queryColors - Array of colors from user query
 * @returns true if any color matches, false otherwise
 */
export function matchAnyColor(
  product: ProductColorData,
  queryColors: string[]
): boolean {
  if (queryColors.length === 0) return true; // No color constraint
  
  return queryColors.some(queryColor => matchColor(product, queryColor));
}

