/**
 * Multi-View Retrieval
 * 
 * Orchestrates parallel retrieval from lexical, semantic, and concept indexes.
 * Merges results and returns candidate product IDs with score maps.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 3)
 */

import { searchProducts } from '../search';
import { embedText, searchVectorIndex } from '../search/vector/index';
import { getConceptIndex } from '../search/concept/cache';
import { searchConceptIndex } from '../search/concept/index';
import { logger } from '../telemetry/logger';
import type { QueryClassification } from './classifier';
import type { SearchConstraints } from '../search/types';

const LEXICAL_LIMIT = 150;
const SEMANTIC_LIMIT = 150;
const MAX_CANDIDATES = 400;

/**
 * Convert QueryClassification constraints to SearchConstraints for lexical search
 */
function classificationToSearchConstraints(
  classification: QueryClassification,
  query: string,
  merchantId?: string
): SearchConstraints {
  const constraints: SearchConstraints = {
    query,
    inStockOnly: true,
    limit: LEXICAL_LIMIT,
  };
  
  // Price range
  if (classification.constraints.priceMinCents) {
    constraints.priceMinCents = classification.constraints.priceMinCents;
  }
  if (classification.constraints.priceMaxCents) {
    constraints.priceMaxCents = classification.constraints.priceMaxCents;
  }
  
  // Product types → category
  if (classification.constraints.productTypes?.length) {
    // Use first product type as category hint (searchProducts handles this)
    constraints.productTypes = classification.constraints.productTypes;
  }
  
  // Collections → add to query for keyword matching
  if (classification.constraints.collections?.length) {
    const collectionText = classification.constraints.collections.join(' ');
    constraints.query = constraints.query
      ? `${constraints.query} ${collectionText}`
      : collectionText;
  }
  
  // Genders
  if (classification.constraints.genders?.length) {
    constraints.genders = classification.constraints.genders;
  }
  
  // Age groups
  if (classification.constraints.ageGroups?.length) {
    constraints.ageGroups = classification.constraints.ageGroups;
  }
  
  // Made without → could map to claims or compatibility
  // For now, we'll rely on concept index for this
  
  return constraints;
}

/**
 * Multi-view retrieval: lexical + semantic + concept
 * 
 * Runs three retrieval paths in parallel and merges candidate product IDs.
 * Returns candidate IDs along with score maps for downstream ranking.
 * 
 * @param query - Original user query text
 * @param classification - Query classification with extracted constraints
 * @param merchantId - Optional merchant ID for filtering
 * @param searchMethods - Optional preferences for which search methods to use
 * @returns Candidate product IDs and score maps
 */
