import { describe, it, expect } from 'vitest';
import { deduplicateProductCards } from '../src/lib/llm/orchestrator/cards';
import type { ProductCard } from '../src/lib/llm/orchestrator/cards';

describe('Deduplication by productUrl/canonicalSku', () => {
  it('should dedupe by productUrl when 3 variants share same productUrl', () => {
    const cards: ProductCard[] = [
      {
        id: '1',
        title: 'Graphic Tee',
        priceCents: 2000,
        currency: 'USD',
        keyAttributes: ['color: black'],
        reason: 'Test',
        imageUrl: 'https://example.com/image1.jpg',
        productUrl: 'https://example.com/product/tee',
      },
      {
        id: '2',
        title: 'Graphic Tee',
        priceCents: 2000,
        currency: 'USD',
        keyAttributes: ['color: blue'],
        reason: 'Test',
        imageUrl: 'https://example.com/image2.jpg',
        productUrl: 'https://example.com/product/tee', // Same URL
      },
      {
        id: '3',
        title: 'Graphic Tee',
        priceCents: 2000,
        currency: 'USD',
        keyAttributes: ['color: red'],
        reason: 'Test',
        imageUrl: 'https://example.com/image3.jpg',
        productUrl: 'https://example.com/product/tee', // Same URL
      },
    ];

    const result = deduplicateProductCards(cards);

    // Should return only 1 card (first one with that productUrl)
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('should dedupe by title+imageUrl when productUrl is missing', () => {
    const cards: ProductCard[] = [
      {
        id: '1',
        title: 'Graphic Tee',
        priceCents: 2000,
        currency: 'USD',
        keyAttributes: ['color: black'],
        reason: 'Test',
        imageUrl: 'https://example.com/image1.jpg',
        productUrl: '', // Missing
      },
      {
        id: '2',
        title: 'Graphic Tee',
        priceCents: 2000,
        currency: 'USD',
        keyAttributes: ['color: blue'],
        reason: 'Test',
        imageUrl: 'https://example.com/image1.jpg', // Same image
        productUrl: '', // Missing
      },
    ];

    const result = deduplicateProductCards(cards);

    // Should dedupe by title+imageUrl
    expect(result.length).toBe(1);
  });

  it('should keep highest-ranked card when duplicates found', () => {
    const cards: ProductCard[] = [
      {
        id: '1',
        title: 'Graphic Tee',
        priceCents: 2000,
        currency: 'USD',
        keyAttributes: ['color: black'],
        reason: 'Test',
        imageUrl: 'https://example.com/image1.jpg',
        productUrl: 'https://example.com/product/tee',
      },
      {
        id: '2',
        title: 'Graphic Tee',
        priceCents: 2000,
        currency: 'USD',
        keyAttributes: ['color: blue'],
        reason: 'Test',
        imageUrl: 'https://example.com/image2.jpg',
        productUrl: 'https://example.com/product/tee',
      },
    ];

    const result = deduplicateProductCards(cards);

    // Should keep first (highest-ranked) card
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });
});

