import { env } from '../config';

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmCallOptions = {
  messages: LlmMessage[];
  purpose: 'intent' | 'final_reply' | 'pdp_suitability' | 'card_reason' | 'greeting' | 'followup_prompts' | 'followup_prompts_product';
  expectJson?: boolean;
  signal?: AbortSignal;
  schema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  maxTokens?: number; // Optional max tokens limit (useful for short JSON responses)
};

export type LlmCallResult = {
  rawText: string;
};

class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * Model Selection by Purpose:
 * 
 * - intent: Requires structured JSON output. Uses lightweight model (gpt-4.1-mini) for speed.
 * 
 * - final_reply: Natural language generation for conversational responses.
 *   Uses: GPT-5 for best quality and naturalness, or GPT-4.1 as fallback.
 * 
 * - pdp_suitability: Analysis of product fit and user needs.
 *   Uses: Primary model (gpt-4.1) for quality, or lightweight model as fallback.
 * 
 * - card_reason: Lightweight task generating short product card explanations.
 *   Uses: GPT-4.1-mini for cost-effectiveness while maintaining quality.
 */
const REASONING_PURPOSES: Record<LlmCallOptions['purpose'], boolean> = {
  intent: false,        // Use lightweight model for speed (gpt-4.1-mini)
  final_reply: false,   // Natural language generation
  pdp_suitability: false, // Use primary model, not reasoning model
  card_reason: false,   // Simple text generation
  greeting: false,      // Lightweight, stylistic text generation
  followup_prompts: false, // Simple prompt generation
  followup_prompts_product: false, // Simple product-specific prompt generation
};

const PRIMARY_PURPOSES: Record<LlmCallOptions['purpose'], boolean> = {
  intent: false, // Use lightweight model (gpt-4.1-mini) for fast classification
  final_reply: true,
  pdp_suitability: true,
  card_reason: false,
  greeting: false, // greetings should use lightweight model when available
  followup_prompts: false, // lightweight prompt generation
  followup_prompts_product: false, // lightweight product-specific prompt generation
};

const TEMPERATURE_BY_PURPOSE: Record<LlmCallOptions['purpose'], number> = {
  intent: 0.1,          // Low temperature for structured, consistent outputs
  final_reply: 0.7,     // Higher temperature for natural, varied responses
  pdp_suitability: 0.4, // Moderate temperature for balanced reasoning
  card_reason: 0.55,    // Moderate temperature for concise explanations
  greeting: 0.75,       // Encourage friendly, varied greetings
  followup_prompts: 0.6, // Moderate temperature for creative but focused prompts
  followup_prompts_product: 0.5, // Lower temperature for product-specific accuracy
};

function resolveModel(purpose: LlmCallOptions['purpose']) {
  // Reasoning models are no longer used (removed o3-mini for performance)
  // This check is kept for backward compatibility but will never match now
  if (REASONING_PURPOSES[purpose] && env.reasoningLlmModel) {
    return env.reasoningLlmModel;
  }
  
  // Use primary model for high-stakes tasks
  const prefersPrimary = PRIMARY_PURPOSES[purpose];
  if (prefersPrimary || !env.lightLlmModel) {
    return env.primaryLlmModel;
  }
  
  // Use lightweight model for simple tasks (including intent classification)
  return env.lightLlmModel;
}

/**
 * Check if a model supports the temperature parameter.
 * Some models don't support temperature.
 */
function modelSupportsTemperature(model: string): boolean {
  // Models that don't support temperature
  const noTemperatureModels = ['gpt-5'];
  return !noTemperatureModels.some((m) => model.toLowerCase().includes(m.toLowerCase()));
}

async function callOpenAI(options: LlmCallOptions): Promise<LlmCallResult> {
  if (!env.openaiApiKey) {
    throw new LLMError('OPENAI_API_KEY is required for OpenAI provider');
  }

  try {
    const model = resolveModel(options.purpose);
    const temperature = TEMPERATURE_BY_PURPOSE[options.purpose] ?? 0.6;
    const supportsTemperature = modelSupportsTemperature(model);
    
    const requestBody: Record<string, unknown> = {
      model,
      messages: options.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      response_format: options.expectJson
        ? options.schema
          ? { type: 'json_schema', json_schema: options.schema }
          : { type: 'json_object' }
        : undefined,
    };
    
    // Only include temperature if the model supports it
    if (supportsTemperature) {
      requestBody.temperature = temperature;
    }
    
    // Include max_tokens if specified (useful for short JSON responses like classification)
    if (options.maxTokens !== undefined) {
      requestBody.max_tokens = options.maxTokens;
    }
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LLMError(`OpenAI API error: ${response.status} ${response.statusText}`, errorBody);
    }

    // Safely parse JSON response - handle cases where API returns non-JSON (e.g., error pages)
    const responseText = await response.text();
    let data: {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    try {
      data = JSON.parse(responseText) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
    } catch (parseError) {
      // If response is not JSON, it's likely an error page or plain text error
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      const preview = responseText.substring(0, 200);
      throw new LLMError(
        `OpenAI API returned non-JSON response: ${response.status} ${response.statusText}. Parse error: ${errorMessage}. Response preview: ${preview}`
      );
    }

    if (data.error) {
      throw new LLMError(`OpenAI API error: ${data.error.message ?? 'Unknown error'}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMError('OpenAI API returned empty response');
    }

    return { rawText: content };
  } catch (error) {
    if (error instanceof LLMError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LLMError('LLM request aborted', error);
    }
    throw new LLMError(`OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`, error);
  }
}

export async function callLLM(options: LlmCallOptions): Promise<LlmCallResult> {
  switch (env.llmProvider) {
    case 'mock':
      throw new LLMError(`callLLM should not be invoked in mock mode (purpose: ${options.purpose})`);
    case 'openai':
      return callOpenAI(options);
    default:
      throw new LLMError(`Unknown LLM provider: ${env.llmProvider}`);
  }
}

export { LLMError };

