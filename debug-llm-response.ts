import { callLLM } from './src/lib/llm/provider';
import { stripJsonFences } from './src/lib/llm/orchestrator/utils';
import { prisma } from './src/lib/db';

(async () => {
  // Get first 2 categories for testing
  const cats = await prisma.product.findMany({
    where: { isActive: true, category: { not: null } },
    select: { category: true, title: true },
    distinct: ['category'],
    take: 2,
  });
  
  const testData = cats.map(cat => ({
    category: cat.category!,
    sampleProducts: [cat.title],
  }));
  
  console.log('Testing LLM with 2 categories:', testData.map(c => c.category));
  
  const prompt = `You are a category classification expert. Normalize these categories:

1. Original Category: "${testData[0].category}"
   Sample Products: ["${testData[0].sampleProducts[0]}"]

2. Original Category: "${testData[1].category}"
   Sample Products: ["${testData[1].sampleProducts[0]}"]

Return a JSON array:
[
  {
    "original": "original category string",
    "normalized": {
      "category": "standard category name",
      "subcategory": null
    },
    "reasoning": "brief explanation"
  },
  ...
]

ONLY return the JSON array, no other text.`;

  const response = await callLLM({
    messages: [
      { role: 'system', content: 'You are a category classification expert. Always return valid JSON arrays.' },
      { role: 'user', content: prompt },
    ],
    purpose: 'intent',
    expectJson: true,
    maxTokens: 1000,
  });
  
  console.log('\nRaw response:');
  console.log(response.rawText);
  console.log('\nCleaned:');
  const cleaned = stripJsonFences(response.rawText);
  console.log(cleaned);
  
  try {
    const parsed = JSON.parse(cleaned);
    console.log('\nParsed type:', typeof parsed);
    console.log('Is array:', Array.isArray(parsed));
    if (typeof parsed === 'object') {
      console.log('Object keys:', Object.keys(parsed));
    }
  } catch (e) {
    console.log('\nParse error:', e);
  }
  
  await prisma.$disconnect();
})();
