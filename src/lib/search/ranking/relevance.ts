/**
 * Relevance Scoring
 * 
 * Calculates relevance scores for products when using Prisma fallback (when raw SQL is disabled or fails).
 * This implements a weighted hierarchy of field importance for ranking products.
 * 
 * Field Importance Hierarchy:
 * - Identity / codes (strongest): title, brand, SKU, barcode
 * - Type & category (high): category, subcategory, vertical
 * - Needs & benefits (high): description, benefits, claims, useCases
 * - Specs / ingredients (medium-high): ingredients, materials, dimensions
 * - Price & availability (medium): sale price, recency (tie-breakers)
 */

import { logger } from '../../telemetry/logger';
import { extractSearchableTextFromAttributes } from '../utils';
import type { BroadWhereFilters } from '../query/types';

const MAX_TAKE = 2500; // safe for 13k catalog

/**
 * Product type for relevance scoring
 */
type ProductForScoring = {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  sourceId?: string | null;
  priceCents: number;
  salePriceCents: number | null;
  updatedAt: Date;
  attributes: unknown;
  // Core indexed columns (Phase 2)
  color?: string | null;
  fabric?: string | null;
  material?: string | null;
  occasion?: string | null;
  season?: string | null;
  fit?: string | null;
  
  // Enriched columns (for ranking boosts)
  length?: string | null;
  sleeve?: string | null;
  neckline?: string | null;
  formalityLevel?: string | null;
  temperatureIntent?: string | null;
  humidityFriendly?: boolean | null;
  occasionContext?: string[] | null;
  problemSolutions?: string[] | null;
  functionFeatures?: string[] | null;
  colorShade?: string | null;
  colorUndertone?: string | null;
  multicolor?: boolean | null;
  seasonalPalette?: string | null;
  enrichedColor?: string | null;
  ageGroup?: string | null;
};

/**
 * Keyword ranking data structure
 */
type KeywordRankingData = {
  exactPhrases: string[];
  twoWordCombos: string[];
  individualWords: string[];
} | null;

/**
 * Calculate relevance score for a single product
 * 
 * Uses a weighted hierarchy to score products based on how well they match the query.
 * Higher scores = better match.
 * 
 * @param product - Product to score
 * @param queryText - Original query text
 * @param keywordData - Pre-processed keyword data (phrases, combos, words)
 * @param whereFilters - WHERE filters used for the query
 * @param genderFilter - Optional gender filter for boosting
 * @returns Product with rank score added
 */
