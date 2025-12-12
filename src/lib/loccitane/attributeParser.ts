/**
 * L'Occitane Attribute Parser
 * 
 * Parses velou_attribute:Key:Value entries from product_details into
 * structured attributes for multi-view retrieval.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 1.1)
 */

import type { ProductAttributes } from '../search/types';

export type StructuredLoccitaneAttributes = {
  // Concerns (from "velou_attribute:Concern:*")
  concerns: string[];
  
  // Skin/Hair Types (from "velou_attribute:Skin Type:*", "velou_attribute:Hair Type:*")
  skinTypes: string[];
  hairTypes: string[];
  
  // Application Areas (from "velou_attribute:Application Area:*")
  applicationAreas: string[];
  
  // Product Type/Formula (from "velou_attribute:Type:*", "velou_attribute:Formula:*")
  productType: string | null;
  formula: string | null; // "Scrub", "Oil", "Cream", "Serum"
  
  // Ingredients (from "velou_attribute:Featured Ingredients:*", "velou_attribute:Ingredients:*")
  featuredIngredients: string[];
  allIngredients: string[];
  
  // Safety/Claims (from "velou_attribute:Made Without:*")
  madeWithout: string[]; // "Paraben Free", "Sulfate Free"
  
  // Demographics (from "velou_attribute:Age Group:*", "velou_attribute:Gender:*")
  ageGroups: string[];
  genders: string[];
  
  // Canonical normalized values
  canonicalConcerns: string[]; // Mapped/normalized concerns
  canonicalIngredients: string[]; // Canonicalized ingredient names
};

/**
 * Canonical concern mappings
 * Maps various concern phrasings to normalized canonical values
 */
const CONCERN_CANONICAL_MAP: Record<string, string> = {
  // Dryness variants
  'dryness': 'dryness',
  'dry': 'dryness',
  'dehydrated': 'dryness',
  'dry skin': 'dryness',
  
  // Dry scalp / dandruff variants
  'dry scalp': 'dry_scalp',
  'scalp discomfort': 'dry_scalp',
  'dandruff': 'dry_scalp',
  'oily scalp': 'dry_scalp', // Often treated similarly
  
  // Aging variants
  'aging': 'aging',
  'fine lines': 'aging',
  'wrinkles': 'aging',
  'fine lines & wrinkles': 'aging',
  'anti-aging': 'aging',
  'mature skin': 'aging',
  
  // Dullness variants
  'dullness': 'dullness',
  'dull': 'dullness',
  'brightening': 'dullness',
  'radiance': 'dullness',
  
  // Sensitive skin variants
  'sensitive skin': 'sensitive_skin',
  'sensitive': 'sensitive_skin',
  'sensitivity': 'sensitive_skin',
  'irritated': 'sensitive_skin',
  
  // Rough texture
  'rough texture': 'rough_texture',
  'rough': 'rough_texture',
  
  // Hair concerns
  'frizz': 'frizz',
  'frizzy': 'frizz',
  'hair breakage': 'hair_breakage',
  'hair thinning': 'hair_thinning',
  
  // Other common concerns
  'acne': 'acne',
  'redness': 'redness',
  'hydration': 'hydration',
};

/**
 * Ingredient canonicalization map
 * Maps ingredient name variants to canonical forms
 */
const INGREDIENT_CANONICAL_MAP: Record<string, string> = {
  // Shea butter variants
  'shea butter': 'shea_butter',
  'shea': 'shea_butter',
  'butyrospermum parkii': 'shea_butter',
  'butyrospermum parkii (shea) butter': 'shea_butter',
  
  // Almond oil variants
  'almond oil': 'almond_oil',
  'sweet almond oil': 'almond_oil',
  'prunus amygdalus dulcis oil': 'almond_oil',
  'sweet almond': 'almond_oil',
  
  // Hyaluronic acid variants
  'hyaluronic acid': 'hyaluronic_acid',
  'sodium hyaluronate': 'hyaluronic_acid',
  'ha': 'hyaluronic_acid',
  
  // Niacinamide variants
  'niacinamide': 'niacinamide',
  'vitamin b3': 'niacinamide',
  'vit b3': 'niacinamide',
  'niacin': 'niacinamide',
  
  // Panthenol variants
  'panthenol': 'panthenol',
  'vitamin b5': 'panthenol',
  'vit b5': 'panthenol',
  'provitamin b5': 'panthenol',
  
  // Vitamin E variants
  'vitamin e': 'vitamin_e',
  'vit e': 'vitamin_e',
  'tocopherol': 'vitamin_e',
  'tocopheryl acetate': 'vitamin_e',
  
  // Retinol variants
  'retinol': 'retinol',
  'vitamin a': 'retinol',
  
  // Glycerin (usually standardized)
  'glycerin': 'glycerin',
  'glycerol': 'glycerin',
  
  // Essential oils (keep as-is, just lowercase)
  'lavender essential oil': 'lavender_oil',
  'lavender': 'lavender_oil',
  'rosemary': 'rosemary_oil',
  'verbena': 'verbena_oil',
  'immortelle': 'immortelle_oil',
};

