/**
 * Tests for Dialogue Router
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeTurn, type RouterResult } from '../../src/lib/loccitane/router';
import { callLLM } from '../../src/lib/llm/provider';

// Mock the LLM provider
vi.mock('../../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
}));

describe('routeTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('heuristic routing - AFFIRMATION', () => {
    it('should route "yes" to AFFIRMATION', async () => {
      const result = await routeTurn({ message: 'yes' });
      
      expect(result.route).toBe('AFFIRMATION');
      expect(result.confidence).toBe('high');
      expect(result.userTone).toBe('positive');
    });

    it('should route "ok" to AFFIRMATION', async () => {
      const result = await routeTurn({ message: 'ok' });
      
      expect(result.route).toBe('AFFIRMATION');
      expect(result.confidence).toBe('high');
    });

    it('should route "sounds good" to AFFIRMATION', async () => {
      const result = await routeTurn({ message: 'sounds good' });
      
      expect(result.route).toBe('AFFIRMATION');
      expect(result.confidence).toBe('high');
    });

    it('should route "looks great" to AFFIRMATION', async () => {
      const result = await routeTurn({ message: 'looks great' });
      
      expect(result.route).toBe('AFFIRMATION');
      expect(result.confidence).toBe('high');
    });
  });

  describe('heuristic routing - NEGATION', () => {
    it('should route "no" to NEGATION', async () => {
      const result = await routeTurn({ message: 'no' });
      
      expect(result.route).toBe('NEGATION');
      expect(result.confidence).toBe('high');
      expect(result.userTone).toBe('negative');
    });

    it('should route "nah" to NEGATION', async () => {
      const result = await routeTurn({ message: 'nah' });
      
      expect(result.route).toBe('NEGATION');
      expect(result.confidence).toBe('high');
    });

    it('should route "don\'t" to NEGATION', async () => {
      const result = await routeTurn({ message: "don't" });
      
      expect(result.route).toBe('NEGATION');
      expect(result.confidence).toBe('high');
    });

    it('should route "not interested" to NEGATION', async () => {
      const result = await routeTurn({ message: 'not interested' });
      
      expect(result.route).toBe('NEGATION');
      expect(result.confidence).toBe('high');
    });
  });

  describe('heuristic routing - ACTION_REQUEST', () => {
    it('should route "show more" to ACTION_REQUEST with show_more', async () => {
      const result = await routeTurn({ message: 'show more' });
      
      expect(result.route).toBe('ACTION_REQUEST');
      expect(result.actionType).toBe('show_more');
      expect(result.confidence).toBe('high');
    });

    it('should route "more options" to ACTION_REQUEST with show_more', async () => {
      const result = await routeTurn({ message: 'more options' });
      
      expect(result.route).toBe('ACTION_REQUEST');
      expect(result.actionType).toBe('show_more');
    });

    it('should route "compare" to ACTION_REQUEST with compare', async () => {
      const result = await routeTurn({ message: 'compare' });
      
      expect(result.route).toBe('ACTION_REQUEST');
      expect(result.actionType).toBe('compare');
      expect(result.confidence).toBe('high');
    });

    it('should route "swap" to ACTION_REQUEST with swap', async () => {
      const result = await routeTurn({ message: 'swap' });
      
      expect(result.route).toBe('ACTION_REQUEST');
      expect(result.actionType).toBe('swap');
      expect(result.confidence).toBe('high');
    });

    it('should route "similar to #2" to ACTION_REQUEST with similar and referencedProductIndex', async () => {
      const result = await routeTurn({ message: 'similar to #2' });
      
      expect(result.route).toBe('ACTION_REQUEST');
      expect(result.actionType).toBe('similar');
      expect(result.referencedProductIndex).toBe(1); // 0-indexed
      expect(result.confidence).toBe('high');
    });

    it('should route "similar to number 3" to ACTION_REQUEST with referencedProductIndex', async () => {
      const result = await routeTurn({ message: 'similar to number 3' });
      
      expect(result.route).toBe('ACTION_REQUEST');
      expect(result.referencedProductIndex).toBe(2); // 0-indexed
    });
  });

  describe('heuristic routing - FOLLOWUP_REFINE', () => {
    it('should route "cheaper" to FOLLOWUP_REFINE', async () => {
      const result = await routeTurn({ message: 'cheaper' });
      
      expect(result.route).toBe('FOLLOWUP_REFINE');
      expect(result.confidence).toBe('high');
      expect(result.extractedSignals).toContain('cheaper_request');
    });

    it('should route "cheaper options under $50" to FOLLOWUP_REFINE with refinePatch', async () => {
      const result = await routeTurn({ message: 'cheaper options under $50' });
      
      expect(result.route).toBe('FOLLOWUP_REFINE');
      expect(result.refinePatch).toBeDefined();
      expect(result.refinePatch?.priceMaxCents).toBe(5000); // $50 * 100
    });

    it('should route "less expensive below $30" to FOLLOWUP_REFINE with refinePatch', async () => {
      const result = await routeTurn({ message: 'less expensive below $30' });
      
      expect(result.route).toBe('FOLLOWUP_REFINE');
      expect(result.refinePatch?.priceMaxCents).toBe(3000);
    });
  });

  describe('heuristic routing - BRAND_OR_PRODUCT_INFO', () => {
    it('should route "tell me about your company" to BRAND_OR_PRODUCT_INFO', async () => {
      const result = await routeTurn({ message: 'tell me about your company' });
      
      expect(result.route).toBe('BRAND_OR_PRODUCT_INFO');
      expect(result.confidence).toBe('high');
    });

    it('should route "what is your return policy" to BRAND_OR_PRODUCT_INFO', async () => {
      const result = await routeTurn({ message: 'what is your return policy' });
      
      expect(result.route).toBe('BRAND_OR_PRODUCT_INFO');
      expect(result.confidence).toBe('high');
    });

    it('should route "where can I buy this" to BRAND_OR_PRODUCT_INFO', async () => {
      const result = await routeTurn({ message: 'where can I buy this' });
      
      expect(result.route).toBe('BRAND_OR_PRODUCT_INFO');
      expect(result.confidence).toBe('high');
    });
  });

  describe('heuristic routing - DISCOVERY', () => {
    it('should route product search indicators to DISCOVERY when no previous constraints', async () => {
      const mockRouterResult: RouterResult = {
        route: 'DISCOVERY',
        confidence: 'medium',
        extractedSignals: ['product_search_indicator'],
        userTone: 'neutral',
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockRouterResult),
      });
      
      const result = await routeTurn({
        message: 'hand cream for dry hands',
        conversationState: {},
      });
      
      expect(result.route).toBe('DISCOVERY');
      expect(result.confidence).toBe('medium');
    });

    it('should route product search indicators to FOLLOWUP_REFINE when previous constraints exist', async () => {
      // When previous constraints exist, heuristic returns FOLLOWUP_REFINE with medium confidence
      // But medium confidence still triggers LLM fallback, so we need to mock it
      const mockRouterResult: RouterResult = {
        route: 'FOLLOWUP_REFINE',
        confidence: 'medium',
        extractedSignals: ['product_search_indicator', 'has_previous_constraints'],
        userTone: 'neutral',
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockRouterResult),
      });
      
      const result = await routeTurn({
        message: 'hand cream for dry hands',
        conversationState: {
          lastConstraints: { priceMaxCents: 5000 },
        },
      });
      
      expect(result.route).toBe('FOLLOWUP_REFINE');
      expect(result.confidence).toBe('medium');
    });
  });

  describe('LLM fallback routing', () => {
    it('should use LLM fallback when heuristics cannot determine route', async () => {
      const mockRouterResult: RouterResult = {
        route: 'DISCOVERY',
        confidence: 'medium',
        extractedSignals: ['llm_classification'],
        userTone: 'neutral',
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockRouterResult),
      });
      
      const result = await routeTurn({
        message: 'I need something for my sensitive skin that works well',
      });
      
      expect(callLLM).toHaveBeenCalledTimes(1);
      expect(result.route).toBe('DISCOVERY');
      expect(result.confidence).toBe('medium');
    });

    it('should fallback to DISCOVERY when LLM fails', async () => {
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('API error'));
      
      const result = await routeTurn({
        message: 'complex query that needs LLM',
      });
      
      expect(result.route).toBe('DISCOVERY');
      expect(result.confidence).toBe('low');
      expect(result.extractedSignals).toContain('llm_fallback');
    });

    it('should handle invalid route from LLM gracefully', async () => {
      const mockRouterResult = {
        route: 'INVALID_ROUTE',
        confidence: 'medium',
        extractedSignals: ['test'],
      };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(mockRouterResult),
      });
      
      const result = await routeTurn({
        message: 'test query',
      });
      
      // Should fallback to DISCOVERY for invalid routes
      expect(result.route).toBe('DISCOVERY');
    });
  });

  describe('complex scenarios', () => {
    it('should handle "that\'s too expensive, cheaper options" with refinePatch', async () => {
      const result = await routeTurn({
        message: "that's too expensive, cheaper options",
      });
      
      expect(result.route).toBe('FOLLOWUP_REFINE');
      expect(result.extractedSignals).toContain('cheaper_request');
    });

    it('should handle "yes please" as AFFIRMATION', async () => {
      const result = await routeTurn({ message: 'yes please' });
      
      expect(result.route).toBe('AFFIRMATION');
      expect(result.confidence).toBe('high');
    });

    it('should handle "no thanks" as NEGATION', async () => {
      const result = await routeTurn({ message: 'no thanks' });
      
      expect(result.route).toBe('NEGATION');
      expect(result.confidence).toBe('high');
    });

    it('should handle conversation history context', async () => {
      // "something cheaper" should match cheaper pattern and route to FOLLOWUP_REFINE via heuristics
      // No LLM call needed
      const result = await routeTurn({
        message: 'something cheaper',
        history: [
          { role: 'user', content: 'show me serums' },
          { role: 'assistant', content: 'Here are some serums...' },
        ],
        conversationState: {
          lastConstraints: { productTypes: ['serum'] },
        },
      });
      
      expect(result.route).toBe('FOLLOWUP_REFINE');
      expect(result.confidence).toBe('high');
    });
  });
});

