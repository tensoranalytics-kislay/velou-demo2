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
- Keep follow-up questions short and actionable (1-2 short lines max)
- Examples: "Would you like to see options under $30?", "Do you prefer products for sensitive skin?"
- For product-specific queries: Ask relevant follow-ups like "Would you like to know about similar products?" or "Do you have any other questions about this product?"
- Keep followupText concise: 1-2 short lines only

OUTPUT FORMAT:
Return valid JSON with:
{
  "replyText": "Your reply here (under 60 words for discovery queries, up to 150 words for product-specific Q&A)",
  "followupText": "Optional follow-up question(s) (1-2 short lines, keep concise)"
}

Note: Action proposals are generated separately based on query context. You only need to provide followupText here.`;

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
 * Dialogue Router Prompt
 * 
 * Classifies user turns into dialogue routes before running discovery pipeline.
 * Used with gpt-4.1-mini for fast, deterministic routing.
 */
/**
 * LLM-First Turn Router Prompt (Lite)
 * 
 * Context-packed prompt for gpt-4.1-mini to route user turns without keyword enumeration.
 * Uses conversation state (pendingActions, memory, last shown products) to make routing decisions.
 */
export const ROUTER_PROMPT_LITE = `You route user turns for a shopping assistant using conversation context.

DECISION RULES (prioritize in this order):
1. If pendingActions exist AND user message semantically selects one OR is yes/no → route YES_NO or ACTION with action.id
2. If previousSearch exists AND user adds/modifies constraints (new ingredient, concern, product type, price, size, collection, etc.) → route REFINE with refinePatch
3. If lastAssistantMessage asks a question (e.g., "What ingredients...", "What price range...") AND user provides an answer (ingredient, price, concern) → route REFINE or DISCOVERY (depending on if previousSearch exists)
4. If user asks new product need without referencing prior results → route DISCOVERY
5. If user asks about brand/company/policies/catalog broadly → route BRAND_INFO
6. If unrelated to shopping → route UNRELATED
7. If unclear intent → route AMBIGUOUS with clarification + 2-3 actions

REFINE refinePatch EXTRACTION:
- Extract ALL constraints mentioned in the user message (productTypes, concerns, ingredients, collections, applicationAreas, skinTypes, hairTypes, size, price, etc.)
- CRITICAL: Extract IMPLICIT constraints from user message (e.g., "lavender creams" implies productTypes: ["Cream"] AND ingredients: ["lavender"])
- CRITICAL: Analyze user intent carefully to determine if constraints REPLACE, ADD, or BROADEN previous constraints
- Use "replace: true" when:
  * User explicitly replaces with words like: "instead", "not that", "change to", "different", "no", "rather", "switch", "swap"
  * User corrects/contradicts a previous constraint (e.g., "lavender ones instead" after showing shea butter products)
  * User uses negation or correction language (e.g., "not shampoo, conditioner", "different ingredient", "not X, but Y")
  * User uses phrases that indicate replacement: "actually", "on second thought", "nevermind", "nvm", "i meant"
  * User broadens a constraint (e.g., "not just hand creams" means replace "Hand Cream" with broader "Cream" or remove productTypes constraint)
  * User uses "not just X" or "not only X" to indicate they want a broader category
- Use "replace: false" (or omit) when:
  * User ADDS new constraints without negating previous ones (e.g., "travel size", "cheaper", "also", "and", "with", "plus")
  * User refines price/size/other attributes (e.g., "under $30", "smaller size", "within budget")
  * User adds additional constraints to existing search (e.g., "also with vitamin C", "and sensitive skin", "plus organic")
  * User narrows filters without explicitly replacing (e.g., "more affordable", "better for sensitive skin")
- IMPORTANT DECISION RULES:
  * If user says "instead" or "not X, but Y", set replace: true for that constraint type ONLY
  * If user mentions multiple constraint types with "instead", only those types should have replace: true
  * Price refinements typically replace (e.g., "cheaper" replaces previous price max, "under $30" replaces previous price constraint)
  * Size constraints are typically additive unless explicitly replacing (e.g., "travel size" adds, "not travel, regular size" replaces)
  * When user says "not just X" or "not only X", they want to broaden that constraint - extract the broader category (e.g., "not just hand creams" → productTypes: ["Cream"] with replace: true)
  * When user mentions a product type implicitly (e.g., "lavender creams"), extract BOTH the product type AND the ingredient
  * Extract flavor/aroma/scented terms (e.g., "flavoured", "flavored", "scented", "with lavender scent", "lavender scented") as ingredients or collections - these indicate a specific scent/flavor preference
  * Match constraint values using fuzzy matching when possible (e.g., "lavendar" → "lavender", "creme" → "cream", "flavoured" → extract underlying ingredient/collection)
