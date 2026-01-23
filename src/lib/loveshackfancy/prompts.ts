/**
 * LoveShackFancy Fashion-Specific Prompts
 * 
 * All LLM prompts for fashion query classification, reply generation,
 * and dialogue routing.
 */

import { LOVESHACKFANCY_ONTOLOGY } from './ontology';
import { formatDictionaryForPrompt, loadConstraintDictionaries } from './constraint-dictionaries';
import { CATEGORY_GENDER_MAP } from '../catalog/category-gender-map';
import type { CategoryDictionaryMap } from '../search/filtering/category-dictionaries';
import { logger } from '../telemetry/logger';
import { formatCategoryConstraintForPrompt } from './category-constraint-dictionaries';

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
export function buildQueryClassifierPrompt(
  allowedCategories: string[],
  classifiedCategories?: string[]
): string {
  const dictionaries = loadConstraintDictionaries();
  
  // Import category-specific dictionary helpers if categories are provided
  const formatCategoryConstraint: ((type: 'colors' | 'materials' | 'sizes' | 'occasions' | 'seasons' | 'styles' | 
                                   'patterns' | 'lengths' | 'formalityLevel' | 'fits' | 'rises' | 'necklines' | 
                                   'sleeveLengths' | 'colorShade' | 'colorUndertone' | 'embellishments' | 
                                     'collections' | 'seasonalPalette' | 'setVsSingle' | 'inclusivitySizing', categories: string[]) => string) | null = 
    (classifiedCategories && classifiedCategories.length > 0) ? formatCategoryConstraintForPrompt : null;
  
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
  * "blue long sleeve top" → productTerms: "top" AND colors: ["Blue"] AND sleeveLengths: ["Long"]
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
- "blue maxi dresses with long sleeves for kids" → productTerms: "maxi dress" AND colors: ["Blue"] AND lengths: ["Maxi"] AND sleeveLengths: ["Long"] AND ageGroups: ["Kids"] AND gender: "female"
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
  * sleeveLengths: ["Long"] (REQUIRED - "long sleeves" is explicitly mentioned)
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
- Sleeve words: "long sleeves", "short sleeves", "sleeveless", "cap sleeves", "three-quarter sleeves" → sleeveLengths: [SleeveType]
  **CRITICAL: Normalize sleeve synonyms to standard ontology terms:**
  * "full sleeves", "full sleeve", "full" → normalize to "Long" (full sleeves = long sleeves in fashion)
  * "cap sleeves", "cap sleeve" → normalize to "Cap"
  * "three-quarter sleeves", "3/4 sleeves", "three quarter sleeves" → normalize to "Three-Quarter"
- Neckline words: "v-neck", "scoop neck", "round neck", "boat neck", "off-shoulder" → necklines: [NecklineType]
  **CRITICAL: Normalize neckline synonyms to standard ontology terms:**
  * "scoop neck", "scoopneck" → normalize to "Scoop"
  * "round neck", "roundneck" → normalize to "Round"
  * "v-neck", "v neck" → normalize to "V-Neck"
  * "boat neck", "boatneck" → normalize to "Boat"
- Color words: "blue", "red", "white", "black", "pink", "yellow", "green", "navy", "navy blue", "burgundy", "gray", "beige", "khaki", "charcoal", etc. → colors: [ColorName]
  **CRITICAL: Normalize color synonyms to standard ontology terms:**
  * "navy blue" (TWO WORDS) → MUST normalize to "Navy Blue" (check dictionary - "Navy Blue" exists, NOT "Navy" or "Blue")
  * "navy" (ONE WORD) → normalize to "Navy Blue" OR "Navy" (prefer "Navy Blue" if context suggests it, otherwise use "Navy")
  * "burgundy" → MUST normalize to "Burgundy" (check dictionary - "Burgundy" exists)
  * "burgundy red" → normalize to "Burgundy" (synonym = direct interpretation)
  * **CRITICAL**: When user says "navy blue" (two words), you MUST extract colors: { values: ["Navy Blue"], intent: "required" } - NOT "Blue" or "Navy"
  * **CRITICAL**: When user says "burgundy", you MUST extract colors: { values: ["Burgundy"], intent: "required" }
  * Always check the dictionary for the EXACT color name - use the exact value from the dictionary, not a variation
- **Rise words** (for jeans/pants): "low rise", "mid rise", "high rise", "high-waisted" → rises: [RiseType]
  **CRITICAL: Normalize rise synonyms:**
  * "high-waisted", "high waist" → normalize to "High Rise"
  * "mid-rise", "medium rise" → normalize to "Mid Rise"
  * "low-rise", "low waist" → normalize to "Low Rise"
- **Fit words**: "slim", "skinny", "straight", "relaxed", "fitted", "regular", "loose", "wide leg", "tapered" → fits: [FitType]
  * "long sleeves", "long sleeve", "long" → "Long"
  * "short sleeves", "short sleeve", "short" → "Short"
  * "three-quarter sleeves", "3/4 sleeves", "three quarter sleeves" → "Three-Quarter"
  * "cap sleeves", "cap sleeve" → "Cap"
  * "sleeveless", "no sleeves", "no sleeve" → "Sleeveless"
- Age words: "kids", "children", "toddler", "baby", "adult", "teen", "12 year old" → ageGroups: [AgeGroup]

**CRITICAL RULE**: If a constraint is explicitly mentioned in the query, you MUST extract it. Do NOT skip any explicitly mentioned constraints. When the user says "blue", extract it as a color. When they say "maxi", extract it as a length. When they say "long sleeves", extract it as sleeveLengths.

**CRITICAL: CONSTRAINT INTENT LEVELS**
Each constraint can have an intent level indicating how strongly the user wants it:

- **REQUIRED** (Hard SQL filter - products MUST match. Use for any constraint directly interpretable from query text)
  * Example: "red dress" → colors: { values: ["Red"], intent: "required" } (user directly said "red")
  * Example: "wedding dress" → occasions: { values: ["Wedding"], intent: "required" } (user directly said "wedding")
  * Example: "must be under $100" → priceMaxCents: { value: 10000, intent: "required" }

- **STRONG** (Used only when constraint is inferred/implied from context but NOT directly mentioned in query text)
  * Example: "for work" (formalityLevel inferred, not directly said) → formalityLevel: { values: ["Professional"], intent: "strong" }
  * Example: "professional look" (style inferred from context) → styles: { values: ["Professional"], intent: "strong" }

- **PREFERRED** ("mildly wants", "would like", "if possible", "maybe", "could be")
  * Example: "maybe something in blue" → colors: { values: ["Blue"], intent: "preferred" }

- **EXCLUDED** ("does not want", "not", "avoid", "no", "without", "don't want")
  * Example: "not floral" → patterns: { values: ["Floral"], intent: "excluded" }
  * Example: "avoid silk" → materials: { values: ["Silk"], intent: "excluded" }

**CRITICAL: DEFAULT RULES FOR INTENT ASSIGNMENT - APPLIES TO ALL CONSTRAINT TYPES**
Use these standardized rules for ALL constraint types (colors, occasions, materials, lengths, sleeveLengths, necklines, patterns, styles, sizes, fits, formalityLevel, seasons, etc.):

1. **DIRECTLY INTERPRETABLE FROM QUERY → ALWAYS "required" (Hard SQL filter)**
   - **ABSOLUTE RULE**: If the user's query text contains words/phrases that can be directly mapped to a constraint value, use intent: "required"
   - This applies universally to ALL constraint types - NO EXCEPTIONS
   - Examples (ALL must be "required"):
     * "red dress" → colors: { values: ["Red"], intent: "required" } ✅
     * "wedding dress" OR "attending a wedding" → occasions: { values: ["Wedding"], intent: "required" } ✅
     * "floral maxi dress" → patterns: { values: ["Floral"], intent: "required" } AND lengths: { values: ["Maxi"], intent: "required" } ✅
     * "cotton shirt" → materials: { values: ["Cotton"], intent: "required" } ✅
     * "long sleeve top" OR "long sleeve t-shirt" → sleeveLengths: { values: ["Long"], intent: "required" } ✅
     * "v-neck dress" → necklines: { values: ["V-Neck"], intent: "required" } ✅
     * "for beach" → occasions: { values: ["Beach"], intent: "required" } ✅
     * "summer dress" → seasons: { values: ["Summer"], intent: "required" } ✅
     * "formal dress" → formalityLevel: { values: ["Formal"], intent: "required" } ✅
   - **ONLY exception**: Use "strong" or "preferred" if the user explicitly uses softening language (e.g., "something floral", "floral or similar", "maybe floral")
   - **NO other exceptions**: If the constraint can be directly interpreted from query text, it's ALWAYS "required"

2. **VAGUE/SUGGESTIVE → "preferred"**
   - Vague language: "maybe", "could be", "if possible", "something like"
   - Example: "maybe something blue" → colors: { values: ["Blue"], intent: "preferred" }

3. **NEGATIVE → "excluded"**
   - Negative language: "not", "avoid", "no", "without", "don't want"
   - Example: "not floral" → patterns: { values: ["Floral"], intent: "excluded" }

4. **INFERRED/IMPLIED (not directly mentioned) → "strong"**
  - When constraint is inferred from context but not directly stated in query
  - Example: "for work" (formalityLevel inferred, not explicitly mentioned) → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "work" context, mapped to "Formal" dictionary value)
  - Example: "i am joining office next month, suggest me a dress" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "office" context, mapped to "Formal" dictionary value, user did NOT say "formal")

**REMEMBER**: The default for any directly interpretable constraint is ALWAYS "required", not "strong". "Strong" is only for inferred/implied constraints that are NOT explicitly mentioned in the query text.

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

**COLORS** - Product color/appearance values. Match user color mentions (e.g., "blue", "red", "navy") to these exact dictionary values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('colors', classifiedCategories)
  : formatDictionaryForPrompt('colors', 100)}

**MATERIALS** - Fabric/material composition. Match user mentions (e.g., "cotton", "silk", "linen", "breathable") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('materials', classifiedCategories)
  : formatDictionaryForPrompt('materials', 100)}

**OCCASIONS** - Events/situations where the product is appropriate. Match user mentions (e.g., "beach", "wedding", "work", "vacation") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('occasions', classifiedCategories)
  : formatDictionaryForPrompt('occasions', 100)}

**STYLES** - Aesthetic/style descriptors (e.g., "A-Line", "Wrap", "Romantic", "Casual"). Match user style mentions to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('styles', classifiedCategories)
  : formatDictionaryForPrompt('styles', 100)}

**PATTERNS** - Pattern/print types (e.g., "Floral", "Striped", "Polka Dot"). Match user pattern mentions to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('patterns', classifiedCategories)
  : formatDictionaryForPrompt('patterns', 100)}

**SIZES** - Product size values (e.g., "S", "M", "L", "4", "6", "8"). Match user size mentions to these exact values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('sizes', classifiedCategories)
  : formatDictionaryForPrompt('sizes', 100)}

**LENGTHS** - Dress/skirt/pant length types (e.g., "Mini", "Midi", "Maxi"). Match user length mentions (e.g., "maxi dress", "knee-length", "long dress") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('lengths', classifiedCategories)
  : formatDictionaryForPrompt('lengths', 100)}

**FORMALITY LEVEL** - Dress code formality (e.g., "Casual", "Semi-Formal", "Formal"). Match user mentions (e.g., "formal", "casual", "wedding") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('formalityLevel', classifiedCategories)
  : formatDictionaryForPrompt('formalityLevel', 100)}

**FITS** - Fit/style types for pants/jeans (e.g., "Slim", "Relaxed", "Skinny", "Regular"). Match user fit mentions to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('fits', classifiedCategories)
  : formatDictionaryForPrompt('fits', 100)}

**RISES** - Waist/rise placement for pants (e.g., "Low Rise", "Mid Rise", "High Rise"). Match user mentions (e.g., "high-waisted", "low-rise") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('rises', classifiedCategories)
  : formatDictionaryForPrompt('rises', 100)}

