/**
 * Category Classification System
 * 
 * Maps user queries to the top 3 most relevant categories from the 49 category list
 * for hard SQL-level filtering before producttype-constraint filtering.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';

const CATEGORY_CLASSIFIER_PROMPT = `You are a category classification system for a fashion shopping assistant.

Your job is to map user shopping queries to the most relevant product categories from the catalog.

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
2. **CRITICAL: Only return categories if you are confident (confidence >= 0.5). If the query is too vague to determine category (e.g., "something elegant", "gift for someone"), return an empty categories array and set confidence < 0.5.**
3. **For specific single-item queries (e.g., "blazer", "black blazer", "dress"), return ONLY the most relevant category (e.g., ["Tops"] for blazer, ["Women's Dresses"] for dress)**
4. **For ambiguous queries (e.g., "suits", "matching sets"), return up to 3 categories in order of relevance**
5. Return categories in order of relevance (most relevant first)
6. **CRITICAL: Return ONLY the category name (the text before the "—" em dash), NOT the description**
   - Correct: "Girls Tops"
   - Wrong: "Girls Tops — Kids tops/outerwear-like items..."
   - Correct: "Baby & Toddler Bottoms"
   - Wrong: "Baby & Toddler Bottoms — Baby/toddler bottoms..."
7. Use the exact category names as listed above (e.g., "Women's Dresses", "Tops", "Girls Dresses", "Baby & Toddler Bottoms")
8. **DO NOT return "Uncategorized" - it is not a valid category for filtering**
9. If the query is ambiguous or could match multiple categories, prioritize the most specific match
10. Consider age groups: 
    - **Kids categories (Girls Dresses, Girls Tops, etc.)**: queries mentioning "kids", "children", "toddler", "baby", "infant", "little girl", "little boy" (typically ages 0-12)
    - **Teen/Adult categories (Women's Dresses, Tops, etc.)**: queries mentioning "teen", "teenager", "teenage", "teenage daughter", "teenage son", "teenage girl", "teenage boy", "juvenile", "youth", "adolescent", "young adult", "pre-teen", "tween" (ages 13-19) should map to ADULT categories like "Women's Dresses", "Tops", etc., NOT kids categories
    - **CRITICAL**: "teen", "teenager", "teenage" → "Women's Dresses" (NOT "Girls Dresses")
    - **CRITICAL**: "for my teen daughter" or "for teenage daughter" → "Women's Dresses" (NOT "Girls Dresses")
11. Consider product types: "dress" → "Women's Dresses", "top" → "Tops", "swim" → "Swimsuits" or "Bikini Sets"
12. Consider context: "beach" might map to "Swimsuits", "Swim Cover-ups", or "Beach Towels"
13. **For specific single-item queries, be precise**:
    - "blazer" → ["Tops"] (blazers are in Tops category, NOT Bottoms or Accessories)
    - "jacket" → ["Tops"] (jackets are in Tops category)
    - "sweater" → ["Tops", "Sweaters"] if Sweaters is a separate category, otherwise ["Tops"]
14. **For composite product types** (items made of multiple pieces):
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
- "swimwear" → ["Swimsuits", "Bikini Sets", "Swim Cover-ups"]
- "pajamas" → ["Pajama Set", "Loungewear"]
- "perfume" → ["Perfumes"]
- "bedding" → ["Bedding"]
- "accessories" → ["Accessories", "Jewelry", "Hair Accessories"]
- "onesies for babies" → ["Baby & Toddler Bottoms", "Girls Tops"]
- "blazer" → ["Tops"] (blazers are specifically in Tops category)
- "black blazer" → ["Tops"] (blazers are in Tops, not Bottoms or Accessories)
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
        description: '1-3 most relevant categories in order of relevance (most relevant first). For specific single-item queries (e.g., "blazer", "dress"), return only the most relevant category. For ambiguous queries, return up to 3 categories.',
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
          content: 'You are a category classification system for a shopping assistant. The catalog includes multiple verticals: Kids, Women\'s/Adult Apparel, Accessories, Personal Care, and Home & Living (48 total categories). Map user queries to the most relevant product categories from any of these verticals.',
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
        const categories = (classification.categories || []).map(cat => {
          // Remove description after em dash (—) or regular dash (-)
          const nameOnly = cat.split('—')[0].split(' - ')[0].trim();
          return nameOnly;
        }).filter(cat => cat.length > 0); // Remove empty strings
        
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
          content: 'You are a category classification system for a shopping assistant. The catalog includes multiple verticals: Kids, Women\'s/Adult Apparel, Accessories, Personal Care, and Home & Living (48 total categories). Map user queries to the most relevant product categories from any of these verticals.',
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