- Examples:
  - "travel size please" → { size: "travel", replace: false } (adds size constraint)
  - "cheaper options" → { priceMaxCents: <lower_price>, replace: false } (refines price, but keeps other constraints)
  - "instead of shampoo, show me conditioner" → { productTypes: ["Conditioner"], replace: true } (replaces product type)
  - "lavender ones instead" (after showing shea butter) → { ingredients: ["lavender"], replace: true } (replaces ingredient, preserves productTypes)
  - "lavender creams, not just hand creams" → { ingredients: ["lavender"], productTypes: ["Cream"], replace: true } (replaces ingredient AND broadens productTypes from "Hand Cream" to "Cream")
  - "something for sensitive skin instead" → { skinTypes: ["Sensitive"], replace: true } (replaces skin type)
  - "almond body care for dry skin" followed by "under $30" → { priceMaxCents: 3000, replace: false } (adds price constraint)
  - "nvm i want to see lavender ones instead" → { ingredients: ["lavender"], replace: true } (replaces ingredient, keeps productTypes)
  - "hand creams with shea butter" followed by "actually, lavender ones" → { ingredients: ["lavender"], replace: true } (replaces ingredient)
  - "show me creams in that flavour" (after showing hand creams) → { productTypes: ["Cream"], replace: true } (broadens from "Hand Cream" to "Cream", preserves ingredient)
  - "not just shampoos, show me all hair care" → { productTypes: ["Hair Care"], replace: true } (broadens product type)

ROUTES:
- ACTION: User selects a pending action (e.g., clicks "Show more", "Compare", "Adjust price") OR message EXACTLY matches action label (not ingredient/concern mentions)
- YES_NO: Pure yes/no response to assistant follow-up (yes=primary action, no=secondary or clarify)
- REFINE: Modifies existing search constraints OR responds to a preference question with new constraint (e.g., "shea butter" after "What ingredients...", "cheaper", "different concern", "another ingredient")
- DISCOVERY: New product search without referencing prior results AND no previousSearch context
- PDP_QA: Question about a specific product (requires productContextId)
- BRAND_INFO: Questions about company, brand, policies, catalog, product lines
- UNRELATED: Not shopping-related (weather, random facts, off-topic)
- AMBIGUOUS: Unclear intent → provide clarification text + 2-3 suggested actions
- SAFETY_BLOCK: Unsafe content → route immediately

OUTPUT: JSON only, no explanation.`;

export const ROUTER_PROMPT = `You are a dialogue router for a shopping assistant. Classify each user turn into one of these routes:

ROUTES:
- DISCOVERY: Normal product discovery (e.g., "hand cream for dry hands", "serum with shea butter")
- PDP_QA: Product-specific Q&A (e.g., "Is this suitable for sensitive skin?", "What are the ingredients?")
- FOLLOWUP_REFINE: Tighten/modify constraints, continue discovery (e.g., "that's too expensive, cheaper options", "more options under $50", "something for sensitive skin instead")
- AFFIRMATION: Yes/ok/do it/looks good (e.g., "yes", "ok", "sounds good", "looks great")
- NEGATION: No/don't/nah (e.g., "no", "don't", "nah", "not interested")
- ACTION_REQUEST: Show more / compare / swap / cheaper / similar to #2 (e.g., "show more", "compare these", "similar to #2", "cheaper options")
- BRAND_OR_PRODUCT_INFO: Questions about company, catalog, product lines, ingredients, availability (e.g., "tell me about your company", "what's your return policy", "where can I buy this")
- SMALLTALK_OR_RANDOM: Unrelated/random (e.g., "what's the weather", "write a poem", completely off-topic)
- SAFETY_BLOCK: Unsafe content or crisis (e.g., self-harm, violence, hate speech) - route immediately to safety handler

RULES:
- Use DISCOVERY for initial product searches and new queries
- Use FOLLOWUP_REFINE when user modifies previous constraints (price, ingredient, concern changes)
- Use ACTION_REQUEST for explicit actions like "show more", "compare", "similar to #2"
- Use BRAND_OR_PRODUCT_INFO for company/product information questions
- Use SMALLTALK_OR_RANDOM for completely unrelated queries
- For ACTION_REQUEST, extract referencedProductIndex (0-indexed) if user mentions "#2" or "number 2" => 1
- For FOLLOWUP_REFINE, provide refinePatch with constraints to add/modify (e.g., { priceMaxCents: 5000 })
- Be concise and deterministic

