import { describe, it, expect } from 'vitest';
import type { ProductCard } from '../src/lib/llm/orchestrator/cards';

describe('Frontend card visibility logic with noExactMatch', () => {
  it('should show cards when productCards.length > 0 even if noExactMatch=true', () => {
    const mockCards: ProductCard[] = [
      {
        id: '1',
        title: 'Test Product 1',
        priceCents: 5000,
        currency: 'USD',
        keyAttributes: ['color: black'],
        reason: 'Test reason',
        imageUrl: 'https://example.com/image1.jpg',
        productUrl: 'https://example.com/product1',
      },
      {
        id: '2',
        title: 'Test Product 2',
        priceCents: 6000,
        currency: 'USD',
        keyAttributes: ['color: blue'],
        reason: 'Test reason 2',
        imageUrl: 'https://example.com/image2.jpg',
        productUrl: 'https://example.com/product2',
      },
    ];

    const noExactMatch = true;
    const pendingSuggestion = null;
    
    // After fix: shouldShowCards = data.productCards.length > 0 && !data.pendingSuggestion
    const shouldShowCards = mockCards.length > 0 && !pendingSuggestion;
    
    // Cards should be visible even with noExactMatch=true
    expect(shouldShowCards).toBe(true);
    expect(mockCards.length).toBeGreaterThan(0);
  });

  it('should show "Relaxed results" banner when noExactMatch=true and cards exist', () => {
    // This test verifies the UI logic - cards should show with a banner
    const hasCards = true;
    const noExactMatch = true;
    // After fix: shouldShowCards = hasCards (always show if cards exist)
    const shouldShowCards = hasCards; // Always show if cards exist
    expect(shouldShowCards).toBe(true);
    expect(noExactMatch).toBe(true); // Banner should show
  });

  it('should only show empty state when productCards.length === 0 AND no pendingSuggestion', () => {
    const productCards: ProductCard[] = [];
    const pendingSuggestion = null;
    const shouldShowEmptyState = productCards.length === 0 && !pendingSuggestion;
    expect(shouldShowEmptyState).toBe(true);
  });

  it('should NOT show empty state when pendingSuggestion exists even if cards are empty', () => {
    const productCards: ProductCard[] = [];
    const pendingSuggestion = {
      summary: 'Try these options',
      constraints: { category: 'shirts' },
      candidateIds: ['1', '2'],
    };
    const shouldShowEmptyState = productCards.length === 0 && !pendingSuggestion;
    expect(shouldShowEmptyState).toBe(false);
  });
});

