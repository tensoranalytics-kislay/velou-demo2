/**
 * Query Building
 * 
 * Builds broad WHERE filters for database queries.
 * Uses tolerant category matching via canonical categories.
 * Does NOT include JSON attributes (colors, fabrics, etc.) - those are filtered in memory.
 * 
 * The filter building process:
 * 1. Applies stock status filters (hard filter)
 * 2. Applies price range filters
 * 3. Applies brand filters
 * 4. Canonicalizes and expands categories (tolerant matching)
 * 5. Generates keyword filters for text search
 * 6. Applies merchandising rules (excluded categories)
 */

import { logger } from '../../telemetry/logger';
import { getCatalogOntology } from '../ontology';
import {
  canonicalizeCategory,
  detectCategoryProfile,
  getExpandedLeafCategories,
  getParentGpcTerms,
  getSynonymTerms,
} from '../canonicalize';
import type { SearchConstraints } from '../types';
import type { BroadWhereFilters, MerchContext } from './types';

// Default stock filter: only in-stock products are shown (hard filter)
const DEFAULT_STOCK_STATUS: Array<'in_stock'> = ['in_stock'];

/**
 * Builds broad WHERE filters (only indexed/structured fields)
 * 
 * Uses tolerant category matching via canonical categories.
 * Does NOT include JSON attributes (colors, fabrics, etc.) - those are filtered in memory.
 * 
 * @param constraints - Search constraints
 * @param merchContext - Merchandising context (rules, boosts, etc.)
 * @param userMessage - Optional user message for category inference
 * @returns Broad WHERE filters for database query
 * 
 * @example
 * ```typescript
 * const filters = await buildBroadWhereFilters(
 *   { category: 'dresses', priceMaxCents: 10000 },
 *   merchContext,
 *   'show me blue dresses under $100'
 * );
 * ```
 */
