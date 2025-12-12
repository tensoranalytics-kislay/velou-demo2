/**
 * Tests for L'Occitane Multi-View Retrieval
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { multiViewRetrieval } from '../../src/lib/loccitane/retrieval';
import type { QueryClassification } from '../../src/lib/loccitane/classifier';

// Mock dependencies
vi.mock('../../src/lib/search', () => ({
  searchProducts: vi.fn(),
}));

vi.mock('../../src/lib/search/vector/index', () => ({
  embedText: vi.fn(),
  searchVectorIndex: vi.fn(),
}));

vi.mock('../../src/lib/search/concept/cache', () => ({
  getConceptIndex: vi.fn(),
}));

vi.mock('../../src/lib/search/concept/index', () => ({
  searchConceptIndex: vi.fn(),
}));

import { searchProducts } from '../../src/lib/search';
import { embedText, searchVectorIndex } from '../../src/lib/search/vector/index';
import { getConceptIndex } from '../../src/lib/search/concept/cache';
import { searchConceptIndex } from '../../src/lib/search/concept/index';

describe('multiViewRetrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  const mockClassification: QueryClassification = {
    type: 'direct_product_search',
    constraints: {
      collections: ['Immortelle'],
      productTypes: ['serum'],
      priceMaxCents: 5000,
    },
  };
  
  describe('successful retrieval', () => {
    it('should merge results from all three views', async () => {
      // Mock lexical search
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: [
          { id: 'prod1', title: 'Product 1', description: '', imageUrl: '', productUrl: '', priceCents: 1000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
          { id: 'prod2', title: 'Product 2', description: '', imageUrl: '', productUrl: '', priceCents: 2000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
        ],
        wasRelaxed: false,
      });
      
      // Mock semantic search
      vi.mocked(embedText).mockResolvedValueOnce([0.1, 0.2, 0.3]); // Mock embedding
      vi.mocked(searchVectorIndex).mockResolvedValueOnce([
        { productId: 'prod2', similarity: 0.95 },
        { productId: 'prod3', similarity: 0.90 },
      ]);
      
      // Mock concept search
      const mockConceptIndex = {
        concerns: new Map(),
        skinTypes: new Map(),
        applicationAreas: new Map(),
        ingredients: new Map(),
        madeWithout: new Map(),
        productTypes: new Map(),
      };
      vi.mocked(getConceptIndex).mockResolvedValueOnce(mockConceptIndex);
      vi.mocked(searchConceptIndex).mockReturnValueOnce(['prod3', 'prod4']);
      
      const result = await multiViewRetrieval(
        'Immortelle Reset serum',
        mockClassification
      );
      
      // Should merge all product IDs
      expect(result.candidateIds).toContain('prod1');
      expect(result.candidateIds).toContain('prod2');
      expect(result.candidateIds).toContain('prod3');
      expect(result.candidateIds).toContain('prod4');
      
      // Should have no duplicates
      expect(result.candidateIds.length).toBe(4);
      expect(new Set(result.candidateIds).size).toBe(4);
      
      // Should have lexical scores
      expect(result.lexicalScores.has('prod1')).toBe(true);
      expect(result.lexicalScores.has('prod2')).toBe(true);
      
      // Should have semantic scores
      expect(result.semanticScores.get('prod2')).toBe(0.95);
      expect(result.semanticScores.get('prod3')).toBe(0.90);
      
      // Should have concept matches (format: concept → Set<productId>)
      // Since we're using empty concept index in mock, conceptMatches may be empty
      // In real usage, conceptMatches tracks which concepts matched which products
      // For this test, we just verify the structure exists
      expect(result.conceptMatches).toBeInstanceOf(Map);
    });
    
    it('should handle duplicate product IDs across views', async () => {
      // Mock all three views returning same product
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: [
          { id: 'prod1', title: 'Product 1', description: '', imageUrl: '', productUrl: '', priceCents: 1000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
        ],
        wasRelaxed: false,
      });
      
      vi.mocked(embedText).mockResolvedValueOnce([0.1, 0.2, 0.3]);
      vi.mocked(searchVectorIndex).mockResolvedValueOnce([
        { productId: 'prod1', similarity: 0.95 },
      ]);
      
      const mockConceptIndex = {
        concerns: new Map(),
        skinTypes: new Map(),
        applicationAreas: new Map(),
        ingredients: new Map(),
        madeWithout: new Map(),
        productTypes: new Map(),
      };
      vi.mocked(getConceptIndex).mockResolvedValueOnce(mockConceptIndex);
      vi.mocked(searchConceptIndex).mockReturnValueOnce(['prod1']);
      
      const result = await multiViewRetrieval(
        'test query',
        mockClassification
      );
      
      // Should only have one product (deduplicated)
      expect(result.candidateIds).toEqual(['prod1']);
      expect(result.candidateIds.length).toBe(1);
    });
    
    it('should limit candidates to MAX_CANDIDATES (400)', async () => {
      // Mock lexical search returning many products
      const manyProducts = Array.from({ length: 300 }, (_, i) => ({
        id: `prod-lex-${i}`,
        title: `Product ${i}`,
        description: '',
        imageUrl: '',
        productUrl: '',
        priceCents: 1000,
        currency: 'USD',
        category: 'Face Care',
        stockStatus: 'in_stock' as const,
        attributes: {},
      }));
      
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: manyProducts,
        wasRelaxed: false,
      });
      
      // Mock semantic search returning many products
      const manySemantic = Array.from({ length: 200 }, (_, i) => ({
        productId: `prod-sem-${i}`,
        similarity: 0.9 - i * 0.001,
      }));
      
      vi.mocked(embedText).mockResolvedValueOnce([0.1, 0.2, 0.3]);
      vi.mocked(searchVectorIndex).mockResolvedValueOnce(manySemantic);
      
      // Mock concept search returning many products
      const manyConcept = Array.from({ length: 200 }, (_, i) => `prod-conc-${i}`);
      
      const mockConceptIndex = {
        concerns: new Map(),
        skinTypes: new Map(),
        applicationAreas: new Map(),
        ingredients: new Map(),
        madeWithout: new Map(),
        productTypes: new Map(),
      };
      vi.mocked(getConceptIndex).mockResolvedValueOnce(mockConceptIndex);
      vi.mocked(searchConceptIndex).mockReturnValueOnce(manyConcept);
      
      const result = await multiViewRetrieval(
        'test query',
        mockClassification
      );
      
      // Should be capped at 400
      expect(result.candidateIds.length).toBeLessThanOrEqual(400);
    });
    
    it('should return sorted candidate IDs for deterministic ordering', async () => {
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: [
          { id: 'prod-z', title: 'Product Z', description: '', imageUrl: '', productUrl: '', priceCents: 1000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
          { id: 'prod-a', title: 'Product A', description: '', imageUrl: '', productUrl: '', priceCents: 2000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
        ],
        wasRelaxed: false,
      });
      
      vi.mocked(embedText).mockResolvedValueOnce([0.1, 0.2, 0.3]);
      vi.mocked(searchVectorIndex).mockResolvedValueOnce([
        { productId: 'prod-m', similarity: 0.95 },
      ]);
      
      const mockConceptIndex = {
        concerns: new Map(),
        skinTypes: new Map(),
        applicationAreas: new Map(),
        ingredients: new Map(),
        madeWithout: new Map(),
        productTypes: new Map(),
      };
      vi.mocked(getConceptIndex).mockResolvedValueOnce(mockConceptIndex);
      vi.mocked(searchConceptIndex).mockReturnValueOnce(['prod-b']);
      
      const result = await multiViewRetrieval(
        'test query',
        mockClassification
      );
      
      // Should be sorted
      expect(result.candidateIds).toEqual(['prod-a', 'prod-b', 'prod-m', 'prod-z']);
    });
  });
  
  describe('graceful fallback', () => {
    it('should handle semantic search failure gracefully', async () => {
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: [
          { id: 'prod1', title: 'Product 1', description: '', imageUrl: '', productUrl: '', priceCents: 1000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
        ],
        wasRelaxed: false,
      });
      
      // Semantic search fails
      vi.mocked(embedText).mockRejectedValueOnce(new Error('Embedding API error'));
      
      // Concept search works
      const mockConceptIndex = {
        concerns: new Map(),
        skinTypes: new Map(),
        applicationAreas: new Map(),
        ingredients: new Map(),
        madeWithout: new Map(),
        productTypes: new Map(),
      };
      vi.mocked(getConceptIndex).mockResolvedValueOnce(mockConceptIndex);
      vi.mocked(searchConceptIndex).mockReturnValueOnce(['prod2']);
      
      const result = await multiViewRetrieval(
        'test query',
        mockClassification
      );
      
      // Should still return lexical and concept results
      expect(result.candidateIds).toContain('prod1');
      expect(result.candidateIds).toContain('prod2');
      // Semantic scores should be empty
      expect(result.semanticScores.size).toBe(0);
    });
    
    it('should handle concept search failure gracefully', async () => {
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: [
          { id: 'prod1', title: 'Product 1', description: '', imageUrl: '', productUrl: '', priceCents: 1000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
        ],
        wasRelaxed: false,
      });
      
      vi.mocked(embedText).mockResolvedValueOnce([0.1, 0.2, 0.3]);
      vi.mocked(searchVectorIndex).mockResolvedValueOnce([
        { productId: 'prod2', similarity: 0.95 },
      ]);
      
      // Concept search fails
      vi.mocked(getConceptIndex).mockRejectedValueOnce(new Error('Concept index error'));
      
      const result = await multiViewRetrieval(
        'test query',
        mockClassification
      );
      
      // Should still return lexical and semantic results
      expect(result.candidateIds).toContain('prod1');
      expect(result.candidateIds).toContain('prod2');
      // Concept matches should be empty
      expect(result.conceptMatches.size).toBe(0);
    });
    
    it('should handle lexical search failure gracefully', async () => {
      // Lexical search fails
      vi.mocked(searchProducts).mockRejectedValueOnce(new Error('Search error'));
      
      vi.mocked(embedText).mockResolvedValueOnce([0.1, 0.2, 0.3]);
      vi.mocked(searchVectorIndex).mockResolvedValueOnce([
        { productId: 'prod1', similarity: 0.95 },
      ]);
      
      const mockConceptIndex = {
        concerns: new Map(),
        skinTypes: new Map(),
        applicationAreas: new Map(),
        ingredients: new Map(),
        madeWithout: new Map(),
        productTypes: new Map(),
      };
      vi.mocked(getConceptIndex).mockResolvedValueOnce(mockConceptIndex);
      vi.mocked(searchConceptIndex).mockReturnValueOnce(['prod2']);
      
      const result = await multiViewRetrieval(
        'test query',
        mockClassification
      );
      
      // Should still return semantic and concept results
      expect(result.candidateIds).toContain('prod1');
      expect(result.candidateIds).toContain('prod2');
      // Lexical scores should be empty
      expect(result.lexicalScores.size).toBe(0);
    });
    
    it('should work with only lexical search if other views fail', async () => {
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: [
          { id: 'prod1', title: 'Product 1', description: '', imageUrl: '', productUrl: '', priceCents: 1000, currency: 'USD', category: 'Face Care', stockStatus: 'in_stock', attributes: {} },
        ],
        wasRelaxed: false,
      });
      
      // Both semantic and concept fail
      vi.mocked(embedText).mockRejectedValueOnce(new Error('Embedding error'));
      vi.mocked(getConceptIndex).mockRejectedValueOnce(new Error('Concept index error'));
      
      const result = await multiViewRetrieval(
        'test query',
        mockClassification
      );
      
      // Should still return lexical results
      expect(result.candidateIds).toEqual(['prod1']);
      expect(result.lexicalScores.has('prod1')).toBe(true);
    });
  });
  
  describe('constraint mapping', () => {
    it('should convert classification constraints to search constraints', async () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          concerns: ['dry_scalp'],
          skinTypes: ['Sensitive'],
          priceMaxCents: 5000,
          productTypes: ['Shampoo'],
        },
      };
      
      vi.mocked(searchProducts).mockResolvedValueOnce({
        products: [],
        wasRelaxed: false,
      });
      
      vi.mocked(embedText).mockResolvedValueOnce([0.1, 0.2, 0.3]);
      vi.mocked(searchVectorIndex).mockResolvedValueOnce([]);
      
      const mockConceptIndex = {
        concerns: new Map(),
        skinTypes: new Map(),
        applicationAreas: new Map(),
        ingredients: new Map(),
        madeWithout: new Map(),
        productTypes: new Map(),
      };
      vi.mocked(getConceptIndex).mockResolvedValueOnce(mockConceptIndex);
      vi.mocked(searchConceptIndex).mockReturnValueOnce([]);
      
      await multiViewRetrieval('I have dandruff', classification);
      
      // Verify searchProducts was called with correct constraints
      expect(searchProducts).toHaveBeenCalledWith(
        expect.objectContaining({
          priceMaxCents: 5000,
          productTypes: ['Shampoo'],
          inStockOnly: true,
          limit: 150,
        }),
        'I have dandruff',
        undefined
      );
    });
  });
});

