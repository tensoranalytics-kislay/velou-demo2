/**
 * LoveShackFancy Multi-View Retrieval
 * 
 * Combines lexical, semantic, and concept-based search methods
 * for comprehensive fashion product retrieval.
 */

import { searchProducts } from '../search/index';
import { searchVectorIndex, searchVectorIndexWithDeduplication, embedText, deduplicateProductsByCategory, searchProductsByKeyword } from '../search/vector/index';
import { searchConceptIndex, type ConceptIndex } from '../search/concept/index';
import { getConceptIndex } from '../search/concept/cache';
import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';
import type { QueryClassification, FashionConstraints } from './classifier';
import { expandColorsWithSimilarity } from './color-similarity';
import { LOVESHACKFANCY_ONTOLOGY } from './ontology';
import { getContextAwareConstraints } from './constraint-context';

/**
 * Generate a simple hash from query text for consistent but diverse variant selection
 * Same query always gets same hash (cacheable), different queries get different hashes
 */
function hashQuery(query: string): string {
  return query.split('').reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0).toString();
}

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
  
  // Expand colors using embedding similarity ONLY when:
  // 1. User explicitly requests "similar colours" (handled in orchestrator)
  // 2. Colors are vague (like "light colours", "dark colours") - these are already expanded by classifier
  // 3. For explicit color queries, use original colors without expansion (unless user explicitly asks for similar)
  // Use higher threshold (0.8) to ensure only truly similar colors are included (e.g., red → burgundy, crimson, NOT blue)
  let expandedColors = searchConstraints.colors;
  if (searchConstraints.colors && searchConstraints.colors.length > 0) {
    // Only expand if we have a single color (more likely to be vague or need expansion)
    // For multiple explicit colors (e.g., ["Red", "Cherry"]), don't expand (user already specified what they want)
    // Also check if any color is not in the ontology - if so, don't expand (user might have added a custom color)
    const hasNonOntologyColor = searchConstraints.colors.some(color => {
      const colorLower = color.toLowerCase();
      return !LOVESHACKFANCY_ONTOLOGY.colors.some(ontColor => ontColor.toLowerCase() === colorLower);
    });
    const shouldExpand = searchConstraints.colors.length === 1 && !hasNonOntologyColor;
    
    if (shouldExpand) {
      try {
        expandedColors = await expandColorsWithSimilarity(
          searchConstraints.colors,
          0.8, // Higher threshold (0.8) to ensure only truly similar colors (e.g., red → burgundy, crimson, rose, NOT blue, purple, pink)
          5    // Limit to 5 similar colors max
        );
        
        // Only log if expansion actually happened
        if (expandedColors.length > searchConstraints.colors.length) {
          logger.info('color_expansion_applied', {
            query: query.substring(0, 100),
            originalColors: searchConstraints.colors,
            expandedColors,
            expansionCount: expandedColors.length - searchConstraints.colors.length,
          });
        } else {
          logger.debug('color_expansion_no_similar_colors_found', {
            query: query.substring(0, 100),
            originalColors: searchConstraints.colors,
            threshold: 0.8,
            note: 'No similar colors found above threshold, using original colors only',
          });
        }
      } catch (error) {
        logger.warn('color_expansion_failed', {
          error: error instanceof Error ? error.message : String(error),
          colors: searchConstraints.colors,
        });
        // Fallback to original colors if expansion fails
        expandedColors = searchConstraints.colors;
      }
    } else {
      // Multiple explicit colors or non-ontology color - use as-is without expansion
      const skipReason = searchConstraints.colors.length > 1 
        ? 'Multiple explicit colors specified, using as-is'
        : hasNonOntologyColor 
          ? 'Non-ontology color present, using as-is'
          : 'Unknown reason';
      logger.debug('color_expansion_skipped', {
        query: query.substring(0, 100),
        colors: searchConstraints.colors,
        colorCount: searchConstraints.colors.length,
        hasNonOntologyColor,
        reason: skipReason,
      });
    }
  }
  
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
          
          // PROGRESSIVE FALLBACK: Try strict → relaxed → keyword → vector
          // Get context-aware constraints based on category metadata
          const contextAware = topCategories && topCategories.length > 0
            ? getContextAwareConstraints(searchConstraints, topCategories, query)
            : {
                sqlFilters: searchConstraints,
                keywordTerms: [],
                relaxedConstraints: searchConstraints,
                metadata: { applicableConstraints: [], textOnlyConstraints: [], fallbackStrategy: 'vector', allowKeywordMatching: false },
              };

          logger.info('fashion_semantic_search: context_aware_constraints_applied', {
            query: query.substring(0, 100),
            categories: topCategories,
            originalColors: searchConstraints.colors,
            sqlFiltersColors: contextAware.sqlFilters.colors,
            keywordTerms: contextAware.keywordTerms,
            keywordTermsSample: contextAware.keywordTerms.slice(0, 5),
            textOnlyConstraints: contextAware.metadata.textOnlyConstraints,
            allowKeywordMatching: contextAware.metadata.allowKeywordMatching,
          });

          const queryHash = hashQuery(query);
          let result: Array<{ productId: string; similarity: number }> = [];
          let fallbackTier = 'strict';

          // TIER 1: Strict filtering with context-aware constraints
          if (topCategories && topCategories.length > 0) {
            logger.info('fashion_semantic_search: tier1_strict_filtering', {
              query: query.substring(0, 100),
              categories: topCategories,
              sqlFilters: {
                colors: contextAware.sqlFilters.colors?.length || 0,
                materials: contextAware.sqlFilters.materials?.length || 0,
                fabrics: contextAware.sqlFilters.fabrics?.length || 0,
              },
              keywordTerms: contextAware.keywordTerms.length,
            });

            const productIdsToSearch = await deduplicateProductsByCategory(
              {
                inStockOnly: true,
                merchantId,
                categories: topCategories,
                priceMinCents: contextAware.sqlFilters.priceMinCents,
                priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                colors: contextAware.sqlFilters.colors, // Only if applicable (not text-only)
                ageGroups: contextAware.sqlFilters.ageGroups,
              },
              1500,
              queryHash,
              (contextAware.metadata.textOnlyConstraints as string[]).includes('colors') // Skip color filter if text-only
            );

            if (productIdsToSearch.length > 0) {
              result = await searchVectorIndexWithDeduplication(
                queryEmbedding,
                150,
                {
                  inStockOnly: true,
                  merchantId,
                  categories: undefined, // Already filtered
                  priceMinCents: contextAware.sqlFilters.priceMinCents,
                  priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                  colors: contextAware.sqlFilters.colors, // Only if applicable
                  ageGroups: contextAware.sqlFilters.ageGroups,
                },
                undefined,
                productIdsToSearch
              );
            }

            if (result.length > 0) {
              logger.info('fashion_semantic_search: tier1_success', {
                query: query.substring(0, 100),
                resultCount: result.length,
              });
            } else {
              logger.warn('fashion_semantic_search: tier1_no_results', {
                query: query.substring(0, 100),
                categories: topCategories,
              });
            }
          }

          // If Tier 1 succeeded but we have keyword terms, also run Tier 3 to find keyword matches
          // This ensures we find products that actually contain the keywords (e.g., "lavender" in description)
          // even if vector search returned generic category matches
          let keywordResults: Array<{ productId: string; similarity: number }> = [];
          if (result.length > 0 && contextAware.keywordTerms.length > 0 && topCategories && topCategories.length > 0 && contextAware.metadata.allowKeywordMatching) {
            logger.info('fashion_semantic_search: tier1_succeeded_with_keywords_running_tier3', {
              query: query.substring(0, 100),
              tier1ResultCount: result.length,
              keywords: contextAware.keywordTerms,
              note: 'Tier 1 found results, but checking Tier 3 for keyword matches to ensure relevance',
            });

            keywordResults = await searchProductsByKeyword(
              contextAware.keywordTerms,
              topCategories,
              queryEmbedding,
              150,
              {
                inStockOnly: true,
                merchantId,
                priceMinCents: contextAware.sqlFilters.priceMinCents,
                priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                ageGroups: contextAware.sqlFilters.ageGroups,
              }
            );

            if (keywordResults.length > 0) {
              logger.info('fashion_semantic_search: tier3_keyword_matches_found', {
                query: query.substring(0, 100),
                keywordResultCount: keywordResults.length,
                note: 'Keyword matches found, will merge with Tier 1 results (keyword results prioritized)',
              });

              // Merge results: keyword matches get priority (higher similarity boost)
              // Create a map of existing results
              const existingResultsMap = new Map<string, number>();
              result.forEach(r => existingResultsMap.set(r.productId, r.similarity));

              // Add keyword results with boosted similarity (prioritize keyword matches)
              keywordResults.forEach(kr => {
                const existingSimilarity = existingResultsMap.get(kr.productId) || 0;
                // Boost keyword matches: take the higher of (keyword similarity * 1.2) or existing similarity
                const boostedSimilarity = Math.max(kr.similarity * 1.2, existingSimilarity);
                existingResultsMap.set(kr.productId, boostedSimilarity);
              });

              // Convert back to array and sort by similarity
              result = Array.from(existingResultsMap.entries())
                .map(([productId, similarity]) => ({ productId, similarity }))
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, 150); // Keep top 150

              fallbackTier = 'keyword_merged';
              logger.info('fashion_semantic_search: tier1_tier3_merged', {
                query: query.substring(0, 100),
                finalResultCount: result.length,
                keywordMatches: keywordResults.length,
                tier1Matches: result.length - keywordResults.length,
              });
            } else {
              logger.info('fashion_semantic_search: tier3_no_keyword_matches_trying_vector_fallback', {
                query: query.substring(0, 100),
                keywords: contextAware.keywordTerms,
                note: 'No keyword matches found, trying vector similarity with keyword terms to find semantically similar products',
              });

              // Fallback: Try vector search with keyword terms directly
              // This finds products that are semantically similar to the keywords even if they don't contain the exact word
              try {
                const keywordQueryText = contextAware.keywordTerms.join(' ');
                const keywordEmbedding = await embedText(keywordQueryText);
                
                const keywordVectorResults = await searchVectorIndexWithDeduplication(
                  keywordEmbedding,
                  50, // Limit to top 50 for keyword vector search
                  {
                    inStockOnly: true,
                    merchantId,
                    categories: topCategories,
                    priceMinCents: contextAware.sqlFilters.priceMinCents,
                    priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                    ageGroups: contextAware.sqlFilters.ageGroups,
                  },
                  undefined,
                  undefined // No pre-deduplicated IDs, search all products in category
                );

                if (keywordVectorResults.length > 0) {
                  logger.info('fashion_semantic_search: tier3_vector_fallback_found_results', {
                    query: query.substring(0, 100),
                    keywordVectorResultCount: keywordVectorResults.length,
                    note: 'Found products via vector similarity to keywords, merging with Tier 1 results',
                  });

                  // Merge keyword vector results with Tier 1 results
                  // Keyword vector results get priority boost
                  const existingResultsMap = new Map<string, number>();
                  result.forEach(r => existingResultsMap.set(r.productId, r.similarity));

                  keywordVectorResults.forEach(kvr => {
                    const existingSimilarity = existingResultsMap.get(kvr.productId) || 0;
                    // Boost keyword vector matches: take the higher of (keyword similarity * 1.3) or existing similarity
                    const boostedSimilarity = Math.max(kvr.similarity * 1.3, existingSimilarity);
                    existingResultsMap.set(kvr.productId, boostedSimilarity);
                  });

                  // Convert back to array and sort by similarity
                  result = Array.from(existingResultsMap.entries())
                    .map(([productId, similarity]) => ({ productId, similarity }))
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, 150); // Keep top 150

                  fallbackTier = 'keyword_vector_merged';
                  logger.info('fashion_semantic_search: tier1_tier3_vector_merged', {
                    query: query.substring(0, 100),
                    finalResultCount: result.length,
                    keywordVectorMatches: keywordVectorResults.length,
                    tier1Matches: result.length - keywordVectorResults.length,
                  });
                } else {
                  logger.debug('fashion_semantic_search: tier3_vector_fallback_no_results', {
                    query: query.substring(0, 100),
                    note: 'Vector fallback also found no results, using Tier 1 results only',
                  });
                }
              } catch (error) {
                logger.warn('fashion_semantic_search: tier3_vector_fallback_failed', {
                  query: query.substring(0, 100),
                  error: error instanceof Error ? error.message : String(error),
                  note: 'Vector fallback failed, using Tier 1 results only',
                });
              }
            }
          }

          // TIER 2: Relaxed constraints (drop inapplicable filters)
          // If strict filtering failed and there are many colors (>5), drop color filter to find any products
          if (result.length === 0 && topCategories && topCategories.length > 0) {
            fallbackTier = 'relaxed';
            
            // Smart color relaxation: if there are many colors (>5), drop color filter entirely
            // This helps when users specify many colors (e.g., 11 colors) which is too restrictive
            const shouldDropColors = contextAware.relaxedConstraints.colors && 
                                     contextAware.relaxedConstraints.colors.length > 5;
            
            logger.info('fashion_semantic_search: tier2_relaxed_filtering', {
              query: query.substring(0, 100),
              categories: topCategories,
              originalColorCount: contextAware.relaxedConstraints.colors?.length || 0,
              droppingColors: shouldDropColors,
              reason: shouldDropColors ? 'Too many colors (>5), dropping color filter to find products' : 'Using relaxed constraints',
            });

            const productIdsToSearch = await deduplicateProductsByCategory(
              {
                inStockOnly: true,
                merchantId,
                categories: topCategories,
                priceMinCents: contextAware.relaxedConstraints.priceMinCents,
                priceMaxCents: contextAware.relaxedConstraints.priceMaxCents,
                colors: shouldDropColors ? undefined : contextAware.relaxedConstraints.colors, // Drop colors if too many
                ageGroups: contextAware.relaxedConstraints.ageGroups,
              },
              1500,
              queryHash,
              shouldDropColors || (contextAware.metadata.textOnlyConstraints as string[]).includes('colors') // Skip color filter if dropped
            );

            if (productIdsToSearch.length > 0) {
              result = await searchVectorIndexWithDeduplication(
                queryEmbedding,
                150,
                {
                  inStockOnly: true,
                  merchantId,
                  categories: undefined,
                  priceMinCents: contextAware.relaxedConstraints.priceMinCents,
                  priceMaxCents: contextAware.relaxedConstraints.priceMaxCents,
                  colors: shouldDropColors ? undefined : contextAware.relaxedConstraints.colors, // Drop colors if too many
                  ageGroups: contextAware.relaxedConstraints.ageGroups,
                },
                undefined,
                productIdsToSearch
              );
            }

            if (result.length > 0) {
              logger.info('fashion_semantic_search: tier2_success', {
                query: query.substring(0, 100),
                resultCount: result.length,
              });
            } else {
              logger.warn('fashion_semantic_search: tier2_no_results', {
                query: query.substring(0, 100),
              });
            }
          }

          // TIER 3: Keyword search (for context-dependent words)
          if (result.length === 0 && contextAware.keywordTerms.length > 0 && topCategories && topCategories.length > 0 && contextAware.metadata.allowKeywordMatching) {
            fallbackTier = 'keyword';
            logger.info('fashion_semantic_search: tier3_keyword_search', {
              query: query.substring(0, 100),
              keywords: contextAware.keywordTerms,
              categories: topCategories,
            });

            const keywordResults = await searchProductsByKeyword(
              contextAware.keywordTerms,
              topCategories,
              queryEmbedding,
              150,
              {
                inStockOnly: true,
                merchantId,
                priceMinCents: contextAware.sqlFilters.priceMinCents,
                priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                ageGroups: contextAware.sqlFilters.ageGroups,
              }
            );

            result = keywordResults;

            if (result.length > 0) {
              logger.info('fashion_semantic_search: tier3_success', {
                query: query.substring(0, 100),
                resultCount: result.length,
              });
            } else {
              logger.warn('fashion_semantic_search: tier3_no_results', {
                query: query.substring(0, 100),
              });
            }
          }

          // TIER 4: Pure vector search (no constraint filters, only category)
          if (result.length === 0 && topCategories && topCategories.length > 0) {
            fallbackTier = 'vector';
            logger.info('fashion_semantic_search: tier4_pure_vector', {
              query: query.substring(0, 100),
              categories: topCategories,
            });

            const productIdsToSearch = await deduplicateProductsByCategory(
              {
                inStockOnly: true,
                merchantId,
                categories: topCategories,
                // No price, color, or other filters
                ageGroups: contextAware.sqlFilters.ageGroups, // Keep age groups as they're critical
              },
              1500,
              queryHash,
              true // Skip color filter
            );

            if (productIdsToSearch.length > 0) {
              result = await searchVectorIndexWithDeduplication(
                queryEmbedding,
                150,
                {
                  inStockOnly: true,
                  merchantId,
                  categories: undefined,
                  // No other filters
                  ageGroups: contextAware.sqlFilters.ageGroups,
                },
                undefined,
                productIdsToSearch
              );
            }

            if (result.length > 0) {
              logger.info('fashion_semantic_search: tier4_success', {
                query: query.substring(0, 100),
                resultCount: result.length,
              });
            }
          }
          
          // Fallback: If no categories, use original flow
          if (result.length === 0 && (!topCategories || topCategories.length === 0)) {
            result = await searchVectorIndexWithDeduplication(
            queryEmbedding,
              150,
            {
              inStockOnly: true,
              merchantId,
                categories: undefined,
              priceMinCents: searchConstraints.priceMinCents,
              priceMaxCents: searchConstraints.priceMaxCents,
              colors: expandedColors,
              ageGroups: searchConstraints.ageGroups,
            },
              450,
              undefined
          );
          }

          result.forEach((item) => {
            candidateIds.add(item.productId);
            semanticScores.set(item.productId, item.similarity);
          });

          logger.info('fashion_semantic_search', {
            query: query.substring(0, 100),
            resultCount: result.length,
            topSimilarity: result[0]?.similarity,
            avgSimilarity: result.length > 0 
              ? result.reduce((sum, r) => sum + r.similarity, 0) / result.length 
              : 0,
            fallbackTier,
            keywordTermsUsed: contextAware.keywordTerms.length,
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
    lengths: nullToUndefined(constraints.lengths),
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

