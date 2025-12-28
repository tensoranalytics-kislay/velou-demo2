/**
 * Constraint Matching Utilities
 * 
 * Provides soft/fuzzy matching functions for comparing product attributes
 * with query constraints. Returns match confidence scores (0-1) rather than
 * hard boolean matches.
 */

import type { ProductAttributes } from '../../search/types';
import type { QueryConstraints } from '../query-parser';
import type { SearchResultItem } from '../../search/types';
import { logger } from '../../telemetry/logger';

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
 * Match color constraints
 * Handles color variations (e.g., "pink" matches "blush pink", "rose pink")
 */
export function matchColor(productAttrs: ProductAttributes | null | undefined, queryColors: string[] | undefined): number {
  if (!queryColors || queryColors.length === 0) return 0;
  
  const productColor = extractAttrValue(productAttrs, 'color');
  return fuzzyMatch(productColor, queryColors);
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
 * Infers occasions from product metadata if explicit attribute is not found
 */
export function matchOccasion(
  productAttrs: ProductAttributes | null | undefined,
  queryOccasions: string[] | undefined,
  product?: { title?: string; description?: string; category?: string; subcategory?: string; attributes?: ProductAttributes | null }
): number {
  if (!queryOccasions || queryOccasions.length === 0) return 0;
  
  // Try explicit attribute first
  const productOccasion = extractAttrValue(productAttrs, 'occasion');
  if (productOccasion) {
  return fuzzyMatch(productOccasion, queryOccasions);
  }
  
  // If no explicit attribute, infer from product metadata
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
 * Infers styles from product metadata if explicit attribute is not found
 */
export function matchStyle(
  productAttrs: ProductAttributes | null | undefined,
  queryStyles: string[] | undefined,
  product?: { title?: string; description?: string; category?: string; subcategory?: string; attributes?: ProductAttributes | null }
): number {
  if (!queryStyles || queryStyles.length === 0) return 0;
  
  // Try explicit attribute first
  const productStyle = extractAttrValue(productAttrs, 'style') || extractAttrValue(productAttrs, 'Style');
  if (productStyle) {
    return fuzzyMatch(productStyle, queryStyles);
  }
  
  // If no explicit attribute, infer from product metadata
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
 */
export function matchPattern(productAttrs: ProductAttributes | null | undefined, queryPatterns: string[] | undefined): number {
  if (!queryPatterns || queryPatterns.length === 0) return 0;
  
  const productPattern = extractAttrValue(productAttrs, 'pattern') || extractAttrValue(productAttrs, 'Pattern');
  return fuzzyMatch(productPattern, queryPatterns);
}

/**
 * Match season constraints
 */
export function matchSeason(productAttrs: ProductAttributes | null | undefined, querySeasons: string[] | undefined): number {
  if (!querySeasons || querySeasons.length === 0) return 0;
  
  const productSeason = extractAttrValue(productAttrs, 'season') || extractAttrValue(productAttrs, 'Season');
  return fuzzyMatch(productSeason, querySeasons);
}

/**
 * Match material constraints
 */
export function matchMaterial(productAttrs: ProductAttributes | null | undefined, queryMaterials: string[] | undefined): number {
  if (!queryMaterials || queryMaterials.length === 0) return 0;
  
  const productMaterial = extractAttrValue(productAttrs, 'material') || 
                          extractAttrValue(productAttrs, 'Material') ||
                          extractAttrValue(productAttrs, 'fabric');
  return fuzzyMatch(productMaterial, queryMaterials);
}

/**
 * Match fit constraints
 */
export function matchFit(productAttrs: ProductAttributes | null | undefined, queryFits: string[] | undefined): number {
  if (!queryFits || queryFits.length === 0) return 0;
  
  const productFit = extractAttrValue(productAttrs, 'fit') || extractAttrValue(productAttrs, 'Fit');
  return fuzzyMatch(productFit, queryFits);
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
 * Handles age variations (e.g., "kids" matches "children", "5-year-old" matches "kids")
 * Uses inferred ageGroup if explicit ageGroup is not present in product attributes
 */
export function matchAgeGroup(
  product: SearchResultItem | { attributes?: ProductAttributes | null },
  queryAgeGroups: string[] | undefined
): number {
  if (!queryAgeGroups || queryAgeGroups.length === 0) return 0;
  
  // Try to get explicit ageGroup first
  const productAttrs = 'attributes' in product ? product.attributes : (product as any).attributes;
  let productAgeGroup = extractAttrValue(productAttrs, 'ageGroup');
  
  // If no explicit ageGroup, infer from product data
  if (!productAgeGroup && 'title' in product) {
    const inferred = inferAgeGroupFromProduct(product as SearchResultItem);
    if (inferred) {
      productAgeGroup = [inferred];
    }
  }
  
  if (!productAgeGroup) return 0;
  
  const productAgeGroups = Array.isArray(productAgeGroup) ? productAgeGroup : [productAgeGroup];
  const normalizedQuery = queryAgeGroups.map(normalize);
  
  // Age group synonyms mapping with hierarchical relationships
  // "kids" is a broad category that includes: toddler, baby, and all ages 2-13+
  // "toddler" is a subset of "kids" (ages 2-4)
  // "baby" is a subset of "kids" (ages 0-2)
  // "adult" is separate from kids (ages 14+)
  const ageGroupSynonyms: Record<string, string[]> = {
    'kids': ['kids', 'children', 'child', 'kid', 'youth', 'junior', 'juniors', 'toddler', 'toddlers', 'baby', 'babies', 'infant', 'infants', 'preschool', 'elementary', 'teen', 'teens', 'teenager', 'teenagers'],
    'children': ['kids', 'children', 'child', 'kid', 'youth', 'junior', 'juniors', 'toddler', 'toddlers', 'baby', 'babies'],
    'child': ['kids', 'children', 'child', 'kid', 'youth', 'junior', 'juniors'],
    'kid': ['kids', 'children', 'child', 'kid', 'youth', 'junior', 'juniors'],
    'toddler': ['toddler', 'toddlers', 'kids', 'children', 'child', 'kid'], // toddler matches kids category
    'baby': ['baby', 'infant', 'babies', 'infants', 'kids', 'children'], // baby matches kids category
    'adult': ['adult', 'adults', 'women', 'womens', 'men', 'mens', 'ladies', 'gentlemen'],
  };
  
  // Check for exact matches first
  for (const pag of productAgeGroups) {
    const normalizedPag = normalize(pag);
    for (const qag of normalizedQuery) {
      // Exact match
      if (normalizedPag === qag) {
        return 1.0;
      }
      
      // Check synonyms (bidirectional)
      const productSynonyms = ageGroupSynonyms[normalizedPag] || [];
      const querySynonyms = ageGroupSynonyms[qag] || [];
      
      // If product ageGroup is in query synonyms, or query ageGroup is in product synonyms
      if (querySynonyms.includes(normalizedPag) || productSynonyms.includes(qag)) {
        return 1.0;
      }
      
      // Check hierarchy: if product is "kids" and query is "toddler", match (toddler is subset of kids)
      if (normalizedPag === 'kids' && (qag === 'toddler' || qag === 'baby')) {
        return 1.0;
      }
      
      // Check hierarchy: if product is "toddler" and query is "kids", match (toddler is in kids category)
      if ((normalizedPag === 'toddler' || normalizedPag === 'baby') && qag === 'kids') {
        return 1.0;
      }
      
      // Check if product value contains query value or vice versa
      if (normalizedPag.includes(qag) || qag.includes(normalizedPag)) {
        return 0.8;
      }
      
      // Check if query age group matches any synonym of product age group
      for (const syn of productSynonyms) {
        if (syn === qag || syn.includes(qag) || qag.includes(syn)) {
          return 0.8;
        }
      }
      
      // Check if product age group matches any synonym of query age group
      for (const syn of querySynonyms) {
        if (syn === normalizedPag || syn.includes(normalizedPag) || normalizedPag.includes(syn)) {
          return 0.8;
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
 * Infer related attributes based on constraints
 * Boosts related attributes to improve matching
 * NOTE: These are hints/suggestions, not strict requirements
 * Products matching these will get boosted, but products without them won't be penalized
 */
function inferRelatedAttributes(constraints: QueryConstraints): Partial<QueryConstraints> {
  const related: Partial<QueryConstraints> = {};
  
  // If occasion is "Wedding", boost formal styles and elegant materials
  // These are hints - products with these attributes will score higher
  if (constraints.occasions?.some(o => /wedding/i.test(o))) {
    if (!related.styles) related.styles = [];
    if (!related.materials) related.materials = [];
    // Wedding implies formal, elegant styles (but don't require them)
    if (!constraints.styles?.some(s => /formal|elegant|classic/i.test(s))) {
      related.styles.push('Formal', 'Elegant');
    }
    // Wedding implies elegant materials (silk, satin, lace) - but cotton/polyester dresses can still work
    // We add these as hints, but products without them won't be penalized (they just won't get the boost)
    if (!constraints.materials?.some(m => /silk|satin|lace/i.test(m))) {
      related.materials.push('Silk', 'Satin', 'Lace');
    }
  }
  
  // If occasion is "Beach", boost casual styles, light materials, summer season
  if (constraints.occasions?.some(o => /beach/i.test(o))) {
    if (!related.styles) related.styles = [];
    if (!related.materials) related.materials = [];
    if (!related.seasons) related.seasons = [];
    if (!constraints.styles?.some(s => /casual/i.test(s))) {
      related.styles.push('Casual');
    }
    if (!constraints.materials?.some(m => /cotton|linen|modal/i.test(m))) {
      related.materials.push('Cotton', 'Linen', 'Modal');
    }
    if (!constraints.seasons?.some(s => /summer/i.test(s))) {
      related.seasons.push('Summer');
    }
  }
  
  // If material is "Silk", boost formal occasions
  if (constraints.materials?.some(m => /silk/i.test(m))) {
    if (!related.occasions) related.occasions = [];
    if (!constraints.occasions?.some(o => /formal|wedding|evening/i.test(o))) {
      related.occasions.push('Formal', 'Evening', 'Wedding');
    }
  }
  
  // If season is "Winter", boost warm materials
  if (constraints.seasons?.some(s => /winter/i.test(s))) {
    if (!related.materials) related.materials = [];
    if (!constraints.materials?.some(m => /wool|cashmere|fleece/i.test(m))) {
      related.materials.push('Wool', 'Cashmere', 'Fleece');
    }
  }
  
  // If season is "Summer", boost light materials
  if (constraints.seasons?.some(s => /summer/i.test(s))) {
    if (!related.materials) related.materials = [];
    if (!constraints.materials?.some(m => /cotton|linen|modal/i.test(m))) {
      related.materials.push('Cotton', 'Linen', 'Modal');
    }
  }
  
  return related;
}

/**
 * Calculate dynamic weight for an attribute based on query context
 */
function getDynamicWeight(
  attribute: string,
  queryContext?: QueryContext
): number {
  const baseWeights: Record<string, number> = {
    ageGroups: 1.5,
    colors: 1.0,
    sizes: 0.8,
    occasions: 0.6,
    styles: 0.4,
    patterns: 0.4,
    seasons: 0.3,
    materials: 0.2,
    fits: 0.2,
    collections: 0.2,
    lengths: 0.4, // New: length for dresses
    necklines: 0.3, // New: neckline
    sleeveLengths: 0.3, // New: sleeve length
    price: 0.3,
  };
  
  const baseWeight = baseWeights[attribute] || 0.2;
  
  if (!queryContext) return baseWeight;
  
  const { queryType, explicitMentions } = queryContext;
  const isExplicitlyMentioned = explicitMentions?.includes(attribute) || false;
  
  // Dynamic adjustments based on query type and explicit mentions
  switch (attribute) {
    case 'occasions':
      if (isExplicitlyMentioned) return 1.2; // Explicitly mentioned: "for wedding"
      if (queryType === 'occasion_based') return 1.0; // Query type is occasion-based
      return 0.8; // Inferred from context
      
    case 'materials':
      if (isExplicitlyMentioned) return 0.8; // Explicitly mentioned: "silk dress"
      if (queryType === 'style_exploration') return 0.4; // Style-focused query
      return baseWeight;
      
    case 'seasons':
      if (isExplicitlyMentioned) return 0.7; // Explicitly mentioned: "summer dress"
      if (queryContext.originalQuery && /miami|beach|tropical/i.test(queryContext.originalQuery)) return 0.5; // Inferred from location
      return baseWeight;
      
    case 'fits':
      if (isExplicitlyMentioned) return 0.6; // Explicitly mentioned: "relaxed fit"
      return baseWeight;
      
    case 'lengths':
      if (isExplicitlyMentioned) return 0.8; // Explicitly mentioned: "mini dress"
      return baseWeight;
      
    case 'necklines':
    case 'sleeveLengths':
      if (isExplicitlyMentioned) return 0.6; // Explicitly mentioned
      return baseWeight;
      
    default:
      return baseWeight;
  }
}

/**
 * Calculate overall constraint match score for a product
 * Returns a score 0-1 based on how well the product matches all constraints
 */
export function calculateConstraintMatchScore(
  product: SearchResultItem | { attributes?: ProductAttributes | null; priceCents?: number },
  constraints: QueryConstraints,
  queryContext?: QueryContext
): number {
  const attrs = 'attributes' in product ? product.attributes : (product as any).attributes;
  const productTitle = 'title' in product ? product.title : '';
  
  // Infer related attributes to boost matching
  const relatedAttributes = inferRelatedAttributes(constraints);
  const enhancedConstraints: QueryConstraints = {
    ...constraints,
    // Merge related attributes (only if not already present)
    styles: constraints.styles || relatedAttributes.styles,
    materials: constraints.materials || relatedAttributes.materials,
    occasions: constraints.occasions || relatedAttributes.occasions,
    seasons: constraints.seasons || relatedAttributes.seasons,
  };
  
  const scores: number[] = [];
  const scoreDetails: Record<string, { queryValue: any; productValue: any; score: number; weighted: number }> = {};
  
  // Age Group (HIGHEST priority - critical for filtering kids vs adult products)
  if (enhancedConstraints.ageGroups) {
    const productAgeGroup = extractAttrValue(attrs, 'ageGroup');
    const ageGroupScore = matchAgeGroup(product, enhancedConstraints.ageGroups);
    const weight = getDynamicWeight('ageGroups', queryContext);
    const weighted = ageGroupScore * weight;
    scores.push(weighted);
    scoreDetails.ageGroups = {
      queryValue: enhancedConstraints.ageGroups,
      productValue: productAgeGroup || 'inferred',
      score: ageGroupScore,
      weighted,
    };
  }
  
  // Color (second highest priority)
  if (enhancedConstraints.colors) {
    const productColor = extractAttrValue(attrs, 'color');
    const colorScore = matchColor(attrs, enhancedConstraints.colors);
    const weight = getDynamicWeight('colors', queryContext);
    const weighted = colorScore * weight;
    scores.push(weighted);
    scoreDetails.colors = {
      queryValue: enhancedConstraints.colors,
      productValue: productColor,
      score: colorScore,
      weighted,
    };
  }
  
  // Size (third priority)
  if (enhancedConstraints.sizes) {
    const productSizes = extractAttrValue(attrs, 'sizes') || extractAttrValue(attrs, 'size');
    const sizeScore = matchSize(attrs, enhancedConstraints.sizes);
    const weight = getDynamicWeight('sizes', queryContext);
    const weighted = sizeScore * weight;
    scores.push(weighted);
    scoreDetails.sizes = {
      queryValue: enhancedConstraints.sizes,
      productValue: productSizes,
      score: sizeScore,
      weighted,
    };
  }
  
  // Occasion (fourth priority - but dynamic weight based on context)
  if (enhancedConstraints.occasions) {
    const productOccasion = extractAttrValue(attrs, 'occasion');
    // Pass full product object for occasion inference from metadata
    const occasionScore = matchOccasion(attrs, enhancedConstraints.occasions, 'title' in product ? product : undefined);
    const weight = getDynamicWeight('occasions', queryContext);
    const weighted = occasionScore * weight;
    scores.push(weighted);
    
    // Infer occasions if not found explicitly
    let productOccasionValue: string | string[] | undefined = productOccasion;
    if (!productOccasionValue && 'title' in product) {
      const inferred = inferOccasionFromProduct(product);
      if (inferred.length > 0) {
        productOccasionValue = inferred;
      }
    }
    
    scoreDetails.occasions = {
      queryValue: enhancedConstraints.occasions,
      productValue: productOccasionValue || 'none',
      score: occasionScore,
      weighted,
    };
  }
  
  // Style/Pattern (fourth priority)
  // Infer styles from collection, styleTags, and title if not found explicitly
  if (enhancedConstraints.styles) {
    // Get explicit style first
    let productStyle = extractAttrValue(attrs, 'style') || extractAttrValue(attrs, 'Style');
    
    // If no explicit style, infer from product metadata (collection, styleTags, title)
    if (!productStyle && 'title' in product) {
      const inferredStyles = inferStyleFromProduct(product);
      if (inferredStyles.length > 0) {
        productStyle = inferredStyles;
      }
    }
    
    // Pass full product object for style inference from metadata
    const styleScore = matchStyle(attrs, enhancedConstraints.styles, 'title' in product ? product : undefined);
    const weight = getDynamicWeight('styles', queryContext);
    const weighted = styleScore * weight;
    scores.push(weighted);
    scoreDetails.styles = {
      queryValue: enhancedConstraints.styles,
      productValue: productStyle || 'none',
      score: styleScore,
      weighted,
    };
  }
  
  if (enhancedConstraints.patterns) {
    const productPattern = extractAttrValue(attrs, 'pattern') || extractAttrValue(attrs, 'Pattern');
    const patternScore = matchPattern(attrs, enhancedConstraints.patterns);
    const weight = getDynamicWeight('patterns', queryContext);
    const weighted = patternScore * weight;
    scores.push(weighted);
    scoreDetails.patterns = {
      queryValue: enhancedConstraints.patterns,
      productValue: productPattern,
      score: patternScore,
      weighted,
    };
  }
  
  // Season (fifth priority - dynamic weight)
  if (enhancedConstraints.seasons) {
    const productSeason = extractAttrValue(attrs, 'season') || extractAttrValue(attrs, 'Season');
    const seasonScore = matchSeason(attrs, enhancedConstraints.seasons);
    const weight = getDynamicWeight('seasons', queryContext);
    const weighted = seasonScore * weight;
    scores.push(weighted);
    scoreDetails.seasons = {
      queryValue: enhancedConstraints.seasons,
      productValue: productSeason,
      score: seasonScore,
      weighted,
    };
  }
  
  // Material/Fit (lower priority - but dynamic weight when explicitly mentioned)
  if (enhancedConstraints.materials) {
    const productMaterial = extractAttrValue(attrs, 'material') || extractAttrValue(attrs, 'Material') || extractAttrValue(attrs, 'fabric');
    const materialScore = matchMaterial(attrs, enhancedConstraints.materials);
    const weight = getDynamicWeight('materials', queryContext);
    const weighted = materialScore * weight;
    scores.push(weighted);
    scoreDetails.materials = {
      queryValue: enhancedConstraints.materials,
      productValue: productMaterial,
      score: materialScore,
      weighted,
    };
  }
  
  if (enhancedConstraints.fits) {
    const productFit = extractAttrValue(attrs, 'fit') || extractAttrValue(attrs, 'Fit');
    const fitScore = matchFit(attrs, enhancedConstraints.fits);
    const weight = getDynamicWeight('fits', queryContext);
    const weighted = fitScore * weight;
    scores.push(weighted);
    scoreDetails.fits = {
      queryValue: enhancedConstraints.fits,
      productValue: productFit,
      score: fitScore,
      weighted,
    };
  }
  
  // Length (for dresses - new attribute with dynamic weight)
  if (enhancedConstraints.lengths) {
    const productLength = extractAttrValue(attrs, 'length') || extractAttrValue(attrs, 'Length');
    const lengthScore = fuzzyMatch(productLength, enhancedConstraints.lengths);
    const weight = getDynamicWeight('lengths', queryContext);
    const weighted = lengthScore * weight;
    scores.push(weighted);
    scoreDetails.lengths = {
      queryValue: enhancedConstraints.lengths,
      productValue: productLength,
      score: lengthScore,
      weighted,
    };
  }
  
  // Neckline (new attribute with dynamic weight)
  if (enhancedConstraints.necklines) {
    const productNeckline = extractAttrValue(attrs, 'neckline') || extractAttrValue(attrs, 'Neckline');
    const necklineScore = fuzzyMatch(productNeckline, enhancedConstraints.necklines);
    const weight = getDynamicWeight('necklines', queryContext);
    const weighted = necklineScore * weight;
    scores.push(weighted);
    scoreDetails.necklines = {
      queryValue: enhancedConstraints.necklines,
      productValue: productNeckline,
      score: necklineScore,
      weighted,
    };
  }
  
  // Sleeve Length (new attribute with dynamic weight)
  if (enhancedConstraints.sleeveLengths) {
    const productSleeveLength = extractAttrValue(attrs, 'sleeveLength') || extractAttrValue(attrs, 'Sleeve Length') || extractAttrValue(attrs, 'sleeve');
    const sleeveLengthScore = fuzzyMatch(productSleeveLength, enhancedConstraints.sleeveLengths);
    const weight = getDynamicWeight('sleeveLengths', queryContext);
    const weighted = sleeveLengthScore * weight;
    scores.push(weighted);
    scoreDetails.sleeveLengths = {
      queryValue: enhancedConstraints.sleeveLengths,
      productValue: productSleeveLength,
      score: sleeveLengthScore,
      weighted,
    };
  }
  
  // Collection (lower priority)
  if (enhancedConstraints.collections) {
    const productCollection = extractAttrValue(attrs, 'collection') || extractAttrValue(attrs, 'Collection');
    const collectionScore = matchCollection(attrs, enhancedConstraints.collections);
    const weight = getDynamicWeight('collections', queryContext);
    const weighted = collectionScore * weight;
    scores.push(weighted);
    scoreDetails.collections = {
      queryValue: enhancedConstraints.collections,
      productValue: productCollection,
      score: collectionScore,
      weighted,
    };
  }
  
  // Price (lower priority - hard constraint but less weight for ranking)
  // Convert null to undefined for matchPrice (null = explicitly removed, undefined = not set)
  const priceMin = enhancedConstraints.priceMinCents === null ? undefined : enhancedConstraints.priceMinCents;
  const priceMax = enhancedConstraints.priceMaxCents === null ? undefined : enhancedConstraints.priceMaxCents;
  if (priceMin || priceMax) {
    const priceScore = matchPrice(product.priceCents, priceMin, priceMax);
    const weight = getDynamicWeight('price', queryContext);
    const weighted = priceScore * weight;
    scores.push(weighted);
    scoreDetails.price = {
      queryValue: { min: priceMin, max: priceMax },
      productValue: product.priceCents,
      score: priceScore,
      weighted,
    };
  }
  
  // If no constraints, return 0 (shouldn't happen but safety check)
  if (scores.length === 0) return 0;
  
  // Calculate weighted average
  const totalWeight = scores.reduce((sum, score) => sum + (score > 0 ? 1 : 0), 0);
  if (totalWeight === 0) return 0;
  
  const sumScores = scores.reduce((sum, score) => sum + score, 0);
  const finalScore = sumScores / totalWeight;
  
  // Log detailed matching info for first few products (to avoid log spam)
  // Also log when constraint score is 0 but constraints are provided (to debug why matching fails)
  const hasConstraintsButZeroScore = finalScore === 0 && Object.keys(constraints).some(k => {
    const val = constraints[k as keyof QueryConstraints];
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
      totalWeight,
      sumScores,
      scoreDetails,
      constraintsProvided: Object.keys(constraints).filter(k => constraints[k as keyof QueryConstraints] !== undefined && constraints[k as keyof QueryConstraints] !== null),
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
      inferredOccasion: 'title' in product ? inferOccasionFromProduct(product) : undefined,
      extractedStyle: extractAttrValue(attrs, 'style') || extractAttrValue(attrs, 'Style'),
      inferredStyle: 'title' in product ? inferStyleFromProduct(product) : undefined,
      dynamicWeights: queryContext ? {
        occasions: getDynamicWeight('occasions', queryContext),
        materials: getDynamicWeight('materials', queryContext),
        seasons: getDynamicWeight('seasons', queryContext),
        fits: getDynamicWeight('fits', queryContext),
        lengths: getDynamicWeight('lengths', queryContext),
        styles: getDynamicWeight('styles', queryContext),
      } : undefined,
    });
  }
  
  return finalScore;
}
