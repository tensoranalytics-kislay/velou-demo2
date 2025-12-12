/**
 * L'Occitane-Specific Rule-Based Intent Extraction
 * 
 * Fast, deterministic intent extraction without LLM calls.
 * Uses pre-computed ontology for instant results.
 */

import type { SearchConstraints } from '../search/types';
import {
  LOCCITANE_ONTOLOGY,
  matchesCollection,
  matchesProductType,
  matchesConcern,
  extractPrice,
} from './ontology';

export type LoccitaneIntent = {
  constraints: SearchConstraints;
  isFollowUp: boolean;
  collection?: string;
  productType?: string;
  concern?: string;
  priceMax?: number;
  isGiftSet?: boolean;
};

/**
 * Rule-based follow-up detection (replaces ContextGatekeeper LLM)
 */
export function detectFollowUp(
  message: string,
  lastConstraints: SearchConstraints | null,
): boolean {
  const lower = message.toLowerCase().trim();
  
  // If no previous constraints, it's not a follow-up
  if (!lastConstraints) {
    return false;
  }
  
  // Short messages (< 10 words) are likely follow-ups
  const wordCount = lower.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount <= 3) {
    return true;
  }
  
  // Refinement keywords
  const refinementKeywords = [
    'make it', 'also', 'and', 'with', 'in', 'that', 'those', 'these',
    'more', 'less', 'only', 'just', 'cheaper', 'cheaper', 'under',
    'above', 'also', 'add', 'plus',
  ];
  
  if (refinementKeywords.some(keyword => lower.includes(keyword))) {
    return true;
  }
  
  // Color/size/material refinements
  const colorKeywords = ['black', 'white', 'blue', 'red', 'green', 'pink', 'gray', 'grey', 'brown'];
  const sizeKeywords = ['small', 'medium', 'large', 'xl', 'size'];
  
  if (colorKeywords.some(color => lower.includes(color)) ||
      sizeKeywords.some(size => lower.includes(size))) {
    return true;
  }
  
  // Category switching = NOT follow-up
  const categorySwitchingKeywords = [
    'instead', 'switch', 'change to', 'now show', 'actually',
    'looking for', 'need', 'want', 'search',
  ];
  
  if (categorySwitchingKeywords.some(keyword => lower.includes(keyword))) {
    return false;
  }
  
  return false;
}

/**
 * Extract intent from user message (rule-based, no LLM)
 */
export function extractLoccitaneIntent(
  message: string,
  lastConstraints: SearchConstraints | null = null,
): LoccitaneIntent {
  const lower = message.toLowerCase();
  const constraints: SearchConstraints = {
    inStockOnly: true,
    query: message,
  };
  
  // Check if this is a follow-up
  const isFollowUp = detectFollowUp(message, lastConstraints);
  
  // Extract collection
  let collection: string | undefined;
  for (const coll of LOCCITANE_ONTOLOGY.collections) {
    if (lower.includes(coll.toLowerCase())) {
      collection = coll;
      break;
    }
  }
  if (!collection) {
    const matched = matchesCollection(message);
    if (matched) {
      collection = matched;
    }
  }
  
  // Extract product type
  let productType: string | undefined;
  for (const pt of LOCCITANE_ONTOLOGY.productTypes) {
    if (lower.includes(pt.toLowerCase())) {
      productType = pt;
      break;
    }
  }
  if (!productType) {
    const matched = matchesProductType(message);
    if (matched) {
      productType = matched;
    }
  }
  
  // Extract concern
  let concern: string | undefined;
  for (const c of LOCCITANE_ONTOLOGY.concerns) {
    if (lower.includes(c.toLowerCase())) {
      concern = c;
      break;
    }
  }
  if (!concern) {
    const matched = matchesConcern(message);
    if (matched) {
      concern = matched;
    }
  }
  
  // Extract price
  const priceInfo = extractPrice(message);
  if (priceInfo?.max) {
    constraints.priceMaxCents = priceInfo.max * 100;
  }
  if (priceInfo?.min) {
    constraints.priceMinCents = priceInfo.min * 100;
  }
  
  // Gift set detection
  const isGiftSet = /gift|set|duo|trio|bundle/gi.test(message);
  
  // Map to SearchConstraints format
  // IMPORTANT: Don't set category directly - products use "Personal Care" category
  // Instead, add product type to query for full-text search matching
  if (productType) {
    // Add product type to query for keyword matching (title, subcategory, description)
    // This works better than category filter since products use "Personal Care" category
    constraints.query = `${constraints.query} ${productType.toLowerCase()}`.trim();
  }
  
  // Use collection as a keyword filter
  if (collection) {
    constraints.query = `${constraints.query} ${collection}`.trim();
  }
  
  // Use concern in query
  if (concern) {
    constraints.query = `${constraints.query} ${concern}`.trim();
  }
  
  // Gift sets
  if (isGiftSet) {
    // Look for Gift Set in category or as keyword
    constraints.query = `${constraints.query} gift set`.trim();
  }
  
  return {
    constraints,
    isFollowUp,
    collection,
    productType,
    concern,
    priceMax: priceInfo?.max,
    isGiftSet,
  };
}

/**
 * Merge follow-up constraints with previous constraints
 */
export function mergeLoccitaneConstraints(
  previous: SearchConstraints,
  current: SearchConstraints,
  message: string,
): SearchConstraints {
  const merged: SearchConstraints = { ...previous };
  
  // Always keep price range from previous (sticky)
  if (!current.priceMaxCents && previous.priceMaxCents) {
    merged.priceMaxCents = previous.priceMaxCents;
  }
  
  // Merge category (new category overrides)
  if (current.category) {
    merged.category = current.category;
  }
  
  // Merge query (append if not conflicting)
  if (current.query && current.query !== previous.query) {
    merged.query = `${previous.query} ${current.query}`.trim();
  }
  
  // Keep inStockOnly
  merged.inStockOnly = current.inStockOnly ?? true;
  
  return merged;
}

