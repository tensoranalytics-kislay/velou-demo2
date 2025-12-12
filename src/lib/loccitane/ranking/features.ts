/**
 * Ranking Features
 * 
 * Feature engineering for ML re-ranking of L'Occitane products.
 * Builds feature vectors from query, classification, and product data.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 3.4)
 */

import type { QueryClassification } from '../classifier';
import type { StructuredLoccitaneAttributes } from '../attributeParser';
import type { SearchResultItem } from '../../search/types';
import { extractSearchableTextFromAttributes } from '../../search/utils';

/**
 * Product with guaranteed L'Occitane structured attributes
 * 
 * Extends SearchResultItem to ensure loccitaneStructured is available
 * (products without structured attributes should be filtered out before ranking)
 * 
 * Also includes Shopify fields for popularity ranking.
 */
export type ProductWithLoccitaneAttributes = SearchResultItem & {
  attributes: SearchResultItem['attributes'] & {
    loccitaneStructured: StructuredLoccitaneAttributes;
  };
  // Shopify popularity fields (from Product model)
  shopifyBestseller?: boolean;
  shopifySalesRank?: number | null;
};

export type RankingFeatures = {
  // Query-product match features
  lexicalScore: number;
  semanticSimilarity: number;
  exactTitleMatch: boolean;
  titleTokenOverlap: number; // Jaccard overlap (0-1)
  highlightsTokenOverlap: number; // Jaccard overlap (0-1)
  
  // Attribute match features
  concernsOverlap: number; // Count of matching concerns (using canonical forms)
  skinTypeMatch: number; // 1.0 if match, 0.0 otherwise
  applicationAreaMatch: number; // 1.0 if match, 0.0 otherwise
  productTypeMatch: number; // 1.0 if match, 0.0 otherwise
  ingredientMatchCount: number; // Count of matching ingredients (canonical)
  madeWithoutMatchCount: number; // Count of matching madeWithout values
  
  // Price & merch features
  priceDistance: number; // Distance from budget range (0 = in range, higher = further)
  popularityScore: number; // 0-1 normalized popularity
  isBestseller: boolean;
  inventoryStatus: number; // 1.0 in_stock, 0.5 low_stock, 0.0 out_of_stock
};

/**
 * Calculate Jaccard overlap between two sets of tokens
 * Returns ratio of intersection to union (0-1)
 */
function jaccardOverlap(tokens1: string[], tokens2: string[]): number {
  if (tokens1.length === 0 && tokens2.length === 0) return 1.0;
  if (tokens1.length === 0 || tokens2.length === 0) return 0.0;
  
  const set1 = new Set(tokens1.map(t => t.toLowerCase().trim()).filter(Boolean));
  const set2 = new Set(tokens2.map(t => t.toLowerCase().trim()).filter(Boolean));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return union.size > 0 ? intersection.size / union.size : 0.0;
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^\w]/g, ''))
    .filter(t => t.length >= 2);
}

/**
 * Build ranking features for a product
 * 
 * @param query - Original user query text
 * @param classification - Query classification with extracted constraints
 * @param product - Product with L'Occitane structured attributes
 * @param scores - Lexical and semantic scores from retrieval
 * @returns RankingFeatures vector
 */
