/**
 * Search Module - Main Entry Point
 * 
 * Orchestrates the search pipeline:
 * 1. Build filters → query/buildFilters.ts
 * 2. Calculate take → query/calculateTake.ts
 * 3. Database search → ranking/dbRankedSearch.ts
 * 4. Attribute filtering → filtering/attributes.ts
 * 5. Constraint relaxation → filtering/relaxation.ts
 * 6. Final scoring → ranking/relevance.ts (if needed)
 * 
 * This module maintains backward compatibility - all existing APIs work unchanged.
 * 
 * TODO: Multi-view retrieval integration
 * See: docs/loccitane_multiview_retrieval.md
 * 
 * This module provides lexical search (one of three views).
 * Multi-view retrieval (lexical + vector + concept) will be added in:
 * src/lib/loccitane/retrieval.ts (for L'Occitane pipeline only)
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import { getCatalogOntology } from './ontology';
import type {
  ProductAttributes,
  ProductSearchResult,
  SearchConstraints,
  SearchResultItem,
} from './types';

// Import from submodules
import { buildBroadWhereFilters } from './query/buildFilters';
import { calculateDynamicTake } from './query/calculateTake';
import type { BroadWhereFilters, MerchContext } from './query/types';
import { dbRankedSearch } from './ranking/dbRankedSearch';
import { matchesAttributeFilters, deriveAttributeConstraintMeta } from './filtering/attributes';
import type { AttributeConstraintMeta } from './filtering/types';
import {
  dropAttributeFilters,
  keepOnlyCategoryAndPrice,
  keepOnlyQuery,
} from './filtering/relaxation';

// Constants
const DEFAULT_LIMIT = 8;
const RELAXED_TARGET = 8;
const MAX_TAKE = 2500; // safe for 13k catalog

/**
 * Build merchandising context from active rules
 * 
 * Loads active merchandising rules and builds context for filtering and boosting.
 * 
 * @returns Merchandising context with excluded categories, category boosts, and stock filter settings
 */
async function buildMerchContext(): Promise<MerchContext> {
  const rules = await prisma.merchRule.findMany({
    where: { isActive: true },
  });

  const excludedCategories = new Set<string>();
  const boostByCategory = new Map<string, number>();
  let hideOutOfStock = false;

  for (const rule of rules) {
    if (rule.ruleType === 'exclude_category') {
      excludedCategories.add(rule.value);
    }
    if (rule.ruleType === 'boost_category') {
      boostByCategory.set(rule.value, rule.weight ?? 1);
    }
    if (rule.ruleType === 'hide_out_of_stock') {
      hideOutOfStock = true;
    }
  }

  return { excludedCategories, boostByCategory, hideOutOfStock };
}

/**
 * Convert product to search result item
 * 
 * @param product - Product from database
 * @returns Search result item
 */
const toResultItem = (product: {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  productUrl: string;
  priceCents: number;
  salePriceCents: number | null;
  currency: string;
  category: string;
  stockStatus: string;
  attributes: unknown;
}): SearchResultItem => ({
  id: product.id,
  title: product.title,
  description: product.description,
  imageUrl: product.imageUrl,
  productUrl: product.productUrl,
  priceCents: product.priceCents,
  salePriceCents: product.salePriceCents,
  currency: product.currency,
  category: product.category,
  stockStatus: product.stockStatus,
  attributes: (product.attributes ?? {}) as ProductAttributes,
});

/**
 * Widening tiers for guaranteed full-catalog coverage
 * 
 * Builds tiers of progressively relaxed filters when strict filters eliminate all candidates.
 * Each tier drops constraints in order: category → brand → price → everything except stock.
 */
type WideningTier = {
  whereFilters: BroadWhereFilters;
  take: number;
  description: string;
};

