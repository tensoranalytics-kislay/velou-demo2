import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import {
  canonicalizeCategory,
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
const STOCK_OK: Array<'in_stock' | 'low_stock'> = ['in_stock', 'low_stock'];

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

const matchesAttributeFilters = (
  attributes: ProductAttributes,
  constraints: SearchConstraints,
  categoryOr?: Array<{ category?: string; googleCategory?: string; productType?: string }>,
  colorOntology?: string[],
) => {
  // B) Check canonical category matching in JSON attributes if categoryOr provided
  if (categoryOr && categoryOr.length > 0) {
    let matchesCategory = false;
    for (const orCondition of categoryOr) {
      // Check googleProductCategory match
      if (orCondition.googleCategory && attributes.googleProductCategory) {
        const gpc = String(attributes.googleProductCategory).toLowerCase();
        if (gpc.includes(orCondition.googleCategory.toLowerCase())) {
          matchesCategory = true;
          break;
        }
      }
      // Check productType match
      if (orCondition.productType && attributes.productType) {
        const pt = String(attributes.productType).toLowerCase();
        if (pt.includes(orCondition.productType.toLowerCase())) {
          matchesCategory = true;
          break;
        }
      }
    }
    if (!matchesCategory) return false;
  }

  // E) Strict color matching - colors must be from catalog ontology
  if (!colorMatches(attributes.color, constraints.colors, colorOntology)) return false;
  
  // E) Substring matching for materials/fabrics (e.g., "cotton" matches "75% Cotton 21% Polyester")
  if (!materialMatches(attributes.fabric, constraints.fabrics)) return false;
  if (!materialMatches(attributes.material, constraints.materials)) return false;
  
  if (constraints.fit && normalize(attributes.fit) !== normalize(constraints.fit)) return false;
  if (!valueMatches(attributes.season, constraints.seasons)) return false;
  if (!valueMatches(attributes.occasion, constraints.occasions)) return false;
  if (!arrayIncludes(attributes.sizes, constraints.sizes)) return false;
  if (!arrayIncludes(attributes.useCases, constraints.useCases)) return false;
  if (!valueMatches(attributes.productType, constraints.productTypes)) return false;
  if (!valueMatches(attributes.googleProductCategory, constraints.googleCategories))
    return false;
  if (!valueMatches(attributes.customLabel4, constraints.customLabels4)) return false;
  if (!valueMatches(attributes.condition, constraints.conditions)) return false;
  if (!valueMatches(attributes.ageGroup, constraints.ageGroups)) return false;
  if (!valueMatches(attributes.gender, constraints.genders)) return false;
  if (!valueMatches(attributes.brand, constraints.brands)) return false;
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
    stockStatus: requireFreshStock ? STOCK_OK : [],
    excludedCategories: Array.from(merchContext.excludedCategories),
    // Gender filter: hard filter at DB level
    genders: constraints.genders?.length ? constraints.genders : undefined,
  };

  // B) Tolerant category matching: canonicalize user intent
  // Fix A & C: Support multi-category and canonical → DB mapping
  if (constraints.category || userMessage) {
    const { parseCategoryString, expandCanonicalToDbCategories } = await import('./category-mapping');
    
    // Parse category (handle comma-separated strings for outfits)
    let categoryList = parseCategoryString(constraints.category);
    
    // CRITICAL FIX: If user message doesn't explicitly mention "graphic" or "printed",
    // but LLM output "graphic t shirt", replace it with generic "t shirt" to avoid over-restriction
    if (userMessage && categoryList.length > 0) {
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
      
      const ontology = await getCatalogOntology();
      
      // For each category, expand canonical → DB and try canonicalization
      for (const cat of categoryList) {
        // First, expand using category mapping
        const expanded = expandCanonicalToDbCategories(cat);
        for (const dbCat of expanded) {
          allDbCategories.add(dbCat);
          orConditions.push({ category: dbCat });
        }
        
        // Also try canonicalization for additional synonyms
        const canonicalResult = canonicalizeCategory(cat, ontology);
        
        if (canonicalResult.canonical !== 'UNKNOWN' && canonicalResult.confidence > 0.3) {
          const expandedLeafCats = getExpandedLeafCategories(canonicalResult.canonical, ontology);
          const gpcTerms = getParentGpcTerms(canonicalResult.canonical);
          const synonymTerms = getSynonymTerms(canonicalResult.canonical);
          
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
      const ontology = await getCatalogOntology();
      const canonicalResult = canonicalizeCategory(userMessage, ontology);
      
      if (canonicalResult.canonical !== 'UNKNOWN' && canonicalResult.confidence > 0.3) {
        const expandedLeafCats = getExpandedLeafCategories(canonicalResult.canonical, ontology);
        const orConditions = expandedLeafCats.map(cat => ({ category: cat }));
        if (orConditions.length > 0) {
          filters.categoryOr = orConditions;
        }
      }
    }
    
    // Use expandedKeywords if provided and no keyword filters set yet
    if (!filters.keywordFilters && constraints.expandedKeywords?.length) {
      filters.keywordFilters = constraints.expandedKeywords.slice(0, 15);
    }
  } else {
    // No category constraint - use expandedKeywords if provided
    if (constraints.expandedKeywords?.length) {
      filters.keywordFilters = constraints.expandedKeywords.slice(0, 15);
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

  // Fix D: If category is missing OR query includes apparel keywords, increase take
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
  if (whereFilters.categoryOr && whereFilters.categoryOr.length > 0) {
    // Build OR conditions for category matching
    const categoryConditions: Prisma.Sql[] = [];
    
    for (const orCondition of whereFilters.categoryOr) {
      if (orCondition.category) {
        // Match on DB category field (exact or contains)
        const pattern = `%${orCondition.category.toLowerCase()}%`;
        categoryConditions.push(Prisma.sql`LOWER("category") LIKE ${pattern}`);
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
    // Use ILIKE for case-insensitive matching instead of exact match
    const pattern = `%${whereFilters.category.toLowerCase()}%`;
    whereParts.push(Prisma.sql`LOWER("category") LIKE ${pattern}`);
  }

  // C) Keyword prefilter: Always include when canonical category detected or hardTextFilters provided
  const keywordFilters = whereFilters.keywordFilters || hardTextFilters;
  if (keywordFilters && keywordFilters.length > 0) {
    // Build OR condition for each keyword using ILIKE for case-insensitive matching
    const textFilterConditions = keywordFilters.map((keyword: string) => {
      const lowerKeyword = keyword.toLowerCase();
      const pattern = `%${lowerKeyword}%`;
      // Use Prisma.sql template with proper parameter binding
      return Prisma.sql`(
        LOWER("title") LIKE ${pattern} OR
        LOWER("description") LIKE ${pattern} OR
        LOWER("category") LIKE ${pattern}
      )`;
    });
    if (textFilterConditions.length > 0) {
      // Join with OR separator
      const joined = textFilterConditions.reduce((acc, condition, idx) => {
        if (idx === 0) return condition;
        return Prisma.sql`${acc} OR ${condition}`;
      });
      whereParts.push(Prisma.sql`(${joined})`);
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
    if (whereFilters.categoryOr && whereFilters.categoryOr.length > 0) {
      const categoryConditions = whereFilters.categoryOr
        .filter((c) => c.category)
        .map((c) => ({ category: { contains: c.category!, mode: Prisma.QueryMode.insensitive } }));
      if (categoryConditions.length > 0) {
        prismaWhere.OR = [...(prismaWhere.OR || []), ...categoryConditions];
      }
    } else if (whereFilters.category) {
      prismaWhere.category = whereFilters.category;
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
    const keywordFilters = whereFilters.keywordFilters || hardTextFilters;
    if (keywordFilters && keywordFilters.length > 0) {
      const keywordConditions = keywordFilters.map((keyword) => ({
        OR: [
          { title: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
          { description: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
          { category: { contains: keyword, mode: Prisma.QueryMode.insensitive } },
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

    // Apply gender filter in-memory if needed (Prisma JSON path filtering not available in all versions)
    // Supports both normalized (mens/womens) and raw CSV values (male/female)
    let filteredResults = results;
    if (genderFilter?.length) {
      filteredResults = results.filter((product) => {
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

    // Calculate fallback relevance ranking (not recency-only)
    const rankedResults = filteredResults.map((product) => {
      let rank = 0.0;
      const attrs = product.attributes as any;
      
      // Gender match boost (+2.0 for exact match, +1.0 for unisex match)
      // Supports both normalized (mens/womens) and raw CSV values (male/female)
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
      
      // Keyword/token match boost (max 4 matches, 0.75 each)
      const keywordFilters = whereFilters.keywordFilters || hardTextFilters;
      if (keywordFilters?.length) {
        const titleLower = product.title.toLowerCase();
        const descLower = (product.description || '').toLowerCase();
        const catLower = product.category.toLowerCase();
        let keywordMatches = 0;
        for (const keyword of keywordFilters.slice(0, 10)) {
          const kwLower = keyword.toLowerCase();
          if (titleLower.includes(kwLower) || descLower.includes(kwLower) || catLower.includes(kwLower)) {
            keywordMatches++;
            if (keywordMatches >= 4) break;
          }
        }
        rank += keywordMatches * 0.75;
      }
      
      // Query text token matches
      if (queryText?.trim()) {
        const words = queryText
          .split(/\s+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length >= 3)
          .slice(0, 5);
        const titleLower = product.title.toLowerCase();
        const descLower = (product.description || '').toLowerCase();
        let tokenMatches = 0;
        for (const word of words) {
          if (titleLower.includes(word) || descLower.includes(word)) {
            tokenMatches++;
            if (tokenMatches >= 4) break;
          }
        }
        rank += tokenMatches * 0.75;
      }
      
      // Category match boost (+1.5)
      if (whereFilters.categoryOr && whereFilters.categoryOr.length > 0) {
        for (const orCondition of whereFilters.categoryOr) {
          if (orCondition.category && product.category.toLowerCase().includes(orCondition.category.toLowerCase())) {
            rank += 1.5;
            break;
          }
        }
      } else if (whereFilters.category && product.category.toLowerCase().includes(whereFilters.category.toLowerCase())) {
        rank += 1.5;
      }
      
      // Recency as tie-breaker only (0.2 * normalized days since update)
      const daysSinceUpdate = (Date.now() - product.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      rank += 0.2 * Math.max(0, 30 - daysSinceUpdate) / 30; // Normalize to 0-0.2 range
      
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
  const filtered = dbCandidates.filter((product) => {
    const attrs = (product.attributes ?? {}) as ProductAttributes;
    return matchesAttributeFilters(attrs, constraints, broadFilters.categoryOr, ontology.colors); // E) Pass color ontology for strict matching
  });

  logger.debug('searchProducts afterAttributeFilter', {
    dbCandidates: dbCandidates.length,
    afterAttributeFilter: filtered.length,
  });

  let finalProducts = filtered;
  let wasRelaxed = false;

  // Step 3: Widening fallback if we don't have enough results
  if (filtered.length < limit) {
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

      const tierFiltered = tierCandidates.filter((product) =>
        matchesAttributeFilters(
          (product.attributes ?? {}) as ProductAttributes,
          constraints,
          tier.whereFilters.categoryOr, // B) Pass categoryOr for JSON attribute matching
          ontology.colors, // E) Pass color ontology for strict matching
        ),
      );

      if (tierFiltered.length > filtered.length) {
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
    if (!widened && dbCandidates.length > 0 && filtered.length === 0) {
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
  relaxed.useCases = undefined;
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
