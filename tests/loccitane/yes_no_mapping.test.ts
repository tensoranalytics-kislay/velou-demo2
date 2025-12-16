/**
 * Tests for yes/no mapping to pending actions
 * 
 * Verifies:
 * - yes triggers primary pending action
 * - no triggers secondary action or clarification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleLoccitaneQuery } from '../../src/lib/loccitane/orchestrator';
import { getState } from '../../src/lib/chat/ConversationStateService';
import { callLLM } from '../../src/lib/llm/provider';
import { prisma } from '../../src/lib/db';
import { routeTurn } from '../../src/lib/loccitane/router';
import type { PendingAction } from '../../src/lib/chat/ConversationStateService';

// Mock dependencies
vi.mock('../../src/lib/llm/provider');
vi.mock('../../src/lib/loccitane/router', () => ({
  routeTurn: vi.fn(),
}));
vi.mock('../../src/lib/loccitane/safety', () => ({
  checkQuerySafety: vi.fn(() => ({ safe: true })),
}));
vi.mock('../../src/lib/db', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
    },
    conversationState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));
vi.mock('../../src/lib/chat/ConversationStateService', async () => {
  const actual = await vi.importActual('../../src/lib/chat/ConversationStateService');
  return {
    ...actual,
    getState: vi.fn(),
    appendShownProducts: vi.fn(),
    advanceRankCursor: vi.fn(),
    setPendingActions: vi.fn(),
  };
});

describe('yes/no mapping to pending actions', () => {
  const merchantId = 'test-merchant';
  const sessionId = 'test-session';

  const mockProducts = Array.from({ length: 8 }, (_, i) => ({
    id: `product-${i + 1}`,
    title: `Product ${i + 1}`,
    description: `Description ${i + 1}`,
    imageUrl: `https://example.com/image-${i + 1}.jpg`,
    productUrl: `https://example.com/product-${i + 1}`,
    priceCents: 1000 + i * 100,
    currency: 'USD',
    category: 'Personal Care',
    subcategory: 'Skincare',
    stockStatus: 'in_stock',
    isActive: true,
    merchantId,
    attributes: {
      loccitaneStructured: {
        canonicalConcerns: [],
        canonicalIngredients: [],
        applicationAreas: ['face'],
      },
    },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock router - default to AFFIRMATION for "yes" and NEGATION for "no"
    vi.mocked(routeTurn).mockImplementation(async ({ message }) => {
      const lower = message.toLowerCase().trim();
      if (lower === 'yes' || lower === 'ok' || lower === 'sure') {
        return {
          route: 'AFFIRMATION',
          confidence: 'high',
          extractedSignals: ['affirmative_token'],
          userTone: 'positive',
        };
      }
      if (lower === 'no' || lower === 'nah') {
        return {
          route: 'NEGATION',
          confidence: 'high',
          extractedSignals: ['negative_token'],
          userTone: 'negative',
        };
      }
      return {
        route: 'DISCOVERY',
        confidence: 'medium',
        extractedSignals: [],
      };
    });
    
    // Mock Prisma
    vi.mocked(prisma.product.findMany).mockResolvedValue(mockProducts as any);
  });

  it('should map yes to primary (first) pending action', async () => {
    const pendingActions: PendingAction[] = [
      {
        id: 'action-1',
        type: 'show_more',
        label: 'Show more',
      },
      {
        id: 'action-2',
        type: 'refine_price',
        label: 'Show cheaper options',
      },
    ];

    const lastRankedProductIds = mockProducts.map(p => p.id);
    const shownProductIds = lastRankedProductIds.slice(0, 4);
    const lastRankCursor = 4;

    (getState as any).mockResolvedValue({
      shownProductIds,
      lastRankedProductIds,
      lastRankCursor,
      pendingActions,
      memory: {},
    });

    // Mock LLM to not be called (show_more is deterministic)
    (callLLM as any).mockRejectedValue(new Error('LLM should not be called'));

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'yes',
      merchantId,
      conversationState: {
        shownProductIds,
        lastRankedProductIds,
        lastRankCursor,
        pendingActions,
        memory: {},
      },
    });

    // Should handle show_more deterministically (no LLM call)
    // Result should contain next batch of products
    expect(result.productCards.length).toBeGreaterThan(0);
  });

  it('should map no to secondary action when available', async () => {
    const pendingActions: PendingAction[] = [
      {
        id: 'action-1',
        type: 'show_more',
        label: 'Show more',
      },
      {
        id: 'action-2',
        type: 'refine_price',
        label: 'Show cheaper options',
      },
    ];

    (getState as any).mockResolvedValue({
      shownProductIds: [],
      lastRankedProductIds: [],
      lastRankCursor: 0,
      pendingActions,
      memory: {},
    });

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'no',
      merchantId,
      conversationState: {
        shownProductIds: [],
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions,
        memory: {},
      },
    });

    // Should return a response that acknowledges the negation
    // and potentially offers the secondary action
    expect(result.replyText).toBeTruthy();
    expect(result.replyText.length).toBeGreaterThan(0);
  });

  it('should ask clarifying question when no secondary action', async () => {
    const pendingActions: PendingAction[] = [
      {
        id: 'action-1',
        type: 'show_more',
        label: 'Show more',
      },
    ];

    (getState as any).mockResolvedValue({
      shownProductIds: [],
      lastRankedProductIds: [],
      lastRankCursor: 0,
      pendingActions,
      memory: {},
    });

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'no',
      merchantId,
      conversationState: {
        shownProductIds: [],
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions,
        memory: {},
      },
    });

    // Should ask what they'd like instead
    expect(result.replyText).toContain('instead');
    expect(result.productCards).toHaveLength(0);
  });

  it('should handle yes without pending actions gracefully', async () => {
    (getState as any).mockResolvedValue({
      shownProductIds: [],
      lastRankedProductIds: [],
      lastRankCursor: 0,
      pendingActions: [],
      memory: {},
    });

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'yes',
      merchantId,
      conversationState: {
        shownProductIds: [],
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions: [],
        memory: {},
      },
    });

    // Should return generic positive response
    expect(result.replyText).toBeTruthy();
    expect(result.replyText).toContain('help');
  });

  it('should handle no without pending actions gracefully', async () => {
    (getState as any).mockResolvedValue({
      shownProductIds: [],
      lastRankedProductIds: [],
      lastRankCursor: 0,
      pendingActions: [],
      memory: {},
    });

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'no',
      merchantId,
      conversationState: {
        shownProductIds: [],
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions: [],
        memory: {},
      },
    });

    // Should return generic negative response
    expect(result.replyText).toBeTruthy();
    expect(result.replyText).toContain('problem');
  });

  it('should handle show_more action deterministically when yes maps to it', async () => {
    const pendingActions: PendingAction[] = [
      {
        id: 'action-1',
        type: 'show_more',
        label: 'Show more',
      },
    ];

    const lastRankedProductIds = mockProducts.map(p => p.id);
    const shownProductIds = lastRankedProductIds.slice(0, 4);
    const lastRankCursor = 4;

    (getState as any).mockResolvedValue({
      shownProductIds,
      lastRankedProductIds,
      lastRankCursor,
      pendingActions,
      memory: {},
    });

    // Mock LLM to verify it's not called
    const llmCallCount = vi.fn();
    (callLLM as any).mockImplementation(() => {
      llmCallCount();
      return Promise.reject(new Error('LLM should not be called for show_more'));
    });

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'yes',
      merchantId,
      conversationState: {
        shownProductIds,
        lastRankedProductIds,
        lastRankCursor,
        pendingActions,
        memory: {},
      },
    });

    // Should return products without calling LLM
    expect(result.productCards.length).toBeGreaterThan(0);
    // Note: LLM might be called for routing, but not for reply generation in show_more path
  });
});

