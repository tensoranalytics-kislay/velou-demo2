import { getCatalogOntology, type CatalogOntology } from '../../search/ontology';
import { logger } from '../../telemetry/logger';
import type { DatasetContext } from '../../catalog/datasetInspector';
import type { SearchConstraints } from '../../search/types';
import { applyBrandVoiceToReply } from './brandVoice';
import { describeConstraints } from './cards';
import { callLLM, type LlmMessage } from '../provider';
import {
  buildClarifyingReplyPrompt,
  buildNoRelevantProductsPrompt,
  buildOutOfScopeReplyPrompt,
  buildPostCardsFollowupPrompt,
} from '../prompts';
import type { ProgressCallback } from './progress';
import { STAGE_PROGRESS } from './progress';
import { CLARIFYING_REPLY } from './constants';

/**
 * Shared Orchestrator Helpers
 * 
 * Utility functions used across all orchestrator flows.
 * These helpers provide common functionality for:
 * - Category validation
 * - Reply generation (clarifying, no results, out of scope, non-product)
 * - Follow-up text generation
 * 
 * Used by: All flow files (discovery, pdp, pending, productQa)
 */

/**
 * Check if a requested category exists in the catalog ontology.
 * Returns true if the category (or a close match) exists in categories or productTypes.
 * 
 * @param requestedCategory - Category string or array to check
 * @param ontology - Catalog ontology with categories and productTypes
 * @returns true if category exists (exact or substring match)
 */
export function categoryExistsInCatalog(
  requestedCategory: string | string[] | undefined,
  ontology: CatalogOntology,
): boolean {
  if (!requestedCategory) return true; // No category requested, so it "exists"

  const categories = Array.isArray(requestedCategory) ? requestedCategory : [requestedCategory];
  const allCatalogCategories = [
    ...ontology.categories.map((c) => c.toLowerCase()),
    ...ontology.productTypes.map((pt) => pt.toLowerCase()),
  ];

  // Check if any requested category matches any catalog category
  for (const reqCat of categories) {
    const normalizedReq = reqCat.toLowerCase().trim();
    
    // Exact match
    if (allCatalogCategories.includes(normalizedReq)) {
      return true;
    }

    // Substring match (e.g., "shoes" matches "running shoes")
    if (allCatalogCategories.some((cat) => cat.includes(normalizedReq) || normalizedReq.includes(cat))) {
      return true;
    }

    // Check for common synonyms (e.g., "shoe" -> "shoes", "boot" -> "boots")
    const synonyms = [
      normalizedReq,
      normalizedReq + 's',
      normalizedReq.replace(/s$/, ''), // Remove trailing 's'
    ];
    
    if (synonyms.some((syn) => allCatalogCategories.some((cat) => cat.includes(syn) || syn.includes(cat)))) {
      return true;
    }
  }

  return false;
}

/**
 * Build follow-up text that appears after product cards.
 * 
 * Generates contextual follow-up questions based on the user's query, shown products,
 * and catalog context. Uses LLM for natural language generation with fallback to
 * rule-based templates.
 * 
 * @param userMessage - Original user message
 * @param constraints - Search constraints used
 * @param datasetContext - Catalog context (vertical, facets, etc.)
 * @param ontology - Catalog ontology (categories, colors, etc.)
 * @param requestedCategoryExists - Whether requested category exists in catalog
 * @param mainReplyText - Main reply text (for context)
 * @param productSummaries - Summaries of shown products
 * @returns Follow-up text or undefined if generation fails
 */
