import { prisma } from '../../../db';
import { logger } from '../../../telemetry/logger';
import type { DatasetContext } from '../../../catalog/datasetInspector';
import { productToResultItem } from '../cards';
import { applyBrandVoiceToReply } from '../brandVoice';
import { callLLM, type LlmMessage } from '../../provider';
import { buildProductQaPrompt } from '../../prompts';
import type { ProgressCallback } from '../progress';
import { STAGE_PROGRESS } from '../progress';
import type { AssistantQueryResult } from '../index';

/**
 * Product Q&A Flow
 * 
 * Handles questions about a specific product (e.g., "Is this good for humid weather?").
 * Returns text-only replies (no product cards) answering the user's question.
 * 
 * The flow:
 * 1. Loads the product being asked about
 * 2. Extracts product details (attributes, price, description, etc.)
 * 3. Uses LLM to generate answer based on product information
 * 4. Applies brand voice to the reply
 * 
 * Used by: handleAssistantQuery when productContextId is set and user asks a question
 * API: POST /api/assistant, POST /api/assistant/stream
 * 
 * Note: This is different from PDP flow - PDP shows products, Q&A answers questions
 */

/**
 * Run product Q&A flow
 * 
 * Answers questions about a specific product using its details.
 * Returns text-only replies (no product cards).
 * 
 * @param productContextId - ID of the product being asked about
 * @param userMessage - User's question about the product
 * @param datasetContext - Catalog context (vertical, facets, etc.)
 * @param onProgress - Optional progress callback for UI updates
 * @returns Assistant query result with text-only reply (no product cards)
 */
export async function runProductQaFlow(
  productContextId: string,
  userMessage: string,
  datasetContext?: DatasetContext | null,
  onProgress?: ProgressCallback,
): Promise<AssistantQueryResult> {
  onProgress?.('loading_product', STAGE_PROGRESS.loading_product);
  
  const productRecord = await prisma.product.findUnique({ where: { id: productContextId } });
  if (!productRecord) {
    return {
      replyText: "I couldn't find that product. Could you try asking about a different product?",
      productCards: [],
      noExactMatch: false,
    };
  }

  onProgress?.('analyzing', STAGE_PROGRESS.analyzing);
  
  const product = productToResultItem(productRecord);
  const attributes = product.attributes ?? {};
  
  // Extract product details for the prompt
  const productDetails: string[] = [];
  
  // Title and description
  productDetails.push(`Title: ${product.title}`);
  if (product.description) {
    productDetails.push(`Description: ${product.description}`);
  }
  
  // Price information (important for "how much" questions)
  const priceDollars = (product.priceCents / 100).toFixed(2);
  const salePriceDollars = product.salePriceCents ? (product.salePriceCents / 100).toFixed(2) : null;
  if (salePriceDollars) {
    productDetails.push(`Price: ${product.currency} ${salePriceDollars} (on sale, originally ${product.currency} ${priceDollars})`);
  } else {
    productDetails.push(`Price: ${product.currency} ${priceDollars}`);
  }
  
  // Attributes
  const attributeKeys = [
    'fabric', 'material', 'fit', 'color', 'season', 'occasion', 'useCases', 'styleTags',
    'benefits', 'claims', 'sensoryProfile', 'compatibility', 'materials', 'ingredients',
    'dimensions', 'weight', 'sizeFitNotes', 'care', 'usageInstructions',
  ];
  
  for (const key of attributeKeys) {
    const value = attributes[key];
    if (value) {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          productDetails.push(`${key}: ${value.join(', ')}`);
        }
      } else if (typeof value === 'string' && value.trim()) {
        productDetails.push(`${key}: ${value}`);
      }
    }
  }
  
  // Highlights
  if (attributes.productHighlights) {
    productDetails.push(`Highlights: ${attributes.productHighlights}`);
  }
  if (attributes.bulletHighlights && Array.isArray(attributes.bulletHighlights)) {
    productDetails.push(`Bullet points: ${attributes.bulletHighlights.join('; ')}`);
  }
  
  // Product details (key-value pairs)
  const productDetailsObj = attributes.product_details as Record<string, string> | undefined;
  if (productDetailsObj && typeof productDetailsObj === 'object') {
    const detailPairs = Object.entries(productDetailsObj)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    if (detailPairs) {
      productDetails.push(`Details: ${detailPairs}`);
    }
  }

  const productInfoText = productDetails.join('\n');

  onProgress?.('answering', STAGE_PROGRESS.answering);

  // Generate Q&A reply using LLM
  const prompt = buildProductQaPrompt(datasetContext);
  const messages: LlmMessage[] = [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content: `Product Information:
${productInfoText}

User Question: "${userMessage}"

Answer the question about this product using only the information provided above.`,
    },
  ];

  try {
    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    let replyText = result.rawText.trim();
    
    // Apply brand voice to the reply
    replyText = await applyBrandVoiceToReply(replyText);

    onProgress?.('complete', STAGE_PROGRESS.complete);

    return {
      replyText,
      productCards: [], // No product cards for Q&A
      noExactMatch: false,
    };
  } catch (error) {
    logger.error('product_qa_flow_failed', {
      error: error instanceof Error ? error.message : String(error),
      productId: productContextId,
    });
    
    // Fallback reply
    return {
      replyText: `I'm having trouble answering that right now. Could you try rephrasing your question about ${product.title}?`,
      productCards: [],
      noExactMatch: false,
    };
  }
}


