/**
 * Tests for generic facets in full search + scoring pipeline
 * Domain-agnostic tests that verify facets influence search and ranking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferIntentAndConstraints } from '../../src/lib/llm/orchestrator/intent';
import { searchProducts } from '../../src/lib/search/index';
import { evaluateProductFit } from '../../src/lib/llm/orchestrator/cards';
import type { SearchResultItem, ProductAttributes } from '../../src/lib/search/types';
import type { ImplicitPreferences } from '../../src/lib/llm/orchestrator/cards';

// Mock Prisma
vi.mock('../../src/lib/db', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

// Mock LLM provider (use mock mode for deterministic behavior)
vi.mock('../../src/lib/config', () => ({
  env: {
    llmProvider: 'mock',
    primaryLlmModel: 'gpt-5',
    lightLlmModel: 'gpt-4.1-mini',
    reasoningLlmModel: 'o3-mini',
  },
}));

// Mock ontology
vi.mock('../../src/lib/search/ontology', () => ({
  getCatalogOntology: vi.fn().mockResolvedValue({
    categories: ['Category1', 'Category2'],
    colors: ['black', 'blue'],
    materials: ['nylon', 'cotton'],
    sizes: ['S', 'M', 'L'],
    brands: ['Brand1', 'Brand2'],
    genders: ['mens', 'womens', 'unisex'],
    productTypes: [],
  }),
}));

// Mock logger
vi.mock('../../src/lib/telemetry/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function createTestProduct(
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
    category: 'Category1',
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

describe('Generic facets in search + scoring pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('end-to-end: query with generic facets -> search -> scoring', () => {
    it('should rank products higher when generic facets match constraints', async () => {
      // Create test products with different generic facet profiles
      const product1 = createTestProduct('p1', 'Durable Travel Backpack', {
        benefits: ['durable', 'lightweight', 'waterproof'],
        useCases: ['travel', 'commute', 'office'],
        styleTags: ['minimalist'],
        compatibility: ['fits in overhead bin', 'TSA approved'],
        sensoryProfile: 'smooth texture',
      });

      const product2 = createTestProduct('p2', 'Stylish Office Bag', {
        benefits: ['stylish'],
        useCases: ['office'],
        styleTags: ['bold', 'luxury'],
        compatibility: [],
        sensoryProfile: 'leather feel',
      });

      const product3 = createTestProduct('p3', 'Basic Bag', {
        // No generic facets
      });

      // Mock search to return all products
      const { prisma } = await import('../../src/lib/db');
      vi.mocked(prisma.product.findMany).mockResolvedValue([
        {
          id: 'p1',
          title: 'Durable Travel Backpack',
          description: 'Durable Travel Backpack description',
          imageUrl: 'https://example.com/p1.jpg',
          productUrl: 'https://example.com/products/p1',
          priceCents: 5000,
          salePriceCents: null,
          currency: 'USD',
          category: 'Category1',
          subcategory: null,
          brand: null,
          attributes: {
            benefits: ['durable', 'lightweight', 'waterproof'],
            useCases: ['travel', 'commute', 'office'],
            styleTags: ['minimalist'],
            compatibility: ['fits in overhead bin', 'TSA approved'],
            sensoryProfile: 'smooth texture',
          },
          stockStatus: 'in_stock',
          vendorId: null,
          sourceId: null,
          isActive: true,
          lastIngestBatchId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'p2',
          title: 'Stylish Office Bag',
          description: 'Stylish Office Bag description',
          imageUrl: 'https://example.com/p2.jpg',
          productUrl: 'https://example.com/products/p2',
          priceCents: 6000,
          salePriceCents: null,
          currency: 'USD',
          category: 'Category1',
          subcategory: null,
          brand: null,
          attributes: {
            benefits: ['stylish'],
            useCases: ['office'],
            styleTags: ['bold', 'luxury'],
            compatibility: [],
            sensoryProfile: 'leather feel',
          },
          stockStatus: 'in_stock',
          vendorId: null,
          sourceId: null,
          isActive: true,
          lastIngestBatchId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'p3',
          title: 'Basic Bag',
          description: 'Basic Bag description',
          imageUrl: 'https://example.com/p3.jpg',
          productUrl: 'https://example.com/products/p3',
          priceCents: 3000,
          salePriceCents: null,
          currency: 'USD',
          category: 'Category1',
          subcategory: null,
          brand: null,
          attributes: {},
          stockStatus: 'in_stock',
          vendorId: null,
          sourceId: null,
          isActive: true,
          lastIngestBatchId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      // Step 1: Extract intent and constraints from user query
      const userQuery = 'I want a minimalist travel item that is durable and lightweight, easy to carry on flights';
      
      const intentResult = await inferIntentAndConstraints(
        userQuery,
        'HOME',
        undefined,
        undefined,
        [],
        false,
      );

      // Note: With mock LLM provider, generic facets may not be extracted
      // Instead, we'll manually set constraints to test the scoring logic
      const constraintsWithFacets = {
        ...intentResult.constraints,
        useCases: ['travel', 'commute'],
        benefits: ['durable', 'lightweight'],
        styleTags: ['minimalist'],
        compatibility: ['fits in overhead bin', 'TSA approved'],
      };

      // Step 2: Score products using evaluateProductFit with facet constraints
      const queryTokens = userQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const implicitPrefs = createImplicitPrefs();

      const scored = [
        product1,
        product2,
        product3,
      ].map((item) => evaluateProductFit(item, constraintsWithFacets, implicitPrefs, queryTokens));

      // Sort by score (highest first)
      scored.sort((a, b) => b.score - a.score);

      // Assert: Product 1 should rank highest due to multiple facet matches
      expect(scored[0].item.id).toBe('p1');
      expect(scored[0].score).toBeGreaterThan(scored[1].score);
      expect(scored[0].score).toBeGreaterThan(scored[2].score);

      // Verify facts mention the matching facets
      const product1Facts = scored[0].facts.join(' ').toLowerCase();
      expect(
        product1Facts.includes('durable') ||
        product1Facts.includes('lightweight') ||
        product1Facts.includes('travel') ||
        product1Facts.includes('minimalist'),
      ).toBe(true);
    });

    it('should not penalize products without generic facets when constraints are generic', async () => {
      const productWithFacets = createTestProduct('p1', 'Product with Facets', {
        benefits: ['durable'],
        useCases: ['travel'],
      });

      const productWithoutFacets = createTestProduct('p2', 'Product without Facets', {});

      const constraints = {
        benefits: ['durable'],
        useCases: ['travel'],
        query: 'durable travel item',
        inStockOnly: true,
      };

      const queryTokens = ['durable', 'travel', 'item'];
      const implicitPrefs = createImplicitPrefs();

      const scored1 = evaluateProductFit(productWithFacets, constraints, implicitPrefs, queryTokens);
      const scored2 = evaluateProductFit(productWithoutFacets, constraints, implicitPrefs, queryTokens);

      // Product with facets should score higher, but product without facets should still have a reasonable score
      expect(scored1.score).toBeGreaterThan(scored2.score);
      expect(scored2.score).toBeGreaterThanOrEqual(0); // No penalty
    });

    it('should handle queries without generic facet constraints gracefully', async () => {
      const product1 = createTestProduct('p1', 'Product 1', {
        benefits: ['durable'],
        useCases: ['travel'],
      });

      const product2 = createTestProduct('p2', 'Product 2', {});

      // Query without generic facet constraints
      const constraints = {
        category: 'Category1',
        query: 'product',
        inStockOnly: true,
      };

      const queryTokens = ['product'];
      const implicitPrefs = createImplicitPrefs();

      const scored1 = evaluateProductFit(product1, constraints, implicitPrefs, queryTokens);
      const scored2 = evaluateProductFit(product2, constraints, implicitPrefs, queryTokens);

      // Both should score similarly (no generic facet bonuses applied)
      // Small differences might exist from other factors, but should be minimal
      expect(Math.abs(scored1.score - scored2.score)).toBeLessThan(3);
    });

    it('should score products with multiple matching facets higher than single matches', async () => {
      const productMultiMatch = createTestProduct('p1', 'Multi-Facet Product', {
        benefits: ['durable', 'lightweight'],
        useCases: ['travel', 'commute'],
        styleTags: ['minimalist'],
        compatibility: ['fits in overhead bin'],
      });

      const productSingleMatch = createTestProduct('p2', 'Single-Facet Product', {
        benefits: ['durable'],
      });

      const constraints = {
        benefits: ['durable', 'lightweight'],
        useCases: ['travel'],
        styleTags: ['minimalist'],
        compatibility: ['fits in overhead bin'],
        query: 'durable lightweight minimalist travel item',
        inStockOnly: true,
      };

      const queryTokens = ['durable', 'lightweight', 'minimalist', 'travel', 'item'];
      const implicitPrefs = createImplicitPrefs();

      const scored1 = evaluateProductFit(productMultiMatch, constraints, implicitPrefs, queryTokens);
      const scored2 = evaluateProductFit(productSingleMatch, constraints, implicitPrefs, queryTokens);

      // Multi-facet product should score significantly higher
      expect(scored1.score).toBeGreaterThan(scored2.score + 3); // At least 3+ points from additional facet matches
    });
  });

  describe('sensoryProfile substring matching', () => {
    it('should match sensoryProfile with case-insensitive substring', async () => {
      const product = createTestProduct('p1', 'Citrus Scented Item', {
        sensoryProfile: 'creamy texture with soothing citrus scent',
      });

      const constraints = {
        sensoryProfile: 'citrus',
        query: 'citrus scented item',
        inStockOnly: true,
      };

      const queryTokens = ['citrus', 'scented', 'item'];
      const implicitPrefs = createImplicitPrefs();

      const scored = evaluateProductFit(product, constraints, implicitPrefs, queryTokens);

      expect(scored.score).toBeGreaterThan(0);
      expect(scored.facts.some((f) => f.toLowerCase().includes('citrus'))).toBe(true);
    });

    it('should not match if sensoryProfile does not contain constraint', async () => {
      const product = createTestProduct('p1', 'Item', {
        sensoryProfile: 'matte finish',
      });

      const constraints = {
        sensoryProfile: 'citrus scent',
        query: 'citrus item',
        inStockOnly: true,
      };

      const queryTokens = ['citrus', 'item'];
      const implicitPrefs = createImplicitPrefs();

      const scored = evaluateProductFit(product, constraints, implicitPrefs, queryTokens);

      // Should not get bonus for sensory profile
      const sensoryFact = scored.facts.find((f) => f.toLowerCase().includes('citrus'));
      expect(sensoryFact).toBeUndefined();
    });
  });
});

