/**
 * Query Categorizer
 * 
 * Categorizes queries into direct_search, indirect_search, or irrelevant.
 * This is used to determine if we need follow-up questions or can proceed directly.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';

export type QueryCategorization = {
  category: 'direct_search' | 'indirect_search' | 'irrelevant';
  confidence: number;
  preliminaryProducts?: Array<{
    productId: string;
    title: string;
    similarity: number;
  }>;
};

const QUERY_CATEGORIZER_PROMPT = `Categorize the user's shopping query into one of three categories:

1. **direct_search**: User mentions SPECIFIC PRODUCT TYPES or CATEGORIES explicitly (directly or through close synonyms)
   - **REQUIRED**: Must mention at least one product type/category (dress, top, bottom, skirt, swimsuit, bedding, perfume, etc.)
   - **CRITICAL**: If the query contains ANY category name or close synonym that maps to a product category, classify as "direct_search"
   - **Category detection**: Look for product type keywords:
     - Apparel: dress, dresses, top, tops, shirt, blouse, bottom, bottoms, pants, trousers, skirt, skirts, shorts, swimsuit, swimwear, bikini, loungewear, pajama, robe, sweater, cardigan, jacket, coat, activewear, sportswear
     - Accessories: jewelry, accessories, hair accessories, bag, bags, tote, wallet, belt, scarf
     - Personal Care: perfume, perfumes, fragrance, scents
     - Home: bedding, bed sheets, towels, candle, candles, decor, decoration, tabletop, kitchenware, dishware
   - Examples: "wedding dress", "maxi dress", "blue top", "swimsuits", "bedding", "towels", "perfume", "suggest me a dress", "help me find dresses", "I need a top", "something elegant" + "dress" → direct_search
   - **CRITICAL**: Even if the query contains "suggest me", "help me find", "what should I wear", "something to wear" - if it ALSO mentions a specific product type/category (or synonym), it MUST be "direct_search"
   - User knows what product category they want and provides specific details

2. **indirect_search**: User gives vague requests, gift requests, or needs clarification
   - **Key indicators**: "suggest me", "help me find", "what should I wear", "something to wear", "something for", "gift for", "what do you have?"
   - **CRITICAL**: ONLY classify as "indirect_search" if the query does NOT mention ANY specific product type/category (dress, top, bottom, skirt, swimsuit, bedding, perfume, etc.) or close synonyms
   - Examples: "something for a wedding" (NO product type), "gift for mom" (NO product type), "what do you have?" (NO product type), "something elegant" (NO product type), "I need help finding..." (NO product type), "suggest me something to wear" (NO product type), "am a curvy mom, suggest me something" (NO product type)
   - **If query contains category keywords** (even with "suggest me") → MUST be "direct_search", NOT "indirect_search"
   - User needs guidance or clarification to determine which product category they want

3. **irrelevant**: Not shopping-related and does NOT match any of the 48 product categories
   - Examples: "what's the weather?", "tell me a joke", "do you sell cars?"
   - Completely unrelated to shopping

**CRITICAL CLASSIFICATION RULES - FOLLOW THESE EXACTLY:**

**PRIMARY RULE: Category Detection Override**
- **If the query contains ANY category name or close synonym (dress, dresses, top, tops, shirt, blouse, bottom, bottoms, pants, trousers, skirt, skirts, shorts, swimsuit, swimwear, bikini, loungewear, pajama, robe, sweater, cardigan, jacket, coat, activewear, sportswear, jewelry, accessories, perfume, fragrances, bedding, towels, candle, candles, decor, decoration, tabletop, etc.) → MUST be "direct_search"**
- This rule takes precedence over any phrasing like "suggest me", "help me find", "what should I wear"

**Examples:**
- **"suggest me something"** (NO product type) → "indirect_search" (e.g., "suggest me something elegant", "curvy mom, suggest me something")
- **"suggest me a dress"** → "direct_search" (contains "suggest me" BUT mentions category: "dress")
- **"suggest me dresses"** → "direct_search" (mentions category: "dresses")
- **"suggest me something elegant with a dress"** → "direct_search" (mentions category: "dress", even with "suggest me something")
- **"help me find something"** (NO product type) → "indirect_search" (e.g., "help me find something for a wedding")
- **"help me find a dress"** → "direct_search" (mentions category: "dress")
- **"help me find dresses"** → "direct_search" (mentions category: "dresses")
- **"what should I wear"** → "indirect_search" (no specific product type)
- **"what dress should I wear"** → "direct_search" (mentions category: "dress")
- **"something to wear"** → "indirect_search" (no specific product type)
- **"something elegant"** → "indirect_search" (mentions attribute but NO product type)
- **"something elegant dress"** → "direct_search" (mentions category: "dress")
- **"gift for mom"** → "indirect_search" (NO product type)
- **"gift dress for mom"** → "direct_search" (mentions category: "dress")
- **"wedding dress"** → "direct_search" (mentions category: "dress")
- **"blue top"** → "direct_search" (mentions category: "top")
- **"I have shoes, suggest me a dress"** → "direct_search" (mentions category: "dress", even with "suggest me")

**REMEMBER: The key distinction is whether ANY PRODUCT TYPE/CATEGORY is mentioned (directly or through synonyms):**
- **HAS product type/category** → "direct_search" (always, regardless of phrasing)
- **NO product type/category** → "indirect_search" (query is vague and needs clarification)

The catalog includes 48 categories across 5 groups:
- Kids: Girls Tops, Girls Bottoms, Girls Dresses, Girls Swimwear, Baby & Toddler Bottoms, Tween Pants, Tween Sweaters, Tween Dresses
- Women's/Adult Apparel: Women's Dresses, Tops, Bottoms, Skirts, Skorts, Activewear, Swimsuits, Bikini Sets, Swim Cover-ups, Cold Weather Essentials, Loungewear, Robes, Pajama Set, Shoes, Ski Jackets, Ski Tops, Ski Shoes, Sweaters, Mini Dress, Maxi Dress, Tote Bags
- Accessories: Accessories, Jewelry, Hair Accessories, Pocket Squares, Phone Cases, Soap Dispensers, Makeup Kit
- Personal Care: Perfumes
- Home & Living: Bedding, Bathroom, Towels, Tabletop, Kitchen & Dining, Stationary, Interiors, Candle, Decorative Dishes, Fragrance Tray, Pets

QUERY: "{QUERY}"

Output JSON:
{
  "category": "direct_search" | "indirect_search" | "irrelevant",
  "confidence": 0.0-1.0,
  "preliminaryProducts": [] // Optional: if category is indirect_search and you found some relevant products, include them here
}`;

/**
 * Categorize a user query
 * 
 * @param query - User's shopping query
 * @param datasetContext - Optional dataset context for better understanding
 * @param merchantId - Optional merchant ID for logging
 * @returns Query categorization result
 */
