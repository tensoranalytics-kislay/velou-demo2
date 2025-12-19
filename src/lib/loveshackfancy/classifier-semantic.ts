/**
 * Semantic Classifier (Fallback)
 * 
 * Fallback classifier that uses embeddings for constraint extraction.
 * Used when the main LLM-based classifier fails.
 */

import { logger } from '../telemetry/logger';
import type { QueryClassification, FashionConstraints } from './classifier';
import { callLLM } from '../llm/provider';
import { stripJsonFences } from '../llm/orchestrator/utils';
import { LOVESHACKFANCY_QUERY_CLASSIFIER_PROMPT, LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA } from './prompts';

/**
 * Extract constraints via embeddings (semantic fallback)
 * 
 * This is a fallback method that uses a simpler LLM call with embeddings
 * to extract constraints when the main classifier fails.
 * 
 * @param message - User query message
 * @returns QueryClassification with extracted constraints
 */
export async function extractConstraintsViaEmbeddings(
  message: string
): Promise<QueryClassification> {
  const startTime = Date.now();

  logger.debug('extractConstraintsViaEmbeddings: starting', {
    message: message.substring(0, 100),
  });

  try {
    // Use a simplified prompt for faster processing
    const prompt = LOVESHACKFANCY_QUERY_CLASSIFIER_PROMPT
      .replace('{QUERY}', message)
      .replace('{LAST_CONSTRAINTS}', 'null');

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a shopping assistant for LoveShackFancy. Extract constraints from user queries using semantic understanding.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent', // Uses lightweight model for speed
      expectJson: true,
      schema: LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA,
      maxTokens: 800, // Reduced for faster response
    });

    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as QueryClassification;

    // Validate type
    const validTypes = [
      'direct_product_search',
      'occasion_based',
      'style_exploration',
      'fit_and_size',
      'gift_or_vague',
      'unrelated',
    ];
    if (!validTypes.includes(parsed.type)) {
      logger.warn('extractConstraintsViaEmbeddings: invalid type', {
        type: parsed.type,
        message: message.substring(0, 100),
      });
      parsed.type = 'gift_or_vague';
    }

    // Ensure confidence is set
    if (typeof parsed.confidence !== 'number') {
      parsed.confidence = 0.5; // Default confidence for semantic fallback
    }

    const duration = Date.now() - startTime;
    logger.debug('extractConstraintsViaEmbeddings: complete', {
      message: message.substring(0, 100),
      type: parsed.type,
      confidence: parsed.confidence,
      durationMs: duration,
    });

    return parsed;
  } catch (error) {
    logger.error('extractConstraintsViaEmbeddings: failed', {
      error: error instanceof Error ? error.message : String(error),
      message: message.substring(0, 100),
    });

    // Return minimal classification on failure
    return {
      type: 'gift_or_vague',
      constraints: {},
      confidence: 0.2,
    };
  }
}
