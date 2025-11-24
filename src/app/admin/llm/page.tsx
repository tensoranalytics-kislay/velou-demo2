import { env } from '@/lib/config';
import { prisma } from '@/lib/db';
import LLMConfigDisplay from './LLMConfigDisplay';

async function getBrandConfig() {
  return prisma.brandConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      brandName: 'Velou Atelier',
      primaryColor: '#3b82f6',
      accentColor: '#8b5cf6',
      voiceInstructions: 'Be helpful and warm.',
      toneFormal: 5,
      tonePlayful: 5,
    },
  });
}

export default async function LLMConfigPage() {
  const config = await getBrandConfig();
  const currentProvider = env.llmProvider;
  const hasOpenAIKey = Boolean(env.openaiApiKey);
  const hasPerplexityKey = Boolean(env.perplexityApiKey);

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
        hasPerplexityKey={hasPerplexityKey}
        useMerchantKey={config.useMerchantKey}
        hasMerchantOpenAIKey={Boolean(config.merchantOpenAIKey)}
        hasMerchantPerplexityKey={Boolean(config.merchantPerplexityKey)}
      />
    </div>
  );
}

