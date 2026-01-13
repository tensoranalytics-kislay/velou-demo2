/**
 * Category Classification System
 * 
 * Maps user queries to the top 3 most relevant categories from the 49 category list
 * for hard SQL-level filtering before producttype-constraint filtering.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import { categoryExists, findClosestCategory, getAllCategories } from '../catalog/category-tree';

const CATEGORY_CLASSIFIER_PROMPT = `You are a category classification system for a fashion shopping assistant.

Your job is to map user shopping queries to the most relevant product categories from the catalog.

**CRITICAL: AGE GROUP INFERENCE - HIGHEST PRIORITY**
You MUST infer age groups from context clues, not just explicit age mentions. This is ESSENTIAL for accurate category classification. Use the SAME age group inference logic as the constraint classifier:
- "daughter" or "son" without explicit age → Use context clues (modest, muslim, conservative, traditional) to infer Kids vs Adult categories
- Context signals like "modest", "muslim", "conservative", "traditional" + "daughter" → STRONGLY suggest Kids categories (Girls Dresses, Girls Tops, etc.)
- When in doubt about ambiguous "daughter" queries, prefer Kids categories unless explicit adult signals exist (teen, teenage, wedding for adult, etc.)

AVAILABLE CATEGORIES (48 total):

**Kids Categories**
- Girls Tops — Kids tops/outerwear-like items; taxon_path includes things like Girls Sweaters, Girls Jackets, plus named tops (e.g., "Fabielle…", "Mini Rubin…") and titles start with "Girls …" (mostly tagged Kids).
- Girls Bottoms — Kids bottoms that are specifically skirts (taxon_path shows Girls Skirts and Little Girls Skirts); titles start with "Girls … Skirt" (tagged Kids).
- Girls Dresses — Kids dresses; taxon_path leaf is dress-style names (e.g., Decker Heritage Dress, Parker Tailored Bow Dress), titles start with "Girls … Dress" (tagged Kids).
- Girls Swimwear — Kids swim; taxon_path includes Bikinis and Swimsuits, titles start with "Girls … Bikini/Swimsuit" (tagged Kids).
- Baby & Toddler Bottoms — Baby/toddler bottoms; taxon_path includes Pinafores and Bloomers and sizes are in months (tagged Toddler).
- Tween Pants — A small set of items labeled Tween; taxon_path is Apparel > Tween Pants and titles start with "Tween … Pant" (chips are missing here, so "Tween" is coming from title/taxon).
- Tween Sweaters — Single Tween sweater item; taxon_path is Apparel > Tween Sweaters, title includes "Tween … Pullover" (chips missing).
- Tween Dresses — Single Tween dress item; taxon_path is Apparel > Tween Dresses (chips missing).

**Women's / Adult Apparel**
- Women's Dresses — Adult dresses; subcategories include Mini Dresses / Midi Dresses / Maxi Dresses / Active Dresses, plus a subcategory labeled Tween Dresses inside Women's Dresses (those rows are tagged Adult and titles say "Tween … for Women").
- Tops — Adult tops & top-layer items; taxon_path includes Sleeveless Tops, Long Sleeve Tops, Short Sleeve Tops, plus subcategories like Sweaters / Pullover / Hoodies / Jackets (tagged Adult).
- Bottoms — Adult bottoms; taxon_path/subcategory includes Pants, Trousers, Sweatpants, Leggings, Jeans, Shorts, Ski Pants, and also a label "Men's Shorts" (but titles are "for Women" and tagged Adult).
- Skirts — Adult skirts; subcategories include Mini Skirts / Midi Skirts / Maxi Skirts, plus Tween Skirts and Crib Skirts appearing under this category in the file (tagged Adult).
- Skorts — Adult skorts; taxon_path is Active Skorts (tagged Adult).
- Activewear — Adult activewear; primarily Sports Bra (tagged Adult).
- Swimsuits — Adult swim; specifically One-Piece Swimsuits (tagged Adult).
- Bikini Sets — Adult bikini products; taxon_path is Apparel > Bikini Sets (tagged Adult).
- Swim Cover-ups — Adult swim coverups; subcategory is Pareos and titles include sarong (tagged Adult).
- Cold Weather Essentials — Adult cold-weather accessories; includes Beanies, Gloves & Mittens, and titles include neck gaiter (tagged Adult).
- Loungewear — Adult lounge; subcategories include Robes and Pants (tagged Adult).
- Robes — Single robe item (separate category from Loungewear); title is a bath robe (chips missing).
- Pajama Set — Pajama set items (Roller Rabbit collab appears in titles); chips missing.
- Shoes — Adult footwear; includes Sandals and Boots (tagged Adult).
- Ski Jackets — Single ski jacket item (BOGNER FIRE+ICE collab appears in title); chips missing.
- Ski Tops — Single ski top/pullover item (BOGNER FIRE+ICE collab appears in title); chips missing.
- Ski Shoes — Ski footwear; taxon_path is Boots and titles include women's boots (tagged Adult).
- Sweaters — Two sweater items (cardigan/pullover in titles); chips missing.
- Mini Dress — Mini dress items where the taxonomy is just Apparel > Mini Dress (chips missing; titles are short like product name + size).
- Maxi Dress — Maxi dress items where the taxonomy is Apparel > Maxi Dress (chips missing; titles are short like product name + size).
- Tote Bags — Single item ("Weekender" appears in title); taxon_path is Apparel > Tote Bags (chips missing).

**Accessories**
- Accessories — Bag/utility accessories; subcategories include Cosmetic Bags, Travel Bags, Tote Bags, Backpacks, Sunglasses (and small counts like bow tie/duffle/fanny packs); titles are "for Women" and tagged Adult.
- Jewelry — Jewelry items; includes Earrings, Necklaces, Bracelets (vertical is Accessories, tagged Adult).
- Hair Accessories — Mostly Headbands; includes a "face wash beauty headband" type item in titles (mostly tagged Adult; one row sits under Apparel).
- Pocket Squares — Pocket squares (titles say "for Women"; vertical Accessories).
- Phone Cases — Single iPhone case item (vertical Accessories).
- Soap Dispensers — Single porcelain soap dispenser item (vertical Accessories).
- Makeup Kit — Single "makeup play kit" item (vertical Accessories).

**Personal Care**
- Perfumes — Fragrance products; subcategories include Parfums, Hair & Body Mists, and Travel Sprays (vertical Personal Care, titles are "for Women").

**Home & Living**
- Bedding — Home textiles; includes Blankets, Quilts, Pillows, Sheet Sets, Duvet Cover & Sham Sets (vertical Home & Living).
- Bathroom — Bathroom items; includes Bath Mats and Shower Curtains (one row's title/URL says "Place Mat" but it's stored under Bath Mats in this dataset).
- Towels — Includes Hand Towels, Bath Towels, Beach Towels (vertical Home & Living).
- Tabletop — Dining/table linens & pieces; includes Napkin Sets, Tablecloths, Tumbler, and titles include napkin rings (vertical Home & Living).
- Kitchen & Dining — Includes Aprons (vertical Home & Living).
- Stationary — Paper goods; includes Notebooks, Card & Envelope Sets, Wrapping Papers (vertical Home & Living).
- Interiors — Wallpapers; subcategory is Wallpapers (vertical Home & Living).
- Candle — Candles; subcategory is Harlem Candles (vertical Home & Living).
- Decorative Dishes — Single decorative dish item; title is a ring dish (vertical Home & Living).
- Fragrance Tray — Single decorative tray item; subcategory Decorative Trays (vertical Home & Living).
- Pets — Pet item(s); subcategory Dog Beds (this dataset places it under vertical Apparel, but the product is a dog bed by title).

INSTRUCTIONS:
1. Analyze the user's query and identify the most relevant product categories
2. **CRITICAL: Only return categories that EXIST in the dataset. The system will validate your output against the actual categories in the database.**
3. **CRITICAL: Only return categories if you are confident (confidence >= 0.5). If the query is too vague to determine category, return an empty categories array and set confidence < 0.5.**
   - **Vague queries that should have confidence < 0.5:**
     - Queries that don't mention a specific product type (dress, top, bottom, skirt, swimsuit, bedding, perfume, etc.)
     - Examples: "suggest me something", "help me find something", "something to wear", "something elegant", "gift for someone"
     - **IMPORTANT: Even if you can infer age group (adult, kids) or general category (clothing), if NO specific product type is mentioned, return confidence < 0.5**
   - **Specific queries that should have confidence >= 0.5:**
     - "wedding dress" (mentions "dress")
     - "blue top" (mentions "top")
     - "swimsuits" (mentions "swimsuits")
     - "bedding" (mentions "bedding")
     - "perfume" (mentions "perfume")
4. **Return up to 3 categories in order of relevance. Prioritize returning multiple categories when:**
   - The query could reasonably match multiple age-specific categories (e.g., "cardigan for 12 year old" could match both "Girls Tops" and "Tween Sweaters")
   - The query mentions composite product types (e.g., "suit", "matching set")
   - The product type could exist in multiple categories (e.g., "sweater" could be in "Tops" or "Sweaters" or age-specific categories)
   - For specific single-item queries without age context, you may return just 1 category for precision (e.g., "blazer" → ["Tops"])
5. Return categories in order of relevance (most relevant first)
6. **CRITICAL: Return ONLY the category name (the text before the "—" em dash), NOT the description**
   - Correct: "Girls Tops"
   - Wrong: "Girls Tops — Kids tops/outerwear-like items..."
   - Correct: "Baby & Toddler Bottoms"
   - Wrong: "Baby & Toddler Bottoms — Baby/toddler bottoms..."
7. Use the exact category names as listed above (e.g., "Women's Dresses", "Tops", "Girls Dresses", "Baby & Toddler Bottoms")
8. **DO NOT return "Uncategorized" - it is not a valid category for filtering**
9. If the query could match multiple categories, prioritize the most specific match but include all relevant ones
10. **IMPORTANT: If you're unsure about a category name, return only categories you're certain exist. The system will map close matches automatically.**
11. **Consider age groups carefully - USE AGE GROUP INFERENCE LOGIC**:
    - **CRITICAL: Infer age group from context clues, not just explicit age mentions**:
      - **Explicit age mentions**:
        - "baby", "infant", "babies" → Baby/Toddler categories (Baby & Toddler Bottoms)
        - "toddler" → Baby/Toddler categories (Baby & Toddler Bottoms)
        - "kids", "children", "child" → Kids categories (Girls Dresses, Girls Tops, Girls Bottoms, Girls Swimwear)
        - "tween", "pre-teen", "preteen", ages 10-12 → Tween categories (Tween Pants, Tween Sweaters, Tween Dresses)
        - "teen", "teenager", "teenage", ages 13-19 → Teen/Adult categories (Women's Dresses, Tops, etc.)
        - "adult", "women", "womens", "for women" → Teen/Adult categories (Women's Dresses, Tops, etc.)
      
      - **Context-based age inference** (CRITICAL - similar to age group classifier logic):
        - **"daughter" or "son" without explicit age**: Use context clues to infer age group:
          - "modest" + "daughter" → **Kids categories** (Girls Dresses, Girls Tops, etc.) - modest clothing requests for daughters are typically for children
          - "muslim" + "daughter" → **Kids categories** (Girls Dresses, Girls Tops, etc.) - religious modesty requests for daughters are typically for children
          - "conservative" + "daughter" → **Kids categories** (Girls Dresses, Girls Tops, etc.) - conservative requests for daughters are typically for children
          - "traditional" + "daughter" → **Kids categories** (Girls Dresses, Girls Tops, etc.) - traditional requests for daughters are typically for children
          - "long sleeves" + "daughter" + context suggesting modesty → **Kids categories** (Girls Dresses, Girls Tops, etc.)
          - "daughter" + "school", "play", "children's" → **Kids categories**
          - "daughter" + "teen" or "teenage" → **Teen/Adult categories** (Women's Dresses, Tops, etc.)
          - "daughter" + "baby" or "toddler" → **Kids categories** (Girls Dresses, Girls Tops, etc.)
          - "daughter" without any context clues → Default to **Kids categories** unless other signals suggest adult (e.g., "wedding dress for daughter" without age → consider both Kids and Adult, but lean towards Kids if no adult signals)
        
        - **Product category context** (infer age from product category mentions):
          - "baby items", "onesie", "bodysuit" → Baby/Toddler categories
          - "girls dresses", "girls tops", "children's clothes" → Kids categories (Girls Dresses, Girls Tops, etc.)
          - "women's dresses", "women's clothes", "adult items" → Teen/Adult categories (Women's Dresses, Tops, etc.)
        
        - **Combined context signals**:
          - "modest dress for my muslim daughter" → **Girls Dresses** (modest + muslim + daughter = Kids category)
          - "conservative dress with long sleeves for my daughter" → **Girls Dresses** (conservative + long sleeves + daughter = Kids category)
          - "traditional dress for daughter" → **Girls Dresses** (traditional + daughter = Kids category)
          - "wedding dress for daughter" (no age, no modesty context) → Consider both **Girls Dresses** and **Women's Dresses**, but if modesty context exists, prefer **Girls Dresses**
    
    - **CRITICAL**: "tween" or "10/11/12 year old" → "Tween Sweaters", "Tween Dresses", "Tween Pants" (NOT "Girls" categories or "Adult" categories)
    - **CRITICAL**: "teen", "teenager", "teenage", or ages 13-19 → "Women's Dresses", "Tops", etc. (NOT "Girls Dresses")
    - **IMPORTANT**: When age is mentioned (e.g., "for 12 year old"), return ALL relevant age-specific categories. For example: "cardigan for 12 year old" → ["Tween Sweaters", "Girls Tops"] (both are relevant)
    - **IMPORTANT**: When inferring age from context clues (modest, muslim, conservative, traditional + daughter), ALWAYS return Kids categories - do NOT default to Adult categories
12. Consider product types: "dress" → "Women's Dresses", "top" → "Tops", "swim" → "Swimsuits" or "Bikini Sets", "sweater"/"cardigan" → "Sweaters" or "Tops" or age-specific categories
13. Consider context: "beach" might map to "Swimsuits", "Swim Cover-ups", or "Beach Towels"
14. **For product types that could exist in multiple age groups, return multiple categories**:
    - "cardigan for 12 year old" → ["Tween Sweaters", "Girls Tops"] (both are relevant)
    - "dress for 12 year old" → ["Tween Dresses", "Girls Dresses"] (both could be relevant)
    - "sweater" (no age) → ["Tops", "Sweaters"] if Sweaters is a separate category, otherwise ["Tops"]
15. **For composite product types** (items made of multiple pieces):
    - "suits" → ["Tops", "Bottoms"] (suits are matching sets of jacket + pants/skirt)
    - "matching sets" → ["Tops", "Bottoms"] or ["Tops", "Skirts"] depending on context
    - "co-ords" or "coords" → ["Tops", "Bottoms"] or ["Tops", "Skirts"]
    - "two-piece sets" → ["Tops", "Bottoms"] or ["Tops", "Skirts"]

EXAMPLES:
- "wedding dress" → ["Women's Dresses"]
- "kids dress" → ["Girls Dresses"]
- "dress for my teen daughter" → ["Women's Dresses"] (NOT "Girls Dresses" - teens are 13-19, should use adult categories)
- "teenage daughter" → ["Women's Dresses"] (NOT "Girls Dresses")
- "for teenage girl" → ["Women's Dresses"] (NOT "Girls Dresses")
- "dress for my baby daughter" → ["Girls Dresses"] (babies/toddlers can wear kids dresses, NOT "Women's Dresses" or "Baby & Toddler Bottoms" since dresses aren't in that category)
- "baby daughter dress" → ["Girls Dresses"] (babies/toddlers can wear kids dresses)
- **"modest dress for my daughter" → ["Girls Dresses"] (modest + daughter without age → Kids category)**
- **"modest dress with long sleeves for my muslim daughter" → ["Girls Dresses"] (modest + muslim + daughter + long sleeves → Kids category)**
- **"conservative dress for my daughter" → ["Girls Dresses"] (conservative + daughter → Kids category)**
- **"traditional dress for daughter" → ["Girls Dresses"] (traditional + daughter → Kids category)**
- **"dress for my daughter" (no age, no context) → ["Girls Dresses"] (default to Kids unless other signals suggest adult)**
- "dress for my daughter for wedding" (no modesty context, wedding typically adult) → Consider both ["Girls Dresses", "Women's Dresses"], but if modesty context exists (e.g., "modest wedding dress for daughter"), prefer ["Girls Dresses"]
- "white cardigan for my 12 year old" → ["Tween Sweaters", "Girls Tops"] (12 year old is tween age, cardigan/sweater could be in both categories)
- "cardigan for 12 year old" → ["Tween Sweaters", "Girls Tops"] (return multiple relevant categories)
- "sweater for 10 year old" → ["Tween Sweaters", "Girls Tops"] (10 year old is tween, include both relevant categories)
- "dress for 12 year old" → ["Tween Dresses", "Girls Dresses"] (both could be relevant)
- "tween cardigan" → ["Tween Sweaters"] (specific tween category)
- "swimwear" → ["Swimsuits", "Bikini Sets", "Swim Cover-ups"]
- "pajamas" → ["Pajama Set", "Loungewear"]
- "perfume" → ["Perfumes"]
- "bedding" → ["Bedding"]
- "accessories" → ["Accessories", "Jewelry", "Hair Accessories"]
- "onesies for babies" → ["Baby & Toddler Bottoms", "Girls Tops"]
- "blazer" → ["Tops"] (blazers are specifically in Tops category, no age context, return single category for precision)
- "black blazer" → ["Tops"] (blazers are in Tops, not Bottoms or Accessories, no age context)
- "suits" → ["Tops", "Bottoms"] (suits are matching sets of jacket + pants/skirt)
- "tailored suits" → ["Tops", "Bottoms"] (professional suits)
- "matching sets" → ["Tops", "Bottoms"] or ["Tops", "Skirts"] depending on context

Output JSON with top 3 categories in order of relevance. Return ONLY the category name, not the description.`;

const CATEGORY_CLASSIFIER_SCHEMA = {
  name: 'category_classification',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['categories'],
    properties: {
      categories: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
        description: '1-3 most relevant categories in order of relevance (most relevant first). Return multiple categories (up to 3) when the query could match multiple age-specific categories, composite product types, or when product type could exist in multiple categories. For specific single-item queries without age context (e.g., "blazer"), you may return just 1 category for precision.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence score for the classification',
      },
    },
  },
};

/**
 * Classify a user query to the top 3 most relevant categories
 * 
 * @param query - User's shopping query
 * @param merchantId - Optional merchant ID for logging
 * @returns Array of top 3 category names (most relevant first), or empty array if classification fails
 */
