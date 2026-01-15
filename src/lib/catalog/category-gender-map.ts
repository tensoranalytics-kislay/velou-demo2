/**
 * Category to Gender Mapping
 *
 * This file provides helpers for gender-aware logic based on the actual
 * catalog in the database.
 *
 * We populate CATEGORY_GENDER_MAP from a generated JSON file which is built
 * by inspecting the Product table and finding categories where >95% of
 * active products share the same gender. Everything else is treated as
 * mixed/ambiguous and should trigger clarification when gender is unknown.
 *
 * Gender values:
 * - 'male': Men's products
 * - 'female': Women's products
 * - 'unisex': Gender-neutral products (e.g. genuinely unisex categories)
 */

import generatedMap from './category-gender-map.generated.json';

export type Gender = 'male' | 'female' | 'unisex';

// Loaded from DB-driven generation script. Keys are category strings as
// stored in the Product.category column, values are dominant genders for
// categories where a single gender accounts for > 95% of products.
export const CATEGORY_GENDER_MAP: Record<string, Gender> = generatedMap as Record<string, Gender>;

/**
 * Get gender for a category
 * Returns the mapped gender or null if category is not in the map
 */
export function getCategoryGender(category: string): Gender | null {
  const direct = CATEGORY_GENDER_MAP[category];
  if (direct) {
    return direct;
  }

  const lowerCategory = category.toLowerCase();
  const lowerDirect = CATEGORY_GENDER_MAP[lowerCategory];
  if (lowerDirect) {
    return lowerDirect;
  }

  // Fallback heuristics for obviously gendered labels that may not yet
  // have enough data to cross the 95% DB threshold.
  if (lowerCategory.includes('mens') || lowerCategory.includes("men's")) {
    return 'male';
  }
  if (lowerCategory.includes('womens') || lowerCategory.includes("women's")) {
    return 'female';
  }
  if (lowerCategory.includes('girls') || lowerCategory.includes('tween')) {
    return 'female';
  }
  if (lowerCategory.includes('baby') || lowerCategory.includes('toddler')) {
    return 'unisex';
  }

  return null; // Unknown / mixed category
}

/**
 * Check if a set of categories spans multiple genders
 * Returns true if categories contain both male and female products
 */
export function categoriesSpanMultipleGenders(categories: string[]): boolean {
  const genders = new Set<Gender>();
  
  for (const category of categories) {
    const gender = getCategoryGender(category);
    if (gender && gender !== 'unisex') {
      genders.add(gender);
    }
  }
  
  // Return true if we have both male and female
  return genders.has('male') && genders.has('female');
}

/**
 * Get the dominant gender from a list of categories
 * Returns 'male', 'female', or null if mixed/unclear
 */
export function getDominantGender(categories: string[]): Gender | null {
  const genders = new Set<Gender>();
  
  for (const category of categories) {
    const gender = getCategoryGender(category);
    if (gender && gender !== 'unisex') {
      genders.add(gender);
    }
  }
  
  // If only one gender (excluding unisex), return it
  if (genders.size === 1) {
    return Array.from(genders)[0];
  }
  
  // Mixed or no clear gender
  return null;
}
