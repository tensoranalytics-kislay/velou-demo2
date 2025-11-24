export type LLMProvider = 'perplexity' | 'openai' | 'mock';

const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const validateLLMConfig = (provider: LLMProvider, openaiKey?: string, perplexityKey?: string) => {
  if (provider === 'openai' && !openaiKey) {
    throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY to be set');
  }
  if (provider === 'perplexity' && !perplexityKey) {
    throw new Error('LLM_PROVIDER=perplexity requires PERPLEXITY_API_KEY to be set');
  }
};

const llmProvider = (process.env.LLM_PROVIDER ?? 'mock') as LLMProvider;
const openaiApiKey = process.env.OPENAI_API_KEY;
const perplexityApiKey = process.env.PERPLEXITY_API_KEY;

validateLLMConfig(llmProvider, openaiApiKey, perplexityApiKey);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required(process.env.DATABASE_URL, 'DATABASE_URL'),
  llmProvider,
  openaiApiKey,
  perplexityApiKey,
} as const;

export type AppConfig = typeof env;

