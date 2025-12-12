/**
 * RAG Reply Generation
 * 
 * Generates conversational replies using retrieved product facts.
 * Uses LLM with RAG (Retrieval Augmented Generation) approach:
 * - Only references provided products (no catalog search in LLM)
 * - Concise, helpful replies
 * - Optional follow-up suggestions
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 4)
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import { stripJsonFences } from '../llm/orchestrator/utils';
import type { QueryClassification } from './classifier';
import type { ProductWithLoccitaneAttributes } from './ranking/features';
import { LOCCITANE_RAG_REPLY_PROMPT, LOCCITANE_RAG_REPLY_SCHEMA } from './prompts';

export type LocciReplyResult = {
  replyText: string;
  followupText?: string;
};

/**
 * Serialize product for RAG prompt (lightweight representation)
 */
function serializeProductForRag(product: ProductWithLoccitaneAttributes): Record<string, unknown> {
  const structured = product.attributes.loccitaneStructured;
  
  return {
    title: product.title,
    collection: product.attributes.collection || null,
    category: product.category,
    priceCents: product.salePriceCents || product.priceCents,
    currency: product.currency,
    concerns: structured.canonicalConcerns,
    skinTypes: structured.skinTypes,
    applicationAreas: structured.applicationAreas,
    featuredIngredients: structured.canonicalIngredients.slice(0, 5), // Top 5 ingredients
    madeWithout: structured.madeWithout,
    productType: structured.productType,
    formula: structured.formula,
  };
}

/**
 * Generate reply with RAG over retrieved products
 * 
 * Uses LLM to generate a concise, helpful reply based on retrieved product facts.
 * Only references the provided products (no hallucinated SKUs).
 * 
 * @param query - Original user query
 * @param classification - Query classification with extracted constraints
 * @param topProducts - Top-ranked products to reference (typically 4, matching displayed products)
 * @param merchantId - Optional merchant ID
 * @returns Reply text and optional follow-up suggestions
 */
export async function generateReplyWithRag(
  query: string,
  classification: QueryClassification,
  topProducts: ProductWithLoccitaneAttributes[],
  merchantId?: string,
  productContext?: ProductWithLoccitaneAttributes | null
): Promise<LocciReplyResult> {
  try {
    // Serialize products for prompt
    const serializedProducts = topProducts.map(p => serializeProductForRag(p));
    
    // Build prompt with classification and products
    const systemPrompt = LOCCITANE_RAG_REPLY_PROMPT;
    
    // Add product context information if this is a product-specific query
    let contextNote = '';
    if (productContext) {
      // Find the product context in the serialized products
      const contextProductIndex = topProducts.findIndex(tp => tp.id === productContext.id);
      if (contextProductIndex >= 0 && contextProductIndex < serializedProducts.length) {
        const contextProduct = serializedProducts[contextProductIndex];
        contextNote = `\n\n⚠️ CRITICAL: This is a PRODUCT-SPECIFIC Q&A session. The user has selected a specific product and is asking questions about it.

SELECTED PRODUCT: "${contextProduct.title}" (ID: ${productContext.id})

Your reply MUST:
1. Answer the user's question DIRECTLY using ONLY the information from the selected product above
2. Reference the product by name: "${contextProduct.title}"
3. Use ALL available product details to answer:
   - Ingredients (mustHaveIngredients, featuredIngredients, allIngredients)
   - Benefits and concerns addressed (concerns, benefits)
   - Skin/hair types (skinTypes, hairTypes)
   - Application areas and usage instructions
   - Product type, format, size, SPF, etc.
   - Any other attributes present in the product data
4. Be detailed and informative - use the full product information to provide comprehensive answers
5. Do NOT suggest other products
6. Do NOT do product discovery or show alternatives
7. If the user asks "what is this?", provide a detailed description using all product attributes
8. If the user asks "is this good for X?", check the product's concerns, skinTypes, ingredients, etc. and answer based on that data
9. If the user asks about ingredients, list them from the product data
10. If the user asks about usage, explain based on applicationAreas, productType, format, etc.

The user's question: "${query}"
Answer this question about "${contextProduct.title}" using the complete product information provided above.`;
      }
    }
    
    const userContent = `User query: "${query}"

Query classification:
${JSON.stringify(classification, null, 2)}

Retrieved products (only reference these):
${JSON.stringify(serializedProducts, null, 2)}${contextNote}

Generate a helpful reply that references only the products above.`;

    const result = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      purpose: 'final_reply',
      expectJson: true,
      schema: LOCCITANE_RAG_REPLY_SCHEMA,
    });
    
    // Parse JSON response
    try {
      const cleaned = stripJsonFences(result.rawText);
      const parsed = JSON.parse(cleaned) as { replyText: string; followupText?: string };
      
      // Validate required fields
      if (!parsed.replyText || typeof parsed.replyText !== 'string') {
        throw new Error('Missing or invalid replyText in LLM response');
      }
      
      logger.debug('generateReplyWithRag: success', {
        queryType: classification.type,
        productCount: topProducts.length,
        hasFollowup: !!parsed.followupText,
        replyLength: parsed.replyText.length,
      });
      
      return {
        replyText: parsed.replyText.trim(),
        followupText: parsed.followupText?.trim(),
      };
    } catch (parseError) {
      logger.warn('generateReplyWithRag: JSON parse error, using fallback', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        rawText: result.rawText.substring(0, 200),
      });
      
      // Fallback to template-based reply
      return generateFallbackReply(query, classification, topProducts);
    }
  } catch (error) {
    logger.error('generateReplyWithRag: LLM call failed', {
      error: error instanceof Error ? error.message : String(error),
      queryType: classification.type,
      productCount: topProducts.length,
    });
    
    // Fallback to template-based reply
    return generateFallbackReply(query, classification, topProducts);
  }
}

