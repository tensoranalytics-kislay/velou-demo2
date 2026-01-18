/**
 * Constraint Matching Utilities
 * 
 * Provides soft/fuzzy matching functions for comparing product attributes
 * with query constraints. Returns match confidence scores (0-1) rather than
 * hard boolean matches.
 */

import type { ProductAttributes } from '../../search/types';
import type { FashionConstraints } from '../classifier';
import type { SearchResultItem } from '../../search/types';
import type { EnrichedColumnValues } from '../../search/filtering/attributes';
import { logger } from '../../telemetry/logger';
import { isHighPriorityAttribute, isLowPriorityAttribute } from '../../search/filtering/category-attributes';
import type { ConstraintIntent, QueryConstraintsWithIntent, QueryConstraintsOld } from '../constraint-utils';
import { extractConstraintIntent, extractConstraintValues, extractSimilarValues, hasIntentFormat, flattenConstraintsWithIntent } from '../constraint-utils';
import { matchAnyColor } from '../../search/filtering/color-matcher';
import { LOVESHACKFANCY_ONTOLOGY } from '../ontology';
import { normalizeAgeGroups } from '../age-group-normalizer';

/**
 * Query context for dynamic weight adjustment
 */
export type QueryContext = {
  queryType?: string; // 'occasion_based', 'style_exploration', 'fit_and_size', etc.
  explicitMentions?: string[]; // Attributes explicitly mentioned in query (e.g., ['occasion', 'material', 'fit'])
  originalQuery?: string; // Original user query for context
};

/**
 * Extract attribute value (handles both string and array formats)
 * 
 * LoveShackFancy attributes are typically stored as capitalized keys (e.g., "Color", "Occasion", "Style").
 * This function tries multiple variations to find the attribute value.
 */