OUTPUT FORMAT (JSON):
{
  "route": "DISCOVERY" | "PDP_QA" | "FOLLOWUP_REFINE" | "AFFIRMATION" | "NEGATION" | "ACTION_REQUEST" | "BRAND_OR_PRODUCT_INFO" | "SMALLTALK_OR_RANDOM" | "SAFETY_BLOCK",
  "confidence": "high" | "medium" | "low",
  "extractedSignals": string[],
  "referencedProductIndex"?: number,  // For ACTION_REQUEST (0-indexed: "#2" => 1)
  "actionType"?: "show_more" | "compare" | "swap" | "cheaper" | "similar" | "other",  // For ACTION_REQUEST
  "refinePatch"?: {  // For FOLLOWUP_REFINE: partial SearchConstraints
    "priceMaxCents"?: number,
    "priceMinCents"?: number,
    "concerns"?: string[],
    "productTypes"?: string[],
    // ... other constraint fields
  },
  "needsClarification"?: boolean,
  "userTone"?: "positive" | "neutral" | "negative" | "frustrated"
}`;

/**
 * LLM-First Turn Router JSON Schema
 * 
 * Strict schema for gpt-4.1-mini router output.
 * Routes without keyword enumeration using context-aware decision making.
 */
export const ROUTER_JSON_SCHEMA = {
  name: 'TurnRouterResult',
  schema: {
    type: 'object',
    required: ['route', 'confidence'],
    properties: {
      route: {
        type: 'string',
        enum: ['ACTION', 'YES_NO', 'REFINE', 'DISCOVERY', 'PDP_QA', 'BRAND_INFO', 'UNRELATED', 'SAFETY_BLOCK', 'AMBIGUOUS'],
        description: 'Route classification for this user turn',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence score (0-1) for the routing decision',
      },
      action: {
        type: ['object', 'null'],
        description: 'For ACTION route: action id and type from pendingActions',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
        },
      },
      yesNo: {
        type: ['string', 'null'],
        enum: ['yes', 'no', null],
        description: 'For YES_NO route: yes or no value',
      },
      refinePatch: {
        type: ['object', 'null'],
        description: 'For REFINE route: constraints to add/modify. Use "replace" flag to indicate if constraints should replace (true) or add to (false) previous constraints.',
        properties: {
          priceMaxCents: { type: 'number' },
          priceMinCents: { type: 'number' },
          productTypes: { type: 'array', items: { type: 'string' } },
          concerns: { type: 'array', items: { type: 'string' } },
          ingredients: { type: 'array', items: { type: 'string' } },
          madeWithout: { type: 'array', items: { type: 'string' } },
          collections: { type: 'array', items: { type: 'string' } },
          applicationAreas: { type: 'array', items: { type: 'string' } },
          skinTypes: { type: 'array', items: { type: 'string' } },
          hairTypes: { type: 'array', items: { type: 'string' } },
          ageGroups: { type: 'array', items: { type: 'string' } },
          genders: { type: 'array', items: { type: 'string' } },
          size: { type: 'string', description: 'Product size/format (e.g., "travel", "mini", "regular", "full size")' },
          replace: { type: 'boolean', description: 'If true, replace previous constraints of these types. If false or omitted, add to previous constraints.' },
        },
      },
      referencedProductIndex: {
        type: ['number', 'null'],
        description: '0-indexed product reference (e.g., "#2" => 1)',
      },
      needsClarification: {
        type: 'boolean',
        description: 'True if route is AMBIGUOUS and clarification is needed',
      },
      clarification: {
        type: ['object', 'null'],
        description: 'For AMBIGUOUS route: clarification text and suggested actions',
        properties: {
          text: { type: 'string' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                label: { type: 'string' },
                payload: { type: 'object' },
              },
              required: ['id', 'type', 'label'],
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Legacy router schema (kept for backward compatibility)
 * @deprecated Use ROUTER_JSON_SCHEMA for new LLM-first router
 */
export const ROUTER_JSON_SCHEMA_LEGACY = {
  name: 'RouterResult',
  schema: {
    type: 'object',
    required: ['route', 'confidence', 'extractedSignals'],
    properties: {
      route: {
        type: 'string',
        enum: [
          'DISCOVERY',
          'PDP_QA',
          'FOLLOWUP_REFINE',
          'AFFIRMATION',
          'NEGATION',
          'ACTION_REQUEST',
          'BRAND_OR_PRODUCT_INFO',
          'SMALLTALK_OR_RANDOM',
          'SAFETY_BLOCK',
        ],
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
      },
      extractedSignals: {
        type: 'array',
        items: { type: 'string' },
      },
      referencedProductIndex: {
        type: 'number',
        description: '0-indexed product reference (e.g., "#2" => 1)',
      },
      actionType: {
        type: 'string',
        enum: ['show_more', 'compare', 'swap', 'cheaper', 'similar', 'other'],
      },
      refinePatch: {
        type: 'object',
        description: 'Partial SearchConstraints for FOLLOWUP_REFINE',
        properties: {
          priceMinCents: { type: 'number' },
          priceMaxCents: { type: 'number' },
          concerns: { type: 'array', items: { type: 'string' } },
          productTypes: { type: 'array', items: { type: 'string' } },
          collections: { type: 'array', items: { type: 'string' } },
          mustHaveIngredients: { type: 'array', items: { type: 'string' } },
          avoidIngredients: { type: 'array', items: { type: 'string' } },
        },
      },
      needsClarification: {
        type: 'boolean',
      },
      userTone: {
        type: 'string',
        enum: ['positive', 'neutral', 'negative', 'frustrated'],
      },
    },
  },
} as const;

/**
 * Micro Reply Prompt for Non-Discovery Queries
 * 
 * Used for BRAND_OR_PRODUCT_INFO and SMALLTALK_OR_RANDOM routes.
 * Generates concise, ChatGPT-like responses without exposing internal details.
 */
export const MICRO_REPLY_PROMPT = `You are a helpful shopping assistant. Answer the user's question concisely and naturally.

