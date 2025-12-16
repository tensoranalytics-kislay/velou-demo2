/**
 * Template-Based Product Card Reasons
 * 
 * Generates product card "Chosen because..." reasons without LLM calls.
 * Uses product attributes and templates for instant results.
 */

import type { ProductAttributes } from '../search/types';

/**
 * Build a rule-based reason for why a product matches the query
 */
export function buildProductReason(
  product: {
    title: string;
    attributes: ProductAttributes;
  },
  query: string,
  constraints?: {
    productType?: string;
    collection?: string;
    concern?: string;
  },
): string {
  const attrs = product.attributes || {};
  const lowerQuery = query.toLowerCase();
  const lowerTitle = product.title.toLowerCase();
  
  // Extract key attributes
  const collection = (attrs as any).Collection?.[0] || (attrs as any).collection;
  const benefits = (attrs as any).Benefits || (attrs as any).benefits || [];
  const ingredients = (attrs as any).FeaturedIngredients || (attrs as any).featuredIngredients || [];
  const concern = (attrs as any).Concern?.[0] || (attrs as any).concern;
  
  // Template 1: Collection match
  if (collection && (lowerQuery.includes(collection.toLowerCase()) || constraints?.collection === collection)) {
    const ingredient = ingredients[0];
    if (ingredient) {
      return `From our ${collection} collection with ${ingredient}`;
    }
    return `From our ${collection} collection`;
  }
  
  // Template 2: Concern match (dryness, aging, etc.)
  if (constraints?.concern || concern) {
    const targetConcern = constraints?.concern || concern;
    const matchingBenefit = benefits.find((b: string) => 
      b.toLowerCase().includes(targetConcern.toLowerCase()) ||
      (targetConcern === 'dryness' && b.toLowerCase().includes('hydrat')) ||
      (targetConcern === 'aging' && b.toLowerCase().includes('aging'))
    );
    
    if (matchingBenefit && ingredients[0]) {
      return `${matchingBenefit} with ${ingredients[0]}`;
    }
    if (matchingBenefit) {
      return matchingBenefit;
    }
  }
  
  // Template 3: Benefit + ingredient
  if (benefits.length > 0 && ingredients.length > 0) {
    const topBenefit = benefits[0];
    const topIngredient = ingredients[0];
    if (topBenefit && topIngredient) {
      return `${topBenefit} with ${topIngredient}`;
    }
  }
  
  // Template 4: Just benefit
  if (benefits.length > 0) {
    return benefits[0];
  }
  
  // Template 5: Collection or ingredient
  if (collection) {
    return `From our ${collection} collection`;
  }
  if (ingredients.length > 0) {
    return `Enriched with ${ingredients[0]}`;
  }
  
  // Fallback: Generic
  if (constraints?.productType) {
    return `Quality ${constraints.productType.toLowerCase()} from L'Occitane`;
  }
  
  return `Quality skincare from L'Occitane`;
}

/**
 * Build reasons for multiple products (batch processing)
 */
export function buildProductReasonsBatch(
  products: Array<{
    id: string;
    title: string;
    attributes: ProductAttributes;
  }>,
  query: string,
  constraints?: {
    productType?: string;
    collection?: string;
    concern?: string;
  },
): Map<string, string> {
  const reasons = new Map<string, string>();
  
  for (const product of products) {
    const reason = buildProductReason(product, query, constraints);
    reasons.set(product.id, reason);
  }
  
  return reasons;
}






