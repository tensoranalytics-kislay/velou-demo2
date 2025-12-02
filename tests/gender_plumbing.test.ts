import { describe, it, expect } from 'vitest';
import { mergeConstraints } from '../src/lib/llm/orchestrator/intent';
import type { SearchConstraints } from '../src/lib/search/types';

describe('Gender plumbing - constraints merge', () => {
  it('should override previous genders when new message says "tshirts for women"', () => {
    const prev: SearchConstraints = {
      genders: ['mens'],
      category: 'shirts',
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'shirts',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'tshirts for women', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['womens']);
    expect(result.category).toBe('shirts');
  });

  it('should keep previous genders when new message has no gender mention', () => {
    const prev: SearchConstraints = {
      genders: ['mens'],
      category: 'shirts',
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'pants',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'show me pants', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['mens']); // Sticky
  });

  it('should override to mens when message says "for men"', () => {
    const prev: SearchConstraints = {
      genders: ['womens'],
      category: 'dresses',
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'dresses',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'for men', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['mens']);
  });
});


