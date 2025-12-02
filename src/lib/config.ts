export type LLMProvider = 'openai' | 'mock';

const required = (value: string | undefined, name: string) => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

/**
 * Check if we're in a build context (Next.js static generation)
 * During build, we should be lenient with environment variable validation
 * 
 * Next.js evaluates modules during build to collect page data, even for dynamic pages.
 * We need to skip validation during this phase.
 */
const isBuildTime = () => {
  // Next.js sets NEXT_PHASE during build phases
  const nextPhase = process.env.NEXT_PHASE;
  if (nextPhase === 'phase-production-build' || 
      nextPhase === 'phase-development-build' ||
      nextPhase === 'phase-export') {
    return true;
  }
  
  // During Vercel build, we're in build phase if VERCEL=1 but not yet in runtime
  // VERCEL_ENV is set at runtime, not during build
  if (process.env.VERCEL === '1' && !process.env.VERCEL_ENV) {
    return true;
  }
  
  // If we're being imported during static analysis (no actual server running)
  // This is a fallback - during build, we typically don't have a running server
  return false; // Default to runtime - be conservative
};

const validateLLMConfig = (provider: LLMProvider, openaiKey?: string) => {
  // Skip validation during build time - it will be validated at runtime
  if (isBuildTime()) {
    return;
  }
  
  if (provider === 'openai' && !openaiKey) {
    throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY to be set');
  }
};

const rawLlmProvider = process.env.LLM_PROVIDER ?? 'openai';
// During build, be lenient - default to 'mock' if invalid to avoid build failures
let llmProvider: LLMProvider;
if (rawLlmProvider === 'openai' || rawLlmProvider === 'mock') {
  llmProvider = rawLlmProvider as LLMProvider;
} else {
  // During build, default to mock to avoid errors
  if (isBuildTime()) {
    llmProvider = 'mock';
  } else {
    throw new Error(
      `Invalid LLM_PROVIDER: "${rawLlmProvider}". Must be "openai" or "mock". ` +
      `Note: Perplexity support has been removed. Please update your .env file.`
    );
  }
}
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

// Only validate during runtime, not build time
validateLLMConfig(llmProvider, openaiApiKey);

// Make databaseUrl optional during build time
const getDatabaseUrl = () => {
  if (isBuildTime()) {
    // Return a placeholder during build - it won't be used
    return process.env.DATABASE_URL || 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
  }
  return required(process.env.DATABASE_URL, 'DATABASE_URL');
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: getDatabaseUrl(),
  llmProvider,
  openaiApiKey,
  primaryLlmModel,
  lightLlmModel,
  reasoningLlmModel,
} as const;

export type AppConfig = typeof env;

