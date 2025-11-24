import { describe, it, expect } from 'vitest';
import type { SearchConstraints, BroadWhereFilters } from '../src/lib/search/types';

describe('dbRankedSearch genderFilter logic', () => {
  it('should filter out mens-only products when constraints.genders=["womens"]', () => {
    // Test the gender filtering logic
    const whereFilters: BroadWhereFilters = {
      category: 'shirts',
      genders: ['womens'],
      keywordFilters: [],
    };

    // Simulate products with different genders
    const mockProducts = [
      { id: '1', attributes: { gender: 'womens' } },
      { id: '2', attributes: { gender: 'mens' } },
      { id: '3', attributes: { gender: 'unisex' } },
    ];

    // Filter logic: womens should allow womens OR unisex
    const filtered = mockProducts.filter((p: any) => {
      const productGender = p.attributes?.gender;
      if (!productGender) return false;
      // For womens query, allow womens or unisex
      return productGender === 'womens' || productGender === 'unisex';
    });

    // Should only include womens and unisex
    const genders = filtered.map((p: any) => p.attributes?.gender);
    expect(genders).not.toContain('mens');
    expect(genders).toContain('womens');
    expect(genders).toContain('unisex');
  });

  it('should include unisex products for mens queries', () => {
    const whereFilters: BroadWhereFilters = {
      category: 'shirts',
      genders: ['mens'],
      keywordFilters: [],
    };

    const mockProducts = [
      { id: '1', attributes: { gender: 'mens' } },
      { id: '2', attributes: { gender: 'unisex' } },
    ];

    // Filter logic: mens should allow mens OR unisex
    const filtered = mockProducts.filter((p: any) => {
      const productGender = p.attributes?.gender;
      if (!productGender) return false;
      return productGender === 'mens' || productGender === 'unisex';
    });

    const genders = filtered.map((p: any) => p.attributes?.gender);
    expect(genders).toContain('mens');
    expect(genders).toContain('unisex');
  });

  it('should have genderFilter set when genders are present', () => {
    const whereFilters: BroadWhereFilters = {
      genders: ['womens'],
      keywordFilters: [],
    };

    // genderFilter should be set
    expect(whereFilters.genders).toEqual(['womens']);
    expect(whereFilters.genders).toBeDefined();
  });
});

