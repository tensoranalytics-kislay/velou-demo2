import { describe, it, expect } from 'vitest';
import { deduplicateProductCards, buildProductCard } from '../src/lib/llm/orchestrator/cards';
import type { SearchResultItem } from '../src/lib/search/types';

describe('deduplicateProductCards - Title-based deduplication', () => {
  const createMockItem = (
    id: string,
    title: string,
    productUrl?: string,
  ): SearchResultItem => ({
    id,
    title,
    description: 'Test description',
    imageUrl: 'https://example.com/image.jpg',
    productUrl: productUrl || `https://example.com/product/${id}`,
    priceCents: 10000,
    currency: 'USD',
    category: 'test',
    stockStatus: 'in_stock',
    attributes: {},
  });

  it('should deduplicate products with same title (case-insensitive)', () => {
    const items = [
      createMockItem('1', 'Budweiser Horses in Golden Glow'),
      createMockItem('2', 'BUDWEISER HORSES IN GOLDEN GLOW'), // Same title, different case
      createMockItem('3', 'Different Product'),
    ];

    const cards = items.map((item) => buildProductCard(item));
    const deduplicated = deduplicateProductCards(cards, 10);

    expect(deduplicated.length).toBe(2);
    expect(deduplicated[0].id).toBe('1'); // First occurrence kept
    expect(deduplicated[1].id).toBe('3');
  });

  it('should deduplicate products with same title but different punctuation', () => {
    const items = [
      createMockItem('1', 'Budweiser Horses in Golden Glow'),
      createMockItem('2', 'Budweiser Horses in Golden Glow!'), // Same title, different punctuation
      createMockItem('3', 'Different Product'), // Different product
    ];

    const cards = items.map((item) => buildProductCard(item));
    const deduplicated = deduplicateProductCards(cards, 10);

    // normalizeTitle removes punctuation, so first two should be considered duplicates
    expect(deduplicated.length).toBe(2);
    expect(deduplicated[0].id).toBe('1'); // First occurrence kept
    expect(deduplicated[1].id).toBe('3');
  });

  it('should deduplicate products with same title but different whitespace', () => {
    const items = [
      createMockItem('1', 'Budweiser Horses in Golden Glow'),
      createMockItem('2', 'Budweiser  Horses  in  Golden  Glow'), // Extra spaces
      createMockItem('3', 'Different Product'), // Different product
    ];

    const cards = items.map((item) => buildProductCard(item));
    const deduplicated = deduplicateProductCards(cards, 10);

    // normalizeTitle collapses multiple spaces, so first two should be deduplicated
    expect(deduplicated.length).toBe(2);
    expect(deduplicated[0].id).toBe('1'); // First occurrence kept
    expect(deduplicated[1].id).toBe('3');
  });

  it('should keep different products with different titles', () => {
    const items = [
      createMockItem('1', 'Product A'),
      createMockItem('2', 'Product B'),
      createMockItem('3', 'Product C'),
    ];

    const cards = items.map((item) => buildProductCard(item));
    const deduplicated = deduplicateProductCards(cards, 10);

    expect(deduplicated.length).toBe(3);
    expect(deduplicated.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('should respect limit when deduplicating', () => {
    const items = [
      createMockItem('1', 'Product A'),
      createMockItem('2', 'Product B'),
      createMockItem('3', 'Product C'),
      createMockItem('4', 'Product D'),
      createMockItem('5', 'Product E'),
    ];

    const cards = items.map((item) => buildProductCard(item));
    const deduplicated = deduplicateProductCards(cards, 3);

    expect(deduplicated.length).toBe(3);
    expect(deduplicated.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('should handle empty title gracefully', () => {
    const items = [
      createMockItem('1', ''),
      createMockItem('2', 'Product B'),
    ];

    const cards = items.map((item) => buildProductCard(item));
    const deduplicated = deduplicateProductCards(cards, 10);

    // Empty titles should be normalized to empty string, so only one should be kept
    expect(deduplicated.length).toBe(2); // Actually, empty string normalization might keep both
    // This test verifies it doesn't crash
  });

  it('should prioritize first occurrence when duplicates exist', () => {
    const items = [
      createMockItem('1', 'Same Title', 'url1'),
      createMockItem('2', 'Same Title', 'url2'), // Same title, different URL
      createMockItem('3', 'Same Title', 'url3'), // Same title, different URL
    ];

    const cards = items.map((item) => buildProductCard(item));
    const deduplicated = deduplicateProductCards(cards, 10);

    // Only first occurrence should be kept
    expect(deduplicated.length).toBe(1);
    expect(deduplicated[0].id).toBe('1');
    expect(deduplicated[0].productUrl).toBe('url1');
  });
});