**NECKLINES** - Neckline types (e.g., "V-Neck", "Round", "Scoop", "Bardot", "High"). Match user mentions (e.g., "v-neck", "scoop neck", "round neck", "off-shoulder") to these values:
**CRITICAL SYNONYM MAPPING FOR NECKLINES:**
- "scoop neck", "scoopneck" → "Scoop" (REQUIRED intent - direct interpretation)
- "round neck", "roundneck" → "Round" (REQUIRED intent - direct interpretation)
- "v-neck", "v neck" → "V-Neck" (REQUIRED intent - direct interpretation)
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('necklines', classifiedCategories)
  : formatDictionaryForPrompt('necklines', 100)}

**SLEEVE LENGTHS** - Sleeve types (e.g., "Long", "Short", "Sleeveless", "Three-Quarter", "Cap"). Match user mentions (e.g., "long sleeves", "sleeveless", "cap sleeve") to these exact dictionary values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('sleeveLengths', classifiedCategories)
  : formatDictionaryForPrompt('sleeveLengths', 100)}

**COLLECTIONS** - Product collection names. Match user collection mentions to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('collections', classifiedCategories)
  : formatDictionaryForPrompt('collections', 100)}

**SEASONS** - Seasonal appropriateness (e.g., "Spring", "Summer", "Fall", "Winter"). Match user mentions (e.g., "summer", "winter", "warm weather") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('seasons', classifiedCategories)
  : formatDictionaryForPrompt('seasons', 100)}

**COLOR SHADE** - Color lightness/darkness (e.g., "Light", "Medium", "Dark"). Match user mentions (e.g., "light blue", "dark navy") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('colorShade', classifiedCategories)
  : formatDictionaryForPrompt('colorShade', 100)}

**COLOR UNDERTONE** - Color temperature (e.g., "Warm", "Cool", "Neutral"). Match user mentions (e.g., "warm tones", "cool colors") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('colorUndertone', classifiedCategories)
  : formatDictionaryForPrompt('colorUndertone', 100)}

**EMBELLISHMENTS** - Decorative details (e.g., "Lace", "Beading", "Sequins"). Match user mentions to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('embellishments', classifiedCategories)
  : formatDictionaryForPrompt('embellishments', 100)}

**SEASONAL PALETTE** - Seasonal color/style palettes. Match user seasonal style mentions to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('seasonalPalette', classifiedCategories)
  : formatDictionaryForPrompt('seasonalPalette', 100)}

**INCLUSIVITY SIZING** - Body type/size inclusivity tags (e.g., "Plus Size", "Petite", "Tall", "Extended Sizes", "Standard Sizing"). Match user body type mentions (e.g., "curvy", "plus size", "petite", "tall") to these values:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('inclusivitySizing', classifiedCategories)
  : formatDictionaryForPrompt('inclusivitySizing', 100)}

**SET VS SINGLE** - Product type indicator. Available values: "Set" (for pack/multi-item products), "Single" (for individual items). Match user mentions:
${formatCategoryConstraint && classifiedCategories && classifiedCategories.length > 0
  ? formatCategoryConstraint('setVsSingle', classifiedCategories)
  : formatDictionaryForPrompt('setVsSingle', 100)}

**CRITICAL: DICTIONARY-BASED CONSTRAINT EXTRACTION WITH FLEXIBLE MATCHING**

You MUST extract constraints by matching user queries to the dictionary values shown above. Use FLEXIBLE, ACCOMMODATING matching - be generous with variations, typos, and synonyms.

**GENERAL PRINCIPLE**: When in doubt, MATCH. If a user term is reasonably close to a dictionary value (after normalization, fuzzy matching, or semantic similarity), extract it as a constraint with "required" intent. This applies to ALL constraint types (colors, materials, occasions, styles, patterns, lengths, sleeveLengths, necklines, fits, rises, formalityLevel, seasons, sizes, embellishments, collections) and ALL dictionary values. Do NOT require perfect exact matches - be accommodating and flexible.

**MATCHING PRIORITY (APPLY IN ORDER, BE FLEXIBLE AT EACH STEP)**:

1. **FLEXIBLE EXACT MATCHING**: Check if the user's term matches a dictionary value after normalization (case-insensitive, ignore hyphens/spaces/punctuation)
   - Normalize both user term and dictionary values: lowercase, remove hyphens/spaces/punctuation
   - "maxi dress" → lengths: ["Maxi"] ✅ (normalized: "maxi" = "maxi")
   - "v-neck" / "v neck" / "vneck" → necklines: ["V-Neck"] ✅ (normalized: "vneck" = "vneck")
   - "a-line" / "aline" / "a line" → styles: ["A-Line"] ✅ (normalized: "aline" = "aline")
   - "empire waist" / "empire" → styles: ["Empire"] ✅ (normalized: "empire" = "empire")
   - "fit and flare" / "fit n flare" / "fitandflare" → styles: ["Fit and Flare"] ✅ (normalized: "fitandflare" = "fitandflare")

2. **FUZZY/SEMANTIC MATCHING**: If normalized exact match fails, use fuzzy matching (80%+ similarity, contains key words, semantic similarity)
   - Check if user term contains key words from dictionary value (e.g., "aline" contains "line" → matches "A-Line")
   - Check if dictionary value contains key words from user term (e.g., "A-Line" contains "line" → matches "aline")
   - Check for common abbreviations and variations (e.g., "3/4" → "Three-Quarter", "empire waste" → "Empire" [typo])
   - "full sleeves" → sleeveLengths: ["Long"] ✅ (semantic: full sleeves = long sleeves)
   - "knee-length" / "knee length" → lengths: ["Midi"] ✅ (semantic: knee-length = midi)
   - "ankle-length" / "ankle length" → lengths: ["Maxi"] ✅ (semantic: ankle-length = maxi)
   - "scoop neck" / "scoopneck" → necklines: ["Scoop"] ✅ (semantic match)
   - "round neck" / "roundneck" → necklines: ["Round"] ✅ (semantic match)

**CRITICAL**: Be ACCOMMODATING - if a user term is "close enough" to a dictionary value (after normalization and fuzzy matching), extract it. Err on the side of matching rather than missing constraints. This applies to ALL constraint types and ALL dictionary values.

3. **CONTEXTUAL INFERENCE**: For queries like "dresses for curvy women", infer constraints from context and map to dictionary:
   - **SET VS SINGLE EXTRACTION** - Extract pack/set mentions as setVsSingle constraint (HARD SQL filter):
     * Match user terms like "pack", "bundle", "set", "multi", "pair", "3-pack", "4-pack", "5-pack", "6-pack", "multi-pack", "value pack", "starter pack" → setVsSingle: { values: ["Set"], intent: "required" }
     * If user mentions pack-related terms explicitly, extract "Set". Otherwise, do NOT extract this constraint (system defaults to "Single").
     * Examples:
       - "I want a 3-pack of t-shirts" → setVsSingle: { values: ["Set"], intent: "required" }
       - "show me t-shirt bundles" → setVsSingle: { values: ["Set"], intent: "required" }
       - "I need a dress" → setVsSingle: null (not extracted, defaults to "Single")
   - **BODY TYPE EXTRACTION** - Extract body type mentions as inclusivitySizing constraint (HARD SQL filter - OR filter):
     * Match user terms like "curvy", "curvy women", "curvy mom", "fat", "overweight", "plus size", "larger size", "bigger size" → match to "Plus Size" in inclusivitySizing dictionary → inclusivitySizing: { values: ["Plus Size"], intent: "required" }
     * Match user terms like "petite", "small frame" → match to "Petite" in inclusivitySizing dictionary → inclusivitySizing: { values: ["Petite"], intent: "required" }
     * Match user terms like "tall", "long torso" → match to "Tall" in inclusivitySizing dictionary → inclusivitySizing: { values: ["Tall"], intent: "required" }
     * Match user terms like "extended sizes" → match to "Extended Sizes" in inclusivitySizing dictionary → inclusivitySizing: { values: ["Extended Sizes"], intent: "required" }
   - **IMPORTANT**: Body type mentions are HARD FILTERS - extract with "required" intent for SQL-level OR filtering (products matching ANY value in the inclusivitySizing array)
   - **SYNONYM MATCHING**: Use semantic similarity to map user terms to dictionary values (e.g., "curvy" → "Plus Size", "petite" → "Petite")

4. **STYLE INFERENCE RULES**: When inferring styles for body types/occasions:
   - **PRIMARY**: Extract body type mentions as inclusivitySizing first (see rule 3 above) - use dictionary matching
   - **STYLE MAPPING**: For style preferences (not body type), map to styles dictionary:
     * "formal event" → styles: ["Elegant", "Classic", "Formal"] (from styles dictionary)
     * "casual" → styles: ["Casual", "Bohemian", "Sporty"] (from styles dictionary)

5. **MULTIPLE SOURCE MATCHING**: Some constraints can come from multiple sources - use ALL relevant dictionary values:
   - Styles can come from: style_labels (attributes) AND silhouetteCut (column) - both are in the styles dictionary
   - Seasons can come from: season (column), seasonalCues (column), seasonalPalette (column) - check all season-related dictionaries

**INTENT-BASED MATCHING RULES:**
- **REQUIRED intent** → **CRITICAL: Use "required" when the user EXPLICITLY mentions a constraint value, even without words like "only" or "must"**
  - Examples: "floral dress", "blue shirt", "maxi dress", "cotton top" → REQUIRED (user explicitly stated the attribute)
  - Explicit keywords: "only wants", "must be", "only", "just", "exactly", "specifically" → REQUIRED
  - **Conservative**: Use EXACT dictionary match only. Do NOT include similar values.
- **STRONG intent** ("preferably", "or similar", "ideally", "would prefer", "something with X") → **Moderate**: Use exact match + 1-2 semantically similar values from dictionary
- **PREFERRED intent** ("maybe", "could be", "something like", "if possible") → **Relaxed**: Use exact match + all semantically similar values from dictionary
- **EXCLUDED intent** ("not", "avoid", "no", "without", "don't want") → **Exclude**: Filter out products matching these dictionary values

**CRITICAL INTENT ASSIGNMENT RULE - APPLIES TO ALL CONSTRAINT TYPES:**
- **EXPLICITLY MENTIONED/INTERPRETABLE FROM QUERY → ALWAYS "required" WITH INTENT FORMAT**
  - **ABSOLUTE RULE**: If ANY constraint value can be directly interpreted from the user's query text (including synonyms), it MUST be:
    1. Marked as "required" intent
    2. Returned in INTENT FORMAT: { values: [...], intent: "required" } (NOT as a plain array)
  - This applies to ALL constraint types: colors, patterns, materials, occasions, lengths, sleeveLengths, necklines, styles, sizes, fits, formalityLevel, seasons, etc.
  - **CRITICAL**: Synonyms are DIRECT interpretations → MUST use intent format with "required" intent
  - Examples of explicit mentions that MUST be "required" WITH INTENT FORMAT:
    * "floral dress" → patterns: { values: ["Floral"], intent: "required" } ✅ (NOT patterns: ["Floral"])
    * "blue shirt" → colors: { values: ["Blue"], intent: "required" } ✅ (NOT colors: ["Blue"])
    * "maxi dress" → lengths: { values: ["Maxi"], intent: "required" } ✅ (NOT lengths: ["Maxi"])
    * "cotton top" → materials: { values: ["Cotton"], intent: "required" } ✅ (NOT materials: ["Cotton"])
    * "long sleeve t-shirt" → sleeveLengths: { values: ["Long"], intent: "required" } ✅ (NOT sleeveLengths: ["Long"])
    * "full sleeve top" → sleeveLengths: { values: ["Long"], intent: "required" } ✅ (synonym = direct interpretation: "full sleeve" = "Long")
    * "cap sleeve dress" → sleeveLengths: { values: ["Cap"], intent: "required" } ✅ (synonym = direct interpretation: "cap sleeve" = "Cap")
    * "v-neck dress" → necklines: { values: ["V-Neck"], intent: "required" } ✅ (NOT necklines: ["V-Neck"])
    * "scoop neck blouse" → necklines: { values: ["Scoop"], intent: "required" } ✅ (synonym = direct interpretation, NOT necklines: ["Scoop"])
    * "round neck top" → necklines: { values: ["Round"], intent: "required" } ✅ (synonym = direct interpretation)
    * "empire waist dresses" → styles: { values: ["Empire"], intent: "required" } ✅ (synonym = direct interpretation: "empire waist" → "Empire")
    * "fit and flare style dresses" → styles: { values: ["Fit and Flare"], intent: "required" } ✅ (synonym = direct interpretation, NOT styles: ["Fit and Flare"])
    * "a-line dress" → styles: { values: ["A-Line"], intent: "required" } ✅ (NOT styles: ["A-Line"])
    * "wedding dress" OR "attending a wedding" → occasions: { values: ["Wedding"], intent: "required" } ✅ (NOT occasions: ["Wedding"])
    * "for beach" → occasions: { values: ["Beach"], intent: "required" } ✅ (NOT occasions: ["Beach"])
    * "summer dress" → seasons: { values: ["Summer"], intent: "required" } ✅ (NOT seasons: ["Summer"])
    * "formal dress" → formalityLevel: { values: ["Formal"], intent: "required" } ✅ (NOT formalityLevel: ["Formal"])
  - **ONLY exception**: Use "strong" or "preferred" if the user explicitly uses softening language (e.g., "something floral", "floral or similar", "maybe floral", "could be blue")
  - **NO other exceptions**: If the constraint is directly interpretable from query text (including synonyms), it's ALWAYS "required" WITH INTENT FORMAT