export async function classifyQueryToCategories(
  query: string,
  merchantId?: string
): Promise<string[]> {
  const startTime = Date.now();
  
  logger.info('category_classifier: starting classification', {
    query: query.substring(0, 100),
    merchantId,
  });

  try {
    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a category classification system for a shopping assistant. The catalog includes multiple verticals: Kids, Women\'s/Adult Apparel, Accessories, Personal Care, and Home & Living (48 total categories). Map user queries to the most relevant product categories from any of these verticals. CRITICAL: Infer age groups from context clues (modest, muslim, conservative, traditional + daughter) to determine Kids vs Adult categories. Use the SAME age group inference logic as the constraint classifier.',
        },
        {
          role: 'user',
          content: `${CATEGORY_CLASSIFIER_PROMPT}\n\nUser query: "${query}"`,
        },
      ],
      purpose: 'intent', // Use lightweight model for speed
      expectJson: true,
      schema: CATEGORY_CLASSIFIER_SCHEMA,
      maxTokens: 200, // Limit response size for speed
    });

        const classification = JSON.parse(result.rawText) as {
          categories: string[];
          confidence?: number;
        };

        // Check confidence - if too low, return empty array
        const confidence = classification.confidence ?? 0.5; // Default to 0.5 if not provided
        if (confidence < 0.5) {
          logger.info('category_classifier: low_confidence_returning_empty', {
            query: query.substring(0, 100),
            confidence,
            merchantId,
          });
          return [];
        }

        // Extract only the category name (before "—" em dash or " - " dash)
        // This handles cases where the LLM returns the full description
        let categories = (classification.categories || []).map(cat => {
          // Remove description after em dash (—) or regular dash (-)
          const nameOnly = cat.split('—')[0].split(' - ')[0].trim();
          return nameOnly;
        }).filter(cat => cat.length > 0); // Remove empty strings
        
        // Post-process: Filter to only existing categories and map non-existent ones
        const validCategories: string[] = [];
        const invalidCategories: string[] = [];
        
        for (const cat of categories) {
          if (categoryExists(cat)) {
            validCategories.push(cat);
          } else {
            invalidCategories.push(cat);
            // Try to find closest match
            const closest = findClosestCategory(cat);
            if (closest && !validCategories.includes(closest)) {
              validCategories.push(closest);
              logger.debug('category_classifier: mapped_invalid_category', {
                original: cat,
                mapped: closest,
                query: query.substring(0, 100),
                merchantId,
              });
            }
          }
        }
        
        if (invalidCategories.length > 0) {
          logger.warn('category_classifier: invalid_categories_filtered', {
            invalid: invalidCategories,
            valid: validCategories,
            query: query.substring(0, 100),
            merchantId,
          });
        }
        
        categories = validCategories;
        
        const elapsed = Date.now() - startTime;

    logger.info('category_classifier: classification complete', {
      query: query.substring(0, 100),
      categories,
      categoryCount: categories.length,
      confidence: classification.confidence,
      elapsedMs: elapsed,
      merchantId,
    });

    // Return 1-3 categories (prioritize precision for specific queries)
    // For specific queries like "blazer", returning just ["Tops"] is better than ["Tops", "Bottoms", "Accessories"]
    // If we have more than 3, take the top 3
    const finalCategories = categories.slice(0, 3);
    
    logger.debug('category_classifier: returning_categories', {
      query: query.substring(0, 100),
      categories: finalCategories,
      categoryCount: finalCategories.length,
      merchantId,
    });
    
    return finalCategories;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    
    logger.error('category_classifier: classification failed', {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 100),
      elapsedMs: elapsed,
      merchantId,
    });

    // Fallback: return empty array to allow full catalog search
    return [];
  }
}