export function buildFeatures(
  query: string,
  classification: QueryClassification,
  product: ProductWithLoccitaneAttributes,
  scores: { lexical: number; semantic: number }
): RankingFeatures {
  const structured = product.attributes.loccitaneStructured;
  const queryTokens = tokenize(query);
  const titleTokens = tokenize(product.title);
  
  // Extract highlights text
  const highlightsText = [
    product.attributes.productHighlights || '',
    ...(product.attributes.bulletHighlights || []),
  ].join(' ');
  const highlightsTokens = tokenize(highlightsText);
  
  // Query-product match features
  const lexicalScore = scores.lexical || 0.0;
  const semanticSimilarity = scores.semantic || 0.0;
  const exactTitleMatch = queryTokens.length > 0 && 
    queryTokens.every(qt => titleTokens.includes(qt));
  const titleTokenOverlap = jaccardOverlap(queryTokens, titleTokens);
  const highlightsTokenOverlap = jaccardOverlap(queryTokens, highlightsTokens);
  
  // Attribute match features (using canonical forms)
  const constraints = classification.constraints;
  
  // Concerns overlap: count matching canonical concerns
  let concernsOverlap = 0;
  if (constraints.concerns?.length && structured.canonicalConcerns.length) {
    const constraintSet = new Set(constraints.concerns.map(c => c.toLowerCase().trim()));
    const productSet = new Set(structured.canonicalConcerns.map(c => c.toLowerCase().trim()));
    concernsOverlap = [...constraintSet].filter(c => productSet.has(c)).length;
  }
  
  // Skin type match: 1.0 if any match, 0.0 otherwise
  let skinTypeMatch = 0.0;
  if (constraints.skinTypes?.length && structured.skinTypes.length) {
    const constraintSet = new Set(constraints.skinTypes.map(s => s.toLowerCase().trim()));
    const productSet = new Set(structured.skinTypes.map(s => s.toLowerCase().trim()));
    skinTypeMatch = [...constraintSet].some(s => productSet.has(s)) ? 1.0 : 0.0;
  }
  
  // Application area match: 1.0 if any match, 0.0 otherwise
  let applicationAreaMatch = 0.0;
  if (constraints.applicationAreas?.length && structured.applicationAreas.length) {
    const constraintSet = new Set(constraints.applicationAreas.map(a => a.toLowerCase().trim()));
    const productSet = new Set(structured.applicationAreas.map(a => a.toLowerCase().trim()));
    applicationAreaMatch = [...constraintSet].some(a => productSet.has(a)) ? 1.0 : 0.0;
  }
  
  // Product type match: 1.0 if match, 0.0 otherwise
  // Uses normalized product types for consistent matching
  // For gift queries, also checks title for keywords like "Duo", "Trio", "Gift Set"
  let productTypeMatch = 0.0;
  if (constraints.productTypes?.length) {
    const normalizePT = (v: string) => v.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
    const constraintSet = new Set(constraints.productTypes.map(t => normalizePT(t)));
    
    // Check structured productType if available
    if (structured.productType) {
      const productType = normalizePT(structured.productType);
      productTypeMatch = [...constraintSet].some(ct => 
        productType === ct || productType.includes(ct) || ct.includes(productType)
      ) ? 1.0 : 0.0;
    }
    
    // For gift queries, also check title for gift keywords
    if (productTypeMatch === 0.0) {
      const giftKeywords = ['duo', 'trio', 'gift', 'combo', 'set', 'kit', 'pack'];
      const requestedLower = constraints.productTypes.map(t => t.toLowerCase());
      const isGiftQuery = requestedLower.some(rt => 
        giftKeywords.some(kw => rt.includes(kw) || kw.includes(rt))
      );
      
      if (isGiftQuery && product.title) {
        const titleLower = product.title.toLowerCase();
        const hasGiftKeyword = giftKeywords.some(kw => titleLower.includes(kw));
        if (hasGiftKeyword) {
          productTypeMatch = 1.0;
        }
      }
    }
  }
  
  // Ingredient match count: count matching canonical ingredients
  let ingredientMatchCount = 0;
  if (constraints.mustHaveIngredients?.length && structured.canonicalIngredients.length) {
    const constraintSet = new Set(constraints.mustHaveIngredients.map(i => i.toLowerCase().trim()));
    const productSet = new Set(structured.canonicalIngredients.map(i => i.toLowerCase().trim()));
    ingredientMatchCount = [...constraintSet].filter(i => productSet.has(i)).length;
  }
  
  // Made without match count: count matching madeWithout values
  let madeWithoutMatchCount = 0;
  if (constraints.madeWithout?.length && structured.madeWithout.length) {
    const constraintSet = new Set(constraints.madeWithout.map(m => m.toLowerCase().trim()));
    const productSet = new Set(structured.madeWithout.map(m => m.toLowerCase().trim()));
    madeWithoutMatchCount = [...constraintSet].filter(m => productSet.has(m)).length;
  }
  
  // Price & merch features
  // Price distance: 0 if in range, positive if outside range
  let priceDistance = 0.0;
  const productPrice = product.salePriceCents || product.priceCents;
  if (constraints.priceMinCents !== undefined || constraints.priceMaxCents !== undefined) {
    const minPrice = constraints.priceMinCents || 0;
    const maxPrice = constraints.priceMaxCents || Number.MAX_SAFE_INTEGER;
    
    if (productPrice < minPrice) {
      priceDistance = (minPrice - productPrice) / 100; // Distance in dollars
    } else if (productPrice > maxPrice) {
      priceDistance = (productPrice - maxPrice) / 100; // Distance in dollars
    }
    // Normalize: cap at 50 (for very expensive items)
    priceDistance = Math.min(priceDistance, 50);
    // Convert to 0-1 scale where 0 = in range, 1 = very far
    priceDistance = priceDistance / 50.0;
  }
  
  // Popularity score: use shopifySalesRank if available (lower rank = more popular)
  // Normalize to 0-1 where 1 = most popular
  let popularityScore = 0.0;
  if (product.shopifySalesRank !== null && product.shopifySalesRank !== undefined) {
    // Rank 1 = most popular, rank 100 = less popular
    // Normalize: rank 1 → 1.0, rank 100+ → 0.0
    popularityScore = Math.max(0, 1.0 - (product.shopifySalesRank - 1) / 100.0);
  }
  
  // Bestseller flag
  const isBestseller = product.shopifyBestseller || false;
  
  // Inventory status: 1.0 in_stock, 0.5 low_stock, 0.0 out_of_stock
  let inventoryStatus = 1.0;
  if (product.stockStatus === 'low_stock') {
    inventoryStatus = 0.5;
  } else if (product.stockStatus === 'out_of_stock') {
    inventoryStatus = 0.0;
  }
  
  return {
    lexicalScore,
    semanticSimilarity,
    exactTitleMatch,
    titleTokenOverlap,
    highlightsTokenOverlap,
    concernsOverlap,
    skinTypeMatch,
    applicationAreaMatch,
    productTypeMatch,
    ingredientMatchCount,
    madeWithoutMatchCount,
    priceDistance,
    popularityScore,
    isBestseller,
    inventoryStatus,
  };
}

