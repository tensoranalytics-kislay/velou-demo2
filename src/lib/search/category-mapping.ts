import type { CategoryProfile } from './canonicalize';

/**
 * Base canonical-to-DB mapping (empty by default; used for optional profiles).
 */
const BASE_CANONICAL_TO_DB: Record<string, string[]> = {};

/**
 * Fashion-specific canonical mapping retained for merchants that opt into the fashion profile.
 */
const FASHION_CANONICAL_TO_DB: Record<string, string[]> = {
  'shirts & tops': ['shirts', 'tops', 't-shirts', 'tees', 'blouses', 'shirts & tops'],
  'tshirt': ['t-shirts', 'tees', 't shirt', 'tshirt', 'solid t shirts'],
  't-shirt': ['t-shirts', 'tees', 't shirt', 'tshirt'],
  'tee': ['tees', 't-shirts', 't shirt', 'tshirt'],
  'tees': ['tees', 't-shirts', 't shirt', 'tshirt'],
  'graphic t shirt': ['graphic t shirt', 'graphic t-shirts', 'graphic tees'],
  'graphic tee': ['graphic t shirt', 'graphic t-shirts', 'graphic tees'],
  'graphic tshirt': ['graphic t shirt', 'graphic t-shirts', 'graphic tees'],
  'shirt': ['shirts', 'shirts & tops'],
  'shirts': ['shirts', 'shirts & tops'],
  'top': ['tops', 'shirts & tops'],
  'tops': ['tops', 'shirts & tops'],
  'jeans': ['jeans', 'denim'],
  'pants': ['pants', 'trousers'],
  'dresses': ['dresses', 'gowns'],
  'skirts': ['skirts'],
  'shorts': ['shorts'],
  'jackets': ['jackets', 'outerwear', 'coats'],
  'outerwear': ['outerwear', 'jackets', 'coats'],
  'shoes': ['shoes', 'sneakers', 'boots', 'sandals'],
  'accessories': ['bags', 'belts', 'hats', 'scarves', 'jewelry'],
};

/**
 * Expands a canonical category (or array of categories) to DB category list
 * If input is already a DB category, returns it as-is
 */
export function expandCanonicalToDbCategories(
  category: string | string[] | undefined,
  profile?: CategoryProfile | null,
): string[] {
  if (!category) return [];
  
  const categories = Array.isArray(category) ? category : [category];
  const expanded = new Set<string>();
  const mapping =
    profile?.name === 'fashion'
      ? FASHION_CANONICAL_TO_DB
      : BASE_CANONICAL_TO_DB;
  
  for (const cat of categories) {
    const normalized = cat.toLowerCase().trim();
    
    // Check if it's a canonical that needs mapping
    if (mapping[normalized]) {
      for (const dbCat of mapping[normalized]) {
        expanded.add(dbCat);
      }
    } else {
      // Assume it's already a DB category or close enough
      expanded.add(normalized);
    }
  }
  
  return Array.from(expanded);
}

/**
 * Parses comma-separated category string into array
 * Handles multi-category outfit requests
 */
export function parseCategoryString(category: string | string[] | undefined): string[] {
  if (!category) return [];
  if (Array.isArray(category)) return category;
  
  // Split by comma and clean
  return category
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);
}

