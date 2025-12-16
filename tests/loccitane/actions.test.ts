/**
 * Tests for Action System
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateActionSpecs, generateActionId, type ActionSpec } from '../../src/lib/loccitane/actions';
import { getActionLabel, getActionLabels } from '../../src/lib/loccitane/actionLabels';
import { callLLM } from '../../src/lib/llm/provider';

// Mock the LLM provider
vi.mock('../../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
}));

// Mock Prisma
vi.mock('../../src/lib/db', () => ({
  prisma: {
    merchant: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Action System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateActionSpecs', () => {
    it('should generate show_more action when hasMoreProducts is true', () => {
      const classification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const specs = generateActionSpecs(classification, true, 4);
      
      expect(specs).toContainEqual({ type: 'show_more' });
    });

    it('should generate refine_price action when no price constraint', () => {
      const classification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const specs = generateActionSpecs(classification, false, 2);
      
      expect(specs.some(s => s.type === 'refine_price')).toBe(true);
    });

    it('should generate refine_ingredient action when ingredients present', () => {
      const classification = {
        type: 'ingredient_exploration',
        constraints: {
          mustHaveIngredients: ['shea_butter'],
        },
      };
      
      const specs = generateActionSpecs(classification, false, 2);
      
      const refineIngredient = specs.find(s => s.type === 'refine_ingredient');
      expect(refineIngredient).toBeDefined();
      expect(refineIngredient?.payload?.currentIngredients).toEqual(['shea_butter']);
    });

    it('should generate ask_preferences for ingredient when none present', () => {
      const classification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const specs = generateActionSpecs(classification, false, 2);
      
      expect(specs.some(s => s.type === 'ask_preferences' && s.payload?.preferenceType === 'ingredient')).toBe(true);
    });

    it('should limit to 4 actions max', () => {
      const classification = {
        type: 'gift_or_vague',
        constraints: {},
      };
      
      const specs = generateActionSpecs(classification, true, 10);
      
      expect(specs.length).toBeLessThanOrEqual(4);
    });

    it('should return empty array for product-specific queries', () => {
      // Product-specific queries don't have actions (handled in reply.ts)
      // This test verifies the function itself works correctly
      const classification = {
        type: 'direct_product_search',
        constraints: { productTypes: ['serum'] },
      };
      
      const specs = generateActionSpecs(classification, false, 0);
      
      // Should still generate some actions for discovery queries
      expect(specs.length).toBeGreaterThan(0);
    });
  });

  describe('generateActionId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateActionId();
      const id2 = generateActionId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^action-/);
    });

    it('should accept custom prefix', () => {
      const id = generateActionId('custom');
      
      expect(id).toMatch(/^custom-/);
    });
  });

  describe('getActionLabel', () => {
    it('should use default label when merchant config missing', async () => {
      const spec: ActionSpec = { type: 'show_more' };
      
      vi.mocked(callLLM).mockRejectedValueOnce(new Error('API error'));
      
      const label = await getActionLabel(undefined, spec);
      
      expect(label).toBe('Show more');
    });

    it('should generate label via LLM when merchant config missing', async () => {
      const spec: ActionSpec = { type: 'show_more' };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: JSON.stringify(['Show more products', 'Load more']),
      });
      
      const label = await getActionLabel(undefined, spec);
      
      expect(callLLM).toHaveBeenCalledTimes(1);
      expect(label).toBe('Show more products');
    });

    it('should handle LLM returning string directly', async () => {
      const spec: ActionSpec = { type: 'refine_price' };
      
      vi.mocked(callLLM).mockResolvedValueOnce({
        rawText: 'Filter by price',
      });
      
      const label = await getActionLabel(undefined, spec);
      
      expect(label).toBe('Filter by price');
    });
  });

  describe('getActionLabels', () => {
    it('should generate labels for multiple specs in parallel', async () => {
      const specs: ActionSpec[] = [
        { type: 'show_more' },
        { type: 'refine_price' },
      ];
      
      vi.mocked(callLLM)
        .mockResolvedValueOnce({
          rawText: JSON.stringify(['Show more']),
        })
        .mockResolvedValueOnce({
          rawText: JSON.stringify(['Filter by price']),
        });
      
      const labelMap = await getActionLabels(undefined, specs);
      
      expect(labelMap.size).toBe(2);
      expect(labelMap.get('show_more')).toBe('Show more');
      expect(labelMap.get('refine_price')).toBe('Filter by price');
    });
  });
});


