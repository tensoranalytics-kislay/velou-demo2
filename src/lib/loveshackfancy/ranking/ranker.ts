/**
 * Product Ranker
 * 
 * Note: This file exists for compatibility but the orchestrator
 * uses constraint-based ranking instead (constraint-ranker.ts).
 */

import type { SearchResultItem } from '../../search/types';
import type { QueryClassification } from '../classifier';

export type ProductWithFashionAttributes = SearchResultItem;

/**
 * Sort products by score (stub - not currently used)
 * The orchestrator uses constraint-based ranking instead.
 */
export function sortProductsByScore(
  query: string,
  classification: QueryClassification,
  products: ProductWithFashionAttributes[],
  scoreInputs: {
    lexicalScores: Map<string, number>;
    semanticScores: Map<string, number>;
  }
): ProductWithFashionAttributes[] {
  // This function is not used - the orchestrator uses rankWithConstraints instead
  // Return products sorted by semantic score as fallback
  return products.sort((a, b) => {
    const scoreA = scoreInputs.semanticScores.get(a.id) || 0;
    const scoreB = scoreInputs.semanticScores.get(b.id) || 0;
    return scoreB - scoreA;
  });
}
