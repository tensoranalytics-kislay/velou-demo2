/**
 * Tests for generic facet scoring in evaluateProductFit
 */

import { describe, it, expect } from 'vitest';
import { evaluateProductFit } from '../../src/lib/llm/orchestrator/cards';
import type { SearchConstraints, SearchResultItem, ProductAttributes } from '../../src/lib/search/types';
import type { ImplicitPreferences } from '../../src/lib/llm/orchestrator/cards';

function createProduct(
  id: string,
  title: string,
  attributes: Partial<ProductAttributes> = {},
): SearchResultItem {
  return {
    id,
    title,
    description: `${title} description`,
    imageUrl: `https://example.com/${id}.jpg`,
    productUrl: `https://example.com/products/${id}`,
    priceCents: 5000,
    currency: 'USD',
    category: 'Test Category',
    stockStatus: 'in_stock',
    attributes: attributes as ProductAttributes,
  };
}

function createImplicitPrefs(): ImplicitPreferences {
  return {
    fabrics: [],
    materials: [],
    seasons: [],
    fits: [],
    useCases: [],
    categories: [],
    notes: [],
  };
}

describe('evaluateProductFit with generic facets', () => {
  describe('benefits scoring', () => {
    it('should add score bonus for matching benefits', () => {
      const product1 = createProduct('p1', 'Durable Travel Bag', {
        benefits: ['durable', 'lightweight', 'waterproof'],
      });
      const product2 = createProduct('p2', 'Basic Bag', {});

      const constraints: SearchConstraints = {
        benefits: ['durable', 'lightweight'],
        query: 'durable, lightweight bag',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      // Product 1 should score higher due to matching benefits
      expect(result1.score).toBeGreaterThan(result2.score);
      expect(result1.facts.some((f) => f.includes('durable') || f.includes('lightweight'))).toBe(true);
    });

    it('should add proportional bonus for multiple matching benefits', () => {
      const product = createProduct('p1', 'Premium Item', {
        benefits: ['durable', 'lightweight', 'energy efficient'],
      });

      const constraints: SearchConstraints = {
        benefits: ['durable', 'lightweight', 'energy efficient'],
        query: 'durable, lightweight, energy efficient',
        inStockOnly: true,
      };

      const result = evaluateProductFit(product, constraints, createImplicitPrefs(), []);

      // Should get bonus for all 3 matches (3 * 1.5 = 4.5, capped at 3 matches = 4.5)
      expect(result.score).toBeGreaterThanOrEqual(4.5);
      expect(result.facts.some((f) => f.includes('durable') || f.includes('lightweight') || f.includes('energy efficient'))).toBe(true);
    });

    it('should not penalize products without benefits field', () => {
      const product = createProduct('p1', 'Simple Product', {});

      const constraints: SearchConstraints = {
        benefits: ['durable'],
        query: 'durable product',
        inStockOnly: true,
      };

      const result = evaluateProductFit(product, constraints, createImplicitPrefs(), []);

      // Should not have negative score from missing benefits
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('useCases scoring', () => {
    it('should add score bonus for matching use cases', () => {
      const product1 = createProduct('p1', 'Travel Backpack', {
        useCases: ['travel', 'office', 'gift'],
      });
      const product2 = createProduct('p2', 'Regular Backpack', {});

      const constraints: SearchConstraints = {
        useCases: ['travel', 'office'],
        query: 'travel backpack for office',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      expect(result1.score).toBeGreaterThan(result2.score);
      expect(result1.facts.some((f) => f.includes('travel') || f.includes('office'))).toBe(true);
    });

    it('should handle case-insensitive matching', () => {
      const product = createProduct('p1', 'Travel Item', {
        useCases: ['Travel', 'Office', 'Gift'],
      });

      const constraints: SearchConstraints = {
        useCases: ['travel', 'office'],
        query: 'travel item',
        inStockOnly: true,
      };

      const result = evaluateProductFit(product, constraints, createImplicitPrefs(), []);

      expect(result.score).toBeGreaterThan(0);
      expect(result.facts.some((f) => f.toLowerCase().includes('travel') || f.toLowerCase().includes('office'))).toBe(true);
    });
  });

  describe('styleTags scoring', () => {
    it('should add score bonus for matching style tags', () => {
      const product1 = createProduct('p1', 'Minimalist Desk', {
        styleTags: ['minimalist', 'luxury', 'modern'],
      });
      const product2 = createProduct('p2', 'Basic Desk', {});

      const constraints: SearchConstraints = {
        styleTags: ['minimalist', 'luxury'],
        query: 'minimalist luxury desk',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      expect(result1.score).toBeGreaterThan(result2.score);
      expect(result1.facts.some((f) => f.includes('minimalist') || f.includes('luxury'))).toBe(true);
    });
  });

  describe('compatibility scoring', () => {
    it('should add score bonus for matching compatibility requirements', () => {
      const product1 = createProduct('p1', 'iOS Compatible Device', {
        compatibility: ['works with iOS', 'works with Android', 'for small rooms'],
      });
      const product2 = createProduct('p2', 'Basic Device', {});

      const constraints: SearchConstraints = {
        compatibility: ['works with iOS', 'for small rooms'],
        query: 'iOS device for small room',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      expect(result1.score).toBeGreaterThan(result2.score);
      expect(result1.facts.some((f) => f.includes('iOS') || f.includes('small'))).toBe(true);
    });
  });

  describe('sensoryProfile scoring', () => {
    it('should add score bonus for substring match in sensory profile', () => {
      const product1 = createProduct('p1', 'Citrus Scented Cream', {
        sensoryProfile: 'creamy texture with soothing citrus scent',
      });
      const product2 = createProduct('p2', 'Unscented Cream', {});

      const constraints: SearchConstraints = {
        sensoryProfile: 'citrus',
        query: 'citrus scented cream',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      expect(result1.score).toBeGreaterThan(result2.score);
      expect(result1.facts.some((f) => f.toLowerCase().includes('citrus'))).toBe(true);
    });

    it('should handle case-insensitive substring matching', () => {
      const product = createProduct('p1', 'Soft Feel Item', {
        sensoryProfile: 'Soft feel with smooth finish',
      });

      const constraints: SearchConstraints = {
        sensoryProfile: 'soft feel',
        query: 'soft feel item',
        inStockOnly: true,
      };

      const result = evaluateProductFit(product, constraints, createImplicitPrefs(), []);

      expect(result.score).toBeGreaterThan(0);
      expect(result.facts.some((f) => f.toLowerCase().includes('soft'))).toBe(true);
    });

    it('should not match if sensory profile does not contain constraint', () => {
      const product = createProduct('p1', 'Item', {
        sensoryProfile: 'matte finish',
      });

      const constraints: SearchConstraints = {
        sensoryProfile: 'citrus scent',
        query: 'citrus item',
        inStockOnly: true,
      };

      const result = evaluateProductFit(product, constraints, createImplicitPrefs(), []);

      // Should not get bonus for sensory profile
      const sensoryFact = result.facts.find((f) => f.toLowerCase().includes('citrus'));
      expect(sensoryFact).toBeUndefined();
    });
  });

  describe('combined generic facets', () => {
    it('should score product with multiple matching generic facets higher', () => {
      const product1 = createProduct('p1', 'Premium Travel Item', {
        benefits: ['durable', 'lightweight'],
        useCases: ['travel', 'office'],
        styleTags: ['minimalist'],
        compatibility: ['for small spaces'],
        sensoryProfile: 'smooth finish',
      });
      const product2 = createProduct('p2', 'Basic Item', {});

      const constraints: SearchConstraints = {
        benefits: ['durable', 'lightweight'],
        useCases: ['travel'],
        styleTags: ['minimalist'],
        compatibility: ['for small spaces'],
        sensoryProfile: 'smooth',
        query: 'durable, lightweight, minimalist travel item for small spaces with smooth finish',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      // Product 1 should score significantly higher
      expect(result1.score).toBeGreaterThan(result2.score + 5); // Should have multiple bonuses
    });

    it('should work with traditional attributes and generic facets together', () => {
      const product = createProduct('p1', 'Travel Bag', {
        fabric: 'nylon',
        benefits: ['durable', 'lightweight'],
        useCases: ['travel'],
        color: 'black',
      });

      const constraints: SearchConstraints = {
        colors: ['black'],
        fabrics: ['nylon'],
        benefits: ['durable'],
        useCases: ['travel'],
        query: 'black nylon durable travel bag',
        inStockOnly: true,
      };

      const result = evaluateProductFit(product, constraints, createImplicitPrefs(), []);

      // Should get bonuses for both traditional and generic facets
      expect(result.score).toBeGreaterThan(3); // Category + color + fabric + benefits + useCases
      expect(result.facts.length).toBeGreaterThan(3);
    });
  });

  describe('backward compatibility', () => {
    it('should not break scoring for products without generic facets', () => {
      const product = createProduct('p1', 'Apparel Item', {
        fabric: 'cotton',
        color: 'blue',
        season: 'summer',
      });

      const constraints: SearchConstraints = {
        colors: ['blue'],
        fabrics: ['cotton'],
        seasons: ['summer'],
        query: 'blue cotton summer item',
        inStockOnly: true,
      };

      const result = evaluateProductFit(product, constraints, createImplicitPrefs(), []);

      // Should still score normally without generic facets
      expect(result.score).toBeGreaterThan(0);
      expect(result.facts.length).toBeGreaterThan(0);
    });

    it('should not penalize when generic facet constraints are undefined', () => {
      const product1 = createProduct('p1', 'Product with Benefits', {
        benefits: ['durable'],
      });
      const product2 = createProduct('p2', 'Product without Benefits', {});

      const constraints: SearchConstraints = {
        // No generic facet constraints
        query: 'product',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      // Both should score similarly (no generic facet bonuses applied)
      // Small difference might exist from other factors, but should be minimal
      expect(Math.abs(result1.score - result2.score)).toBeLessThan(2);
    });
  });

  describe('real-world example: travel item query', () => {
    it('should rank durable, lightweight travel item higher than basic item', () => {
      const product1 = createProduct('p1', 'Durable Travel Backpack', {
        benefits: ['durable', 'lightweight', 'waterproof'],
        useCases: ['travel', 'office', 'gift'],
        styleTags: ['minimalist'],
        compatibility: ['for frequent flyers'],
      });
      const product2 = createProduct('p2', 'Basic Backpack', {
        benefits: ['durable'],
      });

      const constraints: SearchConstraints = {
        benefits: ['durable', 'lightweight'],
        useCases: ['travel'],
        query: 'durable, lightweight travel item for frequent flyers',
        inStockOnly: true,
      };

      const result1 = evaluateProductFit(product1, constraints, createImplicitPrefs(), []);
      const result2 = evaluateProductFit(product2, constraints, createImplicitPrefs(), []);

      // Product 1 should score higher due to multiple matching facets
      expect(result1.score).toBeGreaterThan(result2.score);
      expect(result1.facts.some((f) => f.includes('durable') || f.includes('lightweight') || f.includes('travel'))).toBe(true);
    });
  });
});



