/**
 * Database-Level Ranked Search
 * 
 * Performs database-level ranked search using full-text search and SQL ranking.
 * This ensures all products are considered before capping results.
 * 
 * Supports two modes:
 * 1. Raw SQL with full-text search (when ENABLE_RAW_RANKED_SEARCH=true)
 * 2. Prisma fallback with in-memory relevance scoring (default)
 * 
 * The function builds complex WHERE clauses for:
 * - Multi-tenant isolation (merchantId)
 * - Stock status filtering
 * - Category matching (tolerant, with subcategory support)
 * - Keyword filtering (exact phrases > 2-word combos > individual words)
 * - Price range filtering
 * - Brand filtering
 * - Gender filtering (JSON path)
 * - Excluded categories/products
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';
import { FULL_TEXT_SEARCH_MULTIPLIER, KEYWORD_BOOSTS } from './weights';
import { applyRelevanceScoring } from './relevance';
import type { BroadWhereFilters } from '../query/types';

const MAX_TAKE = 2500; // safe for 13k catalog

/**
 * Result type for database ranked search
 * Includes enriched columns for efficient filtering
 */
export type RankedSearchResult = {
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
  // Core indexed columns (Phase 2)
  color?: string | null;
  fabric?: string | null;
  material?: string | null;
  occasion?: string | null; // Single occasion column (e.g., "Daytime, Vacation")
  season?: string | null;
  fit?: string | null;
  
  // Enriched columns (for primary filtering, JSON attributes as fallback)
  length?: string | null;
  sleeve?: string | null;
  neckline?: string | null;
  formalityLevel?: string | null;
  temperatureIntent?: string | null;
  humidityFriendly?: boolean | null;
  occasionContext?: string[] | null; // Array of occasions (e.g., ["Daytime", "Vacation"])
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
 * Performs database-level ranked search using full-text search and SQL ranking
 * 
 * This ensures all products are considered before capping results.
 * 
 * @param whereFilters - WHERE clause filters
 * @param queryText - Optional query text for full-text search
 * @param boostByCategory - Category boost map from merchandising rules
 * @param take - Number of products to return
 * @param hardTextFilters - Optional hard text filter keywords for fallback
 * @param merchantId - Optional merchant ID for multi-tenant isolation
 * @returns Ranked products with relevance scores
 */
export async function dbRankedSearch(
  whereFilters: BroadWhereFilters,
  queryText: string | undefined,
  boostByCategory: Map<string, number>,
  take: number,
  hardTextFilters?: string[],
  merchantId?: string,
): Promise<RankedSearchResult[]> {
  // Build WHERE clause conditions using Prisma.sql
  const whereParts: Prisma.Sql[] = [];

  // Multi-tenant isolation: filter by merchantId
  if (merchantId) {
    whereParts.push(Prisma.sql`"merchantId" = ${merchantId}`);
  }

  // Stock status
  if (whereFilters.stockStatus.length > 0) {
    // Build array literal with proper escaping
    // Cast to StockStatus enum type (not text) to match the column type
    const statusArray = whereFilters.stockStatus.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"stockStatus" = ANY(ARRAY[${statusArray}]::"StockStatus"[])`));
  }

  // Tolerant category matching: Use OR conditions for canonical categories
  // Check both category AND subcategory fields individually for maximum product coverage
  // This ensures products are found whether they're stored in category field or subcategory field
  if (whereFilters.categoryOr && whereFilters.categoryOr.length > 0) {
    // Build OR conditions for category matching
    const categoryConditions: Prisma.Sql[] = [];

    for (const orCondition of whereFilters.categoryOr) {
      if (orCondition.category) {
        // Match on BOTH category AND subcategory fields (exact or contains)
        const pattern = `%${orCondition.category.toLowerCase()}%`;
        categoryConditions.push(
          Prisma.sql`(LOWER("category") LIKE ${pattern} OR LOWER(COALESCE("subcategory", '')) LIKE ${pattern})`,
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
    // Use ILIKE for case-insensitive matching on BOTH category AND subcategory fields
    const pattern = `%${whereFilters.category.toLowerCase()}%`;
    whereParts.push(
      Prisma.sql`(LOWER("category") LIKE ${pattern} OR LOWER(COALESCE("subcategory", '')) LIKE ${pattern})`,
    );
  }

  // Keyword prefilter: Always include when canonical category detected or hardTextFilters provided
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
      const words = lowerKeyword.split(/\s+/).filter((w) => w.length >= 2);

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
      keywordRankingBoosts.push(
        Prisma.sql`(CASE WHEN ${exactJoined} THEN ${KEYWORD_BOOSTS.exactPhrase} ELSE 0 END)`,
      );
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
      keywordRankingBoosts.push(
        Prisma.sql`(CASE WHEN ${comboJoined} THEN ${KEYWORD_BOOSTS.twoWordCombo} ELSE 0 END)`,
      );
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
      keywordRankingBoosts.push(
        Prisma.sql`(CASE WHEN ${wordJoined} THEN ${KEYWORD_BOOSTS.individualWord} ELSE 0 END)`,
      );
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
    // Build array literal with proper escaping
    const brandArray = whereFilters.brands.map(b => `'${b.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"brand" = ANY(ARRAY[${brandArray}]::text[])`));
  }

  // Excluded product IDs
  if (whereFilters.excludeProductIds?.length) {
    // Build array literal with proper escaping
    const idArray = whereFilters.excludeProductIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"id" != ALL(ARRAY[${idArray}]::text[])`));
  }

  // Excluded categories
  if (whereFilters.excludedCategories.length > 0) {
    // Build array literal with proper escaping
    const categoryArray = whereFilters.excludedCategories.map(c => `'${c.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"category" != ALL(ARRAY[${categoryArray}]::text[])`));
  }

  // Gender filter: PRIMARY hard filter at DB level using indexed column (not JSON)
  // For male: allow male OR unisex
  // For female: allow female OR unisex
  // For unisex: allow unisex only (strict)
  if (whereFilters.genders?.length) {
    const genderConditions: Prisma.Sql[] = [];
    for (const gender of whereFilters.genders) {
      // Normalize gender values: mens/womens → male/female
      const normalizedGender = gender === 'mens' ? 'male' : gender === 'womens' ? 'female' : gender;
      
      if (normalizedGender === 'male') {
        // male OR unisex (using indexed gender column)
        genderConditions.push(
          Prisma.sql`("gender" = 'male' OR "gender" = 'unisex')`,
        );
      } else if (normalizedGender === 'female') {
        // female OR unisex (using indexed gender column)
        genderConditions.push(
          Prisma.sql`("gender" = 'female' OR "gender" = 'unisex')`,
        );
      } else if (normalizedGender === 'unisex') {
        // unisex only (strict)
        genderConditions.push(Prisma.sql`"gender" = 'unisex'`);
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

  // Enriched attribute filters (SQL path)
  // Length (e.g. Mini, Midi, Maxi)
  if (whereFilters.length && whereFilters.length.length > 0) {
    const values = whereFilters.length.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"length" = ANY(ARRAY[${values}]::text[])`));
  }

  // Formality level (Casual, Semi-Formal, Formal)
  if (whereFilters.formalityLevel && whereFilters.formalityLevel.length > 0) {
    const values = whereFilters.formalityLevel.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"formalityLevel" = ANY(ARRAY[${values}]::text[])`));
  }

  // Temperature intent (Warm Weather, Cool Weather, etc.)
  if (whereFilters.temperatureIntent) {
    whereParts.push(Prisma.sql`"temperatureIntent" = ${whereFilters.temperatureIntent}`);
  }

  // Humidity friendly (boolean)
  if (typeof whereFilters.humidityFriendly === 'boolean') {
    whereParts.push(Prisma.sql`"humidityFriendly" = ${whereFilters.humidityFriendly}`);
  }

  // Occasion context (array) - GIN && operator for array overlap
  if (whereFilters.occasionContext && whereFilters.occasionContext.hasSome?.length) {
    const values = whereFilters.occasionContext.hasSome
      .map((v) => `'${v.replace(/'/g, "''")}'`)
      .join(', ');
    whereParts.push(Prisma.raw(`"occasionContext" && ARRAY[${values}]::text[]`));
  }

  // Problem solutions (array) - GIN && operator
  if (whereFilters.problemSolutions && whereFilters.problemSolutions.hasSome?.length) {
    const values = whereFilters.problemSolutions.hasSome
      .map((v) => `'${v.replace(/'/g, "''")}'`)
      .join(', ');
    whereParts.push(Prisma.raw(`"problemSolutions" && ARRAY[${values}]::text[]`));
  }

  // Function features (array) - GIN && operator
  if (whereFilters.functionFeatures && whereFilters.functionFeatures.hasSome?.length) {
    const values = whereFilters.functionFeatures.hasSome
      .map((v) => `'${v.replace(/'/g, "''")}'`)
      .join(', ');
    whereParts.push(Prisma.raw(`"functionFeatures" && ARRAY[${values}]::text[]`));
  }

  // Color shade (Light, Medium, Dark)
  if (whereFilters.colorShade && whereFilters.colorShade.length > 0) {
    const values = whereFilters.colorShade.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"colorShade" = ANY(ARRAY[${values}]::text[])`));
  }

  // Color undertone (Warm, Cool, Neutral)
  if (whereFilters.colorUndertone && whereFilters.colorUndertone.length > 0) {
    const values = whereFilters.colorUndertone.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"colorUndertone" = ANY(ARRAY[${values}]::text[])`));
  }

  // Multicolor (boolean)
  if (typeof whereFilters.multicolor === 'boolean') {
    whereParts.push(Prisma.sql`"multicolor" = ${whereFilters.multicolor}`);
  }

  // Inclusivity sizing: hard filter at DB level (Plus Size, Petite, Tall, etc.)
  if (whereFilters.inclusivitySizing && whereFilters.inclusivitySizing.length > 0) {
    const values = whereFilters.inclusivitySizing.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    whereParts.push(Prisma.raw(`"inclusivitySizing" = ANY(ARRAY[${values}]::text[])`));
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

  // Feature flag: Use raw SQL with search_vector for faster search
  // Default to true for L'Occitane optimized pipeline
  const USE_RAW_RANKED_SEARCH = process.env.ENABLE_RAW_RANKED_SEARCH !== 'false';

  // Full-text search ranking (if query exists and search_vector column exists)
  // Only use if feature flag is enabled, otherwise rely on Prisma fallback
  if (USE_RAW_RANKED_SEARCH && queryText?.trim()) {
    rankParts.push(
      Prisma.sql`COALESCE(ts_rank_cd("search_vector", plainto_tsquery('english', ${queryText.trim()})), 0) * ${FULL_TEXT_SEARCH_MULTIPLIER}`,
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

  // Enriched attribute ranking boosts (SQL path)
  // Formality level match: +2.0 boost
  if (whereFilters.formalityLevel?.length) {
    const formalityConditions = whereFilters.formalityLevel.map(
      (f) => Prisma.sql`"formalityLevel" = ${f}`,
    );
    const formalityJoined = formalityConditions.reduce((acc, condition, idx) => {
      if (idx === 0) return condition;
      return Prisma.sql`${acc} OR ${condition}`;
    });
    rankParts.push(Prisma.sql`(CASE WHEN ${formalityJoined} THEN 2.0 ELSE 0 END)`);
  }

  // Temperature intent match: +2.5 boost (high priority for weather queries)
  if (whereFilters.temperatureIntent) {
    rankParts.push(
      Prisma.sql`(CASE WHEN "temperatureIntent" = ${whereFilters.temperatureIntent} THEN 2.5 ELSE 0 END)`,
    );
  }

  // Humidity friendly match: +1.5 boost
  if (typeof whereFilters.humidityFriendly === 'boolean') {
    rankParts.push(
      Prisma.sql`(CASE WHEN "humidityFriendly" = ${whereFilters.humidityFriendly} THEN 1.5 ELSE 0 END)`,
    );
  }

  // Occasion context match (array overlap): +2.0 boost
  if (whereFilters.occasionContext?.hasSome?.length) {
    const values = whereFilters.occasionContext.hasSome
      .map((v) => `'${v.replace(/'/g, "''")}'`)
      .join(', ');
    rankParts.push(
      Prisma.raw(
        `(CASE WHEN "occasionContext" && ARRAY[${values}]::text[] THEN 2.0 ELSE 0 END)`,
      ),
    );
  }

  // Problem solutions match: +2.0 boost per matching solution
  // Count matches using array overlap and unnest
  if (whereFilters.problemSolutions?.hasSome?.length) {
    const values = whereFilters.problemSolutions.hasSome
      .map((v) => `'${v.replace(/'/g, "''")}'`)
      .join(', ');
    // Count matching solutions: use array_length with filtered unnest
    rankParts.push(
      Prisma.raw(
        `(CASE WHEN "problemSolutions" && ARRAY[${values}]::text[] THEN (SELECT COUNT(*) FROM unnest("problemSolutions") AS ps WHERE ps = ANY(ARRAY[${values}]::text[])) * 2.0 ELSE 0 END)`,
      ),
    );
  }

  // Function features match: +1.5 boost per matching feature
  // Count matches using array overlap and unnest
  if (whereFilters.functionFeatures?.hasSome?.length) {
    const values = whereFilters.functionFeatures.hasSome
      .map((v) => `'${v.replace(/'/g, "''")}'`)
      .join(', ');
    // Count matching features: use array_length with filtered unnest
    rankParts.push(
      Prisma.raw(
        `(CASE WHEN "functionFeatures" && ARRAY[${values}]::text[] THEN (SELECT COUNT(*) FROM unnest("functionFeatures") AS ff WHERE ff = ANY(ARRAY[${values}]::text[])) * 1.5 ELSE 0 END)`,
      ),
    );
  }

  // Color shade match: +1.0 boost
  if (whereFilters.colorShade?.length) {
    const shadeConditions = whereFilters.colorShade.map((s) => Prisma.sql`"colorShade" = ${s}`);
    const shadeJoined = shadeConditions.reduce((acc, condition, idx) => {
      if (idx === 0) return condition;
      return Prisma.sql`${acc} OR ${condition}`;
    });
    rankParts.push(Prisma.sql`(CASE WHEN ${shadeJoined} THEN 1.0 ELSE 0 END)`);
  }

  // Color undertone match: +1.0 boost
  if (whereFilters.colorUndertone?.length) {
    const undertoneConditions = whereFilters.colorUndertone.map(
      (u) => Prisma.sql`"colorUndertone" = ${u}`,
    );
    const undertoneJoined = undertoneConditions.reduce((acc, condition, idx) => {
      if (idx === 0) return condition;
      return Prisma.sql`${acc} OR ${condition}`;
    });
    rankParts.push(Prisma.sql`(CASE WHEN ${undertoneJoined} THEN 1.0 ELSE 0 END)`);
  }

  // Length match
  if (whereFilters.length?.length) {
    const lengthConditions = whereFilters.length.map((l) => Prisma.sql`"length" = ${l}`);
    const lengthJoined = lengthConditions.reduce((acc, condition, idx) => {
      if (idx === 0) return condition;
      return Prisma.sql`${acc} OR ${condition}`;
    });
    rankParts.push(Prisma.sql`(CASE WHEN ${lengthJoined} THEN 6.0 ELSE 0 END)`);
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
  rankParts.push(Prisma.sql`EXTRACT(EPOCH FROM ("updatedAt" - NOW())) / -86400.0 * 0.1`);

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
    // IMPORTANT: Exclude search_vector from SELECT to avoid Prisma deserialization errors
    // We still use it in the WHERE clause for full-text search ranking
    const sql = Prisma.sql`
      SELECT 
        "id",
        "merchantId",
        "title",
        "description",
        "imageUrl",
        "priceCents",
        "currency",
        "category",
        "subcategory",
        "brand",
        "attributes",
        "stockStatus"::text,
        "productUrl",
        "salePriceCents",
        "vendorId",
        "sourceId",
        "isActive",
        "lastIngestBatchId",
        "shopifyProductId",
        "shopifyHandle",
        "shopifyVariantIds",
        "shopifyBestseller",
        "shopifyTrending",
        "shopifySalesRank",
        "reviewScore",
        "reviewCount",
        "reviewsJson",
        "createdAt",
        "updatedAt",
        "color",
        "fabric",
        "material",
        "occasion",
        "season",
        "fit",
        "length",
        "sleeve",
        "neckline",
        "formalityLevel",
        "temperatureIntent",
        "humidityFriendly",
        "occasionContext",
        "problemSolutions",
        "functionFeatures",
        "colorShade",
        "colorUndertone",
        "multicolor",
        "seasonalPalette",
        "enrichedColor",
        "ageGroup",
        (${rankExpression}) AS rank
      FROM "Product"
      ${whereClause}
      ORDER BY rank DESC, "updatedAt" DESC
      LIMIT ${take}
    `;

    try {
      const results = await prisma.$queryRaw<RankedSearchResult[]>(sql);
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
  // Build Prisma where clause
  const prismaWhere: Prisma.ProductWhereInput = {};

  // Multi-tenant isolation: filter by merchantId
  if (merchantId) {
    prismaWhere.merchantId = merchantId;
  }

  if (whereFilters.stockStatus.length > 0) {
    prismaWhere.stockStatus = { in: whereFilters.stockStatus as any };
  }

  // Handle categoryOr for tolerant matching
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

  // Enriched attribute filters (Prisma path)
  if (whereFilters.length && whereFilters.length.length > 0) {
    (prismaWhere as any).length = { in: whereFilters.length };
  }
  if (whereFilters.formalityLevel && whereFilters.formalityLevel.length > 0) {
    (prismaWhere as any).formalityLevel = { in: whereFilters.formalityLevel };
  }
  if (whereFilters.temperatureIntent) {
    (prismaWhere as any).temperatureIntent = whereFilters.temperatureIntent;
  }
  if (typeof whereFilters.humidityFriendly === 'boolean') {
    (prismaWhere as any).humidityFriendly = whereFilters.humidityFriendly;
  }
  if (whereFilters.occasionContext && whereFilters.occasionContext.hasSome?.length) {
    (prismaWhere as any).occasionContext = { hasSome: whereFilters.occasionContext.hasSome };
  }
  if (whereFilters.problemSolutions && whereFilters.problemSolutions.hasSome?.length) {
    (prismaWhere as any).problemSolutions = { hasSome: whereFilters.problemSolutions.hasSome };
  }
  if (whereFilters.functionFeatures && whereFilters.functionFeatures.hasSome?.length) {
    (prismaWhere as any).functionFeatures = { hasSome: whereFilters.functionFeatures.hasSome };
  }
  if (whereFilters.colorShade && whereFilters.colorShade.length > 0) {
    (prismaWhere as any).colorShade = { in: whereFilters.colorShade };
  }
  if (whereFilters.colorUndertone && whereFilters.colorUndertone.length > 0) {
    (prismaWhere as any).colorUndertone = { in: whereFilters.colorUndertone };
  }
  if (typeof whereFilters.multicolor === 'boolean') {
    (prismaWhere as any).multicolor = whereFilters.multicolor;
  }

  // Keyword prefilter: Use keywordFilters or queryText for text search
  // Generate keyword combinations with priority: exact phrase > 2-word combinations > individual words
  // Note: Prisma doesn't support JSON path filtering directly in where clauses,
  // so we'll search in title/description/category here, and include attributes in ranking
  const keywordFiltersForPrisma = whereFilters.keywordFilters || hardTextFilters;
  let keywordRankingData: {
    exactPhrases: string[];
    twoWordCombos: string[];
    individualWords: string[];
  } | null = null;

  if (keywordFiltersForPrisma && keywordFiltersForPrisma.length > 0) {
    // Organize keywords by priority: exact phrases, 2-word combinations, individual words
    const exactPhrases: string[] = [];
    const twoWordCombos: string[] = [];
    const individualWords: string[] = [];
    const allKeywordsForWhere: string[] = [];

    for (const keyword of keywordFiltersForPrisma) {
      const lowerKeyword = keyword.toLowerCase();
      const words = lowerKeyword.split(/\s+/).filter((w) => w.length >= 2);

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
    const existingAnd = Array.isArray(prismaWhere.AND)
      ? prismaWhere.AND
      : prismaWhere.AND
        ? [prismaWhere.AND]
        : [];
    prismaWhere.AND = [...existingAnd, { OR: keywordConditions }];
  } else if (queryText?.trim()) {
    // Fallback: simple text search in Prisma
    const words = queryText
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
      .slice(0, 5);
    if (words.length) {
      const existingOr = Array.isArray(prismaWhere.OR)
        ? prismaWhere.OR
        : prismaWhere.OR
          ? [prismaWhere.OR]
          : [];
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

  // Apply relevance scoring (includes stock and gender filtering)
  const rankedResults = applyRelevanceScoring(
    results as any,
    queryText,
    keywordRankingData,
    whereFilters,
    genderFilter,
    take,
  );

  return rankedResults as RankedSearchResult[];
}
