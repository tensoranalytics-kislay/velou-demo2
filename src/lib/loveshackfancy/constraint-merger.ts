/**
 * Constraint Merger
 * 
 * Intelligently merges, replaces, or removes constraints from follow-up queries
 * using LLM to understand user intent (merge vs replace vs remove).
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import type { FashionConstraints } from './classifier';
import { normalizeAgeGroups } from './age-group-normalizer';
import { extractConstraintValues, extractConstraintIntent } from './constraint-utils';

// Constraint portability classification
const ALWAYS_PORTABLE_CONSTRAINTS = [
  'occasions',
  'ageGroups',
  'seasons',
  'formalityLevel'
] as const;

const NEVER_PORTABLE_CONSTRAINTS = [
  'lengths',
  'sleeveLengths',
  'necklines',
  'fits',
  'braSolution',
  'pockets',
  'liningType',
  'scents',
  'rooms'
] as const;

const CONTEXT_DEPENDENT_CONSTRAINTS = [
  'styles',
  'materials',
  'patterns',
  'embellishments',
  'travelFeatures',
  'careRequirements',
  'ecoMaterials',
  'temperatureIntent',
  'humidityFriendly'
] as const;

export type ConstraintMergeResult = {
  mergedConstraints: FashionConstraints;
  enhancedQueryText: string; // Enhanced query text for vector search
  mergeAction: 'merge' | 'replace' | 'remove' | 'new_search';
  reason: string;
};

/**
 * Get the category group (Apparel, Accessories, Home & Living, etc.) for a category
 */
function getCategoryGroup(category: string): string {
  const apparelCategories = [
    "Women's Dresses", "Tops", "Bottoms", "Skirts", "Skorts",
    "Activewear", "Swimsuits", "Bikini Sets", "Swim Cover-ups",
    "Cold Weather Essentials", "Loungewear", "Robes", "Pajama Set",
    "Shoes", "Ski Jackets", "Ski Tops", "Ski Shoes", "Sweaters",
    "Mini Dress", "Maxi Dress", "Tote Bags"
  ];
  
  const kidsCategories = [
    "Girls Tops", "Girls Bottoms", "Girls Dresses", "Girls Swimwear",
    "Baby & Toddler Bottoms", "Tween Pants", "Tween Sweaters", "Tween Dresses"
  ];
  
  const accessoriesCategories = [
    "Accessories", "Jewelry", "Hair Accessories", "Pocket Squares",
    "Phone Cases", "Soap Dispensers", "Makeup Kit"
  ];
  
  const homeCategories = [
    "Bedding", "Bathroom", "Towels", "Tabletop", "Kitchen & Dining",
    "Stationary", "Interiors", "Candle", "Decorative Dishes", "Fragrance Tray", "Pets"
  ];
  
  const personalCareCategories = ["Perfumes"];
  
  if (apparelCategories.includes(category) || kidsCategories.includes(category)) {
    return 'Apparel';
  }
  if (accessoriesCategories.includes(category)) {
    return 'Accessories';
  }
  if (homeCategories.includes(category)) {
    return 'Home & Living';
  }
  if (personalCareCategories.includes(category)) {
    return 'Personal Care';
  }
  
  return 'Unknown';
}

/**
 * Check if categories are in the same vertical/group
 */
