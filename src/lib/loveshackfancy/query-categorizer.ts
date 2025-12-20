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

1. **direct_search**: User mentions specific product types, categories, or attributes
   - Examples: "wedding dress", "maxi dress", "blue top", "swimsuits", "bedding", "towels", "perfume"
   - User knows what they want and provides specific details

2. **indirect_search**: User gives vague requests, gift requests, or needs clarification
   - Examples: "something for a wedding", "gift for mom", "what do you have?", "something elegant", "I need help finding..."
   - User needs guidance or clarification

3. **irrelevant**: Not shopping-related and doesn't match any of the 48 product categories
   - Examples: "what's the weather?", "tell me a joke", "do you sell cars?"
   - Completely unrelated to shopping
   - **IMPORTANT**: If the query mentions a valid product category (perfumes, dresses, bedding, etc.), it should be "direct_search" even if combined with unusual modifiers (e.g., "perfumes for toddler" is still direct_search because "perfumes" is a valid category)

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