export async function buildBroadWhereFilters(
  constraints: SearchConstraints,
  merchContext: MerchContext,
  userMessage?: string,
): Promise<BroadWhereFilters> {
  const enforcedStock = constraints.inStockOnly !== false;
  const requireFreshStock = enforcedStock || merchContext.hideOutOfStock;

  // Ensure null values are converted to undefined (Prisma requires undefined, not null)
  const filters: BroadWhereFilters = {
    priceMinCents: constraints.priceMinCents === null ? undefined : constraints.priceMinCents,
    priceMaxCents: constraints.priceMaxCents === null ? undefined : constraints.priceMaxCents,
    brands: constraints.brands?.length ? constraints.brands : undefined,
    excludeProductIds: constraints.excludeProductIds,
    // Stock status: HARD FILTER - only in-stock products by default
    // This filters at DB level for efficiency, with in-memory filter as safety net
    stockStatus: requireFreshStock ? DEFAULT_STOCK_STATUS : [],
    excludedCategories: Array.from(merchContext.excludedCategories),
    // Gender filter: hard filter at DB level
    genders: constraints.genders?.length ? constraints.genders : undefined,
  };

  const ontology = await getCatalogOntology();
  const categoryProfile = detectCategoryProfile(ontology);

  // Tolerant category matching: canonicalize user intent
  // Support multi-category and canonical → DB mapping
  if (constraints.category || userMessage) {
    const { parseCategoryString, expandCanonicalToDbCategories } = await import('../category-mapping');
    
    // Parse category (handle comma-separated strings for outfits)
    let categoryList = parseCategoryString(constraints.category);
    
    // Fashion-only heuristic: if user didn't explicitly request "graphic" styles, don't over-restrict.
    if (categoryProfile?.name === 'fashion' && userMessage && categoryList.length > 0) {
      const messageLower = userMessage.toLowerCase();
      const hasGraphicKeyword = /\b(graphic|printed|print|design|logo|artwork)\b/i.test(messageLower);
      
      if (!hasGraphicKeyword) {
        // User didn't explicitly ask for graphic tshirts, so don't restrict to graphic
        categoryList = categoryList.map(cat => {
          const catLower = cat.toLowerCase();
          // Replace "graphic t shirt" variants with generic "t shirt"
          if (catLower.includes('graphic') && (catLower.includes('t shirt') || catLower.includes('tshirt') || catLower.includes('tee'))) {
            return 't shirt';
          }
          return cat;
        });
      }
    }
    
    if (categoryList.length > 0) {
      // Expand each canonical category to DB categories
      const allDbCategories = new Set<string>();
      const orConditions: Array<{ category?: string; googleCategory?: string; productType?: string }> = [];
      
      // For each category, expand canonical → DB and try canonicalization
      for (const cat of categoryList) {
        // First, expand using category mapping
        const expanded = expandCanonicalToDbCategories(cat, categoryProfile);
        for (const dbCat of expanded) {
          allDbCategories.add(dbCat);
          orConditions.push({ category: dbCat });
        }
        
        // Also try canonicalization for additional synonyms
        const canonicalResult = canonicalizeCategory(cat, ontology, categoryProfile);
        
        if (canonicalResult.canonical !== 'UNKNOWN' && canonicalResult.confidence > 0.3) {
          const expandedLeafCats = getExpandedLeafCategories(
            canonicalResult.canonical,
            ontology,
            categoryProfile,
          );
          const gpcTerms = getParentGpcTerms(canonicalResult.canonical, categoryProfile);
          const synonymTerms = getSynonymTerms(canonicalResult.canonical, categoryProfile);
          
          // Match on DB category field
          for (const leafCat of expandedLeafCats) {
            allDbCategories.add(leafCat);
            orConditions.push({ category: leafCat });
          }
          
          // Match on googleProductCategory (in attributes JSON)
          for (const gpcTerm of gpcTerms) {
            orConditions.push({ googleCategory: gpcTerm });
          }
          
          // Match on productType (in attributes JSON)
          for (const synonym of synonymTerms.slice(0, 5)) {
            orConditions.push({ productType: synonym });
          }
          
          // Add keyword filters
          const allKeywords = new Set<string>();
          synonymTerms.slice(0, 10).forEach(k => allKeywords.add(k));
          if (constraints.expandedKeywords?.length) {
            constraints.expandedKeywords.slice(0, 15).forEach(k => allKeywords.add(k));
          }
          if (allKeywords.size > 0) {
            filters.keywordFilters = Array.from(allKeywords).slice(0, 15);
          }
        }
      }
      
      // Build categoryOr from all DB categories
      if (orConditions.length > 0) {
        filters.categoryOr = orConditions;
      } else if (allDbCategories.size > 0) {
        // Fallback: use expanded DB categories
        filters.categoryOr = Array.from(allDbCategories).map(cat => ({ category: cat }));
      } else if (categoryList.length === 1) {
        // Single category fallback
        filters.category = categoryList[0];
      }
    } else if (userMessage) {
      // Fallback: try canonicalization from user message
      const canonicalResult = canonicalizeCategory(userMessage, ontology, categoryProfile);
      
      if (canonicalResult.canonical !== 'UNKNOWN' && canonicalResult.confidence > 0.3) {
        const expandedLeafCats = getExpandedLeafCategories(
          canonicalResult.canonical,
          ontology,
          categoryProfile,
        );
        const orConditions = expandedLeafCats.map(cat => ({ category: cat }));
        if (orConditions.length > 0) {
          filters.categoryOr = orConditions;
        }
      }
    }
    
    // Use expandedKeywords if provided and no keyword filters set yet
    if (!filters.keywordFilters && constraints.expandedKeywords?.length) {
      filters.keywordFilters = constraints.expandedKeywords.slice(0, 15);
      logger.debug('expandedKeywords_used_in_search', {
        expandedKeywords: constraints.expandedKeywords.slice(0, 15),
        expandedKeywordsCount: constraints.expandedKeywords.length,
        keywordFiltersSet: filters.keywordFilters.length,
      });
    }

    // As a final fallback, use the literal categories as lightweight keyword filters
    if (!filters.keywordFilters && categoryList.length > 0) {
      filters.keywordFilters = categoryList
        .map((cat) => cat.toLowerCase())
        .slice(0, 10);
    }
  } else {
    // No category constraint - use expandedKeywords if provided
    if (constraints.expandedKeywords?.length) {
      filters.keywordFilters = constraints.expandedKeywords.slice(0, 15);
      logger.debug('expandedKeywords_used_in_search_no_category', {
        expandedKeywords: constraints.expandedKeywords.slice(0, 15),
        expandedKeywordsCount: constraints.expandedKeywords.length,
        keywordFiltersSet: filters.keywordFilters.length,
      });
    }
  }

  return filters;
}


