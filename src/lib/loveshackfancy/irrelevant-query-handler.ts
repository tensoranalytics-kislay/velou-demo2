/**
 * Intelligent Irrelevant Query Handler
 * 
 * Determines whether to redirect to products or deny gracefully based on:
 * - Available categories in catalog
 * - Product context
 * - Query relevance to catalog
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import { getCatalogOntology } from '../search/ontology';
import type { DatasetContext } from '../catalog/datasetInspector';

export type IrrelevantQueryDecision = 
  | { action: 'redirect'; reason: string; potentialCategories?: string[] }
  | { action: 'deny'; reason: string };

const AVAILABLE_CATEGORIES = [
  // Kids
  'Girls Tops', 'Girls Bottoms', 'Girls Dresses', 'Girls Swimwear',
  'Baby & Toddler Bottoms', 'Tween Pants', 'Tween Sweaters', 'Tween Dresses',
  // Women's/Adult Apparel
  "Women's Dresses", 'Tops', 'Bottoms', 'Skirts', 'Skorts', 'Activewear',
  'Swimsuits', 'Bikini Sets', 'Swim Cover-ups', 'Cold Weather Essentials',
  'Loungewear', 'Robes', 'Pajama Set', 'Shoes', 'Ski Jackets', 'Ski Tops',
  'Ski Shoes', 'Sweaters', 'Mini Dress', 'Maxi Dress', 'Tote Bags',
  // Accessories
  'Accessories', 'Jewelry', 'Hair Accessories', 'Pocket Squares',
  'Phone Cases', 'Soap Dispensers', 'Makeup Kit',
  // Personal Care
  'Perfumes',
  // Home & Living
  'Bedding', 'Bathroom', 'Towels', 'Tabletop', 'Kitchen & Dining',
  'Stationary', 'Interiors', 'Candle', 'Decorative Dishes', 'Fragrance Tray', 'Pets'
];

/**
 * Intelligently decide whether to redirect to products or deny gracefully
 */
