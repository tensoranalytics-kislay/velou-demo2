/**
 * Ranking Weights Configuration
 * 
 * Centralized configuration for all ranking weights used in search relevance scoring.
 * This makes it easy to tune ranking behavior without touching core logic.
 * 
 * Field Importance Hierarchy:
 * - Identity (title, brand, codes): Highest priority
 * - Type & Category: High priority
 * - Needs & Benefits: High priority
 * - Specs & Ingredients: Medium-high priority
 * - Price & Availability: Medium priority (filters & tie-breakers)
 * 
 * Usage:
 * ```typescript
 * import { FIELD_WEIGHTS } from './ranking/weights';
 * const score = baseScore * FIELD_WEIGHTS.title;
 * ```
 */

/**
 * Field weights for relevance scoring
 * 
 * Higher values = more important in ranking
 * Values are relative - adjust proportionally when tuning
 */
export const FIELD_WEIGHTS = {
  // Identity / codes (strongest signal)
  title: 1.5,
  shortTitle: 1.2,
  label: 1.2,
  brand: 1.0,
  collection: 0.8,
  externalSku: 1.5,
  barcode: 1.5,
  sourceId: 1.5,

  // Type & category (high importance)
  category: 1.2,
  subcategory: 1.0,
  vertical: 0.9,
  taxonPath: 0.8,

  // Needs & benefits (high importance)
  description: 1.0,
  benefits: 1.0,
  claims: 1.0,
  useCases: 1.0,
  styleTags: 0.9,
  compatibility: 0.9,
  sensoryProfile: 0.8,
  productHighlights: 1.0,
  bulletHighlights: 0.9,

  // Specs & ingredients (medium-high importance)
  ingredients: 0.8,
  materials: 0.8,
  dimensions: 0.7,
  weight: 0.7,
  sizeFitNotes: 0.7,
  usageInstructions: 0.7,
  safetyCompliance: 0.6,

  // Price & availability (medium importance - filters & tie-breakers)
  price: 0.5,
  recency: 0.1, // Days since update
} as const;

/**
 * Keyword match boost values
 * 
 * Used for prioritizing exact phrases, combinations, and individual words
 */
export const KEYWORD_BOOSTS = {
  exactPhrase: 10.0,
  twoWordCombo: 5.0,
  individualWord: 1.0,
} as const;

/**
 * Full-text search boost multiplier
 * 
 * Applied to PostgreSQL ts_rank_cd results when ENABLE_RAW_RANKED_SEARCH is enabled
 */
export const FULL_TEXT_SEARCH_MULTIPLIER = 5.0;

/**
 * Recency boost calculation
 * 
 * Formula: days_since_update * RECENCY_MULTIPLIER
 * Negative because newer products should rank higher
 */
export const RECENCY_MULTIPLIER = -0.1;


