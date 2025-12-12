import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../src/lib/db';
// This test is for the legacy orchestrator which has been removed
// TODO: Remove or rewrite this test for the fast path
// import { handleLoccitaneQuery } from '../src/lib/loccitane/orchestrator';

// Mock Prisma
vi.mock('../src/lib/db', () => ({
  prisma: {
    conversationEvent: {
      findFirst: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
  },
}));

// Mock search
vi.mock('../src/lib/search', () => ({
  searchProducts: vi.fn().mockResolvedValue({
    candidates: [],
    wasRelaxed: false,
    dbCandidates: 0,
  }),
  searchProductsRelaxed: vi.fn().mockResolvedValue({
    candidates: [],
    wasRelaxed: false,
    dbCandidates: 0,
  }),
}));

// Mock ontology
vi.mock('../src/lib/search/ontology', () => ({
  getCatalogOntology: vi.fn().mockResolvedValue({
    categories: ['shirts', 'pants'],
    colors: ['black', 'white'],
    materials: ['cotton'],
    sizes: ['S', 'M', 'L'],
    brands: ['Lucky Brand'],
    genders: ['mens', 'womens', 'unisex'],
    productTypes: ['t-shirt', 'jeans'],
  }),
}));

// Mock LLM
vi.mock('../src/lib/llm/provider', () => ({
  callLLM: vi.fn().mockResolvedValue({
    rawText: JSON.stringify({
      threadType: 'new_search',
      shouldUsePreviousContext: false,
      reasonBrief: 'test',
    }),
  }),
}));

// Mock config
vi.mock('../src/lib/config', () => ({
  env: {
    llmProvider: 'mock',
  },
}));

describe('DB fallback for conversation context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load last ConversationEvent when context is missing', async () => {
    const mockLastEvent = {
      userQuery: 'show me blazers for men',
      createdAt: new Date(),
    };

    (prisma.conversationEvent.findFirst as any).mockResolvedValue(mockLastEvent);

    const result = await handleAssistantQuery({
      sessionId: 'test-session',
      pageType: 'HOME',
      message: 'white shirts',
      conversationContext: undefined, // Missing context
    });

    expect(prisma.conversationEvent.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: 'test-session',
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        userQuery: true,
        createdAt: true,
      },
    });
  });

  it('should not query DB when context exists', async () => {
    const existingContext = {
      lastUserQuery: 'show me blazers',
      lastConstraints: {
        genders: ['mens'],
        category: 'blazers',
        inStockOnly: true,
      },
      lastIntent: 'discovery' as const,
    };

    await handleAssistantQuery({
      sessionId: 'test-session',
      pageType: 'HOME',
      message: 'white shirts',
      conversationContext: existingContext,
    });

    expect(prisma.conversationEvent.findFirst).not.toHaveBeenCalled();
  });

  it('should handle DB query failure gracefully', async () => {
    (prisma.conversationEvent.findFirst as any).mockRejectedValue(new Error('DB error'));

    // Should not throw
    await expect(
      handleAssistantQuery({
        sessionId: 'test-session',
        pageType: 'HOME',
        message: 'white shirts',
        conversationContext: undefined,
      }),
    ).resolves.toBeDefined();
  });
});

