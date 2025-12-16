/**
 * Micro Reply Generator
 * 
 * Generates concise, ChatGPT-like responses for non-discovery routes (BRAND_INFO, UNRELATED, AMBIGUOUS).
 * Uses gpt-4.1-mini with strict token limits (max 120 tokens, 2-5 lines).
 */

import { logger } from '../telemetry/logger';
import { callLLM } from '../llm/provider';
import { stripJsonFences } from '../llm/orchestrator/utils';
import { MICRO_REPLY_PROMPT, MICRO_REPLY_SCHEMA } from './prompts';
import type { ActionProposal } from './actions';
import { generateActionId } from './actions';

export type MicroReplyResult = {
  replyText: string;
  actions?: ActionProposal[];
};

/**
 * Generate micro reply for non-discovery queries
 * 
 * @param message - User message
 * @param route - Route type (BRAND_INFO, UNRELATED, or AMBIGUOUS)
 * @param merchant - Merchant data (brandName, voiceInstructions, datasetContext, faq)
 * @param productContextId - Optional product ID for product-specific questions
 * @returns Micro reply result with short text and optional actions
 */
export async function generateMicroReply(
  message: string,
  route: 'BRAND_INFO' | 'UNRELATED' | 'AMBIGUOUS',
  merchant: {
    brandName?: string;
    voiceInstructions?: string;
    datasetContext?: any;
    faq?: Array<{ question: string; answer: string }> | null;
    uiCopy?: any;
  },
  productContextId?: string
): Promise<MicroReplyResult> {
  // Build context string for prompt
  let context = '';
  
  // Brand name
  if (merchant.brandName) {
    context += `Brand: ${merchant.brandName}\n`;
  }
  
  // Dataset context (vertical, sample categories)
  if (merchant.datasetContext) {
    const datasetCtx = merchant.datasetContext;
    if (datasetCtx.vertical) {
      context += `Product vertical: ${datasetCtx.vertical}\n`;
    }
    if (datasetCtx.sampleCategories && datasetCtx.sampleCategories.length > 0) {
      context += `Sample categories: ${datasetCtx.sampleCategories.slice(0, 5).join(', ')}\n`;
    }
  }
  
  // FAQ entries (if available and relevant)
  if (merchant.faq && merchant.faq.length > 0 && route === 'BRAND_INFO') {
    context += `\nFAQ entries (use if relevant):\n`;
    merchant.faq.slice(0, 5).forEach((faq, idx) => {
      context += `${idx + 1}. Q: ${faq.question}\nA: ${faq.answer}\n`;
    });
  }
  
  // Voice instructions (tone/style guidance)
  if (merchant.voiceInstructions) {
    context += `\nVoice style: ${merchant.voiceInstructions}\n`;
  }
  
  // Product context (if available)
  if (productContextId) {
    context += `\nNote: User is asking about a specific product (ID: ${productContextId}).\n`;
  }
  
  // Replace context placeholder in prompt
  const prompt = MICRO_REPLY_PROMPT.replace('{{CONTEXT}}', context.trim() || 'No additional context available.');
  
  try {
    const result = await callLLM({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `User message: "${message}"` },
      ],
      purpose: 'intent', // Uses lightweight model (gpt-4.1-mini) with default temperature (0.1)
      expectJson: true,
      schema: MICRO_REPLY_SCHEMA,
      maxTokens: 120, // Strict limit for micro replies
    });
    
    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as { replyText: string; needsAction: boolean; suggestedActionType?: string };
    
    // Generate actions if needed
    let actions: ActionProposal[] | undefined;
    if (parsed.needsAction || route === 'AMBIGUOUS') {
      // Generate default shopping actions
      actions = [
        {
          id: generateActionId(),
          type: 'ask_preferences',
          label: 'Tell me what you\'re looking for',
          payload: {},
        },
        {
          id: generateActionId(),
          type: 'switch_category',
          label: 'Browse categories',
          payload: {},
        },
      ];
      
      // Use suggested action type if provided
      if (parsed.suggestedActionType && parsed.suggestedActionType !== 'ask_preferences') {
        actions[0].type = parsed.suggestedActionType as any; // ActionType from schema may not match exactly
        actions[0].label = parsed.suggestedActionType === 'switch_category' ? 'Browse categories' : 'Tell me what you\'re looking for';
      }
    }
    
    logger.debug('microReply: generated', {
      route,
      replyLength: parsed.replyText.length,
      hasActions: !!actions,
      message: message.substring(0, 100),
    });
    
    return {
      replyText: parsed.replyText.trim(),
      actions,
    };
  } catch (error) {
    logger.error('microReply: generation failed', {
      error: error instanceof Error ? error.message : String(error),
      route,
      message: message.substring(0, 100),
    });
    
    // Fallback reply
    const fallbackActions: ActionProposal[] = [
      {
        id: generateActionId(),
        type: 'ask_preferences',
        label: 'Tell me what you\'re looking for',
        payload: {},
      },
    ];
    
    if (route === 'BRAND_INFO') {
      return {
        replyText: "I'd be happy to help! What products are you interested in?",
        actions: fallbackActions,
      };
    } else if (route === 'UNRELATED') {
      return {
        replyText: "I'm here to help you find products! What are you looking for?",
        actions: fallbackActions,
      };
    } else {
      // AMBIGUOUS
      return {
        replyText: "I want to help you find the perfect products. Could you tell me more about what you're looking for?",
        actions: fallbackActions,
      };
    }
  }
}

