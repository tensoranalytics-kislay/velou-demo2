/**
 * Non-Discovery Query Handler
 * 
 * Handles queries that are commerce-relevant but not product discovery:
 * - Brand/company info questions
 * - Policy questions (shipping, returns)
 * - Product usage questions
 * - Random/unrelated queries (witty redirect)
 * 
 * Uses merchant knowledge (faq, datasetContext, voice) + lightweight LLM call.
 */

import { logger } from '../telemetry/logger';
import { callLLM } from '../llm/provider';
import { stripJsonFences } from '../llm/orchestrator/utils';
import { MICRO_REPLY_PROMPT, MICRO_REPLY_SCHEMA } from './prompts';
import type { DatasetContext } from '../catalog/datasetInspector';
import type { ProductWithLoccitaneAttributes } from './ranking/ranker';
import type { ActionProposal } from './actions';
import { generateActionId } from './actions';

export type NonDiscoveryInput = {
  message: string;
  route: 'BRAND_OR_PRODUCT_INFO' | 'SMALLTALK_OR_RANDOM';
  merchantId: string;
  datasetContext?: DatasetContext | null;
  voiceInstructions?: string;
  faq?: Array<{ question: string; answer: string }> | null;
  productContext?: ProductWithLoccitaneAttributes | null;
  brandName?: string;
};

export type NonDiscoveryResult = {
  replyText: string;
  actions?: ActionProposal[];
};

/**
 * Handle non-discovery queries with merchant knowledge + LLM
 */
export async function handleNonDiscoveryQuery(
  input: NonDiscoveryInput
): Promise<NonDiscoveryResult> {
  const {
    message,
    route,
    merchantId,
    datasetContext,
    voiceInstructions,
    faq,
    productContext,
    brandName = 'our store',
  } = input;

  logger.debug('handleNonDiscoveryQuery: processing', {
    route,
    message: message.substring(0, 100),
    hasFaq: !!faq && faq.length > 0,
    hasProductContext: !!productContext,
    hasDatasetContext: !!datasetContext,
  });

  // Build context for LLM
  const contextParts: string[] = [];

  // Brand/merchant info
  if (brandName) {
    contextParts.push(`Brand name: ${brandName}`);
  }

  // Dataset context (vertical, categories)
  if (datasetContext) {
    if (datasetContext.vertical) {
      contextParts.push(`We sell: ${datasetContext.vertical}`);
    }
    if (datasetContext.sampleCategories && datasetContext.sampleCategories.length > 0) {
      contextParts.push(`Categories: ${datasetContext.sampleCategories.slice(0, 5).join(', ')}`);
    }
  }

  // Voice instructions (tone guidance)
  if (voiceInstructions) {
    contextParts.push(`Voice/tone: ${voiceInstructions.substring(0, 200)}`);
  }

  // FAQ entries
  if (faq && faq.length > 0) {
    const faqText = faq
      .slice(0, 10) // Limit to 10 most relevant
      .map((item) => `Q: ${item.question}\nA: ${item.answer}`)
      .join('\n\n');
    contextParts.push(`FAQ:\n${faqText}`);
  }

  // Product context (if available)
  if (productContext) {
    contextParts.push(
      `Product context: ${productContext.title}\n${productContext.description?.substring(0, 300) || ''}`
    );
  }

  const context = contextParts.length > 0 ? contextParts.join('\n\n') : 'No additional context available.';

  // Build prompt
  const systemPrompt = MICRO_REPLY_PROMPT.replace('{{CONTEXT}}', context);

  const userContent = `User query: "${message}"\n\nRoute: ${route}`;

  try {
    const result = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      purpose: 'intent', // Use lightweight model (gpt-4.1-mini)
      expectJson: true,
      schema: MICRO_REPLY_SCHEMA,
      maxTokens: 120, // Strict limit for concise replies
    });

    // Parse JSON response
    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as {
      replyText: string;
      needsAction?: boolean;
      suggestedActionType?: string;
    };

    // Validate reply text
    if (!parsed.replyText || typeof parsed.replyText !== 'string') {
      throw new Error('Missing or invalid replyText in LLM response');
    }

    // Generate actions if suggested
    const actions: ActionProposal[] = [];
    if (parsed.needsAction && parsed.suggestedActionType) {
      // For random queries, suggest discovery actions
      if (route === 'SMALLTALK_OR_RANDOM') {
        actions.push({
          id: generateActionId('ask_preferences'),
          type: 'ask_preferences',
          label: 'Browse products',
          payload: { preferenceType: 'general' },
        });
      } else {
        // For brand info queries, offer to explore products
        actions.push({
          id: generateActionId('ask_preferences'),
          type: 'ask_preferences',
          label: 'Explore products',
          payload: { preferenceType: 'general' },
        });
      }
    }

    logger.debug('handleNonDiscoveryQuery: success', {
      replyLength: parsed.replyText.length,
      actionCount: actions.length,
    });

    return {
      replyText: parsed.replyText.trim(),
      actions: actions.length > 0 ? actions : undefined,
    };
  } catch (error) {
    logger.error('handleNonDiscoveryQuery: LLM call failed', {
      error: error instanceof Error ? error.message : String(error),
      message: message.substring(0, 100),
    });

    // Fallback: generic response with action
    if (route === 'SMALLTALK_OR_RANDOM') {
      return {
        replyText: `I'm here to help you find products! What are you looking for today?`,
        actions: [
          {
            id: generateActionId('ask_preferences'),
            type: 'ask_preferences',
            label: 'Browse products',
            payload: { preferenceType: 'general' },
          },
        ],
      };
    } else {
      return {
        replyText: `I'm a shopping assistant for ${brandName}. I can help you discover products and answer questions. What would you like to explore?`,
        actions: [
          {
            id: generateActionId('ask_preferences'),
            type: 'ask_preferences',
            label: 'Explore products',
            payload: { preferenceType: 'general' },
          },
        ],
      };
    }
  }
}

