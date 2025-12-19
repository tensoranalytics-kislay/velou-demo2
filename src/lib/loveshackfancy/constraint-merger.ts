/**
 * Constraint Merger
 * 
 * Intelligently merges, replaces, or removes constraints from follow-up queries
 * using LLM to understand user intent (merge vs replace vs remove).
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import type { FashionConstraints } from './classifier';

export type ConstraintMergeResult = {
  mergedConstraints: FashionConstraints;
  enhancedQueryText: string; // Enhanced query text for vector search
  mergeAction: 'merge' | 'replace' | 'remove' | 'new_search';
  reason: string;
};

const CONSTRAINT_MERGER_PROMPT = `You are a constraint merger for a shopping assistant. The catalog includes multiple category groups: Kids, Women's/Adult Apparel, Accessories, Personal Care, and Home & Living (48 total categories). You handle constraint merging for queries across all these category groups.

PREVIOUS QUERY: "{PREVIOUS_QUERY}"
PREVIOUS CONSTRAINTS: {PREVIOUS_CONSTRAINTS}

CURRENT FOLLOW-UP MESSAGE: "{CURRENT_MESSAGE}"

IMPORTANT: Infer the complete product type from PREVIOUS_CONSTRAINTS or PREVIOUS_QUERY
- If PREVIOUS_CONSTRAINTS is null, infer constraints and product type from PREVIOUS_QUERY text
- If PREVIOUS_QUERY is incomplete (e.g., "one piece please"), look at PREVIOUS_CONSTRAINTS to infer the full product type
- If PREVIOUS_CONSTRAINTS has styles like ["One-Piece", "Swimsuit"], the previous query was about "one piece swimsuit"
- If PREVIOUS_CONSTRAINTS has categories or styles, use them to construct the complete product type
- If PREVIOUS_CONSTRAINTS is null, parse PREVIOUS_QUERY to extract product type (e.g., "Girls Swimwear Bikinis" → product type is "bikini" or "swimwear", ageGroups: ["kids"])
- The enhanced query MUST include the complete product type (e.g., "one piece swimsuit under $150", NOT just "one piece under $150")

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
   - If CURRENT_MESSAGE explicitly says "new search", "something else", "different item" → NEW SEARCH
   
   **FOLLOW-UP SIGNALS** (only if logically compatible):
   - If CURRENT_MESSAGE mentions "close matches", "similar", "relax", "flexible", "price can be", or modifies constraints from PREVIOUS_QUERY → FOLLOW-UP
   - If CURRENT_MESSAGE is vague but mentions modifying/relaxing constraints → FOLLOW-UP
   - If product type + occasion/context are LOGICALLY COMPATIBLE → FOLLOW-UP
   
2. **If mergeAction is "new_search"**:
   - Set mergedConstraints to empty/null values (reset everything)
   - Set enhancedQueryText to CURRENT_MESSAGE (use as-is, don't merge with previous)
   - This indicates the orchestrator should treat this as a completely new search
   
3. **If it's a follow-up** (mergeAction: "merge", "replace", or "remove"):
   - Determine the user's intent: MERGE, REPLACE, or REMOVE constraints
   - Intelligently merge/replace/remove constraints based on the follow-up message
   - Create an enhanced query text that captures the complete intent, INCLUDING the full product type inferred from PREVIOUS_CONSTRAINTS

CRITICAL: Category Changes = New Search
- If the current message changes the product category (e.g., "show me swimsuits" after "show me tops"), this is a NEW SEARCH
- For new searches, you should RESET ALL constraints including price constraints - start completely fresh
- Examples:
  * "show me loungewear" after "black swimsuits under $150" → mergeAction: "new_search", RESET all constraints
  * "Actually, show me swimsuits instead" → mergeAction: "new_search", RESET all previous constraints including price
- IMPORTANT: When this function is called for a NEW SEARCH (not a follow-up), the orchestrator will pass null for PREVIOUS_CONSTRAINTS, so you won't need to reset - but if you detect a category change or logical incompatibility, use mergeAction: "new_search"

CRITICAL: Logical Incompatibility = New Search (Most Important)
- **Use human judgment and common sense**: Would a reasonable person wear/use the previous product type for the new occasion/context? Does the product type make sense for the age group?
- **Think like a human**: If something doesn't make logical sense (e.g., joggers for a newborn, bikinis for a wedding), it's a NEW SEARCH
- Examples of INCOMPATIBLE (use mergeAction: "new_search"):
  * **Age Group Incompatibility**:
    - PREVIOUS="dress for newborn" or "newborn outfit" + CURRENT="joggers" or "relaxed fit joggers" → NEW SEARCH (newborns don't wear joggers - they wear onesies, sleepers, dresses, rompers)
    - PREVIOUS="newborn" + CURRENT="adult sizes" or "adult clothing" → NEW SEARCH (age group mismatch)
    - PREVIOUS="baby clothes" + CURRENT="toddler sizes" → NEW SEARCH (age group mismatch, unless explicitly changing age group)
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

MERGE (add/update constraints while keeping others):
- "make it black" → add/update colors: ["Black"], keep all other constraints (price, occasion, pattern, etc.)
  * Enhanced query: "[previous product type] black" (e.g., "tops black" if previous was "tops")
  * If PREVIOUS_QUERY is incomplete, infer from PREVIOUS_CONSTRAINTS (e.g., if constraints show styles=["Top"], use "tops")
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
- "instead, show me mini dresses" → replace lengths: ["Mini"], keep category, price, colors, and other constraints
  * Enhanced query: "[color] [material] mini dress [other attributes]" (natural ordering)
- "change to navy" → replace colors: ["Navy"], keep price, occasion, pattern, and other constraints
  * Enhanced query: "navy [material] [product type] [other attributes]" (color first, natural flow)
  * Example: PREVIOUS_QUERY: "red silk maxi dress", CURRENT_MESSAGE: "change to navy"
    → enhancedQueryText: "navy silk maxi dress" (NOT "silk maxi dress navy" or "red silk maxi dress navy")
- "i like chocolate coloured ones" after colors were removed → replace colors: ["Chocolate"], keep all other constraints
  * Enhanced query: "chocolate [material] [product type] [other attributes]" (color first, natural ordering)
  * Example: PREVIOUS_QUERY: "silk maxi dress long sleeves" (colors removed), CURRENT_MESSAGE: "i like chocolate coloured ones"
    → enhancedQueryText: "chocolate silk maxi dress long sleeves" (natural, flows well)
- "actually, under $200" → replace priceMaxCents: 20000, keep priceMinCents if it exists, keep all other constraints
- "not floral, show me solid" → replace patterns: ["Solid"], remove "Floral", keep other constraints
- "Actually, I prefer a mini dress instead" → replace lengths: ["Mini"], keep pattern, occasion, price, and other constraints from previous query
- "I prefer X instead" → replace the relevant constraint (X), keep all other constraints from previous query
- "over $100" when priceMaxCents exists → replace priceMinCents: 10000, keep priceMaxCents, keep other constraints
- "under $200" when priceMinCents exists → replace priceMaxCents: 20000, keep priceMinCents, keep other constraints

REMOVE (explicitly remove constraints, keep others):
- "any color is fine" → remove colors constraint (set to null), keep price, occasion, pattern, and other constraints
- "price doesn't matter" → remove priceMinCents and priceMaxCents (set to null), keep colors, occasion, pattern, and other constraints
- "any occasion" → remove occasions constraint (set to null), keep price, colors, pattern, and other constraints
- "no pattern preference" → remove patterns constraint (set to null), keep other constraints
- "its fine if its not silk" or "not silk" or "any material is fine" → remove materials constraint (set to null), keep colors, occasion, pattern, and other constraints
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
9. The enhancedQueryText should be a complete, searchable query that includes ALL merged constraints
10. "Actually, I prefer X" or "I prefer X instead" → REPLACE the constraint for X, keep all other constraints from previous query
11. CRITICAL: When creating enhancedQueryText, ALWAYS preserve the COMPLETE product type/category
    - INFER the complete product type from PREVIOUS_CONSTRAINTS if PREVIOUS_QUERY is incomplete
    - If PREVIOUS_QUERY was "one piece please" but PREVIOUS_CONSTRAINTS shows styles=["One-Piece", "Swimsuit"], infer the product type is "one piece swimsuit"
    - If PREVIOUS_QUERY was "one piece swimsuit" and current message is "under $150", enhancedQueryText should be "one piece swimsuit under $150" (NOT just "one piece under $150")
    - If PREVIOUS_QUERY was "red silk maxi dress..." and current message is "price can be higher", enhancedQueryText should be "red silk maxi dress [other constraints]" (preserve all constraints except price max)
12. CRITICAL: enhancedQueryText must be NATURAL and COHERENT
    - Write the query as a natural, searchable phrase that flows well
    - Use natural attribute ordering: color → material → product type → style attributes → size → occasion → price
    - Example good ordering: "chocolate silk maxi dress long sleeves floral formal wedding size 4"
    - Avoid redundant words: use "chocolate" not "chocolate color", "silk" not "silk material", "size 4" not "size 4 size"
    - When adding a constraint back after removal, integrate it naturally:
      * PREVIOUS_QUERY: "silk maxi dress..." (colors were removed), CURRENT_MESSAGE: "i like chocolate coloured ones"
      * → enhancedQueryText: "chocolate silk maxi dress..." (natural, flows well)
      * NOT: "silk maxi dress chocolate color" (awkward ordering)
      * NOT: "chocolate color silk maxi dress" (redundant "color" word)
    - Ensure the query reads like a complete, natural search query that a user might type
    - Group related attributes together (e.g., "long sleeves" together, not separated)
    - Use common fashion terminology (e.g., "v-neck" not "v neck", "maxi dress" not "maxi-dress")
13. CRITICAL: When REMOVING constraints, REMOVE related keywords from enhancedQueryText
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
14. CONSTRAINT RELAXATION: Phrases like "close matches", "similar options", "price can be higher" indicate the user wants to relax specific constraints while keeping others
    - "show me close matches" → MERGE (keep all constraints, no changes)
    - "price can be higher" → REMOVE priceMaxCents (set to null), keep all other constraints including priceMinCents if exists
    - "show me close matches, price can be higher" → REMOVE priceMaxCents (set to null), keep all other constraints
    - If PREVIOUS_QUERY was "black tops" and current message is "cheaper", enhancedQueryText should be "black tops cheaper" or "black tops under $X" (preserve "tops" category)
    - The enhancedQueryText must be a complete, standalone query that includes the FULL product type (inferred from constraints if needed) plus any new constraints from the current message
    - This ensures the enhanced query can be properly categorized as direct_search instead of indirect_search

Output JSON:
{
  "mergedConstraints": { ...FashionConstraints },
  "enhancedQueryText": "complete, natural query text with all constraints in logical order (or CURRENT_MESSAGE as-is if new_search)",
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
- Must read as a natural, searchable query (like a user would type)
- Use natural attribute ordering: color → material → product type → style details → size → occasion → price
- Avoid redundant words ("chocolate color" → "chocolate", "silk material" → "silk")
- When adding constraints back after removal, place them in natural positions (color first, not last)
- Group related attributes together ("long sleeves" stays together)
- The query should be complete and coherent, not a jumbled list of attributes
`;

export async function mergeFollowUpConstraints(
  previousQuery: string,
  previousConstraints: FashionConstraints | null,
  currentMessage: string
): Promise<ConstraintMergeResult> {
  try {
    // If previous constraints are missing, infer from previous query text
    const constraintsText = previousConstraints 
      ? JSON.stringify(previousConstraints, null, 2)
      : 'null (constraints not available - infer from PREVIOUS_QUERY text)';
    
    const prompt = CONSTRAINT_MERGER_PROMPT
      .replace('{PREVIOUS_QUERY}', previousQuery)
      .replace('{PREVIOUS_CONSTRAINTS}', constraintsText)
      .replace('{CURRENT_MESSAGE}', currentMessage);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a constraint merger for a fashion shopping assistant. Use HUMAN JUDGMENT and COMMON SENSE to determine if a follow-up message is truly a refinement or a new search. Think like a human: evaluate product type compatibility, age group appropriateness (e.g., newborns don\'t wear joggers), occasion/context compatibility, and category compatibility. If ANY aspect is logically incompatible (e.g., joggers for newborns, bikinis for weddings), treat it as a new search. You have FULL FREEDOM to use your judgment - if something doesn\'t make logical sense, it\'s a new search. Intelligently merge, replace, or remove constraints ONLY when the follow-up makes complete logical sense across ALL dimensions (product type, age group, occasion, category).',
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
                styles: { type: ['array', 'null'], items: { type: 'string' } },
                lengths: { type: ['array', 'null'], items: { type: 'string' } },
                occasions: { type: ['array', 'null'], items: { type: 'string' } },
                seasons: { type: ['array', 'null'], items: { type: 'string' } },
                materials: { type: ['array', 'null'], items: { type: 'string' } },
                patterns: { type: ['array', 'null'], items: { type: 'string' } },
                colors: { type: ['array', 'null'], items: { type: 'string' } },
                sizes: { type: ['array', 'null'], items: { type: 'string' } },
                fits: { type: ['array', 'null'], items: { type: 'string' } },
                collections: { type: ['array', 'null'], items: { type: 'string' } },
                priceMinCents: { type: ['integer', 'null'] },
                priceMaxCents: { type: ['integer', 'null'] },
                embellishments: { type: ['array', 'null'], items: { type: 'string' } },
                necklines: { type: ['array', 'null'], items: { type: 'string' } },
                sleeveLengths: { type: ['array', 'null'], items: { type: 'string' } },
                ageGroups: { type: ['array', 'null'], items: { type: 'string' } },
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

