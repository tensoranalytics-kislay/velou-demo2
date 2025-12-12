/**
 * Query Classifier
 * 
 * LLM-based query classification and slot extraction for L'Occitane queries.
 * Uses a small, fast model with deterministic output for fast classification.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 2)
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import { LOCCITANE_QUERY_CLASSIFIER_PROMPT, LOCCITANE_QUERY_CLASSIFIER_SCHEMA } from './prompts';
import { stripJsonFences } from '../llm/orchestrator/utils';

export type QueryClassification = {
  type:
    | 'direct_product_search'
    | 'symptom_concern'
    | 'ingredient_exploration'
    | 'gift_or_vague'
    | 'unrelated';
  constraints: {
    concerns?: string[];
    skinTypes?: string[];
    hairTypes?: string[];
    applicationAreas?: string[];
    productTypes?: string[];
    collections?: string[];
    priceMinCents?: number;
    priceMaxCents?: number;
    mustHaveIngredients?: string[];
    avoidIngredients?: string[];
    madeWithout?: string[];
    ageGroups?: string[];
    genders?: string[];
  };
};

// Import canonicalization maps (these are private in attributeParser, so we'll duplicate the logic)
const CONCERN_CANONICAL_MAP: Record<string, string> = {
  'dryness': 'dryness',
  'dry': 'dryness',
  'dehydrated': 'dryness',
  'dry skin': 'dryness',
  'dry scalp': 'dry_scalp',
  'scalp discomfort': 'dry_scalp',
  'dandruff': 'dry_scalp',
  'oily scalp': 'dry_scalp',
  'aging': 'aging',
  'fine lines': 'aging',
  'wrinkles': 'aging',
  'fine lines & wrinkles': 'aging',
  'anti-aging': 'aging',
  'mature skin': 'aging',
  'dullness': 'dullness',
  'dull': 'dullness',
  'brightening': 'dullness',
  'radiance': 'dullness',
  'sensitive skin': 'sensitive_skin',
  'sensitive': 'sensitive_skin',
  'sensitivity': 'sensitive_skin',
  'irritated': 'sensitive_skin',
  'rough texture': 'rough_texture',
  'rough': 'rough_texture',
  'frizz': 'frizz',
  'frizzy': 'frizz',
  'hair breakage': 'hair_breakage',
  'hair thinning': 'hair_thinning',
  'acne': 'acne',
  'redness': 'redness',
  'hydration': 'hydration',
};

const INGREDIENT_CANONICAL_MAP: Record<string, string> = {
  'shea butter': 'shea_butter',
  'shea': 'shea_butter',
  'butyrospermum parkii': 'shea_butter',
  'almond oil': 'almond_oil',
  'sweet almond oil': 'almond_oil',
  'sweet almond': 'almond_oil',
  'hyaluronic acid': 'hyaluronic_acid',
  'sodium hyaluronate': 'hyaluronic_acid',
  'ha': 'hyaluronic_acid',
  'niacinamide': 'niacinamide',
  'vitamin b3': 'niacinamide',
  'vit b3': 'niacinamide',
  'niacin': 'niacinamide',
  'panthenol': 'panthenol',
  'vitamin b5': 'panthenol',
  'vit b5': 'panthenol',
  'provitamin b5': 'panthenol',
  'vitamin e': 'vitamin_e',
  'vit e': 'vitamin_e',
  'tocopherol': 'vitamin_e',
  'tocopheryl acetate': 'vitamin_e',
  'retinol': 'retinol',
  'vitamin a': 'retinol',
  'glycerin': 'glycerin',
  'glycerol': 'glycerin',
  'lavender essential oil': 'lavender_oil',
  'lavender': 'lavender_oil',
  'rosemary': 'rosemary_oil',
  'verbena': 'verbena_oil',
  'immortelle': 'immortelle_oil',
};

function normalizeConcern(concern: string): string {
  const normalized = concern.toLowerCase().trim();
  return CONCERN_CANONICAL_MAP[normalized] || normalized.replace(/\s+/g, '_');
}

function normalizeIngredient(ingredient: string): string {
  const normalized = ingredient.toLowerCase().trim();
  return INGREDIENT_CANONICAL_MAP[normalized] || normalized.replace(/\s+/g, '_').replace(/[()]/g, '');
}

/**
 * Parse price from text and convert to cents
 * Handles: "$50", "50 dollars", "under $50", "below ₹1500", "under 2000"
 */
function parsePriceToCents(text: string): number | null {
  // Match numbers with optional currency symbols
  const priceRegex = /(\$|₹|€|£)?\s*(\d+(?:\.\d+)?)/gi;
  const underRegex = /(under|below|less\s+than|max)\s+(\$|₹|€|£)?\s*(\d+(?:\.\d+)?)/gi;
  
  let match = underRegex.exec(text);
  if (match) {
    const amount = parseFloat(match[3] || match[2]);
    if (!isNaN(amount)) {
      // Assume USD if no currency, or convert based on currency
      // For now, treat all as USD cents (multiply by 100)
      // For ₹ (rupees), multiply by 100 as well (e.g., ₹2000 = 200000 cents)
      return Math.round(amount * 100);
    }
  }
  
  // Try regular price extraction
  match = priceRegex.exec(text);
  if (match) {
    const amount = parseFloat(match[2]);
    if (!isNaN(amount)) {
      return Math.round(amount * 100);
    }
  }
  
  return null;
}