function buildWideningTiers(
  originalFilters: BroadWhereFilters,
  originalQuery: string | undefined,
): WideningTier[] {
  const tiers: WideningTier[] = [];

  // Tier 1: Drop category, keep price/brand/stock/gender
  // Keep keywordFilters and genders during relaxation
  if (originalFilters.category || originalFilters.categoryOr) {
    tiers.push({
      whereFilters: {
        ...originalFilters,
        category: undefined,
        categoryOr: undefined, // Drop category OR conditions
        // Keep keywordFilters for canonical matching
        keywordFilters: originalFilters.keywordFilters,
        // Keep genders as hard filter
        genders: originalFilters.genders,
      },
      take: MAX_TAKE,
      description: 'drop_category',
    });
  }

  // Tier 2: Drop brand, keep price/stock/gender
  if (originalFilters.brands?.length) {
    tiers.push({
      whereFilters: {
        ...originalFilters,
        category: undefined,
        brands: undefined,
        // Keep genders as hard filter
        genders: originalFilters.genders,
      },
      take: MAX_TAKE,
      description: 'drop_brand',
    });
  }

  // Tier 3: Drop price, keep stock/gender
  if (originalFilters.priceMinCents !== undefined || originalFilters.priceMaxCents !== undefined) {
    tiers.push({
      whereFilters: {
        ...originalFilters,
        category: undefined,
        brands: undefined,
        priceMinCents: undefined,
        priceMaxCents: undefined,
        // Keep genders as hard filter
        genders: originalFilters.genders,
      },
      take: MAX_TAKE,
      description: 'drop_price',
    });
  }

  // Tier 4: Only stock filter (if required) - genders preserved until final step
  if (originalFilters.stockStatus.length > 0) {
    tiers.push({
      whereFilters: {
        stockStatus: originalFilters.stockStatus,
        excludedCategories: originalFilters.excludedCategories,
        excludeProductIds: originalFilters.excludeProductIds,
        // Keep genders as hard filter even in final tier
        genders: originalFilters.genders,
      },
      take: MAX_TAKE,
      description: 'stock_only',
    });
  }

  return tiers;
}

/**
 * Main search function
 * 
 * Performs a complete product search with:
 * 1. Database-level ranked search
 * 2. In-memory attribute filtering
 * 3. Constraint relaxation (if needed)
 * 4. Final scoring and ranking
 * 
 * @param constraints - Search constraints
 * @param userMessage - Optional user message for category inference
 * @param merchantId - Optional merchant ID for multi-tenant isolation
 * @returns Search results with products and relaxation flag
 */
