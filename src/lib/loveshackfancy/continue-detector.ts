/**
 * Continue Anyway Detector
 * 
 * Determines if the user wants to proceed with a search despite vague context,
 * instead of answering clarifying questions.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';

const CONTINUE_DETECTOR_PROMPT = `Determine if the user wants to proceed with a search despite vague context.

USER MESSAGE: "{USER_MESSAGE}"

CONTEXT:
- The user previously gave a vague query
- The assistant asked clarifying questions
- Now analyzing if the user wants to continue with the search anyway

Look for signals like:
- "just show me what you have"
- "anything is fine"
- "show me options"
- "whatever works"
- "I don't care"
- "surprise me"
- Confirmation patterns: "yes", "ok", "sure", "go ahead"
- "show me anything"
- "whatever you have"
- "I'm not picky"

Output JSON:
{
  "shouldContinue": boolean,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation"
}`;

export async function shouldContinueAnyway(
  userMessage: string
): Promise<{ shouldContinue: boolean; confidence: number; reason: string }> {
  try {
    const prompt = CONTINUE_DETECTOR_PROMPT.replace('{USER_MESSAGE}', userMessage);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a shopping assistant that detects if users want to proceed with vague searches.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: {
        name: 'ContinueDetection',
        schema: {
          type: 'object',
          properties: {
            shouldContinue: { type: 'boolean' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string' },
          },
          required: ['shouldContinue', 'confidence', 'reason'],
        },
      },
    });

    const detection = JSON.parse(result.rawText);

    logger.debug('continue_detection', {
      message: userMessage.substring(0, 100),
      shouldContinue: detection.shouldContinue,
      confidence: detection.confidence,
    });

    return detection;
  } catch (error) {
    logger.error('continue_detection_failed', {
      error: error instanceof Error ? error.message : String(error),
      message: userMessage.substring(0, 100),
    });

    // Fallback: check for simple patterns
    const messageLower = userMessage.toLowerCase();
    const continuePatterns = [
      'yes', 'ok', 'sure', 'go ahead', 'show me', 'whatever', 'anything', 'surprise',
      'i don\'t care', 'doesn\'t matter', 'just show', 'not picky', 'im not picky'
    ];

    const shouldContinue = continuePatterns.some(pattern => 
      messageLower.includes(pattern)
    );

    return {
      shouldContinue,
      confidence: shouldContinue ? 0.7 : 0.3,
      reason: shouldContinue 
        ? 'Pattern match suggests user wants to continue'
        : 'Unable to determine intent, defaulting to no',
    };
  }
}

