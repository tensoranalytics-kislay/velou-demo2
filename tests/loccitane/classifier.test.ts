/**
 * Tests for L'Occitane Query Classifier
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyQuery, type QueryClassification } from '../../src/lib/loccitane/classifier';
import { callLLM } from '../../src/lib/llm/provider';

// Mock the LLM provider
vi.mock('../../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
}));

describe('classifyQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  describe('direct_product_search', () => {
    it('should classify "Immortelle Reset serum under 50$" correctly', async () => {
      const mockResponse = {
        type: 'direct_product_search',
        constraints: {
          collections: ['Immortelle'],
          productTypes: ['serum'],
          priceMaxCents: 5000,
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('Immortelle Reset serum under 50$');
      
      expect(result.type).toBe('direct_product_search');
      expect(result.constraints.collections).toContain('Immortelle');
      expect(result.constraints.productTypes).toContain('serum');
      expect(result.constraints.priceMaxCents).toBe(5000);
    });
    
    it('should classify "Almond shower oil" correctly', async () => {
      const mockResponse = {
        type: 'direct_product_search',
        constraints: {
          collections: ['Almond'],
          productTypes: ['Shower Oil'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('Almond shower oil');
      
      expect(result.type).toBe('direct_product_search');
      expect(result.constraints.collections).toContain('Almond');
      expect(result.constraints.productTypes).toContain('Shower Oil');
    });
  });
  
  describe('symptom_concern', () => {
    it('should classify "I have dandruff and sensitive scalp" correctly', async () => {
      const mockResponse = {
        type: 'symptom_concern',
        constraints: {
          concerns: ['dandruff', 'Scalp Discomfort'],
          skinTypes: ['Sensitive'],
          applicationAreas: ['Scalp'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('I have dandruff and sensitive scalp');
      
      expect(result.type).toBe('symptom_concern');
      expect(result.constraints.concerns).toBeDefined();
      expect(result.constraints.concerns?.length).toBeGreaterThan(0);
      // Should normalize "dandruff" to "dry_scalp"
      expect(result.constraints.concerns).toContain('dry_scalp');
      expect(result.constraints.skinTypes).toContain('Sensitive');
      expect(result.constraints.applicationAreas).toContain('Scalp');
    });
    
    it('should normalize concerns correctly', async () => {
      const mockResponse = {
        type: 'symptom_concern',
        constraints: {
          concerns: ['Dryness', 'Fine Lines', 'Wrinkles'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('my skin is dry and has wrinkles');
      
      expect(result.type).toBe('symptom_concern');
      // Should normalize to canonical forms
      expect(result.constraints.concerns).toContain('dryness');
      expect(result.constraints.concerns).toContain('aging'); // Fine lines and wrinkles both map to aging
    });
  });
  
  describe('ingredient_exploration', () => {
    it('should classify "shea butter" correctly', async () => {
      const mockResponse = {
        type: 'ingredient_exploration',
        constraints: {
          mustHaveIngredients: ['shea butter'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('shea butter');
      
      expect(result.type).toBe('ingredient_exploration');
      expect(result.constraints.mustHaveIngredients).toBeDefined();
      // Should normalize "shea butter" to "shea_butter"
      expect(result.constraints.mustHaveIngredients).toContain('shea_butter');
    });
    
    it('should normalize ingredients correctly', async () => {
      const mockResponse = {
        type: 'ingredient_exploration',
        constraints: {
          mustHaveIngredients: ['Vitamin B3', 'Niacinamide', 'Sweet Almond Oil'],
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('products with niacinamide and almond oil');
      
      expect(result.type).toBe('ingredient_exploration');
      // Should normalize to canonical forms
      expect(result.constraints.mustHaveIngredients).toContain('niacinamide');
      expect(result.constraints.mustHaveIngredients).toContain('almond_oil');
    });
  });
  
  describe('unrelated queries', () => {
    it('should classify "write me a poem" as unrelated', async () => {
      const mockResponse = {
        type: 'unrelated',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('write me a poem');
      
      expect(result.type).toBe('unrelated');
      expect(Object.keys(result.constraints)).toHaveLength(0);
    });
    
    it('should fallback to unrelated on LLM error', async () => {
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('LLM error'));
      
      const result = await classifyQuery('some query');
      
      expect(result.type).toBe('unrelated');
      expect(Object.keys(result.constraints)).toHaveLength(0);
    });
    
    it('should fallback to unrelated on invalid type from LLM', async () => {
      const mockResponse = {
        type: 'invalid_type',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('some query');
      
      expect(result.type).toBe('unrelated');
    });
  });
  
  describe('price extraction', () => {
    it('should extract price from "under $50"', async () => {
      const mockResponse = {
        type: 'direct_product_search',
        constraints: {
          priceMaxCents: 5000,
        },
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('hand cream under $50');
      
      expect(result.constraints.priceMaxCents).toBe(5000);
    });
    
    it('should extract price from "below ₹1500"', async () => {
      const mockResponse = {
        type: 'gift_or_vague',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('gifts below ₹1500');
      
      // Should extract price from message if LLM didn't
      expect(result.constraints.priceMaxCents).toBeDefined();
    });
  });
  
  describe('gift_or_vague', () => {
    it('should classify "gifts for mom" correctly', async () => {
      const mockResponse = {
        type: 'gift_or_vague',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('gifts for mom');
      
      expect(result.type).toBe('gift_or_vague');
    });
    
    it('should classify "something relaxing" correctly', async () => {
      const mockResponse = {
        type: 'gift_or_vague',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockResponse),
      });
      
      const result = await classifyQuery('something relaxing');
      
      expect(result.type).toBe('gift_or_vague');
    });
  });
  
  describe('JSON parsing', () => {
    it('should handle JSON with code fences', async () => {
      const mockResponse = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: '```json\n' + JSON.stringify(mockResponse) + '\n```',
      });
      
      const result = await classifyQuery('hand cream');
      
      expect(result.type).toBe('direct_product_search');
    });
  });
});



