/**
 * Tests for "show more" deterministic paging
 * 
 * Verifies:
 * - No duplicates across pages
 * - Cursor advances correctly
 * - No LLM call in this path
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleLoccitaneQuery } from '../../src/lib/loccitane/orchestrator';
import { getState, appendShownProducts, advanceRankCursor } from '../../src/lib/chat/ConversationStateService';
import { callLLM } from '../../src/lib/llm/provider';
import { prisma } from '../../src/lib/db';
import { routeTurn } from '../../src/lib/loccitane/router';

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

describe('show_more paging', () => {
  const merchantId = 'test-merchant';
  const sessionId = 'test-session';
  
  const mockProducts = Array.from({ length: 12 }, (_, i) => ({
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
    
    // Mock router to return ACTION_REQUEST for "show more"
    vi.mocked(routeTurn).mockResolvedValue({
      route: 'ACTION_REQUEST',
      confidence: 'high',
      extractedSignals: ['show_more_request'],
      actionType: 'show_more',
      userTone: 'neutral',
    });
    
    // Mock Prisma to filter products by IDs
    vi.mocked(prisma.product.findMany).mockImplementation(async (args: any) => {
      const where = args?.where;
      const ids = where?.id?.in;
      if (ids && Array.isArray(ids)) {
        return mockProducts.filter(p => ids.includes(p.id));
      }
      return mockProducts;
    });
  });

  it('should return next 4 products from cached ranked list', async () => {
    const lastRankedProductIds = mockProducts.map(p => p.id);
    const shownProductIds = lastRankedProductIds.slice(0, 4); // First 4 shown
    const lastRankCursor = 4;

    // Mock conversation state
    (getState as any).mockResolvedValue({
      shownProductIds,
      lastRankedProductIds,
      lastRankCursor,
      pendingActions: [],
      memory: {},
    });

    // Mock state update functions
    (appendShownProducts as any).mockResolvedValue(undefined);
    (advanceRankCursor as any).mockResolvedValue(8);

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'show more',
      merchantId,
      conversationState: {
        shownProductIds,
        lastRankedProductIds,
        lastRankCursor,
        pendingActions: [],
        memory: {},
      },
    });

    // Should return next 4 products (indices 4-7)
    expect(result.productCards).toHaveLength(4);
    expect(result.productCards[0].id).toBe('product-5');
    expect(result.productCards[3].id).toBe('product-8');
    
    // Should not call LLM (deterministic path)
    expect(callLLM).not.toHaveBeenCalled();
    
    // Should update shown products
    expect(appendShownProducts).toHaveBeenCalledWith(
      merchantId,
      sessionId,
      ['product-5', 'product-6', 'product-7', 'product-8']
    );
    
    // Should advance cursor
    expect(advanceRankCursor).toHaveBeenCalledWith(merchantId, sessionId, 4);
    
    // Should return short reply text
    expect(result.replyText).toContain('more options');
    expect(result.replyText.length).toBeLessThan(100);
  });

  it('should exclude already shown products', async () => {
    const lastRankedProductIds = mockProducts.map(p => p.id);
    const shownProductIds = ['product-1', 'product-3', 'product-5', 'product-7']; // Non-consecutive
    const lastRankCursor = 4;

    (getState as any).mockResolvedValue({
      shownProductIds,
      lastRankedProductIds,
      lastRankCursor,
      pendingActions: [],
      memory: {},
    });

    (appendShownProducts as any).mockResolvedValue(undefined);
    (advanceRankCursor as any).mockResolvedValue(8);

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'show more',
      merchantId,
      conversationState: {
        shownProductIds,
        lastRankedProductIds,
        lastRankCursor,
        pendingActions: [],
        memory: {},
      },
    });

    // Should not include already shown products
    const resultIds = result.productCards.map(c => c.id);
    expect(resultIds).not.toContain('product-1');
    expect(resultIds).not.toContain('product-3');
    expect(resultIds).not.toContain('product-5');
    expect(resultIds).not.toContain('product-7');
    
    // Should only include new products
    expect(resultIds.length).toBeGreaterThan(0);
    expect(resultIds.length).toBeLessThanOrEqual(4);
  });

  it('should handle no more products gracefully', async () => {
    const lastRankedProductIds = mockProducts.slice(0, 4).map(p => p.id);
    const shownProductIds = lastRankedProductIds; // All shown
    const lastRankCursor = 4;

    (getState as any).mockResolvedValue({
      shownProductIds,
      lastRankedProductIds,
      lastRankCursor,
      pendingActions: [],
      memory: {},
    });

    const result = await handleLoccitaneQuery({
      sessionId,
      message: 'show more',
      merchantId,
      conversationState: {
        shownProductIds,
        lastRankedProductIds,
        lastRankCursor,
        pendingActions: [],
        memory: {},
      },
    });

    // Should return empty cards with message
    expect(result.productCards).toHaveLength(0);
    expect(result.replyText).toContain('all available');
  });

  it('should not call LLM for show_more action', async () => {
    const lastRankedProductIds = mockProducts.map(p => p.id);
    const shownProductIds = lastRankedProductIds.slice(0, 4);
    const lastRankCursor = 4;

    (getState as any).mockResolvedValue({
      shownProductIds,
      lastRankedProductIds,
      lastRankCursor,
      pendingActions: [],
      memory: {},
    });

    (appendShownProducts as any).mockResolvedValue(undefined);
    (advanceRankCursor as any).mockResolvedValue(8);

    await handleLoccitaneQuery({
      sessionId,
      message: 'show more',
      merchantId,
      conversationState: {
        shownProductIds,
        lastRankedProductIds,
        lastRankCursor,
        pendingActions: [],
        memory: {},
      },
    });

    // Verify LLM was never called
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('should advance cursor correctly', async () => {
    const lastRankedProductIds = mockProducts.map(p => p.id);
    const shownProductIds: string[] = [];
    let lastRankCursor = 0;

    (getState as any).mockResolvedValue({
      shownProductIds,
      lastRankedProductIds,
      lastRankCursor,
      pendingActions: [],
      memory: {},
    });

    (appendShownProducts as any).mockResolvedValue(undefined);
    (advanceRankCursor as any).mockImplementation((m, s, inc) => {
      lastRankCursor += inc;
      return Promise.resolve(lastRankCursor);
    });

    // First page
    await handleLoccitaneQuery({
      sessionId,
      message: 'show more',
      merchantId,
      conversationState: {
        shownProductIds,
        lastRankedProductIds,
        lastRankCursor: 0,
        pendingActions: [],
        memory: {},
      },
    });

    expect(advanceRankCursor).toHaveBeenCalledWith(merchantId, sessionId, 4);
  });
});