/**
 * Category classification result with confidence
 */
export type CategoryClassificationResult = {
  categories: string[];
  confidence: number;
};

/**
 * Classify a user query to categories with confidence information
 * Returns categories even when confidence is low (useful for follow-up questions)
 * 
 * @param query - User's shopping query
 * @param merchantId - Optional merchant ID for logging
 * @returns Category classification result with categories and confidence
 */
export async function classifyQueryToCategoriesWithConfidence(
  query: string,
  merchantId?: string
): Promise<CategoryClassificationResult> {
  const startTime = Date.now();
  
  logger.info('category_classifier: starting classification with confidence', {
    query: query.substring(0, 100),
    merchantId,
  });

  try {
    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a category classification system for a shopping assistant. The catalog includes multiple verticals: Kids, Women\'s/Adult Apparel, Accessories, Personal Care, and Home & Living (48 total categories). Map user queries to the most relevant product categories from any of these verticals. CRITICAL: Infer age groups from context clues (modest, muslim, conservative, traditional + daughter) to determine Kids vs Adult categories. Use the SAME age group inference logic as the constraint classifier.',
        },
        {
          role: 'user',
          content: `${CATEGORY_CLASSIFIER_PROMPT}\n\nUser query: "${query}"`,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: CATEGORY_CLASSIFIER_SCHEMA,
      maxTokens: 200,
    });

    const classification = JSON.parse(result.rawText) as {
      categories: string[];
      confidence?: number;
    };

    const confidence = classification.confidence ?? 0.5;

    // Extract only the category name (before "—" em dash or " - " dash)
    const categories = (classification.categories || []).map(cat => {
      const nameOnly = cat.split('—')[0].split(' - ')[0].trim();
      return nameOnly;
    }).filter(cat => cat.length > 0);

    const elapsed = Date.now() - startTime;

    logger.info('category_classifier: classification with confidence complete', {
      query: query.substring(0, 100),
      categories,
      categoryCount: categories.length,
      confidence,
      elapsedMs: elapsed,
      merchantId,
    });

    const finalCategories = categories.slice(0, 3);

    return {
      categories: finalCategories,
      confidence,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    
    logger.error('category_classifier: classification with confidence failed', {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 100),
      elapsedMs: elapsed,
      merchantId,
    });

    return {
      categories: [],
      confidence: 0.0,
    };
  }
}

/**
 * Maps user queries to the top 3 most relevant categories from the 49 category list
 * for hard SQL-level filtering before producttype-constraint filtering.
 */

