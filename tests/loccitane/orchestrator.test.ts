/**
 * Tests for L'Occitane Orchestrator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLoccitaneQuery } from '../../src/lib/loccitane/orchestrator';
import type { QueryClassification } from '../../src/lib/loccitane/classifier';
import type { ProductWithLoccitaneAttributes } from '../../src/lib/loccitane/ranking/ranker';
import type { QueryClassification } from '../../src/lib/loccitane/classifier';
import type { ProductWithLoccitaneAttributes } from '../../src/lib/loccitane/ranking/ranker';

// Mock dependencies
vi.mock('../../src/lib/loccitane/safety', () => ({
  checkQuerySafety: vi.fn(),
}));

vi.mock('../../src/lib/loccitane/classifier', () => ({
  classifyQuery: vi.fn(),
}));

vi.mock('../../src/lib/loccitane/retrieval', () => ({
  multiViewRetrieval: vi.fn(),
}));

vi.mock('../../src/lib/loccitane/ranking/ranker', () => ({
  sortProductsByScore: vi.fn(),
}));

vi.mock('../../src/lib/loccitane/reply', () => ({
  generateReplyWithRag: vi.fn(),
}));

vi.mock('../../src/lib/db', () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
    },
  },
}));

import { checkQuerySafety } from '../../src/lib/loccitane/safety';
import { classifyQuery } from '../../src/lib/loccitane/classifier';
import { multiViewRetrieval } from '../../src/lib/loccitane/retrieval';
import { sortProductsByScore } from '../../src/lib/loccitane/ranking/ranker';
import { generateReplyWithRag } from '../../src/lib/loccitane/reply';
import { prisma } from '../../src/lib/db';

describe('handleLoccitaneQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  const mockProductWithStructured = {
    id: 'prod1',
    title: 'Immortelle Reset Serum',
    description: 'Anti-aging serum',
    imageUrl: 'https://example.com/image.jpg',
    productUrl: 'https://example.com/product',
    priceCents: 3500,
    salePriceCents: null,
    currency: 'USD',
    category: 'Face Care',
    subcategory: null,
    stockStatus: 'in_stock',
    attributes: {
      collection: 'Immortelle Divine',
      loccitaneStructured: {
        concerns: ['Aging'],
        skinTypes: ['Dry'],
        hairTypes: [],
        applicationAreas: ['Face'],
        productType: 'Serum',
        formula: null,
        featuredIngredients: ['Immortelle'],
        allIngredients: ['Immortelle'],
        madeWithout: [],
        ageGroups: ['Adult'],
        genders: ['Unisex'],
        canonicalConcerns: ['aging'],
        canonicalIngredients: ['immortelle'],
      },
    },
    shopifyBestseller: true,
    shopifySalesRank: 5,
  };
  
  describe('safety gate', () => {
    it('should return safe response for unsafe queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({
        safe: false,
        reason: 'unsafe',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'unsafe query',
      });
      
      expect(result.productCards).toEqual([]);
      expect(result.replyText).toContain('beauty and skincare');
      expect(result.noExactMatch).toBe(true);
      expect(checkQuerySafety).toHaveBeenCalledWith('unsafe query');
    });
    
    it('should return witty redirect for non-shopping queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({
        safe: false,
        reason: 'non_shopping',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'write me a poem',
      });
      
      expect(classifyQuery).not.toHaveBeenCalled();
      expect(multiViewRetrieval).not.toHaveBeenCalled();
      expect(result.productCards).toEqual([]);
      expect(result.replyText.toLowerCase()).toMatch(/beauty|personal care|skincare|product/);
      expect(result.noExactMatch).toBe(true);
    });
  });
  
  describe('query classification', () => {
    it('should handle unrelated queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'unrelated',
        constraints: {},
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'unrelated query',
      });
      
      expect(result.productCards).toEqual([]);
      expect(result.replyText.toLowerCase()).toMatch(/beauty|personal care|skincare|product/);
      expect(classifyQuery).toHaveBeenCalled();
    });
  });
  
  describe('direct product search', () => {
    it('should process direct product search queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'direct_product_search',
        constraints: {
          productTypes: ['Serum'],
          collections: ['Immortelle'],
        },
      });
      
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: ['prod1'],
        lexicalScores: new Map([['prod1', 0.9]]),
        semanticScores: new Map([['prod1', 0.8]]),
        conceptMatches: new Map(),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([mockProductWithStructured] as any);
      
      vi.mocked(sortProductsByScore).mockReturnValue([
        {
          id: 'prod1',
          title: 'Immortelle Reset Serum',
          description: 'Anti-aging serum',
          imageUrl: 'https://example.com/image.jpg',
          productUrl: 'https://example.com/product',
          priceCents: 3500,
          salePriceCents: null,
          currency: 'USD',
          category: 'Face Care',
          stockStatus: 'in_stock',
          attributes: {
            collection: 'Immortelle Divine',
            loccitaneStructured: mockProductWithStructured.attributes.loccitaneStructured,
          },
          shopifyBestseller: true,
          shopifySalesRank: 5,
        },
      ] as any);
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: 'Here is the Immortelle Reset Serum you requested.',
        followupText: 'Would you like to see other serums?',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'Immortelle Reset serum',
      });
      
      expect(result.replyText).toContain('Immortelle Reset Serum');
      expect(result.productCards.length).toBeGreaterThan(0);
      expect(result.followupText).toBeDefined();
      expect(multiViewRetrieval).toHaveBeenCalled();
      expect(sortProductsByScore).toHaveBeenCalled();
      expect(generateReplyWithRag).toHaveBeenCalled();
    });
  });
  
  describe('symptom/concern queries', () => {
    it('should process symptom concern queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'symptom_concern',
        constraints: {
          concerns: ['aging', 'dryness'],
          skinTypes: ['Dry'],
        },
      });
      
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: ['prod1'],
        lexicalScores: new Map([['prod1', 0.7]]),
        semanticScores: new Map([['prod1', 0.8]]),
        conceptMatches: new Map([['aging', new Set(['prod1'])]]),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([mockProductWithStructured] as any);
      
      vi.mocked(sortProductsByScore).mockReturnValue([
        {
          id: 'prod1',
          title: 'Immortelle Reset Serum',
          description: 'Anti-aging serum',
          imageUrl: 'https://example.com/image.jpg',
          productUrl: 'https://example.com/product',
          priceCents: 3500,
          salePriceCents: null,
          currency: 'USD',
          category: 'Face Care',
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: mockProductWithStructured.attributes.loccitaneStructured,
          },
          shopifyBestseller: true,
          shopifySalesRank: 5,
        },
      ] as any);
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: 'I found products that address your aging concerns.',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'I have fine lines and dry skin',
      });
      
      expect(result.replyText).toContain('aging');
      expect(result.productCards.length).toBeGreaterThan(0);
    });
  });
  
  describe('ingredient exploration', () => {
    it('should process ingredient-only queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'ingredient_exploration',
        constraints: {
          mustHaveIngredients: ['immortelle'],
        },
      });
      
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: ['prod1'],
        lexicalScores: new Map([['prod1', 0.6]]),
        semanticScores: new Map([['prod1', 0.7]]),
        conceptMatches: new Map([['immortelle', new Set(['prod1'])]]),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([mockProductWithStructured] as any);
      
      vi.mocked(sortProductsByScore).mockReturnValue([
        {
          id: 'prod1',
          title: 'Immortelle Reset Serum',
          description: 'Anti-aging serum',
          imageUrl: 'https://example.com/image.jpg',
          productUrl: 'https://example.com/product',
          priceCents: 3500,
          salePriceCents: null,
          currency: 'USD',
          category: 'Face Care',
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: mockProductWithStructured.attributes.loccitaneStructured,
          },
          shopifyBestseller: true,
          shopifySalesRank: 5,
        },
      ] as any);
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: 'I found products with immortelle.',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'shea butter',
      });
      
      expect(result.productCards.length).toBeGreaterThan(0);
      expect(classifyQuery).toHaveBeenCalledWith('shea butter', undefined);
    });
  });
  
  describe('gift/vague queries', () => {
    it('should process gift or vague queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'gift_or_vague',
        constraints: {
          priceMaxCents: 5000,
        },
      });
      
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: ['prod1'],
        lexicalScores: new Map([['prod1', 0.5]]),
        semanticScores: new Map([['prod1', 0.6]]),
        conceptMatches: new Map(),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([mockProductWithStructured] as any);
      
      vi.mocked(sortProductsByScore).mockReturnValue([
        {
          id: 'prod1',
          title: 'Immortelle Reset Serum',
          description: 'Anti-aging serum',
          imageUrl: 'https://example.com/image.jpg',
          productUrl: 'https://example.com/product',
          priceCents: 3500,
          salePriceCents: null,
          currency: 'USD',
          category: 'Face Care',
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: mockProductWithStructured.attributes.loccitaneStructured,
          },
          shopifyBestseller: true,
          shopifySalesRank: 5,
        },
      ] as any);
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: 'Here are some great gift options.',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'gifts for mom under $50',
      });
      
      expect(result.productCards.length).toBeGreaterThan(0);
    });
  });
  
  describe('product exclusion', () => {
    it('should exclude previously shown products', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'direct_product_search',
        constraints: {},
      });
      
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: ['prod1', 'prod2'],
        lexicalScores: new Map([['prod1', 0.9], ['prod2', 0.8]]),
        semanticScores: new Map(),
        conceptMatches: new Map(),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([
        mockProductWithStructured,
        { ...mockProductWithStructured, id: 'prod2', title: 'Product 2' },
      ] as any);
      
      vi.mocked(sortProductsByScore).mockReturnValue([
        {
          id: 'prod1',
          title: 'Immortelle Reset Serum',
          description: 'Anti-aging serum',
          imageUrl: 'https://example.com/image.jpg',
          productUrl: 'https://example.com/product',
          priceCents: 3500,
          salePriceCents: null,
          currency: 'USD',
          category: 'Face Care',
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: mockProductWithStructured.attributes.loccitaneStructured,
          },
          shopifyBestseller: true,
          shopifySalesRank: 5,
        },
        {
          id: 'prod2',
          title: 'Product 2',
          description: 'Description',
          imageUrl: 'https://example.com/image2.jpg',
          productUrl: 'https://example.com/product2',
          priceCents: 2000,
          salePriceCents: null,
          currency: 'USD',
          category: 'Face Care',
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: mockProductWithStructured.attributes.loccitaneStructured,
          },
          shopifyBestseller: false,
          shopifySalesRank: null,
        },
      ] as any);
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: 'Here are products.',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'products',
        lastShownProductIds: ['prod1'],
      });
      
      // prod1 should be filtered out before ranking
      expect(sortProductsByScore).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.arrayContaining([
          expect.objectContaining({ id: 'prod2' }),
        ]),
        expect.any(Object)
      );
    });
  });
  
  describe('self-harm/crisis handling', () => {
    it('should return compassionate response for self-harm queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ 
        safe: false, 
        reason: 'self_harm' 
      });
      
      // Should not call classifier or retrieval for self-harm queries
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'I want to kill myself',
      });
      
      expect(classifyQuery).not.toHaveBeenCalled();
      expect(multiViewRetrieval).not.toHaveBeenCalled();
      expect(result.productCards).toEqual([]);
      expect(result.replyText).toContain('difficult time');
      expect(result.replyText).toContain('not alone');
      expect(result.replyText.toLowerCase()).toMatch(/crisis|hotline|988|support/);
      expect(result.noExactMatch).toBe(true);
    });
    
    it('should handle emotional crisis queries with compassion', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ 
        safe: false, 
        reason: 'self_harm' 
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'I feel hopeless and want to give up',
      });
      
      expect(result.replyText).toContain('difficult time');
      expect(result.productCards).toEqual([]);
    });
  });
  
  describe('unrelated query handling', () => {
    it('should return witty redirect for unrelated queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'unrelated',
        constraints: {},
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'What is a red apple?',
      });
      
      expect(multiViewRetrieval).not.toHaveBeenCalled();
      expect(result.productCards).toEqual([]);
      expect(result.replyText.toLowerCase()).toMatch(/beauty|personal care|skincare/);
      expect(result.replyText.toLowerCase()).toMatch(/hand cream|shampoo|serum|product/);
      expect(result.noExactMatch).toBe(true);
    });
    
    it('should provide helpful guidance for non-shopping queries', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'unrelated',
        constraints: {},
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'Tell me a joke',
      });
      
      expect(result.replyText).toContain('beauty');
      expect(result.replyText.length).toBeGreaterThan(100); // Should be substantive
      expect(result.productCards).toEqual([]);
    });
  });
  
  describe('no products found', () => {
    it('should handle case when no products are found', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'direct_product_search',
        constraints: {},
      });
      
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: [],
        lexicalScores: new Map(),
        semanticScores: new Map(),
        conceptMatches: new Map(),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([]);
      
      // sortProductsByScore should return empty array when no products
      vi.mocked(sortProductsByScore).mockReturnValue([]);
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: "I couldn't find any products matching your request.",
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session',
        message: 'nonexistent product',
      });
      
      expect(result.productCards).toEqual([]);
      expect(result.noExactMatch).toBe(true);
      expect(result.replyText).toContain("couldn't find");
    });
  });
  
  describe('productType filtering for direct_product_search', () => {
    it('should filter to only hand cream products when user asks for hand cream', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'direct_product_search',
        constraints: {
          productTypes: ['hand_cream'],
        },
      } as QueryClassification);
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: ['hand_cream_1', 'liquid_soap_1'],
        lexicalScores: new Map([
          ['hand_cream_1', 0.9],
          ['liquid_soap_1', 0.8],
        ]),
        semanticScores: new Map(),
        conceptMatches: new Map(),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([
        {
          id: 'hand_cream_1',
          title: 'Rose Hand Cream',
          description: 'A hand cream',
          imageUrl: 'http://example.com/hand.jpg',
          productUrl: 'http://example.com/hand',
          priceCents: 1000,
          salePriceCents: null,
          currency: 'USD',
          category: 'Hand Care',
          subcategory: null,
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: {
              productType: 'Hand Care',
              concerns: [],
              skinTypes: [],
              hairTypes: [],
              applicationAreas: [],
              featuredIngredients: [],
              allIngredients: [],
              madeWithout: [],
              ageGroups: [],
              genders: [],
              canonicalConcerns: [],
              canonicalIngredients: [],
            },
          },
          shopifyBestseller: false,
          shopifySalesRank: null,
        },
        {
          id: 'liquid_soap_1',
          title: 'Lavender Liquid Soap',
          description: 'A liquid soap',
          imageUrl: 'http://example.com/soap.jpg',
          productUrl: 'http://example.com/soap',
          priceCents: 800,
          salePriceCents: null,
          currency: 'USD',
          category: 'Body Care',
          subcategory: null,
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: {
              productType: 'Body Care',
              concerns: [],
              skinTypes: [],
              hairTypes: [],
              applicationAreas: [],
              featuredIngredients: [],
              allIngredients: [],
              madeWithout: [],
              ageGroups: [],
              genders: [],
              canonicalConcerns: [],
              canonicalIngredients: [],
            },
          },
          shopifyBestseller: false,
          shopifySalesRank: null,
        },
      ] as any);
      
      vi.mocked(sortProductsByScore).mockImplementation((
        query: string,
        classification: QueryClassification,
        products: ProductWithLoccitaneAttributes[]
      ) => {
        return products;
      });
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: 'Here are some hand creams',
        followupText: undefined,
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test',
        message: 'Rose hand cream',
      });
      
      const rankerCall = vi.mocked(sortProductsByScore).mock.calls[0];
      const productsPassedToRanker = rankerCall[2];
      
      expect(productsPassedToRanker.length).toBe(1);
      expect(productsPassedToRanker[0].id).toBe('hand_cream_1');
      expect(productsPassedToRanker[0].attributes.loccitaneStructured.productType).toBe('Hand Care');
      expect(result.productCards.length).toBeGreaterThan(0);
      expect(result.productCards[0].id).toBe('hand_cream_1');
    });
  });
  
  describe('avoidIngredients filtering', () => {
    it('should exclude products containing avoided ingredients', async () => {
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'symptom_concern',
        constraints: {
          avoidIngredients: ['sulfate'],
        },
      } as QueryClassification);
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: ['prod_with_sulfate', 'prod_without_sulfate'],
        lexicalScores: new Map([
          ['prod_with_sulfate', 0.9],
          ['prod_without_sulfate', 0.8],
        ]),
        semanticScores: new Map(),
        conceptMatches: new Map(),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([
        {
          id: 'prod_with_sulfate',
          title: 'Product with Sulfate',
          description: 'Contains sodium lauryl sulfate',
          imageUrl: 'http://example.com/1.jpg',
          productUrl: 'http://example.com/1',
          priceCents: 1000,
          salePriceCents: null,
          currency: 'USD',
          category: 'Body Care',
          subcategory: null,
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: {
              productType: 'Body Care',
              concerns: [],
              skinTypes: [],
              hairTypes: [],
              applicationAreas: [],
              featuredIngredients: [],
              allIngredients: ['Sodium Laureth Sulfate', 'Water'],
              madeWithout: [],
              ageGroups: [],
              genders: [],
              canonicalConcerns: [],
              canonicalIngredients: [],
            },
          },
          shopifyBestseller: false,
          shopifySalesRank: null,
        },
        {
          id: 'prod_without_sulfate',
          title: 'Product without Sulfate',
          description: 'Contains shea butter',
          imageUrl: 'http://example.com/2.jpg',
          productUrl: 'http://example.com/2',
          priceCents: 1000,
          salePriceCents: null,
          currency: 'USD',
          category: 'Body Care',
          subcategory: null,
          stockStatus: 'in_stock',
          attributes: {
            loccitaneStructured: {
              productType: 'Body Care',
              concerns: [],
              skinTypes: [],
              hairTypes: [],
              applicationAreas: [],
              featuredIngredients: [],
              allIngredients: ['Shea Butter', 'Glycerin'],
              madeWithout: [],
              ageGroups: [],
              genders: [],
              canonicalConcerns: [],
              canonicalIngredients: [],
            },
          },
          shopifyBestseller: false,
          shopifySalesRank: null,
        },
      ] as any);
      
      vi.mocked(sortProductsByScore).mockImplementation((q, c, p) => p);
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: 'Here are products',
      });
      
      const result = await handleLoccitaneQuery({
        sessionId: 'test',
        message: 'vegan products without sulfates',
      });
      
      const rankerCall = vi.mocked(sortProductsByScore).mock.calls[0];
      const productsPassedToRanker = rankerCall[2];
      
      expect(productsPassedToRanker.length).toBe(1);
      expect(productsPassedToRanker[0].id).toBe('prod_without_sulfate');
      expect(result.productCards.length).toBeGreaterThan(0);
      expect(result.productCards[0].id).toBe('prod_without_sulfate');
    });
  });
});