- **INFERRED constraints (NOT explicitly mentioned) → Use "strong" or "preferred" intent**
  - **CRITICAL**: Inferred constraints (e.g., colors/styles/lengths inferred from "black tie wedding" context) should NOT be marked as "required" unless you are 95%+ confident the user absolutely needs them
  - **Rule of thumb**: If the user didn't explicitly say it, use "strong" (preferable) or "preferred" (acceptable alternatives), NOT "required" (hard filter)
  - **CRITICAL**: You MUST extract inferred constraints when context strongly suggests them, even if not explicitly mentioned
  - **ABSOLUTE RULE FOR COLORS**: Colors that are INFERRED (not explicitly mentioned in query text) MUST ALWAYS be "strong" intent, NEVER "required"
    - If the user did NOT say the color word(s) in their query, the color is INFERRED → use "strong" intent
    - Only colors that appear as actual words in the user's query can be "required"
    - **VERIFICATION**: Before marking a color as "required", verify: "Did the user explicitly say this color word?" If NO → use "strong"
  - **Examples of inferred constraints:**
    - "black tie wedding" → colors: Black, Ivory, Gold (INFERRED from "black tie" context, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" (user did NOT say "black", "ivory", or "gold")
    - "beach vacation" → colors: White, Yellow, Coral (INFERRED from "beach" context, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" (user did NOT say these colors)
    - "dress for winter" → colors: Burgundy, Navy, Plum (INFERRED from "winter" context, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" (user did NOT say these colors)
    - "black tie wedding" → styles: Elegant, Formal (INFERRED from "black tie" context, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required"
    - "black tie wedding" → sleeveLengths: Long (INFERRED from formal context, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required"
    - "dress for winter" → seasons: Winter (EXPLICITLY mentioned "winter") → intent: "required" ✅
    - "dress for winter" → sleeveLengths: Long (INFERRED from "winter" context - winter typically needs long sleeves for warmth, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" - **YOU MUST EXTRACT THIS**
    - "dress for winter" → materials: Wool, Cashmere (INFERRED from "winter" context - winter typically needs warm materials, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" - **YOU MUST EXTRACT THIS**
    - "something cozy and warm for cold weather" → materials: Wool, Cashmere (INFERRED from "cozy/warm" context - cozy/warm typically means wool/cashmere, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" - **YOU MUST EXTRACT THIS**
    - "something cozy and warm for cold weather" → sleeveLengths: Long (INFERRED from "cold weather" context - cold weather typically needs long sleeves, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" - **YOU MUST EXTRACT THIS**
    - "beach vacation" → occasions: Beach (EXPLICITLY mentioned "beach") → intent: "required" ✅
    - "beach vacation" → colors: Light, Bright (INFERRED from "beach" context, NOT explicitly mentioned) → intent: "strong" ❌ NOT "required" (user did NOT say "light" or "bright")
  - **Exception**: Only use "required" for inferred constraints if you are 95%+ confident (e.g., "black tie" ALWAYS requires formal dress code, but even then, colors/styles are still preferences, not requirements)
  - **NO EXCEPTION FOR COLORS**: Colors are NEVER "required" if they are inferred - they are ALWAYS "strong" when inferred

- **Examples:**
  - "floral dress" → patterns: { values: ["Floral"], intent: "required" } ✅ (explicit mention)
  - "something for the beach, floral" → patterns: { values: ["Floral"], intent: "required" } ✅ (explicit mention)
  - "red dress" → colors: { values: ["Red"], intent: "required" } ✅ (explicit mention - user said "red")
  - "blue maxi dress" → colors: { values: ["Blue"], intent: "required" } ✅ (explicit mention - user said "blue")
  - "attending a black tie wedding, suggest me a dress" → occasions: { values: ["Wedding"], intent: "required" } ✅ (explicitly mentioned "wedding")
  - "attending a black tie wedding, suggest me a dress" → colors: { values: ["Black", "Ivory", "Gold"], intent: "strong" } ✅ (inferred from "black tie" context, user did NOT say "black", "ivory", or "gold" - MUST be "strong", NEVER "required")
  - "beach vacation outfit" → colors: { values: ["White", "Yellow", "Coral"], intent: "strong" } ✅ (inferred from "beach" context, user did NOT say these colors - MUST be "strong", NEVER "required")
  - "dress for winter" → colors: { values: ["Burgundy", "Navy", "Plum"], intent: "strong" } ✅ (inferred from "winter" context, user did NOT say these colors - MUST be "strong", NEVER "required")
  - "attending a black tie wedding, suggest me a dress" → styles: { values: ["Elegant", "Formal"], intent: "strong" } ✅ (inferred from "black tie" context, NOT "required")
  - "attending a black tie wedding, suggest me a dress" → sleeveLengths: { values: ["Long"], intent: "strong" } ✅ (inferred from formal context, NOT "required")
  - "floral or similar" → patterns: { values: ["Floral", "Polka Dot"], intent: "strong" } ✅ (softening language)
  - "something with pattern" → patterns: { values: ["Floral", "Polka Dot", ...], intent: "preferred" } ✅ (vague)

**MATCHING EXAMPLES:**

Patterns:
- "floral dress" (REQUIRED) → patterns: { values: ["Floral"], intent: "required" } ✅ (explicit mention, no softening language)
- "only floral dresses" (REQUIRED) → patterns: { values: ["Floral"], intent: "required" } ✅ (explicit mention + "only")
- "something for the beach, floral" (REQUIRED) → patterns: { values: ["Floral"], intent: "required" } ✅ (explicit mention)
- "floral or similar patterns" (STRONG) → patterns: { values: ["Floral", "Polka Dot"], intent: "strong" } (softening: "or similar")
- "something with pattern" (PREFERRED) → patterns: { values: ["Floral", "Polka Dot", "Striped", "Gingham", "Plaid", "Tie-Dye"], intent: "preferred" } (vague: "something with")
- "not floral" (EXCLUDED) → patterns: { values: ["Floral"], intent: "excluded" }

Colors:
- "red dress" (REQUIRED) → colors: { values: ["Red"], intent: "required" } ✅ (explicit mention - user said "red")
- "only red" (REQUIRED) → colors: { values: ["Red"], intent: "required" } ✅ (explicit mention + "only" - user said "red")
- "blue maxi dress" (REQUIRED) → colors: { values: ["Blue"], intent: "required" } ✅ (explicit mention - user said "blue")
- "white cardigan" (REQUIRED) → colors: { values: ["White"], intent: "required" } ✅ (explicit mention - user said "white")
- "red or similar" (STRONG) → colors: { values: ["Red", "Burgundy"], intent: "strong" } (softening: "or similar")
- "maybe something red" (PREFERRED) → colors: { values: ["Red", "Burgundy", "Coral", "Pink"], intent: "preferred" } (softening: "maybe")
- "not red" (EXCLUDED) → colors: { values: ["Red"], intent: "excluded" }
- **INFERRED COLORS (MUST BE "strong", NEVER "required")**:
  - "black tie wedding" → colors: { values: ["Black", "Ivory", "Gold"], intent: "strong" } ✅ (inferred from "black tie" context, user did NOT say "black", "ivory", or "gold")
  - "beach vacation" → colors: { values: ["White", "Yellow", "Coral"], intent: "strong" } ✅ (inferred from "beach" context, user did NOT say these colors)
  - "dress for winter" → colors: { values: ["Burgundy", "Navy", "Plum"], intent: "strong" } ✅ (inferred from "winter" context, user did NOT say these colors)
  - "wheatish skin" → colors: { values: ["Burgundy", "Emerald", "Navy"], intent: "strong" } ✅ (inferred from skin tone context, user did NOT say these colors)
  - "sunny day" → colors: { values: ["White", "Yellow", "Sky Blue"], intent: "strong" } ✅ (inferred from weather context, user did NOT say these colors)
  - "indian wedding" → colors: { values: ["Red", "Gold", "Maroon"], intent: "strong" } ✅ (inferred from cultural context, user did NOT say these colors)

Materials:
- "cotton shirt" (REQUIRED) → materials: { values: ["Cotton"], intent: "required" } ✅ (explicit mention)
- "only cotton" (REQUIRED) → materials: { values: ["Cotton"], intent: "required" } ✅ (explicit mention + "only")
- "cotton or similar" (STRONG) → materials: { values: ["Cotton", "Linen"], intent: "strong" } (softening: "or similar")
- "something breathable" (PREFERRED) → materials: { values: ["Cotton", "Linen", "Modal"], intent: "preferred" } (vague: indirect mention)
- "not silk" (EXCLUDED) → materials: { values: ["Silk"], intent: "excluded" }

Occasions:
- "only beach" (REQUIRED) → occasions: { values: ["Beach"], intent: "required" } (exact match only)
- "attending a black tie wedding" (REQUIRED) → occasions: { values: ["Wedding"], intent: "required" } ✅ (explicitly mentioned "wedding")
- "beach or similar" (STRONG) → occasions: { values: ["Beach", "Vacation"], intent: "strong" } (exact + 1-2 similar)
- "something for vacation" (PREFERRED) → occasions: { values: ["Beach", "Vacation", "Resort"], intent: "preferred" } (exact + all similar)
- "not formal" (EXCLUDED) → occasions: { values: ["Formal"], intent: "excluded" }

**CRITICAL: CONTEXT-BASED OCCASION EXTRACTION - OFFICE/WORK CONTEXTS**
You MUST extract occasions from context, not just explicit mentions. When users mention office/work contexts, ALWAYS extract "Work" occasion:
- "i am joining office next month, suggest me a dress" → occasions: { values: ["Work"], intent: "required" } ✅ ("joining office" = Work context)
- "starting a new job, need something to wear" → occasions: { values: ["Work"], intent: "required" } ✅ ("new job" = Work context)
- "dress for office" → occasions: { values: ["Work"], intent: "required" } ✅ ("office" = Work context)
- "for work" → occasions: { values: ["Work"], intent: "required" } ✅ ("work" = Work context)
- "office attire" → occasions: { values: ["Work"], intent: "required" } ✅ ("office attire" = Work context)
- "professional outfit" → occasions: { values: ["Work"], intent: "strong" } ✅ (inferred from "professional")
- "business casual" → occasions: { values: ["Work"], intent: "strong" } ✅ (inferred from "business")

**CRITICAL: FORMALITY LEVEL INFERENCE FOR OFFICE/WORK CONTEXTS**
You MUST infer formalityLevel from office/work contexts, even when not explicitly mentioned. Office/work contexts imply professional formal attire. **IMPORTANT**: Map to actual dictionary values - use "Formal" for office/work contexts (NOT "Professional" or "Semi-Formal" which doesn't match office formality):
- "i am joining office next month, suggest me a dress" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "office" context, mapped to "Formal" - office wear is formal professional attire)
- "starting a new job, need something to wear" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "new job" context, mapped to "Formal")
- "dress for office" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "office" context, mapped to "Formal")
- "for work" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "work" context, mapped to "Formal")
- "office attire" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "office attire" context, mapped to "Formal")
- "professional outfit" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "professional" context, mapped to "Formal")
- "business casual" → formalityLevel: { values: ["Casual"], intent: "strong" } ✅ (inferred from "business casual" context, mapped to "Casual" - explicit exception)
- "formal office" or "black tie" → formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "formal" context, mapped to "Formal")
- **ABSOLUTE RULE**: Office/work contexts ALWAYS imply formal professional attire - extract formalityLevel: "Formal" with "strong" intent when office/work is mentioned, even if the user doesn't explicitly say "professional" or "formal"
- **CRITICAL**: Only use dictionary values: "Casual", "Semi-Formal", "Formal" - do NOT use "Professional" or other non-dictionary values

**CRITICAL: OCCASION CONTEXT MAPPING**
Map common phrases to occasion values:
- "office", "joining office", "starting work", "new job", "workplace", "business" → occasions: ["Work"]
- "wedding", "attending wedding", "bride", "bridal" → occasions: ["Wedding"]
- "beach", "vacation", "resort", "tropical" → occasions: ["Beach", "Vacation"]
- "party", "night out", "date night" → occasions: ["Party", "Date Night"]
- "gym", "workout", "athletic", "exercise" → occasions: ["Gym", "Athletic"]
- "casual", "everyday", "daytime" → occasions: ["Casual", "Daytime"]
- "formal", "black tie", "gala" → occasions: ["Formal"]

**CRITICAL: INFERRED CONSTRAINTS FROM OCCASIONS/CONTEXT:**
- "attending a black tie wedding, suggest me a dress" → 
  - occasions: { values: ["Wedding"], intent: "required" } ✅ (explicitly mentioned "wedding")
  - formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "black tie" context, will be SQL filtered)
  - colors: { values: ["Black", "Ivory", "Gold"], intent: "strong" } ❌ NOT "required" (inferred from "black tie" context)
  - styles: { values: ["Elegant", "Formal"], intent: "strong" } ❌ NOT "required" (inferred from "black tie" context)
  - sleeveLengths: { values: ["Long"], intent: "strong" } ❌ NOT "required" (inferred from formal context)
  - embellishments: { values: ["Lace", "Sequins"], intent: "strong" } ❌ NOT "required" (inferred from formal context)
  - necklines: { values: ["V-Neck", "Round"], intent: "strong" } ❌ NOT "required" (inferred from formal context)
- "i am joining office next month, suggest me a dress" → 
  - occasions: { values: ["Work"], intent: "required" } ✅ (explicitly mentioned "office" = Work context)
  - formalityLevel: { values: ["Formal"], intent: "strong" } ✅ (inferred from "office" context, will be SQL filtered)
  - colors: { values: ["White", "Beige", "Navy Blue", "Black", "Gray"], intent: "strong" } ❌ NOT "required" (inferred from office context)
- "beach vacation" → 
  - occasions: { values: ["Beach", "Vacation"], intent: "required" } ✅ (explicitly mentioned)
  - colors: { values: ["Light", "Bright"], intent: "strong" } ❌ NOT "required" (inferred from "beach" context)
  - materials: { values: ["Cotton", "Linen"], intent: "strong" } ❌ NOT "required" (inferred from "beach" context)

Sizes:
- "only size 4" (REQUIRED) → sizes: { values: ["4"], intent: "required" } (exact match only)
- "size 4 or similar" (STRONG) → sizes: { values: ["4", "6"], intent: "strong" } (exact + 1-2 similar)
- "around size 4" (PREFERRED) → sizes: { values: ["4", "6", "2"], intent: "preferred" } (exact + all similar)

Lengths:
- "only maxi" (REQUIRED) → lengths: { values: ["Maxi"], intent: "required" } (exact match only)
- "maxi or similar" (STRONG) → lengths: { values: ["Maxi", "Midi"], intent: "strong" } (exact + 1-2 similar)
- "long dresses" (PREFERRED) → lengths: { values: ["Maxi", "Midi"], intent: "preferred" } (exact + all similar)

SleeveLengths:
- "long sleeve t-shirt" (REQUIRED) → sleeveLengths: { values: ["Long"], intent: "required" } ✅ (explicitly mentioned "long sleeve" → maps to "Long" in dictionary)
- "full sleeve top" (REQUIRED) → sleeveLengths: { values: ["Long"], intent: "required" } ✅ (synonym = direct interpretation: "full sleeve" → "Long")
- "cap sleeve dress" (REQUIRED) → sleeveLengths: { values: ["Cap"], intent: "required" } ✅ (synonym = direct interpretation: "cap sleeve" → "Cap")
- "short sleeve dress" (REQUIRED) → sleeveLengths: { values: ["Short"], intent: "required" } ✅ (explicitly mentioned "short sleeve" → maps to "Short" in dictionary)
- "sleeveless top" (REQUIRED) → sleeveLengths: { values: ["Sleeveless"], intent: "required" } ✅ (explicitly mentioned "sleeveless" → maps to "Sleeveless" in dictionary)
- "dress for winter" (INFERRED) → sleeveLengths: { values: ["Long"], intent: "strong" } ❌ (inferred from "winter" context, NOT explicitly mentioned)
- "dress for modest occasion" (INFERRED) → sleeveLengths: { values: ["Long"], intent: "strong" } ❌ (inferred from "modest" context, NOT explicitly mentioned)
- "long sleeve or similar" (STRONG) → sleeveLengths: { values: ["Long", "Three-Quarter"], intent: "strong" } (softening: "or similar")
- "maybe something with sleeves" (PREFERRED) → sleeveLengths: { values: ["Long", "Short", "Three-Quarter"], intent: "preferred" } (vague: "maybe something with")

Lengths:
- "maxi dress" (REQUIRED) → lengths: { values: ["Maxi"], intent: "required" } ✅ (explicitly mentioned "maxi")
- "ankle-length dress" (REQUIRED) → lengths: { values: ["Maxi"], intent: "required" } ✅ (synonym = direct interpretation)
- "knee-length skirt" (REQUIRED) → lengths: { values: ["Midi"], intent: "required" } ✅ (synonym = direct interpretation)
- "mini dress" (REQUIRED) → lengths: { values: ["Mini"], intent: "required" } ✅ (explicitly mentioned "mini")
- "dress for formal event" (INFERRED) → lengths: { values: ["Maxi", "Midi"], intent: "strong" } ❌ (inferred from "formal" context, NOT explicitly mentioned)
- "dress for modest occasion" (INFERRED) → lengths: { values: ["Maxi", "Midi"], intent: "strong" } ❌ (inferred from "modest" context, NOT explicitly mentioned)
- "maxi or similar" (STRONG) → lengths: { values: ["Maxi", "Midi"], intent: "strong" } (softening: "or similar")
- "long dresses" (PREFERRED) → lengths: { values: ["Maxi", "Midi"], intent: "preferred" } (vague: "long" could mean multiple lengths)

Colors:
- "blue dress" (REQUIRED) → colors: { values: ["Blue"], intent: "required" } ✅ (explicitly mentioned "blue")
- "navy dress" (REQUIRED) → colors: { values: ["Navy Blue"], intent: "required" } ✅ (synonym = direct interpretation: "navy" → "Navy Blue")
- "navy blue dress" (REQUIRED) → colors: { values: ["Navy Blue"], intent: "required" } ✅ (TWO WORDS "navy blue" → MUST use "Navy Blue", NOT "Blue" or "Navy")
- "navy blue maxi dresses" (REQUIRED) → colors: { values: ["Navy Blue"], intent: "required" } ✅ (TWO WORDS "navy blue" → MUST use "Navy Blue", NOT "Blue")
- "burgundy top" (REQUIRED) → colors: { values: ["Burgundy"], intent: "required" } ✅ (explicitly mentioned "burgundy" → MUST use "Burgundy")
- "burgundy dresses please" (REQUIRED) → colors: { values: ["Burgundy"], intent: "required" } ✅ (explicitly mentioned "burgundy" → MUST use "Burgundy")
- "red shirt" (REQUIRED) → colors: { values: ["Red"], intent: "required" } ✅ (explicitly mentioned "red")
- "dress for beach" (INFERRED) → colors: { values: ["White", "Yellow", "Coral"], intent: "strong" } ❌ (inferred from "beach" context, NOT explicitly mentioned)
- "dress for winter" (INFERRED) → colors: { values: ["Navy", "Burgundy", "Black"], intent: "strong" } ❌ (inferred from "winter" context, NOT explicitly mentioned)
- "blue or similar" (STRONG) → colors: { values: ["Blue", "Navy Blue"], intent: "strong" } (softening: "or similar")
- "maybe something red" (PREFERRED) → colors: { values: ["Red", "Burgundy", "Coral", "Pink"], intent: "preferred" } (softening: "maybe")

Materials:
- "cotton shirt" (REQUIRED) → materials: { values: ["Cotton"], intent: "required" } ✅ (explicitly mentioned "cotton")
- "cotton blend top" (REQUIRED) → materials: { values: ["Cotton"], intent: "required" } ✅ (synonym = direct interpretation)
- "silk dress" (REQUIRED) → materials: { values: ["Silk"], intent: "required" } ✅ (explicitly mentioned "silk")
- "dress for beach" (INFERRED) → materials: { values: ["Cotton", "Linen"], intent: "strong" } ❌ (inferred from "beach" context, NOT explicitly mentioned)
- "dress for winter" (INFERRED) → materials: { values: ["Wool", "Cashmere"], intent: "strong" } ❌ (inferred from "winter" context, NOT explicitly mentioned)
- "cotton or similar" (STRONG) → materials: { values: ["Cotton", "Linen"], intent: "strong" } (softening: "or similar")
- "something breathable" (PREFERRED) → materials: { values: ["Cotton", "Linen", "Modal"], intent: "preferred" } (vague: indirect mention)

Necklines:
- "v-neck dress" (REQUIRED) → necklines: { values: ["V-Neck"], intent: "required" } ✅ (explicitly mentioned "v-neck")
- "I need a scoop neck blouse" (REQUIRED) → necklines: { values: ["Scoop"], intent: "required" } ✅ (synonym = direct interpretation: "scoop neck" → "Scoop", NOT necklines: ["Scoop"])
- "scoop neck blouse" (REQUIRED) → necklines: { values: ["Scoop"], intent: "required" } ✅ (synonym = direct interpretation: "scoop neck" → "Scoop")
- "show me round neck tops" (REQUIRED) → necklines: { values: ["Round"], intent: "required" } ✅ (synonym = direct interpretation: "round neck" → "Round")
- "round neck top" (REQUIRED) → necklines: { values: ["Round"], intent: "required" } ✅ (synonym = direct interpretation: "round neck" → "Round")
- "boat neck top" (REQUIRED) → necklines: { values: ["Boat"], intent: "required" } ✅ (synonym = direct interpretation)
- "off-shoulder top" (REQUIRED) → necklines: { values: ["Off-Shoulder"], intent: "required" } ✅ (explicitly mentioned "off-shoulder")
- "dress for modest occasion" (INFERRED) → necklines: { values: ["High Neck", "Round"], intent: "strong" } ❌ (inferred from "modest" context, NOT explicitly mentioned)
- "dress for formal event" (INFERRED) → necklines: { values: ["V-Neck", "Round"], intent: "strong" } ❌ (inferred from "formal" context, NOT explicitly mentioned)
- "v-neck or similar" (STRONG) → necklines: { values: ["V-Neck", "Round"], intent: "strong" } (softening: "or similar")

Styles:
- "a-line dress" (REQUIRED) → styles: { values: ["A-Line"], intent: "required" } ✅ (explicitly mentioned "a-line")
- "empire waist dresses" (REQUIRED) → styles: { values: ["Empire"], intent: "required" } ✅ (synonym = direct interpretation: "empire waist" → "Empire")
- "fit and flare style dresses" (REQUIRED) → styles: { values: ["Fit and Flare"], intent: "required" } ✅ (synonym = direct interpretation, NOT styles: ["Fit and Flare"])
- "wrap dress" (REQUIRED) → styles: { values: ["Wrap"], intent: "required" } ✅ (explicitly mentioned "wrap")
- "dress for beach" (INFERRED) → styles: { values: ["Bohemian", "Casual"], intent: "strong" } ❌ (inferred from "beach" context, NOT explicitly mentioned)
- "dress for wedding" (INFERRED) → styles: { values: ["Romantic", "Elegant"], intent: "strong" } ❌ (inferred from "wedding" context, NOT explicitly mentioned)
- "a-line or similar" (STRONG) → styles: { values: ["A-Line", "Fit and Flare"], intent: "strong" } (softening: "or similar")

Fits:
- "slim fit jeans" (REQUIRED) → fits: { values: ["Slim Fit"], intent: "required" } ✅ (explicitly mentioned "slim fit")
- "skinny jeans" (REQUIRED) → fits: { values: ["Skinny"], intent: "required" } ✅ (synonym = direct interpretation)
- "relaxed fit pants" (REQUIRED) → fits: { values: ["Relaxed Fit"], intent: "required" } ✅ (explicitly mentioned "relaxed fit")
- "comfortable pants" (INFERRED) → fits: { values: ["Relaxed Fit", "Loose Fit"], intent: "strong" } ❌ (inferred from "comfortable" context, NOT explicitly mentioned)
- "slim fit or similar" (STRONG) → fits: { values: ["Slim Fit", "Fitted"], intent: "strong" } (softening: "or similar")

Rises:
- "high-rise jeans" (REQUIRED) → rises: { values: ["High Rise"], intent: "required" } ✅ (explicitly mentioned "high-rise")
- "high-waisted pants" (REQUIRED) → rises: { values: ["High Rise"], intent: "required" } ✅ (synonym = direct interpretation)
- "mid-rise jeans" (REQUIRED) → rises: { values: ["Mid Rise"], intent: "required" } ✅ (explicitly mentioned "mid-rise")
- "comfortable jeans" (INFERRED) → rises: { values: ["Mid Rise", "High Rise"], intent: "strong" } ❌ (inferred from "comfortable" context, NOT explicitly mentioned)
- "high-rise or similar" (STRONG) → rises: { values: ["High Rise", "Mid Rise"], intent: "strong" } (softening: "or similar")

FormalityLevel:
- "formal dress" (REQUIRED) → formalityLevel: { values: ["Formal"], intent: "required" } ✅ (explicitly mentioned "formal")
- "casual outfit" (REQUIRED) → formalityLevel: { values: ["Casual"], intent: "required" } ✅ (synonym = direct interpretation)
- "semi-formal dress" (REQUIRED) → formalityLevel: { values: ["Semi-Formal"], intent: "required" } ✅ (explicitly mentioned "semi-formal")
- "dress for office" (INFERRED) → formalityLevel: { values: ["Professional", "Semi-Formal"], intent: "strong" } ❌ (inferred from "office" context, NOT explicitly mentioned)
- "dress for wedding" (INFERRED) → formalityLevel: { values: ["Formal", "Semi-Formal"], intent: "strong" } ❌ (inferred from "wedding" context, NOT explicitly mentioned)
- "formal or similar" (STRONG) → formalityLevel: { values: ["Formal", "Semi-Formal"], intent: "strong" } (softening: "or similar")

Seasons:
- "summer dress" (REQUIRED) → seasons: { values: ["Summer"], intent: "required" } ✅ (explicitly mentioned "summer")
- "winter coat" (REQUIRED) → seasons: { values: ["Winter"], intent: "required" } ✅ (synonym = direct interpretation)
- "spring collection" (REQUIRED) → seasons: { values: ["Spring"], intent: "required" } ✅ (explicitly mentioned "spring")
- "dress for beach" (INFERRED) → seasons: { values: ["Summer"], intent: "strong" } ❌ (inferred from "beach" context, NOT explicitly mentioned)
- "dress for cold weather" (INFERRED) → seasons: { values: ["Winter", "Fall"], intent: "strong" } ❌ (inferred from "cold weather" context, NOT explicitly mentioned)
- "summer or similar" (STRONG) → seasons: { values: ["Summer", "Spring"], intent: "strong" } (softening: "or similar")

Embellishments:
- "lace dress" (REQUIRED) → embellishments: { values: ["Lace"], intent: "required" } ✅ (explicitly mentioned "lace")
- "sequined top" (REQUIRED) → embellishments: { values: ["Sequins"], intent: "required" } ✅ (explicitly mentioned "sequined")
- "dress for wedding" (INFERRED) → embellishments: { values: ["Lace", "Embroidery", "Beading"], intent: "strong" } ❌ (inferred from "wedding" context, NOT explicitly mentioned)
- "lace or similar" (STRONG) → embellishments: { values: ["Lace", "Embroidery"], intent: "strong" } (softening: "or similar")

Collections:
- "spring collection" (REQUIRED) → collections: { values: ["Spring Collection"], intent: "required" } ✅ (explicitly mentioned "spring collection")
- "wedding collection" (REQUIRED) → collections: { values: ["Wedding Collection"], intent: "required" } ✅ (explicitly mentioned "wedding collection")
- "dress for spring" (INFERRED) → collections: { values: ["Spring Collection"], intent: "strong" } ❌ (inferred from "spring" context, but "spring" as season is "required")
- "spring collection or similar" (STRONG) → collections: { values: ["Spring Collection", "Summer Collection"], intent: "strong" } (softening: "or similar")

**CRITICAL: CONTEXT-BASED INFERENCE EXAMPLES (Strong/Preferred Intent):**
- "dress for winter" → materials: { values: ["Wool", "Cashmere"], intent: "strong" } ❌ (inferred from "winter" context, NOT explicitly mentioned)
- "dress for winter" → colors: { values: ["Navy", "Burgundy", "Black"], intent: "strong" } ❌ (inferred from "winter" context, NOT explicitly mentioned)
- "dress for winter" → seasons: { values: ["Winter"], intent: "required" } ✅ (explicitly mentioned "winter")
- "dress for modest occasion" → necklines: { values: ["High Neck", "Round"], intent: "strong" } ❌ (inferred from "modest" context, NOT explicitly mentioned)
- "dress for modest occasion" → sleeveLengths: { values: ["Long"], intent: "strong" } ❌ (inferred from "modest" context, NOT explicitly mentioned)
- "dress for modest occasion" → lengths: { values: ["Maxi", "Midi"], intent: "strong" } ❌ (inferred from "modest" context, NOT explicitly mentioned)
- "dress for beach" → colors: { values: ["White", "Yellow", "Coral"], intent: "strong" } ❌ (inferred from "beach" context, NOT explicitly mentioned)
- "dress for beach" → materials: { values: ["Cotton", "Linen"], intent: "strong" } ❌ (inferred from "beach" context, NOT explicitly mentioned)
- "dress for beach" → occasions: { values: ["Beach"], intent: "required" } ✅ (explicitly mentioned "beach")

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

**CRITICAL: FLEXIBLE MATCHING AND SYNONYM NORMALIZATION = DIRECT INTERPRETATION (REQUIRED INTENT)**

**ABSOLUTE RULE**: When a user uses ANY variation (synonym, typo, case variation, hyphen variation, spacing variation) that maps to a dictionary value, it is a DIRECT interpretation and MUST be marked as "required" intent, NOT "strong" or "preferred".

**FLEXIBLE MATCHING PRINCIPLES (APPLIES TO ALL CONSTRAINTS AND ALL DICTIONARY VALUES)**:

1. **CASE-INSENSITIVE MATCHING**: Dictionary matching is ALWAYS case-insensitive. "aline" = "A-Line", "aline" = "Aline", "ALINE" = "A-Line", "empire" = "Empire", "V-NECK" = "V-Neck", etc.

2. **HYPHEN/SPACING VARIATIONS**: Ignore hyphens, spaces, and punctuation when matching. "a-line" = "A-Line", "a line" = "A-Line", "aline" = "A-Line", "v-neck" = "V-Neck", "v neck" = "V-Neck", "vneck" = "V-Neck", "three-quarter" = "Three-Quarter", "three quarter" = "Three-Quarter", "threequarter" = "Three-Quarter", etc.

3. **TYPO TOLERANCE**: Be accommodating with common typos and misspellings. If a user term is "close enough" to a dictionary value (e.g., 80%+ character similarity, same root words), map it. Examples: "empire waist" → "Empire", "empire waste" → "Empire" (typo), "fit and flare" → "Fit and Flare", "fit n flare" → "Fit and Flare" (abbreviation), etc.

4. **SYNONYM RECOGNITION**: Recognize common fashion synonyms and alternative terminology. This includes:
   - Style synonyms: "empire waist" → "Empire", "a-line" / "aline" / "a line" → "A-Line", "fit and flare" / "fit n flare" → "Fit and Flare"
   - Sleeve synonyms: "full sleeve" / "full sleeves" → "Long", "cap sleeve" / "cap sleeves" → "Cap", "three-quarter" / "3/4" / "three quarter" → "Three-Quarter"
   - Length synonyms: "knee-length" / "knee length" → "Midi", "ankle-length" / "ankle length" → "Maxi", "above knee" → "Mini"
   - Color synonyms: "navy" → "Navy Blue", "burgundy" → "Burgundy", etc. (match to closest dictionary value)
   - Material synonyms: "cotton blend" → "Cotton", "silk blend" → "Silk", etc.
   - Neckline synonyms: "round neck" → "Round", "boat neck" → "Boat", "scoop neck" → "Scoop", "v-neck" / "v neck" / "vneck" → "V-Neck"
   - Fit synonyms: "slim fit" → "Slim Fit", "relaxed fit" → "Relaxed Fit", "skinny" → "Skinny"
   - Rise synonyms: "high-waisted" / "high waist" → "High Rise", "mid-rise" / "medium rise" → "Mid Rise"
   - Formality synonyms: "casual" → "Casual", "formal" → "Formal", "semi-formal" / "semi formal" → "Semi-Formal"
   - Season synonyms: "winter" → "Winter", "summer" → "Summer", "spring" → "Spring", "fall" / "autumn" → "Fall"

5. **FUZZY MATCHING LOGIC**: When exact match fails, use semantic similarity:
   - Check if user term contains key words from dictionary value (e.g., "aline" contains "line" → matches "A-Line")
   - Check if dictionary value contains key words from user term (e.g., "A-Line" contains "line" → matches "aline")
   - Check for common abbreviations and variations (e.g., "3/4" → "Three-Quarter", "v-neck" → "V-Neck")
   - If user term is 80%+ similar to a dictionary value (after normalization), consider it a match

6. **NORMALIZATION STEPS**: Before matching, normalize both user term and dictionary values:
   - Convert to lowercase
   - Remove hyphens, spaces, punctuation
   - Remove common suffixes/prefixes if needed
   - Compare normalized forms

7. **APPLIES UNIVERSALLY**: These flexible matching rules apply to ALL constraint types (colors, materials, occasions, styles, patterns, lengths, sleeveLengths, necklines, fits, rises, formalityLevel, seasons, sizes, embellishments, collections, etc.) and ALL dictionary values.

**CRITICAL**: If you can reasonably map a user term to a dictionary value using ANY of the above methods (case-insensitive, hyphen variation, typo tolerance, synonym recognition, fuzzy matching), extract it as a DIRECT interpretation with "required" intent. Be ACCOMMODATING and FLEXIBLE - err on the side of matching rather than missing constraints.

Always map user terms to the closest matching dictionary value. If multiple matches exist, prefer the most common/standard term from the dictionary.

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

  **CRITICAL: OCCASION EXTRACTION FROM CONTEXT**
  You MUST extract occasions from context clues, not just explicit mentions. Examples:
  - "i am joining office next month, suggest me a dress" → occasions: { values: ["Work"], intent: "required" } ✅
  - "starting a new job, need something professional" → occasions: { values: ["Work"], intent: "required" } ✅
  - "dress for my first day at work" → occasions: { values: ["Work"], intent: "required" } ✅
  - "attending a wedding" → occasions: { values: ["Wedding"], intent: "required" } ✅
  - "beach vacation outfit" → occasions: { values: ["Beach", "Vacation"], intent: "required" } ✅
  - "gym clothes" → occasions: { values: ["Gym", "Athletic"], intent: "required" } ✅
  
  When you see context words like "office", "work", "job", "workplace", "business", "professional", "joining office", "starting work", "new job" → ALWAYS extract occasions: { values: ["Work"], intent: "required" }

  **EXTRACTION PRINCIPLES - Think Like a Stylist:**
  
  Your goal is to understand the user's intent holistically, not just extract literal keywords. Use your knowledge of fashion, cultural contexts, geography, and human behavior to infer what the user truly wants.

  1. **Explicit constraints**: Directly mentioned values - extract these EXACTLY as mentioned
  2. **Inferred constraints**: Use semantic understanding to derive meaning from context clues
  3. **Implicit constraints**: Extract what's implied but not stated (e.g., "Bahamas" → beach/vacation/tropical context)
  4. **Negative constraints**: Extract what to avoid when clearly stated
  5. **Appropriateness constraints**: Infer what works best for the given context using fashion knowledge

  **OVERRIDE LOGIC:**
  - Explicit mentions take priority over inferred constraints
  - If user says "red dress", extract "red" as color - don't override with inferred colors
  - When constraints aren't explicitly mentioned, infer them intelligently from context

  **CONTEXTUAL THINKING - Be Open-Ended:**
  
  Consider ANY contextual information that would help a stylist understand what the user wants:
  - Geography/Locations: What does "Bahamas", "Miami", "Utah", "beach", "mountain" tell you about style, occasion, season, colors?
  - Cultural/Religious: What do "Indian wedding", "Muslim wedding", "conservative" imply about modesty, colors, styles?
  - Weather/Climate: How does "sunny", "hot", "humid", "cold" affect material, color, and style choices?
  - Events/Occasions: What's the vibe of "wedding", "date night", "beach party", "office meeting"?
  - Time/Season: What does "summer", "evening", "winter" tell you about appropriate choices?
  - Demographics: How do "curvy", "petite", "wheatish skin", "for my daughter" influence style and color recommendations?
  - Lifestyle/Activity: What does "travel", "workout", "vacation" imply about functionality and style?

  **KEY PRINCIPLE**: Don't just match keywords - understand the deeper meaning and extract ALL relevant constraints that would help find perfect products. A location name like "Bahamas" should trigger multiple inferences: beach occasion, vacation context, tropical/summer season, bright/light colors, casual styles, etc. Be creative and comprehensive in your inference.
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
- **MANDATORY COLOR INFERENCE** - You MUST ALWAYS extract colors from context, even when not explicitly mentioned. Every query has contextual clues (location, occasion, season, time, culture, weather, etc.) that suggest appropriate colors. Color extraction is REQUIRED - use your understanding of color psychology, cultural meanings, and appropriateness to infer colors for EVERY query. If context is vague, infer versatile/appropriate colors. Never return colors as null unless explicitly excluded by the user.

  **CRITICAL COLOR INTENT RULE - ABSOLUTE REQUIREMENT**:
  - **EXPLICITLY MENTIONED COLORS** (user directly says the color word): MUST be "required" intent
    - Examples: "red dress" → colors: { values: ["Red"], intent: "required" } ✅
    - Examples: "blue maxi dress" → colors: { values: ["Blue"], intent: "required" } ✅
    - Examples: "white cardigan" → colors: { values: ["White"], intent: "required" } ✅
  - **INFERRED COLORS** (colors extracted from context but NOT explicitly mentioned): MUST be "strong" intent, NEVER "required"
    - Examples: "black tie wedding" → colors: { values: ["Black", "Ivory", "Gold"], intent: "strong" } ✅ (inferred from "black tie" context, NOT explicitly mentioned)
    - Examples: "beach vacation" → colors: { values: ["White", "Yellow", "Coral"], intent: "strong" } ✅ (inferred from "beach" context, NOT explicitly mentioned)
    - Examples: "dress for winter" → colors: { values: ["Burgundy", "Navy", "Plum"], intent: "strong" } ✅ (inferred from "winter" context, NOT explicitly mentioned)
    - Examples: "wheatish skin" → colors: { values: ["Burgundy", "Emerald", "Navy"], intent: "strong" } ✅ (inferred from skin tone context, NOT explicitly mentioned)
  - **ABSOLUTE RULE**: If the user did NOT explicitly say the color word(s) in their query, the color is INFERRED and MUST use "strong" intent, NOT "required"
  - **ABSOLUTE RULE**: Only colors that appear as actual words in the user's query text can be "required"
  - **ABSOLUTE RULE**: Colors inferred from context (location, occasion, season, skin tone, culture, weather, etc.) are ALWAYS "strong", NEVER "required"
  - **VERIFICATION CHECK**: Before marking a color as "required", ask yourself: "Did the user explicitly say this color word in their query?" If NO → use "strong" intent
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
    - Tropical/island destinations (Caribbean, Hawaii, Maldives, beach locations) → infer bright/tropical colors
    - Mountain/cold destinations → infer earth tones/deeper colors
    - Desert destinations → infer light/neutral colors
    - Think about what colors suit the geography
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
  **CRITICAL - MANDATORY COLOR EXTRACTION**: You MUST extract colors for EVERY query based on context. Even vague queries have clues - use them. Consider EVERYTHING: location (tropical → bright colors, mountain → earth tones), weather (sunny → light colors, cold → deeper colors), occasion (wedding → traditional colors, beach → tropical colors), season (summer → bright/light, winter → deep/warm), time of day (day → light, evening → elegant), culture (Indian wedding → red/gold, Western wedding → white/pastels), and any other contextual signal. When context is unclear or mixed, infer versatile/appropriate colors that make sense. NEVER return colors as null unless the user explicitly says "no color" or "any color". Extract at least 3-8 appropriate colors from the dictionary based on the context.
- **INTELLIGENT OCCASION INFERENCE** - Infer occasions from context by understanding what the user is doing and where they're going. A location like "Bahamas" implies beach/vacation. "Wedding" suggests formal/wedding occasions. "Date night" suggests romantic evening. Think about what occasions would apply - often multiple occasions are relevant (e.g., "Bahamas vacation" → both "Beach" and "Vacation" occasions). Use your understanding of events, locations, and activities to extract all relevant occasions from the dictionary.
- **INTELLIGENT MATERIAL INFERENCE** - Infer materials from explicit mentions or functional descriptions. "Silk" → Silk. "Breathable" suggests Cotton/Linen/Modal. "Warm" suggests Wool/Cashmere. "Soft" suggests Cotton/Modal/Cashmere/Silk. Think about what materials match the described properties and extract from dictionary.
- **INTELLIGENT SEASON INFERENCE** - Infer seasons from location, weather mentions, time of year, or activities. "Bahamas" suggests summer. "Winter coat" suggests winter. "Beach" suggests summer. "Mountain" might suggest fall/winter. Think about what season makes sense for the context and extract from the dictionary.
- **CRITICAL: COLORUNDERTONE INFERENCE** - Extract when user mentions color temperature:
  - "warm colors", "warm tones" → colorUndertone: ["Warm"] (from colorUndertone dictionary)
  - "cool colors", "cool tones" → colorUndertone: ["Cool"] (from colorUndertone dictionary)
  - "neutral colors", "neutral tones" → colorUndertone: ["Neutral"] (from colorUndertone dictionary)
- **CRITICAL: SEASONALPALETTE INFERENCE** - Extract seasonal color palettes:
  - "spring colors", "spring palette" → seasonalPalette: ["Spring"] (from seasonalPalette dictionary)
  - "summer colors", "summer palette" → seasonalPalette: ["Summer"] (from seasonalPalette dictionary)
  - "fall colors", "autumn colors" → seasonalPalette: ["Fall"] (from seasonalPalette dictionary)
  - "winter colors", "winter palette" → seasonalPalette: ["Winter"] (from seasonalPalette dictionary)
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
- **INTELLIGENT STYLES INFERENCE** - Infer styles based on occasion, body type, cultural context, and user preferences. "Beach" might suggest Bohemian/Casual. "Wedding" suggests Romantic/Elegant. "Curvy" suggests A-Line/Wrap. Think about what styles work for the context, then match to dictionary values. The styles dictionary includes silhouette cuts (A-Line, Wrap, Bodycon, etc.) and aesthetic descriptors (Romantic, Casual, Elegant, etc.) - use both types of style information.
- **CRITICAL: INTELLIGENT NECKLINES INFERENCE** - You MUST infer necklines from context and match to dictionary values:
  - **Modesty requirements** (map to necklines dictionary):
    - "modest", "conservative", "muslim wedding", "islamic wedding" → prefer necklines: ["High Neck", "High", "Round", "Boat"] (from necklines dictionary), avoid necklines: ["V-Neck", "Plunging", "Off-Shoulder", "Strapless"]
    - "revealing", "low cut" → prefer necklines: ["V-Neck", "Plunging", "Off-Shoulder", "Strapless"] (from necklines dictionary)
  - **Occasion formality** (map to necklines dictionary):
    - "formal", "formal event", "black tie" → prefer necklines: ["V-Neck", "Round", "High Neck", "High"] (from necklines dictionary), avoid necklines: ["Off-Shoulder", "Strapless"]
    - "casual", "everyday" → can be any neckline from dictionary
  - **Cultural/religious context** (map to necklines dictionary):
    - "muslim", "islamic", "conservative", "traditional" → prefer necklines: ["High Neck", "High", "Round", "Boat", "Collar"] (from necklines dictionary), avoid revealing necklines
  - **IMPORTANT**: 
    - All inferred necklines MUST exist in the necklines dictionary shown above
    - Dictionary has: ["Asymmetric", "Boat", "Collar", "Halter", "High", "High Neck", "Low", "Moderate", "Off-Shoulder", "Plunging", "Round", "Scoop", "Square", "Strapless", "V-Neck"]
    - Note: "Sweetheart" is NOT in dictionary - do NOT use it
    - "Round Neck" should be "Round" (from dictionary)
    - Explicit mentions override inferred necklines
- **CRITICAL: INTELLIGENT SLEEVE LENGTHS INFERENCE** - You MUST infer sleeve lengths from context even when not explicitly mentioned:
  - **Modesty requirements**:
    - "modest", "conservative", "muslim wedding", "islamic wedding" → prefer sleeveLengths: ["Long", "Three-Quarter"], avoid sleeveLengths: ["Sleeveless", "Cap"]
    - "revealing", "sleeveless" → prefer sleeveLengths: ["Sleeveless", "Cap"]
  - **Occasion formality**:
    - "formal", "formal event", "black tie" → prefer sleeveLengths: ["Long", "Three-Quarter"], casual → can be any
  - **Weather/season**:
    - "cold", "winter", "fall" → prefer sleeveLengths: ["Long", "Three-Quarter"]
    - "hot", "summer", "beach" → prefer sleeveLengths: ["Sleeveless", "Short", "Cap"]
  - **IMPORTANT**: Infer sleeve lengths based on modesty, occasion formality, and weather/season. Map inferred sleeve lengths to the closest ontology terms. Explicit mentions override inferred sleeve lengths.
- **INTELLIGENT PATTERNS INFERENCE** - Infer patterns from context when it makes sense. "Beach/vacation" might suggest Floral/Tropical patterns. "Wedding" might suggest Floral/Romantic. "Summer" might suggest Floral/Bright patterns. Think about what patterns would be appropriate for the context and extract from dictionary.
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
  - **Body type preferences** (PRIMARY: Extract as inclusivitySizing, FALLBACK: map to fits/styles):
    - **CRITICAL**: Body type mentions should be extracted as inclusivitySizing (HARD SQL filter) - see contextual inference rule 3
    - **FALLBACK ONLY**: If inclusivitySizing extraction fails, infer fits/styles:
      * "petite" → prefer fits: ["Fitted", "Slim Fit", "A-Line"]
      * "plus size", "curvy" → prefer fits: ["Relaxed Fit", "A-Line", "Wrap", "Fit and Flare"]
      * "tall" → prefer fits: ["Fitted", "A-Line", "Fit and Flare"]
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
    - **CRITICAL**: Body type mentions should be extracted as inclusivitySizing (HARD SQL filter - OR filter), NOT sizes:
      * Match user terms to inclusivitySizing dictionary: "curvy", "curvy women", "fat", "plus size", "overweight" → match to "Plus Size" in dictionary → inclusivitySizing: { values: ["Plus Size"], intent: "required" } (NOT sizes)
      * Match user terms to inclusivitySizing dictionary: "petite" → match to "Petite" in dictionary → inclusivitySizing: { values: ["Petite"], intent: "required" } (NOT sizes)
      * Match user terms to inclusivitySizing dictionary: "tall" → match to "Tall" in dictionary → inclusivitySizing: { values: ["Tall"], intent: "required" } (NOT sizes)
    - **IMPORTANT**: Body type descriptors are NOT size mentions - extract as inclusivitySizing constraint by matching to inclusivitySizing dictionary values, not sizes
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
**CRITICAL FORMAT RULE**: For ALL directly interpretable constraints (including synonyms), you MUST use INTENT FORMAT, NOT plain arrays.

**INTENT FORMAT (REQUIRED for directly interpretable constraints)**:
{
  "type": "direct_product_search" | "occasion_based" | "style_exploration" | "fit_and_size" | "gift_or_vague" | "unrelated",
  "constraints": {
    "styles": { "values": ["A-Line"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "necklines": { "values": ["V-Neck"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "sleeveLengths": { "values": ["Long"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "lengths": { "values": ["Maxi"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "occasions": { "values": ["Wedding"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "seasons": { "values": ["Summer"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "materials": { "values": ["Cotton"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "patterns": { "values": ["Floral"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "colors": { "values": ["Blue"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "sizes": { "values": ["4"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "fits": { "values": ["Slim Fit"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "collections": { "values": ["Spring Collection"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "priceMinCents": number | null,
    "priceMaxCents": number | null,
    "embellishments": { "values": ["Lace"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "ageGroups": { "values": ["Adult"], "intent": "required" } | null,  // ✅ Use intent format for direct interpretation
    "scents": string[] | null,
    "rooms": string[] | null,
    "useCases": string[] | null,
    "benefits": string[] | null,
    "claims": string[] | null,
    "sensoryProfile": string | null,
    "compatibility": string[] | null
  },
  "confidence": number (0.0-1.0)
}

**EXAMPLES OF CORRECT INTENT FORMAT**:
- "empire waist dresses" → styles: { "values": ["Empire"], "intent": "required" } ✅ (synonym = direct interpretation: "empire waist" → "Empire")
- "scoop neck blouse" → necklines: { "values": ["Scoop"], "intent": "required" } ✅ (NOT necklines: ["Scoop"])
- "fit and flare style dresses" → styles: { "values": ["Fit and Flare"], "intent": "required" } ✅ (NOT styles: ["Fit and Flare"])
- "cap sleeve dress" → sleeveLengths: { "values": ["Cap"], "intent": "required" } ✅ (synonym = direct interpretation: "cap sleeve" → "Cap")
- "full sleeve top" → sleeveLengths: { "values": ["Long"], "intent": "required" } ✅ (synonym = direct interpretation: "full sleeve" → "Long")

**ABSOLUTE RULE**: 
- ❌ NEVER return constraints as plain arrays: styles: ["A-Line"] 
- ✅ ALWAYS return constraints in intent format: styles: { "values": ["A-Line"], "intent": "required" }
- This applies to ALL constraint types, ALL the time, no exceptions
`;
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
          // CRITICAL: ALL constraints MUST use intent format (no array format allowed)
          colors: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          sizes: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          occasions: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          styles: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          patterns: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          seasons: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          materials: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          fits: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          collections: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          embellishments: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          necklines: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          sleeveLengths: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          ageGroups: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          inclusivitySizing: { 
            type: ['object', 'null'],
            properties: {
              values: { type: 'array', items: { type: 'string' } },
              intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
              similarValues: { type: ['array', 'null'], items: { type: 'string' } }
            },
            required: ['values', 'intent'],
            description: 'Inclusivity sizing for body types. Match user body type mentions (e.g., "curvy", "curvy women", "curvy mom", "fat", "plus size", "overweight", "petite", "tall", "extended sizes") to values in the inclusivitySizing dictionary (e.g., "Plus Size", "Petite", "Tall", "Extended Sizes", "Standard Sizing"). Use semantic matching to map user terms to dictionary values. This is a HARD SQL filter (OR filter - products matching ANY value in the array).'
          },
          setVsSingle: {
            type: ['object', 'null'],
            properties: {
              values: { type: 'array', items: { type: 'string', enum: ['Set', 'Single'] } },
              intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] }
            },
            required: ['values', 'intent'],
            description: 'Product type: "Set" for pack/multi-item products (e.g., "3-pack", "bundle", "set"), "Single" for individual items. DEFAULT: Extract "Set" ONLY when user explicitly mentions pack-related terms (e.g., "pack", "bundle", "set", "multi", "pair", "3-pack", "4-pack"). If not mentioned, do NOT extract this constraint (system will default to "Single"). This is a HARD SQL filter.'
          },
          lengths: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          formalityLevel: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          occasionContext: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          problemSolutions: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          functionFeatures: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          colorShade: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          colorUndertone: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          seasonalPalette: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          modestyCues: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          careRequirements: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          travelFeatures: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          ecoMaterials: { 
            type: ['object', 'null'],
                properties: {
                  values: { type: 'array', items: { type: 'string' } },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] },
                  similarValues: { type: ['array', 'null'], items: { type: 'string' } }
                },
                required: ['values', 'intent']
          },
          // Price constraints with intent (REQUIRED format)
          priceMinCents: { 
            type: ['object', 'null'],
                properties: {
                  value: { type: 'integer' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] }
                },
                required: ['value', 'intent']
          },
          priceMaxCents: { 
            type: ['object', 'null'],
                properties: {
                  value: { type: 'integer' },
                  intent: { type: 'string', enum: ['required', 'strong', 'preferred', 'excluded'] }
                },
                required: ['value', 'intent']
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
 * Extract category-specific dictionary values from category dictionaries
 * 
 * Merges dictionaries for all matching categories/subcategories and extracts
 * available values for constraint types that exist in category dictionaries.
 * 
 * @param categoryDictionaries - Map of category/subcategory to dictionaries
 * @param categories - Categories to match against
 * @returns Map of constraint type to available values (normalized to title case)
 */
export function extractCategorySpecificDictionaryValues(
  categoryDictionaries: CategoryDictionaryMap | undefined,
  categories: string[] | undefined
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  
  if (!categoryDictionaries || !categories || categories.length === 0) {
    return result;
  }
  
  // Collect all matching dictionaries
  const matchingDictionaries: Array<{ category: string; subcategory: string | null; dict: any }> = [];
  
  for (const category of categories) {
    // Try exact match first
    const exactKey = `${category}|`;
    if (categoryDictionaries.has(exactKey)) {
      const dict = categoryDictionaries.get(exactKey)!;
      matchingDictionaries.push({ category, subcategory: null, dict });
    }
    
    // Try with subcategories (iterate through all keys)
    for (const [key, dict] of categoryDictionaries.entries()) {
      const [dictCategory, dictSubcategory] = key.split('|');
      if (dictCategory === category) {
        matchingDictionaries.push({ 
          category, 
          subcategory: dictSubcategory || null, 
          dict 
        });
      }
    }
  }
  
  if (matchingDictionaries.length === 0) {
    return result;
  }
  
  // Merge values from all matching dictionaries
  const mergedColors = new Set<string>();
  const mergedLengths = new Set<string>();
  const mergedSleeves = new Set<string>();
  const mergedNecklines = new Set<string>();
  const mergedFormalityLevels = new Set<string>();
  const mergedColorShades = new Set<string>();
  const mergedColorUndertones = new Set<string>();
  const mergedFits = new Set<string>();
  const mergedMaterials = new Set<string>();
  const mergedOccasions = new Set<string>();
  const mergedSeasons = new Set<string>();
  const mergedStyles = new Set<string>();
  const mergedPatterns = new Set<string>();
  const mergedSizes = new Set<string>();
  const mergedRises = new Set<string>();
  const mergedCollections = new Set<string>();
  const mergedEmbellishments = new Set<string>();
  
  for (const { dict } of matchingDictionaries) {
    // Colors (normalize to title case)
    dict.availableColors.forEach((color: string) => {
      mergedColors.add(color.charAt(0).toUpperCase() + color.slice(1).toLowerCase());
    });
    
    // Lengths (normalize to title case)
    dict.availableLengths.forEach((length: string) => {
      mergedLengths.add(length.charAt(0).toUpperCase() + length.slice(1).toLowerCase());
    });
    
    // Sleeves (normalize to title case)
    dict.availableSleeves.forEach((sleeve: string) => {
      mergedSleeves.add(sleeve.charAt(0).toUpperCase() + sleeve.slice(1).toLowerCase());
    });
    
    // Necklines (normalize to title case)
    dict.availableNecklines.forEach((neckline: string) => {
      mergedNecklines.add(neckline.charAt(0).toUpperCase() + neckline.slice(1).toLowerCase());
    });
    
    // Formality levels (normalize to title case)
    dict.availableFormalityLevels.forEach((formality: string) => {
      mergedFormalityLevels.add(formality.charAt(0).toUpperCase() + formality.slice(1).toLowerCase());
    });
    
    // Color shades (normalize to title case)
    dict.availableColorShades.forEach((shade: string) => {
      mergedColorShades.add(shade.charAt(0).toUpperCase() + shade.slice(1).toLowerCase());
    });
    
    // Fits (normalize to title case)
    dict.availableFits.forEach((fit: string) => {
      mergedFits.add(fit.charAt(0).toUpperCase() + fit.slice(1).toLowerCase());
    });
    
    // Materials (normalize to title case)
    dict.availableMaterials.forEach((material: string) => {
      mergedMaterials.add(material.charAt(0).toUpperCase() + material.slice(1).toLowerCase());
    });
    
    // Occasions (normalize to title case)
    dict.availableOccasions.forEach((occasion: string) => {
      mergedOccasions.add(occasion.charAt(0).toUpperCase() + occasion.slice(1).toLowerCase());
    });
    
    // Seasons (normalize to title case)
    dict.availableSeasons.forEach((season: string) => {
      mergedSeasons.add(season.charAt(0).toUpperCase() + season.slice(1).toLowerCase());
    });
    
    // Styles (normalize to title case)
    dict.availableStyles.forEach((style: string) => {
      mergedStyles.add(style.charAt(0).toUpperCase() + style.slice(1).toLowerCase());
    });
    
    // Patterns (normalize to title case)
    dict.availablePatterns.forEach((pattern: string) => {
      mergedPatterns.add(pattern.charAt(0).toUpperCase() + pattern.slice(1).toLowerCase());
    });
    
    // Sizes (normalize to title case)
    dict.availableSizes.forEach((size: string) => {
      mergedSizes.add(size.charAt(0).toUpperCase() + size.slice(1).toLowerCase());
    });
    
    // Rises (normalize to title case)
    dict.availableRises.forEach((rise: string) => {
      mergedRises.add(rise.charAt(0).toUpperCase() + rise.slice(1).toLowerCase());
    });
    
    // Collections (from attributes if available in dict)
    if ((dict as any).availableCollections) {
      (dict as any).availableCollections.forEach((collection: string) => {
        mergedCollections.add(collection.charAt(0).toUpperCase() + collection.slice(1).toLowerCase());
      });
    }
    
    // Embellishments (from attributes if available in dict)
    if ((dict as any).availableEmbellishments) {
      (dict as any).availableEmbellishments.forEach((embellishment: string) => {
        mergedEmbellishments.add(embellishment.charAt(0).toUpperCase() + embellishment.slice(1).toLowerCase());
      });
    }
  }
  
  // Set results (only if we have values)
  if (mergedColors.size > 0) {
    result.set('colors', Array.from(mergedColors).sort());
  }
  if (mergedLengths.size > 0) {
    result.set('lengths', Array.from(mergedLengths).sort());
  }
  if (mergedSleeves.size > 0) {
    result.set('sleeves', Array.from(mergedSleeves).sort());
  }
  if (mergedNecklines.size > 0) {
    result.set('necklines', Array.from(mergedNecklines).sort());
  }
  if (mergedFormalityLevels.size > 0) {
    result.set('formalityLevel', Array.from(mergedFormalityLevels).sort());
  }
  if (mergedColorShades.size > 0) {
    result.set('colorShades', Array.from(mergedColorShades).sort());
  }
  if (mergedFits.size > 0) {
    result.set('fits', Array.from(mergedFits).sort());
  }
  if (mergedMaterials.size > 0) {
    result.set('materials', Array.from(mergedMaterials).sort());
  }
  if (mergedOccasions.size > 0) {
    result.set('occasions', Array.from(mergedOccasions).sort());
  }
  if (mergedSeasons.size > 0) {
    result.set('seasons', Array.from(mergedSeasons).sort());
  }
  if (mergedStyles.size > 0) {
    result.set('styles', Array.from(mergedStyles).sort());
  }
  if (mergedPatterns.size > 0) {
    result.set('patterns', Array.from(mergedPatterns).sort());
  }
  if (mergedSizes.size > 0) {
    result.set('sizes', Array.from(mergedSizes).sort());
  }
  if (mergedRises.size > 0) {
    result.set('rises', Array.from(mergedRises).sort());
  }
  if (mergedCollections.size > 0) {
    result.set('collections', Array.from(mergedCollections).sort());
  }
  if (mergedEmbellishments.size > 0) {
    result.set('embellishments', Array.from(mergedEmbellishments).sort());
  }
  
  return result;
}

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
  classificationConstraints?: Partial<import('./classifier').FashionConstraints> | null;
  gender?: string | null;
  categories?: string[];
  ageGroup?: string | null;
  candidateCount?: number;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  categoryDictionaries?: CategoryDictionaryMap;
}): string {
  const dictionaries = loadConstraintDictionaries();
  
  // Extract category-specific dictionary values if available
  const categorySpecificValues = extractCategorySpecificDictionaryValues(
    params.categoryDictionaries,
    params.categories
  );
  
  // Log which constraint types have category-specific dictionaries
  if (categorySpecificValues.size > 0) {
    const constraintTypes = Array.from(categorySpecificValues.keys());
    const constraintCounts = Array.from(categorySpecificValues.entries()).map(([key, values]) => ({
      type: key,
      count: values.length
    }));
    logger.debug('buildConstraintRefinementPrompt: category_specific_dictionaries', {
      query: params.query.substring(0, 100),
      categories: params.categories,
      constraintTypesWithCategorySpecific: constraintTypes,
      constraintCounts,
      totalConstraintTypes: categorySpecificValues.size,
    });
  }
  
  // Build context summary
  // Note: ageGroup is EXCLUDED from refinement - it's already resolved and passed as context only
  const contextParts: string[] = [];
  if (params.gender) contextParts.push(`Gender: ${params.gender}`);
  if (params.categories && params.categories.length > 0) {
    contextParts.push(`Categories: ${params.categories.join(', ')}`);
  }
  // ageGroup excluded from context summary - it's already resolved and not refined
  if (params.candidateCount) contextParts.push(`${params.candidateCount} candidate products`);
  if (categorySpecificValues.size > 0) {
    contextParts.push(`Using category-specific dictionaries (${categorySpecificValues.size} constraint types)`);
  }
  
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
  
  // Format dictionaries: use category-specific when available, fall back to global
  // Helper to format category-specific values or fall back to global
  const formatDict = (constraintType: string, maxItems: number, categorySpecificKey?: string): string => {
    if (categorySpecificKey && categorySpecificValues.has(categorySpecificKey)) {
      const values = categorySpecificValues.get(categorySpecificKey)!;
      const displayValues = values.slice(0, maxItems);
      const remaining = values.length - displayValues.length;
      let output = `${constraintType.toUpperCase()} (${values.length} total, category-specific):\n`;
      output += displayValues.join(', ');
      if (remaining > 0) {
        output += `\n... and ${remaining} more`;
      }
      return output;
    } else {
      return formatDictionaryForPrompt(constraintType as any, maxItems);
    }
  };
  
  const colorsDict = formatDict('colors', 80, 'colors');
  const lengthsDict = formatDict('lengths', 20, 'lengths');
  const formalityDict = formatDict('formalityLevel', 10, 'formalityLevel');
  const fitsDict = formatDict('fits', 25, 'fits');
  const materialsDict = formatDict('materials', 40, 'materials');
  const occasionsDict = formatDict('occasions', 30, 'occasions');
  const stylesDict = formatDict('styles', 30, 'styles');
  const patternsDict = formatDict('patterns', 30, 'patterns');
  const sizesDict = formatDict('sizes', 50, 'sizes');
  const risesDict = formatDict('rises', 15, 'rises');
  const necklinesDict = formatDict('necklines', 20, 'necklines');
  const sleeveLengthsDict = formatDict('sleeveLengths', 15, 'sleeves');
  const collectionsDict = formatDict('collections', 20, 'collections');
  const seasonsDict = formatDict('seasons', 10, 'seasons');
  const colorShadesDict = formatDict('colorShade', 10, 'colorShades');
  const embellishmentsDict = formatDict('embellishments', 20, 'embellishments');
  
  // Format classification constraints for prompt (if provided)
  let classificationConstraintsText = '';
  if (params.classificationConstraints) {
    const { extractConstraintValues } = require('./constraint-utils');
    const constraints = params.classificationConstraints;
    const formattedConstraints: string[] = [];
    
    // Extract and format each constraint type
    const constraintTypes = [
      'colors', 'materials', 'occasions', 'styles', 'patterns', 'sizes',
      'lengths', 'fits', 'rises', 'formalityLevel', 'necklines', 'sleeveLengths',
      'collections', 'seasons', 'colorShade', 'embellishments'
    ] as const;
    
    for (const type of constraintTypes) {
      const value = constraints[type];
      if (value !== null && value !== undefined) {
        const values = extractConstraintValues(value) || (Array.isArray(value) ? value : []);
        if (values.length > 0) {
          formattedConstraints.push(`${type}: [${values.map((v: string) => `"${v}"`).join(', ')}]`);
        }
      }
    }
    
    if (formattedConstraints.length > 0) {
      classificationConstraintsText = `\n\nCLASSIFICATION CONSTRAINTS (extracted from query - validate and normalize these):\n${formattedConstraints.join('\n')}`;
    }
  }
  
  return `You are a fashion ranking assistant. Your task is to validate and normalize constraint values extracted from a user's shopping query against predefined dictionaries.

IMPORTANT RULES:
- You MUST ONLY select values that appear in the dictionaries below
- Validate ALL provided classification constraints against dictionaries
- Map similar/related values to dictionary equivalents (e.g., "curvy" → ["Fitted", "Relaxed", "Loose"])
- Normalize constraint values to match dictionary format exactly
- If a constraint value is not in the dictionary, find the closest match or drop it
- Do NOT invent new terms or values not in dictionaries
- If nothing is relevant for a constraint type, return an empty array for that key
- Output PURE JSON with no comments or extra text

USER QUERY: "${params.query}"${historyText}${classificationConstraintsText}

CONTEXT: ${contextSummary}

CONSTRAINT DICTIONARIES (validate against these - only use values that appear here):

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

${necklinesDict}

${sleeveLengthsDict}

${collectionsDict}

${seasonsDict}

${colorShadesDict}

${embellishmentsDict}

TASK:
${params.classificationConstraints ? 
  'Validate and normalize the provided CLASSIFICATION CONSTRAINTS against the dictionaries above. For each constraint value provided, either:' :
  'Analyze the user\'s query and context. For each constraint type, select the most relevant values from the dictionaries above that match the user\'s intent.'}
${params.classificationConstraints ? 
  '1. Map it to the exact dictionary equivalent if it exists\n2. Find the closest dictionary match if similar values exist\n3. Drop it if no reasonable dictionary match exists' : ''}

For importance levels:
- "required": User explicitly requires this (e.g., "only black", "must be formal")
- "strong": User clearly prefers this (e.g., "curvy jeans", "work appropriate", "summer dress")
- "preferred": User mildly prefers or it's contextually relevant (e.g., general style hints)

EXAMPLES:

${params.classificationConstraints ? 
`Example 1: Validating provided constraints
Classification constraints: { styles: ["A-Line", "Wrap"], lengths: ["Maxi", "Midi"], fits: ["Curvy"] }
→ Validate "Curvy" → map to dictionary: fits: ["Fitted", "Relaxed", "Loose", "Regular"] (strong)
→ Validate "A-Line", "Wrap" → both in dictionary: styles: ["A-Line", "Wrap"] (strong)
→ Validate "Maxi", "Midi" → both in dictionary: lengths: ["Maxi", "Midi"] (strong)

Example 2: Normalizing similar values
Classification constraints: { necklines: ["V-Neck", "Round Neck", "Sweetheart"], styles: ["Fit and Flare"] }
→ "V-Neck", "Round Neck", "Sweetheart" all in dictionary: necklines: ["V-Neck", "Round Neck", "Sweetheart"] (strong)
→ "Fit and Flare" maps to "Fit and Flare" style: styles: ["Fit and Flare"] (strong)` :
`Example 1: Extracting from query only
Query: "curvy jeans for women"
→ fits: ["Relaxed", "Wide Leg", "Straight"] (strong)
→ sizes: ["L", "XL", "2XL", "14", "16"] (strong)
→ rises: ["Mid Rise", "High Rise"] (preferred)

Example 2: Extracting from query only
Query: "black formal dress for a wedding"
→ colors: ["Black"] (required)
→ occasions: ["Wedding", "Formal"] (strong)
→ formalityLevel: ["Formal"] (strong)
→ styles: ["Elegant", "Sophisticated"] (preferred)`}

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
  "necklines": [],
  "sleeveLengths": [],
  "collections": [],
  "seasons": [],
  "colorShade": [],
  "embellishments": [],
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
    "formalityLevel": "required" | "strong" | "preferred",
    "necklines": "required" | "strong" | "preferred",
    "sleeveLengths": "required" | "strong" | "preferred",
    "collections": "required" | "strong" | "preferred",
    "seasons": "required" | "strong" | "preferred",
    "colorShade": "required" | "strong" | "preferred",
    "embellishments": "required" | "strong" | "preferred"
  }
}`;
}

export const CONSTRAINT_REFINEMENT_SCHEMA = {
  name: 'constraint_refinement',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['colors', 'materials', 'occasions', 'styles', 'patterns', 'sizes', 'lengths', 'fits', 'rises', 'formalityLevel', 'necklines', 'sleeveLengths', 'collections', 'seasons', 'colorShade', 'embellishments', 'importance'],
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
      necklines: { type: 'array', items: { type: 'string' } },
      sleeveLengths: { type: 'array', items: { type: 'string' } },
      collections: { type: 'array', items: { type: 'string' } },
      seasons: { type: 'array', items: { type: 'string' } },
      colorShade: { type: 'array', items: { type: 'string' } },
      embellishments: { type: 'array', items: { type: 'string' } },
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
          necklines: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          sleeveLengths: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          collections: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          seasons: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          colorShade: { type: 'string', enum: ['required', 'strong', 'preferred'] },
          embellishments: { type: 'string', enum: ['required', 'strong', 'preferred'] },
        },
      },
    },
  },
};

/**
 * All LLM prompts for fashion query classification, reply generation,
 * and dialogue routing.
 */