/**
 * Normalize a concern string to canonical form
 */
function normalizeConcern(concern: string): string {
  const normalized = concern.toLowerCase().trim();
  return CONCERN_CANONICAL_MAP[normalized] || normalized.replace(/\s+/g, '_');
}

/**
 * Normalize an ingredient name to canonical form
 */
function normalizeIngredient(ingredient: string): string {
  const normalized = ingredient.toLowerCase().trim();
  return INGREDIENT_CANONICAL_MAP[normalized] || normalized.replace(/\s+/g, '_').replace(/[()]/g, '');
}

/**
 * Parse product_details into structured attributes
 * 
 * Handles both:
 * 1. Raw string[] format: ["velou_attribute:Concern:Dryness", "velou_attribute:Skin Type:Dry", ...]
 * 2. Parsed Record<string, string> format: { "Concern": "Dryness", "Skin Type": "Dry", ... }
 * 
 * The function intelligently detects which format is provided and parses accordingly.
 * For string[] format, it extracts "velou_attribute:Key:Value" entries properly,
 * collecting all values for array fields (e.g., multiple concerns).
 * 
 * @param productDetails - Either raw string[] array or parsed Record<string, string>
 * @param existingAttributes - Optional existing product attributes for additional context
 * @returns Structured L'Occitane attributes
 */