export async function multiViewRetrieval(
  query: string,
  classification: QueryClassification,
  merchantId?: string,
  searchMethods?: {
    lexical: boolean;
    semantic: boolean;
    concept: boolean;
  }
): Promise<{
  candidateIds: string[];
  lexicalScores: Map<string, number>;
  semanticScores: Map<string, number>;
  conceptMatches: Map<string, Set<string>>;
}> {
  const startTime = Date.now();
  
  // Default to all methods enabled if not specified
  const methods = searchMethods || { lexical: true, semantic: true, concept: true };
  
  logger.debug('multiViewRetrieval: starting', {
    query: query.substring(0, 100),
    type: classification.type,
    merchantId,
    searchMethodsReceived: searchMethods,
    searchMethodsApplied: methods,
    lexicalEnabled: methods.lexical,
    semanticEnabled: methods.semantic,
    conceptEnabled: methods.concept,
  });
  
  // Build search constraints for lexical search
  const searchConstraints = classificationToSearchConstraints(
    classification,
    query,
    merchantId
  );
  
  // Build array of promises based on enabled methods with timing
  const promises: Array<Promise<any>> = [];
  
  // A. Lexical search (if enabled)
  if (methods.lexical) {
    promises.push(
      (async () => {
        const lexicalStart = Date.now();
        try {
          const result = await searchProducts(searchConstraints, query, merchantId);
          const lexicalDuration = Date.now() - lexicalStart;
          return {
            type: 'lexical' as const,
            products: result.products,
            wasRelaxed: result.wasRelaxed,
            duration: lexicalDuration,
          };
        } catch (error) {
          const lexicalDuration = Date.now() - lexicalStart;
          logger.error('multiViewRetrieval: lexical search error', {
            error: error instanceof Error ? error.message : String(error),
            duration: lexicalDuration,
          });
          return { type: 'lexical' as const, products: [], wasRelaxed: false, duration: lexicalDuration };
        }
      })()
    );
  } else {
    promises.push(Promise.resolve({ type: 'lexical' as const, products: [], wasRelaxed: false, duration: 0 }));
  }
  
  // B. Semantic search (if enabled)
  if (methods.semantic) {
    promises.push(
      (async () => {
        const semanticStart = Date.now();
        try {
          const embedStart = Date.now();
          const embedding = await embedText(query);
          const embedDuration = Date.now() - embedStart;
          
          const vectorStart = Date.now();
          const results = await searchVectorIndex(embedding, SEMANTIC_LIMIT, {
            inStockOnly: true,
            merchantId,
          });
          const vectorDuration = Date.now() - vectorStart;
          const semanticDuration = Date.now() - semanticStart;
          
          return { 
            type: 'semantic' as const, 
            results,
            duration: semanticDuration,
            embedDuration,
            vectorDuration,
          };
        } catch (error) {
          const semanticDuration = Date.now() - semanticStart;
          logger.warn('multiViewRetrieval: semantic search error (falling back)', {
            error: error instanceof Error ? error.message : String(error),
            duration: semanticDuration,
          });
          return { type: 'semantic' as const, results: [], duration: semanticDuration, embedDuration: 0, vectorDuration: 0 };
        }
      })()
    );
  } else {
    promises.push(Promise.resolve({ type: 'semantic' as const, results: [], duration: 0, embedDuration: 0, vectorDuration: 0 }));
  }
  
  // C. Concept search (if enabled)
  if (methods.concept) {
    promises.push(
      (async () => {
        const conceptStart = Date.now();
        try {
          const indexStart = Date.now();
          const conceptIndex = await getConceptIndex(merchantId);
          const indexDuration = Date.now() - indexStart;
          
          const searchStart = Date.now();
          const constraints = {
            concerns: classification.constraints.concerns,
            skinTypes: classification.constraints.skinTypes,
            applicationAreas: classification.constraints.applicationAreas,
            ingredients: classification.constraints.mustHaveIngredients,
            madeWithout: classification.constraints.madeWithout,
            productTypes: classification.constraints.productTypes,
          };
          const productIds = searchConceptIndex(conceptIndex, constraints);
          const searchDuration = Date.now() - searchStart;
          const conceptDuration = Date.now() - conceptStart;
          
          return { 
            type: 'concept' as const, 
            productIds, 
            conceptIndex,
            duration: conceptDuration,
            indexDuration,
            searchDuration,
          };
        } catch (error) {
          const conceptDuration = Date.now() - conceptStart;
          logger.warn('multiViewRetrieval: concept search error (falling back)', {
            error: error instanceof Error ? error.message : String(error),
            duration: conceptDuration,
          });
          return { type: 'concept' as const, productIds: [], conceptIndex: null, duration: conceptDuration, indexDuration: 0, searchDuration: 0 };
        }
      })()
    );
  } else {
    promises.push(Promise.resolve({ type: 'concept' as const, productIds: [], conceptIndex: null, duration: 0, indexDuration: 0, searchDuration: 0 }));
  }
  
  // Run enabled retrieval paths in parallel
  const [lexicalResult, semanticResult, conceptResult] = await Promise.allSettled(promises);
  
  // Extract results (handle Promise.allSettled results)
  const lexicalData = lexicalResult.status === 'fulfilled' ? lexicalResult.value : { type: 'lexical' as const, products: [], wasRelaxed: false };
  const semanticData = semanticResult.status === 'fulfilled' ? semanticResult.value : { type: 'semantic' as const, results: [] };
  const conceptData = conceptResult.status === 'fulfilled' 
    ? conceptResult.value 
    : { type: 'concept' as const, productIds: [], conceptIndex: null };
  
  const lexicalProducts = lexicalData.products || [];
  const semanticResults = semanticData.results || [];
  const conceptProductIds: string[] = conceptData.productIds || [];
  const conceptIndex = conceptData.conceptIndex || null;
  
  // Build score maps
  const lexicalScores = new Map<string, number>();
  const semanticScores = new Map<string, number>();
  const conceptMatches = new Map<string, Set<string>>();
  
  // Lexical scores: use relevance score if available, otherwise derive from position
  for (let i = 0; i < lexicalProducts.length; i++) {
    const product = lexicalProducts[i];
    // Simple positional score: first product gets highest score
    // In production, searchProducts might return relevance scores we can use
    const score = 1.0 - (i / lexicalProducts.length) * 0.5; // 1.0 to 0.5
    lexicalScores.set(product.id, score);
  }
  
  // Semantic scores: use similarity from vector search
  for (const result of semanticResults) {
    semanticScores.set(result.productId, result.similarity);
  }
  
  // Concept matches: track which concepts matched which products
  // Format: concept → Set<productId>
  if (conceptIndex && conceptProductIds.length > 0) {
    // Track which constraints were used
    const constraintGroups = [
      { key: 'concerns', values: classification.constraints.concerns || [] },
      { key: 'skinTypes', values: classification.constraints.skinTypes || [] },
      { key: 'applicationAreas', values: classification.constraints.applicationAreas || [] },
      { key: 'ingredients', values: classification.constraints.mustHaveIngredients || [] },
      { key: 'madeWithout', values: classification.constraints.madeWithout || [] },
      { key: 'productTypes', values: classification.constraints.productTypes || [] },
    ];
    
    // For each constraint value, check if any products matched it
    for (const group of constraintGroups) {
      for (const constraintValue of group.values) {
        const normalizedValue = constraintValue.toLowerCase().trim();
        let matchedProducts: Set<string> | undefined;
        
        // Check appropriate index map
        switch (group.key) {
          case 'concerns':
            matchedProducts = conceptIndex.concerns.get(normalizedValue);
            break;
          case 'skinTypes':
            matchedProducts = conceptIndex.skinTypes.get(normalizedValue);
            break;
          case 'applicationAreas':
            matchedProducts = conceptIndex.applicationAreas.get(normalizedValue);
            break;
          case 'ingredients':
            matchedProducts = conceptIndex.ingredients.get(normalizedValue);
            break;
          case 'madeWithout':
            matchedProducts = conceptIndex.madeWithout.get(normalizedValue);
            break;
          case 'productTypes':
            matchedProducts = conceptIndex.productTypes.get(normalizedValue);
            break;
        }
        
        if (matchedProducts) {
          // Only include products that are in our concept search results
          for (const productId of matchedProducts) {
            if (conceptProductIds.includes(productId)) {
              if (!conceptMatches.has(constraintValue)) {
                conceptMatches.set(constraintValue, new Set());
              }
              conceptMatches.get(constraintValue)!.add(productId);
            }
          }
        }
      }
    }
  }
  
  // Merge candidate IDs: union of all sources
  const candidateIdSet = new Set<string>();
  
  // Add lexical candidates
  for (const product of lexicalProducts) {
    candidateIdSet.add(product.id);
  }
  
  // Add semantic candidates
  for (const result of semanticResults) {
    candidateIdSet.add(result.productId);
  }
  
  // Add concept candidates
  for (const productId of conceptProductIds) {
    candidateIdSet.add(productId);
  }
  
  // Convert to array, sort for deterministic order, limit
  const candidateIds = Array.from(candidateIdSet)
    .sort()
    .slice(0, MAX_CANDIDATES);
  
  const duration = Date.now() - startTime;
  
  // Extract timing data
  const lexicalDuration = lexicalData.duration || 0;
  const semanticDuration = semanticData.duration || 0;
  const conceptDuration = conceptData.duration || 0;
  const semanticEmbedDuration = semanticData.embedDuration || 0;
  const semanticVectorDuration = semanticData.vectorDuration || 0;
  const conceptIndexDuration = conceptData.indexDuration || 0;
  const conceptSearchDuration = conceptData.searchDuration || 0;
  
  // Determine which method was slowest (bottleneck)
  const timings = [
    { method: 'lexical', duration: lexicalDuration },
    { method: 'semantic', duration: semanticDuration },
    { method: 'concept', duration: conceptDuration },
  ].filter(t => t.duration > 0);
  const slowest = timings.length > 0 
    ? timings.reduce((max, t) => t.duration > max.duration ? t : max)
    : null;
  
  logger.info('multiViewRetrieval: complete', {
    duration,
    lexicalCount: lexicalProducts.length,
    semanticCount: semanticResults.length,
    conceptCount: conceptProductIds.length,
    mergedCount: candidateIds.length,
    merchantId,
    // Individual method timings
    lexicalDuration,
    semanticDuration,
    semanticEmbedDuration,
    semanticVectorDuration,
    conceptDuration,
    conceptIndexDuration,
    conceptSearchDuration,
    slowestMethod: slowest?.method || 'none',
    slowestDuration: slowest?.duration || 0,
    // Show which methods were actually enabled
    lexicalEnabled: methods.lexical,
    semanticEnabled: methods.semantic,
    conceptEnabled: methods.concept,
  });
  
  return {
    candidateIds,
    lexicalScores,
    semanticScores,
    conceptMatches,
  };
}

