/**
 * Dynamic Take Calculation
 * 
 * Determines how many products to fetch from the database based on query breadth.
 * Broader queries need larger slices to ensure recall.
 * 
 * This is a performance optimization - fetching too many products is slow,
 * but fetching too few can miss relevant results.
 */

// Dynamic take constants for ~13k catalog
const BASE_TAKE_MULTIPLIER = 50; // base * limit
const MIN_TAKE = 300;
const MAX_TAKE = 2500; // safe for 13k catalog

import type { SearchConstraints } from '../types';

/**
 * Calculate dynamic take based on query breadth
 * 
 * Adaptive candidate take for full DB coverage.
 * Determines dynamic take based on query breadth.
 * Broader queries need larger slices to ensure recall.
 * 
 * @param constraints - Search constraints
 * @param limit - Desired result limit
 * @param hardTextFilters - Optional hard text filter keywords
 * @returns Number of products to fetch from database
 * 
 * @example
 * ```typescript
 * const take = calculateDynamicTake(constraints, 8, keywordFilters);
 * // Returns 400-2500 depending on query breadth
 * ```
 */
export function calculateDynamicTake(
  constraints: SearchConstraints,
  limit: number,
  hardTextFilters: string[] | undefined,
): number {
  const base = limit * BASE_TAKE_MULTIPLIER;
  let take = Math.max(base, MIN_TAKE);

  // If category is missing or query text is short/ambiguous, increase take
  const isBroadQuery =
    !constraints.category &&
    !constraints.brands?.length &&
    !constraints.priceMinCents &&
    !constraints.priceMaxCents &&
    (!constraints.query || constraints.query.trim().length < 10);

  // If we have hard text filters (category missing but keywords detected), increase take
  const hasHardTextFilters = hardTextFilters && hardTextFilters.length > 0;
  const needsWiderSearch = !constraints.category || hasHardTextFilters;

  if (isBroadQuery || needsWiderSearch) {
    // For broad queries or when category is missing, use larger take
    // But still cap to avoid perf blowups
    take = Math.min(MAX_TAKE, Math.max(take, 1500)); // At least 1500 for broad queries
  } else {
    // For specific categories, keep current tight take
    take = Math.min(take, MAX_TAKE);
  }

  return take;
}