export function calculateRelevanceScore(
  product: ProductForScoring,
  queryText: string | undefined,
  keywordData: KeywordRankingData,
  whereFilters: BroadWhereFilters,
  genderFilter?: string[],
): ProductForScoring & { rank: number } {
  let rank = 0.0;
  const attrs = product.attributes as any;

  // Helper functions
  const safeLower = (val?: string | null) => (val || '').toString().toLowerCase().trim();
  const arrayLower = (arr?: unknown[]) =>
    Array.isArray(arr) ? arr.map((v) => safeLower(String(v))).filter(Boolean) : [];
  const textIncludesAny = (haystack: string, needles: string[]) =>
    needles.some((n) => n && haystack.includes(n));

  // Extract and normalize product fields
  const titleLower = safeLower(product.title);
  const descLower = safeLower(product.description);
  const subcatLower = safeLower(product.subcategory);
  const brandLower = safeLower(product.brand) || safeLower(attrs?.brand);
  const labelLower = safeLower(attrs?.label);
  const collectionLower = safeLower(attrs?.collection);
  const shortTitleLower = safeLower(attrs?.short_title || attrs?.shortTitle);
  const categoryLower = safeLower(product.category);
  const verticalLower = safeLower(attrs?.vertical);
  const taxonPathLower = safeLower(attrs?.taxon_path);
  const externalSkuLower = safeLower(attrs?.external_sku);
  const barcodeLower = safeLower(attrs?.barcode);
  const sourceIdLower = safeLower(product.sourceId);

  const attrText = extractSearchableTextFromAttributes(attrs).toLowerCase();
  const benefitsLower = arrayLower(attrs?.benefits).join(' ');
  const claimsLower = arrayLower(attrs?.claims).join(' ');
  const useCasesLower = arrayLower(attrs?.useCases).join(' ');
  const styleTagsLower = arrayLower(attrs?.styleTags).join(' ');
  const compatibilityLower = arrayLower(attrs?.compatibility).join(' ');
  const sensoryLower = safeLower(attrs?.sensoryProfile);
  const ingredientsLower = arrayLower(attrs?.ingredients).join(' ');
  const materialsLower = arrayLower(attrs?.materials || [attrs?.material]).join(' ');
  const dimsLower = safeLower(attrs?.dimensions);
  const weightLower = safeLower(attrs?.weight);
  const sizeNotesLower = safeLower(attrs?.sizeFitNotes);
  const usageInstrLower = safeLower(attrs?.usageInstructions);
  const safetyLower = arrayLower(attrs?.safetyCompliance).join(' ');
  const attrChipsLower = arrayLower((attrs as any)?.attribute_chips).join(' ');

  // Extract query tokens
  const queryTokens =
    keywordData?.individualWords?.length
      ? keywordData.individualWords
      : (queryText || '')
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length >= 2)
          .slice(0, 10);
  const phrases = keywordData?.exactPhrases || [];
  const twoWordCombos = keywordData?.twoWordCombos || [];

  const isCodeLike =
    !!queryText &&
    (/[A-Za-z]+[\d]+[\w-]*/.test(queryText) || /^\d{8,}$/.test(queryText.trim()));

  // -----------------------------
  // A) Identity / codes (strongest)
  // -----------------------------
  if (isCodeLike) {
    const qLower = queryText!.toLowerCase().trim();
    if (qLower && (externalSkuLower === qLower || barcodeLower === qLower || sourceIdLower === qLower)) {
      rank += 120;
    }
  }
  // Title / short title / label exact phrase (highest priority for identity)
  // Title matches should "almost automatically push products to the very top"
  if (phrases.some((p) => titleLower.includes(p))) rank += 60;
  if (phrases.some((p) => shortTitleLower.includes(p) || labelLower.includes(p))) rank += 40;
  // Brand / collection (very strong signal when mentioned)
  if (brandLower && queryTokens.some((t) => brandLower.includes(t))) rank += 30;
  if (collectionLower && queryTokens.some((t) => collectionLower.includes(t))) rank += 22;

  // -----------------------------
  // B) Type & category (almost as important as name)
  // -----------------------------
  const typeText = `${categoryLower} ${subcatLower} ${verticalLower} ${taxonPathLower}`;
  if (textIncludesAny(typeText, phrases)) rank += 28;
  else if (textIncludesAny(typeText, twoWordCombos)) rank += 20;
  else if (textIncludesAny(typeText, queryTokens)) rank += 15;

  // Special boost for subcategory matches with multiple query words
  // This helps queries like "bath gift sets" match "Bath & Body Gift Sets" subcategory
  if (subcatLower && queryTokens.length >= 2) {
    const matchingWords = queryTokens.filter((word) => subcatLower.includes(word));
    if (matchingWords.length >= 2) {
      // Give extra boost when subcategory matches 2+ words from query
      rank += 10 + (matchingWords.length - 2) * 2; // +10 for 2 words, +12 for 3, +14 for 4, etc.
    }
  }

  // -----------------------------
  // C) Needs & benefits (description, highlights, benefits, claims, attributes)
  // -----------------------------
  const needText = `${descLower} ${attrText} ${benefitsLower} ${claimsLower} ${useCasesLower} ${styleTagsLower} ${compatibilityLower} ${sensoryLower} ${attrChipsLower}`;
  if (textIncludesAny(needText, phrases)) rank += 20;
  else if (textIncludesAny(needText, twoWordCombos)) rank += 14;
  else if (textIncludesAny(needText, queryTokens)) rank += 10;

  // -----------------------------
  // D) Specs / ingredients / size (strong when explicitly asked)
  // -----------------------------
  const specText = `${ingredientsLower} ${materialsLower} ${dimsLower} ${weightLower} ${sizeNotesLower} ${usageInstrLower} ${safetyLower}`;
  if (textIncludesAny(specText, phrases)) rank += 18;
  else if (textIncludesAny(specText, twoWordCombos)) rank += 13;
  else if (textIncludesAny(specText, queryTokens)) rank += 9;

  // -----------------------------
  // E) Gender preference boost (kept)
  // -----------------------------
  if (genderFilter?.length) {
    const productGender = attrs?.gender;
    const normalizedProductGender = productGender?.toLowerCase().trim();
    for (const gender of genderFilter) {
      if (gender === 'mens') {
        if (normalizedProductGender === 'mens' || normalizedProductGender === 'male') {
          rank += 2.0;
          break;
        }
        if (normalizedProductGender === 'unisex') {
          rank += 1.0;
          break;
        }
      }
      if (gender === 'womens') {
        if (normalizedProductGender === 'womens' || normalizedProductGender === 'female') {
          rank += 2.0;
          break;
        }
        if (normalizedProductGender === 'unisex') {
          rank += 1.0;
          break;
        }
      }
      if (gender === 'unisex' && normalizedProductGender === 'unisex') {
        rank += 2.0;
        break;
      }
    }
  }

  // -----------------------------
  // F) Fallback general keyword boosts (lighter)
  // -----------------------------
  if (keywordData) {
    const searchText = `${titleLower} ${shortTitleLower} ${descLower} ${subcatLower} ${attrText}`;
    if (phrases.some((p) => searchText.includes(p))) rank += 6;
    else if (twoWordCombos.some((c) => searchText.includes(c))) rank += 4;
    else {
      let wordMatches = 0;
      for (const word of queryTokens) {
        if (searchText.includes(word)) {
          wordMatches++;
          if (wordMatches >= 4) break;
        }
      }
      rank += wordMatches * 1.0;
    }
  }

  // -----------------------------
  // G) Category alignment (extra boost when product type clearly matches query type)
  // -----------------------------
  if (whereFilters.categoryOr && whereFilters.categoryOr.length > 0) {
    for (const orCondition of whereFilters.categoryOr) {
      if (orCondition.category && product.category.toLowerCase().includes(orCondition.category.toLowerCase())) {
        rank += 8.0;
        break;
      }
    }
  } else if (whereFilters.category && product.category.toLowerCase().includes(whereFilters.category.toLowerCase())) {
    rank += 8.0;
  }

  // -----------------------------
  // H) Enriched attribute matches (boost products that match enriched constraints)
  // -----------------------------
  // Formality level match: +2.0 boost
  if (whereFilters.formalityLevel?.length && product.formalityLevel) {
    const productFormality = safeLower(product.formalityLevel);
    if (whereFilters.formalityLevel.some((f) => safeLower(f) === productFormality)) {
      rank += 2.0;
    }
  }

  // Temperature intent match: +2.5 boost (high priority for weather queries)
  if (whereFilters.temperatureIntent && product.temperatureIntent) {
    if (safeLower(product.temperatureIntent) === safeLower(whereFilters.temperatureIntent)) {
      rank += 2.5;
    }
  }

  // Humidity friendly match: +1.5 boost
  if (whereFilters.humidityFriendly === true && product.humidityFriendly === true) {
    rank += 1.5;
  }

  // Occasion context match: +2.0 boost
  if (whereFilters.occasionContext?.hasSome?.length && product.occasionContext?.length) {
    const productOccasions = product.occasionContext.map((o) => safeLower(o));
    const hasMatch = whereFilters.occasionContext.hasSome.some((constraintOccasion) =>
      productOccasions.includes(safeLower(constraintOccasion))
    );
    if (hasMatch) {
      rank += 2.0;
    }
  }

  // Problem solutions match: +2.0 boost per matching solution
  if (whereFilters.problemSolutions?.hasSome?.length && product.problemSolutions?.length) {
    const productSolutions = product.problemSolutions.map((s) => safeLower(s));
    const matchingSolutions = whereFilters.problemSolutions.hasSome.filter((constraintSolution) =>
      productSolutions.includes(safeLower(constraintSolution))
    );
    if (matchingSolutions.length > 0) {
      rank += matchingSolutions.length * 2.0;
    }
  }

  // Function features match: +1.5 boost per matching feature
  if (whereFilters.functionFeatures?.hasSome?.length && product.functionFeatures?.length) {
    const productFeatures = product.functionFeatures.map((f) => safeLower(f));
    const matchingFeatures = whereFilters.functionFeatures.hasSome.filter((constraintFeature) =>
      productFeatures.includes(safeLower(constraintFeature))
    );
    if (matchingFeatures.length > 0) {
      rank += matchingFeatures.length * 1.5;
    }
  }

  // Color shade match: +1.0 boost
  if (whereFilters.colorShade?.length && product.colorShade) {
    const productShade = safeLower(product.colorShade);
    if (whereFilters.colorShade.some((s) => safeLower(s) === productShade)) {
      rank += 1.0;
    }
  }

  // Color undertone match: +1.0 boost
  if (whereFilters.colorUndertone?.length && product.colorUndertone) {
    const productUndertone = safeLower(product.colorUndertone);
    if (whereFilters.colorUndertone.some((u) => safeLower(u) === productUndertone)) {
      rank += 1.0;
    }
  }

  // Length match
  if (whereFilters.length?.length && product.length) {
    const productLength = safeLower(product.length);
    if (whereFilters.length.some((l) => safeLower(l) === productLength)) {
      rank += 6.0; // Boost for length matches
    }
  }

  // -----------------------------
  // H) Price & availability as tie-breakers (small bonuses, only reorder already-good matches)
  // -----------------------------
  // NOTE: Stock status is now a HARD FILTER (applied above), not a scoring bonus
  // On sale: small tie-breaker
  if (product.salePriceCents && product.salePriceCents < product.priceCents) {
    rank += 3.0;
  }

  // Recency: small tie-breaker (up to +2 max)
  const daysSinceUpdate = (Date.now() - product.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  // Normalize to 0-2 range (products updated within last 30 days get full +2, older products get less)
  rank += (2.0 * Math.max(0, 30 - daysSinceUpdate)) / 30;

  return { ...product, rank };
}