export async function searchProducts(
  constraints: SearchConstraints = {},
  userMessage?: string,
  merchantId?: string, // Multi-tenant isolation
): Promise<ProductSearchResult> {
  const merchContext = await buildMerchContext();

  // Debug logging
  logger.debug('searchProducts constraints', {
    category: constraints.category,
    priceMinCents: constraints.priceMinCents,
    priceMaxCents: constraints.priceMaxCents,
    fabrics: constraints.fabrics?.length ? `${constraints.fabrics.length} fabrics` : undefined,
    colors: constraints.colors?.length ? `${constraints.colors.length} colors` : undefined,
    seasons: constraints.seasons?.length ? `${constraints.seasons.length} seasons` : undefined,
    occasions: constraints.occasions?.length ? `${constraints.occasions.length} occasions` : undefined,
    sizes: constraints.sizes?.length ? `${constraints.sizes.length} sizes` : undefined,
    fit: constraints.fit,
    inStockOnly: constraints.inStockOnly,
    query: constraints.query,
    brands: constraints.brands?.length ? `${constraints.brands.length} brands` : undefined,
    expandedKeywords: constraints.expandedKeywords,
    expandedKeywordsCount: constraints.expandedKeywords?.length || 0,
    hasHardTextFilters: !!(constraints as any).hardTextFilters,
    hardTextFilters: (constraints as any).hardTextFilters,
  });

  const limit = constraints.limit ?? DEFAULT_LIMIT;
  const broadFilters = await buildBroadWhereFilters(constraints, merchContext, userMessage);

  // Extract keyword filters for take calculation
  const keywordFilters = broadFilters.keywordFilters || (constraints as any).hardTextFilters;
  const dynamicTake = calculateDynamicTake(constraints, limit, keywordFilters);

  // Debug logging for canonical category and keyword filters
  logger.debug('searchProducts canonicalCategory', {
    category: constraints.category,
    categoryOr: broadFilters.categoryOr?.length,
    keywordFiltersEnabled: !!broadFilters.keywordFilters && broadFilters.keywordFilters.length > 0,
    keywordFilters: broadFilters.keywordFilters?.slice(0, 5),
    adaptiveTakeUsed: dynamicTake,
  });

  // Step 1: Database-level ranked search
  const dbCandidates = await dbRankedSearch(
    broadFilters,
    constraints.query,
    merchContext.boostByCategory,
    dynamicTake,
    broadFilters.keywordFilters, // Pass keyword filters for SQL prefilter
    merchantId, // Multi-tenant isolation
  );

  logger.debug('searchProducts dbRankedSearch', {
    dbCandidates: dbCandidates.length,
    take: dynamicTake,
    hasQuery: !!constraints.query,
    category: constraints.category,
    categoryType: Array.isArray(constraints.category) ? 'array' : typeof constraints.category,
    expandedDbCategories: broadFilters.categoryOr?.map((c) => c.category).filter(Boolean),
    genders: constraints.genders,
    genderFilter: broadFilters.genders,
  });

  // Step 2: In-memory attribute filtering (includes canonical category matching)
  // Get ontology for color validation
  const ontology = await getCatalogOntology();
  const constraintMeta = deriveAttributeConstraintMeta(constraints, broadFilters.categoryOr);
  let filtered = dbCandidates;
  if (constraintMeta.hasHardAttributeConstraints) {
    filtered = dbCandidates.filter((product) => {
      const attrs = (product.attributes ?? {}) as ProductAttributes;
      return matchesAttributeFilters(
        attrs,
        constraints,
        broadFilters.categoryOr,
        ontology.colors,
        constraintMeta,
      ); // Pass color ontology for strict matching
    });
  }

  logger.debug('searchProducts afterAttributeFilter', {
    dbCandidates: dbCandidates.length,
    afterAttributeFilter: filtered.length,
    hasHardAttributeConstraints: constraintMeta.hasHardAttributeConstraints,
    hasCategoryBridge: constraintMeta.hasCategoryBridge,
    hardFacetFields: constraintMeta.hardFacetFields,
    ignoredDerivedFacetFields: constraintMeta.ignoredDerivedFacetFields,
  });

  let finalProducts = filtered;
  let wasRelaxed = false;

  // Step 3: Widening fallback only when explicit facets eliminated every candidate
  const attributeFilterEliminatedAll =
    constraintMeta.hasHardAttributeConstraints && filtered.length === 0 && dbCandidates.length > 0;

  if (attributeFilterEliminatedAll) {
    const wideningTiers = buildWideningTiers(broadFilters, constraints.query);
    let widened = false;

    for (const tier of wideningTiers) {
      const tierKeywordFilters = tier.whereFilters.keywordFilters || broadFilters.keywordFilters;
      const tierCandidates = await dbRankedSearch(
        tier.whereFilters,
        constraints.query, // Keep original query for ranking
        merchContext.boostByCategory,
        tier.take,
        tierKeywordFilters, // Keep keyword filters during relaxation
        merchantId, // Multi-tenant isolation
      );

      let tierFiltered = tierCandidates;
      if (constraintMeta.hasHardAttributeConstraints) {
        tierFiltered = tierCandidates.filter((product) =>
          matchesAttributeFilters(
            (product.attributes ?? {}) as ProductAttributes,
            constraints,
            tier.whereFilters.categoryOr, // Pass categoryOr for JSON attribute matching
            ontology.colors, // Pass color ontology for strict matching
            constraintMeta,
          ),
        );
      }

      if (tierFiltered.length > 0) {
        finalProducts = tierFiltered;
        wasRelaxed = true;
        widened = true;
        logger.debug('searchProducts widened', {
          tier: tier.description,
          candidates: tierFiltered.length,
        });
        break; // Use first tier that gives us more results
      }
    }

    // If still not enough, use DB candidates without strict attribute filtering
    if (!widened) {
      finalProducts = dbCandidates;
      wasRelaxed = true;
      logger.debug('searchProducts relaxed', {
        reason: 'No products matched strict attribute filters, using DB candidates',
        dbCandidates: dbCandidates.length,
      });
    }
  }

  if (finalProducts.length === 0) {
    return {
      products: [],
      wasRelaxed: false,
    };
  }

  // Step 4: Final scoring and ranking (category boost + soft attribute matching)
  const scored = finalProducts
    .map((product) => {
      const baseScore = merchContext.boostByCategory.get(product.category) ?? 0;
      const dbRank = product.rank ?? 0;
      const attrs = (product.attributes ?? {}) as ProductAttributes;

      // Soft attribute matching (when relaxed)
      let attributeScore = 0;
      if (wasRelaxed) {
        if (constraints.colors?.length && attrs.color) {
          const colorMatch = constraints.colors.some((c) =>
            attrs.color?.toLowerCase().includes(c.toLowerCase()),
          );
          if (colorMatch) attributeScore += 0.3;
        }
        if (constraints.fabrics?.length && attrs.fabric) {
          const fabricMatch = constraints.fabrics.some((f) =>
            attrs.fabric?.toLowerCase().includes(f.toLowerCase()),
          );
          if (fabricMatch) attributeScore += 0.3;
        }
        if (constraints.materials?.length && attrs.material) {
          const materialMatch = constraints.materials.some((m) =>
            attrs.material?.toLowerCase().includes(m.toLowerCase()),
          );
          if (materialMatch) attributeScore += 0.3;
        }
        if (constraints.occasions?.length && attrs.occasion) {
          const occasionMatch = constraints.occasions.some((o) =>
            attrs.occasion?.toLowerCase().includes(o.toLowerCase()),
          );
          if (occasionMatch) attributeScore += 0.2;
        }
        if (constraints.seasons?.length && attrs.season) {
          const seasonMatch = constraints.seasons.some((s) =>
            attrs.season?.toLowerCase().includes(s.toLowerCase()),
          );
          if (seasonMatch) attributeScore += 0.2;
        }
        if (constraints.fit && attrs.fit) {
          if (attrs.fit.toLowerCase() === constraints.fit.toLowerCase()) {
            attributeScore += 0.2;
          }
        }
      }

      return {
        product,
        score: baseScore + dbRank + attributeScore,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.product.updatedAt.getTime() - a.product.updatedAt.getTime();
    })
    .slice(0, limit)
    .map(({ product }) => toResultItem(product));

  logger.debug('searchProducts return', {
    resultCount: scored.length,
    wasRelaxed,
  });

  return {
    products: scored,
    wasRelaxed,
  };
}

/**
 * Relaxed search function
 * 
 * Performs search with automatic constraint relaxation if no results found.
 * Uses tiered relaxation: drop attributes → drop category/price → drop everything except query.
 * 
 * @param constraints - Search constraints
 * @param limit - Maximum number of results to return
 * @param userMessage - Optional user message for category inference
 * @returns Relaxed search results with candidates and relaxation flag
 */
export async function searchProductsRelaxed(
  constraints: SearchConstraints,
  limit = 8,
  userMessage?: string,
): Promise<{
  candidates: SearchResultItem[];
  relaxedConstraints: SearchConstraints;
  wasRelaxed: boolean;
}> {
  const strictResult = await searchProducts({ ...constraints, limit }, userMessage);
  if (strictResult.products.length > 0) {
    return {
      candidates: strictResult.products.slice(0, limit),
      relaxedConstraints: constraints,
      wasRelaxed: false,
    };
  }

  const relaxationSteps: Array<(input: SearchConstraints) => SearchConstraints> = [
    dropAttributeFilters,
    keepOnlyCategoryAndPrice,
    keepOnlyQuery,
  ];

  for (const relax of relaxationSteps) {
    const relaxedConstraints = relax({ ...constraints });
    const result = await searchProducts({ ...relaxedConstraints, limit: RELAXED_TARGET }, userMessage);
    if (result.products.length > 0) {
      return {
        candidates: result.products.slice(0, Math.max(limit, 5)),
        relaxedConstraints,
        wasRelaxed: true,
      };
    }
  }

  return {
    candidates: [],
    relaxedConstraints: constraints,
    wasRelaxed: true,
  };
}

// Re-export types and functions for backward compatibility
export type { AttributeConstraintMeta } from './filtering/types';
export { deriveAttributeConstraintMeta, matchesAttributeFilters } from './filtering/attributes';
