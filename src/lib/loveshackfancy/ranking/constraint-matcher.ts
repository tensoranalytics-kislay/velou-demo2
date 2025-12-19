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

/**
 * Extract attribute value (handles both string and array formats)
 */
function extractAttrValue(attrs: ProductAttributes | null | undefined, key: string): string | string[] | undefined {
  if (!attrs) return undefined;
  
  // Try direct key
  const directValue = (attrs as any)[key];
  if (directValue) {
    return Array.isArray(directValue) ? directValue : [directValue];
  }
  
  // Try capitalized key
  const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
  const capitalizedValue = (attrs as any)[capitalizedKey];
  if (capitalizedValue) {
    return Array.isArray(capitalizedValue) ? capitalizedValue : [capitalizedValue];
  }
  
  // Try lowercase key
  const lowercaseKey = key.toLowerCase();
  const lowercaseValue = (attrs as any)[lowercaseKey];
  if (lowercaseValue) {
    return Array.isArray(lowercaseValue) ? lowercaseValue : [lowercaseValue];
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
 * Match occasion constraints
 */
export function matchOccasion(productAttrs: ProductAttributes | null | undefined, queryOccasions: string[] | undefined): number {
  if (!queryOccasions || queryOccasions.length === 0) return 0;
  
  const productOccasion = extractAttrValue(productAttrs, 'occasion');
  return fuzzyMatch(productOccasion, queryOccasions);
}

/**
 * Match style constraints
 */
export function matchStyle(productAttrs: ProductAttributes | null | undefined, queryStyles: string[] | undefined): number {
  if (!queryStyles || queryStyles.length === 0) return 0;
  
  const productStyle = extractAttrValue(productAttrs, 'style') || extractAttrValue(productAttrs, 'Style');
  return fuzzyMatch(productStyle, queryStyles);
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
 * Calculate overall constraint match score for a product
 * Returns a score 0-1 based on how well the product matches all constraints
 */
export function calculateConstraintMatchScore(
  product: SearchResultItem | { attributes?: ProductAttributes | null; priceCents?: number },
  constraints: QueryConstraints
): number {
  const attrs = 'attributes' in product ? product.attributes : (product as any).attributes;
  
  const scores: number[] = [];
  
  // Age Group (HIGHEST priority - critical for filtering kids vs adult products)
  if (constraints.ageGroups) {
    const ageGroupScore = matchAgeGroup(product, constraints.ageGroups);
    scores.push(ageGroupScore * 1.5); // Weight 1.5 (highest priority)
  }
  
  // Color (second highest priority)
  if (constraints.colors) {
    const colorScore = matchColor(attrs, constraints.colors);
    scores.push(colorScore * 1.0); // Weight 1.0
  }
  
  // Size (third priority)
  if (constraints.sizes) {
    const sizeScore = matchSize(attrs, constraints.sizes);
    scores.push(sizeScore * 0.8); // Weight 0.8
  }
  
  // Occasion (fourth priority)
  if (constraints.occasions) {
    const occasionScore = matchOccasion(attrs, constraints.occasions);
    scores.push(occasionScore * 0.6); // Weight 0.6
  }
  
  // Style/Pattern (fourth priority)
  if (constraints.styles) {
    const styleScore = matchStyle(attrs, constraints.styles);
    scores.push(styleScore * 0.4); // Weight 0.4
  }
  
  if (constraints.patterns) {
    const patternScore = matchPattern(attrs, constraints.patterns);
    scores.push(patternScore * 0.4); // Weight 0.4
  }
  
  // Season (fifth priority)
  if (constraints.seasons) {
    const seasonScore = matchSeason(attrs, constraints.seasons);
    scores.push(seasonScore * 0.3); // Weight 0.3
  }
  
  // Material/Fit (lower priority)
  if (constraints.materials) {
    const materialScore = matchMaterial(attrs, constraints.materials);
    scores.push(materialScore * 0.2); // Weight 0.2
  }
  
  if (constraints.fits) {
    const fitScore = matchFit(attrs, constraints.fits);
    scores.push(fitScore * 0.2); // Weight 0.2
  }
  
  // Collection (lower priority)
  if (constraints.collections) {
    const collectionScore = matchCollection(attrs, constraints.collections);
    scores.push(collectionScore * 0.2); // Weight 0.2
  }
  
  // Price (lower priority - hard constraint but less weight for ranking)
  // Convert null to undefined for matchPrice (null = explicitly removed, undefined = not set)
  const priceMin = constraints.priceMinCents === null ? undefined : constraints.priceMinCents;
  const priceMax = constraints.priceMaxCents === null ? undefined : constraints.priceMaxCents;
  if (priceMin || priceMax) {
    const priceScore = matchPrice(product.priceCents, priceMin, priceMax);
    scores.push(priceScore * 0.3); // Weight 0.3
  }
  
  // If no constraints, return 0 (shouldn't happen but safety check)
  if (scores.length === 0) return 0;
  
  // Calculate weighted average
  const totalWeight = scores.reduce((sum, score) => sum + (score > 0 ? 1 : 0), 0);
  if (totalWeight === 0) return 0;
  
  const sumScores = scores.reduce((sum, score) => sum + score, 0);
  return sumScores / totalWeight;
}

