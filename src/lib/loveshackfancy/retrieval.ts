/**
 * LoveShackFancy Multi-View Retrieval
 * 
 * Combines lexical, semantic, and concept-based search methods
 * for comprehensive fashion product retrieval.
 */

import { searchProducts } from '../search/index';
import { searchVectorIndex, searchVectorIndexWithDeduplication, embedText, deduplicateProductsByCategory, deduplicateProductsByCategoryForPostFiltering, searchProductsByKeyword } from '../search/vector/index';
import { searchConceptIndex, type ConceptIndex } from '../search/concept/index';
import { getConceptIndex } from '../search/concept/cache';
import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';
import type { QueryClassification, FashionConstraints } from './classifier';
import { expandColorsWithSimilarity } from './color-similarity';
import { LOVESHACKFANCY_ONTOLOGY } from './ontology';
import { getContextAwareConstraints } from './constraint-context';
import { validateProductCategory } from './validation/category-validator';
import { expandCategoriesForOptimalCoverage } from '../search/filtering/category';
import { buildCategorySpecificDictionaries } from '../search/filtering/category-dictionaries';
import { applyPostSQLFilters, extractSleeveFromSleeveLengths } from '../search/filtering/post-filter';
import { extractConstraintValues, extractConstraintIntent, type ConstraintWithIntent } from './constraint-utils';
import { prisma } from '../db';
import type { SearchResultItem } from '../search/types';

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
  topCategories?: string[], // Optional: top 3 categories for hard SQL-level filtering
  categoryConfidence?: number // Optional: category classification confidence for post-filtering
): Promise<MultiViewRetrievalResult> {
  const candidateIds = new Set<string>();
  const lexicalScores = new Map<string, number>();
  const semanticScores = new Map<string, number>();
  const conceptMatches = new Map<string, Set<string>>();

  // Expand categories to maximize product coverage
  // This handles singular/plural variations and parent-child relationships
  // Example: "Maxi Dress" → ["Maxi Dress", "Women's Dresses"] to catch both standalone category and subcategory
  // This ensures maximum product coverage when products exist in both category field and subcategory field
  const expandedCategories = topCategories && topCategories.length > 0
    ? expandCategoriesForOptimalCoverage(topCategories)
    : undefined;

  // Extract intent from classification.constraints BEFORE conversion
  // Intent is lost when converting FashionConstraints → SearchConstraints, so we preserve it separately
  // This will be used later for intent-aware post-SQL filtering
  const constraintIntents = {
    colors: extractConstraintIntent(classification.constraints.colors),
    lengths: extractConstraintIntent(classification.constraints.lengths),
    sleeveLengths: extractConstraintIntent(classification.constraints.sleeveLengths),
    necklines: extractConstraintIntent(classification.constraints.necklines),
    formalityLevel: extractConstraintIntent(classification.constraints.formalityLevel),
    colorShade: extractConstraintIntent(classification.constraints.colorShade),
  };

  // Convert classification constraints to search constraints
  // Include top categories for hard SQL-level filtering if provided
  // This hard filters the catalog BEFORE retrieval (applied at SQL level)
  const searchConstraints = classificationToSearchConstraints(classification, expandedCategories || topCategories);
  
  // Expand colors using embedding similarity ONLY when:
  // 1. User explicitly requests "similar colours" (handled in orchestrator)
  // 2. Colors are vague (like "light colours", "dark colours") - these are already expanded by classifier
  // 3. For explicit color queries, use original colors without expansion (unless user explicitly asks for similar)
  // Use higher threshold (0.8) to ensure only truly similar colors are included (e.g., red → burgundy, crimson, NOT blue)
  // Extract color values from intent format if needed
  const colorValues = Array.isArray(searchConstraints.colors) 
    ? searchConstraints.colors 
    : (searchConstraints.colors as any)?.values || [];
  let expandedColors = colorValues;
  if (colorValues.length > 0) {
    // Only expand if we have a single color (more likely to be vague or need expansion)
    // For multiple explicit colors (e.g., ["Red", "Cherry"]), don't expand (user already specified what they want)
    // Also check if any color is not in the ontology - if so, don't expand (user might have added a custom color)
    const hasNonOntologyColor = colorValues.some((color: string) => {
      const colorLower = color.toLowerCase();
      return !LOVESHACKFANCY_ONTOLOGY.colors.some(ontColor => ontColor.toLowerCase() === colorLower);
    });
    const shouldExpand = colorValues.length === 1 && !hasNonOntologyColor;
    
    if (shouldExpand) {
      try {
        expandedColors = await expandColorsWithSimilarity(
          colorValues,
          0.8, // Higher threshold (0.8) to ensure only truly similar colors (e.g., red → burgundy, crimson, rose, NOT blue, purple, pink)
          5    // Limit to 5 similar colors max
        );
        
        // Only log if expansion actually happened
        if (expandedColors.length > colorValues.length) {
          logger.info('color_expansion_applied', {
            query: query.substring(0, 100),
            originalColors: colorValues,
            expandedColors,
            expansionCount: expandedColors.length - colorValues.length,
          });
        } else {
          logger.debug('color_expansion_no_similar_colors_found', {
            query: query.substring(0, 100),
            originalColors: colorValues,
            threshold: 0.8,
            note: 'No similar colors found above threshold, using original colors only',
          });
        }
      } catch (error) {
        logger.warn('color_expansion_failed', {
          error: error instanceof Error ? error.message : String(error),
          colors: colorValues,
        });
        // Fallback to original colors if expansion fails
        expandedColors = colorValues;
      }
    } else {
      // Multiple explicit colors or non-ontology color - use as-is without expansion
      const skipReason = colorValues.length > 1 
        ? 'Multiple explicit colors specified, using as-is'
        : hasNonOntologyColor 
          ? 'Non-ontology color present, using as-is'
          : 'Unknown reason';
      logger.debug('color_expansion_skipped', {
        query: query.substring(0, 100),
        colors: colorValues,
        colorCount: colorValues.length,
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

          // Map intents to context-aware filter names
          // Note: getContextAwareConstraints might move some constraints to keywordTerms
          // but we still need intent for post-SQL filtering if they remain in sqlFilters
          // sleeveLengths maps to sleeves in SearchConstraints
          const contextAwareIntents = {
            colors: constraintIntents.colors,
            lengths: constraintIntents.lengths,
            sleeves: constraintIntents.sleeveLengths, // sleeveLengths maps to sleeves
            necklines: constraintIntents.necklines,
            formalityLevels: constraintIntents.formalityLevel,
            colorShades: constraintIntents.colorShade,
          };

          logger.info('fashion_semantic_search: intent_extraction_for_post_sql_filtering', {
            query: query.substring(0, 100),
            constraintIntents: {
              colors: constraintIntents.colors,
              lengths: constraintIntents.lengths,
              sleeveLengths: constraintIntents.sleeveLengths,
              necklines: constraintIntents.necklines,
              formalityLevel: constraintIntents.formalityLevel,
              colorShade: constraintIntents.colorShade,
            },
            contextAwareIntents,
            note: 'Intent information extracted and mapped for post-SQL filtering',
          });

          logger.info('fashion_semantic_search: context_aware_constraints_applied', {
            query: query.substring(0, 100),
            categories: topCategories,
            originalColors: searchConstraints.colors,
            originalAgeGroups: searchConstraints.ageGroups,
            sqlFiltersColors: contextAware.sqlFilters.colors,
            sqlFiltersAgeGroups: contextAware.sqlFilters.ageGroups,
            keywordTerms: contextAware.keywordTerms,
            keywordTermsSample: contextAware.keywordTerms.slice(0, 5),
            textOnlyConstraints: contextAware.metadata.textOnlyConstraints,
            allowKeywordMatching: contextAware.metadata.allowKeywordMatching,
          });

          const queryHash = hashQuery(query);
          let result: Array<{ productId: string; similarity: number }> = [];
          let fallbackTier = 'strict';

          // Feature flag for post-SQL filtering
          const USE_POST_SQL_FILTERING = process.env.ENABLE_POST_SQL_FILTERING === 'true';

          logger.debug('fashion_semantic_search: post_sql_filtering_flag', {
            query: query.substring(0, 100),
            usePostSQLFiltering: USE_POST_SQL_FILTERING,
            flagValue: process.env.ENABLE_POST_SQL_FILTERING,
          });

          // TIER 1: Strict filtering with context-aware constraints
          if (expandedCategories && expandedCategories.length > 0) {
            logger.info('fashion_semantic_search: tier1_strict_filtering', {
              query: query.substring(0, 100),
              originalCategories: topCategories,
              expandedCategories,
              usePostSQLFiltering: USE_POST_SQL_FILTERING,
              sqlFilters: {
                colors: contextAware.sqlFilters.colors?.length || 0,
                materials: contextAware.sqlFilters.materials?.length || 0,
                fabrics: contextAware.sqlFilters.fabrics?.length || 0,
                lengths: contextAware.sqlFilters.lengths?.length || 0,
                sleeves: contextAware.sqlFilters.sleeves?.length || 0,
                necklines: contextAware.sqlFilters.necklines?.length || 0,
                formalityLevel: contextAware.sqlFilters.formalityLevel?.length || 0,
                colorShade: contextAware.sqlFilters.colorShade?.length || 0,
              },
              keywordTerms: contextAware.keywordTerms.length,
            });

            let productIdsToSearch: string[] = [];

            logger.info('fashion_semantic_search: tier1_before_post_sql_check', {
              query: query.substring(0, 100),
              USE_POST_SQL_FILTERING,
              envValue: process.env.ENABLE_POST_SQL_FILTERING,
              expandedCategories,
              ageGroups: contextAware.sqlFilters.ageGroups,
              note: 'Checking which mode to use (post-SQL filtering vs existing mode)',
            });

            if (USE_POST_SQL_FILTERING) {
              logger.info('fashion_semantic_search: post_sql_filtering_mode_enabled', {
                query: query.substring(0, 100),
                expandedCategories,
                ageGroups: contextAware.sqlFilters.ageGroups,
                note: 'Post-SQL filtering mode enabled - Stage 1: Category-only SQL filter starting',
              });

              // POST-SQL FILTERING MODE: Two-stage filtration
              // Stage 1: Category-only SQL filter (skip post-filterable attributes)
              const categoryFilteredIds = await deduplicateProductsByCategoryForPostFiltering(
                {
                  categories: expandedCategories,
                  ageGroups: contextAware.sqlFilters.ageGroups,
                  priceMinCents: contextAware.sqlFilters.priceMinCents,
                  priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                  merchantId,
                  inStockOnly: true,
                },
                1500
              );

              logger.info('fashion_semantic_search: post_sql_filtering_stage1_complete', {
                query: query.substring(0, 100),
                categoryFilteredCount: categoryFilteredIds.length,
                note: 'Stage 1: Category-only SQL filter completed',
              });

              // Stage 2: Build category-specific dictionaries
              if (categoryFilteredIds.length === 0) {
                logger.warn('fashion_semantic_search: post_sql_filtering_stage1_returned_zero', {
                  query: query.substring(0, 100),
                  expandedCategories,
                  ageGroups: contextAware.sqlFilters.ageGroups,
                  note: 'Stage 1 returned 0 products - skipping post-SQL filtering stages',
                });
                productIdsToSearch = [];
              } else {
                const categoryDictionaries = await buildCategorySpecificDictionaries(
                  categoryFilteredIds,
                  merchantId || ''
                );

                logger.info('fashion_semantic_search: post_sql_filtering_stage2_complete', {
                  query: query.substring(0, 100),
                  dictionaryCount: categoryDictionaries.size,
                  categoryFilteredCount: categoryFilteredIds.length,
                  note: 'Stage 2: Category-specific dictionaries built',
                });

                // Stage 3: Apply post-SQL filters using category-specific dictionaries
                // Helper to convert null to undefined
                const nullToUndefined = <T>(value: T | null | undefined): T | undefined => 
                  value === null ? undefined : value;
                
                logger.info('fashion_semantic_search: calling_applyPostSQLFilters_with_intents', {
                  query: query.substring(0, 100),
                  contextAwareIntents,
                  hasColorsIntent: !!contextAwareIntents.colors,
                  hasLengthsIntent: !!contextAwareIntents.lengths,
                  hasSleevesIntent: !!contextAwareIntents.sleeves,
                  hasNecklinesIntent: !!contextAwareIntents.necklines,
                  hasFormalityIntent: !!contextAwareIntents.formalityLevels,
                  note: 'About to call applyPostSQLFilters with intent information',
                });

                const postFilteredIds = await applyPostSQLFilters(
                  categoryFilteredIds,
                  {
                    colors: nullToUndefined(extractConstraintValues(contextAware.sqlFilters.colors)),
                    lengths: nullToUndefined(contextAware.sqlFilters.lengths),
                    sleeves: contextAware.sqlFilters.sleeves ? extractSleeveFromSleeveLengths(contextAware.sqlFilters.sleeves) : undefined,
                    necklines: nullToUndefined(contextAware.sqlFilters.necklines),
                    formalityLevels: nullToUndefined(contextAware.sqlFilters.formalityLevel),
                    colorShades: nullToUndefined(contextAware.sqlFilters.colorShade),
                  },
                  categoryDictionaries,
                  contextAwareIntents // Pass intent information for intent-aware filtering
                );

                logger.info('fashion_semantic_search: post_sql_filtering_stage3_complete', {
                  query: query.substring(0, 100),
                  originalCount: categoryFilteredIds.length,
                  postFilteredCount: postFilteredIds.length,
                  reductionPercentage: categoryFilteredIds.length > 0 
                    ? ((categoryFilteredIds.length - postFilteredIds.length) / categoryFilteredIds.length * 100).toFixed(2) + '%'
                    : '0%',
                  filtersApplied: {
                    colors: extractConstraintValues(contextAware.sqlFilters.colors)?.length || 0,
                    colorValues: extractConstraintValues(contextAware.sqlFilters.colors),
                    lengths: contextAware.sqlFilters.lengths?.length || 0,
                    lengthValues: contextAware.sqlFilters.lengths,
                    sleeves: contextAware.sqlFilters.sleeves?.length || 0,
                    sleeveValues: contextAware.sqlFilters.sleeves,
                    necklines: contextAware.sqlFilters.necklines?.length || 0,
                    necklineValues: contextAware.sqlFilters.necklines,
                    formalityLevels: contextAware.sqlFilters.formalityLevel?.length || 0,
                    formalityLevelValues: contextAware.sqlFilters.formalityLevel,
                    colorShades: contextAware.sqlFilters.colorShade?.length || 0,
                    colorShadeValues: contextAware.sqlFilters.colorShade,
                  },
                  note: 'Stage 3: Post-SQL filters applied using category-specific dictionaries',
                });

                productIdsToSearch = postFilteredIds;
              }
            } else {
              logger.info('fashion_semantic_search: using_existing_mode_not_post_sql', {
                query: query.substring(0, 100),
                USE_POST_SQL_FILTERING,
                envValue: process.env.ENABLE_POST_SQL_FILTERING,
                note: 'Using existing mode (all filters in SQL) - post-SQL filtering is disabled',
              });
              // EXISTING MODE: All filters in SQL
              productIdsToSearch = await deduplicateProductsByCategory(
              {
                inStockOnly: true,
                merchantId,
                  categories: expandedCategories,
                priceMinCents: contextAware.sqlFilters.priceMinCents,
                priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                  colors: contextAware.sqlFilters.colors,
                  excludedColors: (contextAware.sqlFilters as any).excludedColors,
                ageGroups: contextAware.sqlFilters.ageGroups,
                  lengths: contextAware.sqlFilters.lengths,
              },
              1500,
              queryHash,
                (contextAware.metadata.textOnlyConstraints as string[]).includes('colors')
            );
            }

            if (productIdsToSearch.length > 0) {
              // Stage 4: Vector search on filtered IDs
              result = await searchVectorIndexWithDeduplication(
                queryEmbedding,
                150,
                {
                  inStockOnly: true,
                  merchantId,
                  categories: undefined, // Already filtered
                  priceMinCents: contextAware.sqlFilters.priceMinCents,
                  priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                  // NOTE: If post-SQL filtering is enabled, colors, lengths, sleeves, necklines, formalityLevels, colorShades
                  // are already filtered, so we don't need to apply them again in SQL
                  colors: USE_POST_SQL_FILTERING ? undefined : contextAware.sqlFilters.colors,
                  excludedColors: USE_POST_SQL_FILTERING ? undefined : (contextAware.sqlFilters as any).excludedColors,
                  ageGroups: contextAware.sqlFilters.ageGroups, // Always apply age group filter
                  lengths: USE_POST_SQL_FILTERING ? undefined : contextAware.sqlFilters.lengths,
                },
                undefined,
                productIdsToSearch
              );
            }

            if (result.length > 0) {
              logger.info('fashion_semantic_search: tier1_success', {
                query: query.substring(0, 100),
                resultCount: result.length,
                usePostSQLFiltering: USE_POST_SQL_FILTERING,
                productIdsToSearchCount: productIdsToSearch.length,
              });
            } else {
              logger.warn('fashion_semantic_search: tier1_no_results', {
                query: query.substring(0, 100),
                categories: topCategories,
                usePostSQLFiltering: USE_POST_SQL_FILTERING,
                productIdsToSearchCount: productIdsToSearch.length,
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
              expandedCategories || topCategories, // Use expanded categories for maximum coverage
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
                    categories: expandedCategories || topCategories, // Use expanded categories for maximum coverage
                    priceMinCents: contextAware.sqlFilters.priceMinCents,
                    priceMaxCents: contextAware.sqlFilters.priceMaxCents,
                    ageGroups: contextAware.sqlFilters.ageGroups,
                    // NOTE: If post-SQL filtering is enabled, lengths are post-filtered, so skip here
                    lengths: USE_POST_SQL_FILTERING ? undefined : contextAware.sqlFilters.lengths,
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
          // CRITICAL: Skip Tier 2 if post-SQL filtering is enabled and Tier 1 returned 0 results
          // This is because Tier 1's post-SQL filtering is more accurate (respects sleeves/necklines/formalityLevel/colorShade)
          // and Tier 2 uses the old function that doesn't filter by these attributes
          if (result.length === 0 && topCategories && topCategories.length > 0) {
            if (USE_POST_SQL_FILTERING) {
              logger.info('fashion_semantic_search: tier2_skipped_due_to_post_sql_filtering', {
                query: query.substring(0, 100),
                categories: topCategories,
                note: 'Tier 2 skipped because post-SQL filtering is enabled and Tier 1 correctly filtered out non-matching products (e.g., sleeveless vs long sleeves). Returning 0 results to respect user constraints.',
              });
              // Don't fall back to Tier 2 - post-SQL filtering correctly filtered products, so return 0 results
            } else {
            fallbackTier = 'relaxed';
            
            // Smart color relaxation: if there are many colors (>5), drop color filter entirely
            // This helps when users specify many colors (e.g., 11 colors) which is too restrictive
            const relaxedColors = Array.isArray(contextAware.relaxedConstraints.colors) 
              ? contextAware.relaxedConstraints.colors 
              : (contextAware.relaxedConstraints.colors as any)?.values || [];
            const shouldDropColors = relaxedColors.length > 5;
            
            logger.info('fashion_semantic_search: tier2_relaxed_filtering', {
              query: query.substring(0, 100),
              categories: topCategories,
              originalColorCount: relaxedColors.length,
              droppingColors: shouldDropColors,
              reason: shouldDropColors ? 'Too many colors (>5), dropping color filter to find products' : 'Using relaxed constraints',
            });

            const productIdsToSearch = await deduplicateProductsByCategory(
              {
                inStockOnly: true,
                merchantId,
                  categories: expandedCategories || topCategories, // Use expanded categories for maximum coverage
                priceMinCents: contextAware.relaxedConstraints.priceMinCents,
                priceMaxCents: contextAware.relaxedConstraints.priceMaxCents,
                colors: shouldDropColors ? undefined : relaxedColors, // Drop colors if too many
                excludedColors: shouldDropColors ? undefined : (contextAware.relaxedConstraints as any).excludedColors, // Excluded colors
                ageGroups: contextAware.relaxedConstraints.ageGroups,
                  lengths: contextAware.relaxedConstraints.lengths, // Hard SQL filter for length (preserve in relaxed tier)
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
                  colors: shouldDropColors ? undefined : relaxedColors, // Drop colors if too many
                  excludedColors: shouldDropColors ? undefined : (contextAware.relaxedConstraints as any).excludedColors, // Excluded colors
                  ageGroups: contextAware.relaxedConstraints.ageGroups,
                    lengths: contextAware.relaxedConstraints.lengths, // Hard SQL filter for length (preserve in relaxed tier)
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
          }

          // TIER 3: Keyword search (for context-dependent words)
          // CRITICAL: Skip Tier 3 if post-SQL filtering is enabled and Tier 1 returned 0 results
          // (same reason as Tier 2 - post-SQL filtering is more accurate)
          if (result.length === 0 && contextAware.keywordTerms.length > 0 && topCategories && topCategories.length > 0 && contextAware.metadata.allowKeywordMatching) {
            if (USE_POST_SQL_FILTERING) {
              logger.info('fashion_semantic_search: tier3_skipped_due_to_post_sql_filtering', {
                query: query.substring(0, 100),
                keywords: contextAware.keywordTerms,
                categories: topCategories,
                note: 'Tier 3 skipped because post-SQL filtering is enabled and Tier 1 correctly filtered out non-matching products. Returning 0 results to respect user constraints.',
              });
            } else {
            fallbackTier = 'keyword';
            logger.info('fashion_semantic_search: tier3_keyword_search', {
              query: query.substring(0, 100),
              keywords: contextAware.keywordTerms,
              categories: topCategories,
            });

            const keywordResults = await searchProductsByKeyword(
              contextAware.keywordTerms,
                expandedCategories || topCategories, // Use expanded categories for maximum coverage
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
          }

          // TIER 4: Pure vector search (no constraint filters, only category)
          // This is the final fallback - drop all constraint filters to find any products in the category
          // BUT: If colors or age groups are explicitly mentioned, don't drop them - they are hard filters
          // CRITICAL: Skip Tier 4 if post-SQL filtering is enabled and Tier 1 returned 0 results
          // (same reason as Tier 2 and Tier 3 - post-SQL filtering is more accurate)
          if (result.length === 0 && topCategories && topCategories.length > 0) {
            if (USE_POST_SQL_FILTERING) {
              logger.info('fashion_semantic_search: tier4_skipped_due_to_post_sql_filtering', {
                query: query.substring(0, 100),
                categories: topCategories,
                note: 'Tier 4 skipped because post-SQL filtering is enabled and Tier 1 correctly filtered out non-matching products. Returning 0 results to respect user constraints.',
              });
              // Don't fall back to Tier 4 - post-SQL filtering correctly filtered products
            } else {
              // Check if colors are explicitly mentioned (not text-only, meaning they should be hard filters)
              const colorValues = Array.isArray(searchConstraints.colors) 
                ? searchConstraints.colors 
                : (searchConstraints.colors as any)?.values || [];
              const hasExplicitColorFilter = colorValues.length > 0 &&
                                           !(contextAware.metadata.textOnlyConstraints as string[]).includes('colors');
              
              // Check if age groups are explicitly mentioned (they should be hard filters)
              // Check both searchConstraints and contextAware.sqlFilters (age groups might be in either)
              const ageGroupValuesFromSearch = Array.isArray(searchConstraints.ageGroups) 
                ? searchConstraints.ageGroups 
                : (searchConstraints.ageGroups as any)?.values || [];
              const ageGroupValuesFromContext = Array.isArray(contextAware.sqlFilters.ageGroups)
                ? contextAware.sqlFilters.ageGroups
                : (contextAware.sqlFilters.ageGroups as any)?.values || [];
              const ageGroupValues = ageGroupValuesFromSearch.length > 0 ? ageGroupValuesFromSearch : ageGroupValuesFromContext;
              const hasExplicitAgeGroupFilter = ageGroupValues && ageGroupValues.length > 0;
              
              if (hasExplicitColorFilter || hasExplicitAgeGroupFilter) {
                // Colors or age groups are explicitly mentioned - don't drop them, return 0 results instead
                const skippedFilters = [];
                if (hasExplicitColorFilter) skippedFilters.push('colors');
                if (hasExplicitAgeGroupFilter) skippedFilters.push('ageGroups');
                
                logger.info('fashion_semantic_search: tier4_skipped_explicit_filters', {
                  query: query.substring(0, 100),
                  categories: topCategories,
                  colors: hasExplicitColorFilter ? colorValues : undefined,
                  ageGroups: hasExplicitAgeGroupFilter ? ageGroupValues : undefined,
                  skippedFilters,
                  note: `Skipping tier 4 fallback because ${skippedFilters.join(' and ')} are explicitly mentioned and should be hard filters`,
                });
                // result remains empty (0 results) - this is correct behavior for explicit filters
              } else {
                // No explicit hard filters - proceed with tier 4 (drop all filters)
                fallbackTier = 'vector';
                logger.info('fashion_semantic_search: tier4_pure_vector', {
                  query: query.substring(0, 100),
                  categories: topCategories,
                  note: 'Dropping all constraint filters to find any products in category',
                });

                const productIdsToSearch = await deduplicateProductsByCategory(
                  {
                    inStockOnly: true,
                    merchantId,
                    categories: expandedCategories || topCategories, // Use expanded categories for maximum coverage
                    // No price, color, age groups, or other filters - pure category-based search
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
                      // No constraint filters - pure vector similarity search
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
              lengths: searchConstraints.lengths, // Hard SQL filter for length
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
  const occasionValues = extractConstraintValues(classification.constraints.occasions) || (Array.isArray(classification.constraints.occasions) ? classification.constraints.occasions : []);
  const styleValues = extractConstraintValues(classification.constraints.styles) || (Array.isArray(classification.constraints.styles) ? classification.constraints.styles : []);
  const patternValues = extractConstraintValues(classification.constraints.patterns) || (Array.isArray(classification.constraints.patterns) ? classification.constraints.patterns : []);
  const hasConceptConstraints = (
    occasionValues.length > 0 ||
    styleValues.length > 0 ||
    patternValues.length > 0
  );
  
  if (searchMethods.concept && hasConceptConstraints) {
    searchPromises.push(
      (async () => {
        try {
          // Try database search first (faster, no memory needed)
          const { searchConceptIndexFromDB } = await import('../search/concept/db');
          
          // Map fashion constraints to concept search
          // Extract values from intent format if needed
          const extractValuesForConcept = (constraint: string[] | ConstraintWithIntent | null | undefined): string[] | undefined => {
            if (constraint === null || constraint === undefined) return undefined;
            const values = extractConstraintValues(constraint) || (Array.isArray(constraint) ? constraint : []);
            return values.length > 0 ? values : undefined;
          };
          
          const conceptConstraints = {
            styles: extractValuesForConcept(classification.constraints.styles),
            occasions: extractValuesForConcept(classification.constraints.occasions),
            patterns: extractValuesForConcept(classification.constraints.patterns),
            materials: extractValuesForConcept(classification.constraints.materials),
            collections: extractValuesForConcept(classification.constraints.collections),
            lengths: extractValuesForConcept(classification.constraints.lengths),
            necklines: extractValuesForConcept(classification.constraints.necklines),
            sleeveLengths: extractValuesForConcept(classification.constraints.sleeveLengths),
            embellishments: extractValuesForConcept(classification.constraints.embellishments),
            fits: extractValuesForConcept(classification.constraints.fits),
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

  // Post-filter by category if categories and confidence are provided
  // This prevents cross-category contamination (e.g., "dresses" query returning "towels")
  let filteredCandidateIds = Array.from(candidateIds);
  if (topCategories && topCategories.length > 0 && categoryConfidence !== undefined) {
    try {
      // Load products to validate their categories
      const productsToValidate = await prisma.product.findMany({
        where: {
          id: { in: filteredCandidateIds },
          ...(merchantId ? { merchantId } : {}),
        },
        select: {
          id: true,
          category: true,
        },
      });

      const beforeFilterCount = filteredCandidateIds.length;
      
      // Filter products by category validation
      const validProductIds = productsToValidate
        .filter(product => {
          const validation = validateProductCategory(
            product as SearchResultItem,
            topCategories,
            categoryConfidence
          );
          return validation.isValid;
        })
        .map(p => p.id);

      // Keep only valid product IDs, preserving order from semantic scores
      filteredCandidateIds = filteredCandidateIds.filter(id => validProductIds.includes(id));

      const afterFilterCount = filteredCandidateIds.length;
      const filteredCount = beforeFilterCount - afterFilterCount;

      if (filteredCount > 0) {
        logger.info('products_filtered_by_category_post_vector_search', {
          query: query.substring(0, 100),
          categories: topCategories,
          categoryConfidence,
          beforeFilterCount,
          afterFilterCount,
          filteredCount,
          note: 'Products filtered by category validation after vector search to prevent cross-category contamination',
        });
      }
    } catch (error) {
      logger.error('category_post_filtering_failed', {
        error: error instanceof Error ? error.message : String(error),
        query: query.substring(0, 100),
      });
      // Continue with unfiltered results if filtering fails
    }
  }

  // Sort candidate IDs by vector similarity (if available) to preserve database ranking
  // This ensures products are returned in order of relevance from the database
  const sortedCandidateIds = filteredCandidateIds.sort((a, b) => {
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
  
  // PHASE 3: Extract excluded values for all applicable constraints
  // Extract values and intent for each constraint type
  const colorValues = extractConstraintValues(constraints.colors);
  const colorIntent = extractConstraintIntent(constraints.colors);
  
  const materialValues = extractConstraintValues(constraints.materials);
  const materialIntent = extractConstraintIntent(constraints.materials);
  
  const patternValues = extractConstraintValues(constraints.patterns);
  const patternIntent = extractConstraintIntent(constraints.patterns);
  
  const occasionValues = extractConstraintValues(constraints.occasions);
  const occasionIntent = extractConstraintIntent(constraints.occasions);
  
  const sizeValues = extractConstraintValues(constraints.sizes);
  const sizeIntent = extractConstraintIntent(constraints.sizes);
  
  const seasonValues = extractConstraintValues(constraints.seasons);
  const seasonIntent = extractConstraintIntent(constraints.seasons);
  
  const fitValues = extractConstraintValues(constraints.fits);
  const fitIntent = extractConstraintIntent(constraints.fits);
  
  const lengthValues = extractConstraintValues(constraints.lengths);
  const lengthIntent = extractConstraintIntent(constraints.lengths);
  
  const styleValues = extractConstraintValues(constraints.styles);
  const styleIntent = extractConstraintIntent(constraints.styles);
  
  const collectionValues = extractConstraintValues(constraints.collections);
  const collectionIntent = extractConstraintIntent(constraints.collections);
  
  const necklineValues = extractConstraintValues(constraints.necklines);
  const necklineIntent = extractConstraintIntent(constraints.necklines);
  
  const sleeveLengthValues = extractConstraintValues(constraints.sleeveLengths);
  const sleeveLengthIntent = extractConstraintIntent(constraints.sleeveLengths);
  
  const formalityLevelValues = extractConstraintValues(constraints.formalityLevel);
  const formalityLevelIntent = extractConstraintIntent(constraints.formalityLevel);
  
  const ageGroupValues = extractConstraintValues(constraints.ageGroups);
  const ageGroupIntent = extractConstraintIntent(constraints.ageGroups);
  
  // Extract values for additional constraints
  const colorShadeValues = extractConstraintValues(constraints.colorShade);
  const benefitsValues = extractConstraintValues(constraints.benefits);
  const claimsValues = extractConstraintValues(constraints.claims);
  const compatibilityValues = extractConstraintValues(constraints.compatibility);
  const roomsValues = extractConstraintValues(constraints.rooms);
  const useCasesValues = extractConstraintValues(constraints.useCases);
  
  // Map scents to sensoryProfile: combine scents into a string description
  const scentValues = extractConstraintValues(constraints.scents) || (Array.isArray(constraints.scents) ? constraints.scents : []);
  const sensoryProfileFromScents = scentValues.length > 0
    ? scentValues.join(', ') + ' scent'
    : undefined;
  
  // Merge sensoryProfile from scents with explicit sensoryProfile (prefer explicit if both exist)
  const mergedSensoryProfile = constraints.sensoryProfile || sensoryProfileFromScents;
  
  // Map FashionConstraints to SearchConstraints (only include fields that exist in SearchConstraints)
  // PHASE 3: Handle excluded intent - set constraint to undefined and add to excluded* field
  const searchConstraints: SearchConstraints = {
    // Category filter: hard SQL-level filter using top 3 categories
    category: categoryFilter,
    // Map fashion constraints to SearchConstraints fields
    // If intent is 'excluded', set to undefined (will be added to excluded* field below)
    colors: colorIntent === 'excluded' ? undefined : nullToUndefined(colorValues),
    sizes: sizeIntent === 'excluded' ? undefined : nullToUndefined(sizeValues),
    materials: materialIntent === 'excluded' ? undefined : nullToUndefined(materialValues),
    occasions: occasionIntent === 'excluded' ? undefined : nullToUndefined(occasionValues),
    seasons: seasonIntent === 'excluded' ? undefined : nullToUndefined(seasonValues),
    lengths: lengthIntent === 'excluded' ? undefined : nullToUndefined(lengthValues),
    priceMinCents: constraints.priceMinCents === null ? undefined : constraints.priceMinCents,
    priceMaxCents: constraints.priceMaxCents === null ? undefined : constraints.priceMaxCents,
    ageGroups: ageGroupIntent === 'excluded' ? undefined : nullToUndefined(ageGroupValues),
    // Map fashion-specific fields to generic SearchConstraints fields
    // styles + patterns -> styleTags (both are style descriptors)
    // If either has excluded intent, handle separately
    styleTags: (styleIntent === 'excluded' || patternIntent === 'excluded') 
      ? undefined 
      : nullToUndefined([
          ...(styleValues || []),
          ...(patternValues || []),
        ].filter(Boolean).length > 0 ? [
          ...(styleValues || []),
          ...(patternValues || []),
        ] : undefined),
    // Map post-filterable attributes (preserved in sqlFilters for post-SQL filtering)
    // sleeveLengths -> sleeves (map FashionConstraints.sleeveLengths to SearchConstraints.sleeves)
    sleeves: sleeveLengthIntent === 'excluded' ? undefined : nullToUndefined(sleeveLengthValues),
    necklines: necklineIntent === 'excluded' ? undefined : nullToUndefined(necklineValues),
    formalityLevel: formalityLevelIntent === 'excluded' ? undefined : nullToUndefined(formalityLevelValues),
    colorShade: nullToUndefined(colorShadeValues),
    // Map category-specific constraints
    // scents -> sensoryProfile (convert array to string description)
    sensoryProfile: mergedSensoryProfile || undefined,
    // rooms -> useCases (rooms are a type of useCase for home products)
    useCases: nullToUndefined([
      ...(roomsValues || []),
      ...(useCasesValues || []),
    ].filter(Boolean).length > 0 ? [
      ...(roomsValues || []),
      ...(useCasesValues || []),
    ] : undefined),
    // Direct mappings for generic constraints
    benefits: nullToUndefined(benefitsValues),
    claims: nullToUndefined(claimsValues),
    compatibility: nullToUndefined(compatibilityValues),
  };
  
  // Add excluded values to searchConstraints (will be used by constraint-context.ts for SQL filtering)
  if (colorIntent === 'excluded' && colorValues && colorValues.length > 0) {
    (searchConstraints as any).excludedColors = colorValues;
  }
  if (materialIntent === 'excluded' && materialValues && materialValues.length > 0) {
    (searchConstraints as any).excludedMaterials = materialValues;
  }
  if (patternIntent === 'excluded' && patternValues && patternValues.length > 0) {
    (searchConstraints as any).excludedStyleTags = patternValues; // Patterns are mapped to styleTags
  }
  if (occasionIntent === 'excluded' && occasionValues && occasionValues.length > 0) {
    (searchConstraints as any).excludedOccasions = occasionValues;
  }
  if (sizeIntent === 'excluded' && sizeValues && sizeValues.length > 0) {
    (searchConstraints as any).excludedSizes = sizeValues;
  }
  if (seasonIntent === 'excluded' && seasonValues && seasonValues.length > 0) {
    (searchConstraints as any).excludedSeasons = seasonValues;
  }
  if (fitIntent === 'excluded' && fitValues && fitValues.length > 0) {
    (searchConstraints as any).excludedFit = fitValues[0]; // Fit is single value
  }
  if (lengthIntent === 'excluded' && lengthValues && lengthValues.length > 0) {
    (searchConstraints as any).excludedLengths = lengthValues;
  }
  if (styleIntent === 'excluded' && styleValues && styleValues.length > 0) {
    // Styles are mapped to styleTags, so add to excludedStyleTags
    const existingExcludedStyleTags = (searchConstraints as any).excludedStyleTags || [];
    (searchConstraints as any).excludedStyleTags = [...existingExcludedStyleTags, ...styleValues];
  }
  if (collectionIntent === 'excluded' && collectionValues && collectionValues.length > 0) {
    (searchConstraints as any).excludedCollections = collectionValues;
  }
  if (necklineIntent === 'excluded' && necklineValues && necklineValues.length > 0) {
    (searchConstraints as any).excludedNecklines = necklineValues;
  }
  if (sleeveLengthIntent === 'excluded' && sleeveLengthValues && sleeveLengthValues.length > 0) {
    (searchConstraints as any).excludedSleeves = sleeveLengthValues; // sleeveLengths mapped to sleeves
  }
  if (formalityLevelIntent === 'excluded' && formalityLevelValues && formalityLevelValues.length > 0) {
    (searchConstraints as any).excludedFormalityLevels = formalityLevelValues;
  }
  if (ageGroupIntent === 'excluded' && ageGroupValues && ageGroupValues.length > 0) {
    (searchConstraints as any).excludedAgeGroups = ageGroupValues;
  }
  
  return searchConstraints;
}
