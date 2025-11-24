import { handleAssistantQuery } from '../src/lib/llm/orchestrator';

async function runSmokeTest(prompt: string) {
  const result = await handleAssistantQuery({
    sessionId: `smoke-${prompt.slice(0, 5)}`,
    pageType: 'HOME',
    message: prompt,
    history: [],
  });

  if (result.productCards.length > 4) {
    throw new Error(`Expected <= 4 products, got ${result.productCards.length} for "${prompt}"`);
  }

  result.productCards.forEach((card, index) => {
    if (!card.reason || card.reason.length < 10) {
      throw new Error(`Missing dynamic reason on card ${index + 1} for "${prompt}"`);
    }
    if (card.queryChips && card.queryChips.length > 5) {
      throw new Error(`Too many query chips (${card.queryChips.length}) on card ${card.id}`);
    }
  });

  return result.productCards.map((card) => ({
    title: card.title,
    reason: card.reason,
    chips: card.queryChips?.map((chip) => chip.label),
  }));
}

async function main() {
  const prompts = ['beach clothing under $60', 'winter clothes for India in December'];
  for (const prompt of prompts) {
    const summary = await runSmokeTest(prompt);
    console.log(`\n${prompt}`);
    console.table(summary);
  }
}

main().catch((error) => {
  console.error('[assistantSmoke] failed:', error);
  process.exit(1);
});