export function parseLoccitaneAttributes(
  productDetails: Record<string, string> | string[] | null | undefined,
  existingAttributes?: ProductAttributes
): StructuredLoccitaneAttributes {
  const result: StructuredLoccitaneAttributes = {
    concerns: [],
    skinTypes: [],
    hairTypes: [],
    applicationAreas: [],
    productType: null,
    formula: null,
    featuredIngredients: [],
    allIngredients: [],
    madeWithout: [],
    ageGroups: [],
    genders: [],
    canonicalConcerns: [],
    canonicalIngredients: [],
  };
  
  if (!productDetails) {
    return result;
  }
  
  // Helper to add unique value to array
  const addUnique = (arr: string[], value: string) => {
    const trimmed = value.trim();
    if (trimmed && !arr.includes(trimmed)) {
      arr.push(trimmed);
    }
  };
  
  // Normalize input: convert string[] to Record<string, string[]>
  // to handle multiple values per key
  const parsedEntries: Record<string, string[]> = {};
  
  if (Array.isArray(productDetails)) {
    // Raw string[] format: ["velou_attribute:Concern:Dryness", ...]
    for (const item of productDetails) {
      if (typeof item !== 'string') continue;
      
      // Handle "velou_attribute:Key:Value" format
      if (item.startsWith('velou_attribute:')) {
        const withoutPrefix = item.slice('velou_attribute:'.length);
        const colonIndex = withoutPrefix.indexOf(':');
        if (colonIndex > 0) {
          const key = withoutPrefix.slice(0, colonIndex).trim();
          const value = withoutPrefix.slice(colonIndex + 1).trim();
          if (key && value) {
            if (!parsedEntries[key]) {
              parsedEntries[key] = [];
            }
            parsedEntries[key].push(value);
          }
        }
      } else {
        // Handle "Key:Value" format (without prefix)
        const colonIndex = item.indexOf(':');
        if (colonIndex > 0) {
          const key = item.slice(0, colonIndex).trim();
          const value = item.slice(colonIndex + 1).trim();
          if (key && value) {
            if (!parsedEntries[key]) {
              parsedEntries[key] = [];
            }
            parsedEntries[key].push(value);
          }
        }
      }
    }
  } else if (typeof productDetails === 'object') {
    // Record<string, string> format - convert to Record<string, string[]>
    for (const [key, value] of Object.entries(productDetails)) {
      if (value && typeof value === 'string') {
        parsedEntries[key] = [value];
      }
    }
  } else {
    return result;
  }
  
  // Process each key-value pair(s)
  for (const [key, values] of Object.entries(parsedEntries)) {
    if (!values || values.length === 0) continue;
    
    const normalizedKey = key.trim();
    
    // Match known attribute keys (case-insensitive, flexible matching)
    const keyLower = normalizedKey.toLowerCase();
    
    // Process all values for this key
    for (const value of values) {
      const normalizedValue = value.trim();
      if (!normalizedValue) continue;
      
      // Concerns
      if (keyLower === 'concern') {
        addUnique(result.concerns, normalizedValue);
        const canonical = normalizeConcern(normalizedValue);
        if (!result.canonicalConcerns.includes(canonical)) {
          result.canonicalConcerns.push(canonical);
        }
      }
      
      // Skin Types
      if (keyLower === 'skin type' || keyLower === 'skintype') {
        addUnique(result.skinTypes, normalizedValue);
      }
      
      // Hair Types
      if (keyLower === 'hair type' || keyLower === 'hairtype') {
        addUnique(result.hairTypes, normalizedValue);
      }
      
      // Application Areas
      if (keyLower === 'application area' || keyLower === 'applicationarea') {
        addUnique(result.applicationAreas, normalizedValue);
      }
      
      // Product Type (single value, prefer most specific/longest)
      if (keyLower === 'type') {
        // Prefer more specific product types over generic ones
        if (!result.productType || normalizedValue.length > result.productType.length) {
          result.productType = normalizedValue;
        }
      }
      
      // Formula
      if (keyLower === 'formula') {
        result.formula = normalizedValue;
      }
      
      // Featured Ingredients
      if (keyLower === 'featured ingredients' || keyLower === 'featuredingredients') {
        // May contain multiple ingredients separated by comma or pipe
        const ingredients = normalizedValue.split(/[,|]/).map((s: string) => s.trim()).filter(Boolean);
        ingredients.forEach((ing: string) => addUnique(result.featuredIngredients, ing));
      }
      
      // All Ingredients (from Ingredients key)
      if (keyLower === 'ingredients' || keyLower === 'ingredient') {
        // May contain multiple ingredients separated by comma or pipe
        const ingredients = normalizedValue.split(/[,|]/).map((s: string) => s.trim()).filter(Boolean);
        ingredients.forEach((ing: string) => {
          addUnique(result.allIngredients, ing);
          // Also canonicalize for search
          const canonical = normalizeIngredient(ing);
          if (!result.canonicalIngredients.includes(canonical)) {
            result.canonicalIngredients.push(canonical);
          }
        });
      }
      
      // Made Without
      if (keyLower === 'made without' || keyLower === 'madewithout') {
        // May contain multiple values separated by comma or pipe
        const splitValues = normalizedValue.split(/[,|]/).map((s: string) => s.trim()).filter(Boolean);
        splitValues.forEach((v: string) => addUnique(result.madeWithout, v));
      }
      
      // Age Groups
      if (keyLower === 'age group' || keyLower === 'agegroup') {
        addUnique(result.ageGroups, normalizedValue);
      }
      
      // Gender
      if (keyLower === 'gender') {
        addUnique(result.genders, normalizedValue);
      }
    }
  }
  
  // Also canonicalize featured ingredients
  result.featuredIngredients.forEach(ing => {
    const canonical = normalizeIngredient(ing);
    if (!result.canonicalIngredients.includes(canonical)) {
      result.canonicalIngredients.push(canonical);
    }
  });
  
  // Also canonicalize concerns from existing attributes if available
  if (existingAttributes?.benefits) {
    // Benefits might contain concern-like text, but we'll be conservative
    // Only add if we already have some concerns (don't invent them)
  }
  
  return result;
}

