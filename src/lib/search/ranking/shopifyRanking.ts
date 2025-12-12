/**
 * Shopify Ranking Boosts
 * 
 * Optional ranking boosts for Shopify-integrated products.
 * This module is completely optional - search works fine without Shopify.
 * 
 * When Shopify data is available, products can be boosted based on:
 * - Bestseller status
 * - Trending status
 * - Sales rank
 * 
 * Usage:
 * ```typescript
 * import { calculateShopifyBoost, applyShopifyBoost } from './ranking/shopifyRanking';
 * 
 * // Calculate boost for a single product
 * const boost = calculateShopifyBoost(product);
 * 
 * // Apply boosts to a list of products
 * const boosted = applyShopifyBoost(products);
 * ```
 */

import type { ProductAttributes } from '../types';

/**
 * Product with Shopify fields (optional)
 */
type ProductWithShopify = {
  shopifyBestseller?: boolean | null;
  shopifyTrending?: boolean | null;
  shopifySalesRank?: number | null;
  attributes?: ProductAttributes | null;
};

/**
 * Shopify boost multipliers
 * 
 * These values can be tuned based on A/B testing results.
 * Higher values = stronger boost
 */
const SHOPIFY_BOOSTS = {
  bestseller: 1.4, // 40% boost for bestsellers
  trending: 1.25, // 25% boost for trending products
  salesRank: 1.1, // 10% boost for products with sales rank data
} as const;

/**
 * Calculate Shopify boost for a single product
 * 
 * Returns a multiplier (1.0 = no boost, >1.0 = boosted)
 * Multiple boosts are multiplicative (e.g., bestseller + trending = 1.4 * 1.25 = 1.75)
 * 
 * @param product - Product with optional Shopify fields
 * @returns Boost multiplier (1.0 if no Shopify data or not applicable)
 * 
 * @example
 * ```typescript
 * const product = { shopifyBestseller: true, shopifyTrending: false };
 * const boost = calculateShopifyBoost(product); // Returns 1.4
 * ```
 */
export function calculateShopifyBoost(product: ProductWithShopify): number {
  let boost = 1.0;

  // Check if product has Shopify data
  // If shopifyBestseller is explicitly false, it means we checked and it's not a bestseller
  // If it's null/undefined, we don't have Shopify data, so no boost
  if (product.shopifyBestseller === true) {
    boost *= SHOPIFY_BOOSTS.bestseller;
  }

  if (product.shopifyTrending === true) {
    boost *= SHOPIFY_BOOSTS.trending;
  }

  // Sales rank boost (weaker, but indicates product has sales data)
  if (product.shopifySalesRank !== null && product.shopifySalesRank !== undefined) {
    boost *= SHOPIFY_BOOSTS.salesRank;
  }

  return boost;
}

/**
 * Apply Shopify boosts to a list of products
 * 
 * This multiplies each product's relevance score by its Shopify boost.
 * Products without Shopify data are unchanged (boost = 1.0).
 * 
 * @param products - Array of products with scores and optional Shopify fields
 * @returns Products with boosted scores
 * 
 * @example
 * ```typescript
 * const products = [
 *   { product: {...}, score: 10.0, shopifyBestseller: true },
 *   { product: {...}, score: 8.0, shopifyBestseller: false },
 * ];
 * const boosted = applyShopifyBoost(products);
 * // First product: score = 10.0 * 1.4 = 14.0
 * // Second product: score = 8.0 * 1.0 = 8.0
 * ```
 */
export function applyShopifyBoost<T extends { product: ProductWithShopify; score: number }>(
  products: T[]
): T[] {
  return products.map((item) => {
    const boost = calculateShopifyBoost(item.product);
    return {
      ...item,
      score: item.score * boost,
    };
  });
}

/**
 * Check if a product has Shopify integration data
 * 
 * @param product - Product to check
 * @returns true if product has any Shopify fields populated
 */
export function hasShopifyData(product: ProductWithShopify): boolean {
  return (
    product.shopifyBestseller === true ||
    product.shopifyTrending === true ||
    (product.shopifySalesRank !== null && product.shopifySalesRank !== undefined)
  );
}


