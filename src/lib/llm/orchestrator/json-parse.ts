/**
 * Safe JSON parsing for LLM responses
 * Handles malformed JSON gracefully and extracts JSON from text
 */
import { stripJsonFences } from './utils';
import { logger } from '../../telemetry/logger';

export interface SafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Attempts to parse JSON from LLM response, with fallback strategies
 */
export function safeParseLlmJson<T>(
  rawText: string,
  fallback?: T,
): SafeParseResult<T> {
  try {
    // Strategy 1: Strip JSON fences and parse
    const cleaned = stripJsonFences(rawText);
    const parsed = JSON.parse(cleaned);
    return { success: true, data: parsed as T };
  } catch (error) {
    // Strategy 2: Try to extract JSON substring
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = jsonMatch[0];
        const parsed = JSON.parse(extracted);
        logger.debug('safeParseLlmJson extracted JSON substring', {
          originalLength: rawText.length,
          extractedLength: extracted.length,
        });
        return { success: true, data: parsed as T };
      }
    } catch (extractError) {
      // Continue to fallback
    }
    
    // Strategy 3: Return fallback if provided
    if (fallback) {
      logger.warn('safeParseLlmJson using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, data: fallback, error: error instanceof Error ? error.message : String(error) };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


