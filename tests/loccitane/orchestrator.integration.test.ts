/**
 * Integration Tests for L'Occitane Orchestrator
 * 
 * Tests the full pipeline with realistic queries and assertions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLoccitaneQuery } from '../../src/lib/loccitane/orchestrator';
import type { ProductCard } from '../../src/lib/llm/orchestrator/cards';

// Mock all dependencies
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

describe('handleLoccitaneQuery - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  const mockProductWithStructured = {
    id: 'prod1',
    title: 'Immortelle Reset Serum',
    description: 'Anti-aging serum with immortelle extract',
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
        concerns: ['Aging', 'Fine Lines'],
        skinTypes: ['Dry', 'Normal'],
        hairTypes: [],
        applicationAreas: ['Face'],
        productType: 'Serum',
        formula: null,
        featuredIngredients: ['Immortelle'],
        allIngredients: ['Immortelle', 'Hyaluronic Acid'],
        madeWithout: ['Paraben Free'],
        ageGroups: ['Adult'],
        genders: ['Unisex'],
        canonicalConcerns: ['aging'],
        canonicalIngredients: ['immortelle', 'hyaluronic_acid'],
      },
    },
    shopifyBestseller: true,
    shopifySalesRank: 5,
  };
  
  describe('realistic queries', () => {
    it('should handle a realistic product search query end-to-end', async () => {
      // Setup: Realistic query flow
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
        semanticScores: new Map([['prod1', 0.85]]),
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
        replyText: 'Here is the Immortelle Reset Serum you requested. It is designed to address fine lines and aging concerns.',
        followupText: 'Would you like to see other serums from the Immortelle collection?',
      });
      
      // Execute
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session-123',
        message: 'Immortelle Reset serum',
      });
      
      // Assert: replyText is non-empty
      expect(result.replyText).toBeTruthy();
      expect(result.replyText.length).toBeGreaterThan(0);
      
      // Assert: productCards is an array of valid ProductCards
      expect(result.productCards).toBeInstanceOf(Array);
      expect(result.productCards.length).toBeGreaterThan(0);
      
      // Validate ProductCard structure
      for (const card of result.productCards) {
        expect(card).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          imageUrl: expect.any(String),
          productUrl: expect.any(String),
          priceCents: expect.any(Number),
          currency: expect.any(String),
          reason: expect.any(String),
          keyAttributes: expect.any(Array),
          queryChips: expect.any(Array),
        });
        
        // Required fields must be present
        expect(card.id).toBeTruthy();
        expect(card.title).toBeTruthy();
        expect(card.imageUrl).toBeTruthy();
        expect(card.productUrl).toBeTruthy();
        expect(card.priceCents).toBeGreaterThan(0);
        expect(card.reason).toBeTruthy();
      }
      
      // Assert: noExactMatch is false when products found
      expect(result.noExactMatch).toBe(false);
      
      // Assert: followupText is optional but present in this case
      expect(result.followupText).toBeDefined();
    });
    
    it('should handle obviously-unmatchable query and set noExactMatch correctly', async () => {
      // Setup: Unmatchable query
      vi.mocked(checkQuerySafety).mockReturnValue({ safe: true });
      
      vi.mocked(classifyQuery).mockResolvedValue({
        type: 'direct_product_search',
        constraints: {
          productTypes: ['NonexistentProductType12345'],
        },
      });
      
      vi.mocked(multiViewRetrieval).mockResolvedValue({
        candidateIds: [],
        lexicalScores: new Map(),
        semanticScores: new Map(),
        conceptMatches: new Map(),
      });
      
      vi.mocked(prisma.product.findMany).mockResolvedValue([]);
      vi.mocked(sortProductsByScore).mockReturnValue([]);
      
      vi.mocked(generateReplyWithRag).mockResolvedValue({
        replyText: "I couldn't find any products matching your request. Could you try rephrasing your search?",
      });
      
      // Execute
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session-456',
        message: 'xyzqwerty12345 product that definitely does not exist',
      });
      
      // Assert: replyText is non-empty (should have fallback message)
      expect(result.replyText).toBeTruthy();
      expect(result.replyText.length).toBeGreaterThan(0);
      
      // Assert: productCards is empty array
      expect(result.productCards).toBeInstanceOf(Array);
      expect(result.productCards.length).toBe(0);
      
      // Assert: noExactMatch is true when no products found
      expect(result.noExactMatch).toBe(true);
    });
    
    it('should handle concern-based query end-to-end', async () => {
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
        replyText: 'I found products that address your aging and dryness concerns. The Immortelle Reset Serum is designed for dry skin.',
      });
      
      // Execute
      const result = await handleLoccitaneQuery({
        sessionId: 'test-session-789',
        message: 'I have fine lines and very dry skin',
      });
      
      // Assert: Valid response structure
      expect(result.replyText).toBeTruthy();
      expect(result.productCards).toBeInstanceOf(Array);
      expect(result.productCards.length).toBeGreaterThan(0);
      expect(result.noExactMatch).toBe(false);
      
      // Assert: Product cards have valid structure
      result.productCards.forEach(card => {
        expect(card.id).toBeTruthy();
        expect(card.title).toBeTruthy();
        expect(card.reason).toBeTruthy();
      });
    });
  });
});



