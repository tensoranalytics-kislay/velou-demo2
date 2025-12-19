/**
 * LoveShackFancy Multi-View Retrieval
 * 
 * Combines lexical, semantic, and concept-based search methods
 * for comprehensive fashion product retrieval.
 */

import { searchProducts } from '../search/index';
import { searchVectorIndex, searchVectorIndexWithDeduplication, embedText, deduplicateProductsByCategory } from '../search/vector/index';
import { searchConceptIndex, type ConceptIndex } from '../search/concept/index';
import { getConceptIndex } from '../search/concept/cache';
import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';
import type { QueryClassification, FashionConstraints } from './classifier';

export type MultiViewRetrievalResult = {
  candidateIds: string[];
  lexicalScores: Map<string, number>;
  semanticScores: Map<string, number>;
  conceptMatches: Map<string, Set<string>>;
};

/**
 * Multi-view retrieval for fashion queries
 * 
 * Runs three parallel search methods:
 * 1. Lexical: Full-text keyword search
 * 2. Semantic: Vector similarity search (uses product terms if provided)
 * 3. Concept: Structured attribute index search
 * 
 * @param query - Full query text (used for lexical/concept search)
 * @param classification - Query classification (for constraints)
 * @param productTermsForVector - Optional clean product terms for vector search (if provided, uses this instead of full query)
 * @param merchantId - Merchant ID for filtering
 * @param searchMethods - Which search methods to use
 * @param topCategories - Optional top 3 categories for hard SQL-level filtering
 */
