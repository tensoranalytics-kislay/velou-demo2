import { describe, it, expect } from 'vitest';
import type { ProductAttributes, SearchConstraints } from '../../src/lib/search/types';
import { matchesAttributeFilters } from '../../src/lib/search/index';

describe('matchesAttributeFilters unified behavior', () => {
  it('allows candidates when no facet constraints are provided', () => {
    const attrs: ProductAttributes = {};
    const constraints: SearchConstraints = {
      category: 'personal care',
    };

    expect(matchesAttributeFilters(attrs, constraints)).toBe(true);
  });

  it('respects explicit facet constraints when attributes match', () => {
    const attrs: ProductAttributes = {
      color: 'Lavender',
    };
    const constraints: SearchConstraints = {
      colors: ['lavender'],
    };

    expect(matchesAttributeFilters(attrs, constraints)).toBe(true);
  });

  it('drops products when required facet data is missing', () => {
    const attrs: ProductAttributes = {};
    const constraints: SearchConstraints = {
      colors: ['black'],
    };

    expect(matchesAttributeFilters(attrs, constraints)).toBe(false);
  });

  it('treats category bridging as best-effort and non-fatal', () => {
    const attrs: ProductAttributes = {
      brand: "L'Occitane",
    };
    const constraints: SearchConstraints = {
      category: 'personal care',
    };
    const categoryBridge = [{ googleCategory: 'Skincare' }];

    expect(matchesAttributeFilters(attrs, constraints, categoryBridge)).toBe(true);
  });
});



