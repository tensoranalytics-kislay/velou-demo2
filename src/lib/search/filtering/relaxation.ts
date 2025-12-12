/**
 * Constraint Relaxation
 * 
 * Implements constraint relaxation logic for when strict filters eliminate all candidates.
 * Relaxation happens in tiers:
 * - Tier 1: Drop optional attributes (colors, fabrics, materials, etc.)
 * - Tier 2: Drop category and price, keep only query
 * - Tier 3: Drop everything except query and stock filter
 * 
 * This ensures we always return some results when possible, even if they don't match all constraints.
 */

import type { SearchConstraints } from '../types';

/**
 * Drop attribute filters (Tier 1 relaxation)
 * 
 * Removes optional attribute filters while preserving core requirements.
 * Preserves useCases, benefits, and compatibility as these are often core requirements.
 * 
 * @param constraints - Original constraints
 * @returns Relaxed constraints with attributes dropped
 */
export function dropAttributeFilters(constraints: SearchConstraints): SearchConstraints {
  const relaxed = { ...constraints };
  relaxed.colors = undefined;
  relaxed.fabrics = undefined;
  relaxed.materials = undefined;
  relaxed.sizes = undefined;
  relaxed.occasions = undefined;
  relaxed.seasons = undefined;
  // Preserve user-explicitly-requested filters: useCases, benefits, compatibility
  // These are often core requirements (e.g., "for dry hair", "for sensitive skin")
  // relaxed.useCases = undefined; // Keep useCases
  // relaxed.benefits = undefined; // Keep benefits
  // relaxed.compatibility = undefined; // Keep compatibility
  // New unified catalog attributes
  relaxed.styleTags = undefined;
  relaxed.sensoryProfile = undefined; // Can be relaxed as it's often stylistic
  relaxed.productTypes = undefined;
  relaxed.googleCategories = undefined;
  relaxed.customLabels4 = undefined;
  relaxed.conditions = undefined;
  relaxed.ageGroups = undefined;
  // DO NOT drop genders - they should persist through relaxation
  // relaxed.genders = undefined;
  relaxed.brands = undefined;
  relaxed.fit = undefined;
  return relaxed;
}

/**
 * Keep only category and price (Tier 2 relaxation)
 * 
 * Drops all attributes, keeping only category, price, and stock filter.
 * 
 * @param constraints - Original constraints
 * @returns Relaxed constraints with only category and price
 */
export function keepOnlyCategoryAndPrice(constraints: SearchConstraints): SearchConstraints {
  const relaxed: SearchConstraints = {
    inStockOnly: constraints.inStockOnly,
    category: constraints.category,
    priceMinCents: constraints.priceMinCents,
    priceMaxCents: constraints.priceMaxCents,
    query: constraints.query,
  };
  return relaxed;
}

/**
 * Keep only query (Tier 3 relaxation)
 * 
 * Drops everything except the query text and stock filter.
 * This is the most relaxed tier - only text search remains.
 * 
 * @param constraints - Original constraints
 * @returns Relaxed constraints with only query
 */
export function keepOnlyQuery(constraints: SearchConstraints): SearchConstraints {
  return {
    inStockOnly: constraints.inStockOnly,
    query: constraints.query,
  };
}

/**
 * Relaxation steps in order
 * 
 * These functions are applied in sequence when strict search returns no results.
 */
export const RELAXATION_STEPS = [
  dropAttributeFilters,
  keepOnlyCategoryAndPrice,
  keepOnlyQuery,
] as const;


