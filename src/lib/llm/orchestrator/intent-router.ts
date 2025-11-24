import { env } from '../../config';
import { callLLM, type LlmMessage } from '../provider';
import { VELOU_ROUTER_PROMPT, VELOU_ROUTER_JSON_SCHEMA } from '../prompts';
import { logger } from '../../telemetry/logger';
import type { SearchConstraints } from '../../search/types';
import { isAffirmativeResponse, isHardOverride } from './intent';
import { stripJsonFences } from './utils';

export type VelouRouterResult = {
  action: 'confirm_pending_suggestion' | 'refine_search' | 'override_search' | 'non_product_chat';
  new_category: string | null;
  refinements: {
    colors?: string[] | null;
    fabrics?: string[] | null;
    materials?: string[] | null;
    seasons?: string[] | null;
    occasions?: string[] | null;
    sizes?: string[] | null;
    fit?: string | null;
    priceMinCents?: number | null;
    priceMaxCents?: number | null;
    style_keywords?: string[] | null;
  };
  keep_previous_constraints: boolean;
  reason: string;
};

/**
 * Calls the VelouRouter LLM to decide how to handle a user message with pending suggestions
 */
export async function callVelouRouter(input: {
  last_user_message: string;
  conversation_summary: string;
  previous_constraints: SearchConstraints | null;
  has_pending_suggestion: boolean;
  pending_suggestion_categories: string[];
  taxonomy_categories: string[];
}): Promise<VelouRouterResult> {
  if (env.llmProvider === 'mock') {
    // Fallback to rule-based for mock
    const normalized = input.last_user_message.toLowerCase();
    if (isAffirmativeResponse(normalized) && !isHardOverride(input.last_user_message)) {
      return {
        action: 'confirm_pending_suggestion',
        new_category: null,
        refinements: {},
        keep_previous_constraints: true,
        reason: 'Mock: detected affirmative response',
      };
    }
    if (isHardOverride(input.last_user_message)) {
      return {
        action: 'override_search',
        new_category: null, // Will be extracted by LLM in next step
        refinements: {},
        keep_previous_constraints: true,
        reason: 'Mock: detected hard override pattern',
      };
    }
    return {
      action: 'refine_search',
      new_category: null,
      refinements: {},
      keep_previous_constraints: true,
      reason: 'Mock: default to refine',
    };
  }

  try {
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: VELOU_ROUTER_PROMPT,
      },
      {
        role: 'user',
        content: `last_user_message: "${input.last_user_message}"

conversation_summary: "${input.conversation_summary}"

previous_constraints: ${JSON.stringify(input.previous_constraints || {})}

has_pending_suggestion: ${input.has_pending_suggestion}

pending_suggestion_categories: ${JSON.stringify(input.pending_suggestion_categories)}

taxonomy_categories: ${JSON.stringify(input.taxonomy_categories)}

Output JSON with action, new_category, refinements, keep_previous_constraints, and reason.`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'intent',
      expectJson: true,
      schema: VELOU_ROUTER_JSON_SCHEMA,
    });

    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as VelouRouterResult;

    if (
      !parsed.action ||
      !['confirm_pending_suggestion', 'refine_search', 'override_search', 'non_product_chat'].includes(
        parsed.action,
      )
    ) {
      throw new Error(`Invalid action: ${parsed.action}`);
    }

    return parsed;
  } catch (error) {
    logger.error('velou_router_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback to rule-based
    const normalized = input.last_user_message.toLowerCase();
    if (isAffirmativeResponse(normalized) && !isHardOverride(input.last_user_message)) {
      return {
        action: 'confirm_pending_suggestion',
        new_category: null,
        refinements: {},
        keep_previous_constraints: true,
        reason: 'Fallback: detected affirmative response',
      };
    }
    if (isHardOverride(input.last_user_message)) {
      return {
        action: 'override_search',
        new_category: null,
        refinements: {},
        keep_previous_constraints: true,
        reason: 'Fallback: detected hard override pattern',
      };
    }
    return {
      action: 'refine_search',
      new_category: null,
      refinements: {},
      keep_previous_constraints: true,
      reason: 'Fallback: default to refine',
    };
  }
}