function extractAttrValue(attrs: ProductAttributes | null | undefined, key: string): string | string[] | undefined {
  if (!attrs) return undefined;
  
  // Try capitalized key first (most common in LoveShackFancy: "Color", "Occasion", "Style")
  const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
  const capitalizedValue = (attrs as any)[capitalizedKey];
  if (capitalizedValue !== undefined && capitalizedValue !== null) {
    return Array.isArray(capitalizedValue) ? capitalizedValue : [capitalizedValue];
  }
  
  // Try direct key (as-is)
  const directValue = (attrs as any)[key];
  if (directValue !== undefined && directValue !== null) {
    return Array.isArray(directValue) ? directValue : [directValue];
  }
  
  // Try lowercase key
  const lowercaseKey = key.toLowerCase();
  const lowercaseValue = (attrs as any)[lowercaseKey];
  if (lowercaseValue !== undefined && lowercaseValue !== null) {
    return Array.isArray(lowercaseValue) ? lowercaseValue : [lowercaseValue];
  }
  
  // Try underscore-separated key (e.g., "age_group" for "ageGroup")
  const underscoreKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  const underscoreValue = (attrs as any)[underscoreKey];
  if (underscoreValue !== undefined && underscoreValue !== null) {
    return Array.isArray(underscoreValue) ? underscoreValue : [underscoreValue];
  }
  
  // Try extensible attributes (nested structure)
  const extensible = (attrs as any).extensible;
  if (extensible && typeof extensible === 'object') {
    // Try capitalized in extensible
    if (extensible[capitalizedKey] !== undefined && extensible[capitalizedKey] !== null) {
      const extValue = extensible[capitalizedKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    // Try direct key in extensible
    if (extensible[key] !== undefined && extensible[key] !== null) {
      const extValue = extensible[key];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    // Try lowercase in extensible
    if (extensible[lowercaseKey] !== undefined && extensible[lowercaseKey] !== null) {
      const extValue = extensible[lowercaseKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    // Try underscore-separated in extensible
    if (extensible[underscoreKey] !== undefined && extensible[underscoreKey] !== null) {
      const extValue = extensible[underscoreKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
  }
  
  return undefined;
}

/**
 * Normalize string for comparison (lowercase, trim)
 */
function normalize(str: string): string {
  return str.toLowerCase().trim();
}

/**
 * Check if a value matches any of the query values (fuzzy matching)
 * Returns confidence score 0-1
 */
function fuzzyMatch(
  productValue: string | string[] | undefined,
  queryValues: string[]
): number {
  if (!productValue || queryValues.length === 0) return 0;
  
  const productValues = Array.isArray(productValue) ? productValue : [productValue];
  const normalizedQuery = queryValues.map(normalize);
  
  // Check for exact matches first (highest confidence)
  for (const pv of productValues) {
    const normalizedPv = normalize(pv);
    for (const qv of normalizedQuery) {
      if (normalizedPv === qv) {
        return 1.0; // Exact match
      }
      // Check if product value contains query value or vice versa
      if (normalizedPv.includes(qv) || qv.includes(normalizedPv)) {
        return 0.8; // Partial match
      }
    }
  }
  
  return 0;
}

/**
 * Match a single string value (for fields like rain_wind, pockets, etc.)
 */
function matchString(
  productValue: string | string[] | undefined,
  queryValue: string
): number {
  if (!productValue || !queryValue) return 0;
  return fuzzyMatch(productValue, [queryValue]);
}

/**
 * Match an array of string values (for fields like care_requirements, travel_features, etc.)
 */
function matchStringArray(
  productValue: string | string[] | undefined,
  queryValues: string[]
): number {
  if (!productValue || !queryValues || queryValues.length === 0) return 0;
  return fuzzyMatch(productValue, queryValues);
}

/**
 * Match color constraints
 * Checks database columns (color, enrichedColor) first, then JSONB attributes
 * Handles color variations (e.g., "pink" matches "blush pink", "rose pink")
 * Uses frequency-based scoring: products with more occurrences of the searched color in enriched_color get higher scores
 * NOTE: variant_colors is NOT used for color matching - only enriched_color and legacy color field
 */
export function matchColor(
  productAttrs: ProductAttributes | null | undefined, 
  queryColors: string[] | undefined,
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!queryColors || queryColors.length === 0) return 0;
  
  // Priority 1: Check enrichedColor from database column (e.g., "White, Bright White, Pure White")
  let enrichedColor: string | null = enrichedColumns?.enrichedColor ?? null;
  
  // Priority 2: Check color column from database (e.g., "Blue")
  let legacyColor: string | null = enrichedColumns?.color ?? null;
  
  // Priority 3: Fallback to JSONB attributes (for backward compatibility)
  if (!enrichedColor && !legacyColor) {
  const extractedColor = extractAttrValue(productAttrs, 'color');
  const colorValue = Array.isArray(extractedColor) 
    ? extractedColor[0] 
    : extractedColor;
    enrichedColor = (productAttrs as any)?.enriched_color ?? null;
    legacyColor = typeof colorValue === 'string' ? colorValue : null;
  }
  
  // Check if any query color matches (in enriched_color or legacy color)
  let hasMatch = false;
  let totalMatches = 0; // Count total occurrences of query colors in enriched_color
  let bestScore = 0;
  
  for (const queryColor of queryColors) {
    const queryLower = queryColor.toLowerCase().trim();
    let colorMatchCount = 0; // Count occurrences of this specific query color
    
    // PRIORITY 1: Check enriched_color (PRIMARY SOURCE)
    // Count how many times the query color appears in enriched_color
    // Example: "royal blue, whisper blue, blue" for query "blue" should count as 3 matches
    if (enrichedColor) {
      const enrichedTerms = enrichedColor
        .split(',')
        .map((t: string) => t.trim().toLowerCase())
        .filter(Boolean);
      
      for (const term of enrichedTerms) {
        // Check for exact match or if query color is contained in term (e.g., "blue" in "royal blue")
        // Also check if term is contained in query color (e.g., "light blue" contains "blue")
        if (term === queryLower) {
          colorMatchCount++;
          bestScore = Math.max(bestScore, 1.0); // Exact match in enriched_color
          hasMatch = true;
        } else if (term.includes(queryLower)) {
          // Term contains query color (e.g., "royal blue" contains "blue")
          colorMatchCount++;
          bestScore = Math.max(bestScore, 0.9); // Partial match where term contains query
          hasMatch = true;
        } else if (queryLower.includes(term) && term.length >= 3) {
          // Query contains term (e.g., "light blue" contains "blue") - only if term is substantial (>=3 chars)
          colorMatchCount++;
          bestScore = Math.max(bestScore, 0.8); // Partial match where query contains term
          hasMatch = true;
        }
      }
    }
    
    // PRIORITY 2: Check legacy color field (FALLBACK - lower score)
    if (legacyColor && !hasMatch) {
      const colorLower = String(legacyColor).toLowerCase().trim();
      if (colorLower === queryLower) {
        bestScore = Math.max(bestScore, 0.6); // Exact match in legacy color
        hasMatch = true;
      } else if (colorLower.includes(queryLower) || queryLower.includes(colorLower)) {
        bestScore = Math.max(bestScore, 0.5); // Partial match in legacy color
        hasMatch = true;
      }
    }
    
    // Add to total matches count
    totalMatches += colorMatchCount;
  }
  
  if (!hasMatch) return 0;
  
  // Frequency-based scoring: products with more color occurrences get higher scores
  // Base score is bestScore (quality of match)
  // Frequency bonus: +0.1 per additional occurrence beyond the first (capped at 0.3 bonus)
  // Example: 
  // - "royal blue, whisper blue, blue" for "blue" → 3 matches → base 1.0 + 0.2 bonus = 1.2
  // - "green, turquoise, blue" for "blue" → 1 match → base 0.9 (no bonus) = 0.9
  const frequencyBonus = Math.min(0.3, (totalMatches - 1) * 0.1);
  const finalScore = Math.min(1.0, bestScore + frequencyBonus);
  
  return finalScore;
}

/**
 * Match size constraints
 * Handles size variations (e.g., "S" matches "Small", "size S")
 */
export function matchSize(productAttrs: ProductAttributes | null | undefined, querySizes: string[] | undefined): number {
  if (!querySizes || querySizes.length === 0) return 0;
  
  const productSizes = extractAttrValue(productAttrs, 'sizes') || extractAttrValue(productAttrs, 'size');
  
  if (!productSizes) return 0;
  
  const productSizesArray = Array.isArray(productSizes) ? productSizes : [productSizes];
  const normalizedQuery = querySizes.map(s => normalize(s));
  
  // Check if any product size matches any query size
  for (const ps of productSizesArray) {
    const normalizedPs = normalize(String(ps));
    for (const qs of normalizedQuery) {
      // Exact match
      if (normalizedPs === qs) return 1.0;
      // Size abbreviations (S, M, L, etc.)
      if (normalizedPs === qs || normalizedPs.startsWith(qs) || qs.startsWith(normalizedPs)) {
        return 0.9;
      }
      // Partial match
      if (normalizedPs.includes(qs) || qs.includes(normalizedPs)) {
        return 0.7;
      }
    }
  }
  
  return 0;
}

/**
 * Infer occasion from product metadata (title, description, collection, styleTags)
 * Similar to inferAgeGroupFromProduct, but for occasions
 */
function inferOccasionFromProduct(product: { title?: string; description?: string; category?: string; subcategory?: string; attributes?: ProductAttributes | null }): string[] {
  const text = [
    product.title || '',
    product.description || '',
    product.category || '',
    product.subcategory || '',
    (product.attributes as any)?.collection || '',
    (product.attributes as any)?.Collection || '',
    (product.attributes as any)?.styleTags ? JSON.stringify((product.attributes as any).styleTags) : '',
  ].join(' ').toLowerCase();
  
  const inferredOccasions: string[] = [];
  
  // Wedding-related keywords
  if (/\b(wedding|bridal|bride|bridesmaid|ceremony|formal event|gala)\b/.test(text)) {
    inferredOccasions.push('Wedding', 'Formal');
  }
  
  // Beach-related keywords
  if (/\b(beach|vacation|resort|tropical|swimwear|bikini|cover-up)\b/.test(text)) {
    inferredOccasions.push('Beach', 'Vacation', 'Casual');
  }
  
  // Office/professional keywords
  if (/\b(office|professional|work|business|corporate|tailored)\b/.test(text)) {
    inferredOccasions.push('Office', 'Professional', 'Daytime');
  }
  
  // Party/cocktail keywords
  if (/\b(party|cocktail|evening|night out|date night|celebration)\b/.test(text)) {
    inferredOccasions.push('Party', 'Cocktail', 'Evening');
  }
  
  // Casual keywords
  if (/\b(casual|everyday|weekend|daytime|loungewear|comfortable)\b/.test(text)) {
    inferredOccasions.push('Casual', 'Daytime');
  }
  
  // Holiday/Christmas keywords
  if (/\b(holiday|christmas|winter|festive|celebration)\b/.test(text)) {
    inferredOccasions.push('Holiday', 'Party');
  }
  
  return inferredOccasions;
}

/**
 * Match occasion constraints
 * Checks database columns (occasion, occasionContext) first, then JSONB attributes, then infers from metadata
 */
export function matchOccasion(
  productAttrs: ProductAttributes | null | undefined,
  queryOccasions: string[] | undefined,
  product?: { title?: string; description?: string; category?: string; subcategory?: string; attributes?: ProductAttributes | null },
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!queryOccasions || queryOccasions.length === 0) return 0;
  
  // Priority 1: Check occasionContext array from database column (e.g., ["Daytime", "Vacation"])
  if (enrichedColumns?.occasionContext && enrichedColumns.occasionContext.length > 0) {
    const match = matchOccasionContext(enrichedColumns.occasionContext, queryOccasions);
    if (match > 0) return match;
  }
  
  // Priority 2: Check occasion string column from database (e.g., "Daytime, Vacation")
  if (enrichedColumns?.occasion) {
    // Split comma-separated values and match
    const occasionArray = enrichedColumns.occasion.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (occasionArray.length > 0) {
      const match = fuzzyMatch(occasionArray, queryOccasions);
      if (match > 0) return match;
    }
  }
  
  // Priority 3: Try JSONB attributes (fallback for backward compatibility)
  const productOccasion = extractAttrValue(productAttrs, 'occasion');
  if (productOccasion) {
  return fuzzyMatch(productOccasion, queryOccasions);
  }
  
  // Priority 4: If no explicit attribute, infer from product metadata
  if (product) {
    const inferredOccasions = inferOccasionFromProduct(product);
    if (inferredOccasions.length > 0) {
      return fuzzyMatch(inferredOccasions, queryOccasions);
    }
  }
  
  return 0;
}

/**
 * Infer styles from product metadata (collection, styleTags, title)
 * Similar to inferOccasionFromProduct, but for styles
 */
function inferStyleFromProduct(product: { title?: string; description?: string; category?: string; subcategory?: string; attributes?: ProductAttributes | null }): string[] {
  const attrs = product.attributes;
  if (!attrs) return [];
  
  const inferredStyles: string[] = [];
  
  // Try to get collection and styleTags
  const collection = extractAttrValue(attrs, 'collection') || extractAttrValue(attrs, 'Collection');
  const styleTags = extractAttrValue(attrs, 'styleTags');
  
  // Collection names often contain style hints (e.g., "Formal Collection", "Casual Collection")
  if (collection) {
    const collectionArray = Array.isArray(collection) ? collection : [collection];
    const styleKeywords = ['formal', 'casual', 'elegant', 'romantic', 'vintage', 'modern', 'classic', 'bohemian', 'minimalist', 'boho', 'chic', 'sophisticated'];
    for (const coll of collectionArray) {
      const collLower = String(coll).toLowerCase();
      for (const keyword of styleKeywords) {
        if (collLower.includes(keyword) && !inferredStyles.some(s => s.toLowerCase() === keyword)) {
          inferredStyles.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
        }
      }
    }
  }
  
  // styleTags might contain style information
  if (styleTags) {
    const tagsArray = Array.isArray(styleTags) ? styleTags : [styleTags];
    // Extract style-like tags (remove quotes and check if they match style keywords)
    const styleKeywords = ['formal', 'casual', 'elegant', 'romantic', 'vintage', 'modern', 'classic', 'bohemian', 'minimalist', 'boho', 'chic', 'sophisticated'];
    for (const tag of tagsArray) {
      const tagClean = String(tag).replace(/"/g, '').trim().toLowerCase();
      for (const keyword of styleKeywords) {
        if (tagClean.includes(keyword) && !inferredStyles.some(s => s.toLowerCase() === keyword)) {
          inferredStyles.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
        }
      }
    }
  }
  
  // Also check title/description for style keywords
  const text = [
    product.title || '',
    product.description || '',
  ].join(' ').toLowerCase();
  
  const styleKeywords = ['formal', 'casual', 'elegant', 'romantic', 'vintage', 'modern', 'classic', 'bohemian', 'minimalist', 'boho', 'chic', 'sophisticated'];
  for (const keyword of styleKeywords) {
    if (text.includes(keyword) && !inferredStyles.some(s => s.toLowerCase() === keyword)) {
      inferredStyles.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
    }
  }
  
  return inferredStyles;
}

/**
 * Match style constraints
 * Checks database column (silhouetteCut) first, then style_labels attribute, then style attribute, then infers from product metadata
 * This matches the dictionary extraction logic which extracts from:
 * - product.silhouetteCut column (A-Line, Wrap, Fit and Flare, Empire, etc.)
 * - attributes.style_labels, attributes.style, attributes.Style
 */
export function matchStyle(
  productAttrs: ProductAttributes | null | undefined,
  queryStyles: string[] | undefined,
  product?: { title?: string; description?: string; category?: string; subcategory?: string; attributes?: ProductAttributes | null },
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!queryStyles || queryStyles.length === 0) return 0;
  
  // Priority 1: Check silhouetteCut column from database (matches dictionary extraction source)
  if (enrichedColumns?.silhouetteCut) {
    const match = fuzzyMatch([enrichedColumns.silhouetteCut], queryStyles);
    if (match > 0) return match;
  }
  
  // Priority 2: Check style_labels attribute (matches dictionary extraction source)
  const styleLabels = extractAttrValue(productAttrs, 'style_labels') || extractAttrValue(productAttrs, 'styleLabels');
  if (styleLabels) {
    const match = fuzzyMatch(styleLabels, queryStyles);
    if (match > 0) return match;
  }
  
  // Priority 3: Check style/Style attribute (fallback)
  const productStyle = extractAttrValue(productAttrs, 'style') || extractAttrValue(productAttrs, 'Style');
  if (productStyle) {
    return fuzzyMatch(productStyle, queryStyles);
  }
  
  // Priority 4: If no explicit attribute, infer from product metadata
  if (product) {
    const inferredStyles = inferStyleFromProduct(product);
    if (inferredStyles.length > 0) {
      return fuzzyMatch(inferredStyles, queryStyles);
    }
  }
  
  return 0;
}

/**
 * Match pattern constraints
 * Checks multiple attribute key variations: 'pattern', 'Pattern', 'pattern_print', 'patternPrint'
 */
export function matchPattern(productAttrs: ProductAttributes | null | undefined, queryPatterns: string[] | undefined): number {
  if (!queryPatterns || queryPatterns.length === 0) return 0;
  
  // Try multiple attribute key variations
  const productPattern = extractAttrValue(productAttrs, 'pattern') || 
                         extractAttrValue(productAttrs, 'Pattern') ||
                         extractAttrValue(productAttrs, 'pattern_print') ||
                         extractAttrValue(productAttrs, 'patternPrint'); // camelCase converts to pattern_print
  return fuzzyMatch(productPattern, queryPatterns);
}

/**
 * Match season constraints
 * Checks database column (season) first, then JSONB attributes
 */
export function matchSeason(
  productAttrs: ProductAttributes | null | undefined, 
  querySeasons: string[] | undefined,
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!querySeasons || querySeasons.length === 0) return 0;
  
  // Priority 1: Check season column from database
  if (enrichedColumns?.season) {
    const match = fuzzyMatch([enrichedColumns.season], querySeasons);
    if (match > 0) return match;
  }
  
  // Priority 2: Fallback to JSONB attributes
  const productSeason = extractAttrValue(productAttrs, 'season') || extractAttrValue(productAttrs, 'Season');
  return fuzzyMatch(productSeason, querySeasons);
}

/**
 * Match material constraints
 * Checks database columns (material, fabric) first, then JSONB attributes
 */
export function matchMaterial(
  productAttrs: ProductAttributes | null | undefined, 
  queryMaterials: string[] | undefined,
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!queryMaterials || queryMaterials.length === 0) return 0;
  
  // Priority 1: Check material/fabric columns from database
  const materialSources: (string | null | undefined)[] = [];
  if (enrichedColumns?.material) materialSources.push(enrichedColumns.material);
  if (enrichedColumns?.fabric) materialSources.push(enrichedColumns.fabric);
  
  for (const source of materialSources) {
    if (source) {
      const match = fuzzyMatch([source], queryMaterials);
      if (match > 0) return match;
    }
  }
  
  // Priority 2: Fallback to JSONB attributes
  const productMaterial = extractAttrValue(productAttrs, 'material') || 
                          extractAttrValue(productAttrs, 'Material') ||
                          extractAttrValue(productAttrs, 'fabric');
  return fuzzyMatch(productMaterial, queryMaterials);
}

/**
 * Match fit constraints
 * Checks database column (fit) first, then JSONB attributes
 */
export function matchFit(
  productAttrs: ProductAttributes | null | undefined, 
  queryFits: string[] | undefined,
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!queryFits || queryFits.length === 0) return 0;
  
  // Priority 1: Check fit column from database
  if (enrichedColumns?.fit) {
    const match = fuzzyMatch([enrichedColumns.fit], queryFits);
    if (match > 0) return match;
  }
  
  // Priority 2: Fallback to JSONB attributes
  const productFit = extractAttrValue(productAttrs, 'fit') || extractAttrValue(productAttrs, 'Fit');
  return fuzzyMatch(productFit, queryFits);
}

/**
 * Match rise constraints
 * Checks database column (riseWaist) first, then JSONB attributes
 */
export function matchRise(
  productAttrs: ProductAttributes | null | undefined, 
  queryRises: string[] | undefined,
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!queryRises || queryRises.length === 0) return 0;
  
  // Priority 1: Check riseWaist column from database
  if (enrichedColumns?.riseWaist) {
    const match = fuzzyMatch([enrichedColumns.riseWaist], queryRises);
    if (match > 0) return match;
  }
  
  // Priority 2: Fallback to JSONB attributes
  const productRise = extractAttrValue(productAttrs, 'riseWaist') || 
                      extractAttrValue(productAttrs, 'RiseWaist') ||
                      extractAttrValue(productAttrs, 'rise') ||
                      extractAttrValue(productAttrs, 'Rise');
  return fuzzyMatch(productRise, queryRises);
}

/**
 * Match embellishments constraints
 */
export function matchEmbellishments(productAttrs: ProductAttributes | null | undefined, queryEmbellishments: string[] | undefined): number {
  if (!queryEmbellishments || queryEmbellishments.length === 0) return 0;
  
  const productEmbellishments = extractAttrValue(productAttrs, 'embellishments') || 
                                extractAttrValue(productAttrs, 'Embellishments') ||
                                extractAttrValue(productAttrs, 'embellishment') ||
                                extractAttrValue(productAttrs, 'Embellishment');
  return fuzzyMatch(productEmbellishments, queryEmbellishments);
}

/**
 * Match collection constraints
 */
export function matchCollection(productAttrs: ProductAttributes | null | undefined, queryCollections: string[] | undefined): number {
  if (!queryCollections || queryCollections.length === 0) return 0;
  
  const productCollection = extractAttrValue(productAttrs, 'collection') || extractAttrValue(productAttrs, 'Collection');
  return fuzzyMatch(productCollection, queryCollections);
}

/**
 * Infer ageGroup from product data (title, description, category, etc.)
 * Returns inferred ageGroup or null if not found
 * Exported for use in embedding generation
 */
export function inferAgeGroupFromProduct(product: { title?: string; description?: string; category?: string; subcategory?: string; attributes?: ProductAttributes | null }): string | null {
  const text = [
    product.title || '',
    product.description || '',
    product.category || '',
    product.subcategory || '',
    (product.attributes as any)?.productType || '',
    (product.attributes as any)?.googleProductCategory || '',
    (product.attributes as any)?.category || '',
    (product.attributes as any)?.subcategory || '',
  ].join(' ').toLowerCase();
  
  // Check category/subcategory first (most reliable indicator)
  const categoryText = [
    product.category || '',
    product.subcategory || '',
    (product.attributes as any)?.category || '',
    (product.attributes as any)?.subcategory || '',
  ].join(' ').toLowerCase();
  
  // If category explicitly mentions "kids", "children", "toddler", etc., it's kids category
  if (/\b(kids?|children|child|toddler|toddlers|baby|babies|infant|infants|youth|junior|juniors|girls?|boys?)\b/.test(categoryText)) {
    // Distinguish between toddler and kids
    if (/\b(toddler|toddlers|baby|babies|infant|infants|2T|3T|4T)\b/.test(categoryText)) {
      return 'toddler';
    }
    return 'kids';
  }
  
  // If category explicitly mentions "women", "men", "adult", etc., it's adult category
  if (/\b(women|womens|men|mens|ladies|gentlemen|adult|adults)\b/.test(categoryText)) {
    return 'adult';
  }
  
  // Kids/children indicators in product text
  const kidsPatterns = [
    /\b(kids?|children|child|girls?|boys?|toddler|toddlers|baby|babies|infant|infants|youth|junior|juniors)\b/,
    /\b(5|6|7|8|9|10|11|12|13)[\s-]*(year|yr)[\s-]*(old|olds)?\b/,
    /\bage[\s-]*(5|6|7|8|9|10|11|12|13)\b/,
    /\bsize[\s-]*(2T|3T|4T|5T|6T|7T|8T|10T|12T|14T|16T)\b/,
    /\b(toddler|preschool|elementary|middle[\s-]*school)\b/,
  ];
  
  // Adult indicators in product text
  // CRITICAL: Check for "for Women", "for Men" patterns first (most explicit)
  if (/\bfor\s+(women|womens|men|mens|ladies|gentlemen)\b/i.test(text)) {
    return 'adult';
  }
  
  const adultPatterns = [
    /\b(women|womens|men|mens|ladies|gentlemen|adult|adults)\b/,
    /\b(size[\s-]*)?(XS|S|M|L|XL|XXL|0|2|4|6|8|10|12|14|16|18|20|22|24)\b/,
  ];
  
  // Check for kids patterns first (more specific)
  for (const pattern of kidsPatterns) {
    if (pattern.test(text)) {
      // Distinguish between toddler and kids
      if (/\b(toddler|toddlers|baby|babies|infant|infants|2T|3T|4T)\b/.test(text)) {
        return 'toddler';
      }
      return 'kids';
    }
  }
  
  // Check for adult patterns
  for (const pattern of adultPatterns) {
    if (pattern.test(text)) {
      return 'adult';
    }
  }
  
  return null;
}

/**
 * Match age group constraints
 * Checks database column (ageGroup) first, then JSONB attributes, then infers from metadata
 * STRICT DICTIONARY MATCHING ONLY - no synonyms, no hierarchical relationships
 * Only matches exact canonical values from the dataset ontology
 */
export function matchAgeGroup(
  product: SearchResultItem | { attributes?: ProductAttributes | null },
  queryAgeGroups: string[] | undefined,
  enrichedColumns?: EnrichedColumnValues | null
): number {
  if (!queryAgeGroups || queryAgeGroups.length === 0) return 0;
  
  // Priority 1: Check ageGroup column from database
  let productAgeGroup: string | string[] | undefined = enrichedColumns?.ageGroup ?? undefined;
  
  // Priority 2: Check if product has ageGroup property (SearchResultItem)
  if (!productAgeGroup && 'ageGroup' in product && product.ageGroup) {
    productAgeGroup = product.ageGroup;
  }
  
  // Get product attributes for fallback and inference
  const productAttrs = 'attributes' in product ? product.attributes : (product as any).attributes;
  
  // Priority 3: Fallback to JSONB attributes
  if (!productAgeGroup) {
    productAgeGroup = extractAttrValue(productAttrs, 'ageGroup');
  }
  
  // Priority 4: If no explicit ageGroup, infer from product data
  if (!productAgeGroup && 'title' in product) {
    const productForInference = {
      title: (product as any).title,
      description: (product as any).description,
      category: (product as any).category,
      subcategory: (product as any).subcategory,
      attributes: productAttrs,
    };
    const inferred = inferAgeGroupFromProduct(productForInference);
    if (inferred) {
      // CRITICAL: Normalize inferred age group to canonical dictionary values
      // The inference function returns lowercase values like 'kids', 'toddler', etc.
      // We need to normalize them to canonical values like 'Kids', 'Toddler' before matching
      const normalizedInferred = normalizeAgeGroups([inferred]);
      if (normalizedInferred.length > 0) {
        productAgeGroup = normalizedInferred;
      } else {
        // If normalization fails, don't use inference (return 0)
        return 0;
      }
    }
  }
  
  if (!productAgeGroup) return 0;
  
  // Handle comma-separated age groups (e.g., "Kids, Tween" should be split into ["Kids", "Tween"])
  let productAgeGroupsArray: string[] = [];
  if (Array.isArray(productAgeGroup)) {
    // If it's an array, flatten it and split any comma-separated strings
    for (const pag of productAgeGroup) {
      if (typeof pag === 'string' && pag.includes(',')) {
        // Split comma-separated values and add each individually
        productAgeGroupsArray.push(...pag.split(',').map(p => p.trim()).filter(Boolean));
      } else {
        productAgeGroupsArray.push(String(pag));
      }
    }
  } else if (typeof productAgeGroup === 'string') {
    // If it's a single string, check if it contains commas
    if (productAgeGroup.includes(',')) {
      productAgeGroupsArray = productAgeGroup.split(',').map(p => p.trim()).filter(Boolean);
    } else {
      productAgeGroupsArray = [productAgeGroup];
    }
  } else {
    productAgeGroupsArray = [String(productAgeGroup)];
  }
  
  const productAgeGroups = productAgeGroupsArray;
  
  // Normalize query age groups to canonical dictionary values
  // Query age groups should already be normalized by normalizeAgeGroups, but ensure they match dictionary
  // CRITICAL: Also normalize the query age groups here to ensure they match dictionary values
  const normalizedQueryInput = normalizeAgeGroups(queryAgeGroups);
  if (normalizedQueryInput.length === 0) return 0; // No valid query age groups after normalization
  
  const normalizedQueryCanonicals: string[] = [];
  for (const qag of normalizedQueryInput) {
    const lower = qag.toLowerCase().trim();
    // Find exact match in dictionary (case-insensitive)
    const canonicalMatch = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(
      ag => ag.toLowerCase() === lower
    );
    // Only add if it's a valid dictionary value
    if (canonicalMatch) {
      normalizedQueryCanonicals.push(canonicalMatch);
    }
  }
  
  if (normalizedQueryCanonicals.length === 0) return 0; // No valid query age groups
  
  // STRICT DICTIONARY MATCHING - only match exact canonical values
  for (const pag of productAgeGroups) {
    const normalizedPag = normalize(pag); // lowercase
    
    // Normalize product age group to canonical value
    const productCanonical = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(
      ag => ag.toLowerCase() === normalizedPag
    );
    if (!productCanonical) continue; // Skip if product age group is not in dictionary
    
    // Convert both to lowercase for comparison
    const productCanonicalLower = productCanonical.toLowerCase();
    
    for (const queryCanonical of normalizedQueryCanonicals) {
      const queryCanonicalLower = queryCanonical.toLowerCase();
      
      // Check exact match (case-insensitive) - both must be in dictionary
      if (productCanonicalLower === queryCanonicalLower) {
        return 1.0;
      }
      
      // Check if product age group contains query age group (for combinations like "Baby, Toddler")
      // e.g., product "Baby, Toddler" should match query "Toddler"
      // BUT: Only if both are valid dictionary values and the substring is a complete word
      // CRITICAL: Do NOT match "Kids" products when query is "toddler" or "baby" - they are different age groups
      if (productCanonicalLower.includes(queryCanonicalLower) && queryCanonicalLower.length > 2) {
        // HARD FILTER: "toddler" and "baby" should NEVER match "Kids" products
        if ((queryCanonicalLower === 'toddler' || queryCanonicalLower === 'baby') && productCanonicalLower === 'kids') {
          return 0; // Hard filter: "toddler" and "baby" should NOT match "Kids" products
        }
        // Verify that the substring appears as a complete word (not part of another word)
        // e.g., "baby, toddler" contains "toddler" as a complete word
        const regex = new RegExp(`\\b${queryCanonicalLower}\\b`, 'i');
        if (regex.test(productCanonical)) {
          return 1.0;
        }
      }
      
      // Check if query age group contains product age group (for combinations)
      // e.g., query "Baby, Toddler" should match product "Toddler"
      // BUT: Only if both are valid dictionary values and the substring is a complete word
      // CRITICAL: Do NOT match "Kids" products when query is "toddler" or "baby"
      if (queryCanonicalLower.includes(productCanonicalLower) && productCanonicalLower.length > 2) {
        // HARD FILTER: "toddler" and "baby" should NEVER match "Kids" products
        if ((queryCanonicalLower === 'toddler' || queryCanonicalLower === 'baby') && productCanonicalLower === 'kids') {
          return 0; // Hard filter: "toddler" and "baby" should NOT match "Kids" products
        }
        // Verify that the substring appears as a complete word (not part of another word)
        const regex = new RegExp(`\\b${productCanonicalLower}\\b`, 'i');
        if (regex.test(queryCanonical)) {
          return 1.0;
        }
      }
    }
  }
  
  return 0;
}

/**
 * Match price constraints
 * Returns 1.0 if price is within range, 0.5 if close, 0 if outside
 */
export function matchPrice(
  productPriceCents: number | undefined,
  queryPriceMinCents: number | undefined,
  queryPriceMaxCents: number | undefined
): number {
  if (!productPriceCents) return 0;
  if (!queryPriceMinCents && !queryPriceMaxCents) return 0;
  
  let inRange = true;
  
  if (queryPriceMinCents && productPriceCents < queryPriceMinCents) {
    inRange = false;
  }
  
  if (queryPriceMaxCents && productPriceCents > queryPriceMaxCents) {
    inRange = false;
  }
  
  if (inRange) return 1.0;
  
  // Check if close to range (within 20%)
  if (queryPriceMaxCents) {
    const threshold = queryPriceMaxCents * 1.2;
    if (productPriceCents <= threshold) return 0.5;
  }
  
  if (queryPriceMinCents) {
    const threshold = queryPriceMinCents * 0.8;
    if (productPriceCents >= threshold) return 0.5;
  }
  
  return 0;
}

/**
 * Match formality level constraints
 * Handles formality variations (e.g., "casual" matches "Casual", "formal" matches "Formal")
 */
export function matchFormalityLevel(
  productFormalityLevel: string | string[] | undefined,
  queryFormalityLevels: string[]
): number {
  if (!productFormalityLevel || queryFormalityLevels.length === 0) return 0;
  
  const productLevels = Array.isArray(productFormalityLevel) ? productFormalityLevel : [productFormalityLevel];
  const normalizedQuery = queryFormalityLevels.map(normalize);
  
  for (const pl of productLevels) {
    const normalizedPl = normalize(pl);
    for (const ql of normalizedQuery) {
      // Exact match
      if (normalizedPl === ql) return 1.0;
      // Synonym matching
      if ((normalizedPl === 'casual' && ql === 'casual') ||
          (normalizedPl === 'semi-formal' && (ql === 'semi-formal' || ql === 'semiformal' || ql === 'semi formal')) ||
          (normalizedPl === 'formal' && ql === 'formal')) {
        return 1.0;
      }
      // Partial match
      if (normalizedPl.includes(ql) || ql.includes(normalizedPl)) {
        return 0.8;
      }
    }
  }
  
  return 0;
}

/**
 * Match temperature intent constraints
 * Exact match: "Warm Weather", "Cool Weather"
 */
export function matchTemperatureIntent(
  productTemperatureIntent: string | undefined,
  queryTemperatureIntent: string
): number {
  if (!productTemperatureIntent || !queryTemperatureIntent) return 0;
  
  const normalizedProduct = normalize(productTemperatureIntent);
  const normalizedQuery = normalize(queryTemperatureIntent);
  
  if (normalizedProduct === normalizedQuery) return 1.0;
  if (normalizedProduct.includes(normalizedQuery) || normalizedQuery.includes(normalizedProduct)) return 0.8;
  
  return 0;
}

/**
 * Match humidity friendly constraints
 * Boolean match
 */
export function matchHumidityFriendly(
  productHumidityFriendly: boolean | null | undefined,
  queryHumidityFriendly: boolean
): number {
  if (productHumidityFriendly === undefined || productHumidityFriendly === null) return 0;
  return productHumidityFriendly === queryHumidityFriendly ? 1.0 : 0;
}

/**
 * Match occasion context constraints
 * Array intersection match
 */
export function matchOccasionContext(
  productOccasionContext: string[] | null | undefined,
  queryOccasionContext: string[]
): number {
  if (!productOccasionContext || productOccasionContext.length === 0 || queryOccasionContext.length === 0) return 0;
  
  const productLower = productOccasionContext.map(normalize);
  const queryLower = queryOccasionContext.map(normalize);
  
  const matches = queryLower.filter(q => productLower.includes(q));
  if (matches.length === 0) return 0;
  
  // Return proportion of matches (if 2 out of 3 query occasions match, return 0.67)
  return matches.length / queryLower.length;
}

/**
 * Match problem solutions constraints
 * Array intersection match
 */
export function matchProblemSolutions(
  productProblemSolutions: string[] | null | undefined,
  queryProblemSolutions: string[]
): number {
  if (!productProblemSolutions || productProblemSolutions.length === 0 || queryProblemSolutions.length === 0) return 0;
  
  const productLower = productProblemSolutions.map(normalize);
  const queryLower = queryProblemSolutions.map(normalize);
  
  const matches = queryLower.filter(q => productLower.includes(q));
  if (matches.length === 0) return 0;
  
  // Return proportion of matches
  return matches.length / queryLower.length;
}

/**
 * Match function features constraints
 * Array intersection match
 */
export function matchFunctionFeatures(
  productFunctionFeatures: string[] | null | undefined,
  queryFunctionFeatures: string[]
): number {
  if (!productFunctionFeatures || productFunctionFeatures.length === 0 || queryFunctionFeatures.length === 0) return 0;
  
  const productLower = productFunctionFeatures.map(normalize);
  const queryLower = queryFunctionFeatures.map(normalize);
  
  const matches = queryLower.filter(q => productLower.includes(q));
  if (matches.length === 0) return 0;
  
  // Return proportion of matches
  return matches.length / queryLower.length;
}

/**
 * Match color shade constraints
 * Exact match: "Light", "Medium", "Dark"
 */
export function matchColorShade(
  productColorShade: string | undefined,
  queryColorShades: string[]
): number {
  if (!productColorShade || queryColorShades.length === 0) return 0;
  
  const normalizedProduct = normalize(productColorShade);
  const normalizedQuery = queryColorShades.map(normalize);
  
  if (normalizedQuery.includes(normalizedProduct)) return 1.0;
  
  // Partial match
  for (const qs of normalizedQuery) {
    if (normalizedProduct.includes(qs) || qs.includes(normalizedProduct)) {
      return 0.8;
    }
  }
  
  return 0;
}

/**
 * Match color undertone constraints
 * Exact match: "Warm", "Cool", "Neutral"
 */
export function matchColorUndertone(
  productColorUndertone: string | undefined,
  queryColorUndertones: string[]
): number {
  if (!productColorUndertone || queryColorUndertones.length === 0) return 0;
  
  const normalizedProduct = normalize(productColorUndertone);
  const normalizedQuery = queryColorUndertones.map(normalize);
  
  if (normalizedQuery.includes(normalizedProduct)) return 1.0;
  
  // Partial match
  for (const qu of normalizedQuery) {
    if (normalizedProduct.includes(qu) || qu.includes(normalizedProduct)) {
      return 0.8;
    }
  }
  
  return 0;
}

/**
 * Match multicolor constraints
 * Boolean match
 */
export function matchMulticolor(
  productMulticolor: boolean | null | undefined,
  queryMulticolor: boolean
): number {
  if (productMulticolor === undefined || productMulticolor === null) return 0;
  return productMulticolor === queryMulticolor ? 1.0 : 0;
}

/**
 * Match seasonal palette constraints
 * Exact match: "Spring", "Summer", "Fall", "Winter"
 */
export function matchSeasonalPalette(
  productSeasonalPalette: string | undefined,
  querySeasonalPalettes: string[]
): number {
  if (!productSeasonalPalette || querySeasonalPalettes.length === 0) return 0;
  
  const normalizedProduct = normalize(productSeasonalPalette);
  const normalizedQuery = querySeasonalPalettes.map(normalize);
  
  if (normalizedQuery.includes(normalizedProduct)) return 1.0;
  
  // Partial match
  for (const qp of normalizedQuery) {
    if (normalizedProduct.includes(qp) || qp.includes(normalizedProduct)) {
      return 0.8;
    }
  }
  
  return 0;
}

/**
 * Infer related attributes based on constraints
 * Boosts related attributes to improve matching
 * NOTE: These are hints/suggestions, not strict requirements
 * Products matching these will get boosted, but products without them won't be penalized
 */
function inferRelatedAttributes(constraints: FashionConstraints): Partial<FashionConstraints> {
  const related: Partial<FashionConstraints> = {};
  
  // If occasion is "Wedding", boost formal styles and elegant materials
  // These are hints - products with these attributes will score higher
  const occasionValues = extractConstraintValues(constraints.occasions) || (Array.isArray(constraints.occasions) ? constraints.occasions : []);
  if (occasionValues.some(o => /wedding/i.test(o))) {
    if (!related.styles || !Array.isArray(related.styles)) related.styles = [];
    if (!related.materials || !Array.isArray(related.materials)) related.materials = [];
    // Wedding implies formal, elegant styles (but don't require them)
    const styleValues = extractConstraintValues(constraints.styles) || (Array.isArray(constraints.styles) ? constraints.styles : []);
    if (!styleValues.some(s => /formal|elegant|classic/i.test(s))) {
      (related.styles as string[]).push('Formal', 'Elegant');
    }
    // Wedding implies elegant materials (silk, satin, lace) - but cotton/polyester dresses can still work
    // We add these as hints, but products without them won't be penalized (they just won't get the boost)
    const materialValues = extractConstraintValues(constraints.materials) || (Array.isArray(constraints.materials) ? constraints.materials : []);
    if (!materialValues.some(m => /silk|satin|lace/i.test(m))) {
      (related.materials as string[]).push('Silk', 'Satin', 'Lace');
    }
  }
  
  // If occasion is "Beach", boost casual styles, light materials, summer season
  if (occasionValues.some(o => /beach/i.test(o))) {
    if (!related.styles || !Array.isArray(related.styles)) related.styles = [];
    if (!related.materials || !Array.isArray(related.materials)) related.materials = [];
    if (!related.seasons || !Array.isArray(related.seasons)) related.seasons = [];
    const styleValues = extractConstraintValues(constraints.styles) || (Array.isArray(constraints.styles) ? constraints.styles : []);
    if (!styleValues.some(s => /casual/i.test(s))) {
      (related.styles as string[]).push('Casual');
    }
    const materialValues = extractConstraintValues(constraints.materials) || (Array.isArray(constraints.materials) ? constraints.materials : []);
    if (!materialValues.some(m => /cotton|linen|modal/i.test(m))) {
      (related.materials as string[]).push('Cotton', 'Linen', 'Modal');
    }
    const seasonValues = extractConstraintValues(constraints.seasons) || (Array.isArray(constraints.seasons) ? constraints.seasons : []);
    if (!seasonValues.some(s => /summer/i.test(s))) {
      (related.seasons as string[]).push('Summer');
    }
  }
  
  // If material is "Silk", boost formal occasions
  const materialValues = extractConstraintValues(constraints.materials) || (Array.isArray(constraints.materials) ? constraints.materials : []);
  if (materialValues.some(m => /silk/i.test(m))) {
    if (!related.occasions || !Array.isArray(related.occasions)) related.occasions = [];
    const occasionValues = extractConstraintValues(constraints.occasions) || (Array.isArray(constraints.occasions) ? constraints.occasions : []);
    if (!occasionValues.some(o => /formal|wedding|evening/i.test(o))) {
      (related.occasions as string[]).push('Formal', 'Evening', 'Wedding');
    }
  }
  
  // If season is "Winter", boost warm materials
  const seasonValues = extractConstraintValues(constraints.seasons) || (Array.isArray(constraints.seasons) ? constraints.seasons : []);
  if (seasonValues.some(s => /winter/i.test(s))) {
    if (!related.materials || !Array.isArray(related.materials)) related.materials = [];
    if (!materialValues.some(m => /wool|cashmere|fleece/i.test(m))) {
      (related.materials as string[]).push('Wool', 'Cashmere', 'Fleece');
    }
  }
  
  // If season is "Summer", boost light materials
  if (seasonValues.some(s => /summer/i.test(s))) {
    if (!related.materials || !Array.isArray(related.materials)) related.materials = [];
    if (!materialValues.some(m => /cotton|linen|modal/i.test(m))) {
      (related.materials as string[]).push('Cotton', 'Linen', 'Modal');
    }
  }
  
  return related;
}

/**
 * Attribute-specific keywords for detecting mentions in queries
 */
const attributeKeywords: Record<string, string[]> = {
  colors: ['color', 'colour', 'colored', 'coloured', 'red', 'blue', 'green', 'black', 'white', 'pink', 'yellow', 'purple', 'orange', 'brown', 'gray', 'grey', 'navy', 'beige', 'cream', 'ivory', 'blush', 'coral', 'mint', 'lavender'],
  occasions: ['occasion', 'for', 'wedding', 'party', 'event', 'beach', 'office', 'work', 'vacation', 'holiday', 'christmas', 'formal', 'casual', 'date'],
  necklines: ['neckline', 'neck', 'round neck', 'v-neck', 'square neck', 'collar', 'high neck', 'scoop neck', 'boat neck', 'off-shoulder'],
  lengths: ['length', 'mini', 'maxi', 'midi', 'long', 'short', 'knee-length', 'ankle-length', 'hem'],
  materials: ['material', 'fabric', 'silk', 'cotton', 'linen', 'wool', 'cashmere', 'polyester', 'modal', 'spandex', 'elastane', 'fleece', 'satin', 'lace', 'chiffon'],
  styles: ['style', 'elegant', 'casual', 'formal', 'romantic', 'vintage', 'modern', 'classic', 'bohemian', 'minimalist', 'feminine', 'sophisticated', 'chic', 'edgy', 'sporty', 'relaxed', 'polished'],
  sizes: ['size', 'small', 'medium', 'large', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', '0', '2', '4', '6', '8', '10', '12', '14', '16'],
  fits: ['fit', 'fitted', 'relaxed', 'loose', 'slim', 'comfortable', 'form-fitting', 'tailored', 'oversized'],
  seasons: ['season', 'summer', 'winter', 'spring', 'fall', 'autumn', 'seasonal'],
  price: ['price', 'cost', 'budget', 'under', 'over', '$', 'dollar', 'cheap', 'expensive', 'affordable'],
  formalityLevel: ['formal', 'casual', 'elegant', 'sophisticated', 'semi-formal', 'black tie'],
  patterns: ['pattern', 'floral', 'striped', 'polka dot', 'print', 'solid', 'plaid', 'checkered'],
  ageGroups: ['age', 'adult', 'kids', 'children', 'child', 'kid', 'toddler', 'baby', 'teen', 'teenager', 'tween', 'women', 'men', 'girl', 'boy'],
  sleeveLengths: ['sleeve', 'sleeveless', 'short sleeve', 'long sleeve', 'three-quarter', 'cap sleeve'],
  embellishments: ['embellishment', 'ruffle', 'bow', 'sequin', 'bead', 'embroidery', 'detail'],
  collections: ['collection', 'line', 'series'],
  problemSolutions: ['pocket', 'wrinkle-free', 'wrinkle resistant', 'travel-friendly', 'packable', 'stain-resistant'],
  functionFeatures: ['pocket', 'adjustable', 'removable', 'convertible', 'reversible', 'zip', 'button'],
  temperatureIntent: ['hot', 'cold', 'warm', 'cool', 'winter', 'summer', 'weather', 'breathable', 'insulated'],
  humidityFriendly: ['humid', 'sweat', 'breathable', 'moisture', 'wicking'],
  modestyCues: ['modest', 'coverage', 'conservative', 'layered'],
  braSolution: ['bra-friendly', 'built-in bra', 'no bra needed', 'braless'],
  occasionContext: ['wedding', 'beach', 'vacation', 'office', 'party', 'daytime', 'evening', 'casual', 'formal'],
  colorShade: ['light', 'dark', 'medium', 'pale', 'pastel', 'deep', 'rich'],
  colorUndertone: ['warm', 'cool', 'neutral', 'warm tones', 'cool tones'],
  multicolor: ['multicolor', 'multi-color', 'patterned', 'print', 'solid', 'single color'],
  seasonalPalette: ['spring', 'summer', 'fall', 'winter', 'seasonal colors', 'spring colors', 'summer colors'],
  careRequirements: ['machine washable', 'dry clean', 'hand wash', 'washable', 'care'],
  travelFeatures: ['travel', 'travel-friendly', 'packable', 'wrinkle-free', 'lightweight'],
  pockets: ['pocket', 'pockets', 'has pockets', 'with pockets', 'no pockets'],
  ecoMaterials: ['organic', 'recycled', 'sustainable', 'eco-friendly', 'green'],
};

/**
 * Calculate dynamic weight for an attribute based on query context
 * ENHANCED: Now considers query specificity, multiple constraints, and context-aware adjustments
 */
function getDynamicWeight(
  attribute: string,
  queryContext?: QueryContext,
  category?: string,
  allConstraints?: FashionConstraints | QueryConstraintsWithIntent
): number {
  // Updated base weights with Tier 1-5 adjustments for commonly used constraints
  const baseWeights: Record<string, number> = {
    // Tier 1 (Highest) - unchanged
    ageGroups: 1.5,
    // Tier 2 (Very High) - increased base weights
    colors: 1.2, // was 1.0
    occasions: 0.8, // was 0.6
    lengths: 0.5, // was 0.4
    necklines: 0.4, // was 0.3
    sizes: 0.9, // was 0.8
    price: 0.4, // was 0.3
    // Tier 3 (High) - increased base weights
    formalityLevel: 0.8, // was 0.7
    materials: 0.3, // was 0.2
    styles: 0.5, // was 0.4
    patterns: 0.5, // was 0.4
    // Tier 4 (Medium) - slightly increased
    fits: 0.25, // was 0.2
    sleeveLengths: 0.35, // was 0.3
    seasons: 0.45, // Increased from 0.35 - important when explicitly mentioned (e.g., "summer outfits")
    problemSolutions: 0.75, // was 0.7
    // Tier 5 (Lower but Equal) - keep existing weights
    collections: 0.2,
    embellishments: 0.2,
    // Enriched attributes
    temperatureIntent: 0.8,
    humidityFriendly: 0.6,
    functionFeatures: 0.6,
    colorShade: 0.5,
    colorUndertone: 0.5,
    multicolor: 0.4,
    seasonalPalette: 0.5,
    occasionContext: 0.7,
    // Additional enriched attributes with base weights
    careRequirements: 0.3, // Lower weight than materials (used with * 0.6 multiplier)
    travelFeatures: 0.5, // Moderate priority (used with * 0.8 multiplier)
    pockets: 0.6, // Moderate-high priority, frequently asked (used with * 1.2 multiplier)
    braSolution: 0.5, // Moderate priority (used with * 0.9 multiplier)
    modestyCues: 0.5, // Moderate priority
    ecoMaterials: 0.7, // Important for sustainability-conscious shoppers
    certifications: 0.8, // Important for certified products
    origin: 0.5, // Moderate priority
    adaptiveFeatures: 1.0, // Important for inclusivity
    sensoryFriendly: 1.0, // Important for inclusivity
    finish: 0.4, // Lower priority
    layeringIntent: 0.4, // Lower priority
    pairingIntent: 0.4, // Lower priority
    rainWind: 0.6, // Moderate priority (used with * 0.7 multiplier)
    liningType: 0.4, // Lower priority
  };
  
  const baseWeight = baseWeights[attribute] || 0.2;
  
  // Apply category-specific priority adjustments (preserve existing logic)
  let categoryAdjustment = 1.0;
  if (category) {
    if (isHighPriorityAttribute(category, attribute)) {
      categoryAdjustment = 1.5;
    } else if (isLowPriorityAttribute(category, attribute)) {
      categoryAdjustment = 0.7;
    }
  }
  
  if (!queryContext) {
    return baseWeight * categoryAdjustment;
  }
  
  const { queryType, explicitMentions, originalQuery } = queryContext;
  const isExplicitlyMentioned = explicitMentions?.includes(attribute) || false;
  
  // Multi-constraint analysis: Count active constraints and adjust weights
  let multiConstraintAdjustment = 1.0;
  let interactionBonus = 1.0;
  if (allConstraints) {
    const activeConstraintCount = Object.values(allConstraints).filter(v => {
      if (v === null || v === undefined) return false;
      // Handle old format: arrays
      if (Array.isArray(v)) return v.length > 0;
      // Handle new format: object with 'values' property (array constraints)
      if (typeof v === 'object' && 'values' in v) {
        const values = (v as any).values;
        return Array.isArray(values) && values.length > 0;
      }
      // Handle new format: object with 'value' property (single value constraints)
      if (typeof v === 'object' && 'value' in v) {
        const value = (v as any).value;
        // For boolean, false is a valid active value; for others, check not null/undefined
        if (typeof value === 'boolean') return true;
        return value !== null && value !== undefined;
      }
      // Handle old format: direct values (boolean, string, number)
      if (typeof v === 'boolean') return true; // false is a valid constraint
      if (typeof v === 'string') return v.length > 0;
      if (typeof v === 'number') return true;
      return false;
    }).length;
    
    // Multi-constraint adjustment: distribute weights more evenly when multiple constraints are present
    if (activeConstraintCount > 1) {
      multiConstraintAdjustment = Math.max(0.7, 1.0 / Math.sqrt(activeConstraintCount));
    }
    
    // Interaction bonus: If high-priority constraints are mentioned together, user is being specific
    const highPriorityAttributes = ['colors', 'occasions', 'necklines', 'lengths'];
    if (highPriorityAttributes.includes(attribute)) {
      const otherHighPriorityActive = highPriorityAttributes.filter(a => {
        if (a === attribute) return false;
        // Type-safe access to constraint value
        const constraint = (allConstraints as any)[a];
        if (constraint === null || constraint === undefined) return false;
        // Check if constraint is actually active (has values)
        if (Array.isArray(constraint)) return constraint.length > 0;
        if (typeof constraint === 'object' && 'values' in constraint) {
          return Array.isArray((constraint as any).values) && (constraint as any).values.length > 0;
        }
        if (typeof constraint === 'object' && 'value' in constraint) {
          const value = (constraint as any).value;
          if (typeof value === 'boolean') return true;
          return value !== null && value !== undefined;
        }
        if (typeof constraint === 'boolean') return true;
        if (typeof constraint === 'string') return constraint.length > 0;
        if (typeof constraint === 'number') return true;
        return false;
      });
      
      if (otherHighPriorityActive.length > 0) {
        interactionBonus = 1.1; // Small boost for being specific
      }
    }
  }
  
  // Query specificity detection: detect strict vs flexible language
  let specificityMultiplier = 1.0;
  if (originalQuery) {
    const queryLower = originalQuery.toLowerCase();
    const strictPatterns = /\b(only|must be|exactly|strictly|specifically|definitely|absolutely)\b/;
    const flexiblePatterns = /\b(similar to|close to|around|preferably|maybe|perhaps|or similar|kind of|sort of)\b/;
    const anyPatterns = /\b(any|any color|any style|any occasion)\b/;
    
    // Check if attribute is mentioned with strict/flexible language
    const keywords = attributeKeywords[attribute] || [];
    if (keywords.length > 0) {
      for (const keyword of keywords) {
        const keywordIndex = queryLower.indexOf(keyword);
        if (keywordIndex !== -1) {
          const context = queryLower.substring(
            Math.max(0, keywordIndex - 30),
            Math.min(queryLower.length, keywordIndex + keyword.length + 30)
          );
          
          if (strictPatterns.test(context)) {
            specificityMultiplier = 1.5; // Boost for strict requirements
            break;
          } else if (flexiblePatterns.test(context)) {
            specificityMultiplier = 0.7; // Reduce for flexible requirements
            break;
          } else if (anyPatterns.test(context)) {
            specificityMultiplier = 0.3; // Greatly reduce for "any X" queries
            break;
          }
        }
      }
    }
  }
  
  // Context-aware weight adjustments for commonly used constraints
  let contextMultiplier = 1.0;
  if (originalQuery) {
    const queryLower = originalQuery.toLowerCase();
    const keywords = attributeKeywords[attribute] || [];
    const hasKeywordMention = keywords.some(keyword => 
      new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(queryLower)
    );
    
  switch (attribute) {
      case 'colors':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.3;
        } else if (hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
        
    case 'occasions':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.6;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.4;
        } else if (queryType === 'occasion_based') {
          contextMultiplier = 1.3;
        } else if (hasKeywordMention) {
          contextMultiplier = 1.2;
        }
        break;
        
      case 'necklines':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.3;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.2;
        } else if (hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'lengths':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.3;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.2;
        } else if (hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'ageGroups':
        // Always highest priority - no additional multiplier needed
        contextMultiplier = 1.0;
        break;
        
      case 'price':
        if (isExplicitlyMentioned || hasKeywordMention) {
          contextMultiplier = 1.2;
        }
        break;
        
      case 'formalityLevel':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.4;
        } else if (queryType === 'occasion_based') {
          contextMultiplier = 1.3;
        } else if (isExplicitlyMentioned || hasKeywordMention) {
          contextMultiplier = 1.2;
        }
        break;
      
    case 'materials':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.1;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.0;
        }
        break;
        
      case 'styles':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.1;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.0;
        }
        break;
        
      case 'sizes':
        if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
      
    case 'fits':
        if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'seasons':
        // Season is important when explicitly mentioned (e.g., "summer outfits", "winter wardrobe")
        // Boost it similar to lengths/necklines but balanced with other constraints
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.4; // Increased from 1.2 - when season is explicitly mentioned AND keyword detected
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.3; // Increased from 1.1 - when season is explicitly mentioned
        } else if (hasKeywordMention) {
          // Season keyword found but not in explicit mentions (semantic match)
          contextMultiplier = 1.2;
        } else if (queryLower.match(/\b(summer|winter|spring|fall|autumn)\s+(outfit|wardrobe|dress|top|clothing|fashion|style|collection)/i)) {
          // Pattern like "summer outfits" - season is contextually important
          contextMultiplier = 1.25;
        } else if (queryLower.match(/miami|beach|tropical|resort/i)) {
          contextMultiplier = 1.1; // Slight boost for summer-related contexts
        }
        break;
        
      case 'patterns':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
      
    case 'temperatureIntent':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.4;
        } else if (hasKeywordMention) {
          contextMultiplier = 1.2;
        }
        break;
      
    case 'humidityFriendly':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
      
    case 'problemSolutions':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
      
    case 'functionFeatures':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
      
    case 'colorShade':
    case 'colorUndertone':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'occasionContext':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.3;
        } else if (queryType === 'occasion_based') {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'sleeveLengths':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'collections':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
      
    case 'multicolor':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
      
    case 'seasonalPalette':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'careRequirements':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'travelFeatures':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'pockets':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.3; // High priority - frequently asked
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.2;
        }
        break;
        
      case 'braSolution':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'modestyCues':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.2;
        } else if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
        break;
        
      case 'embellishments':
        if (isExplicitlyMentioned && hasKeywordMention) {
          contextMultiplier = 1.1;
        }
        break;
      
    default:
        // For other attributes, apply basic explicit mention boost if present
        if (isExplicitlyMentioned) {
          contextMultiplier = 1.1;
        }
    }
  }
  
  // Calculate final weight with all adjustments
  let finalWeight = baseWeight;
  finalWeight *= categoryAdjustment;
  finalWeight *= contextMultiplier;
  finalWeight *= specificityMultiplier;
  finalWeight *= multiConstraintAdjustment;
  finalWeight *= interactionBonus;
  
  // Cap the weight to reasonable bounds (0.1 to 2.5)
  return Math.max(0.1, Math.min(2.5, finalWeight));
}

