import { describe, it, expect } from 'vitest';
import { mergeConstraints } from '../src/lib/llm/orchestrator/intent';
import type { SearchConstraints } from '../src/lib/search/types';

describe('mergeConstraints - sticky gender behavior', () => {
  it('should keep previous genders when new has none', () => {
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
    expect(result.genders).toEqual(['mens']);
  });

  it('should override to womens when new says "for women"', () => {
    const prev: SearchConstraints = {
      genders: ['mens'],
      category: 'shirts',
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'dresses',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'show me dresses for women', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['womens']);
  });

  it('should override to unisex when new says "unisex"', () => {
    const prev: SearchConstraints = {
      genders: ['mens'],
      category: 'shirts',
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'hoodies',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'unisex hoodies', 'carry', ['genders', 'inStockOnly']);
    expect(result.genders).toEqual(['unisex']);
  });

  it('should keep sticky gender even on category change', () => {
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
    expect(result.genders).toEqual(['mens']);
    expect(result.category).toBe('pants');
  });

  it('should clear gender on reset', () => {
    const prev: SearchConstraints = {
      genders: ['mens'],
      category: 'shirts',
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'dresses',
      inStockOnly: true,
    };
    const result = mergeConstraints(prev, updates, 'reset', 'reset', ['genders', 'inStockOnly']);
    expect(result.genders).toBeUndefined();
  });

  it('should keep inStockOnly as sticky', () => {
    const prev: SearchConstraints = {
      genders: ['mens'],
      inStockOnly: true,
    };
    const updates: SearchConstraints = {
      category: 'shirts',
    };
    const result = mergeConstraints(prev, updates, 'show me shirts', 'carry', ['genders', 'inStockOnly']);
    expect(result.inStockOnly).toBe(true);
  });
});

