/**
 * Integration tests for dictionary-based constraint refinement
 * Tests the full flow from query → refinement → ranking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refineConstraintsWithDictionaries, mergeRefinedConstraints } from '../../src/lib/loveshackfancy/constraint-refiner';
import type { RefinedConstraints } from '../../src/lib/loveshackfancy/constraint-utils';
import type { QueryConstraintsWithIntent } from '../../src/lib/loveshackfancy/constraint-utils';

// Mock the LLM provider
vi.mock('../../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/lib/telemetry/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { callLLM } from '../../src/lib/llm/provider';

describe('Dictionary Refinement Integration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Curvy Women Query Flow', () => {
    it('should refine "curvy jeans for women" with appropriate fit and size constraints', async () => {
      const mockLLMResponse: RefinedConstraints = {
        fits: ['Relaxed', 'Wide Leg', 'Straight', 'Regular'],
        sizes: ['L', 'XL', '2XL', '14', '16', '18'],
        rises: ['Mid Rise', 'High Rise'],
        materials: ['Cotton', 'Denim'],
        colors: [],
        occasions: [],
        styles: [],
        patterns: [],
        lengths: [],
        formalityLevel: [],
        importance: {
          fits: 'strong',
          sizes: 'strong',
          rises: 'preferred',
          materials: 'preferred',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'curvy jeans for women',
        gender: 'female',
        categories: ['Womens-jeans'],
        ageGroup: 'Adult',
        candidateCount: 30,
      });

      // Check that refinement captured the key constraints for curvy fit
      expect(result.validatedConstraints.fits).toBeDefined();
      expect(result.validatedConstraints.sizes).toBeDefined();
      expect(result.validatedConstraints.fits?.intent).toBe('strong');
      expect(result.validatedConstraints.sizes?.intent).toBe('strong');
      
      // Fits should include relaxed/loose options
      const fitValues = result.validatedConstraints.fits?.values || [];
      expect(fitValues.some(f => ['Relaxed', 'Wide Leg', 'Loose', 'Straight'].includes(f))).toBe(true);
      
      // Sizes should include larger sizes
      const sizeValues = result.validatedConstraints.sizes?.values || [];
      expect(sizeValues.some(s => ['L', 'XL', '2XL', '14', '16', '18'].includes(s))).toBe(true);
    });

    it('should merge refined constraints with existing classification constraints', async () => {
      const mockLLMResponse: RefinedConstraints = {
        fits: ['Relaxed'],
        sizes: ['L', 'XL'],
        colors: [],
        materials: [],
        occasions: [],
        styles: [],
        patterns: [],
        lengths: [],
        rises: [],
        formalityLevel: [],
        importance: {
          fits: 'strong',
          sizes: 'strong',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'curvy tops',
        gender: 'female',
      });

      // Existing constraints from classification
      const existingConstraints: QueryConstraintsWithIntent = {
        ageGroups: { values: ['Adult'], intent: 'strong' },
        colors: { values: ['Blue'], intent: 'preferred' },
      };

      const merged = mergeRefinedConstraints(existingConstraints, result.validatedConstraints);

      // Should preserve existing ageGroups
      expect(merged.ageGroups).toBeDefined();
      expect(merged.ageGroups?.values).toContain('Adult');
      
      // Should add refined fits and sizes
      expect(merged.fits).toBeDefined();
      expect(merged.sizes).toBeDefined();
      
      // Colors from existing should be preserved (not overridden since refinement returned empty)
      expect(merged.colors).toBeDefined();
    });
  });

  describe('Formal/Wedding Query Flow', () => {
    it('should refine "black formal dress for wedding" with strong color and occasion constraints', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: ['Black'],
        occasions: ['Wedding', 'Evening, Wedding'],
        formalityLevel: ['Formal'],
        lengths: ['Maxi', 'Midi'],
        fits: [],
        materials: [],
        patterns: [],
        sizes: [],
        rises: [],
        styles: [],
        importance: {
          colors: 'required',
          occasions: 'strong',
          formalityLevel: 'strong',
          lengths: 'preferred',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'black formal dress for wedding',
        gender: 'female',
        categories: ["Women's Dresses"],
        ageGroup: 'Adult',
        candidateCount: 40,
      });

      // Check that color is required intent
      expect(result.validatedConstraints.colors?.intent).toBe('required');
      expect(result.validatedConstraints.colors?.values).toContain('Black');
      
      // Check occasions are strong
      expect(result.validatedConstraints.occasions?.intent).toBe('strong');
      const occasionValues = result.validatedConstraints.occasions?.values || [];
      expect(occasionValues.some(o => o.includes('Wedding'))).toBe(true);
      
      // Check formalityLevel is strong
      expect(result.validatedConstraints.formalityLevel?.intent).toBe('strong');
      expect(result.validatedConstraints.formalityLevel?.values).toContain('Formal');
    });
  });

  describe('Material-Focused Query Flow', () => {
    it('should refine "comfortable cotton tops" with material and fit constraints', async () => {
      const mockLLMResponse: RefinedConstraints = {
        materials: ['Cotton'],
        fits: ['Relaxed', 'Regular', 'Loose'],
        occasions: ['Casual', 'Daytime'],
        colors: [],
        styles: [],
        patterns: [],
        sizes: [],
        lengths: [],
        rises: [],
        formalityLevel: [],
        importance: {
          materials: 'strong',
          fits: 'preferred',
          occasions: 'preferred',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'comfortable cotton tops',
        gender: 'female',
        categories: ['Tops', 'Womens-tees'],
        ageGroup: 'Adult',
        candidateCount: 35,
      });

      expect(result.validatedConstraints.materials?.intent).toBe('strong');
      expect(result.validatedConstraints.materials?.values).toContain('Cotton');
      expect(result.validatedConstraints.fits?.intent).toBe('preferred');
    });
  });

  describe('Validation and Filtering', () => {
    it('should drop completely invalid constraint types', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: ['InvalidColor1', 'InvalidColor2'],
        materials: ['FakeMaterial'],
        occasions: [],
        styles: [],
        patterns: [],
        sizes: [],
        lengths: [],
        fits: [],
        rises: [],
        formalityLevel: [],
        importance: {
          colors: 'strong',
          materials: 'strong',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'some query',
      });

      // Should have dropped values in validation stats
      expect(result.validationStats.dropped).toBeGreaterThan(0);
    });

    it('should handle mixed valid/invalid values', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: ['Black', 'InvalidColor', 'White'],
        occasions: ['Casual', 'FakeOccasion', 'Formal'],
        materials: [],
        styles: [],
        patterns: [],
        sizes: [],
        lengths: [],
        fits: [],
        rises: [],
        formalityLevel: [],
        importance: {
          colors: 'strong',
          occasions: 'preferred',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'black and white dress',
      });

      // Should have some validated and some dropped
      expect(result.validationStats.validated).toBeGreaterThan(0);
      expect(result.validationStats.total).toBeGreaterThan(result.validationStats.validated);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query gracefully', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: [],
        materials: [],
        occasions: [],
        styles: [],
        patterns: [],
        sizes: [],
        lengths: [],
        fits: [],
        rises: [],
        formalityLevel: [],
        importance: {},
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: '',
      });

      expect(result.validatedConstraints).toBeDefined();
    });

    it('should handle missing importance map gracefully', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: ['Black'],
        materials: [],
        occasions: [],
        styles: [],
        patterns: [],
        sizes: [],
        lengths: [],
        fits: [],
        rises: [],
        formalityLevel: [],
        // No importance map
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'black dress',
      });

      // Should still work, defaulting to 'strong' intent
      if (result.validatedConstraints.colors) {
        expect(result.validatedConstraints.colors.intent).toBe('strong');
      }
    });
  });
});
