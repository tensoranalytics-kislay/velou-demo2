import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import {
  canonicalizeCategory,
  detectCategoryProfile,
  getExpandedLeafCategories,
  getParentGpcTerms,
  getSynonymTerms,
  type CanonicalCategory,
} from './canonicalize';
import { getCatalogOntology } from './ontology';
import type {
  ProductAttributes,
  ProductSearchResult,
  SearchConstraints,
  SearchResultItem,
} from './types';

const DEFAULT_LIMIT = 8;
const RELAXED_TARGET = 8;
// Default stock filter: only in-stock products are shown (hard filter)
// This can be overridden by constraints.inStockOnly = false if needed
const DEFAULT_STOCK_STATUS: Array<'in_stock'> = ['in_stock'];
const STOCK_OK: Array<'in_stock' | 'low_stock'> = ['in_stock', 'low_stock']; // Kept for backward compatibility if needed

// Dynamic take constants for ~13k catalog
const BASE_TAKE_MULTIPLIER = 50; // base * limit
const MIN_TAKE = 300;
const MAX_TAKE = 2500; // safe for 13k catalog

type MerchContext = {
  excludedCategories: Set<string>;
  boostByCategory: Map<string, number>;
  hideOutOfStock: boolean;
};

type BroadWhereFilters = {
  category?: string;
  // B) Tolerant category matching - OR conditions for canonical categories
  categoryOr?: Array<{ category?: string; googleCategory?: string; productType?: string }>;
  priceMinCents?: number;
  priceMaxCents?: number;
  brands?: string[];
  excludeProductIds?: string[];
  stockStatus: string[];
  excludedCategories: string[];
  // C) Keyword prefilter for canonical categories
  keywordFilters?: string[];
  // Gender filter: hard filter at DB level
  genders?: string[]; // ["mens", "womens", "unisex"]
};

const normalize = (value?: string) => value?.toLowerCase().trim();

const arrayIncludes = (haystack: string[] | undefined, needles: string[] | undefined) => {
  if (!needles?.length) return true;
  if (!haystack?.length) return false;
  const hay = haystack.map((entry) => entry.toLowerCase());
  return needles.every((needle) => hay.includes(needle.toLowerCase()));
};

/**
 * Extract searchable text from product attributes (for text search)
 * Includes product_highlights, bullet_highlights, and product_details values
 */
const extractSearchableTextFromAttributes = (attributes: ProductAttributes): string => {
  const parts: string[] = [];
  
  // product_highlights (string)
  if (attributes.productHighlights) {
    parts.push(attributes.productHighlights);
  }
  
  // bullet_highlights (array)
  if (attributes.bulletHighlights && Array.isArray(attributes.bulletHighlights)) {
    parts.push(...attributes.bulletHighlights);
  }
  
  // product_details (object) - extract values
  const productDetails = attributes.product_details as Record<string, string> | undefined;
  if (productDetails && typeof productDetails === 'object') {
    parts.push(...Object.values(productDetails));
  }

  // Need/benefit/attribute signals
  if (attributes.benefits) parts.push(...attributes.benefits);
  if (attributes.claims) parts.push(...attributes.claims);
  if (attributes.useCases) parts.push(...attributes.useCases);
  if (attributes.styleTags) parts.push(...attributes.styleTags);
  if (attributes.compatibility) parts.push(...attributes.compatibility);
  if (attributes.sensoryProfile) parts.push(attributes.sensoryProfile);
  if ((attributes as any).attribute_chips) {
    const chips = (attributes as any).attribute_chips;
    if (Array.isArray(chips)) parts.push(...chips);
  }

  // Identity/family hints
  if (attributes.label) parts.push(attributes.label);
  if (attributes.collection) parts.push(attributes.collection);
  if (attributes.brand) parts.push(attributes.brand);

  // Specs / ingredients / materials
  if (attributes.ingredients) parts.push(...attributes.ingredients);
  if (attributes.materials) parts.push(...attributes.materials);
  if ((attributes as any).material) parts.push((attributes as any).material as string);
  if (attributes.dimensions) parts.push(attributes.dimensions);
  if (attributes.weight) parts.push(attributes.weight);
  if (attributes.sizeFitNotes) parts.push(attributes.sizeFitNotes);
  if (attributes.usageInstructions) parts.push(attributes.usageInstructions);
  if (attributes.safetyCompliance) parts.push(...attributes.safetyCompliance);
  
  return parts.join(' ');
};

const valueMatches = (value: string | undefined, needles: string[] | undefined) => {
  if (!needles?.length) return true;
  if (!value) return false;
  const val = value.toLowerCase().trim();
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase().trim();
    // For gender, support both normalized (mens/womens) and CSV values (male/female)
    if (normalizedNeedle === 'mens' && (val === 'mens' || val === 'male')) return true;
    if (normalizedNeedle === 'womens' && (val === 'womens' || val === 'female')) return true;
    if (normalizedNeedle === 'unisex' && val === 'unisex') return true;
    // Default substring matching for other fields
    return val.includes(normalizedNeedle);
  });
};

/**
 * Substring matching for materials/fabrics (e.g., "cotton" matches "75% Cotton 21% Polyester")
 */
const materialMatches = (value: string | undefined, needles: string[] | undefined) => {
  if (!needles?.length) return true;
  if (!value) return false;
  const val = value.toLowerCase();
  // Check if any needle appears as a substring in the value
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase();
    // Word boundary matching for better precision
    return val.includes(normalizedNeedle);
  });
};