/**
 * Generate fallback reply when LLM fails or JSON parsing fails
 */
function generateFallbackReply(
  query: string,
  classification: QueryClassification,
  products: ProductWithLoccitaneAttributes[]
): LocciReplyResult {
  if (products.length === 0) {
    return {
      replyText: "I couldn't find any products matching your request. Could you try rephrasing your search?",
      followupText: "What are you looking for? I can help you find products for specific concerns, ingredients, or product types.",
    };
  }
  
  // Build simple template-based reply
  const productNames = products.slice(0, 3).map(p => p.title).join(', ');
  const moreCount = products.length > 3 ? products.length - 3 : 0;
  
  let replyText = '';
  switch (classification.type) {
    case 'direct_product_search':
      replyText = `Here are ${products.length} product${products.length > 1 ? 's' : ''} matching your search: ${productNames}${moreCount > 0 ? `, and ${moreCount} more` : ''}.`;
      break;
    case 'symptom_concern':
      const concerns = classification.constraints.concerns?.join(' and ') || 'your concerns';
      replyText = `I found ${products.length} product${products.length > 1 ? 's' : ''} that address ${concerns}: ${productNames}${moreCount > 0 ? `, and ${moreCount} more` : ''}.`;
      break;
    case 'ingredient_exploration':
      const ingredients = classification.constraints.mustHaveIngredients?.join(', ') || 'those ingredients';
      replyText = `I found ${products.length} product${products.length > 1 ? 's' : ''} with ${ingredients}: ${productNames}${moreCount > 0 ? `, and ${moreCount} more` : ''}.`;
      break;
    case 'gift_or_vague':
      replyText = `Here are ${products.length} great option${products.length > 1 ? 's' : ''} for you: ${productNames}${moreCount > 0 ? `, and ${moreCount} more` : ''}.`;
      break;
    default:
      replyText = `I found ${products.length} product${products.length > 1 ? 's' : ''} for you: ${productNames}${moreCount > 0 ? `, and ${moreCount} more` : ''}.`;
  }
  
  return {
    replyText,
    followupText: products.length > 0
      ? "Would you like to know more about any specific product, or refine your search?"
      : undefined,
  };
}