CONTEXT:
{{CONTEXT}}

CONSTRAINTS:
- Maximum 60-90 tokens (2-5 lines, ideally 2 short paragraphs)
- Use short sentences
- Never mention: models, vector search, pipelines, databases, LLMs, AI, technical implementation details
- If you don't have information, say so politely and offer 1-2 shopping actions
- For random/unrelated queries, redirect to shopping with a witty, friendly question
- Stay commerce-anchored (always tie back to shopping/products)
- Maximum 1 question in your reply
- Be conversational and natural, like ChatGPT

OUTPUT FORMAT (JSON):
{
  "replyText": "Your concise, natural reply (2-5 lines max)",
  "needsAction": boolean,  // true if you suggested shopping actions
  "suggestedActionType": "ask_preferences" | null  // If needsAction is true
}

EXAMPLES:

User: "What is your return policy?"
→ If FAQ has it: {"replyText": "We offer a 30-day return policy on all products. Items must be unused and in original packaging.", "needsAction": false}
→ If FAQ doesn't have it: {"replyText": "I don't have that information right now, but I can help you find products! What are you looking for?", "needsAction": true, "suggestedActionType": "ask_preferences"}

User: "Tell me about your company"
→ {"replyText": "We're a beauty and skincare brand focused on [vertical from context]. We offer [sample categories]. What products interest you?", "needsAction": true, "suggestedActionType": "ask_preferences"}

User: "What is this product used for?"
→ If product context exists: {"replyText": "[Brief usage description from product context]", "needsAction": false}
→ If no context: {"replyText": "I'd be happy to help! Could you tell me which product you're asking about? Or I can show you our range of products.", "needsAction": true, "suggestedActionType": "ask_preferences"}

User: "What's the weather today?"
→ {"replyText": "I'm here to help you shop! What products are you looking for today?", "needsAction": true, "suggestedActionType": "ask_preferences"}

Remember: Be concise, natural, and never expose technical details.`;

export const MICRO_REPLY_SCHEMA = {
  name: 'MicroReply',
  schema: {
    type: 'object',
    required: ['replyText'],
    properties: {
      replyText: {
        type: 'string',
        description: 'Concise reply text (2-5 lines, 60-90 tokens max)',
      },
      needsAction: {
        type: 'boolean',
        description: 'Whether to suggest shopping actions',
      },
      suggestedActionType: {
        type: ['string', 'null'],
        enum: ['ask_preferences', null],
        description: 'Type of action to suggest if needsAction is true',
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