/**
 * Get intent weight multiplier
 * Returns weight multiplier based on constraint intent level
 */
export function getIntentWeight(intent: ConstraintIntent | null): number {
  if (!intent) return 1.0; // Default weight for old format (no intent)
  
  switch (intent) {
    case 'required': return 2.0;  // Highest weight - must match
    case 'strong': return 1.5;     // High weight - prefer matches
    case 'preferred': return 0.5;   // Low weight - nice to have
    case 'excluded': return -1.0;   // Negative - penalty for matches
    default: return 1.0;
  }
}

/**
 * Calculate match score with intent awareness
 * Handles similar values for 'strong' intent and negative scoring for 'excluded' intent
 */
function calculateMatchScoreWithIntent(
  productValue: any,
  constraint: any,
  matchFn: (productValue: any, constraintValues: string[]) => number
): number {
  if (!constraint) return 0;
  
  const values = extractConstraintValues(constraint);
  const intent = extractConstraintIntent(constraint);
  const similarValues = extractSimilarValues(constraint);
  
  if (!values || values.length === 0) return 0;
  
  // Calculate base match score
  let matchScore = matchFn(productValue, values);
  
  // For 'strong' intent, also check similar values
  if (intent === 'strong' && similarValues && similarValues.length > 0) {
    const similarScore = matchFn(productValue, similarValues);
    // Use max of original match or similar match, but weight similar matches slightly lower
    matchScore = Math.max(matchScore, similarScore * 0.8);
  }
  
  // For 'required' intent, only match original values (no similar values)
  // (matchScore already calculated above)
  
  // For 'preferred' intent, use lower base score
  if (intent === 'preferred') {
    matchScore = matchScore * 0.5;
  }
  
  // For 'excluded' intent, return negative score if matches
  if (intent === 'excluded') {
    return matchScore > 0 ? -1.0 : 0; // Negative penalty if matches
  }
  
  return matchScore;
}

