import { describe, it, expect } from 'vitest';
import { mergeConstraints } from '../src/lib/llm/orchestrator/intent';
import type { SearchConstraints } from '../src/lib/search/types';

describe('Orchestrator gender merge - follow-up override', () => {
  it('should override previous genders when follow-up says "for men"', () => {
    const prev: SearchConstraints = {
      category: 'dresses',
      genders: ['womens'],
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'dresses',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'for men', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['mens']);
    expect(result.category).toBe('dresses'); // Category unchanged
  });

  it('should override previous genders when follow-up says "mens"', () => {
    const prev: SearchConstraints = {
      category: 'shirts',
      genders: ['womens'],
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'shirts',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'mens', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['mens']);
  });

  it('should keep previous genders when follow-up has no gender mention', () => {
    const prev: SearchConstraints = {
      category: 'shirts',
      genders: ['mens'],
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'shirts',
      colors: ['black'],
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'black ones', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['mens']); // Sticky
    expect(result.colors).toEqual(['black']);
  });
});

