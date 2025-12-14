/**
 * Tests for RAG Reply Generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReplyWithRag } from '../../src/lib/loccitane/reply';
import type { QueryClassification } from '../../src/lib/loccitane/classifier';
import type { ProductWithLoccitaneAttributes } from '../../src/lib/loccitane/ranking/features';

// Mock LLM provider
vi.mock('../../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '../../src/lib/llm/provider';

describe('generateReplyWithRag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  const baseProduct: ProductWithLoccitaneAttributes = {
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
  };
  
  describe('successful reply generation', () => {
    it('should generate reply from LLM response', async () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          concerns: ['aging'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify({
          replyText: 'I found products that address your aging concerns. The Immortelle Reset Serum is designed to reduce fine lines.',
          followupText: 'Would you like options under $30?',
        }),
      });
      
      const result = await generateReplyWithRag(
        'I have fine lines',
        classification,
        [baseProduct]
      );
      
      expect(result.replyText).toContain('aging');
      expect(result.followupText).toBeDefined();
      expect(callLLM).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'final_reply',
          expectJson: true,
        })
      );
    });
    
    it('should handle reply without followup', async () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {
          productTypes: ['Serum'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify({
          replyText: 'Here is the Immortelle Reset Serum you requested.',
        }),
      });
      
      const result = await generateReplyWithRag(
        'Immortelle Reset serum',
        classification,
        [baseProduct]
      );
      
      expect(result.replyText).toBeDefined();
      expect(result.followupText).toBeUndefined();
    });
    
    it('should serialize products correctly in prompt', async () => {
      const classification: QueryClassification = {
        type: 'ingredient_exploration',
        constraints: {
          mustHaveIngredients: ['immortelle'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify({
          replyText: 'Found products with immortelle.',
        }),
      });
      
      await generateReplyWithRag(
        'products with immortelle',
        classification,
        [baseProduct]
      );
      
      // Verify callLLM was called with proper structure
      const callArgs = vi.mocked(callLLM).mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('Immortelle Reset Serum');
      expect(callArgs.messages[1].content).toContain('immortelle');
      expect(callArgs.messages[1].content).toContain('aging');
    });
  });
  
  describe('JSON parsing fallback', () => {
    it('should fallback when JSON parsing fails', async () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      // LLM returns invalid JSON
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: 'This is not valid JSON { replyText: "missing quotes" }',
      });
      
      const result = await generateReplyWithRag(
        'test query',
        classification,
        [baseProduct]
      );
      
      // Should use fallback template
      expect(result.replyText).toContain('Immortelle Reset Serum');
      expect(result.followupText).toBeDefined();
    });
    
    it('should fallback when JSON is missing replyText', async () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {},
      };
      
      // LLM returns JSON without replyText
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify({
          message: 'This is not the right field',
        }),
      });
      
      const result = await generateReplyWithRag(
        'test query',
        classification,
        [baseProduct]
      );
      
      // Should use fallback template
      expect(result.replyText).toContain('product');
    });
    
    it('should handle JSON with code fences', async () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      // LLM returns JSON with code fences
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: '```json\n' + JSON.stringify({
          replyText: 'Here is the product.',
        }) + '\n```',
      });
      
      const result = await generateReplyWithRag(
        'test query',
        classification,
        [baseProduct]
      );
      
      // Should parse successfully (stripJsonFences handles this)
      expect(result.replyText).toBe('Here is the product.');
    });
  });
  
  describe('LLM error fallback', () => {
    it('should fallback when LLM call fails', async () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          concerns: ['dryness'],
        },
      };
      
      // LLM throws error
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('API error'));
      
      const result = await generateReplyWithRag(
        'I have dry skin',
        classification,
        [baseProduct]
      );
      
      // Should use fallback template
      expect(result.replyText).toContain('dryness');
      expect(result.replyText).toContain('Immortelle Reset Serum');
    });
  });
  
  describe('fallback reply templates', () => {
    it('should generate appropriate template for direct_product_search', async () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('Error'));
      
      const result = await generateReplyWithRag(
        'serum',
        classification,
        [baseProduct]
      );
      
      expect(result.replyText).toContain('matching your search');
      expect(result.replyText).toContain('Immortelle Reset Serum');
    });
    
    it('should generate appropriate template for symptom_concern', async () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          concerns: ['aging'],
        },
      };
      
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('Error'));
      
      const result = await generateReplyWithRag(
        'I have fine lines',
        classification,
        [baseProduct]
      );
      
      expect(result.replyText).toContain('address');
      expect(result.replyText).toContain('aging');
    });
    
    it('should generate appropriate template for ingredient_exploration', async () => {
      const classification: QueryClassification = {
        type: 'ingredient_exploration',
        constraints: {
          mustHaveIngredients: ['immortelle'],
        },
      };
      
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('Error'));
      
      const result = await generateReplyWithRag(
        'immortelle products',
        classification,
        [baseProduct]
      );
      
      expect(result.replyText).toContain('immortelle');
      expect(result.replyText).toContain('product');
    });
    
    it('should generate appropriate template for gift_or_vague', async () => {
      const classification: QueryClassification = {
        type: 'gift_or_vague',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('Error'));
      
      const result = await generateReplyWithRag(
        'gifts for mom',
        classification,
        [baseProduct]
      );
      
      expect(result.replyText).toContain('great option');
    });
    
    it('should handle empty products list', async () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('Error'));
      
      const result = await generateReplyWithRag(
        'nonexistent product',
        classification,
        []
      );
      
      expect(result.replyText).toContain("couldn't find");
      expect(result.followupText).toBeDefined();
    });
    
    it('should handle multiple products in fallback', async () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const products = [
        baseProduct,
        { ...baseProduct, id: 'prod2', title: 'Almond Shower Oil' },
        { ...baseProduct, id: 'prod3', title: 'Shea Hand Cream' },
        { ...baseProduct, id: 'prod4', title: 'Verbena Body Lotion' },
      ];
      
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('Error'));
      
      const result = await generateReplyWithRag(
        'products',
        classification,
        products
      );
      
      // Should mention first 3 and "1 more"
      expect(result.replyText).toContain('Immortelle Reset Serum');
      expect(result.replyText).toContain('Almond Shower Oil');
      expect(result.replyText).toContain('Shea Hand Cream');
      expect(result.replyText).toContain('1 more');
    });
  });
});





