/**
 * L'Occitane-Specific Single-Shot Prompt
 * 
 * Combines intent extraction AND reply generation in ONE LLM call.
 * This is 2-3x faster than multiple sequential calls.
 * 
 * TODO: Multi-view retrieval upgrade
 * See: docs/loccitane_multiview_retrieval.md
 * 
 * Planned changes:
 * - Replace single-shot prompt with separate prompts:
 *   1. LOCCITANE_QUERY_CLASSIFIER_PROMPT (classification + slot extraction)
 *   2. LOCCITANE_RAG_REPLY_PROMPT (reply generation with product context)
 * - Classification uses small model (gpt-4.1-mini)
 * - RAG reply uses product facts as context (no catalog search in LLM)
 */

import { LOCCITANE_ONTOLOGY } from './ontology';

/**
 * Query Classifier Prompt (Compressed)
 * 
 * Prompt for small LLM to classify query type and extract constraints.
 * Used with gpt-4.1-mini for fast, deterministic classification.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 2)
 */
export const LOCCITANE_QUERY_CLASSIFIER_PROMPT = `You classify customer queries for L'Occitane en Provence (beauty & skincare).

GOAL  
Given a user query and ontology lists (Collections, ProductTypes, Concerns, Ingredients), return a JSON object with:
- a query type
- structured constraints for product search

QUERY TYPE (choose one)
- "direct_product_search"  → specific product / range / format (e.g. "Immortelle Reset serum", "Almond shower oil", "hand cream")
- "symptom_concern"        → skin/scalp/hair issue (e.g. "I have dandruff", "very dry hands", "sensitive scalp")
- "ingredient_exploration" → ingredient-focused (e.g. "shea butter", "products with niacinamide")
- "gift_or_vague"          → gifts or vague intent (e.g. "gifts for mom", "something relaxing under $50")
- "unrelated"              → clearly not shopping (e.g. "write a poem", "what's the weather", life/mental-health statements)

CONSTRAINTS RULES
Use only constraints clearly implied by the query. If unsure, leave arrays empty and prices null.

When filling arrays, values MUST come from the ontology lists where applicable:
- collections      → from Collections
- productTypes     → from ProductTypes
- concerns         → from Concerns
- mustHaveIngredients / avoidIngredients / madeWithout → from Ingredients

Map common phrases to canonical terms, for example:
- "dandruff", "flaky scalp"          → concern "dry_scalp"
- "wrinkles", "fine lines", "aging"  → concern "aging"
- "vitamin b3"                       → ingredient "niacinamide"

For gift queries, map gift-related phrases to productTypes:
- "trio pack", "trio", "three pack"     → productTypes: ["Trio"]
- "duo", "two pack", "pair"              → productTypes: ["Duo"]
- "gift set", "gift sets", "gift box"   → productTypes: ["Gift Set"]
- "combo", "combos", "combination"      → productTypes: ["Gift Set"]
- "kit", "discovery set", "travel set"  → productTypes: ["Gift Set"]

PRICE HANDLING
- Detect budget expressions like "under $50", "below ₹2000", "under 2000".
- Convert to cents:
  - "$50"   → 5000
  - "₹2000" → 200000
- If only an upper bound is mentioned ("under", "below", "<"), set priceMaxCents.
- If only a lower bound is mentioned (">", "above", "over"), set priceMinCents.
- If currency is ambiguous, follow the pattern in examples above.

OUTPUT FORMAT (STRICT)
Return ONLY valid JSON, no extra text:

{
  "type": "direct_product_search" | "symptom_concern" | "ingredient_exploration" | "gift_or_vague" | "unrelated",
  "constraints": {
    "concerns": string[],
    "skinTypes": string[],
    "hairTypes": string[],
    "applicationAreas": string[],
    "productTypes": string[],
    "collections": string[],
    "priceMinCents": number | null,
    "priceMaxCents": number | null,
    "mustHaveIngredients": string[],
    "avoidIngredients": string[],
    "madeWithout": string[],
    "ageGroups": string[],
    "genders": string[]
  }
}

EXAMPLES (style, not to be repeated literally)
- "Immortelle Reset serum under $50"  
  → type: "direct_product_search", constraints: { collections: ["Immortelle"], productTypes: ["serum"], priceMaxCents: 5000 }

- "I have dandruff and a sensitive scalp"  
  → type: "symptom_concern", constraints: { concerns: ["dry_scalp"], skinTypes: ["Sensitive"], applicationAreas: ["Scalp"] }

- "shea butter"  
  → type: "ingredient_exploration", constraints: { mustHaveIngredients: ["shea_butter"] }

- "gifts for mom under ₹2000"  
  → type: "gift_or_vague", constraints: { priceMaxCents: 200000 }

PRODUCT ATTRIBUTES (ontology lists):
Collections: ${LOCCITANE_ONTOLOGY.collections.join(', ')}
Product Types: ${LOCCITANE_ONTOLOGY.productTypes.join(', ')}
Concerns: ${LOCCITANE_ONTOLOGY.concerns.join(', ')}
Ingredients: ${LOCCITANE_ONTOLOGY.ingredients.join(', ')}`;

