/**
 * Constraint-Based Ranking
 * 
 * Ranks products using weighted constraint matching instead of hard filtering.
 * This prevents over-filtering while ensuring products that match constraints
 * rank higher.
 */

import type { SearchResultItem } from '../../search/types';
import type { QueryConstraints } from '../query-parser';
import { calculateConstraintMatchScore, type QueryContext } from './constraint-matcher';
import { logger } from '../../telemetry/logger';

export type ProductWithVectorScore = {
  product: SearchResultItem;
  vectorScore: number; // Vector similarity score (0-1)
};

export type ProductWithFinalScore = {
  product: SearchResultItem;
  finalScore: number; // Final score after constraint boost
  constraintScore: number; // Constraint match score (0-1)
};

/**
 * Rank products using constraint-based weighted scoring
 * 
 * Combines vector similarity with constraint matching:
 * - Base score: vector similarity (0-1)
 * - Constraint boost: weighted constraint match scores
 * - Final score: baseScore + (constraintBoost × maxBoostFactor)
 * 
 * This ensures:
 * - Products that match constraints rank higher
 * - Products without constraint matches still appear (no hard filtering)
 * - Constraint boost is capped to prevent over-weighting
 * 
 * @param products - Products with their vector similarity scores
 * @param constraints - Query constraints to match against
 * @param maxConstraintBoost - Maximum boost factor for constraints (default 0.6 = 60% of base score)
 * @param queryContext - Optional query context for dynamic weight adjustment
 * @returns Products ranked by final score (descending)
 */
export async function rankWithConstraints(
  products: ProductWithVectorScore[],
  constraints: QueryConstraints,
  maxConstraintBoost: number = 0.6,
  queryContext?: QueryContext
): Promise<ProductWithFinalScore[]> {
  if (products.length === 0) return [];
  
  // Check if we have any constraints to match
  const hasConstraints = Object.values(constraints).some(
    v => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  );
  
  if (!hasConstraints) {
    // No constraints, just use vector scores
    return products.map(p => ({
      product: p.product,
      finalScore: p.vectorScore,
      constraintScore: 0,
    }));
  }
  
  // Calculate constraint match scores first (to determine dynamic boost)
  // Using Promise.all() to allow event loop interleaving for better responsiveness
  const productsWithConstraintScores = await Promise.all(
    products.map(async ({ product, vectorScore }) => {
      // Calculate constraint score (synchronous, but wrapped in Promise for parallel processing)
      const constraintScore = calculateConstraintMatchScore(
        product, // Pass full product object so ageGroup can be inferred from title/description
        constraints,
        queryContext // Pass query context for dynamic weight adjustment
      );
      
      return {
        product,
        vectorScore,
        constraintScore,
      };
    })
  );
  
  // Calculate average constraint score to determine dynamic boost
  const avgConstraintScore = productsWithConstraintScores.reduce((sum, p) => sum + p.constraintScore, 0) / productsWithConstraintScores.length;
  const minConstraintScore = Math.min(...productsWithConstraintScores.map(p => p.constraintScore));
  const maxConstraintScore = Math.max(...productsWithConstraintScores.map(p => p.constraintScore));
  
  // Dynamic boost: higher boost (0.8) if constraints match well, lower boost (0.4) if they don't
  // This allows good constraint matches to outrank pure vector similarity
  const effectiveBoost = avgConstraintScore > 0.3 ? 0.8 : 0.4;
  
  // Calculate final scores with dynamic boost
  const productsWithScores: ProductWithFinalScore[] = productsWithConstraintScores.map(({ product, vectorScore, constraintScore }) => {
    // Calculate constraint boost using dynamic effective boost
    const constraintBoost = constraintScore * effectiveBoost;
    
    // Final score: base vector score + constraint boost
    // This ensures products matching constraints rank higher, but don't completely
    // dominate if they have low vector similarity
    const finalScore = Math.min(1.0, vectorScore + constraintBoost);
    
    return {
      product,
      finalScore,
      constraintScore,
    };
  });
  
  // Sort by final score (descending)
  productsWithScores.sort((a, b) => b.finalScore - a.finalScore);
  
  // Log top 5 products with detailed scores
  const topProducts = productsWithScores.slice(0, 5).map((p, idx) => ({
    rank: idx + 1,
    productId: p.product.id,
    productTitle: p.product.title?.substring(0, 80),
    vectorScore: productsWithConstraintScores.find(pc => pc.product.id === p.product.id)?.vectorScore || 0,
    constraintScore: p.constraintScore,
    constraintBoost: p.constraintScore * effectiveBoost,
    finalScore: p.finalScore,
  }));
  
  logger.info('constraint_ranking_applied', {
    productCount: productsWithScores.length,
    avgConstraintScore,
    minConstraintScore,
    maxConstraintScore,
    effectiveBoost,
    avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.finalScore, 0) / productsWithScores.length,
    topFinalScore: productsWithScores[0]?.finalScore,
    constraintFields: Object.keys(constraints).filter(k => constraints[k as keyof QueryConstraints] !== null && constraints[k as keyof QueryConstraints] !== undefined),
    topProducts,
    constraintValues: {
      colors: constraints.colors,
      patterns: constraints.patterns,
      occasions: constraints.occasions,
      materials: constraints.materials,
      sizes: constraints.sizes,
      ageGroups: constraints.ageGroups,
      priceMinCents: constraints.priceMinCents,
      priceMaxCents: constraints.priceMaxCents,
    },
  });
  
  logger.debug('constraint_ranking_applied', {
    productCount: productsWithScores.length,
    avgConstraintScore,
    effectiveBoost,
    avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.finalScore, 0) / productsWithScores.length,
    topFinalScore: productsWithScores[0]?.finalScore,
    constraintFields: Object.keys(constraints).filter(k => constraints[k as keyof QueryConstraints] !== null && constraints[k as keyof QueryConstraints] !== undefined),
  });
  
  return productsWithScores;
}

