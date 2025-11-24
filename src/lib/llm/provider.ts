import { env } from '../config';

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmCallOptions = {
  messages: LlmMessage[];
  purpose: 'intent' | 'final_reply' | 'pdp_suitability' | 'card_reason';
  expectJson?: boolean;
  signal?: AbortSignal;
  schema?: {
    name: string;
    schema: Record<string, unknown>;
  };
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

async function callPerplexity(options: LlmCallOptions): Promise<LlmCallResult> {
  if (!env.perplexityApiKey) {
    throw new LLMError('PERPLEXITY_API_KEY is required for Perplexity provider');
  }

  try {
    const body: Record<string, unknown> = {
      model: 'sonar',
      messages: options.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      max_tokens: 512,
      temperature: options.purpose === 'intent' ? 0.0 : options.purpose === 'card_reason' ? 0.35 : 0.2,
      disable_search: true,
    };

    if (options.expectJson && options.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: options.schema,
      };
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.perplexityApiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new LLMError(
        `Perplexity API error: ${response.status} ${response.statusText}`,
        text || undefined,
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
      error?: { message?: string };
    };

    if (json.error) {
      throw new LLMError(`Perplexity API error: ${json.error.message ?? 'Unknown error'}`);
    }

    const rawText =
      json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.delta?.content ?? '';

    if (!rawText) {
      throw new LLMError('Perplexity API returned empty completion', JSON.stringify(json));
    }

    return { rawText };
  } catch (error) {
    if (error instanceof LLMError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LLMError('LLM request aborted', error);
    }
    throw new LLMError(
      `Perplexity API call failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

async function callOpenAI(options: LlmCallOptions): Promise<LlmCallResult> {
  if (!env.openaiApiKey) {
    throw new LLMError('OPENAI_API_KEY is required for OpenAI provider');
  }

  try {
    const model = 'gpt-4o-mini';
    const temperature =
      options.purpose === 'intent' ? 0.1 : options.purpose === 'card_reason' ? 0.6 : 0.7;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature,
        response_format: options.expectJson
          ? options.schema
            ? { type: 'json_schema', json_schema: options.schema }
            : { type: 'json_object' }
          : undefined,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LLMError(`OpenAI API error: ${response.status} ${response.statusText}`, errorBody);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

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
    case 'perplexity':
      return callPerplexity(options);
    default:
      throw new LLMError(`Unknown LLM provider: ${env.llmProvider}`);
  }
}

export { LLMError };