/**
 * Strict color matching - only match if color is exact or contains the base color word
 * Colors must come from catalog color values only
 */
const colorMatches = (value: string | undefined, needles: string[] | undefined, colorOntology?: string[]) => {
  if (!needles?.length) return true;
  if (!value) return false;
  const val = value.toLowerCase().trim();
  
  // If ontology provided, validate that needles are in ontology
  if (colorOntology && colorOntology.length > 0) {
    const ontologyLower = colorOntology.map(c => c.toLowerCase());
    const validNeedles = needles.filter(needle => {
      const normalizedNeedle = needle.toLowerCase();
      // Check if needle matches any ontology color (exact or contains)
      return ontologyLower.some(ontColor => 
        ontColor === normalizedNeedle || 
        ontColor.includes(normalizedNeedle) || 
        normalizedNeedle.includes(ontColor)
      );
    });
    if (validNeedles.length === 0) return true; // If no valid colors, don't filter
    // Match against valid colors only
    return validNeedles.some((needle) => {
      const normalizedNeedle = needle.toLowerCase();
      return val === normalizedNeedle || val.includes(normalizedNeedle) || normalizedNeedle.includes(val);
    });
  }
  
  // Fallback to substring matching if no ontology
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase();
    return val === normalizedNeedle || val.includes(normalizedNeedle) || normalizedNeedle.includes(val);
  });
};

const buildMerchContext = async (): Promise<MerchContext> => {
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
};

type CategoryOrCondition = Array<{ category?: string; googleCategory?: string; productType?: string }>;

// NOTE: Canonical helper for interpreting SearchConstraints facet intent. Only explicit, user-facing facets count as hard filters.
export type AttributeConstraintMeta = {
  hasHardAttributeConstraints: boolean;
  hasCategoryBridge: boolean;
  hardFacetFields: string[];
  ignoredDerivedFacetFields: string[];
};

type FacetDescriptor = {
  key: keyof SearchConstraints;
  derived: boolean;
};

const USER_FACET_DESCRIPTORS: FacetDescriptor[] = [
  { key: 'colors', derived: false },
  { key: 'fabrics', derived: false },
  { key: 'materials', derived: false },
  { key: 'sizes', derived: false },
  { key: 'seasons', derived: false },
  { key: 'occasions', derived: false },
  { key: 'useCases', derived: false },
  { key: 'customLabels4', derived: false },
  { key: 'conditions', derived: false },
  { key: 'ageGroups', derived: false },
  { key: 'genders', derived: false },
  { key: 'brands', derived: false },
  // Classification-style bridges that may be auto-derived from category mapping
  { key: 'productTypes', derived: true },
  { key: 'googleCategories', derived: true },
  // Generic descriptive fields that LLMs may infer opportunistically
  { key: 'styleTags', derived: true },
  { key: 'benefits', derived: true },
  { key: 'claims', derived: true },
  { key: 'compatibility', derived: true },
];

export const deriveAttributeConstraintMeta = (
  constraints: SearchConstraints,
  categoryOr?: CategoryOrCondition,
): AttributeConstraintMeta => {
  const hardFacetFields: string[] = [];
  const ignoredDerivedFacetFields: string[] = [];

  for (const descriptor of USER_FACET_DESCRIPTORS) {
    const rawValue = constraints[descriptor.key];
    const isActive = Array.isArray(rawValue)
      ? rawValue.length > 0
      : rawValue !== undefined && rawValue !== null && rawValue !== '';
    if (!isActive) continue;
    if (descriptor.derived) {
      ignoredDerivedFacetFields.push(descriptor.key as string);
    } else if (!hardFacetFields.includes(descriptor.key as string)) {
      hardFacetFields.push(descriptor.key as string);
    }
  }

  if (constraints.fit) hardFacetFields.push('fit');
  if (constraints.sensoryProfile) hardFacetFields.push('sensoryProfile');

  return {
    hasHardAttributeConstraints: hardFacetFields.length > 0,
    hasCategoryBridge: Array.isArray(categoryOr) && categoryOr.length > 0,
    hardFacetFields,
    ignoredDerivedFacetFields,
  };
};