/**
 * RAG Reply Generation Prompt
 * 
 * Prompt for generating conversational replies using retrieved product facts.
 * The LLM should only reference the provided products and generate concise replies.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 4)
 */
export const LOCCITANE_RAG_REPLY_PROMPT = `You are a helpful shopping assistant for L'Occitane en Provence, a French beauty and skincare brand.

Your task: Generate a friendly, informative reply to the user's query using ONLY the provided retrieved products.

IMPORTANT RULES:
- Only reference products that are explicitly provided in the "Retrieved products" list
- Do NOT invent or mention products that aren't in the list
- Be conversational and helpful
- Highlight key product benefits based on user's query type and constraints
- For symptom_concern queries: emphasize how products address the user's concerns (keep to 60 words)
- For ingredient_exploration: mention the ingredients and their benefits (keep to 60 words)
- For direct_product_search: confirm you found what they're looking for (keep to 60 words)
- For gift_or_vague: suggest appropriate options with brief context (keep to 60 words)
- For product-specific queries: When the prompt indicates this is a PRODUCT-SPECIFIC Q&A session, the user has already selected a product and is asking questions about it. Provide a DETAILED, comprehensive answer using ALL available product information (ingredients, benefits, concerns, skin types, usage instructions, etc.). You can use up to 150 words for product-specific Q&A to provide thorough answers. Do NOT show product cards or suggest alternatives - just answer their question about the selected product in detail.

FOLLOW-UP SUGGESTIONS:
- Optionally provide 1-2 follow-up questions in followupText (extraction-friendly)
- Keep follow-up questions short and actionable
- Examples: "Would you like to see options under $30?", "Do you prefer products for sensitive skin?"
- For product-specific queries: Ask relevant follow-ups like "Would you like to know about similar products?" or "Do you have any other questions about this product?"

OUTPUT FORMAT:
Return valid JSON with:
{
  "replyText": "Your reply here (under 60 words for discovery queries, up to 150 words for product-specific Q&A)",
  "followupText": "Optional follow-up question(s) (1-2 questions, keep short)"
}`;

export const LOCCITANE_RAG_REPLY_SCHEMA = {
  name: 'LocciReplyResult',
  schema: {
    type: 'object',
    properties: {
      replyText: {
        type: 'string',
        description: 'Concise reply text (under 60 words, 1-2 paragraphs)',
      },
      followupText: {
        type: 'string',
        description: 'Optional follow-up question(s) (1-2 short questions)',
      },
    },
    required: ['replyText'],
  },
};

