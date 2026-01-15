/**
 * LoveShackFancy Fashion-Specific Prompts
 * 
 * All LLM prompts for fashion query classification, reply generation,
 * and dialogue routing.
 */

import { LOVESHACKFANCY_ONTOLOGY } from './ontology';
import { formatDictionaryForPrompt, loadConstraintDictionaries } from './constraint-dictionaries';
import { CATEGORY_GENDER_MAP } from '../catalog/category-gender-map';

// ============================================================================
// QUERY CLASSIFIER PROMPT
// ============================================================================

/**
 * Organize categories into semantic groups for prompt display
 */
function organizeCategoriesIntoGroups(allowedCategories: string[]): {
  mensApparel: string[];
  womensApparel: string[];
  kidsCategories: string[];
  accessories: string[];
  personalCare: string[];
  homeLiving: string[];
} {
  const groups = {
    mensApparel: [] as string[],
    womensApparel: [] as string[],
    kidsCategories: [] as string[],
    accessories: [] as string[],
    personalCare: [] as string[],
    homeLiving: [] as string[],
  };

  // Define category group patterns
  const patterns = {
    mensApparel: /^(Mens-|men's |mens |shirt|jacket|polo|sweatshirt|sleepwear|long sleeve|crew neck|bundles|sets)/i,
    kidsCategories: /^(Girls |Tween |Baby & Toddler)/i,
    womensApparel: /^(Women's|Womens-|Tops|Bottoms|Skirts|Skorts|Activewear|Swimsuits|Loungewear|Robes|Pajama Set|Sweaters|Ski |Outerwear|Clothing|Maxi Dress|Mini Dress|top|loungewear|mini dress|tank top|skinny jeans|mom jeans|straight|cropped|wide leg|joggers|underwear|flirty|graphic tee|casual t-shirts)/i,
    accessories: /^(Accessories|Jewelry|Hair |Handbags|Luggage|Phone Cases|Clothing Accessories|Bandanas|Scarves)/i,
    personalCare: /^(Perfumes|Cosmetics)/i,
    homeLiving: /^(Bedding|Bathroom|Towels|Tabletop|Kitchen|Stationary|Interiors|Candle|Home |Decor|Textiles|Drinkware|Filing|Pool|Seasonal|Fragrance Tray|Artwork|Pets|Gift Wrapping|Food & Beverage|Table Linens|gift card)/i,
  };

  for (const category of allowedCategories) {
    if (patterns.mensApparel.test(category)) {
      groups.mensApparel.push(category);
    } else if (patterns.kidsCategories.test(category)) {
      groups.kidsCategories.push(category);
    } else if (patterns.womensApparel.test(category)) {
      groups.womensApparel.push(category);
    } else if (patterns.accessories.test(category)) {
      groups.accessories.push(category);
    } else if (patterns.personalCare.test(category)) {
      groups.personalCare.push(category);
    } else if (patterns.homeLiving.test(category)) {
      groups.homeLiving.push(category);
    } else {
      // Fallback: categorize by common keywords or put in a default group
      // For now, add uncategorized items to accessories or home depending on context
      groups.homeLiving.push(category);
    }
  }

  return groups;
}

/**
 * Build the query classifier prompt with dictionary-based constraint matching
 * 
 * @param allowedCategories - Categories filtered by gender context (if applicable)
 */
export function buildQueryClassifierPrompt(allowedCategories: string[]): string {
  const dictionaries = loadConstraintDictionaries();
  
  // Organize categories into semantic groups
  const groups = organizeCategoriesIntoGroups(allowedCategories);
  
  // Build category sections (only show groups with categories)
  const categorySections: string[] = [];
  
  if (groups.mensApparel.length > 0) {
    categorySections.push(`**Men's Apparel**: ${groups.mensApparel.join(', ')}`);
  }
  if (groups.womensApparel.length > 0) {
    categorySections.push(`**Women's Apparel**: ${groups.womensApparel.join(', ')}`);
  }
  if (groups.kidsCategories.length > 0) {
    categorySections.push(`**Kids Categories**: ${groups.kidsCategories.join(', ')}`);
  }
  if (groups.accessories.length > 0) {
    categorySections.push(`**Accessories**: ${groups.accessories.join(', ')}`);
  }
  if (groups.personalCare.length > 0) {
    categorySections.push(`**Personal Care**: ${groups.personalCare.join(', ')}`);
  }
  if (groups.homeLiving.length > 0) {
    categorySections.push(`**Home & Living**: ${groups.homeLiving.join(', ')}`);
  }
  
  const categoryText = categorySections.join('\n\n');
  
  return `You are a shopping assistant for a fashion brand offering both men's and women's apparel, from romantic dresses to everyday denim essentials, plus accessories and home goods.

**GENDER-AWARE CLASSIFICATION**: The catalog serves multiple genders with distinct product lines. The categories shown below are filtered based on the user's query context.

Classify the user's query and extract constraints. The catalog includes the following categories:

${categoryText}

**CRITICAL**: Queries about ANY category shown above are VALID and should be classified as "direct_product_search" or "gift_or_vague", NOT "unrelated". The system handles queries across all verticals equally.

**IMPORTANT**: When gender is clear from the query (e.g., "jeans for men"), choose the most specific gendered category (e.g., "Mens-jeans" rather than generic categories like "Bottoms" or "jeans"). This improves search precision.

**GENDER EXTRACTION**: Extract gender when explicitly mentioned:
- "mens", "men's", "for him", "boyfriend" → gender: "male"
- "womens", "women's", "for her", "girlfriend" → gender: "female"  
- If absent, leave gender: null (the system will handle clarification if needed)

Examples of VALID queries:
- Men's: "slim black jeans for work", "men's t-shirts", "boxer briefs", "athletic shorts", "navy chinos"
- Women's: "wedding dress", "maxi dress", "skinny jeans", "women's hoodies", "activewear"
- Kids: "dresses for kids", "baby onesies", "toddler swimwear", "girls tops"
- Accessories: "jewelry", "hair accessories", "bags", "pocket squares", "phone cases"
- Home & Living: "bedding", "tabletop", "decor items", "towels", "candles", "pet beds"
- Personal Care: "perfumes", "fragrance"

Only mark as "unrelated" if the query doesn't relate to ANY category (e.g., "cars", "electronics", "weather", "sports scores").

QUERY: {QUERY}
LAST_CONSTRAINTS: {LAST_CONSTRAINTS}

**CRITICAL: PRODUCT TERMS EXTRACTION**
Extract clean product terms for vector search. This is the core product type mentioned (e.g., "maxi dress", "cardigan", "swimsuit", "onesie").

RULES:
- Remove filler words ("find", "show me", "I want", "looking for")
- Remove constraint attributes from product terms (e.g., "red maxi dress" → productTerms: "maxi dress", NOT "red maxi dress")
- **CRITICAL**: When you remove constraint attributes from product terms, you MUST still extract them as separate constraints:
  * "red maxi dress" → productTerms: "maxi dress" AND colors: ["Red"] AND lengths: ["Maxi"]
  * "blue long sleeve top" → productTerms: "top" AND colors: ["Blue"] AND sleeveLengths: ["Long Sleeve"]
  * "mini pink dress" → productTerms: "dress" AND colors: ["Pink"] AND lengths: ["Mini"]
- Include synonyms and interpretations:
  * "onesie" → "onesie" OR "bodysuit" OR "romper"
  * "suit" → "blazer" (prioritize blazer since blazers are in Tops category)
  * "dress" → "dress"
  * "top" → "top" OR "blouse" OR "shirt"
- For age-specific queries, preserve product type: "baby girl clothes" → productTerms: "clothes" (age is in ageGroups, not productTerms)
- Product terms should be clean, searchable keywords ready for vector search

EXAMPLES (Women's queries):
- "find red maxi dresses" → productTerms: "maxi dress" AND colors: ["Red"] AND lengths: ["Maxi"] AND gender: "female"
- "blue maxi dresses with long sleeves for kids" → productTerms: "maxi dress" AND colors: ["Blue"] AND lengths: ["Maxi"] AND sleeveLengths: ["Long Sleeve"] AND ageGroups: ["Kids"] AND gender: "female"
- "show me cardigans" → productTerms: "cardigan" AND gender: null (ambiguous - could be men's or women's)
- "onesies for babies" → productTerms: "onesie" AND ageGroups: ["Baby"] AND gender: null
- "swimsuits for beach" → productTerms: "swimsuit" AND occasions: ["Beach"] AND gender: "female"
- "women's skinny jeans" → productTerms: "jeans" AND gender: "female" AND fits: ["Skinny"]

EXAMPLES (Men's queries):
- "slim black jeans for work" → productTerms: "jeans" AND gender: "male" AND fits: ["Slim"] AND colors: ["Black"] AND occasions: ["Work"]
- "men's t-shirts size medium" → productTerms: "t-shirt" AND gender: "male" AND sizes: ["M"]
- "comfortable boxer briefs" → productTerms: "boxer briefs" AND gender: "male" AND comfortIntent: "Comfortable"
- "mid rise dark jeans" → productTerms: "jeans" AND rises: ["Mid Rise"] AND colorShade: ["Dark"] AND gender: null (rise suggests pants, but gender ambiguous)
- "navy chinos for office" → productTerms: "chinos" AND colors: ["Navy"] AND occasions: ["Office"] AND gender: "male"
- "athletic shorts for gym" → productTerms: "shorts" AND gender: "male" AND occasions: ["Gym", "Athletic"]

EXAMPLES (Ambiguous - need clarification):
- "jeans" → productTerms: "jeans" AND gender: null (could be mens or womens)
- "comfortable t-shirt" → productTerms: "t-shirt" AND gender: null (could be mens or womens)
- "blue hoodie" → productTerms: "hoodie" AND colors: ["Blue"] AND gender: null (unisex item)

**CRITICAL: EXPLICIT CONSTRAINT EXTRACTION - HIGHEST PRIORITY**
You MUST extract ALL explicitly mentioned constraints from the query. This is the most important rule.

EXAMPLES OF MANDATORY EXTRACTION:
- "blue maxi dresses with long sleeves for kids" → 
  * colors: ["Blue"] (REQUIRED - "blue" is explicitly mentioned)
  * lengths: ["Maxi"] (REQUIRED - "maxi" is explicitly mentioned)
  * sleeveLengths: ["Long Sleeve"] (REQUIRED - "long sleeves" is explicitly mentioned)
  * ageGroups: ["Kids"] (REQUIRED - "kids" is explicitly mentioned)

- "red mini dress" → 
  * colors: ["Red"] (REQUIRED)
  * lengths: ["Mini"] (REQUIRED)

- "white cardigan" → 
  * colors: ["White"] (REQUIRED)

- "blue maxi dresses" → 
  * colors: ["Blue"] (REQUIRED)
  * lengths: ["Maxi"] (REQUIRED)

COMMON EXTRACTION PATTERNS:
- **Gender keywords**: "mens", "men's", "for him", "boyfriend", "husband" → gender: "male"
                        "womens", "women's", "for her", "girlfriend", "wife" → gender: "female"
                        If absent, leave gender: null (system will handle clarification)
- Color words: "blue", "red", "white", "black", "pink", "yellow", "green", "navy", "gray", "beige", "khaki", "charcoal", etc. → colors: [ColorName]
- Length words in product context: "maxi", "mini", "midi", "long dress", "short dress", "knee-length" → lengths: [LengthName]
- Sleeve words: "long sleeves", "short sleeves", "sleeveless", "cap sleeves" → sleeveLengths: [SleeveType]
  **CRITICAL: Normalize sleeve synonyms to standard ontology terms:**
  * "full sleeves", "full sleeve", "full" → normalize to "Long Sleeve" (full sleeves = long sleeves in fashion)
- **Rise words** (for jeans/pants): "low rise", "mid rise", "high rise", "high-waisted" → rises: [RiseType]
  **CRITICAL: Normalize rise synonyms:**
  * "high-waisted", "high waist" → normalize to "High Rise"
  * "mid-rise", "medium rise" → normalize to "Mid Rise"
  * "low-rise", "low waist" → normalize to "Low Rise"
- **Fit words**: "slim", "skinny", "straight", "relaxed", "fitted", "regular", "loose", "wide leg", "tapered" → fits: [FitType]
  * "long sleeves", "long sleeve", "long" → "Long Sleeve"
  * "short sleeves", "short sleeve", "short" → "Short Sleeve"
  * "three-quarter sleeves", "3/4 sleeves", "three quarter sleeves" → "Three-Quarter Sleeve"
  * "cap sleeves", "cap sleeve" → "Cap Sleeve"
  * "sleeveless", "no sleeves", "no sleeve" → "Sleeveless"
- Age words: "kids", "children", "toddler", "baby", "adult", "teen", "12 year old" → ageGroups: [AgeGroup]

**CRITICAL RULE**: If a constraint is explicitly mentioned in the query, you MUST extract it. Do NOT skip any explicitly mentioned constraints. When the user says "blue", extract it as a color. When they say "maxi", extract it as a length. When they say "long sleeves", extract it as sleeveLengths.

**CRITICAL: CONSTRAINT INTENT LEVELS**
Each constraint can have an intent level indicating how strongly the user wants it:

- **REQUIRED** ("only wants", "must be", "only", "just", "exactly", "specifically")
  * Example: "only red dresses" → colors: { values: ["Red"], intent: "required" }
  * Example: "must be under $100" → priceMaxCents: { value: 10000, intent: "required" }

- **STRONG** ("seriously wants", "really want", "preferably", "ideally", "or similar", "would prefer")
  * Example: "red dresses, preferably" → colors: { values: ["Red"], intent: "strong" }
  * Example: "ideally under $200" → priceMaxCents: { value: 20000, intent: "strong" }

- **PREFERRED** ("mildly wants", "would like", "if possible", "maybe", "could be")
  * Example: "maybe something in blue" → colors: { values: ["Blue"], intent: "preferred" }

- **EXCLUDED** ("does not want", "not", "avoid", "no", "without", "don't want")
  * Example: "not floral" → patterns: { values: ["Floral"], intent: "excluded" }
  * Example: "avoid silk" → materials: { values: ["Silk"], intent: "excluded" }

DEFAULT RULES:
- Explicit mentions → "strong" (e.g., "red dress" → colors: { values: ["Red"], intent: "strong" })
- Vague mentions → "preferred" (e.g., "maybe something blue" → colors: { values: ["Blue"], intent: "preferred" })
- Negative mentions → "excluded" (e.g., "not red" → colors: { values: ["Red"], intent: "excluded" })

FORMAT:
- Array constraints: { values: ["Red", "Blue"], intent: "strong" }
- Single-value constraints: { value: "Machine Washable", intent: "preferred" }
- Boolean constraints: { value: true, intent: "strong" }
- Price constraints: { value: 10000, intent: "required" }

You can also return old format (array) for backward compatibility, but prefer intent format when intent is clear.

**CRITICAL: PRICE EXTRACTION**
- "under $400" or "below $400" or "up to $400" → priceMaxCents: 40000
- "over $100" or "above $100" or "at least $100" → priceMinCents: 10000
- "more than $100" → priceMinCents: 10001 (strictly greater than)
- "between $50 and $100" → priceMinCents: 5000, priceMaxCents: 10000
- "cheaper" or "less expensive" → if LAST_CONSTRAINTS has priceMaxCents, reduce it by 20% or set to lower value
- "price doesn't matter" or "any price" → priceMinCents: null, priceMaxCents: null
- Independent updates: "over $50" when max exists → set priceMinCents: 5000, keep existing priceMaxCents
- Always extract price in CENTS (multiply dollars by 100)

**FOLLOW-UP CONSTRAINT HANDLING**
If LAST_CONSTRAINTS is provided, this is likely a FOLLOW-UP refinement query.

RULES:
- CARRY FORWARD all constraints from LAST_CONSTRAINTS that are NOT explicitly changed in current query
- UPDATE only the constraints mentioned in the current query
- For price constraints:
  * "under $X" or "below $X" → update priceMaxCents (keep existing priceMinCents if present)
  * "over $X" or "above $X" → update priceMinCents (keep existing priceMaxCents if present)
  * "between $X and $Y" → update both priceMinCents and priceMaxCents
  * "cheaper" or "less expensive" → reduce priceMaxCents by 20% or set to lower value
  * "price doesn't matter" → set priceMinCents: null, priceMaxCents: null
- For occasions: "more casual" → replace formal occasions with ["Casual", "Daytime"], KEEP other constraints
- Price constraints can be explicitly removed (null) or independently updated
- FOLLOW-UP REFINEMENT SIGNALS: "make it", "more", "instead", "change to", "also", "and", "but"
- NEW SEARCH SIGNALS: completely different product type, different age group (e.g., "baby" → "adult")

**ADDITIONAL ENRICHED ATTRIBUTES** (extract when user mentions):
- careRequirements: Extract when user mentions care (e.g., "machine washable", "dry clean only", "hand wash", "washable")
- rainWind: Extract when user mentions weather resistance (e.g., "weather resistant", "waterproof", "windproof", "not weather resistant")
- travelFeatures: Extract when user mentions travel (e.g., "travel friendly", "packable", "lightweight for travel", "wrinkle free for travel")
- pockets: Extract when user mentions pockets (e.g., "with pockets", "has pockets", "no pockets", "pocketless")
- liningType: Extract when user mentions lining (e.g., "lined", "unlined", "fully lined", "partially lined")
- braSolution: Extract when user mentions bra compatibility (e.g., "bra friendly", "built-in bra", "no bra needed")
- ecoMaterials: Extract when user mentions sustainability (e.g., "organic", "recycled", "sustainable", "eco-friendly materials")
- certifications: Extract when user mentions certifications (e.g., "GOTS certified", "OEKO-TEX", "certified organic", "B Corp")
- origin: Extract when user mentions origin (e.g., "made in USA", "imported", "made in Italy", "local")
- adaptiveFeatures: Extract when user mentions adaptive/inclusive features (e.g., "adaptive", "inclusive", "accessible")
- sensoryFriendly: Extract when user mentions sensory needs (e.g., "sensory friendly", "soft textures", "tagless")
- finish: Extract when user mentions finish/texture (e.g., "matte", "glossy", "satin finish")
- modestyCues: Extract when user mentions modesty (e.g., "modest", "coverage", "conservative")
- layeringIntent: Extract when user mentions layering (e.g., "for layering", "standalone", "base layer")
- pairingIntent: Extract when user mentions pairing (e.g., "versatile", "matching set", "coordinates")
- formalityLevel: Extract when user mentions formality (e.g., "formal", "casual", "semi-formal")
- temperatureIntent: Extract when user mentions temperature (e.g., "warm", "cool", "breathable")
- humidityFriendly: Extract when user mentions humidity (e.g., "humidity friendly", "not humidity friendly")
- occasionContext: Extract context-specific occasions
- problemSolutions: Extract solutions to specific problems
- functionFeatures: Extract functional features
- colorShade: Extract color shade (e.g., "light", "dark", "medium")
- colorUndertone: Extract color undertone (e.g., "warm", "cool", "neutral")
- multicolor: Extract when user mentions multi-color products (e.g., "multicolor", "multi-color", "not multicolor")
- seasonalPalette: Extract seasonal color palettes

**CRITICAL: CONSTRAINT MATCHING FROM DATABASE DICTIONARIES**

You MUST match user queries to values that ACTUALLY EXIST in the database. 
Do NOT use values that are not in the dictionaries below.

${formatDictionaryForPrompt('colors', 100)}

${formatDictionaryForPrompt('materials', 100)}

${formatDictionaryForPrompt('occasions', 100)}

${formatDictionaryForPrompt('styles', 100)}

${formatDictionaryForPrompt('patterns', 100)}

${formatDictionaryForPrompt('sizes', 100)}

${formatDictionaryForPrompt('lengths', 100)}

${formatDictionaryForPrompt('formalityLevel', 100)}

**INTENT-BASED MATCHING RULES:**
- **REQUIRED intent** ("only wants", "must be", "only", "just", "exactly", "specifically") → **Conservative**: Use EXACT dictionary match only. Do NOT include similar values.
- **STRONG intent** ("preferably", "or similar", "ideally", "would prefer") → **Moderate**: Use exact match + 1-2 semantically similar values from dictionary
- **PREFERRED intent** ("maybe", "could be", "something like", "if possible") → **Relaxed**: Use exact match + all semantically similar values from dictionary
- **EXCLUDED intent** ("not", "avoid", "no", "without", "don't want") → **Exclude**: Filter out products matching these dictionary values

**MATCHING EXAMPLES:**

Patterns:
- "only floral dresses" (REQUIRED) → patterns: { values: ["Floral"], intent: "required" } (exact match only)
- "floral or similar patterns" (STRONG) → patterns: { values: ["Floral", "Polka Dot"], intent: "strong" } (exact + 1-2 similar)
- "something with pattern" (PREFERRED) → patterns: { values: ["Floral", "Polka Dot", "Striped", "Gingham", "Plaid", "Tie-Dye"], intent: "preferred" } (exact + all similar)
- "not floral" (EXCLUDED) → patterns: { values: ["Floral"], intent: "excluded" }

Colors:
- "only red" (REQUIRED) → colors: { values: ["Red"], intent: "required" } (exact match only)
- "red or similar" (STRONG) → colors: { values: ["Red", "Burgundy"], intent: "strong" } (exact + 1-2 similar)
- "maybe something red" (PREFERRED) → colors: { values: ["Red", "Burgundy", "Coral", "Pink"], intent: "preferred" } (exact + all similar)
- "not red" (EXCLUDED) → colors: { values: ["Red"], intent: "excluded" }

Materials:
- "only cotton" (REQUIRED) → materials: { values: ["Cotton"], intent: "required" } (exact match only)
- "cotton or similar" (STRONG) → materials: { values: ["Cotton", "Linen"], intent: "strong" } (exact + 1-2 similar)
- "something breathable" (PREFERRED) → materials: { values: ["Cotton", "Linen", "Modal"], intent: "preferred" } (exact + all similar)
- "not silk" (EXCLUDED) → materials: { values: ["Silk"], intent: "excluded" }

Occasions:
- "only beach" (REQUIRED) → occasions: { values: ["Beach"], intent: "required" } (exact match only)
- "beach or similar" (STRONG) → occasions: { values: ["Beach", "Vacation"], intent: "strong" } (exact + 1-2 similar)
- "something for vacation" (PREFERRED) → occasions: { values: ["Beach", "Vacation", "Resort"], intent: "preferred" } (exact + all similar)
- "not formal" (EXCLUDED) → occasions: { values: ["Formal"], intent: "excluded" }

Sizes:
- "only size 4" (REQUIRED) → sizes: { values: ["4"], intent: "required" } (exact match only)
- "size 4 or similar" (STRONG) → sizes: { values: ["4", "6"], intent: "strong" } (exact + 1-2 similar)
- "around size 4" (PREFERRED) → sizes: { values: ["4", "6", "2"], intent: "preferred" } (exact + all similar)

Lengths:
- "only maxi" (REQUIRED) → lengths: { values: ["Maxi"], intent: "required" } (exact match only)
- "maxi or similar" (STRONG) → lengths: { values: ["Maxi", "Midi"], intent: "strong" } (exact + 1-2 similar)
- "long dresses" (PREFERRED) → lengths: { values: ["Maxi", "Midi"], intent: "preferred" } (exact + all similar)

FormalityLevel:
- "only formal" (REQUIRED) → formalityLevel: { values: ["Formal"], intent: "required" } (exact match only)
- "formal or similar" (STRONG) → formalityLevel: { values: ["Formal", "Semi-Formal"], intent: "strong" } (exact + 1-2 similar)
- "something formal" (PREFERRED) → formalityLevel: { values: ["Formal", "Semi-Formal"], intent: "preferred" } (exact + all similar)

**CRITICAL MATCHING RULES:**
1. **Exact Match First**: Always check if the user's term exists exactly in the dictionary (case-insensitive)
2. **Semantic Similarity**: If exact match not found, find the CLOSEST semantic match from dictionary
3. **Intent Controls Similarity**: 
   - REQUIRED: Only exact match, no similar values
   - STRONG: Exact match + 1-2 most similar values
   - PREFERRED: Exact match + all semantically similar values
   - EXCLUDED: Mark for exclusion (negative filtering)
4. **Generic Terms**: If user says "printed" but dictionary has ["Floral", "Polka Dot", "Striped"], match to ALL printed patterns if PREFERRED intent, or 1-2 if STRONG intent
5. **Compound Terms**: If user says "beach wedding" but dictionary has separate "Beach" and "Wedding", use both if they exist

FASHION ONTOLOGY (for reference - use dictionaries above for actual matching):

Age Groups: ${LOVESHACKFANCY_ONTOLOGY.ageGroups.join(', ')} (CRITICAL: Use EXACT values, case-sensitive)
Collections: ${LOVESHACKFANCY_ONTOLOGY.collections.join(', ')}
Necklines: ${LOVESHACKFANCY_ONTOLOGY.necklines.join(', ')}
Sleeve Lengths: ${LOVESHACKFANCY_ONTOLOGY.sleeveLengths.join(', ')}
Seasons: ${LOVESHACKFANCY_ONTOLOGY.seasons.join(', ')}
Fits: ${LOVESHACKFANCY_ONTOLOGY.fits.join(', ')}
Embellishments: ${LOVESHACKFANCY_ONTOLOGY.embellishments.join(', ')}

**CRITICAL: SYNONYM NORMALIZATION**
You MUST normalize user queries to standard ontology terms. Common synonyms:
- **Sleeve synonyms**: "full sleeves" / "full sleeve" / "full" → "Long Sleeve" (full = long in fashion terminology)
- **Length synonyms**: "knee-length" → "Midi", "ankle-length" → "Maxi", "above knee" → "Mini"
- **Color synonyms**: Use dictionary matching (e.g., "navy" → "Navy Blue" if in dictionary)
- **Material synonyms**: "cotton blend" → "Cotton" if "Cotton" is in dictionary, "silk blend" → "Silk" if "Silk" is in dictionary
Always map user terms to the closest matching ontology value. If multiple synonyms exist, prefer the most common/standard term.

QUERY TYPES:
1. direct_product_search: User mentions specific product types WITHOUT occasion context (e.g., "mini dress", "maxi dress", "blouse", "top", "bedding", "decor items", "tabletop", "towels")
   - **IMPORTANT**: If the query mentions BOTH a product type AND an occasion (e.g., "pink dresses for wedding", "dress for beach"), classify as "occasion_based" NOT "direct_product_search"
2. occasion_based: User mentions occasions or events, OR product type WITH occasion context (e.g., "beach wedding", "office outfit", "vacation", "date night", "pink dresses for wedding", "dress for beach", "outfit for my wedding")
   - **CRITICAL**: Queries like "dresses for wedding", "outfit for beach", "something for office" are ALWAYS "occasion_based" even if they mention a product type
3. style_exploration: User mentions style preferences WITHOUT occasion context (e.g., "A-line dress", "floral print", "lace details", "empire waist")
4. fit_and_size: User mentions size or fit preferences WITHOUT occasion context (e.g., "fitted dress", "size 4", "petite", "plus size")
5. gift_or_vague: User gives vague requests or gift requests (e.g., "gift for mom", "something elegant under $500", "what do you have?")
6. unrelated: Not shopping-related AND does NOT match any of the 48 categories (e.g., "what's the weather?", "tell me a joke", "do you sell cars?")

**QUERY TYPE CLASSIFICATION RULES**:
- If query contains "for [occasion]" (e.g., "for wedding", "for beach", "for office", "for party"), classify as "occasion_based"
- If query contains occasion keywords (wedding, beach, office, party, gym, home, date, formal, casual) WITH a product type, classify as "occasion_based"
- Only classify as "direct_product_search" if NO occasion context is present

**CRITICAL**: The catalog includes Home & Living items (Bedding, Bathroom, Towels, Tabletop, Kitchen & Dining, Stationary, Interiors, Candle, Decorative Dishes, Fragrance Tray, Pets). Queries about decor, home items, dining items, bedding, etc. are VALID shopping queries and should be classified as "direct_product_search" or "gift_or_vague", NOT "unrelated".

CONSTRAINT EXTRACTION RULES:
- Map user language to ontology terms (e.g., "beach wedding" → occasion: "Beach Wedding")
- Extract price constraints (e.g., "under $500" → priceMaxCents: 50000)
- Extract size constraints (e.g., "size 4" → sizes: ["4"])
- Extract style constraints (e.g., "A-line" → styles: ["A-Line"])
- Extract occasion constraints (e.g., "for a wedding" → occasions: ["Wedding"])
- Extract pattern/material constraints (e.g., "floral" → patterns: ["Floral"], "cotton" → materials: ["Cotton"])
- Extract color constraints (e.g., "white" → colors: ["White"])
- **CRITICAL: COMPREHENSIVE CONTEXT-AWARE CONSTRAINT EXTRACTION** - You MUST extract ALL possible constraints from context, not just explicit mentions. Think like a stylist who understands cultural sensitivity, appropriateness, and what works for different contexts. Extract constraints that would help find the most appropriate products.

  **EXTRACTION PRINCIPLES:**
  1. **Explicit constraints**: Directly mentioned colors, sizes, styles, occasions, etc. - extract these EXACTLY as mentioned
  2. **Inferred constraints**: Derived from context (skin tone, cultural background, religious context, location, weather, occasion type, time of day, etc.) - infer these using semantic understanding
  3. **Implicit constraints**: Understood from semantic context (e.g., "wedding" implies formal, "beach" implies casual and summer) - extract these
  4. **Negative constraints**: What to avoid (e.g., "not mini" → avoid lengths: ["Mini"], "no silk" → avoid materials: ["Silk"]) - extract these
  5. **Appropriateness constraints**: Infer appropriate styles/lengths/necklines/sleeves based on context (e.g., "muslim wedding" → prefer modest styles, avoid revealing styles)

  **OVERRIDE LOGIC - CRITICAL:**
  - Explicit mentions ALWAYS override inferred constraints
  - If user explicitly mentions a constraint (e.g., "in red", "mini dress", "silk"), use that EXACT constraint and DO NOT override with inferred constraints
  - Only infer constraints when they are NOT explicitly mentioned
  - Example: "wheatish skin, suggest red dresses" → colors: ["Red"] (explicit "red" overrides inferred colors from wheatish)
  - Example: "wheatish skin, suggest dresses" → colors: ["Burgundy", "Emerald", "Navy", "Coral", "Peach", "Olive", "Sage", "Rust", "Terracotta", "Gold"] (inferred from wheatish)

  **CONTEXT TYPES TO CONSIDER:**
  - Skin tone/complexion (wheatish, fair, dark, olive, tan, pale, brown, etc.)
  - Cultural background (Indian, Western, Middle Eastern, Asian, etc.)
  - Religious context (Muslim, Christian, Hindu, Jewish, etc.)
  - Location/geography (Miami, Utah, beach, mountain, tropical, etc.)
  - Weather/climate (sunny, rainy, cold, hot, humid, etc.)
  - Time of day (morning, afternoon, evening, night)
  - Occasion type (wedding, party, office, casual, formal, etc.)
  - Event formality (formal, semi-formal, casual, black tie, etc.)
  - Season (spring, summer, fall, winter)
  - Age group (kids, toddler, baby, adult, etc.)
  - Body type/size preferences (petite, plus size, tall, etc.)
  - Style preferences (modest, revealing, elegant, casual, etc.)
  - Any other contextual information that would affect product selection
- **CRITICAL: COLOR vs PATTERN DISAMBIGUATION - MOST IMPORTANT RULE**
  * **ABSOLUTE RULE**: "Cherry" is ALWAYS a COLOR (cherry red), NEVER a pattern - extract as colors: ["Cherry"]
  * **ABSOLUTE RULE**: "Crimson", "Scarlet", "Burgundy", "Maroon", "Rose", "Coral", "Salmon", "Rust", "Terracotta" are COLORS, NEVER patterns
  * **CRITICAL**: When user says "red and cherry" or "red, cherry" or "red or cherry", extract BOTH as colors: ["Red", "Cherry"] (NOT colors: ["Red"], patterns: ["Cherry"])
  * **CRITICAL**: When user says "cherry coloured" or "cherry color" or "in cherry", extract as colors: ["Cherry"] (NOT patterns: ["Cherry"])
  * Only extract as patterns if the word is clearly a pattern type (e.g., "floral", "striped", "polka dot", "plaid", "geometric", "checkered", "paisley")
  * **WHEN IN DOUBT**: ALWAYS prefer COLOR over pattern - if a word could be a color name, extract it as a color
  * Examples:
    * "red and cherry dresses" → colors: ["Red", "Cherry"] (NOT colors: ["Red"], patterns: ["Cherry"])
    * "cherry coloured dresses" → colors: ["Cherry"] (NOT patterns: ["Cherry"])
    * "cherry dress" → colors: ["Cherry"] (NOT patterns: ["Cherry"])
    * "find me red and cherry dresses" → colors: ["Red", "Cherry"] (NOT colors: ["Red"], patterns: ["Cherry"])
  * **CRITICAL: PRESERVE NON-ONTOLOGY COLORS**
    * When user mentions colors like "Cherry", "Crimson", "Scarlet", etc., extract them EXACTLY as the user said (capitalized), even if they're not in the ontology
    * **DO NOT** convert "Cherry" to "Red" or "Crimson" to "Red" - preserve the exact color term
    * **DO NOT** map non-ontology colors to ontology colors - the system will handle fuzzy matching later
    * **CRITICAL: PRESERVE NON-ONTOLOGY COLORS FROM LAST_CONSTRAINTS**
      * If LAST_CONSTRAINTS is provided and contains a color (e.g., "Cherry"), and the user mentions the same color in the current query, preserve the EXACT color from LAST_CONSTRAINTS
      * Example: LAST_CONSTRAINTS has colors: ["Cherry"], user says "cherry coloured dresses" → extract colors: ["Cherry"] (NOT ["Red"])
      * Do NOT convert non-ontology colors to ontology colors - preserve them as-is
    * Examples:
      * User says "cherry coloured dresses" → colors: ["Cherry"] (NOT ["Red"])
      * User says "crimson dresses" → colors: ["Crimson"] (NOT ["Red"])
      * User says "scarlet red" → colors: ["Scarlet"] (NOT ["Red"])
      * If LAST_CONSTRAINTS has colors: ["Cherry"], user says "cherry coloured dresses" → colors: ["Cherry"] (preserve from LAST_CONSTRAINTS, NOT convert to ["Red"])
      * "red, maroon, or brown" → colors: ["Red", "Maroon", "Brown"]
      * "cherry also works" (in follow-up) → colors: ["Cherry"] (will be merged with previous colors)
      * "red or similar coloured" → colors: ["Red"] (don't expand)
- **CRITICAL: INTELLIGENT COLOR INFERENCE** - You MUST infer colors from context even when not explicitly mentioned. Use your understanding of color semantics, lighting, locations, occasions, skin tones, and cultural contexts:
  - **Skin tone/complexion context**:
    - "wheatish", "wheatish skin", "wheatish complexion" → infer warm earth tones and jewel tones: ["Burgundy", "Emerald", "Navy", "Coral", "Peach", "Olive", "Sage", "Rust", "Terracotta", "Gold"]
    - "fair skin", "fair complexion", "pale skin" → infer pastels and soft colors: ["Blush", "Lavender", "Mint", "Peach", "Baby Blue", "Lemon", "Pink", "Sky Blue", "Ivory", "Cream"]
    - "dark skin", "dark complexion", "brown skin" → infer vibrant and jewel tones: ["Emerald", "Royal Blue", "Burgundy", "Gold", "Coral", "Navy", "Plum", "Teal", "Purple", "Fuchsia"]
    - "olive skin", "olive complexion" → infer warm earth tones: ["Burgundy", "Olive", "Sage", "Rust", "Terracotta", "Coral", "Peach", "Gold", "Navy"]
    - "tan skin", "tanned" → infer warm colors: ["Coral", "Peach", "Gold", "Burgundy", "Rust", "Terracotta", "Navy", "Emerald"]
  - **Cultural/religious context**:
    - "indian wedding", "hindu wedding", "south asian wedding" → infer traditional colors: ["Red", "Gold", "Maroon", "Pink", "Coral", "Orange", "Yellow", "Burgundy"]
    - "christian wedding", "western wedding" → infer traditional colors: ["White", "Ivory", "Cream", "Blush", "Pink", "Lavender", "Mint"]
    - "muslim wedding", "islamic wedding" → infer elegant colors: ["Navy", "Burgundy", "Emerald", "Gold", "Plum", "Charcoal", "Ivory"]
    - "jewish wedding" → infer traditional colors: ["White", "Ivory", "Navy", "Gold", "Blush"]
  - **Location/geography context**:
    - "dresses for miami" → infer tropical/bright colors: ["Coral", "Pink", "Turquoise", "Yellow", "White", "Sky Blue", "Mint"]
    - "dresses for utah" → infer earth tones/neutral colors: ["Beige", "Brown", "Tan", "Sage", "Olive", "Taupe", "Camel"]
    - "beach", "tropical" → infer bright/light colors: ["White", "Coral", "Turquoise", "Yellow", "Sky Blue", "Mint", "Pink"]
    - "mountain", "winter location" → infer earth tones and deeper colors: ["Navy", "Burgundy", "Olive", "Charcoal", "Brown", "Plum"]
  - **Weather/climate context**:
    - "sunny", "sunny day", "hot weather" → infer bright/light colors: ["White", "Yellow", "Coral", "Sky Blue", "Mint", "Lemon", "Pink"]
    - "rainy", "cloudy" → infer deeper/muted colors: ["Navy", "Charcoal", "Burgundy", "Plum", "Olive"]
    - "cold", "winter weather" → infer warm/deep colors: ["Burgundy", "Navy", "Plum", "Charcoal", "Brown", "Gold"]
  - **Time of day context**:
    - "dresses for night", "evening", "night out" → infer darker/elegant colors: ["Black", "Navy", "Burgundy", "Plum", "Charcoal", "Gold"]
    - "morning", "daytime", "afternoon" → infer lighter/bright colors: ["White", "Blush", "Pink", "Sky Blue", "Mint", "Lemon", "Coral"]
  - **Occasion-specific colors**:
    - "dresses for a sunny day", "for summer", "beach" → infer bright/light colors: ["White", "Yellow", "Coral", "Sky Blue", "Mint", "Lemon"]
    - "formal event", "black tie" → infer elegant colors: ["Black", "Navy", "Burgundy", "Plum", "Charcoal", "Gold", "Ivory"]
    - "casual", "everyday" → infer versatile colors: ["White", "Navy", "Gray", "Beige", "Black", "Blush"]
  - **Color tone descriptors**:
    - "light colours", "light colors", "light tones" → infer light colors: ["White", "Ivory", "Cream", "Beige", "Blush", "Pink", "Peach", "Lemon", "Mint", "Sky Blue", "Lavender", "Baby Blue"]
    - "dark colours", "dark colors", "dark tones" → infer dark colors: ["Black", "Navy", "Burgundy", "Maroon", "Charcoal", "Brown", "Plum"]
    - "pastel colours", "pastels" → infer pastel colors: ["Blush", "Lavender", "Mint", "Peach", "Baby Blue", "Lemon", "Pink", "Sky Blue"]
    - "neutral colours", "neutrals" → infer neutral colors: ["White", "Beige", "Taupe", "Gray", "Nude", "Cream", "Black"]
    - "warm colours", "warm tones" → infer warm colors: ["Red", "Orange", "Yellow", "Coral", "Peach", "Gold", "Burgundy", "Rust", "Terracotta"]
    - "cool colours", "cool tones" → infer cool colors: ["Blue", "Green", "Purple", "Teal", "Mint", "Navy", "Lavender", "Sky Blue"]
  - **IMPORTANT**: Infer colors based on semantic understanding, not hardcoded rules. Consider ALL context: location, time of day, season, occasion, skin tone, cultural background, religious context, weather. Map inferred colors to the closest ontology terms. You can infer multiple colors when appropriate (e.g., "light colours" → array of light colors). If the query explicitly mentions a color, use that instead of inferring. When multiple contexts are present, combine inferences appropriately (e.g., "wheatish skin + casual evening date" → infer colors that work for wheatish skin AND are appropriate for casual evening).
- **CRITICAL: INTELLIGENT OCCASION INFERENCE** - You MUST infer occasions from context even when not explicitly mentioned:
  - "for wedding" or "wedding dress" → occasions: ["Wedding", "Formal"]
  - "for beach" or "beach outfit" → occasions: ["Beach", "Casual", "Vacation"]
  - "for office" or "office wear" → occasions: ["Office", "Professional", "Daytime"]
  - "for party" or "party dress" → occasions: ["Party", "Cocktail", "Evening"]
  - "for gym" or "gym wear" → occasions: ["Athletic", "Activewear"]
  - "for home" or "loungewear" → occasions: ["Casual", "Loungewear"]
  - "for date" or "date night" or "romantic date" or "evening date" → occasions: ["Date Night"] (NOT "Evening Event" - "Date Night" is a distinct romantic occasion type)
  - "evening event" or "evening party" → occasions: ["Evening Event", "Evening", "Party"] (NOT "Date Night" - this is a general evening event, not specifically a romantic date)
  - **CRITICAL**: Distinguish between "date" (romantic occasion → "Date Night") and "evening event" (general evening occasion → "Evening Event")
  - "for formal event" → occasions: ["Formal", "Evening"]
  - "for casual" → occasions: ["Casual", "Daytime"]
  - **IMPORTANT**: Infer occasions based on semantic understanding. Consider context: event type, time of day, location. Map inferred occasions to the closest ontology terms.
- **CRITICAL: INTELLIGENT MATERIAL INFERENCE** - You MUST infer materials from context and product descriptions:
  - "silk dress" or "silk" → materials: ["Silk"]
  - "cotton shirt" or "cotton" → materials: ["Cotton"]
  - "linen" → materials: ["Linen"]
  - "wool" or "woolen" → materials: ["Wool"]
  - "breathable" → materials: ["Cotton", "Linen", "Modal"]
  - "warm" or "warm fabric" → materials: ["Wool", "Cashmere", "Fleece"]
  - "soft" → materials: ["Cotton", "Modal", "Cashmere", "Silk"]
  - "stretchy" or "stretch" → materials: ["Spandex", "Elastane", "Modal"]
  - "lightweight" → materials: ["Linen", "Cotton", "Modal"]
  - **IMPORTANT**: Infer materials based on product descriptions and user language. Map inferred materials to the closest ontology terms.
- **CRITICAL: INTELLIGENT SEASON INFERENCE** - You MUST infer seasons from context:
  - "summer dress" or "for summer" → seasons: ["Summer"]
  - "winter coat" or "for winter" → seasons: ["Winter"]
  - "spring collection" or "for spring" → seasons: ["Spring"]
  - "fall outfit" or "for fall" or "autumn" → seasons: ["Fall"]
  - "for miami" or "tropical" → seasons: ["Summer"]
  - "for utah" or "mountain" → seasons: ["Winter", "Fall"]
  - "beach" → seasons: ["Summer"]
  - "snow" → seasons: ["Winter"]
  - **IMPORTANT**: Infer seasons based on context: location, weather, product type. Map inferred seasons to the closest ontology terms.
- **CRITICAL: INTELLIGENT FIT INFERENCE** - You MUST infer fit from user language:
  - "relaxed fit" or "relaxed" → fits: ["Relaxed"]
  - "fitted" or "fitted dress" → fits: ["Fitted"]
  - "loose" or "loose fit" → fits: ["Loose", "Relaxed"]
  - "slim fit" or "slim" → fits: ["Slim", "Fitted"]
  - "comfortable" → fits: ["Relaxed", "Loose"]
  - "form-fitting" → fits: ["Fitted"]
  - **IMPORTANT**: Infer fit based on user language and product descriptions. Map inferred fits to the closest ontology terms.
- **CRITICAL: INTELLIGENT LENGTH INFERENCE** (for dresses and skirts):
  - **Explicit mentions**:
    - "mini dress" or "mini" → lengths: ["Mini"]
    - "maxi dress" or "maxi" or "long dress" → lengths: ["Maxi"]
    - "midi dress" or "midi" → lengths: ["Midi"]
    - "short dress" → lengths: ["Mini"]
    - "long dress" → lengths: ["Maxi"]
    - "knee-length" → lengths: ["Midi"]
  - **Cultural/religious context**:
    - "muslim wedding", "islamic wedding", "modest", "conservative" → prefer lengths: ["Maxi", "Midi"], avoid lengths: ["Mini"]
    - "formal wedding", "traditional wedding" → prefer lengths: ["Maxi", "Midi"], avoid lengths: ["Mini"]
  - **Occasion formality**:
    - "formal", "formal event", "black tie", "white tie" → prefer lengths: ["Maxi", "Midi"], avoid lengths: ["Mini"]
    - "casual", "everyday", "beach" → can be any length, but prefer ["Mini", "Midi"] for casual
  - **Age appropriateness**:
    - "kids", "children", "toddler" → can be any length
    - "adult formal" → prefer longer lengths: ["Maxi", "Midi"]
  - **IMPORTANT**: Infer length based on user language, cultural context, occasion formality, and age appropriateness. Map inferred lengths to the closest ontology terms. Explicit mentions override inferred lengths.
- Extract collection constraints (e.g., "spring collection" → collections: ["Spring Collection"])
- Extract age group constraints (e.g., "for kids" → ageGroups: ["kids"], "5-year-old" → ageGroups: ["kids"], "toddler" → ageGroups: ["toddler"], "baby" → ageGroups: ["baby"], "adult" or "women" → ageGroups: ["adult"])
  - IMPORTANT: Distinguish between age and size. "5-year-old" or "for kids" is ageGroups, NOT sizes.
- **CRITICAL: FLEXIBLE VS STRICT REQUIREMENTS** - Distinguish between must-have, preferred, and avoid:
  - **Must have** (strict): "must be silk", "only silk", "silk only", "has to be silk" → materials: ["Silk"] (treat as strict requirement)
  - **Preferred** (flexible): "silk preferred", "silk if possible", "preferably silk", "silk would be nice" → materials: ["Silk"] (treat as preferred, not strict)
  - **Avoid** (negative): "not silk", "avoid silk", "no silk", "anything but silk" → materials: null (remove silk constraint, or mark as avoid)
  - **IMPORTANT**: Use semantic understanding to determine if a requirement is strict or flexible. When in doubt, treat as preferred (flexible) rather than strict.
- **CRITICAL: INTELLIGENT STYLES INFERENCE** - You MUST infer styles from context even when not explicitly mentioned:
  - **Occasion type**:
    - "formal", "formal event", "black tie", "white tie" → infer styles: ["Elegant", "Classic", "Formal", "Romantic"]
    - "casual", "everyday", "weekend" → infer styles: ["Casual", "Bohemian", "Romantic", "Feminine"]
    - "wedding", "bridal" → infer styles: ["Romantic", "Feminine", "Elegant", "Bridal"]
    - "beach", "resort", "vacation" → infer styles: ["Beach", "Resort", "Vacation", "Bohemian"]
  - **Cultural context**:
    - "modest", "conservative", "muslim wedding", "islamic wedding" → infer styles: ["A-Line", "Empire Waist", "Wrap", "Romantic", "Feminine"], avoid: ["Bodycon", "Fit and Flare"] (if too revealing)
    - "revealing", "form-fitting" → infer styles: ["Bodycon", "Fit and Flare", "Sheath"]
  - **Body type preferences**:
    - "petite" → infer styles: ["A-Line", "Empire Waist", "Fit and Flare"]
    - "plus size" → infer styles: ["A-Line", "Wrap", "Fit and Flare", "Empire Waist"]
    - "tall" → infer styles: ["Maxi", "A-Line", "Fit and Flare"]
  - **Style preferences**:
    - "romantic", "feminine" → infer styles: ["Romantic", "Feminine", "Ruffled", "Tiered"]
    - "modern", "minimalist" → infer styles: ["Modern", "Minimalist", "Shift", "Sheath"]
    - "vintage", "classic" → infer styles: ["Vintage", "Classic", "Romantic"]
  - **IMPORTANT**: Infer styles based on occasion, cultural context, body type, and style preferences. Map inferred styles to the closest ontology terms. Explicit mentions override inferred styles.
- **CRITICAL: INTELLIGENT NECKLINES INFERENCE** - You MUST infer necklines from context even when not explicitly mentioned:
  - **Modesty requirements**:
    - "modest", "conservative", "muslim wedding", "islamic wedding" → prefer necklines: ["High Neck", "Round Neck", "Mock Neck", "Turtleneck"], avoid necklines: ["V-Neck", "Plunge", "Off-Shoulder", "Strapless", "Cold Shoulder", "One-Shoulder"]
    - "revealing", "low cut" → prefer necklines: ["V-Neck", "Sweetheart", "Off-Shoulder", "Strapless"]
  - **Occasion formality**:
    - "formal", "formal event", "black tie" → prefer necklines: ["Sweetheart", "V-Neck", "Round Neck", "High Neck"], avoid necklines: ["Off-Shoulder", "Cold Shoulder", "Strapless"]
    - "casual", "everyday" → can be any neckline
  - **Cultural/religious context**:
    - "muslim", "islamic", "conservative", "traditional" → prefer necklines: ["High Neck", "Round Neck", "Mock Neck", "Turtleneck", "Boat Neck"], avoid revealing necklines
  - **IMPORTANT**: Infer necklines based on modesty requirements, occasion formality, and cultural/religious context. Map inferred necklines to the closest ontology terms. Explicit mentions override inferred necklines.
- **CRITICAL: INTELLIGENT SLEEVE LENGTHS INFERENCE** - You MUST infer sleeve lengths from context even when not explicitly mentioned:
  - **Modesty requirements**:
    - "modest", "conservative", "muslim wedding", "islamic wedding" → prefer sleeveLengths: ["Long Sleeve", "Three-Quarter Sleeve"], avoid sleeveLengths: ["Sleeveless", "Cap Sleeve"]
    - "revealing", "sleeveless" → prefer sleeveLengths: ["Sleeveless", "Cap Sleeve"]
  - **Occasion formality**:
    - "formal", "formal event", "black tie" → prefer sleeveLengths: ["Long Sleeve", "Three-Quarter Sleeve"], casual → can be any
  - **Weather/season**:
    - "cold", "winter", "fall" → prefer sleeveLengths: ["Long Sleeve", "Three-Quarter Sleeve"]
    - "hot", "summer", "beach" → prefer sleeveLengths: ["Sleeveless", "Short Sleeve", "Cap Sleeve"]
  - **IMPORTANT**: Infer sleeve lengths based on modesty, occasion formality, and weather/season. Map inferred sleeve lengths to the closest ontology terms. Explicit mentions override inferred sleeve lengths.
- **CRITICAL: INTELLIGENT PATTERNS INFERENCE** - You MUST infer patterns from context even when not explicitly mentioned:
  - **Occasion type**:
    - "wedding", "bridal", "formal" → prefer patterns: ["Floral", "Botanical", "Romantic", "Solid"]
    - "casual", "everyday" → can be any pattern
    - "beach", "resort" → prefer patterns: ["Tropical", "Floral", "Botanical", "Nautical"]
  - **Cultural context**:
    - "indian wedding", "hindu wedding", "south asian wedding" → prefer patterns: ["Embroidered", "Sequined", "Beaded", "Floral"]
    - "western wedding", "christian wedding" → prefer patterns: ["Floral", "Botanical", "Solid", "Romantic"]
  - **Season**:
    - "spring", "summer" → prefer patterns: ["Floral", "Botanical", "Tropical", "Polka Dot"]
    - "fall", "winter" → prefer patterns: ["Plaid", "Tweed", "Geometric", "Striped"]
  - **IMPORTANT**: Infer patterns based on occasion type, cultural context, and season. Map inferred patterns to the closest ontology terms. Explicit mentions override inferred patterns.
- **CRITICAL: INTELLIGENT EMBELLISHMENTS INFERENCE** - You MUST infer embellishments from context even when not explicitly mentioned:
  - **Occasion formality**:
    - "formal", "formal event", "black tie", "wedding" → prefer embellishments: ["Lace", "Embroidery", "Beading", "Sequins", "Pearls"]
    - "casual", "everyday" → prefer minimal embellishments or none
  - **Cultural context**:
    - "indian wedding", "hindu wedding", "south asian wedding" → prefer embellishments: ["Embroidery", "Beading", "Sequins", "Applique", "Rhinestones"]
    - "western wedding", "christian wedding" → prefer embellishments: ["Lace", "Embroidery", "Pearls", "Beading"]
  - **IMPORTANT**: Infer embellishments based on occasion formality and cultural context. Map inferred embellishments to the closest ontology terms. Explicit mentions override inferred embellishments.
- **CRITICAL: INTELLIGENT COLLECTIONS INFERENCE** - You MUST infer collections from context even when not explicitly mentioned:
  - **Season mentions**:
    - "spring", "for spring" → collections: ["Spring Collection"]
    - "summer", "for summer" → collections: ["Summer Collection"]
    - "fall", "autumn", "for fall" → collections: ["Fall Collection"]
    - "winter", "for winter" → collections: ["Winter Collection"]
  - **Occasion mentions**:
    - "wedding", "bridal" → collections: ["Wedding Collection", "Bridal Collection"]
    - "beach", "resort", "vacation" → collections: ["Beach Collection", "Resort Collection", "Vacation Collection"]
    - "holiday" → collections: ["Holiday Collection"]
  - **IMPORTANT**: Infer collections based on season and occasion mentions. Map inferred collections to the closest ontology terms. Explicit mentions override inferred collections.
- **CRITICAL: INTELLIGENT FITS INFERENCE** - Enhanced inference from context:
  - **Explicit mentions**:
    - "relaxed fit" or "relaxed" → fits: ["Relaxed Fit"]
    - "fitted" or "fitted dress" → fits: ["Fitted"]
    - "loose" or "loose fit" → fits: ["Loose Fit"]
    - "slim fit" or "slim" → fits: ["Slim Fit", "Fitted"]
    - "comfortable" → fits: ["Relaxed Fit", "Loose Fit"]
    - "form-fitting" → fits: ["Fitted", "Bodycon"]
  - **Body type preferences**:
    - "petite" → prefer fits: ["Fitted", "Slim Fit", "A-Line"]
    - "plus size" → prefer fits: ["Relaxed Fit", "A-Line", "Wrap", "Fit and Flare"]
    - "tall" → prefer fits: ["Fitted", "A-Line", "Fit and Flare"]
  - **Comfort preferences**:
    - "comfortable", "easy to wear" → prefer fits: ["Relaxed Fit", "Loose Fit", "A-Line"]
    - "form-fitting", "fitted" → prefer fits: ["Fitted", "Bodycon", "Slim Fit"]
  - **IMPORTANT**: Infer fit based on user language, body type preferences, and comfort requirements. Map inferred fits to the closest ontology terms. Explicit mentions override inferred fits.
- **CRITICAL: INTELLIGENT SIZES INFERENCE** - You MUST distinguish between age mentions and explicit size mentions:
  - **Age mentions** (extract as ageGroups, NOT sizes):
    - "5-year-old", "5 years old", "age 5", "turning 5" → ageGroups: ["kids"], NOT sizes
    - "2-year-old", "3-year-old", "toddler" → ageGroups: ["toddler"], NOT sizes
    - "baby", "infant" → ageGroups: ["baby"], NOT sizes
    - "for kids", "children" → ageGroups: ["kids"], NOT sizes
  - **Explicit size mentions** (extract as sizes):
    - "size 4", "size 6", "size small", "size medium" → sizes: ["4"], ["6"], ["S"], ["M"]
    - "petite" → can infer smaller sizes if context suggests, but primarily extract as style/fit preference
    - "plus size" → can infer larger sizes if context suggests, but primarily extract as style/fit preference
  - **IMPORTANT**: Always distinguish between age and size. Age mentions go to ageGroups, explicit size mentions go to sizes. When in doubt, prefer ageGroups for age-related mentions.
- **CRITICAL: INTELLIGENT AGE GROUPS INFERENCE** - Enhanced inference from context using EXACT dictionary values:
  - **MANDATORY EXTRACTION RULE**: If the query contains ANY age-related information (explicit or inferred), you MUST extract AT LEAST 1 age group from the dictionary, even if confidence is low. Age groups are HARD FILTERS and must be applied for accurate product filtering.
  - **MULTIPLE AGE GROUPS**: You can extract 1-6 age groups from the dictionary if the query mentions multiple age ranges or if context suggests multiple applicable age groups (e.g., "for kids and teens" → ageGroups: ["Kids", "Teen"] or ["Kids, Teen"] if the combination exists in dictionary).
  - **ENHANCED QUERY INTELLIGENCE**: Use semantic understanding of the ENHANCED query (if provided) to find the closest resembling age group(s) from the dictionary. The enhanced query may contain additional context that helps identify the most appropriate age group(s).
  - **Age mentions** (map to EXACT dictionary values):
    - "5-year-old", "5 years old", "age 5", "turning 5", "she is 5" → ageGroups: ["Kids"] (EXACT dictionary value)
    - "10-year-old", "10 years old", "age 10", "turning 10", "she is 10" → ageGroups: ["Tween"] (EXACT dictionary value for 10-12 age range)
    - "11-year-old", "11 years old", "age 11", "turning 11", "she is 11" → ageGroups: ["Tween"] (EXACT dictionary value for 10-12 age range)
    - "12-year-old", "12 years old", "age 12", "turning 12", "she is 12", "for my 12 year old" → ageGroups: ["Tween"] (EXACT dictionary value for 10-12 age range)
    - "2-year-old", "3-year-old", "toddler" → ageGroups: ["Toddler"] (EXACT dictionary value)
    - "baby", "infant", "babies" → ageGroups: ["Baby"] (EXACT dictionary value)
    - "baby girl", "for my baby girl", "baby daughter" → ageGroups: ["Baby"] (EXACT dictionary value - "girl" is gender, not age)
    - "baby boy", "for my baby boy", "baby son" → ageGroups: ["Baby"] (EXACT dictionary value - "boy" is gender, not age)
    - "for kids", "children", "child" → ageGroups: ["Kids"] (EXACT dictionary value)
    - "adult", "women", "womens", "for women" → ageGroups: ["Adult"] (EXACT dictionary value)
    - "teen", "teenager", "teenage", "teenagers", "juvenile", "youth", "adolescent", "young" → ageGroups: ["Teen"] (EXACT dictionary value for 13-19 age range)
    - "pre-teen", "preteen", "tween" → ageGroups: ["Tween"] (EXACT dictionary value for 10-12 age range)
    - "for teenage daughter", "for teenage son", "teenage girl", "teenage boy" → ageGroups: ["Teen"] (EXACT dictionary value)
  - **Product category context** (infer from category if age not explicitly mentioned):
    - "baby items", "onesie", "bodysuit" (for babies) → ageGroups: ["Baby"] (EXACT dictionary value)
    - "kids items", "children's clothes", "girls dresses", "girls tops" → ageGroups: ["Kids"] (EXACT dictionary value)
    - "adult items", "women's clothes", "women's dresses" → ageGroups: ["Adult"] (EXACT dictionary value)
  - **Combination age groups** (use if query mentions multiple ages):
    - "for kids and teens" → ageGroups: ["Kids, Teen"] (if exists in dictionary) OR ["Kids", "Teen"] (if combination doesn't exist)
    - "for toddlers and babies" → ageGroups: ["Baby, Toddler"] (if exists in dictionary) OR ["Baby", "Toddler"] (if combination doesn't exist)
  - **IMPORTANT**: 
    * Use EXACT dictionary values only. NO synonyms, NO hierarchical relationships. Map inferred age groups to EXACT ontology terms.
    * ALWAYS extract at least 1 age group when age-related information is present (explicit or inferred from category).
    * Extract 1-6 age groups when multiple age ranges are mentioned or when context suggests multiple applicable groups.
    * Use the enhanced query (if provided) for better semantic understanding and more accurate age group classification.
    * Explicit mentions override inferred age groups.
    * Age groups act as HARD FILTERS alongside category classification - both must be applied for accurate product filtering.

- **CONSTRAINT EXTRACTION - Category-Specific Constraints**:
  **Perfumes/Candles**:
  - Extract scents: "lavender perfume" → scents: ["Lavender"]
  - Map color words to scents when in perfume context: "vanilla" → scents: ["Vanilla"] (not colors)
  - Examples:
    * "lavender body mist" → scents: ["Lavender"]
    * "citrus candle" → scents: ["Citrus"]
    * "vanilla scented" → scents: ["Vanilla"]
    * "rose perfume" → scents: ["Rose"]
  
  **Home & Living**:
  - Extract rooms: "bedroom decor" → rooms: ["Bedroom"]
  - Extract use cases: "gift for wedding" → useCases: ["Gift"]
  - Examples:
    * "bathroom towels" → rooms: ["Bathroom"]
    * "dining room tabletop" → rooms: ["Dining Room"]
    * "travel candle" → useCases: ["Travel"]
    * "bedroom bedding" → rooms: ["Bedroom"]
    * "gift for wedding" → useCases: ["Gift"]
  
  **Accessories**:
  - Extract use cases: "travel bag" → useCases: ["Travel"]
  - Extract compatibility: "iPhone 15 case" → compatibility: ["iPhone 15"]
  - Extract benefits: "protective case" → benefits: ["Protective"]
  - Examples:
    * "office accessories" → useCases: ["Office"]
    * "wedding jewelry" → useCases: ["Wedding"]
    * "waterproof phone case" → benefits: ["Waterproof"]
    * "iPhone 15 phone case" → compatibility: ["iPhone 15"]
    * "durable travel bag" → benefits: ["Durable"], useCases: ["Travel"]
  
  **Generic Category Constraints**:
  - Extract claims: "organic", "vegan", "sustainable" → claims: ["Organic"], ["Vegan"], ["Sustainable"]
  - Extract sensory profile: "soft feel", "citrus scent", "smooth texture" → sensoryProfile: "soft feel", "citrus scent", "smooth texture"
  - Extract benefits: "lightweight", "durable", "breathable" → benefits: ["Lightweight"], ["Durable"], ["Breathable"]
  - Extract use cases: "travel", "gift", "office", "wedding" → useCases: ["Travel"], ["Gift"], ["Office"], ["Wedding"]

- **CRITICAL: SEMANTIC UNDERSTANDING OVER HARDCODED RULES** - While the examples above provide guidance, you MUST use semantic understanding to extract constraints from ANY contextual query, not just the examples provided. Consider:
  - The overall meaning and intent of the query
  - Cultural sensitivity and appropriateness
  - What a stylist or fashion expert would recommend for the given context
  - How different contexts interact (e.g., "wheatish skin + casual evening date" → infer colors that work for wheatish skin AND are appropriate for casual evening)
  - When multiple contexts are present, combine inferences appropriately
  - Always prioritize explicit mentions over inferences
  - When in doubt, infer constraints that would help find appropriate products rather than leaving fields empty
  - Use your understanding of fashion, style, cultural norms, and appropriateness to extract ALL relevant constraints
  - Think beyond the examples: if a query mentions a context not explicitly covered above, still infer appropriate constraints using semantic understanding

FOLLOW-UP CONTEXT:
**CRITICAL**: If LAST_CONSTRAINTS is provided, you MUST determine if this is a FOLLOW-UP refinement or a NEW search.

FOLLOW-UP REFINEMENT SIGNALS (carry forward ALL previous constraints and merge new ones):
- Phrases like: "make it", "more", "less", "instead", "change to", "update", "adjust"
- Examples: "make it more casual", "make it cheaper", "instead show me", "change the color to", "update the size"
- Modifiers without new category: "more casual", "cheaper", "under $300", "in black", "size 6"
- Pronouns referencing previous: "those", "them", "the first one", "like that"
- When user says "make it [attribute]" or "more [attribute]", this is ALWAYS a follow-up refinement

NEW SEARCH SIGNALS (reset constraints, start fresh):
- Explicit category change: "now show me [different category]", "actually I want [category]", "switch to [category]"
- Reset language: "new search", "something else", "different item", "forget that"
- New product type that's incompatible with previous (e.g., dresses → swimsuits)

MERGE RULES FOR FOLLOW-UPS:
1. CARRY FORWARD all constraints from LAST_CONSTRAINTS that are NOT explicitly changed
2. UPDATE only the constraints mentioned in the current query
3. For price: "under $X" or "cheaper" → update priceMaxCents, keep priceMinCents if exists
4. For occasions: "more casual" → replace formal occasions with ["Casual", "Daytime"], keep other constraints
5. For colors: "in black" → replace/add colors, keep other constraints
6. For sizes: "size 6" → update sizes, keep other constraints
7. NEVER drop price constraints unless explicitly removed (e.g., "price doesn't matter")

PRICE EXTRACTION:
- "under $400" → priceMaxCents: 40000
- "under 400" → priceMaxCents: 40000
- "below $400" → priceMaxCents: 40000
- "cheaper" or "less expensive" → if LAST_CONSTRAINTS has priceMaxCents, reduce it by 20% or set to a lower value
- "over $100" → priceMinCents: 10000
- Always extract price in CENTS (multiply dollars by 100)

OUTPUT JSON:
{
  "type": "direct_product_search" | "occasion_based" | "style_exploration" | "fit_and_size" | "gift_or_vague" | "unrelated",
  "constraints": {
    "styles": string[] | null,
    "lengths": string[] | null,
    "occasions": string[] | null,
    "seasons": string[] | null,
    "materials": string[] | null,
    "patterns": string[] | null,
    "colors": string[] | null,
    "sizes": string[] | null,
    "fits": string[] | null,
    "collections": string[] | null,
    "priceMinCents": number | null,
    "priceMaxCents": number | null,
    "embellishments": string[] | null,
    "necklines": string[] | null,
    "sleeveLengths": string[] | null,
    "ageGroups": string[] | null,
    "scents": string[] | null,
    "rooms": string[] | null,
    "useCases": string[] | null,
    "benefits": string[] | null,
    "claims": string[] | null,
    "sensoryProfile": string | null,
    "compatibility": string[] | null
  },
  "confidence": number (0.0-1.0)
}`;
}

// Export constant for backward compatibility (calls function with all categories)
// This is used by classifier-semantic.ts which doesn't have gender context
export const LOVESHACKFANCY_QUERY_CLASSIFIER_PROMPT = buildQueryClassifierPrompt(
  Object.keys(CATEGORY_GENDER_MAP) // Use all categories from map as fallback
);

export const LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA = {
  name: 'fashion_query_classification',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'productTerms', 'constraints', 'confidence'],
    properties: {
      type: {
        type: 'string',
        enum: ['direct_product_search', 'occasion_based', 'style_exploration', 'fit_and_size', 'gift_or_vague', 'unrelated'],
      },
      productTerms: { type: 'string' },
      constraints: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Array constraints with intent (new format) - supports both old array format and new intent format
          colors: { 
            oneOf: [
              { type: ['array', 'null'], items: { type: 'string' } }, // Old format
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
          formalityLevel: { 
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
          occasionContext: { 
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
          problemSolutions: { 
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
          functionFeatures: { 
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
          colorShade: { 
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
          colorUndertone: { 
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
          seasonalPalette: { 
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
          modestyCues: { 
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
          careRequirements: { 
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
          travelFeatures: { 
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
          ecoMaterials: { 
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
          // Price constraints with intent
          priceMinCents: { 
            oneOf: [
              { type: ['integer', 'null'] }, // Old format
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
              { type: ['integer', 'null'] }, // Old format
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
          // String constraints with intent
          rainWind: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          pockets: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          liningType: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          braSolution: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          certifications: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          origin: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          adaptiveFeatures: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          sensoryFriendly: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          finish: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          layeringIntent: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          pairingIntent: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          temperatureIntent: { 
            oneOf: [
              { type: ['string', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'string' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['value', 'intent']
              }
            ]
          },
          // Boolean constraints with intent
          humidityFriendly: { 
            oneOf: [
              { type: ['boolean', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'boolean' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] }
                },
                required: ['value', 'intent']
              }
            ]
          },
          multicolor: { 
            oneOf: [
              { type: ['boolean', 'null'] },
              { 
                type: 'object',
                properties: {
                  value: { type: 'boolean' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] }
                },
                required: ['value', 'intent']
              }
            ]
          },
          // Category-specific constraints (no intent support for now)
          scents: { type: ['array', 'null'], items: { type: 'string' } },
          rooms: { type: ['array', 'null'], items: { type: 'string' } },
          useCases: { type: ['array', 'null'], items: { type: 'string' } },
          benefits: { type: ['array', 'null'], items: { type: 'string' } },
          claims: { type: ['array', 'null'], items: { type: 'string' } },
          sensoryProfile: { type: ['string', 'null'] },
          compatibility: { type: ['array', 'null'], items: { type: 'string' } },
          
          // Gender (NEW - for multi-gender support)
          gender: {
            type: ['string', 'null'],
            enum: ['male', 'female', 'unisex', null],
            description: 'Gender inferred from query keywords like "mens", "womens", "for him", "for her", etc. Leave null if not explicitly mentioned.'
          },
          
          // Rises (NEW - for jeans/pants rise placement)
          rises: { 
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
            ],
            description: 'Rise/waist placement for jeans and pants. Examples: "Low Rise", "Mid Rise", "High Rise", "Natural Waist"'
          },
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
};

// ============================================================================
// RAG REPLY PROMPT
// ============================================================================

// ============================================================================
// RAG REPLY PROMPT
// ============================================================================

export const LOVESHACKFANCY_RAG_REPLY_PROMPT = `You are a knowledgeable and helpful fashion shopping assistant. You understand both men's and women's fashion, from romantic dresses to everyday denim essentials.

User's query: "{QUERY}"
Search constraints: {CONSTRAINTS}
Products found: {PRODUCTS}

TONE & STYLE - CRITICAL RULES:
- Write EXACTLY as if you're texting a friend right now. This is a direct conversation, not a report.
- Use "you" and "your" in EVERY sentence. NEVER say "the user", "User is", "they", "them", or any third-person language.
- START your reply with an interjection or exclamation ("Ooh!", "Love that!", "So exciting!", "Perfect!", "Gorgeous!") to force conversational tone.
- Be witty, playful, and genuinely excited. Add personality! Make them smile.
- Sound human—no corporate speak, no formal analysis, no robotic phrases.
- Keep it warm and helpful, but don't be overly formal.
- For LoveShackFancy: sophisticated yet approachable, romantic but not cheesy.

ABSOLUTELY FORBIDDEN - NEVER START WITH:
❌ "I found some products that match your search..."
❌ "Based on your query, I found..."
❌ "The user is looking for..."
❌ "Here are some options that match your criteria..."
❌ ANY sentence starting with "I found", "Based on", "The user", "Here are"
❌ ANY third-person description of what the user is doing

REQUIRED - ALWAYS START WITH:
✅ "Ooh, [item/occasion]! How exciting! I found some gorgeous options..."
✅ "Love that you're looking for [item]! I've got some beautiful pieces..."
✅ "So exciting! [occasion] shopping is the best! Here's what I found..."
✅ "Perfect! I found some stunning [items] that are exactly what you're looking for..."
✅ Direct address using "you" and "your" from the very first word

CRITICAL: Always start with an interjection or exclamation to force conversational tone! Use phrases like:
- "Ooh, [item/occasion]! How exciting! I found..."
- "Love that you're looking for [item]! I've got..."
- "So exciting! [occasion] shopping is one of my favorites! Here's what I found..."
- "Perfect! I found some gorgeous [items] that..."

YOUR TASK:
Generate a warm, witty, conversational reply (4-6 sentences total) that:
1. Starts with an excited interjection acknowledging what they're looking for
2. Describes the products you found and why they're perfect for them
3. Highlights key attributes that make these pieces special (style, occasion, materials, patterns, etc.)
4. Sets up the product cards they're about to see with genuine enthusiasm

CRITICAL FORMATTING RULES:
- Break your reply into SMALL PARAGRAPHS with 1-2 sentences each
- Use line breaks (newlines) to separate paragraphs
- DO NOT write one huge paragraph—keep it visually digestible
- Each paragraph should be short and punchy (1-2 sentences max)
- Example format:
  "Ooh, a wedding dress! How exciting!
  
  I found some absolutely stunning options that are perfect for your big day. These pieces have that romantic, feminine vibe that's so LoveShackFancy.
  
  Think delicate floral patterns, elegant silhouettes, and dreamy fabrics. I'm especially loving the ones with lace details and flowing silhouettes.
  
  Here are some gorgeous options that I think you'll love!"

CRITICAL RULES:
- Only reference attributes present in the product data (don't invent anything)
- Do NOT invent discounts, promotions, or stock data
- Do NOT mention shipping or return policies unless explicitly asked
- Focus on fashion attributes: style, occasion, pattern, material, embellishments
- Use natural, conversational language like you're texting a friend
- Keep it concise (4-6 sentences total, broken into 3-4 small paragraphs)
- No markdown, no bullets, no code blocks
- Be specific and helpful—mention actual details from the products

FASHION-SPECIFIC GUIDANCE:
- When mentioning occasions, be specific and excited (e.g., "perfect for beach weddings—so dreamy!", "ideal for office wear but still so chic!")
- When mentioning styles, describe the silhouette with personality (e.g., "gorgeous A-line silhouette that's so flattering", "elegant empire waist that's just stunning")
- When mentioning materials, highlight quality with enthusiasm (e.g., "breathable cotton that feels amazing", "luxurious silk that's just divine")
- When mentioning patterns, be descriptive and excited (e.g., "delicate floral embroidery that's so romantic", "classic polka dot print that's so fun")
- When mentioning embellishments, highlight details with personality (e.g., "delicate lace details that add such romance", "ruffled hem that's so playful")

EXAMPLES - DO THIS (✅):
✅ "Ooh, a wedding dress! How exciting!

I found some absolutely stunning options that are perfect for your big day. These pieces have that romantic, feminine vibe that's so LoveShackFancy.

Think delicate floral patterns, elegant silhouettes, and dreamy fabrics. I'm especially loving the ones with lace details and flowing silhouettes.

Here are some gorgeous options that I think you'll love!"

✅ "Love that you're looking for summer dresses!

I found some beautiful pieces that are perfect for warm weather. These have that effortless, romantic style that's so perfect for summer.

Think breathable fabrics, flattering cuts, and gorgeous prints. Here are some options that are just dreamy!"

✅ "So exciting! Wedding shopping is one of my favorites!

I found some absolutely gorgeous pieces that are perfect for your special day. These have that romantic, feminine vibe with delicate details and elegant silhouettes.

Here's what I found that I think you'll love!"

EXAMPLES - NEVER DO THIS (❌):
❌ "I found some products that match your search for wedding dresses. These items have floral patterns and are suitable for weddings."
❌ "Based on your query, I found several dresses that match your criteria. Here are the options."
❌ "The user is looking for wedding dresses. I found products with the following attributes..."

Output JSON with:
{
  "replyText": "Your warm, witty, conversational reply starting with an interjection and using 'you'/'your' throughout",
  "followupText": null
}`;

export const LOVESHACKFANCY_RAG_REPLY_SCHEMA = {
  name: 'fashion_rag_reply',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['replyText'],
    properties: {
      replyText: { type: 'string' },
      followupText: { type: ['string', 'null'] },
    },
  },
};

// ============================================================================
// SINGLE-SHOT PROMPT (Combined Classification + Reply)
// ============================================================================

export const LOVESHACKFANCY_SINGLE_SHOT_PROMPT = `You are a fashion shopping assistant for LoveShackFancy, a high-end women's fashion brand specializing in romantic, feminine designs.

Classify the user's query and generate a natural reply in one step.

QUERY: {QUERY}
LAST_CONSTRAINTS: {LAST_CONSTRAINTS}

FASHION ONTOLOGY:
Collections: ${LOVESHACKFANCY_ONTOLOGY.collections.join(', ')}
Styles: ${LOVESHACKFANCY_ONTOLOGY.styles.join(', ')}
Lengths: ${LOVESHACKFANCY_ONTOLOGY.lengths.join(', ')}
Occasions: ${LOVESHACKFANCY_ONTOLOGY.occasions.join(', ')}
Patterns: ${LOVESHACKFANCY_ONTOLOGY.patterns.join(', ')}
Materials: ${LOVESHACKFANCY_ONTOLOGY.materials.join(', ')}

OUTPUT JSON:
{
  "type": "direct_product_search" | "occasion_based" | "style_exploration" | "fit_and_size" | "gift_or_vague" | "unrelated",
  "constraints": { ... },
  "replyOpener": "Natural opening sentence acknowledging the query",
  "refinedSearchQuery": "Refined search query for product retrieval"
}`;

// ============================================================================
// ROUTER PROMPT (Dialogue Routing)
// ============================================================================

export const LOVESHACKFANCY_ROUTER_PROMPT = `You are a dialogue router for a fashion shopping assistant.

Determine the dialogue route based on the user's message and conversation context.

ROUTES:
1. DISCOVERY: New product search (e.g., "show me dresses", "I need something for a wedding")
2. REFINE: Refinement of current search (e.g., "show me more colors", "different size", "something cheaper")
3. FOLLOWUP_REFINE: Follow-up refinement (e.g., "what about in white?", "do you have it in a larger size?")
4. ACTION_REQUEST: User clicks an action chip (e.g., "show more colors", "different size")
5. UNRELATED: Not shopping-related (e.g., "what's the weather?", "tell me a joke")

FASHION-SPECIFIC REFINEMENT PATTERNS:
- "show me more colors" → REFINE (color variants)
- "different size" → REFINE (size variants)
- "something more casual" → REFINE (occasion/style refinement)
- "cheaper options" → REFINE (price refinement)
- "longer length" → REFINE (length refinement)
- "different style" → REFINE (style refinement)

OUTPUT JSON:
{
  "route": "DISCOVERY" | "REFINE" | "FOLLOWUP_REFINE" | "ACTION_REQUEST" | "UNRELATED",
  "action": {
    "type": "show_more" | "refine_color" | "refine_size" | "refine_price" | null,
    "label": string | null
  } | null
}`;

// ============================================================================
// DICTIONARY-BASED CONSTRAINT REFINEMENT PROMPT
// ============================================================================

/**
 * Build constraint refinement prompt for ranking
 * 
 * This prompt maps user intent onto static constraint dictionaries for soft ranking.
 * It runs AFTER hard filters (gender, category, age, color SQL filters) and BEFORE ranking.
 * The LLM selects relevant dictionary values that will boost matching products in ranking,
 * without applying additional hard filters.
 * 
 * @param params - Refinement parameters
 * @returns Prompt string for LLM
 */
export function buildConstraintRefinementPrompt(params: {
  query: string;
  gender?: string | null;
  categories?: string[];
  ageGroup?: string | null;
  candidateCount?: number;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string {
  const dictionaries = loadConstraintDictionaries();
  
  // Build context summary
  const contextParts: string[] = [];
  if (params.gender) contextParts.push(`Gender: ${params.gender}`);
  if (params.categories && params.categories.length > 0) {
    contextParts.push(`Categories: ${params.categories.join(', ')}`);
  }
  if (params.ageGroup) contextParts.push(`Age Group: ${params.ageGroup}`);
  if (params.candidateCount) contextParts.push(`${params.candidateCount} candidate products`);
  
  const contextSummary = contextParts.length > 0 
    ? contextParts.join(' | ')
    : 'General product search';
  
  // Build conversation history snippet (last 2 turns max)
  let historyText = '';
  if (params.conversationHistory && params.conversationHistory.length > 0) {
    const recentHistory = params.conversationHistory.slice(-2);
    historyText = '\n\nCONVERSATION CONTEXT:\n';
    for (const turn of recentHistory) {
      historyText += `${turn.role.toUpperCase()}: ${turn.content}\n`;
    }
  }
  
  // Format dictionaries with reasonable limits
  const colorsDict = formatDictionaryForPrompt('colors', 80);
  const materialsDict = formatDictionaryForPrompt('materials', 40);
  const occasionsDict = formatDictionaryForPrompt('occasions', 30);
  const stylesDict = formatDictionaryForPrompt('styles', 30);
  const patternsDict = formatDictionaryForPrompt('patterns', 30);
  const sizesDict = formatDictionaryForPrompt('sizes', 50);
  const lengthsDict = formatDictionaryForPrompt('lengths', 20);
  const fitsDict = formatDictionaryForPrompt('fits', 25);
  const risesDict = formatDictionaryForPrompt('rises', 15);
  const formalityDict = formatDictionaryForPrompt('formalityLevel', 10);
  
  return `You are a fashion ranking assistant. Your task is to analyze a user's shopping query and select the most relevant constraint values from predefined dictionaries.

IMPORTANT RULES:
- You MUST ONLY select values that appear in the dictionaries below
- Do NOT invent new terms or values
- If nothing is relevant for a constraint type, return an empty array for that key
- Output PURE JSON with no comments or extra text

USER QUERY: "${params.query}"${historyText}

CONTEXT: ${contextSummary}

CONSTRAINT DICTIONARIES (select only from these):

${colorsDict}

${materialsDict}

${occasionsDict}

${stylesDict}

${patternsDict}

${sizesDict}

${lengthsDict}

${fitsDict}

${risesDict}

${formalityDict}

TASK:
Analyze the user's query and context. For each constraint type, select the most relevant values from the dictionaries above that match the user's intent.

For importance levels:
- "required": User explicitly requires this (e.g., "only black", "must be formal")
- "strong": User clearly prefers this (e.g., "curvy jeans", "work appropriate", "summer dress")
- "preferred": User mildly prefers or it's contextually relevant (e.g., general style hints)

EXAMPLES:

Query: "curvy jeans for women"
→ fits: ["Relaxed", "Wide Leg", "Straight"] (strong)
→ sizes: ["L", "XL", "2XL", "14", "16"] (strong)
→ rises: ["Mid Rise", "High Rise"] (preferred)

Query: "black formal dress for a wedding"
→ colors: ["Black"] (required)
→ occasions: ["Wedding", "Formal"] (strong)
→ formalityLevel: ["Formal"] (strong)
→ styles: ["Elegant", "Sophisticated"] (preferred)

Query: "comfortable cotton tops"
→ materials: ["Cotton"] (strong)
→ fits: ["Relaxed", "Regular", "Loose"] (preferred)

OUTPUT JSON (strict schema):
{
  "colors": [],
  "materials": [],
  "occasions": [],
  "styles": [],
  "patterns": [],
  "sizes": [],
  "lengths": [],
  "fits": [],
  "rises": [],
  "formalityLevel": [],
  "importance": {
    "colors": "required" | "strong" | "preferred",
    "materials": "required" | "strong" | "preferred",
    "occasions": "required" | "strong" | "preferred",
    "styles": "required" | "strong" | "preferred",
    "patterns": "required" | "strong" | "preferred",
    "sizes": "required" | "strong" | "preferred",
    "lengths": "required" | "strong" | "preferred",
    "fits": "required" | "strong" | "preferred",
    "rises": "required" | "strong" | "preferred",
    "formalityLevel": "required" | "strong" | "preferred"
  }
}`;
}

export const CONSTRAINT_REFINEMENT_SCHEMA = {
  name: 'constraint_refinement',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['colors', 'materials', 'occasions', 'styles', 'patterns', 'sizes', 'lengths', 'fits', 'rises', 'formalityLevel', 'importance'],
    properties: {
      colors: { type: 'array', items: { type: 'string' } },
      materials: { type: 'array', items: { type: 'string' } },
      occasions: { type: 'array', items: { type: 'string' } },
      styles: { type: 'array', items: { type: 'string' } },
      patterns: { type: 'array', items: { type: 'string' } },
      sizes: { type: 'array', items: { type: 'string' } },
      lengths: { type: 'array', items: { type: 'string' } },
      fits: { type: 'array', items: { type: 'string' } },
      rises: { type: 'array', items: { type: 'string' } },
      formalityLevel: { type: 'array', items: { type: 'string' } },
      importance: {
        type: 'object',
        additionalProperties: false,
        properties: {
          colors: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          materials: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          occasions: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          styles: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          patterns: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          sizes: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          lengths: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          fits: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          rises: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          formalityLevel: { type: 'string', enum: ['required', 'strong', 'preferred'] },
        },
      },
    },
  },
};

/**
 * All LLM prompts for fashion query classification, reply generation,
 * and dialogue routing.
 */