// NOTE: matchesAttributeFilters is data-agnostic. It only enforces user-requested facet filters.
//       Category bridging via JSON categories/product types is best-effort and never used to exclude on its own.
export const matchesAttributeFilters = (
  attributes: ProductAttributes | null | undefined,
  constraints: SearchConstraints,
  categoryOr?: CategoryOrCondition,
  colorOntology?: string[],
  meta?: AttributeConstraintMeta,
) => {
  const metaInfo = meta ?? deriveAttributeConstraintMeta(constraints, categoryOr);
  if (!metaInfo.hasHardAttributeConstraints) {
    return true;
  }

  const attrs = attributes ?? undefined;
  if (!attrs) {
    return false;
  }

  if (constraints.colors?.length) {
    if (!colorMatches(attrs.color, constraints.colors, colorOntology)) return false;
  }

  if (constraints.fabrics?.length) {
    if (!materialMatches(attrs.fabric, constraints.fabrics)) return false;
  }

  if (constraints.materials?.length) {
    const materialMatchesString = materialMatches(attrs.material, constraints.materials);
    const materialMatchesArray =
      attrs.materials?.some((value) => materialMatches(value, constraints.materials)) ?? false;
    if (!materialMatchesString && !materialMatchesArray) return false;
  }

  if (constraints.fit && normalize(attrs.fit) !== normalize(constraints.fit)) return false;
  if (constraints.seasons?.length && !valueMatches(attrs.season, constraints.seasons)) return false;
  if (constraints.occasions?.length && !valueMatches(attrs.occasion, constraints.occasions))
    return false;
  if (constraints.sizes?.length && !arrayIncludes(attrs.sizes, constraints.sizes)) return false;
  // Use soft matching for useCases: check if any constraint value is contained in any product useCase (substring match)
  if (constraints.useCases?.length) {
    const productUseCases = attrs.useCases || [];
    const useCaseMatches = constraints.useCases.some((constraintUseCase) =>
      productUseCases.some((productUseCase) =>
        productUseCase.toLowerCase().includes(constraintUseCase.toLowerCase()) ||
        constraintUseCase.toLowerCase().includes(productUseCase.toLowerCase())
      )
    );
    if (!useCaseMatches) return false;
  }

  if (
    constraints.sensoryProfile &&
    !materialMatches(attrs.sensoryProfile, [constraints.sensoryProfile])
  )
    return false;

  if (constraints.productTypes?.length && !valueMatches(attrs.productType, constraints.productTypes))
    return false;
  if (
    constraints.googleCategories?.length &&
    !valueMatches(attrs.googleProductCategory, constraints.googleCategories)
  )
    return false;
  if (
    constraints.customLabels4?.length &&
    !valueMatches(attrs.customLabel4, constraints.customLabels4)
  )
    return false;
  if (constraints.conditions?.length && !valueMatches(attrs.condition, constraints.conditions))
    return false;
  if (constraints.ageGroups?.length && !valueMatches(attrs.ageGroup, constraints.ageGroups))
    return false;
  if (constraints.genders?.length && !valueMatches(attrs.gender, constraints.genders)) return false;
  if (constraints.brands?.length && !valueMatches(attrs.brand, constraints.brands)) return false;

  // Use soft matching for compatibility: check if any constraint value is contained in any product compatibility (substring match)
  if (constraints.compatibility?.length) {
    const productCompatibility = attrs.compatibility || [];
    const compatibilityMatches = constraints.compatibility.some((constraintCompat) =>
      productCompatibility.some((productCompat) =>
        productCompat.toLowerCase().includes(constraintCompat.toLowerCase()) ||
        constraintCompat.toLowerCase().includes(productCompat.toLowerCase())
      )
    );
    if (!compatibilityMatches) return false;
  }

  // Use soft matching for benefits: check if any constraint value is contained in any product benefit (substring match)
  if (constraints.benefits?.length) {
    const productBenefits = attrs.benefits || [];
    const benefitsMatches = constraints.benefits.some((constraintBenefit) =>
      productBenefits.some((productBenefit) =>
        productBenefit.toLowerCase().includes(constraintBenefit.toLowerCase()) ||
        constraintBenefit.toLowerCase().includes(productBenefit.toLowerCase())
      )
    );
    if (!benefitsMatches) return false;
  }

  return true;
};

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
 * Builds broad WHERE filters (only indexed/structured fields)
 * B) Uses tolerant category matching via canonical categories
 * Does NOT include JSON attributes (colors, fabrics, etc.) - those are filtered in memory
 */
