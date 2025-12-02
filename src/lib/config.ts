export type LLMProvider = 'openai' | 'mock';

const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const validateLLMConfig = (provider: LLMProvider, openaiKey?: string) => {
  if (provider === 'openai' && !openaiKey) {
    throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY to be set');
  }
};

const rawLlmProvider = process.env.LLM_PROVIDER ?? 'openai';
if (rawLlmProvider !== 'openai' && rawLlmProvider !== 'mock') {
  throw new Error(
    `Invalid LLM_PROVIDER: "${rawLlmProvider}". Must be "openai" or "mock". ` +
    `Note: Perplexity support has been removed. Please update your .env file.`
  );
}
const llmProvider = rawLlmProvider as LLMProvider;
const openaiApiKey = process.env.OPENAI_API_KEY;

/**
 * Model Selection Strategy:
 * 
 * - GPT-5: Latest generation, best overall performance for complex tasks
 * - GPT-4.1: Improved GPT-4 variant, excellent for structured outputs and reasoning
 * - o3-mini: Specialized reasoning model, best for complex logical tasks
 * - GPT-4.1-mini: Lightweight version, cost-effective for simple tasks
 * 
 * Default models (can be overridden via env vars):
 * - PRIMARY_LLM_MODEL: gpt-5 (best overall performance)
 * - LIGHT_LLM_MODEL: gpt-4.1-mini (cost-effective for lightweight tasks)
 * - REASONING_LLM_MODEL: o3-mini (for complex reasoning tasks)
 */
const primaryLlmModel = process.env.PRIMARY_LLM_MODEL ?? 'gpt-5';
const lightLlmModel = process.env.LIGHT_LLM_MODEL ?? 'gpt-4.1-mini';
const reasoningLlmModel = process.env.REASONING_LLM_MODEL ?? 'o3-mini';

validateLLMConfig(llmProvider, openaiApiKey);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required(process.env.DATABASE_URL, 'DATABASE_URL'),
  llmProvider,
  openaiApiKey,
  primaryLlmModel,
  lightLlmModel,
  reasoningLlmModel,
} as const;

export type AppConfig = typeof env;

