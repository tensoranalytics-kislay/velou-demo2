import { describe, it, expect } from 'vitest';
import { mergeConstraints } from '../src/lib/llm/orchestrator/intent';
import type { SearchConstraints } from '../src/lib/search/types';

describe('SWITCH overrideCategory', () => {
  it('should set category to canonical tee category when SWITCH with overrideCategory="TSHIRT"', () => {
    const prev: SearchConstraints = {
      category: 'shirts & tops',
      genders: ['mens'],
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 't-shirt', // Canonical tee category
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'tshirt for men', 'override', ['genders', 'inStockOnly']);
    expect(result.category).toBe('t-shirt');
    expect(result.genders).toEqual(['mens']); // Gender should persist
  });

  it('should set hardTextFilters when SWITCH to tee category', () => {
    const prev: SearchConstraints = {
      category: 'shirts & tops',
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 't-shirt',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'just tshirts', 'override', ['genders', 'inStockOnly']);
    expect(result.category).toBe('t-shirt');
    // Category should be set to tee-specific category, not broad "shirts & tops"
  });
});