export async function categorizeQuery(
  query: string,
  datasetContext?: any,
  merchantId?: string
): Promise<QueryCategorization> {
  const startTime = Date.now();

  logger.debug('query_categorizer: starting', {
    query: query.substring(0, 100),
    merchantId,
  });

  try {
    const prompt = QUERY_CATEGORIZER_PROMPT.replace('{QUERY}', query);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a query categorizer for a fashion shopping assistant. Categorize queries accurately.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: {
        name: 'QueryCategorization',
        schema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['direct_search', 'indirect_search', 'irrelevant'],
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            preliminaryProducts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  productId: { type: 'string' },
                  title: { type: 'string' },
                  similarity: { type: 'number' },
                },
                required: ['productId', 'title', 'similarity'],
              },
            },
          },
          required: ['category', 'confidence'],
        },
      },
    });

    const categorization = JSON.parse(result.rawText) as QueryCategorization;

    // Validate category
    const validCategories = ['direct_search', 'indirect_search', 'irrelevant'];
    if (!validCategories.includes(categorization.category)) {
      logger.warn('query_categorizer: invalid category', {
        category: categorization.category,
        query: query.substring(0, 100),
      });
      categorization.category = 'irrelevant';
      categorization.confidence = 0.5;
    }

    const duration = Date.now() - startTime;
    logger.debug('query_categorizer: complete', {
      query: query.substring(0, 100),
      category: categorization.category,
      confidence: categorization.confidence,
      duration,
    });

    return categorization;
  } catch (error) {
    logger.error('query_categorizer: failed', {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 100),
    });

    // Fallback: try to determine category from simple patterns
    const queryLower = query.toLowerCase();
    
    // Irrelevant patterns
    const irrelevantPatterns = [
      'weather', 'joke', 'time', 'date', 'calendar', 'news', 'sports', 'score',
      'recipe', 'cooking', 'recipe', 'how to', 'what is', 'who is', 'where is',
    ];
    
    if (irrelevantPatterns.some(pattern => queryLower.includes(pattern))) {
      return {
        category: 'irrelevant',
        confidence: 0.8,
      };
    }

    // Direct search patterns
    const directSearchPatterns = [
      'dress', 'top', 'bottom', 'skirt', 'swimsuit', 'bikini', 'shoes', 'jewelry',
      'bedding', 'towel', 'perfume', 'candle', 'decor', 'tabletop', 'accessory',
    ];

    if (directSearchPatterns.some(pattern => queryLower.includes(pattern))) {
      return {
        category: 'direct_search',
        confidence: 0.7,
      };
    }

    // Default to indirect search
    return {
      category: 'indirect_search',
      confidence: 0.6,
    };
  }
}