export async function buildPostCardsFollowupText(
  userMessage: string,
  constraints: SearchConstraints,
  datasetContext?: DatasetContext | null,
  ontology?: CatalogOntology,
  requestedCategoryExists?: boolean,
  mainReplyText?: string,
  productSummaries?: string[],
): Promise<string | undefined> {
  try {
    const constraintSummary = describeConstraints(constraints);
    const prompt = buildPostCardsFollowupPrompt(
      datasetContext,
      ontology,
      requestedCategoryExists,
      constraints.category,
      mainReplyText,
      productSummaries,
    );

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `userMessage: "${userMessage}"

mainReplyText: "${mainReplyText}"
constraintSummary: "${constraintSummary || 'general preferences'}"
${productSummaries?.length ? `\n\nProducts shown:\n${productSummaries.map((p) => `- ${p}`).join('\n')}` : ''}`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    const text = result.rawText.trim();
    if (text.length) {
      return text;
    }
  } catch (error) {
    logger.error('post_cards_followup_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Deterministic fallback if LLM is unavailable or returned empty text
  const vertical = datasetContext?.vertical;
  const hasBudget = Boolean(constraints.priceMinCents || constraints.priceMaxCents);

  if (vertical && (vertical.includes('beauty') || vertical.includes('skincare'))) {
    return 'Want a different benefit, scent, or price point? Tell me and I can refine these suggestions.';
  }

  if (vertical && (vertical.includes('fashion') || vertical.includes('apparel'))) {
    return 'Need a different size, color, style, or price? Tell me and I can tweak these options.';
  }

  if (vertical && (vertical.includes('home') || vertical.includes('decor'))) {
    return 'Need a different room, style, or budget? Tell me and I can pivot these suggestions.';
  }

  // Generic catalog fallback
  if (hasBudget) {
    return "Want to go lighter, more premium, or switch categories? Tell me and I'll refine these results.";
  }

  return "If you'd like a different category, style, or price range, tell me and I'll tweak these options.";
}

/**
 * Build a dataset-aware clarifying reply when the user has given a
 * product-ish but underspecified request (no clear category/price/facets).
 * 
 * Uses LLM first and falls back to rule-based copy if LLM fails.
 * 
 * @param userMessage - User's underspecified message
 * @param datasetContext - Catalog context (vertical, facets, etc.)
 * @returns Clarifying reply asking for more details
 */
export async function buildClarifyingReply(
  userMessage: string,
  datasetContext?: DatasetContext | null,
): Promise<string> {
  try {
    const prompt = buildClarifyingReplyPrompt(datasetContext);
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `userMessage: "${userMessage}"`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    const text = result.rawText.trim();
    if (text.length) {
      return text;
    }
  } catch (error) {
    logger.error('clarifying_reply_llm_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Deterministic, brand-voiced fallback if LLM is unavailable
  let fallback = CLARIFYING_REPLY;
  fallback = await applyBrandVoiceToReply(fallback);
  return fallback;
}

/**
 * Build a dataset-aware LLM reply when products were found but are not relevant to the user's query.
 * 
 * This is used when search returns products that don't actually match the user's intent.
 * Uses LLM to generate a helpful reply explaining why products don't match, with fallback.
 * 
 * @param userMessage - Original user message
 * @param constraints - Search constraints used
 * @param datasetContext - Catalog context (vertical, facets, etc.)
 * @param ontology - Catalog ontology (categories, colors, etc.)
 * @returns Reply text explaining why products don't match
 */
export async function buildNoRelevantProductsReply(
  userMessage: string,
  constraints: SearchConstraints,
  datasetContext?: DatasetContext | null,
  ontology?: CatalogOntology | null,
): Promise<string> {
  try {
    const prompt = buildNoRelevantProductsPrompt(datasetContext, ontology);
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `userMessage: "${userMessage}"
constraints: ${JSON.stringify(constraints)}
expandedKeywords: ${JSON.stringify((constraints as any).expandedKeywords || [])}`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    const text = result.rawText.trim();
    if (text.length) {
      return await applyBrandVoiceToReply(text);
    }
  } catch (error) {
    logger.error('no_relevant_products_reply_llm_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Deterministic, brand-voiced fallback if LLM is unavailable
  let fallback = "I couldn't find products that match what you're looking for. Try adjusting your search terms or browse by category.";
  fallback = await applyBrandVoiceToReply(fallback);
  return fallback;
}

/**
 * Build a dataset-aware LLM reply for non-product or out-of-scope chat.
 * 
 * This is used as a richer fallback when the router or intent detector
 * classifies the message as "non_product_chat" or "other/qa".
 * Re-centers the conversation on product discovery.
 * 
 * @param userMessage - User's non-product message
 * @param datasetContext - Catalog context (vertical, facets, etc.)
 * @param onProgress - Optional progress callback for UI updates
 * @returns Reply text re-centering conversation on products
 */
export async function buildNonProductChatReply(
  userMessage: string,
  datasetContext?: DatasetContext | null,
  onProgress?: ProgressCallback,
): Promise<string> {
  // Stage 2: Generating response (understanding already done before this function is called)
  onProgress?.('generating', STAGE_PROGRESS.generating);
  
  try {
    const prompt = buildOutOfScopeReplyPrompt(datasetContext);
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `userMessage: "${userMessage}"`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    const text = result.rawText.trim();
    if (text.length) {
      onProgress?.('completing', STAGE_PROGRESS.completing);
      const finalText = await applyBrandVoiceToReply(text);
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return finalText;
    }
  } catch (error) {
    logger.error('non_product_chat_llm_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Deterministic, brand-voiced fallback if LLM is unavailable
  onProgress?.('completing', STAGE_PROGRESS.completing);
  let fallback =
    "I'm here to help you find products in this catalog. Tell me a category, concern, or price range and I'll pull options that fit.";
  fallback = await applyBrandVoiceToReply(fallback);
  onProgress?.('complete', STAGE_PROGRESS.complete);
  return fallback;
}


