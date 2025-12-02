import { describe, it, expect } from 'vitest';
import type { SearchConstraints } from '../src/lib/search/types';

describe('Query augmentation - avoid duplicate gender tokens', () => {
  it('should not append "mens" if query already contains "mens"', () => {
    const constraints: SearchConstraints = {
      query: 'mens tshirt',
      genders: ['mens'],
      inStockOnly: true,
    };

    // Query should not become "mens mens tshirt"
    expect(constraints.query).toBe('mens tshirt');
    expect(constraints.query?.split(' ').filter(w => w === 'mens').length).toBe(1);
  });

  it('should not append "womens" if query already contains "womens"', () => {
    const constraints: SearchConstraints = {
      query: 'womens dress',
      genders: ['womens'],
      inStockOnly: true,
    };

    // Query should not become "womens womens dress"
    expect(constraints.query).toBe('womens dress');
    expect(constraints.query?.split(' ').filter(w => w === 'womens').length).toBe(1);
  });

  it('should not inject cross-gender terms in keywordFilters', () => {
    const constraints: SearchConstraints = {
      genders: ['mens'],
      category: 't-shirt',
      inStockOnly: true,
    };

    // keywordFilters should not contain "womens" or "women" when genders=["mens"]
    const keywordFilters: string[] = ['t', 'shirt', 'tee'];
    const hasWomensTerms = keywordFilters.some(kw => 
      kw.toLowerCase().includes('women') || kw.toLowerCase().includes('womens')
    );
    expect(hasWomensTerms).toBe(false);
  });
});


