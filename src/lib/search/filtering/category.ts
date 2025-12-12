/**
 * Category Matching
 * 
 * Handles category and subcategory matching logic.
 * Supports both exact matching and broader matching (substring, canonical categories).
 * 
 * This module is primarily used by the query building layer to construct
 * category filters for database queries.
 */

/**
 * Check if a product's category matches the constraint
 * 
 * Supports:
 * - Exact match
 * - Substring match (case-insensitive)
 * - Subcategory matching
 * 
 * @param productCategory - Product's category
 * @param productSubcategory - Product's subcategory (optional)
 * @param constraintCategory - Category constraint to match
 * @returns true if product matches category constraint
 */
export function matchCategory(
  productCategory: string,
  productSubcategory: string | null | undefined,
  constraintCategory: string | string[] | undefined,
): boolean {
  if (!constraintCategory) return true; // No constraint = match all

  const categories = Array.isArray(constraintCategory) ? constraintCategory : [constraintCategory];
  const productCatLower = productCategory.toLowerCase();
  const productSubcatLower = productSubcategory?.toLowerCase() || '';

  return categories.some((cat) => {
    const catLower = cat.toLowerCase();
    // Exact match
    if (productCatLower === catLower || productSubcatLower === catLower) return true;
    // Substring match
    if (productCatLower.includes(catLower) || catLower.includes(productCatLower)) return true;
    if (productSubcatLower.includes(catLower) || catLower.includes(productSubcatLower)) return true;
    return false;
  });
}


