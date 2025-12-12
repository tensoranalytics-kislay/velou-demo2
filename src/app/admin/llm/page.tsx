import { env } from '@/lib/config';
import { prisma } from '@/lib/db';
import LLMConfigDisplay from './LLMConfigDisplay';

async function getMerchant() {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: 'default' },
  });

  if (!merchant) {
    throw new Error('Default merchant not found. Please run the migration first.');
  }

  return merchant;
}

export default async function LLMConfigPage() {
  const config = await getMerchant();
  const currentProvider = env.llmProvider;
  const hasOpenAIKey = Boolean(env.openaiApiKey);

  return (
    <div className="max-w-3xl">
      <h2 className="mb-6 text-2xl font-semibold text-slate-900">LLM Configuration</h2>
      <p className="mb-8 text-slate-600">
        View current LLM provider settings. Configuration is primarily managed via environment
        variables.
      </p>
      <LLMConfigDisplay
        currentProvider={currentProvider}
        hasOpenAIKey={hasOpenAIKey}
        useMerchantKey={config.useMerchantKey}
        hasMerchantOpenAIKey={Boolean(config.merchantOpenAIKey)}
        primaryModel={env.primaryLlmModel}
        reasoningModel={env.reasoningLlmModel}
        lightModel={env.lightLlmModel}
      />
    </div>
  );
}