export const LOCCITANE_QUERY_CLASSIFIER_SCHEMA = {
  name: 'QueryClassification',
  schema: {
    type: 'object',
    required: ['type', 'constraints'],
    properties: {
      type: {
        type: 'string',
        enum: ['direct_product_search', 'symptom_concern', 'ingredient_exploration', 'gift_or_vague', 'unrelated'],
      },
      constraints: {
        type: 'object',
        required: [],
        properties: {
          concerns: { type: 'array', items: { type: 'string' } },
          skinTypes: { type: 'array', items: { type: 'string' } },
          hairTypes: { type: 'array', items: { type: 'string' } },
          applicationAreas: { type: 'array', items: { type: 'string' } },
          productTypes: { type: 'array', items: { type: 'string' } },
          collections: { type: 'array', items: { type: 'string' } },
          priceMinCents: { type: ['number', 'null'] },
          priceMaxCents: { type: ['number', 'null'] },
          mustHaveIngredients: { type: 'array', items: { type: 'string' } },
          avoidIngredients: { type: 'array', items: { type: 'string' } },
          madeWithout: { type: 'array', items: { type: 'string' } },
          ageGroups: { type: 'array', items: { type: 'string' } },
          genders: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

/**
 * DEPRECATED: Single-shot prompt (no longer used)
 * 
 * This prompt was used in the old orchestrator before multi-view retrieval.
 * The new pipeline uses:
 * - LOCCITANE_QUERY_CLASSIFIER_PROMPT for classification
 * - LOCCITANE_RAG_REPLY_PROMPT for reply generation
 * 
 * Kept for reference only. Do not use in new code.
 * 
 * @deprecated Use LOCCITANE_QUERY_CLASSIFIER_PROMPT + LOCCITANE_RAG_REPLY_PROMPT instead
 */
export const LOCCITANE_SINGLE_SHOT_PROMPT = `You are a helpful shopping assistant for L'Occitane en Provence, a French beauty and skincare brand.

PRODUCT CATEGORIES:
${LOCCITANE_ONTOLOGY.productTypes.join(', ')}

MAJOR COLLECTIONS:
${LOCCITANE_ONTOLOGY.collections.join(', ')}

COMMON CONCERNS:
${LOCCITANE_ONTOLOGY.concerns.join(', ')}

KEY INGREDIENTS:
${LOCCITANE_ONTOLOGY.ingredients.join(', ')}

Your task: Given a user's shopping query, extract their intent and generate a brief, friendly response.

OUTPUT JSON:
{
  "searchQuery": "optimized search query with product type and keywords",
  "productType": "Hand Cream" | "Body Lotion" | "Shower Oil" | "Face Serum" | "Gift Set" | null,
  "collection": "Shea" | "Almond" | "Immortelle Divine" | "Verbena" | null,
  "concern": "dryness" | "aging" | "dullness" | null,
  "priceMax": number | null,
  "replyOpener": "Brief 1-2 sentence friendly introduction explaining what you found. Be warm and helpful. Reference the user's request naturally.",
  "isGiftSet": boolean
}

RULES:
- Keep replyOpener under 40 words
- Be conversational and friendly
- If user asks for a specific product type, extract it accurately
- If user mentions a concern (dry skin, aging, etc.), extract it
- If user mentions a budget, extract it
- If user asks for a gift, set isGiftSet to true
- searchQuery should include the product type and key keywords for database search

EXAMPLES:

Input: "I need hand cream for dry hands"
Output: {
  "searchQuery": "hand cream dry",
  "productType": "Hand Cream",
  "concern": "dryness",
  "replyOpener": "I found some excellent hand creams perfect for dry hands. Here are our top picks:",
  "isGiftSet": false
}

Input: "gift set under $50"
Output: {
  "searchQuery": "gift set",
  "productType": "Gift Set",
  "priceMax": 50,
  "replyOpener": "I found some lovely gift sets under $50. Perfect for gifting:",
  "isGiftSet": true
}

Input: "anti-aging face serum"
Output: {
  "searchQuery": "face serum anti-aging",
  "productType": "Face Serum",
  "collection": "Immortelle Divine",
  "concern": "aging",
  "replyOpener": "Our Immortelle Divine collection has excellent anti-aging serums. Here's what I found:",
  "isGiftSet": false
}`;

/**
 * DEPRECATED: JSON schema for single-shot response (no longer used)
 * 
 * @deprecated See LOCCITANE_QUERY_CLASSIFIER_SCHEMA and LOCCITANE_RAG_REPLY_SCHEMA instead
 */
export const LOCCITANE_SINGLE_SHOT_SCHEMA = {
  name: 'loccitane_single_shot',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['searchQuery', 'replyOpener'],
    properties: {
      searchQuery: {
        type: 'string',
      },
      productType: {
        type: ['string', 'null'],
        enum: [
          'Hand Cream',
          'Body Lotion',
          'Shower Oil',
          'Shower Gel',
          'Face Serum',
          'Face Cleanser',
          'Face Moisturizer',
          'Lip Balm',
          'Shampoo',
          'Conditioner',
          'Gift Set',
          null,
        ],
      },
      collection: {
        type: ['string', 'null'],
        enum: [
          'Shea',
          'Almond',
          'Immortelle Divine',
          'Verbena',
          'Cherry Blossom',
          'Lavande Poivre Noir',
          null,
        ],
      },
      concern: {
        type: ['string', 'null'],
        enum: [
          'dryness',
          'aging',
          'dullness',
          'sensitive skin',
          'frizz',
          'hair breakage',
          null,
        ],
      },
      priceMax: {
        type: ['number', 'null'],
      },
      replyOpener: {
        type: 'string',
      },
      isGiftSet: {
        type: 'boolean',
      },
    },
  },
};

