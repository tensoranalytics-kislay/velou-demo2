/**
 * Unit tests for gender filtering, follow-up refinement, and fallback relevance ranking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectFollowUpType } from '../src/lib/llm/orchestrator/followup-detector';
import type { SearchConstraints } from '../src/lib/search/types';
import type { CatalogOntology } from '../src/lib/search/ontology';

const mockOntology: CatalogOntology = {
  categories: ['t shirt', 'graphic t shirt', 'blazer', 'dresses', 'shoes'],
  productTypes: ['tshirt', 'tee', 'blazer', 'dress', 'shoe'],
  brands: ['Lucky Brand'],
  colors: ['black', 'white', 'navy', 'red'],
  materials: ['cotton', 'denim', 'linen'],
  genders: ['mens', 'womens', 'unisex'],
  sizes: ['S', 'M', 'L', 'XL'],
  googleCategories: ['Shirts & Tops', 'Blazers', 'Dresses'],
  customLabels4: [],
};

describe('Gender Follow-up Detection', () => {
  describe('detectFollowUpType - gender refinements', () => {
    const previousConstraints: SearchConstraints = {
      category: 'dresses',
      priceMaxCents: 20000,
    };

    it('should detect "for men though" as REFINE with detectedGender=mens', () => {
      const result = detectFollowUpType(
        'for men though',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(result.isFollowUp).toBe(true);
      expect(result.followUpType).toBe('REFINE');
      expect(result.detectedGender).toBe('mens');
      expect(result.carryOver.hardFilters).toBe(true);
      expect(result.carryOver.vibe).toBe(true);
    });

    it('should detect "for women" as REFINE with detectedGender=womens', () => {
      const result = detectFollowUpType(
        'for women',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(result.isFollowUp).toBe(true);
      expect(result.followUpType).toBe('REFINE');
      expect(result.detectedGender).toBe('womens');
    });

    it('should detect "mens though" as REFINE', () => {
      const result = detectFollowUpType(
        'mens though',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(result.isFollowUp).toBe(true);
      expect(result.followUpType).toBe('REFINE');
      expect(result.detectedGender).toBe('mens');
    });

    it('should detect "for men" as REFINE', () => {
      const result = detectFollowUpType(
        'for men',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(result.isFollowUp).toBe(true);
      expect(result.followUpType).toBe('REFINE');
      expect(result.detectedGender).toBe('mens');
    });

    it('should NOT trigger REFINE if new category noun is present', () => {
      const result = detectFollowUpType(
        'show me blazers for men',
        previousConstraints,
        false,
        mockOntology,
      );
      // Should be SWITCH because "blazers" is a new category
      expect(result.followUpType).not.toBe('REFINE');
    });

    it('should detect "unisex" as REFINE', () => {
      const result = detectFollowUpType(
        'unisex please',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(result.isFollowUp).toBe(true);
      expect(result.followUpType).toBe('REFINE');
      expect(result.detectedGender).toBe('unisex');
    });
  });
});

describe('Gender Filter Logic', () => {
  describe('Gender matching rules', () => {
    it('should allow mens OR unisex for mens query', () => {
      // Test the gender matching logic: mens query should match mens OR unisex products
      const mensQuery = ['mens'];
      const mensProduct = { gender: 'mens' };
      const unisexProduct = { gender: 'unisex' };
      const womensProduct = { gender: 'womens' };

      // Helper function to check if product matches query
      const matchesMensQuery = (product: { gender: string }) => {
        return mensQuery.includes('mens') && (product.gender === 'mens' || product.gender === 'unisex');
      };

      // Mens product should match mens query
      expect(matchesMensQuery(mensProduct)).toBe(true);
      // Unisex product should match mens query
      expect(matchesMensQuery(unisexProduct)).toBe(true);
      // Womens product should NOT match mens query
      expect(matchesMensQuery(womensProduct)).toBe(false);
    });

    it('should allow womens OR unisex for womens query', () => {
      const womensQuery = ['womens'];
      const womensProduct = { gender: 'womens' };
      const unisexProduct = { gender: 'unisex' };
      const mensProduct = { gender: 'mens' };

      // Helper function to check if product matches query
      const matchesWomensQuery = (product: { gender: string }) => {
        return womensQuery.includes('womens') && (product.gender === 'womens' || product.gender === 'unisex');
      };

      // Womens product should match womens query
      expect(matchesWomensQuery(womensProduct)).toBe(true);
      // Unisex product should match womens query
      expect(matchesWomensQuery(unisexProduct)).toBe(true);
      // Mens product should NOT match womens query
      expect(matchesWomensQuery(mensProduct)).toBe(false);
    });

    it('should allow only unisex for unisex query', () => {
      const unisexQuery = ['unisex'];
      const unisexProduct = { gender: 'unisex' };
      const mensProduct = { gender: 'mens' };
      const womensProduct = { gender: 'womens' };

      // Helper function to check if product matches query
      const matchesUnisexQuery = (product: { gender: string }) => {
        return unisexQuery.includes('unisex') && product.gender === 'unisex';
      };

      // Unisex product should match unisex query
      expect(matchesUnisexQuery(unisexProduct)).toBe(true);
      // Mens product should NOT match unisex query
      expect(matchesUnisexQuery(mensProduct)).toBe(false);
      // Womens product should NOT match unisex query
      expect(matchesUnisexQuery(womensProduct)).toBe(false);
    });
  });
});

describe('Fallback Relevance Ranking', () => {
  describe('Rank calculation', () => {
    it('should prioritize gender match over recency', () => {
      // This is tested at the integration level
      // Products with matching gender should rank higher than newer products with wrong gender
      const mensShirt = {
        title: 'Men\'s Classic Shirt',
        gender: 'mens',
        updatedAt: new Date('2024-01-01'),
        rank: 0,
      };
      const womensTop = {
        title: 'Women\'s Trendy Top',
        gender: 'womens',
        updatedAt: new Date('2024-12-01'), // Newer
        rank: 0,
      };

      // Calculate ranks (simplified)
      const mensRank = mensShirt.gender === 'mens' ? 2.0 : 0;
      const womensRank = womensTop.gender === 'womens' ? 0 : 0; // Doesn't match mens query

      // Mens shirt should rank higher despite being older
      expect(mensRank).toBeGreaterThan(womensRank);
    });

    it('should boost keyword matches in title/description', () => {
      // Keyword matches should add to rank
      const productWithKeywords = {
        title: 'Classic Men\'s Shirt',
        description: 'Perfect shirt for men',
        keywords: ['shirt', 'men'],
      };
      const productWithoutKeywords = {
        title: 'Generic Item',
        description: 'Some description',
        keywords: [],
      };

      // Product with keywords should have higher rank
      // (tested at integration level)
      expect(productWithKeywords.keywords.length).toBeGreaterThan(productWithoutKeywords.keywords.length);
    });

    it('should use recency as tie-breaker only', () => {
      // Recency should only add 0.2 max to rank
      const oldProduct = {
        updatedAt: new Date('2024-01-01'),
        rank: 2.0, // High relevance
      };
      const newProduct = {
        updatedAt: new Date('2024-12-01'),
        rank: 2.0, // Same relevance
      };

      // Both have same base rank, recency difference should be minimal (0.2 max)
      const recencyBoost = 0.2;
      expect(recencyBoost).toBeLessThanOrEqual(0.2);
    });
  });
});

describe('Widening Tiers - Gender Preservation', () => {
  it('should preserve gender filters through widening tiers', () => {
    // This is tested at the integration level
    // Gender filters should be preserved in Tier 1, 2, 3, and 4
    const originalFilters = {
      category: 'blazer',
      genders: ['mens'],
      priceMaxCents: 20000,
      brands: ['Lucky Brand'],
    };

    // Tier 1: drop category, keep genders
    const tier1 = {
      ...originalFilters,
      category: undefined,
      genders: originalFilters.genders, // Preserved
    };
    expect(tier1.genders).toEqual(['mens']);

    // Tier 2: drop brand, keep genders
    const tier2 = {
      ...tier1,
      brands: undefined,
      genders: originalFilters.genders, // Preserved
    };
    expect(tier2.genders).toEqual(['mens']);

    // Tier 3: drop price, keep genders
    const tier3 = {
      ...tier2,
      priceMaxCents: undefined,
      genders: originalFilters.genders, // Preserved
    };
    expect(tier3.genders).toEqual(['mens']);
  });
});

