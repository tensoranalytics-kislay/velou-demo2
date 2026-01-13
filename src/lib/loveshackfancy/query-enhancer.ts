/**
 * Query Enhancer
 * 
 * Merges vague queries with user clarifications into enhanced,
 * searchable query text and extracts structured constraints.
 */

import { callLLM } from '../llm/provider';
import { embedText } from '../search/vector/index';
import { logger } from '../telemetry/logger';
import type { DatasetContext } from '../catalog/datasetInspector';

export type EnhancedQuery = {
  enhancedQueryText: string; // Merged query for embedding
  constraints: Record<string, unknown>; // Extracted constraints
};

const QUERY_ENHANCER_PROMPT = `You are a query enhancement system that merges vague queries with user clarifications.

ORIGINAL VAGUE QUERY: "{ORIGINAL_QUERY}"

USER CLARIFICATIONS:
{USER_RESPONSES}

PRELIMINARY PRODUCTS (for context):
{PRELIMINARY_PRODUCTS}

DATASET CONTEXT:
{DATASET_CONTEXT}

AVAILABLE CATEGORIES:
{CATEGORIES_LIST}

CATALOG INCLUDES 5 CATEGORY GROUPS (48 total categories):
1. **Kids Categories**: Girls Tops, Girls Bottoms, Girls Dresses, Girls Swimwear, Baby & Toddler Bottoms, Tween Pants, Tween Sweaters, Tween Dresses
2. **Women's/Adult Apparel**: Women's Dresses, Tops, Hoodies, Sweaters, Bottoms, Skirts, Skorts, Activewear, Swimsuits, Bikini Sets, Swim Cover-ups, Cold Weather Essentials, Loungewear, Robes, Pajama Set, Shoes, Ski Jackets, Ski Tops, Ski Shoes, Mini Dress, Maxi Dress, Tote Bags
3. **Accessories**: Accessories, Jewelry, Hair Accessories, Pocket Squares, Phone Cases, Soap Dispensers, Makeup Kit
4. **Personal Care**: Perfumes
5. **Home & Living**: Bedding, Bathroom, Towels, Tabletop, Kitchen & Dining, Stationary, Interiors, Candle, Decorative Dishes, Fragrance Tray, Pets

Your task:
1. **CRITICAL: User clarifications take ABSOLUTE precedence** - If the user's clarification response explicitly mentions a specific product type (hoodies, dresses, tops, jewelry, bedding, etc.), that product type MUST be the ONLY product type in the enhanced query. Do NOT include product types from preliminary products if the user explicitly mentions a different product type.
   - **If user says "looking for hoodies"** → Enhanced query MUST be "hoodies" or "hoodies for women" (NOT "hoodies and dresses")
   - **If user says "show me dresses"** → Enhanced query MUST be "dresses" or "dresses for women" (NOT "dresses and tops")
   - **Do NOT infer product types from preliminary products** when user explicitly mentions a different product type
2. **Preserve the original query's category/domain** - The catalog includes 5 category groups. If the original query mentions ANY category from a specific group, the enhanced query MUST maintain that group's context (only if user clarification doesn't explicitly mention a product type):
   - Kids: "kids", "children", "baby", "toddler", "girls" → keep in Kids categories
   - Fashion/Apparel: "dress", "top", "skirt", "swimsuit", "loungewear", "hoodie", "hoodies" → keep in Women's/Adult Apparel
   - Accessories: "jewelry", "hair accessories", "bags" → keep in Accessories
   - Personal Care: "perfume", "fragrance" → keep in Personal Care
   - Home & Living: "room decor", "home items", "bedding", "decor items", "tabletop", "interiors", "candles", "towels" → keep in Home & Living
3. Merge the original vague query with user clarifications, prioritizing the user's specific product type mention
4. Create an enhanced, specific query text that captures all the information
5. Extract structured constraints from the merged information

The enhanced query should:
- **INCLUDE ONLY the product type from user clarifications**: If user says "hoodies", "dresses", "tops", etc., the enhanced query MUST include ONLY that product type (e.g., "hoodies", "hoodies for women", "black hoodies"). Do NOT include product types from preliminary products if user explicitly mentions a different product type.
- **IGNORE preliminary products if user explicitly mentions a product type**: If user says "looking for hoodies", ignore any dresses or other product types shown in preliminary products. The enhanced query should be "hoodies" or "hoodies for women", NOT "hoodies and dresses".
- **PRESERVE the original query's category group**: Do NOT convert queries from one category group to another (e.g., don't convert "room decor" to "accessories", don't convert "kids dresses" to "women's dresses")
- Be specific and searchable (e.g., "floral maxi dress for beach wedding under $400" OR "cute decorative dishes for living room" OR "bedding sets with floral patterns" OR "jewelry with pearls" OR "perfumes for women" OR "dresses for kids")
- Include ALL relevant attributes mentioned (category, style, occasion, price, etc.)
- CRITICAL: Convert vague/generic terms to specific product types based on the ORIGINAL query context:
  * For KIDS queries: "clothes", "outfit", "piece" → infer specific category (e.g., "dress", "top", "onesie", "bodysuit") based on context
  * For FASHION/APPAREL queries: "attire", "clothing", "garments", "piece", "item" → infer specific category (e.g., "dress", "top", "skirt", "pants") based on context
  * For ACCESSORIES queries: "accessories", "jewelry", "bags" → infer specific category (e.g., "jewelry", "hair accessories", "bags") based on context
  * For PERSONAL CARE queries: "fragrance", "perfume" → infer specific category (e.g., "perfumes")
  * For HOME & LIVING queries: "decor items", "home items", "room decor", "stuff" → infer specific category (e.g., "decorative dishes", "candles", "bedding", "tabletop items", "interiors") based on context
  * For wedding/formal occasions: "attire" → "dress" or "formal dress" (unless context suggests suit, jumpsuit, etc.)
  * For casual contexts: "attire" → infer based on context (e.g., "top", "dress", "outfit")
  * Always replace generic terms with the most appropriate specific product category FROM THE SAME CATEGORY GROUP as the original query
- Include style descriptors when mentioned (e.g., "maxi", "mini", "formal", "cute", "elegant")
- Include occasion when mentioned (e.g., "beach wedding", "office", "living room")
- Use natural language that would match product descriptions
- NOT include filler phrases like "show me" or "I want"

Examples:
- Original: "suggest me something to wear" + "hoodies" → Enhanced: "hoodies" or "hoodies for women" (user's clarification "hoodies" is included, NO dresses from preliminary products)
- Original: "help me find something" + "dresses" → Enhanced: "dresses" or "dresses for women" (user's clarification "dresses" is included, NO other product types)
- Original: "suggest me something to wear" (preliminary products show dresses) + "looking for hoodies" → Enhanced: "hoodies" or "hoodies for women" (ONLY hoodies, NOT "hoodies and dresses")
- Original: "am a curvy mom, suggest me something" (preliminary products show dresses) + "looking for hoodies" → Enhanced: "hoodies for curvy women" (ONLY hoodies, NOT "hoodies and dresses")
- Original: "room decor" + "just some cute stuffs" → Enhanced: "cute decorative items for room decor" or "cute home decor items" (NOT "cute women's accessories")
- Original: "bedding" + "floral patterns" → Enhanced: "bedding sets with floral patterns" (NOT "floral dresses")
- Original: "dress for wedding" + "maxi length" → Enhanced: "maxi dress for wedding" (fashion domain preserved)
- Original: "jewelry" + "with pearls" → Enhanced: "jewelry with pearls" (accessories domain preserved)
- Original: "perfumes" + "for women" → Enhanced: "perfumes for women" (personal care domain preserved)
- Original: "dresses for kids" + "pink color" → Enhanced: "pink dresses for kids" (kids domain preserved)

Output JSON:
{
  "enhancedQueryText": "specific merged query text",
  "constraints": {
    "category": "dress" | "bedding" | "decorative dishes" | null,
    "priceMaxCents": 40000 | null,
    "occasions": ["beach wedding"] | null,
    "styles": ["maxi"] | null,
    "patterns": ["floral"] | null
  }
}`;