/**
 * Apply relevance scoring to a list of products (Prisma fallback)
 * 
 * This is used when raw SQL ranking is disabled or fails.
 * Filters products by stock status and gender, then applies relevance scoring.
 * 
 * @param products - Products to score
 * @param queryText - Original query text
 * @param keywordData - Pre-processed keyword data
 * @param whereFilters - WHERE filters used for the query
 * @param genderFilter - Optional gender filter
 * @param take - Number of products to return
 * @returns Ranked products sorted by relevance
 */
export function applyRelevanceScoring(
  products: ProductForScoring[],
  queryText: string | undefined,
  keywordData: KeywordRankingData,
  whereFilters: BroadWhereFilters,
  genderFilter: string[] | undefined,
  take: number,
): Array<ProductForScoring & { rank: number }> {
  // Apply hard filters: stock status (in-stock only) and gender
  // Stock status is a HARD FILTER - only in-stock products are scored and shown
  let filteredResults = products.filter((product) => {
    // Hard filter: Only in-stock products
    return (product as any).stockStatus === 'in_stock';
  });

  // Apply gender filter in-memory if needed (Prisma JSON path filtering not available in all versions)
  // Supports both normalized (mens/womens) and raw CSV values (male/female)
  if (genderFilter?.length) {
    filteredResults = filteredResults.filter((product) => {
      const attrs = product.attributes as any;
      const productGender = attrs?.gender;
      if (!productGender) return false;

      const normalizedProductGender = productGender.toLowerCase().trim();

      for (const gender of genderFilter) {
        if (gender === 'mens') {
          // Match mens, male (CSV), or unisex
          if (
            normalizedProductGender === 'mens' ||
            normalizedProductGender === 'male' ||
            normalizedProductGender === 'unisex'
          ) {
            return true;
          }
        }
        if (gender === 'womens') {
          // Match womens, female (CSV), or unisex
          if (
            normalizedProductGender === 'womens' ||
            normalizedProductGender === 'female' ||
            normalizedProductGender === 'unisex'
          ) {
            return true;
          }
        }
        if (gender === 'unisex') {
          // Unisex only (strict)
          if (normalizedProductGender === 'unisex') {
            return true;
          }
        }
      }
      return false;
    });
  }

  // Calculate fallback relevance ranking (not recency-only) with a weighted hierarchy
  const rankedResults = filteredResults.map((product) =>
    calculateRelevanceScore(product, queryText, keywordData, whereFilters, genderFilter),
  );

  // Sort by rank DESC, then updatedAt DESC, and take top N
  rankedResults.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  logger.debug('relevance scoring applied', {
    totalFetched: products.length,
    afterGenderFilter: filteredResults.length,
    afterRanking: rankedResults.length,
    topRank: rankedResults[0]?.rank,
    genderFilter: genderFilter?.join(','),
    keywordFilters: whereFilters.keywordFilters?.slice(0, 3),
  });

  return rankedResults.slice(0, take);
}