export async function multiViewRetrieval(
  query: string,
  classification: QueryClassification,
  productTermsForVector?: string, // Optional: clean product terms for better vector search
  merchantId?: string,
  searchMethods: { lexical: boolean; semantic: boolean; concept: boolean } = {
    lexical: false,  // Disable lexical - vector search is better
    semantic: true,  // Primary: vector search captures semantic meaning
    concept: false,  // Disable concept - attributes aren't structured in this dataset
  },
  topCategories?: string[] // Optional: top 3 categories for hard SQL-level filtering
): Promise<MultiViewRetrievalResult> {
  const candidateIds = new Set<string>();
  const lexicalScores = new Map<string, number>();
  const semanticScores = new Map<string, number>();
  const conceptMatches = new Map<string, Set<string>>();

  // Convert classification constraints to search constraints
  // Include top categories for hard SQL-level filtering if provided
  // This hard filters the catalog BEFORE retrieval (applied at SQL level)
  const searchConstraints = classificationToSearchConstraints(classification, topCategories);
  
  if (topCategories && topCategories.length > 0) {
    logger.info('category_filter_passed_to_search_constraints', {
      query: query.substring(0, 100),
      categories: topCategories,
      willFilterLexical: searchMethods.lexical,
      willFilterSemantic: searchMethods.semantic,
    });
  }

  // Run searches in parallel
  const searchPromises: Promise<void>[] = [];

  // 1. Lexical Search (full-text keyword search)
  if (searchMethods.lexical) {
    searchPromises.push(
      (async () => {
        try {
          const result = await searchProducts(
            {
              ...searchConstraints,
              query,
            },
            query,
            merchantId
          );

          result.products.forEach((product, index) => {
            candidateIds.add(product.id);
            // Score based on position (higher = better)
            lexicalScores.set(product.id, 1.0 / (index + 1));
          });

          logger.debug('fashion_lexical_search', {
            query: query.substring(0, 100),
            resultCount: result.products.length,
          });
        } catch (error) {
          logger.error('fashion_lexical_search_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })()
    );
  }

  // 2. Semantic Search (vector similarity) - PRIMARY METHOD
  // This is the main search method. Product embeddings include:
  // - Title (e.g., "wedding dress", "pastel dress")
  // - Description (e.g., "perfect for weddings", "pastel colors")
  // - Attributes (e.g., styleTags, collection, materials)
  // So semantic search naturally finds products based on meaning!
  if (searchMethods.semantic) {
    searchPromises.push(
      (async () => {
        try {
          // Use product terms if provided (from query parser), otherwise use full query
          // Product terms are cleaner and improve vector search matching
          const queryTextForEmbedding = productTermsForVector || query;
          
          logger.debug('fashion_semantic_search: query for embedding', {
            original: query.substring(0, 100),
            productTerms: productTermsForVector?.substring(0, 100),
            usingForEmbedding: queryTextForEmbedding.substring(0, 100),
          });
          
          const queryEmbedding = await embedText(queryTextForEmbedding);
          
          // NEW FLOW: If categories provided, deduplicate first, then vector search
          // OLD FLOW: If no categories, use combined deduplication + vector search
          let productIdsToSearch: string[] | undefined;
          
          if (topCategories && topCategories.length > 0) {
            // Step 1: Deduplicate by category (happens BEFORE vector search)
            // This filters the catalog to categories and deduplicates variants
            logger.info('fashion_semantic_search: deduplicating_by_category_first', {
              query: query.substring(0, 100),
              categories: topCategories,
              categoryCount: topCategories.length,
            });
            
            productIdsToSearch = await deduplicateProductsByCategory(
              {
                inStockOnly: true,
                merchantId,
                categories: topCategories,
                priceMinCents: searchConstraints.priceMinCents,
                priceMaxCents: searchConstraints.priceMaxCents,
              },
              1000 // Get up to 1000 deduplicated products for vector search
            );
            
            if (productIdsToSearch.length === 0) {
              logger.warn('fashion_semantic_search: no_products_after_deduplication', {
                query: query.substring(0, 100),
                categories: topCategories,
              });
              // Continue with empty result - will be handled below
            } else {
              logger.info('fashion_semantic_search: deduplication_complete', {
                query: query.substring(0, 100),
                deduplicatedCount: productIdsToSearch.length,
                categories: topCategories,
              });
            }
          }
          
          // Step 2: Vector search (on pre-deduplicated IDs if available)
          // Higher similarity = more relevant (cosine similarity 0-1)
          // If productIdsToSearch provided, deduplication is skipped in vector search
          // Request 150 unique products (after deduplication if not pre-deduplicated)
          const result = await searchVectorIndexWithDeduplication(
            queryEmbedding,
            150, // Number of unique products to return
            {
              inStockOnly: true,
              merchantId,
              // Only pass categories if NOT using pre-deduplicated IDs (backward compatibility)
              categories: productIdsToSearch ? undefined : (topCategories && topCategories.length > 0 ? topCategories : undefined),
              // Price filtering: IMPORTANT - apply as hard SQL-level filter
              priceMinCents: searchConstraints.priceMinCents,
              priceMaxCents: searchConstraints.priceMaxCents,
            },
            productIdsToSearch ? undefined : 450, // Pre-deduplication limit only if not pre-deduplicated
            productIdsToSearch // Pass pre-deduplicated IDs
          );

          result.forEach((item) => {
            candidateIds.add(item.productId);
            // Score based on similarity (higher = better, range 0-1)
            semanticScores.set(item.productId, item.similarity);
          });

          logger.info('fashion_semantic_search', {
            query: query.substring(0, 100),
            resultCount: result.length,
            topSimilarity: result[0]?.similarity,
            avgSimilarity: result.length > 0 
              ? result.reduce((sum, r) => sum + r.similarity, 0) / result.length 
              : 0,
            usedPreDeduplicatedIds: !!(productIdsToSearch && productIdsToSearch.length > 0),
            preDeduplicatedCount: productIdsToSearch?.length || 0,
          });
        } catch (error) {
          logger.error('fashion_semantic_search_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })()
    );
  }

  // 3. Concept Search (structured attribute index) - OPTIONAL
  // Only use if we have explicit structured constraints AND concept search is enabled
  // Note: Most products don't have structured "Occasion" attributes - they just mention
  // "wedding" in titles/descriptions, which vector search already handles!
  const hasConceptConstraints = (
    (classification.constraints.occasions && classification.constraints.occasions.length > 0) ||
    (classification.constraints.styles && classification.constraints.styles.length > 0) ||
    (classification.constraints.patterns && classification.constraints.patterns.length > 0)
  );
  
  if (searchMethods.concept && hasConceptConstraints) {
    searchPromises.push(
      (async () => {
        try {
          // Try database search first (faster, no memory needed)
          const { searchConceptIndexFromDB } = await import('../search/concept/db');
          
          // Map fashion constraints to concept search
          // Convert null to undefined for type compatibility
          const nullToUndefined = <T>(value: T | null | undefined): T | undefined => 
            value === null ? undefined : value;
          
          const conceptConstraints = {
            styles: nullToUndefined(classification.constraints.styles),
            occasions: nullToUndefined(classification.constraints.occasions),
            patterns: nullToUndefined(classification.constraints.patterns),
            materials: nullToUndefined(classification.constraints.materials),
            collections: nullToUndefined(classification.constraints.collections),
            lengths: nullToUndefined(classification.constraints.lengths),
            necklines: nullToUndefined(classification.constraints.necklines),
            sleeveLengths: nullToUndefined(classification.constraints.sleeveLengths),
            embellishments: nullToUndefined(classification.constraints.embellishments),
            fits: nullToUndefined(classification.constraints.fits),
          };
          
          // Use database search for fashion attributes
          // Note: In-memory concept index is designed for L'Occitane attributes (concerns, ingredients, etc.)
          // and doesn't support fashion attributes, so we only use database search
          const result = await searchConceptIndexFromDB(conceptConstraints, merchantId);

          result.forEach(productId => {
            candidateIds.add(productId);
            // Track which concepts matched
            Object.keys(conceptConstraints).forEach(concept => {
              if (!conceptMatches.has(concept)) {
                conceptMatches.set(concept, new Set());
              }
              conceptMatches.get(concept)!.add(productId);
            });
          });

          logger.debug('fashion_concept_search', {
            query: query.substring(0, 100),
            resultCount: result.length,
            constraints: conceptConstraints,
          });
        } catch (error) {
          logger.warn('fashion_concept_search_failed', {
            error: error instanceof Error ? error.message : String(error),
            note: 'Concept search failed but vector search will still work',
          });
        }
      })()
    );
  }

  // Wait for all searches to complete
  await Promise.all(searchPromises);

  logger.info('fashion_multiview_retrieval', {
    query: query.substring(0, 100),
    totalCandidates: candidateIds.size,
    lexicalCount: lexicalScores.size,
    semanticCount: semanticScores.size,
    conceptCount: Array.from(conceptMatches.values()).reduce((sum, set) => sum + set.size, 0),
  });

  // Sort candidate IDs by vector similarity (if available) to preserve database ranking
  // This ensures products are returned in order of relevance from the database
  const sortedCandidateIds = Array.from(candidateIds).sort((a, b) => {
    const scoreA = semanticScores.get(a) || 0;
    const scoreB = semanticScores.get(b) || 0;
    return scoreB - scoreA; // Descending order (higher similarity first)
  });

  return {
    candidateIds: sortedCandidateIds, // Return sorted by vector similarity
    lexicalScores,
    semanticScores,
    conceptMatches,
  };
}

/**
 * Convert classification to search constraints for fashion
 * 
 * @param classification - Query classification with constraints
 * @param topCategories - Optional top 3 categories for hard SQL-level filtering
 */
export function classificationToSearchConstraints(
  classification: QueryClassification,
  topCategories?: string[]
): SearchConstraints {
  const constraints = classification.constraints;
  
  // If top categories are provided, use them for hard SQL-level filtering
  // This happens before producttype-constraint filtering
  const categoryFilter = topCategories && topCategories.length > 0
    ? topCategories.length === 1
      ? topCategories[0] // Single category as string
      : topCategories // Multiple categories as array
    : undefined;
  
  // Helper to convert null to undefined
  const nullToUndefined = <T>(value: T | null | undefined): T | undefined => 
    value === null ? undefined : value;
  
  // Map FashionConstraints to SearchConstraints (only include fields that exist in SearchConstraints)
  const searchConstraints: SearchConstraints = {
    // Category filter: hard SQL-level filter using top 3 categories
    category: categoryFilter,
    // Map fashion constraints to SearchConstraints fields
    colors: nullToUndefined(constraints.colors),
    sizes: nullToUndefined(constraints.sizes),
    materials: nullToUndefined(constraints.materials),
    occasions: nullToUndefined(constraints.occasions),
    seasons: nullToUndefined(constraints.seasons),
    priceMinCents: constraints.priceMinCents === null ? undefined : constraints.priceMinCents,
    priceMaxCents: constraints.priceMaxCents === null ? undefined : constraints.priceMaxCents,
    ageGroups: nullToUndefined(constraints.ageGroups),
    // Map fashion-specific fields to generic SearchConstraints fields
    // styles + patterns -> styleTags (both are style descriptors)
    styleTags: nullToUndefined([
      ...(constraints.styles || []),
      ...(constraints.patterns || []),
    ].filter(Boolean).length > 0 ? [
      ...(constraints.styles || []),
      ...(constraints.patterns || []),
    ] : undefined),
  };
  
  return searchConstraints;
}