function areCategoriesSimilar(
  previousCategories: string[],
  currentCategories: string[]
): boolean {
  if (previousCategories.length === 0 || currentCategories.length === 0) {
    return false;
  }
  
  // Get verticals for previous and current categories
  const previousVerticals = new Set(
    previousCategories.map(cat => getCategoryGroup(cat))
  );
  const currentVerticals = new Set(
    currentCategories.map(cat => getCategoryGroup(cat))
  );
  
  // Check if there's any overlap
  for (const vertical of previousVerticals) {
    if (currentVerticals.has(vertical)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect explicit user intent to preserve colors or price
 */
function detectExplicitIntent(
  currentMessage: string,
  previousConstraints: FashionConstraints | null
): {
  preserveColors: boolean;
  preservePrice: boolean;
  explicitColorMentions: string[];
  explicitPriceMentions: string[];
} {
  const messageLower = currentMessage.toLowerCase();
  const explicitColorMentions: string[] = [];
  const explicitPriceMentions: string[] = [];
  
  // Detect explicit color preservation keywords
  const colorPreservationPatterns = [
    /\b(also\s+in|also|keep\s+the\s+color|same\s+color|keep\s+color|same\s+colou?r|keep\s+colou?r)\b/i,
    /\b(also\s+)?(?:red|blue|green|yellow|black|white|pink|purple|orange|brown|gray|grey|navy|beige|gold|silver|bronze|coral|mint|lavender|blush|ivory|cream|tan|teal|turquoise|emerald|burgundy|maroon|plum|charcoal|sage|olive|rust|terracotta|peach|lemon|cherry|crimson|scarlet|chocolate|whisper\s+blue|daydream\s+pink|hibiscus|rose|pink|blue|green|yellow|purple|orange)\b/i
  ];
  
  // Check for explicit color mentions in current message
  colorPreservationPatterns.forEach(pattern => {
    const matches = currentMessage.match(pattern);
    if (matches) {
      explicitColorMentions.push(...matches);
    }
  });
  
  // Detect explicit price preservation keywords
  const pricePreservationPatterns = [
    /\b(same\s+price\s+range|same\s+range|same\s+price|in\s+same\s+range|in\s+same\s+price\s+range|keep\s+the\s+price|same\s+cost|same\s+budget)\b/i,
    /\b(under|below|up\s+to|over|above|at\s+least|between)\s+\$?\d+/i
  ];
  
  // Check for explicit price mentions in current message
  pricePreservationPatterns.forEach(pattern => {
    const matches = currentMessage.match(pattern);
    if (matches) {
      explicitPriceMentions.push(...matches);
    }
  });
  
  const preserveColors = explicitColorMentions.length > 0;
  const preservePrice = explicitPriceMentions.length > 0;
  
  return {
    preserveColors,
    preservePrice,
    explicitColorMentions: Array.from(new Set(explicitColorMentions)),
    explicitPriceMentions: Array.from(new Set(explicitPriceMentions)),
  };
}

const CONSTRAINT_MERGER_PROMPT = `You are a constraint merger for a shopping assistant. The catalog includes multiple category groups: Kids, Women's/Adult Apparel, Accessories, Personal Care, and Home & Living (48 total categories). You handle constraint merging for queries across all these category groups.

PREVIOUS QUERY: "{PREVIOUS_QUERY}"
PREVIOUS CONSTRAINTS: {PREVIOUS_CONSTRAINTS}
PREVIOUS BOT REPLY: "{PREVIOUS_BOT_REPLY}"
PREVIOUS CATEGORIES: {PREVIOUS_CATEGORIES}
CURRENT CATEGORIES: {CURRENT_CATEGORIES}
CATEGORIES_ARE_SIMILAR: {CATEGORIES_ARE_SIMILAR}
USER_EXPLICITLY_PRESERVES_COLORS: {USER_EXPLICITLY_PRESERVES_COLORS}
USER_EXPLICITLY_PRESERVES_PRICE: {USER_EXPLICITLY_PRESERVES_PRICE}
EXPLICIT_COLOR_MENTIONS: {EXPLICIT_COLOR_MENTIONS}
EXPLICIT_PRICE_MENTIONS: {EXPLICIT_PRICE_MENTIONS}

CURRENT FOLLOW-UP MESSAGE: "{CURRENT_MESSAGE}"

CRITICAL: PREVIOUS BOT REPLY Context
- The PREVIOUS_BOT_REPLY shows what products or information the assistant just provided to the user
- If PREVIOUS_BOT_REPLY mentions specific products, attributes, or features (e.g., "Coconut Water", "floral", "silk"), the user's CURRENT_MESSAGE might be reacting to those products
- **NEGATIVE PREFERENCES** (e.g., "I don't like coconutty", "not floral", "no silk") are almost ALWAYS follow-up refinements when they reference attributes from PREVIOUS_BOT_REPLY
- When the user says "I don't like X" or "not X" after seeing products with X, this is a REFINEMENT (mergeAction: "remove" or "merge"), NOT a new search
- **PRESERVE THE PRODUCT TYPE** from PREVIOUS_QUERY when the user is refining based on shown products
- Examples:
  * PREVIOUS_QUERY="body mist", PREVIOUS_BOT_REPLY mentions "Coconut Water" products, CURRENT_MESSAGE="i dont like anything coconutty"
    → This is a FOLLOW-UP REFINEMENT (mergeAction: "remove" or "merge")
    → Preserve product type: "body mist" (from PREVIOUS_QUERY)
    → Enhanced query: "body mist without coconut" or "body mist excluding coconut"
    → Reason: "User is refining body mist search to exclude coconut, based on products shown in previous reply"
  * PREVIOUS_QUERY="dresses", PREVIOUS_BOT_REPLY mentions "floral dresses", CURRENT_MESSAGE="not floral"
    → This is a FOLLOW-UP REFINEMENT (mergeAction: "remove")
    → Preserve product type: "dresses" (from PREVIOUS_QUERY)
    → Enhanced query: "dresses without floral pattern" or "non-floral dresses"
  * PREVIOUS_QUERY="perfumes", PREVIOUS_BOT_REPLY shows vanilla perfumes, CURRENT_MESSAGE="something without vanilla"
    → This is a FOLLOW-UP REFINEMENT (mergeAction: "remove")
    → Preserve product type: "perfumes" (from PREVIOUS_QUERY)
    → Enhanced query: "perfumes without vanilla"

CRITICAL: PREVIOUS_QUERY may be an ENHANCED QUERY from a previous merge
- PREVIOUS_QUERY might be a raw user message (e.g., "dresses in light colours")
- OR it might be an enhanced query from a previous merge (e.g., "light coloured dresses")
- When PREVIOUS_QUERY is an enhanced query, it already contains ALL previously merged constraints in natural language
- Your task is to merge CURRENT_MESSAGE with this enhanced query to create a NEW enhanced query
- Example chain:
  1. User: "dresses in light colours" → Enhanced: "light coloured dresses" (stored)
  2. User: "only in light colours" → Merge with "light coloured dresses" → Enhanced: "light coloured dresses" (already has it, stored)
  3. User: "find floral ones" → Merge with "light coloured dresses" → Enhanced: "light coloured floral dresses" (stored)
  4. User: "under $150" → Merge with "light coloured floral dresses" → Enhanced: "light coloured floral dresses under $150"
- Each merge builds on the previous enhanced query, creating cumulative context

CRITICAL: DECOMPOSE THEN RECOMPOSE - NEVER CONCATENATE

When PREVIOUS_QUERY contains multiple components, you MUST:
1. **DECOMPOSE** PREVIOUS_QUERY into structured components:
   - Product type: "hoodies", "dresses", "jewelry", "bedding", etc.
   - Colors: "black", "red", "blue", etc. (if present)
   - Materials: "silk", "cotton", etc. (if present)
   - Audience/age group: "for curvy women", "for kids", "for adults", etc.
   - Occasions: "for wedding", "for beach", etc. (if present)
   - Other attributes: sizes, patterns, styles, etc.

2. **EXTRACT** new constraints from CURRENT_MESSAGE:
   - Identify what's being added/changed/removed
   - Determine merge action: merge, replace, or remove

3. **RECOMPOSE** using natural attribute ordering:
   - Order: color → material → product type → style details → size → occasion → age group → price
   - Remove redundant phrases (don't repeat "for curvy women" if already present)
   - Integrate new constraints into their natural positions

4. **NEVER CONCATENATE**: Do NOT append PREVIOUS_QUERY + CURRENT_MESSAGE as strings

Examples of CORRECT decomposition/recomposition:
- PREVIOUS="hoodies for curvy women" → Decompose: {productType: "hoodies", audience: "for curvy women"}
  CURRENT="in black" → Extract: {color: "black"}
  Recompose: "black hoodies for curvy women" ✓

- PREVIOUS="red silk maxi dress" → Decompose: {color: "red", material: "silk", length: "maxi", productType: "dress"}
  CURRENT="change to navy" → Extract: {color: "navy"} (REPLACE)
  Recompose: "navy silk maxi dress" ✓

- PREVIOUS="dresses for kids" → Decompose: {productType: "dresses", ageGroup: "for kids"}
  CURRENT="in pink" → Extract: {color: "pink"}
  Recompose: "pink dresses for kids" ✓

- PREVIOUS="jewelry for wedding" → Decompose: {productType: "jewelry", occasion: "for wedding"}
  CURRENT="in gold" → Extract: {color: "gold"}
  Recompose: "gold jewelry for wedding" ✓

- PREVIOUS="bedding sets" → Decompose: {productType: "bedding sets"}
  CURRENT="with floral patterns" → Extract: {pattern: "floral"}
  Recompose: "bedding sets with floral patterns" ✓

Examples of WRONG concatenation (DO NOT DO THIS):
- PREVIOUS="hoodies for curvy women" + CURRENT="in black" → "hoodies for curvy women black clothing for curvy women" ✗
- PREVIOUS="dresses" + CURRENT="in pink" → "dresses pink clothing" ✗
- PREVIOUS="jewelry" + CURRENT="in gold" → "jewelry gold accessories" ✗

CRITICAL: ALWAYS Preserve Product Type from PREVIOUS_QUERY or CONVERSATION HISTORY
- **MOST IMPORTANT RULE**: If PREVIOUS_QUERY mentions a product type (dresses, tops, swimsuits, bikinis, joggers, etc.), you MUST preserve it in enhancedQueryText, even if CURRENT_MESSAGE doesn't mention it
- **EXCEPTION: Explicit Product Type Switch** (HIGHEST PRIORITY): If CURRENT_MESSAGE explicitly mentions a DIFFERENT product type (e.g., "looking for hoodies", "show me tops", "I want dresses"), this is a product type switch. The enhanced query should use ONLY the new product type from CURRENT_MESSAGE, NOT preserve the old one.
  * Example: PREVIOUS="black dresses" + CURRENT="looking for hoodies" → enhancedQueryText="hoodies" (NOT "hoodies and dresses")
  * Example: PREVIOUS="dresses in light colours" + CURRENT="show me tops instead" → enhancedQueryText="tops" (NOT "tops and dresses")
  * Example: PREVIOUS="suggest me something to wear" (vague) + CURRENT="looking for hoodies" → enhancedQueryText="hoodies" (NOT "hoodies and dresses")
  * **Key phrases that indicate explicit product type switch**: "looking for X", "show me X", "I want X", "need X", "want X", "X please", "X instead"
  * **When user explicitly mentions a product type, that product type MUST be the ONLY one in the enhanced query**
- **TRACE BACK THROUGH CONVERSATION HISTORY**: If PREVIOUS_QUERY doesn't mention a product type, look at CONVERSATION HISTORY to find where the product type was first mentioned
  * Example: If conversation history shows:
    1. "dresses in light colours"
    2. "only in light colours" (PREVIOUS_QUERY - doesn't mention "dresses")
    3. "find floral ones" (CURRENT_MESSAGE)
  * You should trace back to query #1 to find "dresses" as the product type
  * Enhanced query should be: "light coloured floral dresses" (NOT "light coloured floral items")
- **Examples of preserving product type** (when NOT switching):
  * PREVIOUS_QUERY="dresses in light colours", CURRENT_MESSAGE="only in light colours" → enhancedQueryText="light coloured dresses" (PRESERVE "dresses")
  * PREVIOUS_QUERY="dresses in light colours", CURRENT_MESSAGE="find floral ones" → enhancedQueryText="light coloured floral dresses" (PRESERVE "dresses", merge "floral")
  * PREVIOUS_QUERY="only in light colours" (but history shows "dresses in light colours"), CURRENT_MESSAGE="find floral ones" → enhancedQueryText="light coloured floral dresses" (TRACE BACK to find "dresses")
  * PREVIOUS_QUERY="show me dresses", CURRENT_MESSAGE="in pink" → enhancedQueryText="pink dresses" (PRESERVE "dresses")
  * PREVIOUS_QUERY="tops under $100", CURRENT_MESSAGE="make it cheaper" → enhancedQueryText="tops under $X" (PRESERVE "tops")
  * PREVIOUS_QUERY="swimsuits for beach", CURRENT_MESSAGE="one piece please" → enhancedQueryText="one piece swimsuits for beach" (PRESERVE "swimsuits", add "one piece")
- **Inferring product type when PREVIOUS_QUERY is incomplete**:
  * If PREVIOUS_QUERY is incomplete (e.g., "one piece please"), FIRST check CONVERSATION HISTORY to trace back to original product type
  * If history doesn't help, look at PREVIOUS_CONSTRAINTS to infer the full product type
  * If PREVIOUS_CONSTRAINTS has styles like ["One-Piece", "Swimsuit"], the previous query was about "one piece swimsuit"
  * If PREVIOUS_CONSTRAINTS has categories or styles, use them to construct the complete product type
  * If PREVIOUS_CONSTRAINTS is null, parse PREVIOUS_QUERY to extract product type (e.g., "Girls Swimwear Bikinis" → product type is "bikini" or "swimwear", ageGroups: ["kids"])
- **The enhanced query MUST include the complete product type** (e.g., "one piece swimsuit under $150", NOT just "one piece under $150")
- **NEVER drop the product type** unless CURRENT_MESSAGE explicitly changes it (e.g., "show me tops instead" after "dresses")

Your task:
1. **CRITICAL FIRST STEP**: Use human judgment and logical reasoning to determine if this is truly a follow-up or a NEW SEARCH
   
   **LOGICAL CONSISTENCY CHECK** (Most Important - Use Human Judgment):
   - **CRITICAL**: Before determining if this is a follow-up, use human judgment to evaluate ALL aspects:
     * Product type compatibility (e.g., dress vs joggers)
     * Age group appropriateness (e.g., newborns don't wear joggers, adults don't wear newborn sizes)
     * Occasion/context compatibility (e.g., bikinis not for weddings)
     * Product category compatibility (e.g., swimwear not for office)
   - If ANY aspect is INCOMPATIBLE, this is a NEW SEARCH (use mergeAction: "new_search")
   - **Product Type + Age Group Compatibility** (CRITICAL):
     * PREVIOUS="dress for newborn" + CURRENT="joggers" → NEW SEARCH (newborns don't wear joggers - they wear onesies, sleepers, dresses, rompers)
     * PREVIOUS="newborn outfit" + CURRENT="relaxed fit joggers" → NEW SEARCH (joggers are for toddlers/children/adults, not newborns)
     * PREVIOUS="baby clothes" + CURRENT="adult sizes" → NEW SEARCH (age group mismatch)
     * PREVIOUS="toddler" + CURRENT="newborn sizes" → NEW SEARCH (age group mismatch)
   - **Product Type + Occasion Compatibility**:
     * PREVIOUS="bikinis" or "swimsuits" + CURRENT="for my wedding" → NEW SEARCH (nobody wears bikinis to weddings)
     * PREVIOUS="swimwear" + CURRENT="for office" → NEW SEARCH (swimwear not appropriate for office)
     * PREVIOUS="pajamas" or "loungewear" + CURRENT="for formal event" → NEW SEARCH (pajamas not appropriate for formal events)
     * PREVIOUS="winter coats" + CURRENT="for beach" → NEW SEARCH (winter coats not for beach)
     * PREVIOUS="evening gowns" + CURRENT="for gym" → NEW SEARCH (evening gowns not for gym)
   - **Product Type Change Compatibility** (when changing product types):
     * PREVIOUS="dress for newborn" + CURRENT="joggers" → NEW SEARCH (joggers incompatible with newborn age group)
     * PREVIOUS="swimsuits" + CURRENT="winter coats" → NEW SEARCH (completely different category/season)
     * PREVIOUS="formal dress" + CURRENT="athletic wear" → NEW SEARCH (incompatible categories)
   - Examples of COMPATIBLE combinations (can be FOLLOW-UP):
     * PREVIOUS="dresses" + CURRENT="for wedding" → FOLLOW-UP (dresses are appropriate for weddings)
     * PREVIOUS="tops" + CURRENT="for office" → FOLLOW-UP (tops can be office-appropriate)
     * PREVIOUS="swimsuits" + CURRENT="for beach" → FOLLOW-UP (swimsuits are for beach)
     * PREVIOUS="loungewear" + CURRENT="for home" → FOLLOW-UP (loungewear is for home)
     * PREVIOUS="dress for newborn" + CURRENT="in pink" → FOLLOW-UP (same product type, same age group, just adding color)
     * PREVIOUS="newborn outfit" + CURRENT="for birthday" → FOLLOW-UP (outfits are appropriate for birthdays, age group matches)
   
   **OTHER NEW SEARCH SIGNALS**:
   - **CRITICAL**: If CURRENT_MESSAGE is IDENTICAL (or nearly identical) to PREVIOUS_QUERY → NEW SEARCH
     * When a user repeats the exact same query, they want to start fresh (not a follow-up refinement)
     * Example: PREVIOUS="looking for an outfit for my newborn", CURRENT="looking for an outfit for my newborn" → NEW SEARCH
     * Example: PREVIOUS="show me dresses", CURRENT="show me dresses" → NEW SEARCH
     * This is especially important for indirect searches - they should get follow-up questions again
   - If CURRENT_MESSAGE changes the product category completely (e.g., "show me tops" after "show me dresses") → NEW SEARCH
   - If CURRENT_MESSAGE asks for a completely different product type → NEW SEARCH
   - **CRITICAL: If CURRENT_MESSAGE explicitly mentions a different product type** (e.g., "looking for hoodies" after "dresses") → NEW SEARCH or explicit REPLACE (do NOT preserve old product type)
   - If CURRENT_MESSAGE explicitly says "new search", "something else", "different item" → NEW SEARCH
   
   **FOLLOW-UP SIGNALS** (only if logically compatible):
   - If CURRENT_MESSAGE mentions "close matches", "similar", "relax", "flexible", "price can be", or modifies constraints from PREVIOUS_QUERY → FOLLOW-UP
   - If CURRENT_MESSAGE is vague but mentions modifying/relaxing constraints → FOLLOW-UP
   - If product type + occasion/context are LOGICALLY COMPATIBLE → FOLLOW-UP
   - **CRITICAL: Negative preferences based on PREVIOUS_BOT_REPLY**:
     * If CURRENT_MESSAGE expresses dislike for attributes mentioned in PREVIOUS_BOT_REPLY (e.g., "don't like coconutty" when bot showed coconut products) → FOLLOW-UP REFINEMENT
     * If CURRENT_MESSAGE says "not X" or "without X" when PREVIOUS_BOT_REPLY mentioned X → FOLLOW-UP REFINEMENT
     * These are ALWAYS follow-ups because the user is refining based on what they just saw
     * **PRESERVE PRODUCT TYPE** from PREVIOUS_QUERY when refining based on shown products
   
2. **If mergeAction is "new_search"**:
   - **CRITICAL: Age Group Switch = New Search with Constraint Preservation**:
     * If this is a NEW SEARCH due to complete age group switch (e.g., children to adult, adult to children):
       - Set ageGroups to null in mergedConstraints (let classifier set the correct age group from CURRENT_MESSAGE)
       - Preserve portable constraints from PREVIOUS_CONSTRAINTS based on constraint preservation logic:
         * ALWAYS PRESERVE: occasions, seasons, formalityLevel (universal constraints)
         * PRESERVE BASED ON INTENT OR SIMILARITY: colors (preserve if explicitly mentioned in CURRENT_MESSAGE OR categories are similar OR USER_EXPLICITLY_PRESERVES_COLORS), price (preserve if explicitly mentioned OR categories are similar OR USER_EXPLICITLY_PRESERVES_PRICE)
       - Set category-specific constraints to null: lengths, sleeveLengths, necklines, fits, braSolution, pockets, liningType (category-specific)
       - Set enhancedQueryText to CURRENT_MESSAGE (fresh query, not merged with previous)
       - Example: PREVIOUS="clothes for my 6 year old and 12 year old" (ageGroups: ["Kids", "Tween"], colors: ["Red"], occasions: ["Wedding"]), CURRENT="only red dresses for adult" (ageGroups: ["Adult"], colors: ["Red"])
         → mergeAction: "new_search"
         → mergedConstraints: { ageGroups: null, colors: ["Red"] (preserved - mentioned in CURRENT_MESSAGE), occasions: ["Wedding"] (preserved - universal), lengths: null, ... (reset category-specific) }
         → enhancedQueryText: "only red dresses for adult" (CURRENT_MESSAGE as-is)
         → reason: "user switched from children's age groups to adult, treating as new search while preserving portable constraints"
   - **Standard New Search (incompatibility)**:
     * Set mergedConstraints to empty/null values (reset everything)
     * Set enhancedQueryText to CURRENT_MESSAGE (use as-is, don't merge with previous)
     * This indicates the orchestrator should treat this as a completely new search
   
3. **If it's a follow-up** (mergeAction: "merge", "replace", or "remove"):
   - Determine the user's intent: MERGE, REPLACE, or REMOVE constraints
   - Intelligently merge/replace/remove constraints based on the follow-up message
   - Create an enhanced query text that captures the complete intent, INCLUDING the full product type inferred from PREVIOUS_CONSTRAINTS

**CRITICAL: Intent-Aware Constraint Preservation Across Category Switches**

When the user switches product categories, intelligently preserve or remove constraints based on:
1. **EXPLICIT USER INTENT** (highest priority)
2. **Category similarity** (similar categories preserve more)
3. **Constraint portability** (universal vs category-specific)

**PRIORITY 1: EXPLICIT USER INTENT**
- If user explicitly mentions a constraint in the new query → PRESERVE/UPDATE it
- If user explicitly says "same", "also", "keep", "same range", "same price" → PRESERVE those constraints
- Examples:
  * PREVIOUS="gold jewelry" + CURRENT="show me cardigans in same price range" → Preserve price
  * PREVIOUS="gold jewelry" + CURRENT="show me cardigans" → Remove colors (no explicit mention)
  * PREVIOUS="red dresses" + CURRENT="show me tops also in red" → Preserve colors (explicit "also in red")

**PRIORITY 2: CATEGORY SIMILARITY**

**Similar Categories** (preserve more constraints):
- Apparel ↔ Apparel (e.g., Dresses ↔ Tops, Dresses ↔ Bottoms, Tops ↔ Sweaters)
- Accessories ↔ Accessories (e.g., Jewelry ↔ Bags, Jewelry ↔ Hair Accessories)
- Kids ↔ Kids (e.g., Girls Dresses ↔ Girls Tops)
- Home & Living ↔ Home & Living

**Dissimilar Categories** (preserve fewer constraints):
- Apparel ↔ Accessories (e.g., Jewelry ↔ Dresses, Bags ↔ Tops)
- Apparel ↔ Home & Living (e.g., Dresses ↔ Bedding)
- Accessories ↔ Personal Care (e.g., Jewelry ↔ Perfumes)

**PRIORITY 3: CONSTRAINT PORTABILITY**

**ALWAYS PRESERVE** (Universal - apply to ALL categories):
- occasions (e.g., "wedding" applies to dresses, jewelry, bags, perfumes, bedding)
- ageGroups (e.g., "Adult" applies to all categories)
- seasons (e.g., "summer" applies to all categories)
- formalityLevel (e.g., "formal" applies to all categories)

**PRESERVE BASED ON INTENT OR SIMILARITY**:
- colors:
  * PRESERVE if: User explicitly mentions color in new query OR categories are similar (apparel ↔ apparel) OR USER_EXPLICITLY_PRESERVES_COLORS is true
  * REMOVE if: Categories are dissimilar (jewelry ↔ apparel) AND color not mentioned AND USER_EXPLICITLY_PRESERVES_COLORS is false
  * Example: PREVIOUS="gold jewelry" + CURRENT="cardigans" → Remove colors (dissimilar categories, not mentioned)
  * Example: PREVIOUS="red dresses" + CURRENT="tops" → Preserve colors (similar categories, apparel ↔ apparel)

- price:
  * PRESERVE if: User explicitly says "same range", "same price", "in same price range", "under $X", "over $X", "between $X and $Y" OR categories are similar (apparel ↔ apparel) OR USER_EXPLICITLY_PRESERVES_PRICE is true
  * REMOVE if: Categories are dissimilar (jewelry ↔ apparel) AND price not mentioned AND USER_EXPLICITLY_PRESERVES_PRICE is false
  * Example: PREVIOUS="gold jewelry under $200" + CURRENT="cardigans" → Remove price (dissimilar categories, not mentioned)
  * Example: PREVIOUS="dresses under $150" + CURRENT="tops" → Preserve price (similar categories, apparel ↔ apparel)
  * Example: PREVIOUS="gold jewelry under $200" + CURRENT="cardigans in same price range" → Preserve price (explicit intent)

**ALWAYS REMOVE** (Category-Specific):
- lengths (maxi, mini, midi - only for apparel, not jewelry/bags/perfumes)
- sleeveLengths (long sleeve, short sleeve - only for apparel)
- necklines (v-neck, round neck - only for apparel)
- fits (plus size, relaxed fit - only for apparel)
- braSolution (only for apparel)
- pockets (only for apparel/bags, not jewelry/perfumes)
- liningType (only for apparel/bags)
- scents (only for perfumes/candles)
- rooms (only for home & living)

**INTELLIGENTLY PRESERVE** (Context-Dependent):
- styles, materials, patterns, embellishments, travelFeatures, careRequirements, ecoMaterials, temperatureIntent, humidityFriendly
- Preserve only if relevant to new category AND either explicitly mentioned OR categories are similar

**EXAMPLES:**

1. PREVIOUS="gold jewelry for formal event" + CURRENT="tote bags for travel"
   → Preserve: occasions=["Formal Event"] → ["Travel"] (replace with new)
   → Remove: colors=["Gold"] (dissimilar categories, not mentioned)
   → Remove: embellishments=["Pearls", "Crystals"] (category-specific)
   → Result: "tote bags for travel"

2. PREVIOUS="gold jewelry" + CURRENT="cardigans"
   → Preserve: (nothing from previous - dissimilar categories, no explicit intent)
   → Remove: colors=["Gold"] (dissimilar categories, not mentioned)
   → Result: "cardigans" (fresh start)

3. PREVIOUS="red dresses for wedding" + CURRENT="tops"
   → Preserve: colors=["Red"] (similar categories - apparel ↔ apparel)
   → Preserve: occasions=["Wedding"] (universal)
   → Remove: lengths=["Maxi"] (category-specific)
   → Result: "red tops for wedding"

4. PREVIOUS="dresses for wedding" + CURRENT="jewelry"
   → Preserve: occasions=["Wedding"] (universal)
   → Remove: lengths=["Maxi"] (category-specific)
   → Result: "jewelry for wedding"

5. PREVIOUS="gold jewelry under $200" + CURRENT="cardigans in same price range"
   → Preserve: priceMaxCents=20000 (EXPLICIT INTENT - "same price range")
   → Remove: colors=["Gold"] (dissimilar categories, not mentioned)
   → Result: "cardigans under $200"

6. PREVIOUS="dresses under $150" + CURRENT="tops"
   → Preserve: priceMaxCents=15000 (similar categories - apparel ↔ apparel)
   → Remove: lengths=["Maxi"] (category-specific)
   → Result: "tops under $150"

7. PREVIOUS="gold jewelry" + CURRENT="show me cardigans also in gold"
   → Preserve: colors=["Gold"] (EXPLICIT INTENT - "also in gold")
   → Result: "gold cardigans"

CRITICAL: Logical Incompatibility = New Search (Most Important)
- **Use human judgment and common sense**: Would a reasonable person wear/use the previous product type for the new occasion/context? Does the product type make sense for the age group?
- **Think like a human**: If something doesn't make logical sense (e.g., joggers for a newborn, bikinis for a wedding), it's a NEW SEARCH
- Examples of INCOMPATIBLE (use mergeAction: "new_search"):
  * **Age Group Incompatibility** - COMPLETE AGE GROUP SWITCHES are NEW SEARCH:
    - **CRITICAL**: When user switches from one age group to a completely different age group (e.g., children to adult, adult to children), this is ALWAYS a NEW SEARCH
    - PREVIOUS="clothes for my 6 year old and 12 year old" (ageGroups: ["Kids", "Tween"]) + CURRENT="only red dresses for adult" (ageGroups: ["Adult"]) → NEW SEARCH (complete age group switch)
    - PREVIOUS="dresses for my daughter" (ageGroups: ["Kids"]) + CURRENT="show me ones for women" (ageGroups: ["Adult"]) → NEW SEARCH (kids to adult)
    - PREVIOUS="red tops for kids" (ageGroups: ["Kids"]) + CURRENT="for adult" (ageGroups: ["Adult"]) → NEW SEARCH (complete age group switch)
    - PREVIOUS="adult clothing" (ageGroups: ["Adult"]) + CURRENT="for my 8 year old" (ageGroups: ["Kids"]) → NEW SEARCH (adult to kids)
    - PREVIOUS="dress for newborn" or "newborn outfit" + CURRENT="joggers" or "relaxed fit joggers" → NEW SEARCH (newborns don't wear joggers - they wear onesies, sleepers, dresses, rompers)
    - PREVIOUS="newborn" + CURRENT="adult sizes" or "adult clothing" → NEW SEARCH (age group mismatch)
    - PREVIOUS="baby clothes" + CURRENT="toddler sizes" → NEW SEARCH (age group mismatch, unless explicitly changing age group)
    - **RULE**: If PREVIOUS_CONSTRAINTS has ageGroups (e.g., ["Kids", "Tween"]) and CURRENT_MESSAGE specifies a different age group (e.g., ["Adult"]), this is a NEW SEARCH
    - **RULE**: If PREVIOUS_CONSTRAINTS has ageGroups=["Adult"] and CURRENT_MESSAGE specifies children's age groups (e.g., ["Kids", "Tween"]), this is a NEW SEARCH
    - **EXCEPTION**: Only when user explicitly says "also", "too", "and", "or" (e.g., "for kids or adults") can multiple age groups coexist - this is still a NEW SEARCH if switching completely
    - **When mergeAction is "new_search" due to age group switch**:
      * Set ageGroups to null in mergedConstraints (let classifier set the correct age group)
      * Still preserve portable constraints (colors, occasions, seasons, formalityLevel) based on constraint preservation logic
      * Set enhancedQueryText to CURRENT_MESSAGE (fresh query, not merged with previous)
      * Set other category-specific constraints to null (lengths, sleeveLengths, necklines, fits, etc.)
      * Example: PREVIOUS="clothes for my 6 year old and 12 year old" (ageGroups: ["Kids", "Tween"], colors: ["Red"]), CURRENT="only red dresses for adult" (ageGroups: ["Adult"], colors: ["Red"])
        → mergeAction: "new_search"
        → mergedConstraints: { ageGroups: null, colors: ["Red"] (preserved - portable constraint), occasions: null, lengths: null, ... (reset category-specific) }
        → enhancedQueryText: "only red dresses for adult" (CURRENT_MESSAGE as-is, fresh query)
        → reason: "user switched from children's age groups to adult, treating as new search while preserving portable constraints"
  * **Product Type + Occasion Incompatibility**:
    - PREVIOUS="bikinis" or "swimsuits" + CURRENT="for my wedding" → NEW SEARCH (bikinis not appropriate for weddings)
    - PREVIOUS="swimwear" + CURRENT="for office" → NEW SEARCH (swimwear not for office)
    - PREVIOUS="pajamas" or "loungewear" + CURRENT="for formal event" → NEW SEARCH (pajamas not for formal events)
    - PREVIOUS="winter coats" + CURRENT="for beach" → NEW SEARCH (winter coats not for beach)
    - PREVIOUS="evening gowns" + CURRENT="for gym" → NEW SEARCH (evening gowns not for gym)
    - PREVIOUS="bikinis" + CURRENT="for business meeting" → NEW SEARCH (bikinis not for business)
  * **Product Type Change Incompatibility**:
    - PREVIOUS="dress for newborn birthday" + CURRENT="relaxed fit joggers" → NEW SEARCH (joggers incompatible with newborn age group, even if occasion matches)
    - PREVIOUS="swimsuits" + CURRENT="winter coats" → NEW SEARCH (completely different category/season)
    - PREVIOUS="formal dress" + CURRENT="athletic wear" → NEW SEARCH (incompatible categories)
- When mergeAction is "new_search":
  * Set all mergedConstraints fields to null (complete reset)
  * Set enhancedQueryText to CURRENT_MESSAGE (use as-is, don't merge)
  * Set reason to explain the incompatibility (e.g., "bikinis are not appropriate for weddings, treating as new search")

**CRITICAL: CONSTRAINT INTENT LEVELS** (extract for ALL constraints):
When merging constraints, determine and preserve/update intent levels:

1. **REQUIRED** ("only wants", "must be", "only", "just", "exactly", "specifically"):
   - "only blue" after "blue dress" → update colors intent from 'strong' to 'required'
   - "must be cotton" → materials: { values: ["Cotton"], intent: "required" }
   - "exactly size 4" → sizes: { values: ["4"], intent: "required" }

2. **STRONG** ("seriously wants", "really want", "preferably", "ideally", "or similar", "would prefer"):
   - "blue or similar colors" → colors: { values: ["Blue"], intent: "strong" }
   - "preferably cotton" → materials: { values: ["Cotton"], intent: "strong" }
   - Default for explicit mentions without qualifiers

3. **PREFERRED** ("mildly wants", "would like", "if possible", "maybe", "could be"):
   - "maybe blue" → colors: { values: ["Blue"], intent: "preferred" }
   - "would like cotton" → materials: { values: ["Cotton"], intent: "preferred" }

4. **EXCLUDED** ("does not want", "not", "avoid", "no", "without", "don't want"):
   - "not blue" → colors: { values: ["Blue"], intent: "excluded" }
   - "avoid cotton" → materials: { values: ["Cotton"], intent: "excluded" }
   - "without floral" → patterns: { values: ["Floral"], intent: "excluded" }

**INTENT PRESERVATION RULES**:
- When merging, preserve intent from PREVIOUS_CONSTRAINTS unless CURRENT_MESSAGE changes it
- When user says "only X" after "X", update intent to 'required'
- When user says "maybe X" after "X", update intent to 'preferred'
- When user says "not X" after "X", update intent to 'excluded'
- When user says "X or similar", keep intent as 'strong' (triggers similarity expansion)

MERGE (add/update constraints while keeping others):
- "make it black" → add/update colors: ["Black"] with intent: "strong", keep all other constraints (price, occasion, pattern, etc.)
  * Enhanced query: "[previous product type] black" (e.g., "tops black" if previous was "tops")
  * If PREVIOUS_QUERY is incomplete, infer from PREVIOUS_CONSTRAINTS (e.g., if constraints show styles=["Top"], use "tops")
  * **CRITICAL**: Always preserve product type from PREVIOUS_QUERY (e.g., if PREVIOUS_QUERY="dresses", enhancedQueryText="black dresses", NOT just "black")
- **CRITICAL: PRESERVE NON-ONTOLOGY COLORS**
  * **MOST IMPORTANT**: When user mentions colors like "Cherry", "Crimson", "Scarlet", "Burgundy", "Maroon", etc., extract them EXACTLY as the user said (capitalized), even if they're not in the standard ontology
  * **DO NOT** convert "Cherry" to "Red" or "Crimson" to "Red" - preserve the exact color term the user used
  * **DO NOT** map non-ontology colors to ontology colors - the system will handle fuzzy matching later
  * Examples:
    * User says "cherry coloured dresses" → colors: ["Cherry"] (NOT ["Red"])
    * User says "crimson dresses" → colors: ["Crimson"] (NOT ["Red"])
    * User says "scarlet red" → colors: ["Scarlet"] (NOT ["Red"])
    * PREVIOUS_CONSTRAINTS has colors: ["Cherry"], CURRENT_MESSAGE="cherry coloured dresses" → colors: ["Cherry"] (preserve from previous, NOT convert to ["Red"])
    * PREVIOUS_QUERY="cherry coloured dresses", CURRENT_MESSAGE="only cherry coloured dresses" → colors: ["Cherry"] (preserve, NOT ["Red"])
- **CRITICAL: "X also works" or "X too" patterns (ADD to existing array, don't replace)**:
  * "cherry also works" or "cherry too" → ADD "Cherry" to existing colors array (e.g., if previous had ["Red"], result is ["Red", "Cherry"]), keep all other constraints
  * **CRITICAL**: Preserve non-ontology colors from PREVIOUS_CONSTRAINTS when user mentions the same color
    * If PREVIOUS_CONSTRAINTS has colors: ["Cherry"], and CURRENT_MESSAGE says "cherry coloured" or "cherry also works", preserve ["Cherry"] (NOT convert to ["Red"])
    * Example: PREVIOUS_CONSTRAINTS={colors: ["Cherry"]}, CURRENT_MESSAGE="cherry coloured dresses" → colors: ["Cherry"] (preserve, NOT ["Red"])
  * "navy also works" → ADD "Navy" to existing colors array, keep all other constraints
  * "size 6 also works" → ADD "6" to existing sizes array, keep all other constraints
  * **IMPORTANT**: When user says "X also works", they want to ADD X to the existing constraint, NOT replace it
  * Example: PREVIOUS_QUERY="red dresses", PREVIOUS_CONSTRAINTS={colors: ["Red"]}, CURRENT_MESSAGE="cherry also works"
    → mergedConstraints: { colors: ["Red", "Cherry"] } (ADD Cherry to Red, don't replace)
    → enhancedQueryText: "red or cherry coloured dresses" (natural, flows well)
    → NOT: { colors: ["Cherry"] } (this would REPLACE Red, which is wrong)
  * Example: PREVIOUS_QUERY="dresses in red", CURRENT_MESSAGE="cherry also works"
    → mergedConstraints: { colors: ["Red", "Cherry"] } (keep Red, add Cherry)
    → enhancedQueryText: "red or cherry coloured dresses"
- **COLOR MERGING** (all categories):
  * PREVIOUS="hoodies for curvy women", CURRENT="in black" → "black hoodies for curvy women" ✓
  * PREVIOUS="dresses", CURRENT="in pink" → "pink dresses" ✓
  * PREVIOUS="jewelry", CURRENT="in gold" → "gold jewelry" ✓
  * PREVIOUS="bedding sets", CURRENT="in white" → "white bedding sets" ✓
  * PREVIOUS="perfumes", CURRENT="for women" → "perfumes for women" ✓ (no color, but audience merge)
- "only in light colours" or "in light colours" → add/update colors: ["White", "Ivory", "Cream", "Beige", "Blush", "Pink", "Peach", "Lemon", "Mint", "Sky Blue", "Lavender", "Baby Blue"], keep all other constraints including product type
  * **CRITICAL**: Do NOT use generic terms like "Light" or "Dark" - expand to specific ontology colors
  * Enhanced query: "light coloured [previous product type]" (e.g., "light coloured dresses" if previous was "dresses in light colours" or "show me dresses")
  * **CRITICAL**: If PREVIOUS_QUERY="dresses in light colours" and CURRENT_MESSAGE="only in light colours", enhancedQueryText="light coloured dresses" (PRESERVE "dresses")
- "dark colours" or "dark colors" or "in dark colours" → add/update colors: ["Black", "Navy", "Burgundy", "Maroon", "Charcoal", "Brown", "Plum"], keep all other constraints
  * **CRITICAL**: Do NOT use generic terms like "Dark" - expand to specific ontology colors: ["Black", "Navy", "Burgundy", "Maroon", "Charcoal", "Brown", "Plum"]
  * Enhanced query: "dark coloured [previous product type]" (e.g., "dark coloured joggers" if previous was "joggers" and current is "dark colours")
- **MATERIAL MERGING** (apparel):
  * PREVIOUS="dresses", CURRENT="in silk" → "silk dresses" ✓
  * PREVIOUS="hoodies", CURRENT="cotton" → "cotton hoodies" ✓
- **PATTERN MERGING** (all categories):
  * PREVIOUS="dresses", CURRENT="floral" → "floral dresses" ✓
  * PREVIOUS="bedding", CURRENT="with floral patterns" → "bedding with floral patterns" ✓
- "find floral ones" or "floral ones" → add/update patterns: ["Floral"], keep all other constraints including product type
  * Enhanced query: "[previous color/attributes] floral [previous product type]" (e.g., "light coloured floral dresses" if previous was "dresses in light colours")
  * **CRITICAL**: If PREVIOUS_QUERY="light coloured dresses" and CURRENT_MESSAGE="find floral ones", enhancedQueryText="light coloured floral dresses" (PRESERVE "dresses")
- **SIZE MERGING** (apparel):
  * PREVIOUS="dresses", CURRENT="size 4" → "size 4 dresses" or "dresses size 4" ✓
- **OCCASION MERGING** (all categories):
  * PREVIOUS="dresses", CURRENT="for wedding" → "dresses for wedding" ✓
  * PREVIOUS="jewelry", CURRENT="for formal event" → "jewelry for formal event" ✓
  * PREVIOUS="bedding", CURRENT="for bedroom" → "bedding for bedroom" ✓
- **AGE GROUP MERGING** (all categories):
  * PREVIOUS="dresses", CURRENT="for kids" → "dresses for kids" ✓
  * PREVIOUS="tops", CURRENT="for adults" → "tops for adults" ✓
- **MULTI-ATTRIBUTE MERGING**:
  * PREVIOUS="dresses", CURRENT="black maxi for wedding" → "black maxi dresses for wedding" ✓
  * PREVIOUS="hoodies", CURRENT="cotton in navy" → "navy cotton hoodies" ✓
- "also in size 6" → add/update sizes: ["6"], keep all other constraints
  * Enhanced query: "[previous product type] size 6" (e.g., "one piece swimsuit size 6" if previous was "one piece swimsuit")
  * If PREVIOUS_QUERY was "one piece please" but PREVIOUS_CONSTRAINTS shows styles=["One-Piece", "Swimsuit"], use "one piece swimsuit size 6"
- "under $300" → update priceMaxCents: 30000, keep priceMinCents if it exists, keep all other constraints
  * Enhanced query: "[previous product type] under $300" (e.g., "one piece swimsuit under $300" if previous was "one piece swimsuit")
  * CRITICAL: If PREVIOUS_QUERY was "one piece please" but PREVIOUS_CONSTRAINTS shows it's about swimsuits, use "one piece swimsuit under $300" (NOT "one piece under $300")
- "over $50" → update priceMinCents: 5000, keep priceMaxCents if it exists, keep all other constraints
  * Enhanced query: "[previous product type] over $50" (e.g., "tops over $50" if previous was "tops")
  * Infer product type from PREVIOUS_CONSTRAINTS if PREVIOUS_QUERY is incomplete
- "more casual" → update occasions: ["Casual", "Daytime"], remove formal occasions, keep other constraints
  * Enhanced query: "[previous product type] casual" (preserve product type from previous query or constraints)
- "cheaper" → reduce priceMaxCents by 20% or set lower, keep priceMinCents if it exists, keep all other constraints
  * Enhanced query: "[previous product type] cheaper" or "[previous product type] under $X" (preserve product type from previous query or constraints)
- "something for [occasion]" or "for [occasion]" or "for my [occasion]" → CHECK LOGICAL COMPATIBILITY FIRST
  * **CRITICAL**: Before merging, check if product type + occasion are LOGICALLY COMPATIBLE
  * **INCOMPATIBLE** (use mergeAction: "new_search"):
    - PREVIOUS="bikinis" or "swimsuits" + CURRENT="for my wedding" → NEW SEARCH (bikinis not appropriate for weddings)
    - PREVIOUS="swimwear" + CURRENT="for office" → NEW SEARCH (swimwear not for office)
    - PREVIOUS="pajamas" or "loungewear" + CURRENT="for formal event" → NEW SEARCH (pajamas not for formal events)
    - PREVIOUS="winter coats" + CURRENT="for beach" → NEW SEARCH (winter coats not for beach)
  * **COMPATIBLE** (use mergeAction: "merge"):
    - PREVIOUS="dresses" + CURRENT="for wedding" → FOLLOW-UP (dresses appropriate for weddings)
    - PREVIOUS="tops" + CURRENT="for office" → FOLLOW-UP (tops can be office-appropriate)
    - PREVIOUS="swimsuits" + CURRENT="for beach" → FOLLOW-UP (swimsuits are for beach)
    - PREVIOUS="loungewear" + CURRENT="for home" → FOLLOW-UP (loungewear is for home)
  * When COMPATIBLE: This is a MERGE action - add the occasion while keeping the product type
    - Example: PREVIOUS_QUERY="show me dresses", CURRENT_MESSAGE="something for a beach wedding"
      → mergedConstraints: { occasions: ["Beach Wedding"], styles: ["Dress"], ... (keep all previous constraints) }
      → enhancedQueryText: "dresses for beach wedding" (PRESERVE "dresses", ADD "beach wedding")
  * When INCOMPATIBLE: This is a NEW SEARCH
    - Example: PREVIOUS_QUERY="find sexy bikinis for women", CURRENT_MESSAGE="something for my wedding"
      → mergeAction: "new_search"
      → mergedConstraints: { all fields null } (reset everything)
      → enhancedQueryText: "something for my wedding" (use CURRENT_MESSAGE as-is)
      → reason: "bikinis are not appropriate for weddings, treating as new search"
- **Product Type Changes** (when CURRENT_MESSAGE changes the product type):
  * **CRITICAL**: When changing product types, check BOTH product type compatibility AND age group appropriateness
  * **INCOMPATIBLE** (use mergeAction: "new_search"):
    - PREVIOUS="dress for newborn" or "newborn outfit" or "classic newborn dress" + CURRENT="joggers" or "relaxed fit joggers" → NEW SEARCH
      * Reason: "joggers are not appropriate for newborns - newborns wear onesies, sleepers, dresses, rompers, not joggers"
      * Example: PREVIOUS_QUERY="classic newborn dress for her birthday", CURRENT_MESSAGE="Relaxed fit joggers in new colors"
        → mergeAction: "new_search"
        → mergedConstraints: { all fields null } (reset everything)
        → enhancedQueryText: "Relaxed fit joggers in new colors" (use CURRENT_MESSAGE as-is)
        → reason: "joggers are not appropriate for newborns, treating as new search"
    - PREVIOUS="baby clothes" + CURRENT="adult sizes" → NEW SEARCH (age group mismatch)
    - PREVIOUS="toddler outfit" + CURRENT="newborn sizes" → NEW SEARCH (age group mismatch)
  * **COMPATIBLE** (can be follow-up if age group matches):
    - PREVIOUS="dress for newborn" + CURRENT="romper for newborn" → FOLLOW-UP (both appropriate for newborns)
    - PREVIOUS="tops" + CURRENT="bottoms" → FOLLOW-UP (if same age group and occasion)
  * **IDENTICAL QUERIES** (use mergeAction: "new_search"):
    - If CURRENT_MESSAGE is IDENTICAL (or nearly identical) to PREVIOUS_QUERY → NEW SEARCH
    - When a user repeats the exact same query, they want to start fresh (especially important for indirect searches to get follow-up questions again)
    - Example: PREVIOUS_QUERY="looking for an outfit for my newborn", CURRENT_MESSAGE="looking for an outfit for my newborn"
      → mergeAction: "new_search"
      → mergedConstraints: { all fields null } (reset everything)
      → enhancedQueryText: "looking for an outfit for my newborn" (use CURRENT_MESSAGE as-is)
      → reason: "user repeated the same query, treating as new search to allow follow-up questions for indirect queries"
    - Example: PREVIOUS_QUERY="show me dresses", CURRENT_MESSAGE="show me dresses"
      → mergeAction: "new_search"
      → mergedConstraints: { all fields null } (reset everything)
      → enhancedQueryText: "show me dresses" (use CURRENT_MESSAGE as-is)
      → reason: "user repeated the same query, treating as new search"

REPLACE (override specific constraints, keep others):
- **COLOR REPLACEMENT** (all categories):
  * PREVIOUS="red dresses", CURRENT="change to navy" → "navy dresses" ✓ (NOT "red dresses navy" or "red dresses change to navy")
  * PREVIOUS="gold jewelry", CURRENT="in silver" → "silver jewelry" ✓
  * PREVIOUS="white bedding", CURRENT="in beige" → "beige bedding" ✓
- "instead, show me mini dresses" → replace lengths: ["Mini"], keep category, price, colors, and other constraints
  * Enhanced query: "[color] [material] mini dress [other attributes]" (natural ordering)
- "change to navy" → replace colors: ["Navy"], keep price, occasion, pattern, and other constraints
  * Enhanced query: "navy [material] [product type] [other attributes]" (color first, natural flow)
  * Example: PREVIOUS_QUERY: "red silk maxi dress", CURRENT_MESSAGE: "change to navy"
    → enhancedQueryText: "navy silk maxi dress" (NOT "silk maxi dress navy" or "red silk maxi dress navy")
- **MATERIAL REPLACEMENT** (apparel):
  * PREVIOUS="silk dress", CURRENT="cotton instead" → "cotton dress" ✓
- **LENGTH REPLACEMENT** (apparel):
  * PREVIOUS="maxi dress", CURRENT="mini instead" → "mini dress" ✓
- **PRODUCT TYPE REPLACEMENT** (all categories):
  * PREVIOUS="dresses", CURRENT="show me tops" → "tops" ✓ (product type switch)
  * PREVIOUS="jewelry", CURRENT="show me bags" → "bags" ✓
- **CRITICAL: PRESERVE NON-ONTOLOGY COLORS IN REPLACE ACTIONS**
  * When user says "change to cherry" or "cherry coloured" or "only cherry", extract colors: ["Cherry"] (NOT ["Red"])
  * **DO NOT** convert non-ontology colors to ontology colors - preserve the exact color term
  * Examples:
    * PREVIOUS_QUERY="red dresses", CURRENT_MESSAGE="change to cherry" → colors: ["Cherry"] (NOT ["Red"])
    * PREVIOUS_QUERY="red dresses", CURRENT_MESSAGE="only cherry coloured" → colors: ["Cherry"] (NOT ["Red"])
    * PREVIOUS_QUERY="dresses", CURRENT_MESSAGE="cherry coloured" → colors: ["Cherry"] (NOT ["Red"])
- "i like chocolate coloured ones" after colors were removed → replace colors: ["Chocolate"], keep all other constraints
  * Enhanced query: "chocolate [material] [product type] [other attributes]" (color first, natural ordering)
  * Example: PREVIOUS_QUERY: "silk maxi dress long sleeves" (colors removed), CURRENT_MESSAGE: "i like chocolate coloured ones"
    → enhancedQueryText: "chocolate silk maxi dress long sleeves" (natural, flows well)
- "actually, under $200" → replace priceMaxCents: 20000, keep priceMinCents if it exists, keep all other constraints
- "not floral, show me solid" → replace patterns: ["Solid"], remove "Floral", keep other constraints
- "Actually, I prefer a mini dress instead" → replace lengths: ["Mini"], keep pattern, occasion, price, and other constraints from previous query
- "I prefer X instead" → replace the relevant constraint (X), keep all other constraints from previous query
- **CRITICAL: Age Group Replacement in Follow-ups** - When a follow-up query changes the age group, REPLACE (not merge) the age group constraint:
  * **RULE**: If CURRENT_MESSAGE mentions a different age group than PREVIOUS_CONSTRAINTS, REPLACE ageGroups with the new age group(s) from CURRENT_MESSAGE
  * **RULE**: If CURRENT_MESSAGE contains adult terminology ("for adult", "for adults", "for women", "for men", "for ladies", "for gentlemen") at the END while PREVIOUS_CONSTRAINTS has children's age groups, REPLACE ageGroups: ["Adult"]
  * Examples:
    * PREVIOUS="clothes for my 6 year old" (ageGroups: ["Kids"]), CURRENT="only red dresses for adult" → REPLACE ageGroups: ["Adult"], NOT ["Kids", "Adult"]
    * PREVIOUS="dresses for my daughter" (ageGroups: ["Kids"]), CURRENT="show me ones for women" → REPLACE ageGroups: ["Adult"], enhancedQueryText: "dresses for women" (removes "for my daughter")
    * PREVIOUS="red tops for kids", CURRENT="for adult" → REPLACE ageGroups: ["Adult"], enhancedQueryText: "red tops for adult" (removes "for kids")
    * PREVIOUS="clothes for my 6 year old and 12 year old" (ageGroups: ["Kids", "Tween"]), CURRENT="only red dresses for adult" → REPLACE ageGroups: ["Adult"], enhancedQueryText: "red dresses for adult" (removes all children's age mentions)
  * **When to ADD vs REPLACE**: Only ADD age groups if the user explicitly says "also", "too", "and", "or", or lists multiple ages (e.g., "for my 6 year old and 12 year old")
    * "for my 6 year old and 12 year old" → ageGroups: ["Kids", "Tween"] (both ages mentioned)
    * "for kids or adults" → ageGroups: ["Kids", "Adult"] (explicit "or" indicates both)
    * "for my daughter too" → ADD to existing age groups if PREVIOUS had age groups
  * **When to REPLACE**: If the user mentions a single new age group without "also", "too", "and", "or", REPLACE the previous age group
    * PREVIOUS="for kids", CURRENT="for adult" → REPLACE ageGroups: ["Adult"]
    * PREVIOUS="for my 6 year old", CURRENT="for women" → REPLACE ageGroups: ["Adult"]
    * PREVIOUS="red dresses", CURRENT="for my 12 year old" → REPLACE ageGroups: ["Tween"] (or set if no previous age group)
- "over $100" when priceMaxCents exists → replace priceMinCents: 10000, keep priceMaxCents, keep other constraints
- "under $200" when priceMinCents exists → replace priceMaxCents: 20000, keep priceMinCents, keep other constraints

REMOVE (explicitly remove constraints, keep others):
- **COLOR REMOVAL**:
  * PREVIOUS="red silk maxi dress", CURRENT="any color is fine" → "silk maxi dress" ✓ (removed "red")
- "any color is fine" → remove colors constraint (set to null), keep price, occasion, pattern, and other constraints
- **MATERIAL REMOVAL**:
  * PREVIOUS="silk maxi dress", CURRENT="any material" → "maxi dress" ✓ (removed "silk")
- **PRICE REMOVAL**:
  * PREVIOUS="dresses under $200", CURRENT="price doesn't matter" → "dresses" ✓ (removed "under $200")
- "price doesn't matter" → remove priceMinCents and priceMaxCents (set to null), keep colors, occasion, pattern, and other constraints
- "any occasion" → remove occasions constraint (set to null), keep price, colors, pattern, and other constraints
- "no pattern preference" → remove patterns constraint (set to null), keep other constraints
- "its fine if its not silk" or "not silk" or "any material is fine" → remove materials constraint (set to null), keep colors, occasion, pattern, and other constraints
- **CRITICAL: Negative preferences based on PREVIOUS_BOT_REPLY**:
  * "i dont like anything coconutty" or "not coconut" or "no coconut" (when PREVIOUS_BOT_REPLY mentions coconut) → This is a REMOVE action for materials/ingredients/attributes related to coconut
  * "not floral" (when PREVIOUS_BOT_REPLY mentions floral) → remove patterns: ["Floral"] or add patterns constraint excluding floral
  * "without vanilla" (when PREVIOUS_BOT_REPLY mentions vanilla) → remove materials/ingredients related to vanilla
  * **PRESERVE PRODUCT TYPE**: When removing based on shown products, ALWAYS preserve the product type from PREVIOUS_QUERY
  * Example: PREVIOUS_QUERY="body mist", PREVIOUS_BOT_REPLY shows "Coconut Water" products, CURRENT_MESSAGE="i dont like anything coconutty"
    → mergeAction: "remove" or "merge"
    → Preserve product type: "body mist"
    → Enhanced query: "body mist without coconut" or "body mist excluding coconut"
    → Reason: "User is refining body mist search to exclude coconut, based on products shown in previous reply"
  * Example: PREVIOUS_QUERY: "silk maxi dress chocolate color long sleeves", CURRENT_MESSAGE: "its fine if its not silk, i just want chocolate coloured ones"
    → mergedConstraints: { materials: null, colors: ["Chocolate"], lengths: ["Maxi"], sleeveLengths: ["Long"], ... }
    → enhancedQueryText: "chocolate maxi dress long sleeves" (REMOVED "silk" because materials is null)
- "no material preference" → remove materials constraint (set to null), keep other constraints
- "any material" → remove materials constraint (set to null), keep other constraints

CONSTRAINT RELAXATION (modify constraints to be less strict, keep others):
- "show me close matches" → keep all constraints but be more flexible (this is a MERGE action, keep all constraints)
- "price can be higher" → REMOVE priceMaxCents constraint (set to null), keep priceMinCents if exists, keep all other constraints
  * This allows products above the previous price limit
  * Enhanced query: "[previous product type] [other constraints]" (remove price max from query text)
  * Example: PREVIOUS_QUERY="red silk maxi dress under $200", CURRENT_MESSAGE="price can be higher"
    → REMOVE priceMaxCents, keep colors=["Red"], materials=["Silk"], lengths=["Maxi"], etc.
    → Enhanced query: "red silk maxi dress [other constraints]" (preserve all except price max)
- "show me close matches, price can be higher" → REMOVE priceMaxCents (set to null), keep ALL other constraints from previous query
  * This is a REMOVE action for priceMaxCents, but MERGE for all other constraints
  * Example: PREVIOUS_QUERY="red silk maxi dress with long sleeves, v-neck, floral pattern, under $200, size 4, for a formal wedding"
    → CURRENT_MESSAGE="Show me close matches, price can be higher"
    → REMOVE priceMaxCents (set to null), keep colors=["Red"], materials=["Silk"], lengths=["Maxi"], sleeveLengths=["Long"], necklines=["V-Neck"], patterns=["Floral"], sizes=["4"], occasions=["Formal", "Wedding"]
    → Enhanced query: "red silk maxi dress long sleeves v-neck floral pattern size 4 formal wedding" (preserve all constraints except price max)
- "price can be lower" → REMOVE priceMinCents constraint (set to null), keep priceMaxCents if exists, keep all other constraints
- "show me similar options" → keep all constraints (MERGE action, no changes)
- "close matches" → keep all constraints (MERGE action, no changes)
- "relax the price constraint" → REMOVE priceMaxCents and/or priceMinCents (set to null), keep all other constraints
- "flexible with price" → REMOVE priceMaxCents and priceMinCents (set to null), keep all other constraints

COLOR RELAXATION (expand color constraints to include similar colors):
- **CRITICAL**: When user says "similar colours to [color] also work", "similar colors", "or similar colours", "close color matches", etc.:
  * This is a MERGE action that RELAXES the color constraint (expands to include similar colors)
  * Keep the original color(s) in mergedConstraints.colors, but mark in enhancedQueryText that similar colors are acceptable
  * Enhanced query should read naturally: "[color] or similar coloured [product type] [other constraints]"
  * Example: PREVIOUS_QUERY="brown maxi dresses for a wedding in summer", CURRENT_MESSAGE="similar colours to brown also work"
    → mergedConstraints: { colors: ["Brown"], occasions: ["Wedding"], seasons: ["Summer"], ... } (keep Brown, but system will expand to similar colors later)
    → enhancedQueryText: "brown or similar coloured maxi dresses for a wedding in summer" (natural, flows well)
    → NOT: "brown maxi dresses for a wedding in summer or similar colours" (awkward - "or similar colours" at the end)
    → NOT: "brown maxi dresses for a wedding in summer similar colours" (missing "or", not natural)
  * The system will automatically expand "Brown" to include similar colors (e.g., "Taupe", "Tan", "Camel", "Chocolate") using embedding similarity
  * This expansion happens AFTER constraint merging, so you just need to keep the original color and make the enhanced query natural
- "similar shades", "close color matches", "or similar" (when referring to colors) → same as above
- The enhancedQueryText should read as a natural, complete sentence that flows well

RULES:
1. **FIRST**: Check logical compatibility between product type and occasion/context
   - If INCOMPATIBLE → mergeAction: "new_search" (reset all constraints, use CURRENT_MESSAGE as-is)
   - If COMPATIBLE → proceed with merge/replace/remove logic below
2. If user says "make it", "also", "add", "with", "and" → MERGE (add/update, keep others) - BUT ONLY IF LOGICALLY COMPATIBLE
   - "something for [occasion]" or "for my [occasion]" → CHECK COMPATIBILITY FIRST
     * If product type + occasion are incompatible → NEW SEARCH
     * If compatible → MERGE (add occasion, preserve product type)
2. If user says "instead", "change to", "switch to", "replace with", "not X, show Y", "prefer X instead", "actually, I prefer X" → REPLACE (override that field, keep others)
3. If user says "any", "doesn't matter", "remove", "no preference", "no X" → REMOVE (set to null, keep others)
4. For price constraints:
   - "cheaper" or "less expensive" or "too expensive" or "make it cheaper" → reduce priceMaxCents by 20% or set lower, keep priceMinCents if exists
   - "over $X" or "above $X" or "at least $X" → set/update priceMinCents, keep priceMaxCents if exists (UNLESS paradoxical - see below)
   - "under $X" or "below $X" or "up to $X" → set/update priceMaxCents, keep priceMinCents if exists (UNLESS paradoxical - see below)
   - "between $X and $Y" → set both priceMinCents and priceMaxCents
   - "price doesn't matter" or "any price" → set both priceMinCents and priceMaxCents to null
   - "price can be higher" or "price can be more" → REMOVE priceMaxCents (set to null), keep priceMinCents if exists, keep all other constraints
   - "price can be lower" or "price can be less" → REMOVE priceMinCents (set to null), keep priceMaxCents if exists, keep all other constraints
   - "flexible with price" or "relax the price" → REMOVE both priceMinCents and priceMaxCents (set to null), keep all other constraints
   - Independent updates: "over $50" when max exists → add/update min, keep max (UNLESS paradoxical - see below)
   - Independent updates: "under $200" when min exists → add/update max, keep min (UNLESS paradoxical - see below)
   
   CRITICAL: Handle paradoxical price constraints (check BEFORE applying)
   - PARADOX DETECTION: If PREVIOUS_CONSTRAINTS has priceMaxCents=X (in cents) and CURRENT_MESSAGE sets priceMinCents=Y (in cents) where Y > X, this is PARADOXICAL
     * Example: PREVIOUS="under $100" (priceMaxCents=10000), CURRENT="above $200" (priceMinCents=20000)
     * → Solution: REMOVE priceMaxCents (set to null), keep priceMinCents=20000
     * → Reason: User wants "above $200", so "under $100" is incompatible - remove the max constraint
     * → Enhanced query: "[previous product type] over $200" (remove "under $100" from query text)
   - PARADOX DETECTION: If PREVIOUS_CONSTRAINTS has priceMinCents=X (in cents) and CURRENT_MESSAGE sets priceMaxCents=Y (in cents) where Y < X, this is PARADOXICAL
     * Example: PREVIOUS="over $200" (priceMinCents=20000), CURRENT="under $100" (priceMaxCents=10000)
     * → Solution: REMOVE priceMinCents (set to null), keep priceMaxCents=10000
     * → Reason: User wants "under $100", so "over $200" is incompatible - remove the min constraint
     * → Enhanced query: "[previous product type] under $100" (remove "over $200" from query text)
   - ALWAYS check for paradoxes BEFORE applying price constraints
   - When a paradox is detected, REMOVE the conflicting constraint from PREVIOUS_CONSTRAINTS, keep the new one from CURRENT_MESSAGE
   - The enhancedQueryText should reflect the resolved constraints (remove the conflicting price phrase)
5. For occasions: "more casual" → replace formal occasions with ["Casual", "Daytime"], keep other constraints
6. Always preserve constraints NOT mentioned in the follow-up message
7. For price: preserve priceMinCents if not mentioned, preserve priceMaxCents if not mentioned (independent handling)
8. For arrays (colors, sizes, patterns): MERGE adds to array, REPLACE replaces entire array, REMOVE sets to null
9. **CRITICAL: enhancedQueryText should ONLY include what the user explicitly typed, NOT extracted/inferred constraints from PREVIOUS_CONSTRAINTS**
   - The enhancedQueryText must ONLY include words/phrases that appear in PREVIOUS_QUERY or CURRENT_MESSAGE
   - DO NOT include constraints that were extracted/inferred by the classifier (e.g., if PREVIOUS_CONSTRAINTS has colors=["White", "Yellow", "Coral"] but the user never said these colors, do NOT include them in enhancedQueryText)
   - DO NOT include materials, occasions, patterns, etc. from PREVIOUS_CONSTRAINTS unless they were explicitly mentioned by the user in PREVIOUS_QUERY or CURRENT_MESSAGE
   - Example: If PREVIOUS_QUERY="dresses for vacation" and PREVIOUS_CONSTRAINTS has colors=["White", "Yellow", "Coral"] (extracted), but user never said these colors → enhancedQueryText="dresses for vacation" (NOT "white yellow coral dresses for vacation")
   - Example: If PREVIOUS_QUERY="floral dresses" (user said "floral"), CURRENT_MESSAGE="for the beach" → enhancedQueryText="floral dresses for the beach" (includes "floral" because user said it)
   - The enhancedQueryText should read naturally and be searchable, but it must be grounded ONLY in actual user input
10. "Actually, I prefer X" or "I prefer X instead" → REPLACE the constraint for X, keep all other constraints from previous query
11. CRITICAL: When creating enhancedQueryText, ALWAYS preserve the COMPLETE product type/category from PREVIOUS_QUERY
    - **MOST IMPORTANT**: If PREVIOUS_QUERY mentions a product type (dresses, tops, swimsuits, etc.), it MUST appear in enhancedQueryText, even if CURRENT_MESSAGE doesn't mention it
    - **Examples of preserving product type**:
      * PREVIOUS_QUERY="dresses in light colours", CURRENT_MESSAGE="only in light colours" → enhancedQueryText="light coloured dresses" (PRESERVE "dresses")
      * PREVIOUS_QUERY="dresses in light colours", CURRENT_MESSAGE="find floral ones" → enhancedQueryText="light coloured floral dresses" (PRESERVE "dresses", merge "floral")
      * PREVIOUS_QUERY="show me dresses", CURRENT_MESSAGE="in pink" → enhancedQueryText="pink dresses" (PRESERVE "dresses")
    - INFER the complete product type from PREVIOUS_CONSTRAINTS if PREVIOUS_QUERY is incomplete
    - If PREVIOUS_QUERY was "one piece please" but PREVIOUS_CONSTRAINTS shows styles=["One-Piece", "Swimsuit"], infer the product type is "one piece swimsuit"
    - If PREVIOUS_QUERY was "one piece swimsuit" and current message is "under $150", enhancedQueryText should be "one piece swimsuit under $150" (NOT just "one piece under $150")
    - If PREVIOUS_QUERY was "red silk maxi dress..." and current message is "price can be higher", enhancedQueryText should be "red silk maxi dress [other constraints]" (preserve all constraints except price max)
    - **NEVER drop the product type** unless CURRENT_MESSAGE explicitly changes it (e.g., "show me tops instead" after "dresses")
12. CRITICAL: ALWAYS preserve ALL context types from PREVIOUS_QUERY that the LLM constraint extractor can use
    - **MOST IMPORTANT**: The LLM extractor uses many context types to understand user intent. ALL of the following context types from PREVIOUS_QUERY MUST be preserved in enhancedQueryText unless CURRENT_MESSAGE explicitly replaces or removes them:
    
    **Context types to preserve (15-20+ types the LLM extractor uses):**
    1. **Occasions**: "wedding", "beach", "formal event", "vacation", "party", "office", "casual", "evening", "black tie", etc.
    2. **Seasons**: "summer", "winter", "spring", "fall", "tropical", "cold weather", "warm weather", etc.
    3. **Locations/Destinations**: "Bahamas", "Paris", "Hawaii", "Caribbean", "Miami", "Europe", "tropical", etc.
    4. **Weather/Climate context**: "humid", "tropical", "cold", "warm", "hot", "cool", etc.
    5. **Event types**: "black tie", "beach wedding", "summer vacation", "tropical getaway", "resort", etc.
    6. **Style context**: "formal", "casual", "elegant", "professional", "bohemian", etc.
    7. **Time context**: "evening", "daytime", "night", "day", etc.
    8. **Formality level**: "formal", "semi-formal", "casual", etc. (if explicitly mentioned)
    9. **Pattern mentions**: "floral", "striped", "solid", etc. (if explicitly mentioned)
    10. **Material mentions**: "silk", "cotton", "linen", etc. (if explicitly mentioned)
    11. **Length mentions**: "maxi", "mini", "midi", etc. (if explicitly mentioned)
    12. **Color mentions**: "red", "blue", "black", etc. (if explicitly mentioned)
    13. **Sleeve mentions**: "long sleeves", "sleeveless", etc. (if explicitly mentioned)
    14. **Neckline mentions**: "v-neck", "round neck", etc. (if explicitly mentioned)
    15. **Audience mentions**: "for kids", "for men", "for women", "for curvy", "petite", etc.
    16. **Use case context**: "travel-friendly", "work", "gym", "everyday", etc.
    17. **Feature context**: "with pockets", "wrinkle-free", "breathable", etc. (if explicitly mentioned)
    18. **Price context**: "under $X", "over $X", "affordable", etc. (unless removed)
    
    - **Preservation rules**:
      * If PREVIOUS_QUERY mentions "Bahamas vacation" and CURRENT_MESSAGE says "something floral", preserve BOTH "Bahamas" AND "vacation" in enhancedQueryText
      * If PREVIOUS_QUERY mentions "summer beach wedding" and CURRENT_MESSAGE says "in blue", preserve "summer", "beach", and "wedding"
      * If PREVIOUS_QUERY mentions "formal evening event" and CURRENT_MESSAGE says "long sleeves", preserve "formal", "evening", and "event"
      * If PREVIOUS_QUERY mentions "tropical vacation" and CURRENT_MESSAGE says "something casual", preserve "tropical" and "vacation"
      * If PREVIOUS_QUERY mentions "black tie wedding" and CURRENT_MESSAGE says "in navy", preserve "black tie" and "wedding"
    
    - **Examples of preserving ALL context**:
      * PREVIOUS_QUERY="I am going to Bahamas for vacation, suggest me a dress", CURRENT_MESSAGE="something for the beach, floral" 
        → enhancedQueryText="floral dresses for Bahamas beach vacation" (PRESERVE "Bahamas" AND "vacation")
      * PREVIOUS_QUERY="attending a black tie wedding, suggest me a dress", CURRENT_MESSAGE="in navy"
        → enhancedQueryText="navy dresses for black tie wedding" (PRESERVE "black tie" AND "wedding")
      * PREVIOUS_QUERY="summer beach wedding dress", CURRENT_MESSAGE="something more casual"
        → enhancedQueryText="casual summer beach wedding dress" (PRESERVE "summer", "beach", "wedding")
      * PREVIOUS_QUERY="formal evening event outfit", CURRENT_MESSAGE="long sleeves"
        → enhancedQueryText="long sleeves formal evening event outfit" (PRESERVE "formal", "evening", "event")
      * PREVIOUS_QUERY="tropical vacation dresses", CURRENT_MESSAGE="floral patterns"
        → enhancedQueryText="floral tropical vacation dresses" (PRESERVE "tropical" AND "vacation")
    
    - **When to NOT preserve**:
      * ONLY drop context if CURRENT_MESSAGE explicitly replaces it (e.g., "for Miami instead" replaces "Bahamas")
      * ONLY drop context if CURRENT_MESSAGE explicitly removes it (e.g., "any occasion is fine" removes occasion context)
      * If CURRENT_MESSAGE changes a constraint (e.g., "more casual" replaces "formal"), update that specific constraint but keep other context
    
    - **NEVER drop context** unless explicitly replaced or removed by CURRENT_MESSAGE
13. CRITICAL: enhancedQueryText must be NATURAL and COHERENT
    - **DECOMPOSE THEN RECOMPOSE**: Always parse PREVIOUS_QUERY into components first, then merge CURRENT_MESSAGE's constraints into natural positions
    - Write the query as a natural, searchable phrase that flows well
    - Use natural attribute ordering: color → material → product type → style attributes → size → occasion → age group → price
    - **ANTI-CONCATENATION RULES**:
      * NEVER append PREVIOUS_QUERY + CURRENT_MESSAGE as strings
      * NEVER repeat phrases already in PREVIOUS_QUERY (e.g., don't add "for curvy women" if it's already there)
      * ALWAYS merge new attributes into their natural positions (color before product type, not after)
      * REMOVE redundant words/phrases when recomposing
    - Example good ordering: "chocolate silk maxi dress long sleeves floral formal wedding size 4"
    - Avoid redundant words: use "chocolate" not "chocolate color", "silk" not "silk material", "size 4" not "size 4 size"
    - When adding a constraint back after removal, integrate it naturally:
      * PREVIOUS_QUERY: "silk maxi dress..." (colors were removed), CURRENT_MESSAGE: "i like chocolate coloured ones"
      * → enhancedQueryText: "chocolate silk maxi dress..." (natural, flows well)
      * NOT: "silk maxi dress chocolate color" (awkward ordering)
      * NOT: "chocolate color silk maxi dress" (redundant "color" word)
    - Examples of CORRECT merging:
      * PREVIOUS="hoodies for curvy women", CURRENT="in black" → "black hoodies for curvy women" ✓
      * PREVIOUS="red silk maxi dress", CURRENT="change to navy" → "navy silk maxi dress" ✓
      * PREVIOUS="dresses for kids", CURRENT="in pink" → "pink dresses for kids" ✓
    - Examples of WRONG concatenation (DO NOT DO THIS):
      * PREVIOUS="hoodies for curvy women", CURRENT="in black" → "hoodies for curvy women black clothing for curvy women" ✗
      * PREVIOUS="dresses", CURRENT="in pink" → "dresses pink clothing" ✗
      * PREVIOUS="jewelry", CURRENT="in gold" → "jewelry gold accessories" ✗
    - Ensure the query reads like a complete, natural search query that a user might type
    - Group related attributes together (e.g., "long sleeves" together, not separated)
    - Use common fashion terminology (e.g., "v-neck" not "v neck", "maxi dress" not "maxi-dress")
14. CRITICAL: When REMOVING constraints, REMOVE related keywords from enhancedQueryText
    - If colors is set to null (removed), DO NOT include color words (red, blue, black, navy, etc.) in enhancedQueryText
    - If sizes is set to null (removed), DO NOT include size words (size 4, small, medium, etc.) in enhancedQueryText
    - If materials is set to null (removed), DO NOT include material words (silk, cotton, linen, etc.) in enhancedQueryText
    - If patterns is set to null (removed), DO NOT include pattern words (floral, solid, striped, etc.) in enhancedQueryText
    - If occasions is set to null (removed), DO NOT include occasion words (formal, wedding, casual, etc.) in enhancedQueryText
    - If necklines is set to null (removed), DO NOT include neckline words (v-neck, round neck, etc.) in enhancedQueryText
    - If sleeveLengths is set to null (removed), DO NOT include sleeve words (long sleeves, short sleeves, etc.) in enhancedQueryText
    - If priceMaxCents is set to null (removed), DO NOT include price-related words (under $X, below $X, etc.) in enhancedQueryText
    - If priceMinCents is set to null (removed), DO NOT include price-related words (over $X, above $X, etc.) in enhancedQueryText
    - Examples:
      * PREVIOUS_QUERY: "red silk maxi dress under $200", CURRENT_MESSAGE: "any colour is fine"
        → mergedConstraints: { colors: null, materials: ["Silk"], lengths: ["Maxi"], priceMaxCents: 20000 }
        → enhancedQueryText: "silk maxi dress under $200" (REMOVED "red" because colors is null)
      * PREVIOUS_QUERY: "red silk maxi dress long sleeves v-neck", CURRENT_MESSAGE: "any neckline is fine"
        → mergedConstraints: { colors: ["Red"], materials: ["Silk"], lengths: ["Maxi"], sleeveLengths: ["Long"], necklines: null }
        → enhancedQueryText: "red silk maxi dress long sleeves" (REMOVED "v-neck" because necklines is null)
      * PREVIOUS_QUERY: "red silk maxi dress under $200", CURRENT_MESSAGE: "price can be higher"
        → mergedConstraints: { colors: ["Red"], materials: ["Silk"], lengths: ["Maxi"], priceMaxCents: null }
        → enhancedQueryText: "red silk maxi dress" (REMOVED "under $200" because priceMaxCents is null)
      * PREVIOUS_QUERY: "silk maxi dress long sleeves floral solid formal wedding size 4" (colors were removed), CURRENT_MESSAGE: "i like chocolate coloured ones"
        → mergedConstraints: { colors: ["Chocolate"], materials: ["Silk"], lengths: ["Maxi"], sleeveLengths: ["Long"], patterns: ["Floral", "Solid"], occasions: ["Formal", "Wedding"], sizes: ["4"] }
        → enhancedQueryText: "chocolate silk maxi dress long sleeves floral solid formal wedding size 4" (natural ordering: color first, flows well)
        → NOT: "silk maxi dress chocolate color long sleeves..." (awkward - color should come first)
        → NOT: "silk maxi dress long sleeves floral solid chocolate formal wedding size 4" (color in wrong position)
      * PREVIOUS_QUERY: "silk maxi dress chocolate color long sleeves floral solid formal wedding size 4", CURRENT_MESSAGE: "its fine if its not silk, i just want chocolate coloured ones"
        → mergedConstraints: { materials: null, colors: ["Chocolate"], lengths: ["Maxi"], sleeveLengths: ["Long"], patterns: ["Floral", "Solid"], occasions: ["Formal", "Wedding"], sizes: ["4"] }
        → enhancedQueryText: "chocolate maxi dress long sleeves floral solid formal wedding size 4" (REMOVED "silk" because materials is null)
        → NOT: "chocolate silk maxi dress..." (should not include "silk" when materials is null)
15. CONSTRAINT RELAXATION: Phrases like "close matches", "similar options", "price can be higher" indicate the user wants to relax specific constraints while keeping others
    - "show me close matches" → MERGE (keep all constraints, no changes)
    - "price can be higher" → REMOVE priceMaxCents (set to null), keep all other constraints including priceMinCents if exists
    - "show me close matches, price can be higher" → REMOVE priceMaxCents (set to null), keep all other constraints
    - If PREVIOUS_QUERY was "black tops" and current message is "cheaper", enhancedQueryText should be "black tops cheaper" or "black tops under $X" (preserve "tops" category)
    - The enhancedQueryText must be a complete, standalone query that includes the FULL product type (inferred from constraints if needed) plus any new constraints from the current message
    - This ensures the enhanced query can be properly categorized as direct_search instead of indirect_search

Output JSON:
{
  "mergedConstraints": { ...FashionConstraints },
  "enhancedQueryText": "complete, natural query text ONLY including words/phrases from PREVIOUS_QUERY and CURRENT_MESSAGE (or CURRENT_MESSAGE as-is if new_search). DO NOT include extracted/inferred constraints from PREVIOUS_CONSTRAINTS that weren't explicitly mentioned by the user.",
  "mergeAction": "merge" | "replace" | "remove" | "new_search",
  "reason": "brief explanation of what was merged/replaced/removed, OR why this is a new search (e.g., 'bikinis are not appropriate for weddings')"
}

CRITICAL: When mergeAction is "new_search":
- mergedConstraints should have all fields set to null (complete reset)
- enhancedQueryText should be CURRENT_MESSAGE (use as-is, don't merge)
- reason should explain why it's incompatible (e.g., "bikinis are not appropriate for weddings, treating as new search")
- Example output for new_search:
  {
    "mergedConstraints": {
      "styles": null,
      "lengths": null,
      "occasions": null,
      "seasons": null,
      "materials": null,
      "patterns": null,
      "colors": null,
      "sizes": null,
      "fits": null,
      "collections": null,
      "priceMinCents": null,
      "priceMaxCents": null,
      "embellishments": null,
      "necklines": null,
      "sleeveLengths": null,
      "ageGroups": null
    },
    "enhancedQueryText": "something for my wedding",
    "mergeAction": "new_search",
    "reason": "bikinis are not appropriate for weddings, treating as new search"
  }

CRITICAL REMINDERS FOR enhancedQueryText:
- **MOST IMPORTANT: ONLY USE USER INPUT, NOT EXTRACTED CONSTRAINTS**
  * The enhancedQueryText must ONLY include words/phrases that appear in PREVIOUS_QUERY or CURRENT_MESSAGE
  * DO NOT include constraints from PREVIOUS_CONSTRAINTS that were extracted/inferred but not explicitly mentioned by the user
  * Parse PREVIOUS_QUERY into components (product type, colors, materials, audience, locations, etc.) - but only use what's actually in the text
  * Extract new constraints from CURRENT_MESSAGE - only what the user actually said
  * Merge new constraints into natural positions
  * Remove redundant phrases
  * DO NOT append strings together
  * DO NOT add extracted colors, materials, occasions, etc. that the user never mentioned
- **PRESERVE ALL CONTEXT TYPES FROM PREVIOUS_QUERY**: ALWAYS preserve ALL context types that the LLM constraint extractor can use
  * **Occasions**: "wedding", "beach", "formal event", "vacation", "party", etc. → PRESERVE unless replaced/removed
  * **Seasons**: "summer", "winter", "tropical", etc. → PRESERVE unless replaced/removed
  * **Locations**: "Bahamas", "Paris", "Hawaii", etc. → PRESERVE unless replaced/removed
  * **Weather/Climate**: "humid", "tropical", "cold", "warm", etc. → PRESERVE unless replaced/removed
  * **Event types**: "black tie", "beach wedding", "summer vacation", etc. → PRESERVE unless replaced/removed
  * **Style context**: "formal", "casual", "elegant", etc. → PRESERVE unless replaced/removed
  * **Time context**: "evening", "daytime", "night", etc. → PRESERVE unless replaced/removed
  * **All other context types** (formality, patterns, materials, lengths, colors, sleeves, necklines, audience, use cases, features, price) → PRESERVE unless explicitly replaced/removed
  * Example: PREVIOUS="I am going to Bahamas for vacation", CURRENT="something floral" → enhancedQueryText="floral dresses for Bahamas vacation" (preserve "Bahamas" AND "vacation")
  * Example: PREVIOUS="black tie wedding", CURRENT="in navy" → enhancedQueryText="navy dresses for black tie wedding" (preserve "black tie" AND "wedding")
- Must read as a natural, searchable query (like a user would type)
- Use natural attribute ordering: color → material → product type → style details → size → occasion → age group → price
- Avoid redundant words ("chocolate color" → "chocolate", "silk material" → "silk")
- When adding constraints back after removal, place them in natural positions (color first, not last)
- Group related attributes together ("long sleeves" stays together)
- The query should be complete and coherent, not a jumbled list of attributes
- **REMOVE REDUNDANCY**: If a phrase is already in PREVIOUS_QUERY, don't add it again
  * Example: PREVIOUS="hoodies for curvy women" already has "for curvy women", so don't add it again when merging "in black"
  * Result: "black hoodies for curvy women" (NOT "hoodies for curvy women black clothing for curvy women")
- For "similar colours" requests: Use natural phrasing like "[color] or similar coloured [product type]" NOT "[product type] or similar colours" (the latter is awkward)
- **CRITICAL: Age Group Replacement in enhancedQueryText**: When age groups are REPLACED (not merged), REMOVE the old age group mentions from the enhanced query and use only the new age group
  * PREVIOUS_QUERY="clothes for my 6 year old and 12 year old", CURRENT_MESSAGE="only red dresses for adult" → enhancedQueryText: "red dresses for adult" (NOT "clothes for my 6 year old and 12 year old red dresses for adult")
  * PREVIOUS_QUERY="dresses for my daughter", CURRENT_MESSAGE="show me ones for women" → enhancedQueryText: "dresses for women" (removes "for my daughter", uses only "for women")
  * PREVIOUS_QUERY="red tops for kids", CURRENT_MESSAGE="for adult" → enhancedQueryText: "red tops for adult" (removes "for kids", uses "for adult")
  * When ADDING age groups (not replacing), include both: PREVIOUS="dresses for my 8 year old", CURRENT="and for my 12 year old" → enhancedQueryText: "dresses for my 8 year old and 12 year old"
- The enhanced query should read like a complete sentence that flows naturally

CATEGORY-SPECIFIC MERGING EXAMPLES:

**Kids Categories**:
- PREVIOUS="dresses for kids", CURRENT="in pink" → "pink dresses for kids" ✓
- PREVIOUS="onesies for babies", CURRENT="in white" → "white onesies for babies" ✓

**Women's/Adult Apparel**:
- PREVIOUS="hoodies for curvy women", CURRENT="in black" → "black hoodies for curvy women" ✓
- PREVIOUS="maxi dresses", CURRENT="in navy" → "navy maxi dresses" ✓
- PREVIOUS="swimsuits", CURRENT="for beach" → "swimsuits for beach" ✓

**Accessories**:
- PREVIOUS="jewelry", CURRENT="in gold" → "gold jewelry" ✓
- PREVIOUS="bags", CURRENT="for travel" → "bags for travel" ✓

**Personal Care**:
- PREVIOUS="perfumes", CURRENT="for women" → "perfumes for women" ✓
- PREVIOUS="perfumes", CURRENT="lavender scented" → "lavender scented perfumes" ✓

**Home & Living**:
- PREVIOUS="bedding sets", CURRENT="with floral patterns" → "bedding sets with floral patterns" ✓
- PREVIOUS="candles", CURRENT="lavender scented" → "lavender scented candles" ✓
- PREVIOUS="towels", CURRENT="for bathroom" → "towels for bathroom" ✓
`;

/**
 * Helper function to extract age groups from query text
 * Used as fallback when previousConstraints?.ageGroups is missing
 */
function extractAgeGroupsFromQuery(query: string): string[] {
  const ageGroups: string[] = [];
  const queryLower = query.toLowerCase();
  
  // Check for specific age mentions
  if (/\b(2|3)[\s-]*(?:year|years)[\s-]*old\b/.test(queryLower)) {
    ageGroups.push('Toddler');
  }
  if (/\b(4|5|6|7|8|9)[\s-]*(?:year|years)[\s-]*old\b/.test(queryLower)) {
    ageGroups.push('Kids');
  }
  if (/\b(10|11|12)[\s-]*(?:year|years)[\s-]*old\b/.test(queryLower)) {
    ageGroups.push('Tween');
  }
  if (/\b(13|14|15|16|17|18|19)[\s-]*(?:year|years)[\s-]*old\b/.test(queryLower)) {
    ageGroups.push('Teen');
  }
  if (/\bfor\s+(?:adult|adults|women|men|ladies|gentlemen|woman|man)\b/.test(queryLower)) {
    ageGroups.push('Adult');
  }
  if (/\bfor\s+(?:kids|children|child|toddler|toddlers|baby|babies)\b/.test(queryLower)) {
    if (!ageGroups.includes('Kids') && !ageGroups.includes('Toddler')) {
      ageGroups.push('Kids'); // Default to Kids if not specific
    }
  }
  
  return [...new Set(ageGroups)]; // Remove duplicates
}

export async function mergeFollowUpConstraints(
  previousQuery: string,
  previousConstraints: FashionConstraints | null,
  currentMessage: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  previousCategories?: string[],
  currentCategories?: string[]
): Promise<ConstraintMergeResult> {
  try {
    // Debug logging at the start
    logger.debug('constraint_merger_called', {
      previousQuery: previousQuery?.substring(0, 100),
      currentMessage: currentMessage.substring(0, 100),
      hasPreviousConstraints: !!previousConstraints,
      previousAgeGroups: previousConstraints?.ageGroups,
      previousCategories,
      currentCategories,
    });
    
    // If previous constraints are missing, infer from previous query text
    const constraintsText = previousConstraints 
      ? JSON.stringify(previousConstraints, null, 2)
      : 'null (constraints not available - infer from PREVIOUS_QUERY text)';
    
    // FALLBACK: If previousConstraints doesn't have ageGroups, try to extract from previousQuery
    if (!previousConstraints?.ageGroups && previousQuery) {
      const inferredAgeGroups = extractAgeGroupsFromQuery(previousQuery);
      if (inferredAgeGroups.length > 0) {
        previousConstraints = {
          ...previousConstraints,
          ageGroups: inferredAgeGroups,
        };
        logger.debug('age_groups_inferred_from_previous_query', {
          previousQuery: previousQuery.substring(0, 100),
          inferredAgeGroups,
          note: 'Age groups missing from previousConstraints, extracted from previous query text',
        });
      }
    }
    
    // Check category similarity
    const areSimilar = previousCategories && currentCategories && previousCategories.length > 0 && currentCategories.length > 0
      ? areCategoriesSimilar(previousCategories, currentCategories)
      : false;
    
    // Detect explicit user intent (needed for age group switch check and LLM prompt)
    const explicitIntent = detectExplicitIntent(currentMessage, previousConstraints);
    
    // CRITICAL: Check for complete age group switch BEFORE calling LLM
    // If user switches from children to adult (or vice versa), force new_search immediately
    const hasCompleteAgeGroupSwitch = (() => {
      if (!previousConstraints?.ageGroups) {
        logger.debug('age_group_switch_check_skipped', {
          reason: 'No previous age groups',
          previousConstraints: previousConstraints ? 'exists but no ageGroups' : 'null/undefined',
        });
        return false;
      }
      
      logger.debug('age_group_switch_check_start', {
        previousAgeGroups: previousConstraints.ageGroups,
        currentMessage: currentMessage.substring(0, 100),
      });
      
      // Extract previous age groups
      const prevAgeGroups = Array.isArray(previousConstraints.ageGroups) 
        ? previousConstraints.ageGroups 
        : (previousConstraints.ageGroups as any)?.values || [];
      const prevAgeGroupsNormalized = normalizeAgeGroups(prevAgeGroups);
      
      // Define age group categories
      const childrenAgeGroups = ['Toddler', 'Kids', 'Tween', 'Teen'];
      const adultAgeGroups = ['Adult'];
      
      const hasChildren = prevAgeGroupsNormalized.some(ag => childrenAgeGroups.includes(ag));
      const hasAdult = prevAgeGroupsNormalized.some(ag => adultAgeGroups.includes(ag));
      
      // Check current message for age groups
      const currentMessageLower = currentMessage.toLowerCase();
      
      // Check for adult terminology at the end (strong indicator)
      // CRITICAL: If "for adult" appears at the END of the query, it REPLACES earlier children's mentions
      const adultTermPattern = /\b(for\s+(?:adult|adults|women|men|ladies|gentlemen|woman|man))\b/i;
      const adultTermMatch = currentMessage.match(adultTermPattern);
      const hasAdultTerm = !!adultTermMatch;
      const adultTermIndex = hasAdultTerm && adultTermMatch?.[0] 
        ? currentMessageLower.indexOf(adultTermMatch[0].toLowerCase()) 
        : -1;
      // Check if adult term is in the last 30% of the message (strong indicator it's replacing earlier age mentions)
      const isAdultTermNearEnd = hasAdultTerm && adultTermIndex >= currentMessage.length * 0.7;
      
      // Check for children's age mentions in current message (but ignore if adult term is at end)
      const childrenPattern = /\b((?:for\s+my\s+)?(?:2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19)[\s-]*(?:year|years)[\s-]*old|for\s+(?:kids|children|child|toddler|toddlers|baby|babies|daughter|son|kid))\b/i;
      const hasChildrenMention = childrenPattern.test(currentMessage);
      
      // CRITICAL: If adult term is at the end, it ALWAYS takes precedence over children's mentions in the same message
      // This handles cases like "clothes for my 6 year old and 12 year old only red dresses for adult"
      // The "for adult" at the end REPLACES the earlier children's age mentions
      if (hasChildren && isAdultTermNearEnd) {
        logger.debug('age_group_switch_detected', {
          type: 'Children → Adult (adult term at end)',
          hasChildren,
          isAdultTermNearEnd,
          adultTermIndex,
          messageLength: currentMessage.length,
          threshold: currentMessage.length * 0.7,
        });
        return true; // Children → Adult switch (adult term at end overrides earlier children's mentions)
      }
      
      // ALTERNATIVE CHECK: If adult term exists anywhere and previous had children, and no explicit "also" or "too"
      // This is a fallback for cases where "for adult" might not be exactly at the end
      if (hasChildren && hasAdultTerm && !currentMessage.toLowerCase().includes('also') && !currentMessage.toLowerCase().includes('too')) {
        // Only if adult term is in the second half of the message
        if (adultTermIndex >= currentMessage.length * 0.5) {
          logger.debug('age_group_switch_detected', {
            type: 'Children → Adult (adult term in second half, no "also"/"too")',
            hasChildren,
            hasAdultTerm,
            adultTermIndex,
            messageLength: currentMessage.length,
            threshold: currentMessage.length * 0.5,
          });
          return true; // Children → Adult switch
        }
      }
      
      // If adult term is NOT at the end, check for complete switches
      if (hasChildren && hasAdultTerm && !isAdultTermNearEnd) {
        // Adult term in middle/beginning but previous had children - might be adding, not replacing
        // Only treat as switch if previous had ONLY children and current has ONLY adult intent
        // For now, be conservative - don't treat as switch if adult term is not at end
        return false;
      }
      
      // Complete switch detected if:
      // 1. Previous had children's ages AND current has adult terminology at end (already handled above)
      // 2. Previous had adult AND current has children's mentions (without adult term)
      if (hasAdult && hasChildrenMention && !hasAdultTerm) {
        logger.debug('age_group_switch_detected', {
          type: 'Adult → Children',
          hasAdult,
          hasChildrenMention,
          hasAdultTerm,
        });
        return true; // Adult → Children switch
      }
      
      logger.debug('age_group_switch_check_result', {
        hasChildren,
        hasAdult,
        hasAdultTerm,
        isAdultTermNearEnd,
        hasChildrenMention,
        adultTermIndex,
        messageLength: currentMessage.length,
        threshold: currentMessage.length * 0.7,
        detected: false,
      });
      
      return false;
    })();
    
    // If complete age group switch detected, force new_search with preserved constraints
    if (hasCompleteAgeGroupSwitch) {
      logger.info('age_group_switch_detected_programmatically', {
        previousQuery: previousQuery.substring(0, 100),
        currentMessage: currentMessage.substring(0, 100),
        previousAgeGroups: previousConstraints?.ageGroups,
        note: 'Complete age group switch detected - forcing new_search while preserving portable constraints',
      });
      
      // Build preserved constraints based on constraint preservation logic
      const preservedConstraints: FashionConstraints = {
        ageGroups: null, // Let classifier set the correct age group
        // Preserve portable constraints (colors if mentioned, occasions, seasons, formalityLevel)
        colors: (explicitIntent.preserveColors || explicitIntent.explicitColorMentions.length > 0 || 
                 (areSimilar && previousConstraints?.colors)) // Also preserve if categories are similar
          ? previousConstraints?.colors || undefined
          : undefined,
        occasions: previousConstraints?.occasions || undefined, // Universal - always preserve
        seasons: previousConstraints?.seasons || undefined, // Universal - always preserve
        formalityLevel: previousConstraints?.formalityLevel || undefined, // Universal - always preserve
        priceMinCents: (explicitIntent.preservePrice || areSimilar) 
          ? previousConstraints?.priceMinCents 
          : undefined,
        priceMaxCents: (explicitIntent.preservePrice || areSimilar) 
          ? previousConstraints?.priceMaxCents 
          : undefined,
        // Reset category-specific constraints
        lengths: null,
        sleeveLengths: null,
        necklines: null,
        fits: null,
        patterns: null,
        materials: null,
        sizes: null,
        styles: null,
        collections: null,
        embellishments: null,
        // Reset other category-specific
        braSolution: null,
        pockets: null,
        liningType: null,
        scents: null,
        rooms: null,
      };
      
      return {
        mergedConstraints: preservedConstraints,
        enhancedQueryText: (() => {
          // Extract clean enhanced query: remove old age group mentions, keep only new intent
          // Example: "clothes for my 6 year old and 12 year old only red dresses for adult" 
          // → "red dresses for adult" or "only red dresses for adult"
          const prevAgeGroupsForExtraction = previousConstraints && Array.isArray(previousConstraints.ageGroups) 
            ? previousConstraints.ageGroups 
            : (previousConstraints?.ageGroups as any)?.values || [];
          const prevAgeGroupsNormalized = normalizeAgeGroups(prevAgeGroupsForExtraction);
          const childrenAgeGroups = ['Toddler', 'Kids', 'Tween', 'Teen'];
          const adultAgeGroups = ['Adult'];
          
          let cleanMessage = currentMessage;
          const messageLower = currentMessage.toLowerCase();
          
          // If previous had children's ages, remove children's age mentions
          if (prevAgeGroupsNormalized.some(ag => childrenAgeGroups.includes(ag))) {
            cleanMessage = cleanMessage.replace(/\b(for\s+my\s+)?(?:2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19)[\s-]*(?:year|years)[\s-]*old\b/gi, '');
            cleanMessage = cleanMessage.replace(/\bfor\s+(?:kids|children|child|toddler|toddlers|baby|babies|daughter|son|kid)\b/gi, '');
            cleanMessage = cleanMessage.replace(/\bclothes\s+for\s+my\s+(?:daughter|son|kid|child)\b/gi, '');
          }
          
          // If previous had adult, remove adult mentions (for adult → children switch)
          if (prevAgeGroupsNormalized.some(ag => adultAgeGroups.includes(ag))) {
            cleanMessage = cleanMessage.replace(/\bfor\s+(?:adult|adults|women|men|ladies|gentlemen|woman|man)\b/gi, '');
          }
          
          // Clean up extra spaces and "and" connectors
          cleanMessage = cleanMessage.replace(/\s+and\s+/gi, ' ');
          cleanMessage = cleanMessage.replace(/\s+/g, ' ').trim();
          
          // Remove leading "clothes" if it's just a generic term
          if (cleanMessage.toLowerCase().startsWith('clothes ') && 
              !cleanMessage.toLowerCase().match(/\bclothes\s+(?:rack|hanger|organizer|storage)\b/i)) {
            cleanMessage = cleanMessage.replace(/^clothes\s+/i, '');
          }
          
          // If message is too short, extract product type + new age group
          if (cleanMessage.length < 5) {
            const adultTermMatch = currentMessage.match(/\b(for\s+(?:adult|adults|women|men|ladies|gentlemen|woman|man))\b/i);
            const productTypeMatch = currentMessage.match(/\b(?:only\s+)?(?:red|blue|green|yellow|black|white|pink|purple|orange|brown|gray|grey|navy|beige|gold|silver|bronze|coral|mint|lavender|blush|ivory|cream|tan|teal|turquoise|emerald|burgundy|maroon|plum|charcoal|sage|olive|rust|terracotta|peach|lemon|cherry|crimson|scarlet|chocolate)\s+(?:dress|dresses|top|tops|bottom|bottoms|skirt|skirts|cardigan|cardigans|sweater|sweaters|swimsuit|swimsuits|bikini|bikinis|jogger|joggers|pant|pants|short|shorts)\w*/i);
            
            if (productTypeMatch && adultTermMatch) {
              cleanMessage = `${productTypeMatch[0]} ${adultTermMatch[0]}`;
            } else if (adultTermMatch) {
              const adultIndex = messageLower.indexOf(adultTermMatch[0].toLowerCase());
              if (adultIndex > 0) {
                const beforeAdult = currentMessage.substring(0, adultIndex).trim();
                const cleanedBefore = beforeAdult.replace(/\b(for\s+my\s+)?(?:2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19)[\s-]*(?:year|years)[\s-]*old\b/gi, '')
                  .replace(/\bfor\s+(?:kids|children|child|toddler|toddlers|baby|babies)\b/gi, '')
                  .replace(/\bclothes\s+for\s+my\s+(?:daughter|son|kid|child)\b/gi, '')
                  .replace(/\s+and\s+/gi, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                
                if (cleanedBefore.length > 0) {
                  cleanMessage = `${cleanedBefore} ${adultTermMatch[0]}`;
                }
              }
            }
          }
          
          const finalQuery = cleanMessage.trim() || currentMessage;
          logger.info('age_group_switch_enhanced_query_extracted', {
            originalMessage: currentMessage.substring(0, 100),
            extractedQuery: finalQuery,
            previousAgeGroups: prevAgeGroupsNormalized,
            note: 'Extracted clean enhanced query with old age group mentions removed',
          });
          return finalQuery;
        })(),
        mergeAction: 'new_search',
        reason: 'Complete age group switch detected - treating as new search while preserving portable constraints (colors, occasions, seasons)',
      };
    }
    
    // Extract conversation context: get all user messages to help trace back product type
    let conversationContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const userMessages = conversationHistory
        .filter(h => h.role === 'user')
        .slice(-5) // Last 5 user messages for context
        .map((msg, idx) => `${idx + 1}. "${msg.content}"`)
        .join('\n');
      if (userMessages) {
        conversationContext = `\n\nCONVERSATION HISTORY (recent user queries, in order):\n${userMessages}\n\nUse this history to trace back to the ORIGINAL product type. For example, if the conversation was:\n1. "dresses in light colours"\n2. "only in light colours"\n3. "find floral ones"\n\nWhen processing query #3, you should trace back to query #1 to find "dresses" as the product type, even though query #2 ("only in light colours") doesn't mention it.`;
      }
    }
    
    // Extract the last assistant message (bot reply) from conversation history
    // This helps understand what products/attributes were just shown to the user
    let previousBotReply = '';
    if (conversationHistory && conversationHistory.length > 0) {
      const assistantMessages = conversationHistory
        .filter(h => h.role === 'assistant')
        .slice(-1); // Get the last assistant message
      if (assistantMessages.length > 0) {
        previousBotReply = assistantMessages[0].content.substring(0, 500); // Limit to 500 chars
      }
    }
    
    // If no bot reply found, use a placeholder
    if (!previousBotReply) {
      previousBotReply = 'No previous bot reply available';
    }
    
    // Format category information for prompt
    const previousCategoriesText = previousCategories && previousCategories.length > 0
      ? JSON.stringify(previousCategories)
      : '[] (no previous categories available)';
    
    const currentCategoriesText = currentCategories && currentCategories.length > 0
      ? JSON.stringify(currentCategories)
      : '[] (no current categories available)';
    
    const prompt = CONSTRAINT_MERGER_PROMPT
      .replace('{PREVIOUS_QUERY}', previousQuery)
      .replace('{PREVIOUS_CONSTRAINTS}', constraintsText)
      .replace('{PREVIOUS_BOT_REPLY}', previousBotReply)
      .replace('{PREVIOUS_CATEGORIES}', previousCategoriesText)
      .replace('{CURRENT_CATEGORIES}', currentCategoriesText)
      .replace('{CATEGORIES_ARE_SIMILAR}', areSimilar ? 'true' : 'false')
      .replace('{USER_EXPLICITLY_PRESERVES_COLORS}', explicitIntent.preserveColors ? 'true' : 'false')
      .replace('{USER_EXPLICITLY_PRESERVES_PRICE}', explicitIntent.preservePrice ? 'true' : 'false')
      .replace('{EXPLICIT_COLOR_MENTIONS}', explicitIntent.explicitColorMentions.length > 0 ? JSON.stringify(explicitIntent.explicitColorMentions) : '[]')
      .replace('{EXPLICIT_PRICE_MENTIONS}', explicitIntent.explicitPriceMentions.length > 0 ? JSON.stringify(explicitIntent.explicitPriceMentions) : '[]')
      .replace('{CURRENT_MESSAGE}', currentMessage)
      + conversationContext;

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a constraint merger for a shopping assistant. Use HUMAN JUDGMENT and COMMON SENSE to determine if a follow-up message is truly a refinement or a new search. Think like a human: evaluate product type compatibility, age group appropriateness (e.g., newborns don\'t wear joggers), occasion/context compatibility, and category compatibility. CRITICALLY: If the user expresses negative preferences (e.g., "don\'t like coconutty", "not floral") based on products shown in PREVIOUS_BOT_REPLY, this is ALWAYS a follow-up refinement - preserve the product type from PREVIOUS_QUERY and remove/exclude the disliked attributes. If ANY aspect is logically incompatible (e.g., joggers for newborns, bikinis for weddings), treat it as a new search. You have FULL FREEDOM to use your judgment - if something doesn\'t make logical sense, it\'s a new search. Intelligently merge, replace, or remove constraints ONLY when the follow-up makes complete logical sense across ALL dimensions (product type, age group, occasion, category).',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: {
        name: 'ConstraintMergeResult',
        schema: {
          type: 'object',
          properties: {
            mergedConstraints: {
              type: 'object',
              properties: {
                // Support both old format (array) and new format (object with intent) for backward compatibility
                styles: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                lengths: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                occasions: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                seasons: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                materials: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                patterns: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                colors: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                sizes: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                fits: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                collections: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                priceMinCents: { 
                  oneOf: [
                    { type: ['integer', 'null'] },
                    { 
                      type: 'object',
                      properties: {
                        value: { type: 'integer' },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] }
                      },
                      required: ['value', 'intent']
                    }
                  ]
                },
                priceMaxCents: { 
                  oneOf: [
                    { type: ['integer', 'null'] },
                    { 
                      type: 'object',
                      properties: {
                        value: { type: 'integer' },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] }
                      },
                      required: ['value', 'intent']
                    }
                  ]
                },
                embellishments: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                necklines: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                sleeveLengths: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                ageGroups: { 
                  oneOf: [
                    { type: ['array', 'null'], items: { type: 'string' } },
                    { 
                      type: 'object',
                      properties: {
                        values: { type: 'array', items: { type: 'string' } },
                        intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                        similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                      },
                      required: ['values', 'intent']
                    }
                  ]
                },
                scents: { type: ['array', 'null'], items: { type: 'string' } },
                rooms: { type: ['array', 'null'], items: { type: 'string' } },
                useCases: { type: ['array', 'null'], items: { type: 'string' } },
                benefits: { type: ['array', 'null'], items: { type: 'string' } },
                claims: { type: ['array', 'null'], items: { type: 'string' } },
                sensoryProfile: { type: ['string', 'null'] },
                compatibility: { type: ['array', 'null'], items: { type: 'string' } },
              },
            },
            enhancedQueryText: { type: 'string' },
            mergeAction: { type: 'string', enum: ['merge', 'replace', 'remove', 'new_search'] },
            reason: { type: 'string' },
          },
          required: ['mergedConstraints', 'enhancedQueryText', 'mergeAction', 'reason'],
        },
      },
    });

    const merged = JSON.parse(result.rawText) as ConstraintMergeResult;

    // Build detailed constraints summary
    const mergedConstraintsSummary: Record<string, any> = {};
    if (merged.mergedConstraints.colors) mergedConstraintsSummary.colors = merged.mergedConstraints.colors;
    if (merged.mergedConstraints.sizes) mergedConstraintsSummary.sizes = merged.mergedConstraints.sizes;
    if (merged.mergedConstraints.occasions) mergedConstraintsSummary.occasions = merged.mergedConstraints.occasions;
    if (merged.mergedConstraints.styles) mergedConstraintsSummary.styles = merged.mergedConstraints.styles;
    if (merged.mergedConstraints.patterns) mergedConstraintsSummary.patterns = merged.mergedConstraints.patterns;
    if (merged.mergedConstraints.materials) mergedConstraintsSummary.materials = merged.mergedConstraints.materials;
    if (merged.mergedConstraints.seasons) mergedConstraintsSummary.seasons = merged.mergedConstraints.seasons;
    if (merged.mergedConstraints.fits) mergedConstraintsSummary.fits = merged.mergedConstraints.fits;
    if (merged.mergedConstraints.collections) mergedConstraintsSummary.collections = merged.mergedConstraints.collections;
    if (merged.mergedConstraints.embellishments) mergedConstraintsSummary.embellishments = merged.mergedConstraints.embellishments;
    if (merged.mergedConstraints.necklines) mergedConstraintsSummary.necklines = merged.mergedConstraints.necklines;
    if (merged.mergedConstraints.sleeveLengths) mergedConstraintsSummary.sleeveLengths = merged.mergedConstraints.sleeveLengths;
    if (merged.mergedConstraints.ageGroups) {
      // Normalize age groups to match dataset values
      // Extract values if it's in intent format
      const ageGroupValues = extractConstraintValues(merged.mergedConstraints.ageGroups) || (Array.isArray(merged.mergedConstraints.ageGroups) ? merged.mergedConstraints.ageGroups : []);
      const ageGroupIntent = extractConstraintIntent(merged.mergedConstraints.ageGroups);
      const normalized = normalizeAgeGroups(ageGroupValues);
      // Preserve intent format
      mergedConstraintsSummary.ageGroups = normalized.length > 0 
        ? (ageGroupIntent ? { values: normalized, intent: ageGroupIntent } : normalized)
        : undefined;
    }
    if (merged.mergedConstraints.priceMinCents !== undefined && merged.mergedConstraints.priceMinCents !== null) mergedConstraintsSummary.priceMinCents = merged.mergedConstraints.priceMinCents;
    if (merged.mergedConstraints.priceMaxCents !== undefined && merged.mergedConstraints.priceMaxCents !== null) mergedConstraintsSummary.priceMaxCents = merged.mergedConstraints.priceMaxCents;

    // Check for product type in enhanced query
    const productTypeKeywords = ['dress', 'dresses', 'top', 'tops', 'bottom', 'bottoms', 'skirt', 'skirts', 'swimsuit', 'swimsuits', 'bikini', 'bikinis', 'jogger', 'joggers', 'pant', 'pants', 'short', 'shorts', 'romper', 'rompers', 'onesie', 'onesies', 'sleeper', 'sleepers'];
    const enhancedQueryLower = merged.enhancedQueryText.toLowerCase();
    const detectedProductType = productTypeKeywords.find(kw => enhancedQueryLower.includes(kw));

    logger.info('constraint_merger_result', {
      previousQuery: previousQuery.substring(0, 200),
      currentMessage: currentMessage.substring(0, 200),
      mergeAction: merged.mergeAction,
      reason: merged.reason,
      enhancedQueryText: merged.enhancedQueryText,
      detectedProductType: detectedProductType || 'none',
      hasProductTypeInEnhanced: !!detectedProductType,
      mergedConstraintsCount: Object.keys(mergedConstraintsSummary).length,
      allMergedConstraints: mergedConstraintsSummary,
      previousConstraintsProvided: previousConstraints ? Object.keys(previousConstraints).filter(k => previousConstraints![k as keyof typeof previousConstraints] !== undefined && previousConstraints![k as keyof typeof previousConstraints] !== null) : [],
      conversationHistoryLength: conversationHistory?.length || 0,
      hasPreviousBotReply: !!previousBotReply && previousBotReply !== 'No previous bot reply available',
      previousBotReplyPreview: previousBotReply !== 'No previous bot reply available' ? previousBotReply.substring(0, 150) : undefined,
    });

    logger.debug('constraints_merged', {
      previousQuery: previousQuery.substring(0, 100),
      currentMessage: currentMessage.substring(0, 100),
      mergeAction: merged.mergeAction,
      reason: merged.reason,
      hasPrice: !!merged.mergedConstraints.priceMaxCents || !!merged.mergedConstraints.priceMinCents,
    });

    return merged;
  } catch (error) {
    logger.error('constraint_merge_failed', {
      error: error instanceof Error ? error.message : String(error),
      previousQuery: previousQuery.substring(0, 100),
      currentMessage: currentMessage.substring(0, 100),
    });

    // Fallback: simple merge (keep all previous, add new from current message)
    return {
      mergedConstraints: { ...previousConstraints },
      enhancedQueryText: `${previousQuery} ${currentMessage}`,
      mergeAction: 'merge',
      reason: 'Fallback: simple merge due to LLM error',
    };
  }
}