/**
 * Calculate overall constraint match score for a product
 * Returns a score 0-1 based on how well the product matches all constraints
 * Now supports intent-based weighting
 */
export function calculateConstraintMatchScore(
  product: SearchResultItem | { attributes?: ProductAttributes | null; priceCents?: number },
  constraints: FashionConstraints,
  queryContext?: QueryContext,
  enrichedColumns?: EnrichedColumnValues | null
): number {
  const attrs = 'attributes' in product ? product.attributes : (product as any).attributes;
  const productTitle = 'title' in product ? product.title : '';
  
  // Extract enriched columns from product if not provided
  let enriched: EnrichedColumnValues | null = enrichedColumns ?? null;
  if (!enriched && 'length' in product) {
    // Product is SearchResultItem with enriched columns - extract ALL database columns
    enriched = {
      // Core indexed columns
      color: (product as any).color ?? null,
      fabric: (product as any).fabric ?? null,
      material: (product as any).material ?? null,
      occasion: (product as any).occasion ?? null,
      season: (product as any).season ?? null,
      fit: (product as any).fit ?? null,
      
      // Fit & Construction
      length: product.length ?? null,
      sleeve: product.sleeve ?? null,
      neckline: product.neckline ?? null,
      riseWaist: (product as any).riseWaist ?? null,
      
      // Style & Occasion
      formalityLevel: product.formalityLevel ?? null,
      occasionContext: product.occasionContext ?? null,
      dressCode: (product as any).dressCode ?? null,
      seasonalCues: (product as any).seasonalCues ?? null,
      
      // Weather & Comfort
      temperatureIntent: product.temperatureIntent ?? null,
      humidityFriendly: product.humidityFriendly ?? null,
      
      // Problem-Solution
      problemSolutions: product.problemSolutions ?? null,
      functionFeatures: product.functionFeatures ?? null,
      
      // Color Details
      colorShade: product.colorShade ?? null,
      colorUndertone: product.colorUndertone ?? null,
      multicolor: product.multicolor ?? null,
      seasonalPalette: product.seasonalPalette ?? null,
      enrichedColor: product.enrichedColor ?? null,
      
      // Demographics
      ageGroup: product.ageGroup ?? null,
    };
  }
  
  // Infer related attributes to boost matching
  // Normalize constraints to old format for inferRelatedAttributes (it expects old format)
  const normalizedConstraints = hasIntentFormat(constraints as any)
    ? flattenConstraintsWithIntent(constraints as unknown as QueryConstraintsWithIntent)
    : constraints as QueryConstraintsOld;
  const relatedAttributes = inferRelatedAttributes(normalizedConstraints);
  
  // Create enhanced constraints - preserve intent format if original had it
  const enhancedConstraints = (hasIntentFormat(constraints as any)
    ? {
        ...(constraints as unknown as QueryConstraintsWithIntent),
        // Merge related attributes (only if not already present) - convert to intent format
        styles: (constraints as unknown as QueryConstraintsWithIntent).styles || (relatedAttributes.styles ? {
          values: relatedAttributes.styles,
          intent: 'preferred' as ConstraintIntent,
        } : undefined),
        materials: (constraints as unknown as QueryConstraintsWithIntent).materials || (relatedAttributes.materials ? {
          values: relatedAttributes.materials,
          intent: 'preferred' as ConstraintIntent,
        } : undefined),
        occasions: (constraints as unknown as QueryConstraintsWithIntent).occasions || (relatedAttributes.occasions ? {
          values: relatedAttributes.occasions,
          intent: 'preferred' as ConstraintIntent,
        } : undefined),
        seasons: (constraints as unknown as QueryConstraintsWithIntent).seasons || (relatedAttributes.seasons ? {
          values: relatedAttributes.seasons,
          intent: 'preferred' as ConstraintIntent,
        } : undefined),
      }
    : {
        ...constraints,
        // Merge related attributes (only if not already present) - old format
        styles: (constraints as QueryConstraintsOld).styles || relatedAttributes.styles,
        materials: (constraints as QueryConstraintsOld).materials || relatedAttributes.materials,
        occasions: (constraints as QueryConstraintsOld).occasions || relatedAttributes.occasions,
        seasons: (constraints as QueryConstraintsOld).seasons || relatedAttributes.seasons,
      }) as FashionConstraints | QueryConstraintsWithIntent;
  
  // Extract category from product for category-specific weight adjustment
  const productCategory = 'category' in product ? product.category : undefined;
  
  const scores: number[] = [];
  const weights: number[] = []; // Track actual weights for proper weighted average calculation
  const scoreDetails: Record<string, { queryValue: any; productValue: any; score: number; weighted: number }> = {};
  
  // Age Group (HIGHEST priority - critical for filtering kids vs adult products)
  // Priority: database column (ageGroup) first, then JSONB attributes, then inference
  if (enhancedConstraints.ageGroups) {
    // Priority 1: Check ageGroup column from database
    let productAgeGroup: string | string[] | undefined = enriched?.ageGroup ?? undefined;
    
    // Priority 2: Fallback to JSONB attributes
    if (!productAgeGroup) {
      productAgeGroup = extractAttrValue(attrs, 'ageGroup');
    }
    
    const ageGroupScore = calculateMatchScoreWithIntent(
      product,
      enhancedConstraints.ageGroups,
      (productItem, constraintAgeGroups) => {
        // Pass enriched columns to matchAgeGroup so it can check database column first
        return matchAgeGroup(
        productItem as SearchResultItem | { attributes?: ProductAttributes | null },
          constraintAgeGroups,
          enriched // Pass enriched columns (includes ageGroup from database)
    );
      }
    );
    const baseWeight = getDynamicWeight('ageGroups', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.ageGroups));
    const finalWeight = baseWeight * intentWeight;
    const weighted = ageGroupScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    
    // Get final product ageGroup value for logging (check all sources)
    let finalProductAgeGroup: string | string[] | undefined = productAgeGroup;
    if (!finalProductAgeGroup && 'title' in product) {
      // Infer from product metadata
      const productForInference = {
        title: (product as any).title,
        description: (product as any).description,
        category: (product as any).category,
        subcategory: (product as any).subcategory,
        attributes: attrs,
      };
      const inferred = inferAgeGroupFromProduct(productForInference);
      if (inferred) {
        finalProductAgeGroup = inferred;
      }
    }
    
    scoreDetails.ageGroups = {
      queryValue: extractConstraintValues(enhancedConstraints.ageGroups) || enhancedConstraints.ageGroups,
      productValue: finalProductAgeGroup || 'none',
      score: ageGroupScore,
      weighted,
    };
  }
  
  // Color (second highest priority)
  // Priority: database columns (color, enrichedColor) first, then JSONB attributes
  if (enhancedConstraints.colors) {
    // Priority 1: Check database columns (color, enrichedColor)
    const dbColor = enriched?.color ?? null;
    const dbEnrichedColor = enriched?.enrichedColor ?? null;
    // Priority 2: Fallback to JSONB attributes
    const attrColor = extractAttrValue(attrs, 'color');
    const attrEnrichedColor = (attrs as any)?.enriched_color ?? null;
    
    const finalColor = dbColor || attrColor;
    const finalEnrichedColor = dbEnrichedColor || attrEnrichedColor;
    
    const colorScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.colors,
      (productAttrs, constraintColors) => matchColor(productAttrs, constraintColors, enriched)
    );
    const baseWeight = getDynamicWeight('colors', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.colors));
    const finalWeight = baseWeight * intentWeight;
    const weighted = colorScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.colors = {
      queryValue: extractConstraintValues(enhancedConstraints.colors) || enhancedConstraints.colors,
      productValue: finalEnrichedColor || finalColor || 'none',
      score: colorScore,
      weighted,
    };
  }
  
  // Size (third priority)
  if (enhancedConstraints.sizes) {
    const productSizes = extractAttrValue(attrs, 'sizes') || extractAttrValue(attrs, 'size');
    const sizeScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.sizes,
      (productAttrs, constraintSizes) => matchSize(productAttrs, constraintSizes)
    );
    const baseWeight = getDynamicWeight('sizes', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.sizes));
    const finalWeight = baseWeight * intentWeight;
    const weighted = sizeScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.sizes = {
      queryValue: extractConstraintValues(enhancedConstraints.sizes) || enhancedConstraints.sizes,
      productValue: productSizes,
      score: sizeScore,
      weighted,
    };
  }
  
  // Occasion (fourth priority - but dynamic weight based on context)
  if (enhancedConstraints.occasions) {
    const productOccasion = enrichedColumns?.occasion || extractAttrValue(attrs, 'occasion');
    const occasionScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.occasions,
      (productAttrs, constraintOccasions) => {
        const productForMatching = 'title' in product ? {
          title: (product as any).title,
          description: (product as any).description,
          category: (product as any).category,
          subcategory: (product as any).subcategory,
          attributes: productAttrs,
        } : undefined;
        return matchOccasion(productAttrs, constraintOccasions, productForMatching, enrichedColumns);
      }
    );
    const baseWeight = getDynamicWeight('occasions', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.occasions));
    const finalWeight = baseWeight * intentWeight;
    const weighted = occasionScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    
    // Get product occasion value for logging (check all sources)
    let productOccasionValue: string | string[] | undefined;
    if (enrichedColumns?.occasionContext && enrichedColumns.occasionContext.length > 0) {
      productOccasionValue = enrichedColumns.occasionContext;
    } else if (enrichedColumns?.occasion) {
      productOccasionValue = enrichedColumns.occasion;
    } else if (productOccasion) {
      productOccasionValue = Array.isArray(productOccasion) ? productOccasion : [productOccasion];
    }
    
    // If still no occasion found, infer from product metadata
    if (!productOccasionValue && 'title' in product) {
      const productForInference = {
        title: (product as any).title,
        description: (product as any).description,
        category: (product as any).category,
        subcategory: (product as any).subcategory,
        attributes: attrs,
      };
      const inferred = inferOccasionFromProduct(productForInference);
      if (inferred.length > 0) {
        productOccasionValue = inferred;
      }
    }
    
    scoreDetails.occasions = {
      queryValue: extractConstraintValues(enhancedConstraints.occasions) || enhancedConstraints.occasions,
      productValue: productOccasionValue || 'none',
      score: occasionScore,
      weighted,
    };
  }
  
  // Style/Pattern (fourth priority)
  // Priority: database column (silhouetteCut) first, then style_labels attribute, then style attribute, then infer from product metadata
  if (enhancedConstraints.styles) {
    // Priority 1: Check silhouetteCut column from database (matches dictionary extraction source)
    let productStyle: string | string[] | null = null;
    if (enriched?.silhouetteCut) {
      productStyle = enriched.silhouetteCut;
    }
    // Priority 2: Check style_labels attribute (matches dictionary extraction source)
    if (!productStyle) {
      const styleLabels = extractAttrValue(attrs, 'style_labels') || extractAttrValue(attrs, 'styleLabels');
      productStyle = styleLabels ?? null;
    }
    // Priority 3: Check style/Style attribute
    if (!productStyle) {
      const styleAttr = extractAttrValue(attrs, 'style') || extractAttrValue(attrs, 'Style');
      productStyle = styleAttr ?? null;
    }
    // Priority 4: If no explicit style, infer from product metadata (collection, styleTags, title)
    if (!productStyle && 'title' in product) {
      const productForInference = {
        title: (product as any).title,
        description: (product as any).description,
        category: (product as any).category,
        subcategory: (product as any).subcategory,
        attributes: attrs,
      };
      const inferredStyles = inferStyleFromProduct(productForInference);
      if (inferredStyles.length > 0) {
        productStyle = inferredStyles;
      }
    }
    
    const styleScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.styles,
      (productAttrs, constraintStyles) => {
        const productForMatching = 'title' in product ? {
          title: (product as any).title,
          description: (product as any).description,
          category: (product as any).category,
          subcategory: (product as any).subcategory,
          attributes: productAttrs,
        } : undefined;
        return matchStyle(productAttrs, constraintStyles, productForMatching, enriched);
      }
    );
    const baseWeight = getDynamicWeight('styles', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.styles));
    const finalWeight = baseWeight * intentWeight;
    const weighted = styleScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.styles = {
      queryValue: extractConstraintValues(enhancedConstraints.styles) || enhancedConstraints.styles,
      productValue: productStyle || 'none',
      score: styleScore,
      weighted,
    };
  }
  
  if (enhancedConstraints.patterns) {
    // Extract pattern for logging/debugging (check multiple attribute key variations)
    const productPattern = extractAttrValue(attrs, 'pattern') || 
                           extractAttrValue(attrs, 'Pattern') ||
                           extractAttrValue(attrs, 'pattern_print') ||
                           extractAttrValue(attrs, 'patternPrint');
    const patternScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.patterns,
      (productAttrs, constraintPatterns) => matchPattern(productAttrs, constraintPatterns)
    );
    const baseWeight = getDynamicWeight('patterns', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.patterns));
    const finalWeight = baseWeight * intentWeight;
    const weighted = patternScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.patterns = {
      queryValue: extractConstraintValues(enhancedConstraints.patterns) || enhancedConstraints.patterns,
      productValue: productPattern,
      score: patternScore,
      weighted,
    };
  }
  
  // Season (fifth priority - dynamic weight)
  // Priority: database column (season) first, then JSONB attributes
  if (enhancedConstraints.seasons) {
    // Priority 1: Check season column from database
    const dbSeason = enriched?.season ?? null;
    // Priority 2: Fallback to JSONB attributes
    const attrSeason = extractAttrValue(attrs, 'season') || extractAttrValue(attrs, 'Season');
    const finalSeason = dbSeason || attrSeason;
    
    const seasonScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.seasons,
      (productAttrs, constraintSeasons) => matchSeason(productAttrs, constraintSeasons, enriched)
    );
    const baseWeight = getDynamicWeight('seasons', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.seasons));
    const finalWeight = baseWeight * intentWeight;
    const weighted = seasonScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.seasons = {
      queryValue: extractConstraintValues(enhancedConstraints.seasons) || enhancedConstraints.seasons,
      productValue: finalSeason || 'none',
      score: seasonScore,
      weighted,
    };
  }
  
  // Material/Fit (lower priority - but dynamic weight when explicitly mentioned)
  // Priority: database columns (material, fabric) first, then JSONB attributes
  if (enhancedConstraints.materials) {
    // Priority 1: Check material/fabric columns from database
    const dbMaterial = enriched?.material ?? null;
    const dbFabric = enriched?.fabric ?? null;
    // Priority 2: Fallback to JSONB attributes
    const attrMaterial = extractAttrValue(attrs, 'material') || extractAttrValue(attrs, 'Material') || extractAttrValue(attrs, 'fabric');
    const finalMaterial = dbMaterial || dbFabric || attrMaterial;
    
    const materialScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.materials,
      (productAttrs, constraintMaterials) => matchMaterial(productAttrs, constraintMaterials, enriched)
    );
    const baseWeight = getDynamicWeight('materials', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.materials));
    const finalWeight = baseWeight * intentWeight;
    const weighted = materialScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.materials = {
      queryValue: extractConstraintValues(enhancedConstraints.materials) || enhancedConstraints.materials,
      productValue: finalMaterial || 'none',
      score: materialScore,
      weighted,
    };
  }
  
  // Priority: database column (fit) first, then JSONB attributes
  if (enhancedConstraints.fits) {
    // Priority 1: Check fit column from database
    const dbFit = enriched?.fit ?? null;
    // Priority 2: Fallback to JSONB attributes
    const attrFit = extractAttrValue(attrs, 'fit') || extractAttrValue(attrs, 'Fit');
    const finalFit = dbFit || attrFit;
    
    const fitScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.fits,
      (productAttrs, constraintFits) => matchFit(productAttrs, constraintFits, enriched)
    );
    const baseWeight = getDynamicWeight('fits', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.fits));
    const finalWeight = baseWeight * intentWeight;
    const weighted = fitScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.fits = {
      queryValue: extractConstraintValues(enhancedConstraints.fits) || enhancedConstraints.fits,
      productValue: finalFit || 'none',
      score: fitScore,
      weighted,
    };
  }
  
  // Rises (for jeans/pants - new attribute with dynamic weight)
  // Priority: database column (riseWaist) first, then JSONB attributes
  if (enhancedConstraints.rises) {
    // Priority 1: Check riseWaist column from database
    const dbRise = enriched?.riseWaist ?? null;
    // Priority 2: Fallback to JSONB attributes
    const attrRise = extractAttrValue(attrs, 'riseWaist') || 
                     extractAttrValue(attrs, 'RiseWaist') ||
                     extractAttrValue(attrs, 'rise') ||
                     extractAttrValue(attrs, 'Rise');
    const finalRise = dbRise || attrRise;
    
    const riseScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.rises,
      (productAttrs, constraintRises) => matchRise(productAttrs, constraintRises, enriched)
    );
    const baseWeight = getDynamicWeight('rises', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.rises));
    const finalWeight = baseWeight * intentWeight;
    const weighted = riseScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.rises = {
      queryValue: extractConstraintValues(enhancedConstraints.rises) || enhancedConstraints.rises,
      productValue: finalRise || 'none',
      score: riseScore,
      weighted,
    };
  }
  
  // Length (for dresses - new attribute with dynamic weight)
  // Priority: database column (length) first, then JSONB attributes
  if (enhancedConstraints.lengths) {
    // Priority 1: Check length column from database
    const dbLength = enriched?.length ?? null;
    // Priority 2: Fallback to JSONB attributes
    const attrLength = extractAttrValue(attrs, 'length') || extractAttrValue(attrs, 'Length');
    const finalLength = dbLength || attrLength;
    
    const lengthScore = calculateMatchScoreWithIntent(
      finalLength,
      enhancedConstraints.lengths,
      (productValue, constraintValues) => fuzzyMatch(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('lengths', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.lengths));
    const finalWeight = baseWeight * intentWeight;
    const weighted = lengthScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.lengths = {
      queryValue: extractConstraintValues(enhancedConstraints.lengths) || enhancedConstraints.lengths,
      productValue: finalLength || 'none',
      score: lengthScore,
      weighted,
    };
  }
  
  // Neckline (new attribute with dynamic weight)
  // Priority: database column (neckline) first, then JSONB attributes
  if (enhancedConstraints.necklines) {
    // Priority 1: Check neckline column from database
    const dbNeckline = enriched?.neckline ?? ('neckline' in product && product.neckline ? product.neckline : null);
    // Priority 2: Fallback to JSONB attributes
    const attrNeckline = extractAttrValue(attrs, 'neckline') || extractAttrValue(attrs, 'Neckline');
    const finalNeckline = dbNeckline || attrNeckline;
    
    const necklineScore = calculateMatchScoreWithIntent(
      finalNeckline,
      enhancedConstraints.necklines,
      (productValue, constraintValues) => fuzzyMatch(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('necklines', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.necklines));
    const finalWeight = baseWeight * intentWeight;
    const weighted = necklineScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.necklines = {
      queryValue: extractConstraintValues(enhancedConstraints.necklines) || enhancedConstraints.necklines,
      productValue: finalNeckline || 'none',
      score: necklineScore,
      weighted,
    };
  }
  
  // Sleeve Length (new attribute with dynamic weight)
  // Priority: database column (sleeve) first, then JSONB attributes
  if (enhancedConstraints.sleeveLengths) {
    // Priority 1: Check sleeve column from database
    const dbSleeve = enriched?.sleeve ?? ('sleeve' in product && product.sleeve ? product.sleeve : null);
    // Priority 2: Fallback to JSONB attributes
    const attrSleeveLength = extractAttrValue(attrs, 'sleeveLength') || extractAttrValue(attrs, 'Sleeve Length') || extractAttrValue(attrs, 'sleeve');
    const finalSleeveLength = dbSleeve || attrSleeveLength;
    
    const sleeveLengthScore = calculateMatchScoreWithIntent(
      finalSleeveLength,
      enhancedConstraints.sleeveLengths,
      (productValue, constraintValues) => fuzzyMatch(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('sleeveLengths', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.sleeveLengths));
    const finalWeight = baseWeight * intentWeight;
    const weighted = sleeveLengthScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.sleeveLengths = {
      queryValue: extractConstraintValues(enhancedConstraints.sleeveLengths) || enhancedConstraints.sleeveLengths,
      productValue: finalSleeveLength || 'none',
      score: sleeveLengthScore,
      weighted,
    };
  }
  
  // Collection (lower priority)
  if (enhancedConstraints.collections) {
    const productCollection = extractAttrValue(attrs, 'collection') || extractAttrValue(attrs, 'Collection');
    const collectionScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.collections,
      (productAttrs, constraintValues) => matchCollection(productAttrs, constraintValues)
    );
    const baseWeight = getDynamicWeight('collections', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.collections));
    const finalWeight = baseWeight * intentWeight;
    const weighted = collectionScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.collections = {
      queryValue: extractConstraintValues(enhancedConstraints.collections) || enhancedConstraints.collections,
      productValue: productCollection,
      score: collectionScore,
      weighted,
    };
  }
  
  // Embellishments (lower priority)
  if (enhancedConstraints.embellishments) {
    const productEmbellishments = extractAttrValue(attrs, 'embellishments') || extractAttrValue(attrs, 'Embellishments');
    const embellishmentsScore = calculateMatchScoreWithIntent(
      attrs,
      enhancedConstraints.embellishments,
      (productAttrs, constraintValues) => matchEmbellishments(productAttrs, constraintValues)
    );
    const baseWeight = getDynamicWeight('embellishments', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.embellishments));
    const finalWeight = baseWeight * intentWeight;
    const weighted = embellishmentsScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.embellishments = {
      queryValue: extractConstraintValues(enhancedConstraints.embellishments) || enhancedConstraints.embellishments,
      productValue: productEmbellishments,
      score: embellishmentsScore,
      weighted,
    };
  }
  
  // Price (lower priority - hard constraint but less weight for ranking)
  // Convert null to undefined for matchPrice (null = explicitly removed, undefined = not set)
  // Extract values from price constraints (handle both old and new formats)
  const priceMinRaw = enhancedConstraints.priceMinCents === null ? undefined : enhancedConstraints.priceMinCents;
  const priceMaxRaw = enhancedConstraints.priceMaxCents === null ? undefined : enhancedConstraints.priceMaxCents;
  const priceMin: number | undefined = typeof priceMinRaw === 'object' && priceMinRaw !== null && 'value' in priceMinRaw
    ? (priceMinRaw as any).value as number
    : (typeof priceMinRaw === 'number' ? priceMinRaw : undefined);
  const priceMax: number | undefined = typeof priceMaxRaw === 'object' && priceMaxRaw !== null && 'value' in priceMaxRaw
    ? (priceMaxRaw as any).value as number
    : (typeof priceMaxRaw === 'number' ? priceMaxRaw : undefined);
  if (priceMin !== undefined || priceMax !== undefined) {
    const priceScore = matchPrice(product.priceCents, priceMin, priceMax);
    const baseWeight = getDynamicWeight('price', queryContext, productCategory, enhancedConstraints);
    // Extract intent from price constraints if available
    const priceMinIntent = typeof priceMinRaw === 'object' && priceMinRaw !== null && 'intent' in priceMinRaw
      ? priceMinRaw.intent
      : undefined;
    const priceMaxIntent = typeof priceMaxRaw === 'object' && priceMaxRaw !== null && 'intent' in priceMaxRaw
      ? priceMaxRaw.intent
      : undefined;
    // Use the stronger intent if both are present
    const intentWeight = getIntentWeight((priceMinIntent || priceMaxIntent) || null);
    const finalWeight = baseWeight * intentWeight;
    const weighted = priceScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.price = {
      queryValue: { min: priceMin, max: priceMax },
      productValue: product.priceCents,
      score: priceScore,
      weighted,
    };
  }
  
  // Enriched attributes: formality level
  const formalityLevelValues = extractConstraintValues(enhancedConstraints.formalityLevel);
  if (formalityLevelValues && formalityLevelValues.length > 0) {
    const formalityValue = enriched?.formalityLevel ?? extractAttrValue(attrs, 'formalityLevel');
    const formalityScore = calculateMatchScoreWithIntent(
      formalityValue,
      enhancedConstraints.formalityLevel,
      (productValue, constraintValues) => matchFormalityLevel(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('formalityLevel', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.formalityLevel));
    const finalWeight = baseWeight * intentWeight;
    const weighted = formalityScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.formalityLevel = {
      queryValue: formalityLevelValues,
      productValue: formalityValue,
      score: formalityScore,
      weighted,
    };
  }
  
  // Enriched attributes: temperature intent
  const temperatureIntentRaw = enhancedConstraints.temperatureIntent;
  const temperatureIntentValue: string | undefined = typeof temperatureIntentRaw === 'object' && temperatureIntentRaw !== null && 'value' in temperatureIntentRaw
    ? (temperatureIntentRaw as any).value as string
    : (typeof temperatureIntentRaw === 'string' ? temperatureIntentRaw : undefined);
  if (temperatureIntentValue) {
    const tempValue = enriched?.temperatureIntent ?? extractAttrValue(attrs, 'temperatureIntent');
    const tempScore = matchTemperatureIntent(
      Array.isArray(tempValue) ? tempValue[0] : tempValue,
      temperatureIntentValue
    );
    const baseWeight = getDynamicWeight('temperatureIntent', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.temperatureIntent));
    const finalWeight = baseWeight * intentWeight;
    const weighted = tempScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.temperatureIntent = {
      queryValue: temperatureIntentValue,
      productValue: tempValue,
      score: tempScore,
      weighted,
    };
  }
  
  // Enriched attributes: humidity friendly
  const humidityFriendlyRaw = enhancedConstraints.humidityFriendly;
  const humidityFriendlyValue: boolean | undefined = typeof humidityFriendlyRaw === 'object' && humidityFriendlyRaw !== null && 'value' in humidityFriendlyRaw
    ? (humidityFriendlyRaw as any).value as boolean
    : (typeof humidityFriendlyRaw === 'boolean' ? humidityFriendlyRaw : undefined);
  if (humidityFriendlyValue !== undefined && humidityFriendlyValue !== null) {
    const humidityValue = enriched?.humidityFriendly ?? (attrs as any).humidityFriendly;
    const humidityScore = matchHumidityFriendly(
      typeof humidityValue === 'boolean' ? humidityValue : undefined,
      humidityFriendlyValue
    );
    const baseWeight = getDynamicWeight('humidityFriendly', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.humidityFriendly));
    const finalWeight = baseWeight * intentWeight;
    const weighted = humidityScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.humidityFriendly = {
      queryValue: humidityFriendlyValue,
      productValue: humidityValue,
      score: humidityScore,
      weighted,
    };
  }
  
  // Enriched attributes: occasion context
  const occasionContextValues = extractConstraintValues(enhancedConstraints.occasionContext);
  if (occasionContextValues && occasionContextValues.length > 0) {
    const occasionContextValue = enriched?.occasionContext ?? extractAttrValue(attrs, 'occasionContext');
    const occasionContextScore = calculateMatchScoreWithIntent(
      Array.isArray(occasionContextValue) ? occasionContextValue : undefined,
      enhancedConstraints.occasionContext,
      (productValue, constraintValues) => matchOccasionContext(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('occasionContext', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.occasionContext));
    const finalWeight = baseWeight * intentWeight;
    const weighted = occasionContextScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.occasionContext = {
      queryValue: occasionContextValues,
      productValue: occasionContextValue,
      score: occasionContextScore,
      weighted,
    };
  }
  
  // Enriched attributes: problem solutions
  const problemSolutionsValues = extractConstraintValues(enhancedConstraints.problemSolutions);
  if (problemSolutionsValues && problemSolutionsValues.length > 0) {
    const problemSolutionsValue = enriched?.problemSolutions ?? extractAttrValue(attrs, 'problemSolutions');
    const problemSolutionsScore = calculateMatchScoreWithIntent(
      Array.isArray(problemSolutionsValue) ? problemSolutionsValue : undefined,
      enhancedConstraints.problemSolutions,
      (productValue, constraintValues) => matchProblemSolutions(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('problemSolutions', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.problemSolutions));
    const finalWeight = baseWeight * intentWeight;
    const weighted = problemSolutionsScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.problemSolutions = {
      queryValue: problemSolutionsValues,
      productValue: problemSolutionsValue,
      score: problemSolutionsScore,
      weighted,
    };
  }
  
  // Enriched attributes: function features
  const functionFeaturesValues = extractConstraintValues(enhancedConstraints.functionFeatures);
  if (functionFeaturesValues && functionFeaturesValues.length > 0) {
    const functionFeaturesValue = enriched?.functionFeatures ?? extractAttrValue(attrs, 'functionFeatures');
    const functionFeaturesScore = calculateMatchScoreWithIntent(
      Array.isArray(functionFeaturesValue) ? functionFeaturesValue : undefined,
      enhancedConstraints.functionFeatures,
      (productValue, constraintValues) => matchFunctionFeatures(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('functionFeatures', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.functionFeatures));
    const finalWeight = baseWeight * intentWeight;
    const weighted = functionFeaturesScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.functionFeatures = {
      queryValue: functionFeaturesValues,
      productValue: functionFeaturesValue,
      score: functionFeaturesScore,
      weighted,
    };
  }
  
  // Enriched attributes: color shade
  const colorShadeValues = extractConstraintValues(enhancedConstraints.colorShade);
  if (colorShadeValues && colorShadeValues.length > 0) {
    const colorShadeValue = enriched?.colorShade ?? extractAttrValue(attrs, 'colorShade');
    const colorShadeScore = calculateMatchScoreWithIntent(
      Array.isArray(colorShadeValue) ? colorShadeValue[0] : colorShadeValue,
      enhancedConstraints.colorShade,
      (productValue, constraintValues) => matchColorShade(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('colorShade', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.colorShade));
    const finalWeight = baseWeight * intentWeight;
    const weighted = colorShadeScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.colorShade = {
      queryValue: colorShadeValues,
      productValue: colorShadeValue,
      score: colorShadeScore,
      weighted,
    };
  }
  
  // Enriched attributes: color undertone
  const colorUndertoneValues = extractConstraintValues(enhancedConstraints.colorUndertone);
  if (colorUndertoneValues && colorUndertoneValues.length > 0) {
    const colorUndertoneValue = enriched?.colorUndertone ?? extractAttrValue(attrs, 'colorUndertone');
    const colorUndertoneScore = calculateMatchScoreWithIntent(
      Array.isArray(colorUndertoneValue) ? colorUndertoneValue[0] : colorUndertoneValue,
      enhancedConstraints.colorUndertone,
      (productValue, constraintValues) => matchColorUndertone(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('colorUndertone', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.colorUndertone));
    const finalWeight = baseWeight * intentWeight;
    const weighted = colorUndertoneScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.colorUndertone = {
      queryValue: colorUndertoneValues,
      productValue: colorUndertoneValue,
      score: colorUndertoneScore,
      weighted,
    };
  }
  
  // Enriched attributes: multicolor
  const multicolorRaw = enhancedConstraints.multicolor;
  const multicolorValue: boolean | undefined = typeof multicolorRaw === 'object' && multicolorRaw !== null && 'value' in multicolorRaw
    ? (multicolorRaw as any).value as boolean
    : (typeof multicolorRaw === 'boolean' ? multicolorRaw : undefined);
  if (multicolorValue !== undefined && multicolorValue !== null) {
    const productMulticolorValue = enriched?.multicolor ?? (attrs as any).multicolor;
    const multicolorScore = matchMulticolor(
      typeof productMulticolorValue === 'boolean' ? productMulticolorValue : undefined,
      multicolorValue
    );
    const baseWeight = getDynamicWeight('multicolor', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.multicolor));
    const finalWeight = baseWeight * intentWeight;
    const weighted = multicolorScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.multicolor = {
      queryValue: multicolorValue,
      productValue: productMulticolorValue,
      score: multicolorScore,
      weighted,
    };
  }
  
  // Enriched attributes: seasonal palette
  const seasonalPaletteValues = extractConstraintValues(enhancedConstraints.seasonalPalette);
  if (seasonalPaletteValues && seasonalPaletteValues.length > 0) {
    const seasonalPaletteValue = enriched?.seasonalPalette ?? extractAttrValue(attrs, 'seasonalPalette');
    const seasonalPaletteScore = calculateMatchScoreWithIntent(
      Array.isArray(seasonalPaletteValue) ? seasonalPaletteValue[0] : seasonalPaletteValue,
      enhancedConstraints.seasonalPalette,
      (productValue, constraintValues) => matchSeasonalPalette(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('seasonalPalette', queryContext, productCategory, enhancedConstraints);
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.seasonalPalette));
    const finalWeight = baseWeight * intentWeight;
    const weighted = seasonalPaletteScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.seasonalPalette = {
      queryValue: seasonalPaletteValues,
      productValue: seasonalPaletteValue,
      score: seasonalPaletteScore,
      weighted,
    };
  }
  
  // Care requirements
  const careRequirementsValues = extractConstraintValues(enhancedConstraints.careRequirements);
  if (careRequirementsValues && careRequirementsValues.length > 0) {
    const productCare = extractAttrValue(attrs, 'care_requirements');
    const careScore = calculateMatchScoreWithIntent(
      productCare,
      enhancedConstraints.careRequirements,
      (productValue, constraintValues) => matchStringArray(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('materials', queryContext, productCategory, enhancedConstraints) * 0.6; // Lower weight than materials
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.careRequirements));
    const finalWeight = baseWeight * intentWeight;
    const weighted = careScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.careRequirements = {
      queryValue: careRequirementsValues,
      productValue: productCare,
      score: careScore,
      weighted,
    };
  }
  
  // Rain/wind (weather resistance)
  const rainWindRaw = enhancedConstraints.rainWind;
  const rainWindValue: string | undefined = typeof rainWindRaw === 'object' && rainWindRaw !== null && 'value' in rainWindRaw
    ? (rainWindRaw as any).value as string
    : (typeof rainWindRaw === 'string' ? rainWindRaw : undefined);
  if (rainWindValue) {
    const productRainWind = extractAttrValue(attrs, 'rain_wind');
    const rainWindScore = matchString(productRainWind, rainWindValue);
    const baseWeight = getDynamicWeight('temperatureIntent', queryContext, productCategory, enhancedConstraints) * 0.7;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.rainWind));
    const finalWeight = baseWeight * intentWeight;
    const weighted = rainWindScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.rainWind = {
      queryValue: rainWindValue,
      productValue: productRainWind,
      score: rainWindScore,
      weighted,
    };
  }
  
  // Travel features
  const travelFeaturesValues = extractConstraintValues(enhancedConstraints.travelFeatures);
  if (travelFeaturesValues && travelFeaturesValues.length > 0) {
    const productTravel = extractAttrValue(attrs, 'travel_features');
    const travelScore = calculateMatchScoreWithIntent(
      productTravel,
      enhancedConstraints.travelFeatures,
      (productValue, constraintValues) => matchStringArray(productValue, constraintValues)
    );
    const baseWeight = getDynamicWeight('functionFeatures', queryContext, productCategory, enhancedConstraints) * 0.8;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.travelFeatures));
    const finalWeight = baseWeight * intentWeight;
    const weighted = travelScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.travelFeatures = {
      queryValue: travelFeaturesValues,
      productValue: productTravel,
      score: travelScore,
      weighted,
    };
  }
  
  // Pockets
  const pocketsRaw = enhancedConstraints.pockets;
  const pocketsValue: string | undefined = typeof pocketsRaw === 'object' && pocketsRaw !== null && 'value' in pocketsRaw
    ? (pocketsRaw as any).value as string
    : (typeof pocketsRaw === 'string' ? pocketsRaw : undefined);
  if (pocketsValue) {
    const productPockets = extractAttrValue(attrs, 'pockets');
    const pocketsScore = matchString(productPockets, pocketsValue);
    const baseWeight = getDynamicWeight('functionFeatures', queryContext, productCategory, enhancedConstraints) * 1.2; // High weight - frequently asked
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.pockets));
    const finalWeight = baseWeight * intentWeight;
    const weighted = pocketsScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.pockets = {
      queryValue: pocketsValue,
      productValue: productPockets,
      score: pocketsScore,
      weighted,
    };
  }
  
  // Lining type
  const liningTypeRaw = enhancedConstraints.liningType;
  const liningTypeValue: string | undefined = typeof liningTypeRaw === 'object' && liningTypeRaw !== null && 'value' in liningTypeRaw
    ? (liningTypeRaw as any).value as string
    : (typeof liningTypeRaw === 'string' ? liningTypeRaw : undefined);
  if (liningTypeValue) {
    const productLining = extractAttrValue(attrs, 'lining_type');
    const liningScore = matchString(productLining, liningTypeValue);
    const baseWeight = 0.4;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.liningType));
    const finalWeight = baseWeight * intentWeight;
    const weighted = liningScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.liningType = {
      queryValue: liningTypeValue,
      productValue: productLining,
      score: liningScore,
      weighted,
    };
  }
  
  // Bra solution
  const braSolutionRaw = enhancedConstraints.braSolution;
  const braSolutionValue: string | undefined = typeof braSolutionRaw === 'object' && braSolutionRaw !== null && 'value' in braSolutionRaw
    ? (braSolutionRaw as any).value as string
    : (typeof braSolutionRaw === 'string' ? braSolutionRaw : undefined);
  if (braSolutionValue) {
    const productBra = extractAttrValue(attrs, 'bra_solution');
    const braScore = matchString(productBra, braSolutionValue);
    const baseWeight = getDynamicWeight('functionFeatures', queryContext, productCategory, enhancedConstraints) * 0.9;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.braSolution));
    const finalWeight = baseWeight * intentWeight;
    const weighted = braScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.braSolution = {
      queryValue: braSolutionValue,
      productValue: productBra,
      score: braScore,
      weighted,
    };
  }
  
  // Eco materials
  const ecoMaterialsValues = extractConstraintValues(enhancedConstraints.ecoMaterials);
  if (ecoMaterialsValues && ecoMaterialsValues.length > 0) {
    const productEco = extractAttrValue(attrs, 'eco_materials');
    const ecoScore = calculateMatchScoreWithIntent(
      productEco,
      enhancedConstraints.ecoMaterials,
      (productValue, constraintValues) => matchStringArray(productValue, constraintValues)
    );
    const baseWeight = 0.7; // Important for sustainability-conscious shoppers
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.ecoMaterials));
    const finalWeight = baseWeight * intentWeight;
    const weighted = ecoScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.ecoMaterials = {
      queryValue: ecoMaterialsValues,
      productValue: productEco,
      score: ecoScore,
      weighted,
    };
  }
  
  // Certifications
  const certificationsRaw = enhancedConstraints.certifications;
  const certificationsValue: string | undefined = typeof certificationsRaw === 'object' && certificationsRaw !== null && 'value' in certificationsRaw
    ? (certificationsRaw as any).value as string
    : (typeof certificationsRaw === 'string' ? certificationsRaw : undefined);
  if (certificationsValue) {
    const productCert = extractAttrValue(attrs, 'certifications');
    const certScore = matchString(productCert, certificationsValue);
    const baseWeight = 0.8; // Important for certified products
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.certifications));
    const finalWeight = baseWeight * intentWeight;
    const weighted = certScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.certifications = {
      queryValue: certificationsValue,
      productValue: productCert,
      score: certScore,
      weighted,
    };
  }
  
  // Origin
  const originRaw = enhancedConstraints.origin;
  const originValue: string | undefined = typeof originRaw === 'object' && originRaw !== null && 'value' in originRaw
    ? (originRaw as any).value as string
    : (typeof originRaw === 'string' ? originRaw : undefined);
  if (originValue) {
    const productOrigin = extractAttrValue(attrs, 'origin');
    const originScore = matchString(productOrigin, originValue);
    const baseWeight = 0.5;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.origin));
    const finalWeight = baseWeight * intentWeight;
    const weighted = originScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.origin = {
      queryValue: originValue,
      productValue: productOrigin,
      score: originScore,
      weighted,
    };
  }
  
  // Adaptive features
  const adaptiveFeaturesRaw = enhancedConstraints.adaptiveFeatures;
  const adaptiveFeaturesValue: string | undefined = typeof adaptiveFeaturesRaw === 'object' && adaptiveFeaturesRaw !== null && 'value' in adaptiveFeaturesRaw
    ? (adaptiveFeaturesRaw as any).value as string
    : (typeof adaptiveFeaturesRaw === 'string' ? adaptiveFeaturesRaw : undefined);
  if (adaptiveFeaturesValue) {
    const productAdaptive = extractAttrValue(attrs, 'adaptive_features');
    const adaptiveScore = matchString(productAdaptive, adaptiveFeaturesValue);
    const baseWeight = 1.0; // Important for inclusivity
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.adaptiveFeatures));
    const finalWeight = baseWeight * intentWeight;
    const weighted = adaptiveScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.adaptiveFeatures = {
      queryValue: adaptiveFeaturesValue,
      productValue: productAdaptive,
      score: adaptiveScore,
      weighted,
    };
  }
  
  // Sensory friendly
  const sensoryFriendlyRaw = enhancedConstraints.sensoryFriendly;
  const sensoryFriendlyValue: string | undefined = typeof sensoryFriendlyRaw === 'object' && sensoryFriendlyRaw !== null && 'value' in sensoryFriendlyRaw
    ? (sensoryFriendlyRaw as any).value as string
    : (typeof sensoryFriendlyRaw === 'string' ? sensoryFriendlyRaw : undefined);
  if (sensoryFriendlyValue) {
    const productSensory = extractAttrValue(attrs, 'sensory_friendly');
    const sensoryScore = matchString(productSensory, sensoryFriendlyValue);
    const baseWeight = 1.0; // Important for inclusivity
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.sensoryFriendly));
    const finalWeight = baseWeight * intentWeight;
    const weighted = sensoryScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.sensoryFriendly = {
      queryValue: sensoryFriendlyValue,
      productValue: productSensory,
      score: sensoryScore,
      weighted,
    };
  }
  
  // Finish
  const finishRaw = enhancedConstraints.finish;
  const finishValue: string | undefined = typeof finishRaw === 'object' && finishRaw !== null && 'value' in finishRaw
    ? (finishRaw as any).value as string
    : (typeof finishRaw === 'string' ? finishRaw : undefined);
  if (finishValue) {
    const productFinish = extractAttrValue(attrs, 'finish');
    const finishScore = matchString(productFinish, finishValue);
    const baseWeight = 0.4;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.finish));
    const finalWeight = baseWeight * intentWeight;
    const weighted = finishScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.finish = {
      queryValue: finishValue,
      productValue: productFinish,
      score: finishScore,
      weighted,
    };
  }
  
  // Modesty cues
  const modestyCuesValues = extractConstraintValues(enhancedConstraints.modestyCues);
  if (modestyCuesValues && modestyCuesValues.length > 0) {
    const productModesty = extractAttrValue(attrs, 'modesty_cues');
    const modestyScore = calculateMatchScoreWithIntent(
      productModesty,
      enhancedConstraints.modestyCues,
      (productValue, constraintValues) => matchStringArray(productValue, constraintValues)
    );
    const baseWeight = 0.5;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.modestyCues));
    const finalWeight = baseWeight * intentWeight;
    const weighted = modestyScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.modestyCues = {
      queryValue: modestyCuesValues,
      productValue: productModesty,
      score: modestyScore,
      weighted,
    };
  }
  
  // Layering intent
  const layeringIntentRaw = enhancedConstraints.layeringIntent;
  const layeringIntentValue: string | undefined = typeof layeringIntentRaw === 'object' && layeringIntentRaw !== null && 'value' in layeringIntentRaw
    ? (layeringIntentRaw as any).value as string
    : (typeof layeringIntentRaw === 'string' ? layeringIntentRaw : undefined);
  if (layeringIntentValue) {
    const productLayering = extractAttrValue(attrs, 'layering_intent');
    const layeringScore = matchString(productLayering, layeringIntentValue);
    const baseWeight = 0.4;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.layeringIntent));
    const finalWeight = baseWeight * intentWeight;
    const weighted = layeringScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.layeringIntent = {
      queryValue: layeringIntentValue,
      productValue: productLayering,
      score: layeringScore,
      weighted,
    };
  }
  
  // Pairing intent
  const pairingIntentRaw = enhancedConstraints.pairingIntent;
  const pairingIntentValue: string | undefined = typeof pairingIntentRaw === 'object' && pairingIntentRaw !== null && 'value' in pairingIntentRaw
    ? (pairingIntentRaw as any).value as string
    : (typeof pairingIntentRaw === 'string' ? pairingIntentRaw : undefined);
  if (pairingIntentValue) {
    const productPairing = extractAttrValue(attrs, 'pairing_intent');
    const pairingScore = matchString(productPairing, pairingIntentValue);
    const baseWeight = 0.4;
    const intentWeight = getIntentWeight(extractConstraintIntent(enhancedConstraints.pairingIntent));
    const finalWeight = baseWeight * intentWeight;
    const weighted = pairingScore * finalWeight;
    scores.push(weighted);
    weights.push(finalWeight);
    scoreDetails.pairingIntent = {
      queryValue: pairingIntentValue,
      productValue: productPairing,
      score: pairingScore,
      weighted,
    };
  }
  
  // If no constraints, return 0 (shouldn't happen but safety check)
  if (scores.length === 0) return 0;
  
  // Calculate weighted average using actual weights (not count of non-zero scores)
  const sumScores = scores.reduce((sum, score) => sum + score, 0);
  const sumWeights = weights.reduce((sum, weight) => sum + weight, 0);
  if (sumWeights === 0) return 0;
  
  const finalScore = sumScores / sumWeights;
  
  // Log detailed matching info for first few products (to avoid log spam)
  // Also log when constraint score is 0 but constraints are provided (to debug why matching fails)
  const hasConstraintsButZeroScore = finalScore === 0 && Object.keys(constraints).some(k => {
    const val = constraints[k as keyof FashionConstraints];
    return val !== undefined && val !== null && (Array.isArray(val) ? val.length > 0 : true);
  });
  
  if (Math.random() < 0.1 || hasConstraintsButZeroScore) { // Log 10% of products OR products with constraints but 0 score
    // Get raw attribute structure for debugging
    const rawAttrs = 'attributes' in product ? product.attributes : (product as any).attributes;
    const attrsKeys = rawAttrs ? Object.keys(rawAttrs) : [];
    const attrsSample: Record<string, any> = {};
    if (rawAttrs) {
      // Sample first 10 keys to see structure
      attrsKeys.slice(0, 10).forEach(key => {
        attrsSample[key] = rawAttrs[key];
      });
    }
    
    logger.info('constraint_match_details', {
      productId: 'id' in product ? product.id : 'unknown',
      productTitle: productTitle?.substring(0, 100),
      finalScore,
      sumWeights,
      sumScores,
      scoreDetails,
      constraintsProvided: Object.keys(constraints).filter(k => constraints[k as keyof FashionConstraints] !== undefined && constraints[k as keyof FashionConstraints] !== null),
      queryContext: queryContext ? {
        queryType: queryContext.queryType,
        explicitMentions: queryContext.explicitMentions,
        originalQuery: queryContext.originalQuery?.substring(0, 100),
      } : undefined,
      rawAttributesKeys: attrsKeys,
      rawAttributesSample: attrsSample,
      hasExtensible: !!(rawAttrs && (rawAttrs as any).extensible),
      extensibleKeys: rawAttrs && (rawAttrs as any).extensible ? Object.keys((rawAttrs as any).extensible) : [],
      // Check what extractAttrValue actually found
      extractedColor: extractAttrValue(attrs, 'color'),
      extractedPattern: extractAttrValue(attrs, 'pattern'),
      extractedPatternCapitalized: extractAttrValue(attrs, 'Pattern'),
      extractedOccasion: extractAttrValue(attrs, 'occasion'),
      inferredOccasion: 'title' in product ? inferOccasionFromProduct({
        title: (product as any).title,
        description: (product as any).description,
        category: (product as any).category,
        subcategory: (product as any).subcategory,
        attributes: attrs,
      }) : undefined,
      extractedStyle: extractAttrValue(attrs, 'style') || extractAttrValue(attrs, 'Style'),
      inferredStyle: 'title' in product ? inferStyleFromProduct({
        title: (product as any).title,
        description: (product as any).description,
        category: (product as any).category,
        subcategory: (product as any).subcategory,
        attributes: attrs,
      }) : undefined,
      dynamicWeights: queryContext ? {
        occasions: getDynamicWeight('occasions', queryContext, productCategory, enhancedConstraints),
        materials: getDynamicWeight('materials', queryContext, productCategory, enhancedConstraints),
        seasons: getDynamicWeight('seasons', queryContext, productCategory, enhancedConstraints),
        fits: getDynamicWeight('fits', queryContext, productCategory, enhancedConstraints),
        lengths: getDynamicWeight('lengths', queryContext, productCategory, enhancedConstraints),
        styles: getDynamicWeight('styles', queryContext, productCategory, enhancedConstraints),
      } : undefined,
    });
  }
  
  return finalScore;
}
