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
 * - GPT-4.1-mini: Lightweight version, cost-effective while maintaining quality for all tasks
 *   Used as the default for all LLM calls (categorization, classification, reply generation)
 *
 * Default models (can be overridden via env vars):
 * - PRIMARY_LLM_MODEL: gpt-4.1-mini (used for final replies and all primary tasks)
 * - LIGHT_LLM_MODEL: gpt-4.1-mini (used for intent classification and lightweight tasks)
 * - REASONING_LLM_MODEL: Not used (removed o3-mini for performance)
 */
const primaryLlmModel = process.env.PRIMARY_LLM_MODEL ?? 'gpt-4.1-mini';
const lightLlmModel = process.env.LIGHT_LLM_MODEL ?? 'gpt-4.1-mini';
// Reasoning model is no longer used - kept for backward compatibility but defaults to light model
const reasoningLlmModel = process.env.REASONING_LLM_MODEL ?? lightLlmModel;

// Embedding model for vector search (pgvector)
const embeddingModel = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';

validateLLMConfig(llmProvider, openaiApiKey);

/**
 * JWT Configuration
 * 
 * JWT_SECRET and REFRESH_TOKEN_SECRET are validated in src/lib/auth/jwt.ts
 * They must be at least 32 characters long for security.
 * 
 * Generate secrets with:
 *   openssl rand -base64 32
 */
const jwtSecret = process.env.JWT_SECRET;
const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET;

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required(process.env.DATABASE_URL, 'DATABASE_URL'),
  llmProvider,
  openaiApiKey,
  primaryLlmModel,
  lightLlmModel,
  reasoningLlmModel,
  embeddingModel,
  // JWT secrets are validated in jwt.ts module (not here to avoid circular deps)
  jwtSecret,
  refreshTokenSecret,
  // Feature flag: Enable optimized L'Occitane pipeline (faster, single-merchant optimized)
  useLoccitaneOptimizedPipeline: process.env.USE_LOCCITANE_OPTIMIZED_PIPELINE === 'true',
} as const;

export type AppConfig = typeof env;

