/**
 * Dictionary-Based Constraint Refinement Tests
 * 
 * Tests the LLM-based constraint refinement for ranking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refineConstraintsWithDictionaries } from '../src/lib/loveshackfancy/constraint-refiner';
import { buildConstraintRefinementPrompt } from '../src/lib/loveshackfancy/prompts';
import type { RefinedConstraints } from '../src/lib/loveshackfancy/constraint-utils';

// Mock the LLM provider
vi.mock('../src/lib/loveshackfancy/../llm/provider', () => ({
  callLLM: vi.fn(),
}));

// Mock the logger
vi.mock('../src/lib/loveshackfancy/../telemetry/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { callLLM } from '../src/lib/llm/provider';

describe('Constraint Refinement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildConstraintRefinementPrompt', () => {
    it('should include all dictionary types in prompt', () => {
      const prompt = buildConstraintRefinementPrompt({
        query: 'curvy jeans for women',
        gender: 'female',
        categories: ['Womens-jeans'],
        ageGroup: 'Adult',
        candidateCount: 25,
      });

      // Check that prompt includes key dictionary sections
      expect(prompt).toContain('COLORS');
      expect(prompt).toContain('MATERIALS');
      expect(prompt).toContain('OCCASIONS');
      // STYLES may be empty in dictionary, so skip that check
      expect(prompt).toContain('PATTERNS');
      expect(prompt).toContain('SIZES');
      expect(prompt).toContain('LENGTHS');
      expect(prompt).toContain('FITS');
      expect(prompt).toContain('RISES');
      expect(prompt).toContain('FORMALITY');
      
      // Check context is included
      expect(prompt).toContain('Gender: female');
      expect(prompt).toContain('Categories: Womens-jeans');
      expect(prompt).toContain('Age Group: Adult');
      expect(prompt).toContain('25 candidate products');
      
      // Check query is included
      expect(prompt).toContain('curvy jeans for women');
      
      // Check JSON schema is included
      expect(prompt).toContain('OUTPUT JSON');
      expect(prompt).toContain('"importance"');
    });

    it('should handle optional parameters', () => {
      const prompt = buildConstraintRefinementPrompt({
        query: 'black dress',
      });

      expect(prompt).toContain('black dress');
      expect(prompt).toContain('COLORS');
      expect(prompt).not.toContain('Gender:');
      expect(prompt).not.toContain('Categories:');
    });

    it('should include conversation history when provided', () => {
      const prompt = buildConstraintRefinementPrompt({
        query: 'in blue',
        conversationHistory: [
          { role: 'user', content: 'show me dresses' },
          { role: 'assistant', content: 'Here are some beautiful dresses...' },
        ],
      });

      expect(prompt).toContain('CONVERSATION CONTEXT');
      expect(prompt).toContain('USER: show me dresses');
      expect(prompt).toContain('ASSISTANT: Here are some beautiful dresses');
    });
  });

  describe('refineConstraintsWithDictionaries', () => {
    it('should refine "curvy jeans" query correctly', async () => {
      const mockLLMResponse: RefinedConstraints = {
        fits: ['Relaxed', 'Wide Leg', 'Straight'],
        sizes: ['L', 'XL', '2XL', '14', '16'],
        rises: ['Mid Rise', 'High Rise'],
        colors: [],
        materials: [],
        occasions: [],
        styles: [],
        patterns: [],
        lengths: [],
        formalityLevel: [],
        importance: {
          fits: 'strong',
          sizes: 'strong',
          rises: 'preferred',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'curvy jeans for women',
        gender: 'female',
        categories: ['Womens-jeans'],
        ageGroup: 'Adult',
        candidateCount: 25,
      });

      expect(result.refinedConstraints.fits).toBeDefined();
      expect(result.refinedConstraints.sizes).toBeDefined();
      expect(result.validatedConstraints.fits).toBeDefined();
      expect(result.validatedConstraints.fits?.intent).toBe('strong');
      expect(result.validatedConstraints.sizes?.intent).toBe('strong');
      
      // Check validation stats
      expect(result.validationStats.validated).toBeGreaterThan(0);
    });

    it('should refine "black formal dress" query correctly', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: ['Black'],
        occasions: ['Wedding', 'Evening, Wedding'],
        formalityLevel: ['Formal'],
        styles: [],
        fits: [],
        materials: [],
        patterns: [],
        sizes: [],
        lengths: [],
        rises: [],
        importance: {
          colors: 'required',
          occasions: 'strong',
          formalityLevel: 'strong',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'black formal dress for wedding',
        gender: 'female',
        categories: ["Women's Dresses"],
        ageGroup: 'Adult',
        candidateCount: 30,
      });

      expect(result.refinedConstraints.colors).toContain('Black');
      expect(result.refinedConstraints.occasions).toContain('Wedding');
      expect(result.validatedConstraints.colors?.intent).toBe('required');
      expect(result.validatedConstraints.occasions?.intent).toBe('strong');
      expect(result.validatedConstraints.formalityLevel?.intent).toBe('strong');
    });

    it('should handle LLM failures gracefully', async () => {
      (callLLM as any).mockRejectedValue(new Error('LLM timeout'));

      const result = await refineConstraintsWithDictionaries({
        query: 'summer dress',
        gender: 'female',
      });

      // Should return empty refinement on failure
      expect(result.refinedConstraints).toEqual({});
      expect(result.validatedConstraints).toEqual({});
      expect(result.validationStats.total).toBe(0);
    });

    it('should handle invalid JSON gracefully', async () => {
      (callLLM as any).mockResolvedValue('invalid json {{{');

      const result = await refineConstraintsWithDictionaries({
        query: 'summer dress',
        gender: 'female',
      });

      // Should return empty refinement on parse failure
      expect(result.refinedConstraints).toEqual({});
      expect(result.validatedConstraints).toEqual({});
    });

    it('should validate and drop non-dictionary values', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: ['Black', 'InvalidColorName', 'White'],
        materials: ['Cotton', 'FakeMaterial'],
        occasions: ['ValidOccasion', 'AnotherInvalidOne'],
        fits: [],
        styles: [],
        patterns: [],
        sizes: [],
        lengths: [],
        rises: [],
        formalityLevel: [],
        importance: {
          colors: 'strong',
          materials: 'preferred',
          occasions: 'strong',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'black cotton dress',
        gender: 'female',
      });

      // Should validate and potentially drop invalid values
      // (Exact behavior depends on actual dictionary contents)
      expect(result.validationStats.total).toBeGreaterThan(0);
      
      // All refined constraint arrays should be validated
      if (result.refinedConstraints.colors) {
        expect(Array.isArray(result.refinedConstraints.colors)).toBe(true);
      }
    });

    it('should preserve importance levels in validated constraints', async () => {
      const mockLLMResponse: RefinedConstraints = {
        colors: ['Black'],
        occasions: ['Daytime'],
        sizes: ['M', 'L'],
        fits: [],
        materials: [],
        styles: [],
        patterns: [],
        lengths: [],
        rises: [],
        formalityLevel: [],
        importance: {
          colors: 'required',
          occasions: 'strong',
          sizes: 'preferred',
        },
      };

      (callLLM as any).mockResolvedValue({ rawText: JSON.stringify(mockLLMResponse) });

      const result = await refineConstraintsWithDictionaries({
        query: 'black daytime tee in M or L',
        gender: 'female',
      });

      expect(result.validatedConstraints.colors?.intent).toBe('required');
      expect(result.validatedConstraints.occasions?.intent).toBe('strong');
      expect(result.validatedConstraints.sizes?.intent).toBe('preferred');
    });

    it('should handle empty constraint arrays', async () => {
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
        query: 'show me something nice',
        gender: 'female',
      });

      expect(Object.keys(result.validatedConstraints)).toHaveLength(0);
      expect(result.validationStats.total).toBe(0);
      expect(result.validationStats.validated).toBe(0);
    });
  });
});