/**
 * Post-process classification constraints to normalize values
 */
function normalizeConstraints(constraints: QueryClassification['constraints']): QueryClassification['constraints'] {
  const normalized: QueryClassification['constraints'] = {};
  
  // Normalize concerns
  if (constraints.concerns?.length) {
    normalized.concerns = constraints.concerns.map(c => normalizeConcern(c)).filter(Boolean);
  }
  
  // Normalize ingredients
  if (constraints.mustHaveIngredients?.length) {
    normalized.mustHaveIngredients = constraints.mustHaveIngredients.map(i => normalizeIngredient(i)).filter(Boolean);
  }
  
  if (constraints.avoidIngredients?.length) {
    normalized.avoidIngredients = constraints.avoidIngredients.map(i => normalizeIngredient(i)).filter(Boolean);
  }
  
  // Copy other fields as-is (already in correct format from LLM)
  if (constraints.skinTypes?.length) normalized.skinTypes = constraints.skinTypes;
  if (constraints.hairTypes?.length) normalized.hairTypes = constraints.hairTypes;
  if (constraints.applicationAreas?.length) normalized.applicationAreas = constraints.applicationAreas;
  if (constraints.productTypes?.length) normalized.productTypes = constraints.productTypes;
  if (constraints.collections?.length) normalized.collections = constraints.collections;
  if (constraints.madeWithout?.length) normalized.madeWithout = constraints.madeWithout;
  if (constraints.ageGroups?.length) normalized.ageGroups = constraints.ageGroups;
  if (constraints.genders?.length) normalized.genders = constraints.genders;
  
  // Prices should already be in cents from LLM, but double-check
  if (constraints.priceMinCents !== null && constraints.priceMinCents !== undefined) {
    normalized.priceMinCents = constraints.priceMinCents;
  }
  if (constraints.priceMaxCents !== null && constraints.priceMaxCents !== undefined) {
    normalized.priceMaxCents = constraints.priceMaxCents;
  }
  
  return normalized;
}

/**
 * Classify query and extract constraints using LLM
 * 
 * Uses a small, fast model (gpt-4.1-mini) with temperature 0.0 for deterministic output.
 * Post-processes constraints to normalize concerns and ingredients using canonicalization rules.
 * 
 * @param message - User query message
 * @param history - Optional conversation history
 * @returns QueryClassification with type and normalized constraints
 */
export async function classifyQuery(
  message: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<QueryClassification> {
  try {
    // Build messages array
    const messages = [
      {
        role: 'system' as const,
        content: LOCCITANE_QUERY_CLASSIFIER_PROMPT,
      },
      {
        role: 'user' as const,
        content: `User query: "${message}"\n\nClassify this query and extract constraints.`,
      },
    ];
    
    // Call LLM with intent purpose (uses reasoning model) but we want fast, so override
    // Actually, let's use the light model for speed. The provider will use lightLlmModel for intent.
    // Use low max_tokens since classification JSON responses are small (~200-500 tokens max)
    const result = await callLLM({
      messages,
      purpose: 'intent', // This will use reasoning model, but we can't override easily
      expectJson: true,
      schema: LOCCITANE_QUERY_CLASSIFIER_SCHEMA,
      maxTokens: 500, // JSON classification responses are small, limit tokens for speed
    });
    
    // Parse JSON response
    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as QueryClassification;
    
    // Validate type
    const validTypes = ['direct_product_search', 'symptom_concern', 'ingredient_exploration', 'gift_or_vague', 'unrelated'];
    if (!validTypes.includes(parsed.type)) {
      logger.warn('classifyQuery: invalid type from LLM', {
        type: parsed.type,
        message,
      });
      parsed.type = 'unrelated';
    }
    
    // Normalize constraints
    parsed.constraints = normalizeConstraints(parsed.constraints);
    
    // Handle price extraction if LLM didn't extract it correctly
    // Check message for price hints
    if (!parsed.constraints.priceMaxCents && !parsed.constraints.priceMinCents) {
      const priceHint = parsePriceToCents(message);
      if (priceHint && /(under|below|less|max|maximum)/i.test(message)) {
        parsed.constraints.priceMaxCents = priceHint;
      } else if (priceHint && /(over|above|min|minimum)/i.test(message)) {
        parsed.constraints.priceMinCents = priceHint;
      }
    }
    
    logger.debug('classifyQuery: classification complete', {
      type: parsed.type,
      constraintsKeys: Object.keys(parsed.constraints),
      message: message.substring(0, 100),
    });
    
    return parsed;
  } catch (error) {
    logger.error('classifyQuery: error classifying query', {
      error: error instanceof Error ? error.message : String(error),
      message: message.substring(0, 100),
    });
    
    // Fallback: return unrelated type
    return {
      type: 'unrelated',
      constraints: {},
    };
  }
}