/**
 * Detect if a message is a follow-up refinement
 * 
 * This is a permissive check - we let the LLM in mergeFollowUpConstraints
 * make the final decision. This function just identifies likely follow-ups
 * to trigger the LLM-based merging process.
 */
export function isFollowUpRefinement(message: string, hasPreviousConstraints: boolean): boolean {
  // Allow pattern matching even without previous constraints - we can infer from query text
  // The hasPreviousConstraints flag is informational but doesn't block pattern detection

  const lower = message.toLowerCase().trim();
  const words = lower.split(/\s+/);
  const isShort = words.length < 15; // More permissive: up to 15 words
  
  // Common follow-up indicators (anywhere in message, not just start)
  const followUpIndicators = [
    // Direct modification phrases
    /\b(make it|more|less|also|add|with|instead|change|switch|replace|any|remove|no\s+\w+|cheaper|prefer|actually|rather|better|different)\b/i,
    // Price-related phrases
    /\b(under|over|above|below|up to|at least|more than|less than)\s+\$?\d+/i,
    /\bprice\s+(can|may|could|should|must)\s+be\s+(higher|lower|more|less)/i,
    /\bprice\s+(doesn't|does not|don't|do not)\s+matter/i,
    // Constraint relaxation phrases
    /\b(close|similar|near|almost|relax|loosen|flexible|flexible with|open to)\s+(matches?|results?|options?|constraints?)?/i,
    /\bshow\s+me\s+(close|similar|near|almost|relaxed|flexible)/i,
    // Size/color mentions
    /\bsize\s+\w+/i,
    /\bin\s+(black|navy|red|blue|white|pink|green|yellow|purple|orange|brown|gray|grey)\b/i,
    // Constraint modification phrases
    /\b(keep|maintain|preserve|same)\s+(the|all|other)?\s*(constraints?|criteria|requirements?)?/i,
    /\b(except|but|however|though)\s+(for|with|the)?/i,
  ];
  
  const hasFollowUpIndicator = followUpIndicators.some(pattern => pattern.test(lower));
  
  // If it's a short message with follow-up indicators, likely a follow-up
  if (isShort && hasFollowUpIndicator) {
    return true;
  }
  
  // Also check if it starts with common follow-up phrases
  const startsWithFollowUp = /^(make it|more|less|also|add|with|instead|change to|switch to|replace with|any|remove|no\s+\w+|cheaper|actually|i prefer|prefer|rather|better|different|show me close|show me similar|close matches|price can)/i.test(lower);
  
  // If message mentions "matches", "close", "similar" in context of previous search, likely a follow-up
  const mentionsMatches = /\b(close|similar|near|almost|relax|flexible)\s+(matches?|results?|options?)/i.test(lower);
  
  // If message mentions price modification in any form, likely a follow-up
  const mentionsPriceModification = /\bprice\s+(can|may|could|should|must|doesn't|does not|don't|do not|is|can be|may be)/i.test(lower);
  
  return startsWithFollowUp || (isShort && (mentionsMatches || mentionsPriceModification));
}