export async function enhanceQuery(
  originalQuery: string,
  userResponses: string[], // Array of follow-up responses
  preliminaryProducts?: Array<{ productId: string; title: string; similarity: number }>,
  datasetContext?: DatasetContext | null
): Promise<EnhancedQuery> {
  try {
    const datasetHint = datasetContext?.vertical
      ? `Vertical: ${datasetContext.vertical}.`
      : 'Generic catalog.';
    
    // Include sample categories from dataset context to help LLM understand available categories
    const categoriesList = datasetContext?.sampleCategories && datasetContext.sampleCategories.length > 0
      ? `Available categories in catalog:\n${datasetContext.sampleCategories.slice(0, 20).map(c => `- ${c}`).join('\n')}`
      : `Available categories include 5 groups (48 total):
- Kids: Girls Tops, Girls Bottoms, Girls Dresses, Girls Swimwear, Baby & Toddler Bottoms, Tween categories
- Women's/Adult Apparel: Women's Dresses, Tops, Bottoms, Skirts, Swimsuits, Loungewear, Shoes, etc.
- Accessories: Accessories, Jewelry, Hair Accessories, Phone Cases, etc.
- Personal Care: Perfumes
- Home & Living: Bedding, Tabletop, Interiors, Decorative Dishes, Candles, Towels, etc.`;

    const responsesContext = userResponses
      .map((r, i) => `Response ${i + 1}: "${r}"`)
      .join('\n');

    const productsContext = preliminaryProducts && preliminaryProducts.length > 0
      ? preliminaryProducts
          .slice(0, 3)
          .map(p => `- ${p.title}`)
          .join('\n')
      : 'None';

    const prompt = QUERY_ENHANCER_PROMPT
      .replace('{ORIGINAL_QUERY}', originalQuery)
      .replace('{USER_RESPONSES}', responsesContext)
      .replace('{PRELIMINARY_PRODUCTS}', productsContext)
      .replace('{DATASET_CONTEXT}', datasetHint)
      .replace('{CATEGORIES_LIST}', categoriesList);

    // Check if user responses mention specific product types
    const allResponses = userResponses.join(' ').toLowerCase();
    const hasProductTypeInResponse = /(?:looking\s+for|show\s+me|I\s+want|need|want)\s+(?:hoodie|hoodies|dress|dresses|top|tops|skirt|skirts|pants|joggers|swimsuit|swimsuits|jewelry|perfume|bedding|decor|accessories|bag|bags|sweater|sweaters|cardigan|cardigans|jacket|jackets|coat|coats|blazer|blazers|loungewear|activewear|shoes|sneakers|boots|pajama|pajamas|pjs|robe|robes)/i.test(allResponses) ||
      /^(?:hoodie|hoodies|dress|dresses|top|tops|skirt|skirts|pants|joggers|swimsuit|swimsuits|jewelry|perfume|bedding|decor|accessories|bag|bags|sweater|sweaters|cardigan|cardigans|jacket|jackets|coat|coats|blazer|blazers|loungewear|activewear|shoes|sneakers|boots|pajama|pajamas|pjs|robe|robes)/i.test(allResponses);
    
    // Determine system prompt based on original query context - detect all category groups
    const isKidsQuery = /kids|children|child|baby|toddler|girls|tween/i.test(originalQuery);
    const isAccessoriesQuery = /jewelry|accessories|hair accessories|bags|phone case|soap dispenser|makeup/i.test(originalQuery);
    const isPersonalCareQuery = /perfume|fragrance/i.test(originalQuery);
    const isHomeLivingQuery = /room|decor|home|bedding|tabletop|interior|candle|towel|bathroom|kitchen|dining|stationary|pet/i.test(originalQuery);
    
    let systemPrompt = 'You are a query enhancement system for a shopping assistant. The catalog includes 5 category groups: Kids, Women\'s/Adult Apparel, Accessories, Personal Care, and Home & Living. Your key task is to convert vague/generic terms into specific product categories while preserving the original query\'s category group.';
    
    // CRITICAL: If user responses mention specific product types, prioritize those
    if (hasProductTypeInResponse) {
      systemPrompt = 'You are a query enhancement system for a shopping assistant. CRITICAL: The user\'s clarification response explicitly mentions a specific product type (hoodies, dresses, tops, etc.). You MUST create an enhanced query that includes ONLY that product type. Do NOT include product types from preliminary products or the original vague query if the user explicitly mentioned a different product type. The enhanced query should start with or prominently feature the product type the user mentioned. If preliminary products show different product types (e.g., dresses), ignore them and use ONLY the product type the user explicitly mentioned (e.g., hoodies).';
    } else if (isKidsQuery) {
      systemPrompt = 'You are a query enhancement system for a shopping assistant. CRITICAL: If the original query mentions "kids", "children", "baby", "toddler", "girls", you MUST preserve that Kids category context. Do NOT convert Kids queries to adult categories. Convert vague terms to specific product categories within Kids categories (e.g., "dress" → "kids dress", "onesie", "bodysuit").';
    } else if (isAccessoriesQuery) {
      systemPrompt = 'You are a query enhancement system for a shopping assistant. CRITICAL: If the original query mentions "jewelry", "accessories", "bags", "hair accessories", you MUST preserve that Accessories context. Do NOT convert Accessories queries to apparel. Convert vague terms to specific product categories within Accessories.';
    } else if (isPersonalCareQuery) {
      systemPrompt = 'You are a query enhancement system for a shopping assistant. CRITICAL: If the original query mentions "perfume" or "fragrance", you MUST preserve that Personal Care context. Convert vague terms to specific product categories within Personal Care.';
    } else if (isHomeLivingQuery) {
      systemPrompt = 'You are a query enhancement system for a shopping assistant. CRITICAL: If the original query mentions "room decor", "home items", "bedding", "decor items", etc., you MUST preserve that Home & Living context. Do NOT convert Home & Living queries to fashion/apparel. Convert vague terms to specific product categories within Home & Living.';
    } else {
      systemPrompt = 'You are a query enhancement system for a shopping assistant. The catalog includes multiple category groups (Kids, Women\'s/Adult Apparel, Accessories, Personal Care, Home & Living). Convert vague/generic terms into specific product categories based on context, while preserving the original query\'s category group. For fashion/apparel queries: "attire", "clothing", "garments", "piece", "item" → infer specific category (dress, top, skirt, pants, jumpsuit, etc.).';
    }

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: {
        name: 'EnhancedQuery',
        schema: {
          type: 'object',
          properties: {
            enhancedQueryText: { type: 'string' },
            constraints: { type: 'object' },
          },
          required: ['enhancedQueryText', 'constraints'],
        },
      },
    });

    const enhanced = JSON.parse(result.rawText) as EnhancedQuery;

    logger.debug('query_enhanced', {
      originalQuery: originalQuery.substring(0, 100),
      enhancedQuery: enhanced.enhancedQueryText,
      responseCount: userResponses.length,
    });

    return enhanced;
  } catch (error) {
    logger.error('query_enhancement_failed', {
      error: error instanceof Error ? error.message : String(error),
      originalQuery: originalQuery.substring(0, 100),
    });

    // Fallback: concatenate original query with responses
    const fallbackQuery = [originalQuery, ...userResponses]
      .filter(Boolean)
      .join(' ');
    
    return {
      enhancedQueryText: fallbackQuery,
      constraints: {},
    };
  }
}

/**
 * Generate enhanced vector embedding from merged query
 */
export async function createEnhancedVectorQuery(
  enhancedQuery: EnhancedQuery
): Promise<number[]> {
  return embedText(enhancedQuery.enhancedQueryText);
}

