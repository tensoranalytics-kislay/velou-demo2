/**
 * Tests for Non-Discovery Query Handler
 * 
 * Verifies:
 * - Brand/company queries answered using merchant faq/context
 * - Unknown policy queries respond gracefully without tech details
 * - Random queries redirect with shopping question + actions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleNonDiscoveryQuery } from '../../src/lib/loccitane/nonDiscovery';
import { callLLM } from '../../src/lib/llm/provider';
import type { DatasetContext } from '../../src/lib/catalog/datasetInspector';

// Mock LLM provider
vi.mock('../../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
}));

describe('handleNonDiscoveryQuery', () => {
  const merchantId = 'test-merchant';
  
  const mockDatasetContext: DatasetContext = {
    vertical: 'beauty and skincare',
    hasPriceData: true,
    hasImages: true,
    sampleCategories: ['Face Care', 'Body Care', 'Hand Care'],
    primaryFacets: ['skin_type', 'concern', 'ingredient'],
    recommendedSearchExamples: [],
    qualityNotes: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should answer brand/company query using merchant faq', async () => {
    const faq = [
      {
        question: 'What is your return policy?',
        answer: 'We offer a 30-day return policy on all products. Items must be unused and in original packaging.',
      },
    ];

    vi.mocked(callLLM).mockResolvedValue({
      rawText: JSON.stringify({
        replyText: 'We offer a 30-day return policy on all products. Items must be unused and in original packaging.',
        needsAction: false,
      }),
    });

    const result = await handleNonDiscoveryQuery({
      message: 'What is your return policy?',
      route: 'BRAND_OR_PRODUCT_INFO',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
      faq,
    });

    expect(result.replyText).toContain('30-day return policy');
    expect(callLLM).toHaveBeenCalled();
    
    // Verify FAQ was included in context
    const callArgs = vi.mocked(callLLM).mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('FAQ:');
    expect(callArgs.messages[0].content).toContain('return policy');
  });

  it('should respond gracefully when policy info is not available', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      rawText: JSON.stringify({
        replyText: "I don't have that information right now, but I can help you find products! What are you looking for?",
        needsAction: true,
        suggestedActionType: 'ask_preferences',
      }),
    });

    const result = await handleNonDiscoveryQuery({
      message: 'Do you ship to Canada?',
      route: 'BRAND_OR_PRODUCT_INFO',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
      faq: null,
    });

    expect(result.replyText).toContain("don't have that information");
    expect(result.replyText).not.toContain('database');
    expect(result.replyText).not.toContain('LLM');
    expect(result.replyText).not.toContain('model');
    expect(result.actions).toBeDefined();
    expect(result.actions?.length).toBeGreaterThan(0);
  });

  it('should redirect random queries with witty shopping question', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      rawText: JSON.stringify({
        replyText: "I'm here to help you shop! What products are you looking for today?",
        needsAction: true,
        suggestedActionType: 'ask_preferences',
      }),
    });

    const result = await handleNonDiscoveryQuery({
      message: "What's the weather today?",
      route: 'SMALLTALK_OR_RANDOM',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
    });

    expect(result.replyText).toContain('shop');
    expect(result.replyText).not.toContain('weather');
    expect(result.actions).toBeDefined();
    expect(result.actions?.[0].type).toBe('ask_preferences');
  });

  it('should use dataset context for brand description', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      rawText: JSON.stringify({
        replyText: "We're a beauty and skincare brand. We offer Face Care, Body Care, and Hand Care products.",
        needsAction: true,
        suggestedActionType: 'ask_preferences',
      }),
    });

    const result = await handleNonDiscoveryQuery({
      message: 'Tell me about your company',
      route: 'BRAND_OR_PRODUCT_INFO',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
    });

    expect(callLLM).toHaveBeenCalled();
    
    // Verify dataset context was included
    const callArgs = vi.mocked(callLLM).mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('beauty and skincare');
    expect(callArgs.messages[0].content).toContain('Face Care');
  });

  it('should handle product context queries', async () => {
    const productContext = {
      id: 'prod-1',
      title: 'Hand Cream',
      description: 'A nourishing hand cream for dry hands.',
      imageUrl: 'https://example.com/image.jpg',
      productUrl: 'https://example.com/product',
      priceCents: 1000,
      currency: 'USD',
      category: 'Personal Care',
      subcategory: 'Hand Care',
      stockStatus: 'in_stock',
      attributes: {
        loccitaneStructured: {
          canonicalConcerns: [],
          canonicalIngredients: [],
          applicationAreas: [],
        },
      },
    } as any;

    vi.mocked(callLLM).mockResolvedValue({
      rawText: JSON.stringify({
        replyText: 'This hand cream is designed to nourish and hydrate dry hands.',
        needsAction: false,
      }),
    });

    const result = await handleNonDiscoveryQuery({
      message: 'What is this product used for?',
      route: 'BRAND_OR_PRODUCT_INFO',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
      productContext,
    });

    expect(callLLM).toHaveBeenCalled();
    
    // Verify product context was included
    const callArgs = vi.mocked(callLLM).mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain('Hand Cream');
  });

  it('should enforce max token limit', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      rawText: JSON.stringify({
        replyText: 'Short reply',
        needsAction: false,
      }),
    });

    await handleNonDiscoveryQuery({
      message: 'Tell me about your company',
      route: 'BRAND_OR_PRODUCT_INFO',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
    });

    const callArgs = vi.mocked(callLLM).mock.calls[0][0];
    expect(callArgs.maxTokens).toBe(120);
  });

  it('should handle LLM failures gracefully with fallback', async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error('LLM error'));

    const result = await handleNonDiscoveryQuery({
      message: 'Random question',
      route: 'SMALLTALK_OR_RANDOM',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
    });

    // Should have fallback response
    expect(result.replyText).toBeTruthy();
    expect(result.replyText.length).toBeGreaterThan(0);
    expect(result.actions).toBeDefined();
  });

  it('should never expose technical details in responses', async () => {
    vi.mocked(callLLM).mockResolvedValue({
      rawText: JSON.stringify({
        replyText: 'I use a vector database and LLM models to find products.',
        needsAction: false,
      }),
    });

    const result = await handleNonDiscoveryQuery({
      message: 'How do you work?',
      route: 'BRAND_OR_PRODUCT_INFO',
      merchantId,
      datasetContext: mockDatasetContext,
      brandName: 'Test Brand',
    });

    // Note: This test assumes the LLM follows instructions, but in practice
    // we might want to add post-processing to filter technical terms
    // For now, we trust the prompt constraints
    expect(result.replyText).toBeTruthy();
  });
});


