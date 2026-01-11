/**
 * Query Types
 * 
 * Shared types for query building modules
 */

/**
 * Broad WHERE filters for database queries
 * 
 * These filters are applied at the database level (indexed/structured fields only).
 * JSON attributes (colors, fabrics, etc.) are filtered in memory after fetch.
 */
export type BroadWhereFilters = {
  category?: string;
  // Tolerant category matching - OR conditions for canonical categories
  categoryOr?: Array<{ category?: string; googleCategory?: string; productType?: string }>;
  priceMinCents?: number;
  priceMaxCents?: number;
  brands?: string[];
  excludeProductIds?: string[];
  stockStatus: string[];
  excludedCategories: string[];
  // Keyword prefilter for canonical categories
  keywordFilters?: string[];
  // Gender filter: hard filter at DB level
  genders?: string[]; // ["mens", "womens", "unisex"]
  // Enriched indexed filters
  length?: string[]; // Dress/skirt length
  formalityLevel?: string[];
  temperatureIntent?: string;
  humidityFriendly?: boolean;
  occasionContext?: { hasSome: string[] };
  problemSolutions?: { hasSome: string[] };
  functionFeatures?: { hasSome: string[] };
  colorShade?: string[];
  colorUndertone?: string[];
  multicolor?: boolean;
};

/**
 * Merchandising context
 * 
 * Contains merchandising rules (excluded categories, category boosts, stock filters)
 */
export type MerchContext = {
  excludedCategories: Set<string>;
  boostByCategory: Map<string, number>;
  hideOutOfStock: boolean;
};


