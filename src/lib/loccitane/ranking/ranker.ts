/**
 * Product Ranker
 * 
 * Heuristic-based scoring for ranking L'Occitane products.
 * Can be replaced with ML model (XGBoost/LightGBM) in future.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 3.4)
 */

import type { RankingFeatures, ProductWithLoccitaneAttributes } from './features';

// Re-export for external use
export type { ProductWithLoccitaneAttributes };
import { buildFeatures } from './features';
import type { QueryClassification } from '../classifier';
import { logger } from '../../telemetry/logger';

/**
 * Score a product using heuristic weights
 * 
 * Weights are adjusted based on query type:
 * - symptom_concern: High weight on concerns, skinType, applicationArea
 * - ingredient_exploration: High weight on ingredients
 * - direct_product_search: High weight on title match, productType
 * - gift_or_vague: Balanced weights, boost for popularity
 * 
 * TODO: Replace with ML model (XGBoost/LightGBM via ONNX) trained on click/purchase data
 * 
 * @param features - Ranking features for the product
 * @param queryType - Query classification type
 * @returns Score (higher = better match)
 */
export function scoreProduct(
  features: RankingFeatures,
  queryType: QueryClassification['type'] = 'direct_product_search'
): number {
  let score = 0.0;
  
  // Base weights (adjust based on query type)
  let concernWeight = 10.0;
  let skinTypeWeight = 8.0;
  let applicationAreaWeight = 8.0;
  let ingredientWeight = 8.0;
  let productTypeWeight = 6.0;
  let lexicalWeight = 5.0;
  let semanticWeight = 5.0;
  let titleMatchWeight = 8.0;
  let madeWithoutWeight = 3.0;
  let popularityWeight = 3.0; // Default popularity weight
  
  // Adjust weights based on query type
  switch (queryType) {
    case 'symptom_concern':
      // For concern-based queries, concerns and skin types matter most
      concernWeight = 15.0;
      skinTypeWeight = 12.0;
      applicationAreaWeight = 10.0;
      ingredientWeight = 4.0; // Less important for concern queries
      productTypeWeight = 4.0;
      break;
      
    case 'ingredient_exploration':
      // For ingredient queries, ingredients matter most
      ingredientWeight = 15.0;
      concernWeight = 5.0;
      skinTypeWeight = 4.0;
      productTypeWeight = 6.0;
      break;
      
    case 'direct_product_search':
      // For direct searches, title match and product type matter most
      titleMatchWeight = 12.0;
      productTypeWeight = 10.0;
      lexicalWeight = 8.0;
      semanticWeight = 8.0;
      concernWeight = 5.0;
      break;
      
    case 'gift_or_vague':
      // For vague queries, popularity and general features matter
      // Boost gift-like product types (Duo, Trio, Gift Set) for gift queries
      popularityWeight = 8.0;
      lexicalWeight = 6.0;
      semanticWeight = 6.0;
      concernWeight = 4.0;
      productTypeWeight = 8.0; // Boost product type matching for gift queries
      break;
      
    case 'unrelated':
      // Should not reach here, but default weights
      break;
  }
  
  // Query-product match features
  score += features.lexicalScore * lexicalWeight;
  score += features.semanticSimilarity * semanticWeight;
  score += (features.exactTitleMatch ? 1.0 : 0.0) * titleMatchWeight;
  score += features.titleTokenOverlap * (titleMatchWeight * 0.5); // Partial title match gets half weight
  score += features.highlightsTokenOverlap * 2.0; // Highlights matches are valuable but not as strong as title
  
  // Attribute match features
  score += features.concernsOverlap * concernWeight;
  score += features.skinTypeMatch * skinTypeWeight;
  score += features.applicationAreaMatch * applicationAreaWeight;
  score += features.productTypeMatch * productTypeWeight;
  score += features.ingredientMatchCount * ingredientWeight;
  score += features.madeWithoutMatchCount * madeWithoutWeight;
  
  // Price & merch features
  // Penalize products outside budget (negative weight)
  score -= features.priceDistance * 5.0; // Strong penalty for out-of-budget items
  
  // Popularity boost (weight already set based on query type)
  score += features.popularityScore * popularityWeight;
  score += (features.isBestseller ? 1.0 : 0.0) * 2.0; // Small boost for bestsellers
  
  // Gift-type boost: for gift_or_vague queries, boost products with gift keywords in title
  if (queryType === 'gift_or_vague') {
    // Check if product title contains gift-related keywords (handled in productTypeMatch)
    // The boost is already applied via productTypeWeight above
  }
  
  // Inventory status: strong preference for in-stock items
  score += features.inventoryStatus * 5.0; // Prefer in-stock, penalize out-of-stock
  
  return score;
}

/**
 * Sort products by score
 * 
 * Builds features for each product, scores them, and returns sorted array.
 * 
 * @param query - Original user query
 * @param classification - Query classification
 * @param products - Products to score and sort
 * @param scoreInputs - Lexical and semantic scores from retrieval
 * @returns Sorted products (highest score first)
 */
export function sortProductsByScore(
  query: string,
  classification: QueryClassification,
  products: ProductWithLoccitaneAttributes[],
  scoreInputs: {
    lexicalScores: Map<string, number>;
    semanticScores: Map<string, number>;
  }
): ProductWithLoccitaneAttributes[] {
  // Build features and scores for each product
  const scored = products.map(product => {
    const features = buildFeatures(
      query,
      classification,
      product,
      {
        lexical: scoreInputs.lexicalScores.get(product.id) || 0.0,
        semantic: scoreInputs.semanticScores.get(product.id) || 0.0,
      }
    );
    
    const score = scoreProduct(features, classification.type);
    
    return { product, score, features };
  });
  
  // Sort by score (descending)
  scored.sort((a, b) => b.score - a.score);
  
  // Simple diversity: avoid duplicates by productUrl
  const seenUrls = new Set<string>();
  const deduplicated: ProductWithLoccitaneAttributes[] = [];
  
  for (const { product } of scored) {
    if (!seenUrls.has(product.productUrl)) {
      seenUrls.add(product.productUrl);
      deduplicated.push(product);
    }
  }
  
  logger.debug('sortProductsByScore: sorted products', {
    queryType: classification.type,
    totalProducts: products.length,
    deduplicatedCount: deduplicated.length,
    topScore: scored[0]?.score,
    topProductId: scored[0]?.product.id,
  });
  
  return deduplicated;
}

