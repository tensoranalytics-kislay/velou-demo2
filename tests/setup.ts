import { vi } from 'vitest';

// Mock environment variables
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'mock';
process.env.ENABLE_RAW_RANKED_SEARCH = process.env.ENABLE_RAW_RANKED_SEARCH || 'false';

// Mock Prisma globally
vi.mock('../src/lib/db', async () => {
  const actual = await vi.importActual('../src/lib/db');
  return {
    ...actual,
    prisma: {
      product: {
        findMany: vi.fn(),
      },
      conversationEvent: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $queryRaw: vi.fn(),
    },
  };
});

// Mock LLM provider
vi.mock('../src/lib/llm/provider', () => ({
  callLLM: vi.fn().mockResolvedValue({
    rawText: JSON.stringify({
      intent: 'discovery',
      constraints: {},
      expandedKeywords: [],
    }),
  }),
}));

// Mock config
vi.mock('../src/lib/config', () => ({
  env: {
    llmProvider: 'mock',
    enableRawRankedSearch: false,
  },
}));