async function buildBroadWhereFilters(
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

  // B) Tolerant category matching: canonicalize user intent
  // Fix A & C: Support multi-category and canonical → DB mapping
  if (constraints.category || userMessage) {
    const { parseCategoryString, expandCanonicalToDbCategories } = await import('./category-mapping');
    
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

/**
 * Fix D: Adaptive candidate take for full DB coverage
 * Determines dynamic take based on query breadth
 * Broader queries need larger slices to ensure recall
 */
const calculateDynamicTake = (
  constraints: SearchConstraints,
  limit: number,
  hardTextFilters: string[] | undefined,
): number => {
  const base = limit * BASE_TAKE_MULTIPLIER;
  let take = Math.max(base, MIN_TAKE);

  // Fix D: If category is missing or query text is short/ambiguous, increase take
  const isBroadQuery =
    !constraints.category &&
    !constraints.brands?.length &&
    !constraints.priceMinCents &&
    !constraints.priceMaxCents &&
    (!constraints.query || constraints.query.trim().length < 10);

  // If we have hard text filters (category missing but keywords detected), increase take
  const hasHardTextFilters = hardTextFilters && hardTextFilters.length > 0;
  const needsWiderSearch = !constraints.category || hasHardTextFilters;

  if (isBroadQuery || needsWiderSearch) {
    // For broad queries or when category is missing, use larger take
    // But still cap to avoid perf blowups
    take = Math.min(MAX_TAKE, Math.max(take, 1500)); // At least 1500 for broad queries
  } else {
    // For specific categories, keep current tight take
    take = Math.min(take, MAX_TAKE);
  }

  return take;
};

/**
 * Performs database-level ranked search using full-text search and SQL ranking
 * This ensures all products are considered before capping results
 */
async function dbRankedSearch(
  whereFilters: BroadWhereFilters,
  queryText: string | undefined,
  boostByCategory: Map<string, number>,
  take: number,
  hardTextFilters?: string[], // Fix C: Hard text filter keywords for fallback
): Promise<Array<{
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
  updatedAt: Date;
  createdAt: Date;
  rank: number;
}>> {
  // Build WHERE clause conditions using Prisma.sql
  const whereParts: Prisma.Sql[] = [];

  // Stock status
  if (whereFilters.stockStatus.length > 0) {
    // Build array literal for PostgreSQL ANY operator
    const statusValues = whereFilters.stockStatus.map((s) => `'${s}'`).join(', ');
    whereParts.push(Prisma.sql`"stockStatus" = ANY(ARRAY[${Prisma.raw(statusValues)}]::text[])`);
  }

  // B) Tolerant category matching: Use OR conditions for canonical categories
  // IMPORTANT: Also check subcategory field, as products may have matching subcategories
  // even if their main category is different (e.g., "Perfume" subcategory under "Fragrance" category)
  if (whereFilters.categoryOr && whereFilters.categoryOr.length > 0) {
    // Build OR conditions for category matching
    const categoryConditions: Prisma.Sql[] = [];
    
    for (const orCondition of whereFilters.categoryOr) {
      if (orCondition.category) {
        // Match on both DB category AND subcategory fields (exact or contains)
        const pattern = `%${orCondition.category.toLowerCase()}%`;
        categoryConditions.push(
          Prisma.sql`LOWER("category") LIKE ${pattern} OR LOWER(COALESCE("subcategory", '')) LIKE ${pattern}`
        );
      }
      // Note: googleCategory and productType are in JSON attributes, handled in post-filter
    }
    
    if (categoryConditions.length > 0) {
      // Join with OR separator
      const joined = categoryConditions.reduce((acc, condition, idx) => {
        if (idx === 0) return condition;
        return Prisma.sql`${acc} OR ${condition}`;
      });
      whereParts.push(Prisma.sql`(${joined})`);
    }
  } else if (whereFilters.category) {
    // Use ILIKE for case-insensitive matching, also check subcategory
    const pattern = `%${whereFilters.category.toLowerCase()}%`;
    whereParts.push(
      Prisma.sql`(LOWER("category") LIKE ${pattern} OR LOWER(COALESCE("subcategory", '')) LIKE ${pattern})`
    );
  }

  // C) Keyword prefilter: Always include when canonical category detected or hardTextFilters provided
  // Generate keyword combinations with priority: exact phrase > 2-word combinations > individual words
  const keywordFilters = whereFilters.keywordFilters || hardTextFilters;
  let keywordRankingBoosts: Prisma.Sql[] = [];
  
  if (keywordFilters && keywordFilters.length > 0) {
    // Organize keywords by priority: exact phrases, 2-word combinations, individual words
    const exactPhrases: string[] = [];
    const twoWordCombos: string[] = [];
    const individualWords: string[] = [];
    const allKeywordsForWhere: string[] = [];
    
    for (const keyword of keywordFilters) {
      const lowerKeyword = keyword.toLowerCase();
      const words = lowerKeyword.split(/\s+/).filter(w => w.length >= 2);
      
      if (words.length > 1) {
        // Multi-word phrase: prioritize exact phrase, then combinations, then individual words
        exactPhrases.push(lowerKeyword);
        allKeywordsForWhere.push(lowerKeyword);
        
        // Generate 2-word combinations (e.g., "bath gift", "gift set" from "bath gift set")
        for (let i = 0; i < words.length - 1; i++) {
          const combo = `${words[i]} ${words[i + 1]}`;
          if (!twoWordCombos.includes(combo)) {
            twoWordCombos.push(combo);
            allKeywordsForWhere.push(combo);
          }
        }
        
        // Add individual words
        for (const word of words) {
          if (!individualWords.includes(word)) {
            individualWords.push(word);
            allKeywordsForWhere.push(word);
          }
        }
      } else {
        // Single word: treat as exact phrase
        exactPhrases.push(lowerKeyword);
        allKeywordsForWhere.push(lowerKeyword);
      }
    }
    
    // Build WHERE conditions (all keywords, no priority)
    const textFilterConditions = allKeywordsForWhere.map((keyword: string) => {
      const pattern = `%${keyword}%`;
      return Prisma.sql`(
        LOWER("title") LIKE ${pattern} OR
        LOWER("description") LIKE ${pattern} OR
        LOWER("category") LIKE ${pattern} OR
        LOWER(COALESCE("subcategory", '')) LIKE ${pattern} OR
        LOWER(COALESCE(attributes->>'productHighlights', '')) LIKE ${pattern} OR
        LOWER(COALESCE(attributes::text, '')) LIKE ${pattern}
      )`;
    });
    if (textFilterConditions.length > 0) {
      const joined = textFilterConditions.reduce((acc, condition, idx) => {
        if (idx === 0) return condition;
        return Prisma.sql`${acc} OR ${condition}`;
      });
      whereParts.push(Prisma.sql`(${joined})`);
    }
    
    // Build ranking boosts: exact phrases (highest), then 2-word combos, then individual words
    // Exact phrase match: +10.0 boost
    if (exactPhrases.length > 0) {
      const exactConditions = exactPhrases.map((phrase) => {
        const pattern = `%${phrase}%`;
        return Prisma.sql`(
          LOWER("title") LIKE ${pattern} OR
          LOWER("description") LIKE ${pattern} OR
          LOWER(COALESCE("subcategory", '')) LIKE ${pattern} OR
          LOWER(COALESCE(attributes->>'productHighlights', '')) LIKE ${pattern}
        )`;
      });
      const exactJoined = exactConditions.reduce((acc, condition, idx) => {
        if (idx === 0) return condition;
        return Prisma.sql`${acc} OR ${condition}`;
      });
      keywordRankingBoosts.push(Prisma.sql`(CASE WHEN ${exactJoined} THEN 10.0 ELSE 0 END)`);
    }
    
    // 2-word combination match: +5.0 boost
    if (twoWordCombos.length > 0) {
      const comboConditions = twoWordCombos.map((combo) => {
        const pattern = `%${combo}%`;
        return Prisma.sql`(
          LOWER("title") LIKE ${pattern} OR
          LOWER("description") LIKE ${pattern} OR
          LOWER(COALESCE("subcategory", '')) LIKE ${pattern} OR
          LOWER(COALESCE(attributes->>'productHighlights', '')) LIKE ${pattern}
        )`;
      });
      const comboJoined = comboConditions.reduce((acc, condition, idx) => {
        if (idx === 0) return condition;
        return Prisma.sql`${acc} OR ${condition}`;
      });
      keywordRankingBoosts.push(Prisma.sql`(CASE WHEN ${comboJoined} THEN 5.0 ELSE 0 END)`);
    }
    
    // Individual word match: +1.0 boost (lowest priority)
    if (individualWords.length > 0) {
      const wordConditions = individualWords.map((word) => {
        const pattern = `%${word}%`;
        return Prisma.sql`(
          LOWER("title") LIKE ${pattern} OR
          LOWER("description") LIKE ${pattern} OR
          LOWER(COALESCE("subcategory", '')) LIKE ${pattern} OR
          LOWER(COALESCE(attributes->>'productHighlights', '')) LIKE ${pattern}
        )`;
      });
      const wordJoined = wordConditions.reduce((acc, condition, idx) => {
        if (idx === 0) return condition;
        return Prisma.sql`${acc} OR ${condition}`;
      });
      keywordRankingBoosts.push(Prisma.sql`(CASE WHEN ${wordJoined} THEN 1.0 ELSE 0 END)`);
    }
  }

  // Price range
  if (whereFilters.priceMinCents !== undefined) {
    whereParts.push(Prisma.sql`"priceCents" >= ${whereFilters.priceMinCents}`);
  }
  if (whereFilters.priceMaxCents !== undefined) {
    whereParts.push(Prisma.sql`"priceCents" <= ${whereFilters.priceMaxCents}`);
  }

  // Brands
  if (whereFilters.brands?.length) {
    const brandValues = whereFilters.brands.map((b) => `'${b.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.sql`"brand" = ANY(ARRAY[${Prisma.raw(brandValues)}]::text[])`);
  }

  // Excluded product IDs
  if (whereFilters.excludeProductIds?.length) {
    const idValues = whereFilters.excludeProductIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.sql`"id" != ALL(ARRAY[${Prisma.raw(idValues)}]::text[])`);
  }

  // Excluded categories
  if (whereFilters.excludedCategories.length > 0) {
    const categoryValues = whereFilters.excludedCategories.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.sql`"category" != ALL(ARRAY[${Prisma.raw(categoryValues)}]::text[])`);
  }

  // Gender filter: hard filter at DB level using JSON path
  // For mens: allow mens OR unisex
  // For womens: allow womens OR unisex
  // For unisex: allow unisex only (strict)
  if (whereFilters.genders?.length) {
    const genderConditions: Prisma.Sql[] = [];
      for (const gender of whereFilters.genders) {
        if (gender === 'mens') {
          // mens OR male (CSV) OR unisex
          genderConditions.push(
            Prisma.sql`(attributes->>'gender' = 'mens' OR attributes->>'gender' = 'male' OR attributes->>'gender' = 'unisex')`,
          );
        } else if (gender === 'womens') {
          // womens OR female (CSV) OR unisex
          genderConditions.push(
            Prisma.sql`(attributes->>'gender' = 'womens' OR attributes->>'gender' = 'female' OR attributes->>'gender' = 'unisex')`,
          );
        } else if (gender === 'unisex') {
          // unisex only (strict)
          genderConditions.push(Prisma.sql`attributes->>'gender' = 'unisex'`);
        }
      }
    if (genderConditions.length > 0) {
      // If multiple genders, join with OR
      const joined = genderConditions.reduce((acc, condition, idx) => {
        if (idx === 0) return condition;
        return Prisma.sql`${acc} OR ${condition}`;
      });
      whereParts.push(Prisma.sql`(${joined})`);
    }
  }

  const whereClause =
    whereParts.length > 0
      ? (() => {
          const joined = whereParts.reduce((acc, part, idx) => {
            if (idx === 0) return part;
            return Prisma.sql`${acc} AND ${part}`;
          });
          return Prisma.sql`WHERE ${joined}`;
        })()
      : Prisma.empty;

  // Build ranking expression parts
  const rankParts: Prisma.Sql[] = [];

  // Feature flag: Use raw SQL with search_vector only if enabled
  // Default to false until migration is run
  const USE_RAW_RANKED_SEARCH = process.env.ENABLE_RAW_RANKED_SEARCH === 'true';
  
  // Full-text search ranking (if query exists and search_vector column exists)
  // Only use if feature flag is enabled, otherwise rely on Prisma fallback
  if (USE_RAW_RANKED_SEARCH && queryText?.trim()) {
    rankParts.push(
      Prisma.sql`COALESCE(ts_rank_cd("search_vector", plainto_tsquery('english', ${queryText.trim()})), 0) * 5.0`,
    );
  }

  // Category boost (from MerchRules)
  if (boostByCategory.size > 0) {
    const categoryBoosts = Array.from(boostByCategory.entries()).map(
      ([cat, weight]) => Prisma.sql`(CASE WHEN "category" = ${cat} THEN ${weight}.0 ELSE 0 END)`,
    );
    const joinedBoosts = categoryBoosts.reduce((acc, boost, idx) => {
      if (idx === 0) return boost;
      return Prisma.sql`${acc} + ${boost}`;
    });
    rankParts.push(Prisma.sql`(${joinedBoosts})`);
  }

  // Keyword match ranking boost (exact phrase > combinations > individual words)
  if (keywordRankingBoosts.length > 0) {
    const keywordBoost = keywordRankingBoosts.reduce((acc, boost, idx) => {
      if (idx === 0) return boost;
      return Prisma.sql`${acc} + ${boost}`;
    });
    rankParts.push(keywordBoost);
  }

  // Recency boost (newer products slightly favored)
  rankParts.push(
    Prisma.sql`EXTRACT(EPOCH FROM ("updatedAt" - NOW())) / -86400.0 * 0.1`,
  );

  const rankExpression =
    rankParts.length > 0
      ? rankParts.reduce((acc, part, idx) => {
          if (idx === 0) return part;
          return Prisma.sql`${acc} + ${part}`;
        })
      : Prisma.sql`0.0`;

  // Only use raw SQL if feature flag is enabled
  // Otherwise, skip directly to Prisma fallback
  if (USE_RAW_RANKED_SEARCH) {
    // Build final SQL query
    const sql = Prisma.sql`
      SELECT 
        *,
        (${rankExpression}) AS rank
      FROM "Product"
      ${whereClause}
      ORDER BY rank DESC, "updatedAt" DESC
      LIMIT ${take}
    `;

    try {
      const results = await prisma.$queryRaw<
        Array<{
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
          updatedAt: Date;
          createdAt: Date;
          rank: number;
        }>
      >(sql);

      return results;
    } catch (error) {
      // Fallback to Prisma if raw query fails (e.g., search_vector column doesn't exist yet)
      logger.warn('dbRankedSearch raw SQL failed, falling back to Prisma', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to Prisma fallback below
    }
  } else {
    // Feature flag disabled: skip raw SQL, use Prisma directly
    logger.debug('dbRankedSearch using Prisma (raw SQL disabled)', {
      reason: 'ENABLE_RAW_RANKED_SEARCH not set to true',
    });
  }

  // Prisma fallback (always used when raw SQL is disabled or fails)
  {

    // Build Prisma where clause
    const prismaWhere: Prisma.ProductWhereInput = {};
    if (whereFilters.stockStatus.length > 0) {
      prismaWhere.stockStatus = { in: whereFilters.stockStatus as any };
    }
    
    // B) Handle categoryOr for tolerant matching
    // IMPORTANT: Also check subcategory field, as products may have matching subcategories
    // even if their main category is different (e.g., "Perfume" subcategory under "Fragrance" category)
    if (whereFilters.categoryOr && whereFilters.categoryOr.length > 0) {
      const categoryConditions = whereFilters.categoryOr
        .filter((c) => c.category)
        .flatMap((c) => [
          { category: { contains: c.category!, mode: Prisma.QueryMode.insensitive } },
          { subcategory: { contains: c.category!, mode: Prisma.QueryMode.insensitive } },
        ]);
      if (categoryConditions.length > 0) {
        prismaWhere.OR = [...(prismaWhere.OR || []), ...categoryConditions];
      }
    } else if (whereFilters.category) {
      // Check both category and subcategory fields
      prismaWhere.OR = [
        ...(prismaWhere.OR || []),
        { category: { contains: whereFilters.category, mode: Prisma.QueryMode.insensitive } },
        { subcategory: { contains: whereFilters.category, mode: Prisma.QueryMode.insensitive } },
      ];
    }
    
    // Fix: Only add priceCents filter if values are defined and not null
    const hasMinPrice = whereFilters.priceMinCents !== undefined && whereFilters.priceMinCents !== null;
    const hasMaxPrice = whereFilters.priceMaxCents !== undefined && whereFilters.priceMaxCents !== null;
    if (hasMinPrice || hasMaxPrice) {
      prismaWhere.priceCents = {};
      if (hasMinPrice) {
        prismaWhere.priceCents.gte = whereFilters.priceMinCents!;
      }
      if (hasMaxPrice) {
        prismaWhere.priceCents.lte = whereFilters.priceMaxCents!;
      }
    }
    
    if (whereFilters.brands?.length) {
      prismaWhere.brand = { in: whereFilters.brands };
    }
    if (whereFilters.excludeProductIds?.length) {
      prismaWhere.id = { notIn: whereFilters.excludeProductIds };
    }
    if (whereFilters.excludedCategories.length > 0) {
      prismaWhere.NOT = { category: { in: whereFilters.excludedCategories } };
    }

    // Gender filter: hard filter at DB level using JSON path
    // Note: Prisma JSON path filtering may not be available in all versions
    // We'll use Prisma.sql for JSON filtering to ensure compatibility
    // Supports both normalized (mens/womens) and raw CSV values (male/female)
    if (whereFilters.genders?.length) {
      // Build gender filter using raw SQL for JSON path access
      const genderSqlConditions: Prisma.Sql[] = [];
      for (const gender of whereFilters.genders) {
        if (gender === 'mens') {
          // mens OR male (CSV) OR unisex
          genderSqlConditions.push(
            Prisma.sql`(attributes->>'gender' = 'mens' OR attributes->>'gender' = 'male' OR attributes->>'gender' = 'unisex')`,
          );
        } else if (gender === 'womens') {
          // womens OR female (CSV) OR unisex
          genderSqlConditions.push(
            Prisma.sql`(attributes->>'gender' = 'womens' OR attributes->>'gender' = 'female' OR attributes->>'gender' = 'unisex')`,
          );
        } else if (gender === 'unisex') {
          // unisex only (strict)
          genderSqlConditions.push(Prisma.sql`attributes->>'gender' = 'unisex'`);
        }
      }
      if (genderSqlConditions.length > 0) {
        // For Prisma fallback, we need to add this as a raw SQL condition
        // Since Prisma doesn't support JSON path filtering directly in all versions,
        // we'll filter in-memory after fetch but add it to the WHERE clause using Prisma.sql
        // Actually, we can't mix Prisma.sql with Prisma.where, so we'll need to filter after fetch
        // But that defeats the purpose. Let's use a workaround: add to existing AND conditions
        // For now, we'll handle this in the post-processing step
        // Store gender filter for post-processing
        (prismaWhere as any).__genderFilter = whereFilters.genders;
      }
    }

    // C) Keyword prefilter: Use keywordFilters or queryText for text search
    // Generate keyword combinations with priority: exact phrase > 2-word combinations > individual words
    // Note: Prisma doesn't support JSON path filtering directly in where clauses,
    // so we'll search in title/description/category here, and include attributes in ranking
    const keywordFilters = whereFilters.keywordFilters || hardTextFilters;
    let keywordRankingData: {
      exactPhrases: string[];
      twoWordCombos: string[];
      individualWords: string[];
    } | null = null;
    
    if (keywordFilters && keywordFilters.length > 0) {
      // Organize keywords by priority: exact phrases, 2-word combinations, individual words
      const exactPhrases: string[] = [];
      const twoWordCombos: string[] = [];
      const individualWords: string[] = [];
      const allKeywordsForWhere: string[] = [];
      
      for (const keyword of keywordFilters) {
        const lowerKeyword = keyword.toLowerCase();
        const words = lowerKeyword.split(/\s+/).filter(w => w.length >= 2);
        
        if (words.length > 1) {
          // Multi-word phrase: prioritize exact phrase, then combinations, then individual words
          exactPhrases.push(lowerKeyword);
          allKeywordsForWhere.push(lowerKeyword);
          
          // Generate 2-word combinations (e.g., "bath gift", "gift set" from "bath gift set")
          for (let i = 0; i < words.length - 1; i++) {
            const combo = `${words[i]} ${words[i + 1]}`;
            if (!twoWordCombos.includes(combo)) {
              twoWordCombos.push(combo);
              allKeywordsForWhere.push(combo);
            }
          }
          
          // Add individual words
          for (const word of words) {
            if (!individualWords.includes(word)) {
              individualWords.push(word);
              allKeywordsForWhere.push(word);
            }
          }
        } else {
          // Single word: treat as exact phrase
          exactPhrases.push(lowerKeyword);
          allKeywordsForWhere.push(lowerKeyword);
        }
      }
      
      // Store for ranking later
      keywordRankingData = { exactPhrases, twoWordCombos, individualWords };
      
      // Build WHERE conditions (all keywords, no priority)
      const keywordConditions = allKeywordsForWhere.map((keyword) => ({
        OR: [
          { title: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
          { description: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
          { category: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
          { subcategory: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
        ],
      }));
      const existingAnd = Array.isArray(prismaWhere.AND) ? prismaWhere.AND : prismaWhere.AND ? [prismaWhere.AND] : [];
      prismaWhere.AND = [
        ...existingAnd,
        { OR: keywordConditions },
      ];
    } else if (queryText?.trim()) {
      // Fallback: simple text search in Prisma
      const words = queryText
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3)
        .slice(0, 5);
      if (words.length) {
        const existingOr = Array.isArray(prismaWhere.OR) ? prismaWhere.OR : prismaWhere.OR ? [prismaWhere.OR] : [];
        prismaWhere.OR = [
          ...existingOr,
          ...words.map((word) => ({
            title: { contains: word, mode: Prisma.QueryMode.insensitive },
          })),
          ...words.map((word) => ({
            description: { contains: word, mode: Prisma.QueryMode.insensitive },
          })),
        ];
      }
    }

    // Extract gender filter before passing to Prisma (can't use JSON path in Prisma.where directly)
    const genderFilter = (prismaWhere as any).__genderFilter;
    delete (prismaWhere as any).__genderFilter;

    // Fetch WITHOUT ordering first - we'll rank and sort after
    // Fetch 3-5x take to have a good pool for relevance ranking
    const fetchTake = Math.min(MAX_TAKE, take * (genderFilter ? 5 : 3));
    const results = await prisma.product.findMany({
      where: prismaWhere,
      // NO orderBy here - we'll rank and sort after
      take: fetchTake,
    });

    // Apply hard filters: stock status (in-stock only) and gender
    // Stock status is a HARD FILTER - only in-stock products are scored and shown
    let filteredResults = results.filter((product) => {
      // Hard filter: Only in-stock products
      return product.stockStatus === 'in_stock';
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
    const rankedResults = filteredResults.map((product) => {
      let rank = 0.0;
      const attrs = product.attributes as any;
      
      // -----------------------------
      // Helpers
      // -----------------------------
      const safeLower = (val?: string | null) => (val || '').toString().toLowerCase().trim();
      const arrayLower = (arr?: unknown[]) =>
        Array.isArray(arr) ? arr.map((v) => safeLower(String(v))).filter(Boolean) : [];
      const textIncludesAny = (haystack: string, needles: string[]) =>
        needles.some((n) => n && haystack.includes(n));
      
      const titleLower = safeLower(product.title);
      const descLower = safeLower(product.description);
      const subcatLower = safeLower((product as any).subcategory);
      const brandLower = safeLower((product as any).brand) || safeLower(attrs?.brand);
      const labelLower = safeLower(attrs?.label);
      const collectionLower = safeLower(attrs?.collection);
      const shortTitleLower = safeLower(attrs?.short_title || attrs?.shortTitle);
      const categoryLower = safeLower(product.category);
      const verticalLower = safeLower(attrs?.vertical);
      const taxonPathLower = safeLower(attrs?.taxon_path);
      const externalSkuLower = safeLower(attrs?.external_sku);
      const barcodeLower = safeLower(attrs?.barcode);
      const sourceIdLower = safeLower((product as any).sourceId);
      
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
      
      const keywordData = keywordRankingData;
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
        const matchingWords = queryTokens.filter(word => subcatLower.includes(word));
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
    });

    // Sort by rank DESC, then updatedAt DESC, and take top N
    rankedResults.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    logger.debug('dbRankedSearch fallback relevance ranking applied', {
      totalFetched: results.length,
      afterGenderFilter: filteredResults.length,
      afterRanking: rankedResults.length,
      topRank: rankedResults[0]?.rank,
      genderFilter: genderFilter?.join(','),
      keywordFilters: whereFilters.keywordFilters?.slice(0, 3),
    });

    return rankedResults.slice(0, take);
  }
}

/**
 * Widening tiers for guaranteed full-catalog coverage
 */
type WideningTier = {
  whereFilters: BroadWhereFilters;
  take: number;
  description: string;
};

const buildWideningTiers = (
  originalFilters: BroadWhereFilters,
  originalQuery: string | undefined,
): WideningTier[] => {
  const tiers: WideningTier[] = [];

  // Tier 1: Drop category, keep price/brand/stock/gender
  // F) Keep keywordFilters and genders during relaxation
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
};

export async function searchProducts(
  constraints: SearchConstraints = {},
  userMessage?: string,
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
  
  // C) Debug logging for canonical category and keyword filters
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
    broadFilters.keywordFilters, // C) Pass keyword filters for SQL prefilter
  );

  logger.debug('searchProducts dbRankedSearch', {
    dbCandidates: dbCandidates.length,
    take: dynamicTake,
    hasQuery: !!constraints.query,
    category: constraints.category,
    categoryType: Array.isArray(constraints.category) ? 'array' : typeof constraints.category,
    expandedDbCategories: broadFilters.categoryOr?.map(c => c.category).filter(Boolean),
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
      ); // E) Pass color ontology for strict matching
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
        tierKeywordFilters, // F) Keep keyword filters during relaxation
      );

      let tierFiltered = tierCandidates;
      if (constraintMeta.hasHardAttributeConstraints) {
        tierFiltered = tierCandidates.filter((product) =>
          matchesAttributeFilters(
            (product.attributes ?? {}) as ProductAttributes,
            constraints,
            tier.whereFilters.categoryOr, // B) Pass categoryOr for JSON attribute matching
            ontology.colors, // E) Pass color ontology for strict matching
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

const dropAttributeFilters = (constraints: SearchConstraints): SearchConstraints => {
  const relaxed = { ...constraints };
  relaxed.colors = undefined;
  relaxed.fabrics = undefined;
  relaxed.materials = undefined;
  relaxed.sizes = undefined;
  relaxed.occasions = undefined;
  relaxed.seasons = undefined;
  // Preserve user-explicitly-requested filters: useCases, benefits, compatibility
  // These are often core requirements (e.g., "for dry hair", "for sensitive skin")
  // relaxed.useCases = undefined; // Keep useCases
  // relaxed.benefits = undefined; // Keep benefits
  // relaxed.compatibility = undefined; // Keep compatibility
  // New unified catalog attributes
  relaxed.styleTags = undefined;
  relaxed.sensoryProfile = undefined; // Can be relaxed as it's often stylistic
  relaxed.productTypes = undefined;
  relaxed.googleCategories = undefined;
  relaxed.customLabels4 = undefined;
  relaxed.conditions = undefined;
  relaxed.ageGroups = undefined;
  // DO NOT drop genders - they should persist through relaxation
  // relaxed.genders = undefined;
  relaxed.brands = undefined;
  relaxed.fit = undefined;
  return relaxed;
};

const keepOnlyCategoryAndPrice = (constraints: SearchConstraints): SearchConstraints => {
  const relaxed: SearchConstraints = {
    inStockOnly: constraints.inStockOnly,
    category: constraints.category,
    priceMinCents: constraints.priceMinCents,
    priceMaxCents: constraints.priceMaxCents,
    query: constraints.query,
  };
  return relaxed;
};

const keepOnlyQuery = (constraints: SearchConstraints): SearchConstraints => ({
  inStockOnly: constraints.inStockOnly,
  query: constraints.query,
});

type RelaxedSearchResult = {
  candidates: SearchResultItem[];
  relaxedConstraints: SearchConstraints;
  wasRelaxed: boolean;
};

const applySoftLimit = (items: SearchResultItem[], limit: number) => items.slice(0, limit);

export async function searchProductsRelaxed(
  constraints: SearchConstraints,
  limit = 8,
  userMessage?: string,
): Promise<RelaxedSearchResult> {
  const strictResult = await searchProducts({ ...constraints, limit }, userMessage);
  if (strictResult.products.length > 0) {
    return {
      candidates: applySoftLimit(strictResult.products, limit),
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
    const result = await searchProducts({ ...relaxedConstraints, limit: RELAXED_TARGET });
    if (result.products.length > 0) {
      return {
        candidates: applySoftLimit(result.products, Math.max(limit, 5)),
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