export async function handleIrrelevantQuery(
  query: string,
  datasetContext?: DatasetContext | null,
  availableCategories?: string[],
  productContext?: Array<{ productId: string; title: string }>
): Promise<IrrelevantQueryDecision> {
  try {
    // Get available categories from catalog if not provided
    let categories = availableCategories;
    if (!categories || categories.length === 0) {
      try {
        const ontology = await getCatalogOntology();
        categories = ontology.categories || AVAILABLE_CATEGORIES;
      } catch (error) {
        logger.warn('failed_to_get_catalog_ontology_for_irrelevant_query', {
          error: error instanceof Error ? error.message : String(error),
        });
        categories = AVAILABLE_CATEGORIES; // Fallback to hardcoded list
      }
    }

    const categoriesText = categories.join(', ');
    const productContextText = productContext && productContext.length > 0
      ? `\n\nRecent products in conversation:\n${productContext.slice(0, 5).map(p => `- ${p.title}`).join('\n')}`
      : '';

    const datasetHint = datasetContext?.vertical
      ? `\n\nCatalog vertical: ${datasetContext.vertical}. Primary facets: ${datasetContext.primaryFacets?.slice(0, 10).join(', ') || 'N/A'}.`
      : '';

    const prompt = `Analyze this user query and determine if it could relate to our product catalog.

USER QUERY: "${query}"

AVAILABLE CATEGORIES IN OUR CATALOG (${categories.length} total):
${categoriesText}${datasetHint}${productContextText}

Your task:
1. Determine if this query could relate to ANY of our available categories (even loosely or indirectly)
2. Consider if the query mentions products we DON'T have (e.g., "dresses for animals", "cars", "electronics")
3. Decide on one of two actions:

ACTION 1 - REDIRECT (if query could relate to our catalog):
- Use when: Query mentions product types we have, even with unusual modifiers (e.g., "wedding dress for my dog" → we have dresses, but should acknowledge we don't have pet clothing)
- Use when: Query is vague but could relate (e.g., "something elegant" → we have elegant products)
- Use when: Query mentions categories we have but with incompatible constraints (e.g., "baby perfume" → we have perfumes, could suggest adult perfumes)
- Action: "redirect"
- Provide: potentialCategories (if any could be identified) and reason

ACTION 2 - DENY (if query is completely irrelevant):
- Use when: Query is about products we absolutely don't have (e.g., "cars", "electronics", "real estate")
- Use when: Query is about services, not products (e.g., "book a flight", "make a reservation")
- Use when: Query is completely non-shopping (e.g., "what's the weather?", "tell me a joke")
- Action: "deny"
- Provide: reason explaining why we can't help

CRITICAL RULES:
- DO NOT redirect if the query is about products we don't sell (e.g., "dresses for animals" when we only have human clothing)
- DO redirect if query mentions our product types even with unusual modifiers (we can suggest alternatives)
- Be intelligent: "wedding dress for my cat" → DENY (we don't have pet clothing)
- Be intelligent: "perfume for babies" → REDIRECT (we have perfumes, can suggest adult perfumes)
- Be intelligent: "something elegant for a wedding" → REDIRECT (we have elegant wedding products)

Output JSON:
{
  "action": "redirect" | "deny",
  "reason": "brief explanation",
  "potentialCategories": ["Category1", "Category2"] // Only if action is "redirect" and categories identified
}`;

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: `You are an intelligent query analyzer for a fashion/home decor shopping assistant. Your job is to determine if user queries could relate to the available product catalog, or if they should be gracefully denied. Be smart about what can be redirected vs what should be denied.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
    });

    const parsed = JSON.parse(result.rawText) as { action?: string; reason?: string; potentialCategories?: string[] };
    
    // Validate decision
    if (parsed.action !== 'redirect' && parsed.action !== 'deny') {
      logger.warn('invalid_irrelevant_query_decision', {
        action: parsed.action,
        query: query.substring(0, 100),
      });
      // Default to deny for safety
      return {
        action: 'deny',
        reason: "I'm not sure how to help with that, but I'd love to help you find something beautiful from our collection.",
      };
    }

    const decision: IrrelevantQueryDecision = parsed.action === 'redirect'
      ? {
          action: 'redirect',
          reason: parsed.reason || 'Could relate to our catalog',
          potentialCategories: parsed.potentialCategories,
        }
      : {
          action: 'deny',
          reason: parsed.reason || "I'm not sure how to help with that",
        };

    logger.info('irrelevant_query_decision_made', {
      query: query.substring(0, 100),
      action: decision.action,
      reason: decision.reason,
      potentialCategories: decision.action === 'redirect' ? decision.potentialCategories : undefined,
    });

    return decision;
  } catch (error) {
    logger.error('irrelevant_query_decision_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 100),
    });

    // Default to deny for safety
    return {
      action: 'deny',
      reason: "I'm not sure how to help with that, but I'd love to help you find something beautiful from our collection.",
    };
  }
}

/**
 * Generate intelligent denial reply in LSF brand voice
 */
export async function generateIntelligentDenial(
  query: string,
  reason: string,
  brandName: string = 'LoveShackFancy',
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  try {
    const historyContext = conversationHistory && conversationHistory.length > 0
      ? `\n\nConversation history:\n${conversationHistory.slice(-4).map(h => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    const prompt = `The user asked: "${query}"

Reason we can't help: ${reason}${historyContext}

Generate a warm, elegant denial reply in ${brandName}'s brand voice that:
1. Acknowledges their query naturally (show you understand what they asked)
2. Gracefully explains we can't help with that specific request
3. Maintains the warm, elegant, conversational tone with subtle romantic touches
4. Keeps it brief (2-3 sentences)
5. Does NOT try to redirect to products (this is a complete denial)
6. Be honest and graceful - don't force a product recommendation

BRAND VOICE - LOVE SHACK FANCY:
- Warm, elegant confidence: Conversational and polished, with subtle romantic touches
- Natural, feminine language: Warm, intimate, celebratory - but never overly precious
- Elegant restraint: Polished, curated, subtly sophisticated
- Write naturally as if having a friendly conversation

Example tone: "I understand you're looking for [their request], but that's not something we carry in our collection. I'd love to help you find something else though—what are you dreaming of?"`;

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: `You are a shopping assistant for ${brandName}, embodying the brand's warm, elegant voice. Your task is to generate a graceful denial when queries are completely irrelevant to the catalog. Write with warm, elegant confidence—conversational with subtle romantic touches. Use natural, feminine language that feels intimate but polished. Be honest, graceful, and maintain elegant restraint. Keep it to 2-3 sentences.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'final_reply',
      maxTokens: 150,
    });

    return result.rawText.trim();
  } catch (error) {
    logger.error('intelligent_denial_generation_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 100),
    });

    // Fallback
    return "I'm not sure how to help with that, but I'd love to help you find something beautiful from our collection. What are you looking for?";
  }
}

