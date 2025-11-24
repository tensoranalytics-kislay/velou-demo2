/**
 * Unit tests for discovery follow-up patterns
 * Tests canonicalization, follow-up detection, and constraint merging
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  canonicalizeCategory,
  getExpandedLeafCategories,
  getSynonymTerms,
  type CanonicalCategory,
} from '../src/lib/search/canonicalize';
import { detectFollowUpType } from '../src/lib/llm/orchestrator/followup-detector';
import type { SearchConstraints } from '../src/lib/search/types';
import type { CatalogOntology } from '../src/lib/search/ontology';

const mockOntology: CatalogOntology = {
  categories: ['t shirt', 'graphic t shirt', 'skirts', 'jeans', 'dresses', 'shoes'],
  productTypes: ['tshirt', 'tee', 'skirt', 'jean', 'dress', 'shoe'],
  brands: ['Lucky Brand'],
  colors: ['black', 'white', 'navy', 'red'],
  materials: ['cotton', 'denim', 'linen'],
  genders: ['mens', 'womens'],
  sizes: ['S', 'M', 'L', 'XL'],
  googleCategories: ['Shirts & Tops', 'Skirts', 'Pants'],
  customLabels4: [],
};

describe('Canonicalization', () => {
  describe('canonicalizeCategory', () => {
    it('should map t-shirt synonyms to TSHIRT', () => {
      const testCases = [
        { input: 'tshirt', expected: 'TSHIRT' },
        { input: 't-shirt', expected: 'TSHIRT' },
        { input: 'tee', expected: 'TSHIRT' },
        { input: 'tees', expected: 'TSHIRT' },
        { input: 'graphic tee', expected: 'TSHIRT' },
        { input: 'just tees', expected: 'TSHIRT' },
      ];

      for (const testCase of testCases) {
        const result = canonicalizeCategory(testCase.input, mockOntology);
        expect(result.canonical).toBe(testCase.expected);
        expect(result.confidence).toBeGreaterThan(0.3);
      }
    });

    it('should map skirt synonyms to SKIRT', () => {
      const testCases = [
        { input: 'skirt', expected: 'SKIRT' },
        { input: 'skirts', expected: 'SKIRT' },
        { input: 'denim skirt', expected: 'SKIRT' },
        { input: 'show me skirts', expected: 'SKIRT' },
      ];

      for (const testCase of testCases) {
        const result = canonicalizeCategory(testCase.input, mockOntology);
        expect(result.canonical).toBe(testCase.expected);
      }
    });

    it('should return UNKNOWN for unrecognized text', () => {
      const result = canonicalizeCategory('random text', mockOntology);
      expect(result.canonical).toBe('UNKNOWN');
      expect(result.confidence).toBeLessThan(0.3);
    });
  });

  describe('getExpandedLeafCategories', () => {
    it('should return expanded leaf categories for TSHIRT', () => {
      const leaves = getExpandedLeafCategories('TSHIRT', mockOntology);
      expect(leaves.length).toBeGreaterThan(0);
      expect(leaves.some((leaf) => leaf.includes('t shirt'))).toBe(true);
    });

    it('should return expanded leaf categories for SKIRT', () => {
      const leaves = getExpandedLeafCategories('SKIRT', mockOntology);
      expect(leaves.length).toBeGreaterThan(0);
      expect(leaves.some((leaf) => leaf.includes('skirt'))).toBe(true);
    });
  });

  describe('getSynonymTerms', () => {
    it('should return synonym terms for TSHIRT', () => {
      const synonyms = getSynonymTerms('TSHIRT');
      expect(synonyms.length).toBeGreaterThan(0);
      expect(synonyms).toContain('tshirt');
      expect(synonyms).toContain('tee');
    });
  });
});

describe('Follow-up Detection', () => {
  const previousConstraints: SearchConstraints = {
    category: 'dresses',
    occasions: ['office'],
    materials: ['linen'],
    colors: ['black'],
    inStockOnly: true,
  };

  describe('SWITCH detection', () => {
    it('should detect switch when user says "only tshirts"', () => {
      const detection = detectFollowUpType(
        'only tshirts',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(detection.followUpType).toBe('SWITCH');
      expect(detection.overrideCategory).toBe('TSHIRT');
      expect(detection.carryOver.vibe).toBe(false);
      expect(detection.carryOver.hardFilters).toBe(false);
    });

    it('should detect switch when user says "just show some tshirts"', () => {
      const detection = detectFollowUpType(
        'just show some tshirts',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(detection.followUpType).toBe('SWITCH');
      expect(detection.overrideCategory).toBe('TSHIRT');
    });

    it('should detect switch when user says "show me skirts instead"', () => {
      const detection = detectFollowUpType(
        'show me skirts instead',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(detection.followUpType).toBe('SWITCH');
      expect(detection.overrideCategory).toBe('SKIRT');
    });
  });

  describe('REFINE detection', () => {
    it('should detect refine when user says "black ones"', () => {
      const detection = detectFollowUpType(
        'black ones',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(detection.followUpType).toBe('REFINE');
      expect(detection.carryOver.vibe).toBe(true);
      expect(detection.carryOver.hardFilters).toBe(true);
    });

    it('should detect refine when user says "cheaper"', () => {
      const detection = detectFollowUpType('cheaper', previousConstraints, false, mockOntology);
      expect(detection.followUpType).toBe('REFINE');
    });

    it('should detect refine when user says "show more like that"', () => {
      const detection = detectFollowUpType(
        'show more like that',
        previousConstraints,
        false,
        mockOntology,
      );
      expect(detection.followUpType).toBe('REFINE');
    });
  });

  describe('CONFIRM_SUGGESTION detection', () => {
    it('should detect confirmation when user says "yes" and has pending suggestion', () => {
      const detection = detectFollowUpType('yes', previousConstraints, true, mockOntology);
      expect(detection.followUpType).toBe('CONFIRM_SUGGESTION');
    });

    it('should NOT confirm when user says "show me tees" even with pending suggestion', () => {
      const detection = detectFollowUpType(
        'show me tees',
        previousConstraints,
        true,
        mockOntology,
      );
      // Should detect switch, not confirmation
      expect(detection.followUpType).not.toBe('CONFIRM_SUGGESTION');
      expect(detection.overrideCategory).toBe('TSHIRT');
    });
  });
});

describe('End-to-end Follow-up Scenarios', () => {
  it('should handle initial broad request + switch to tshirts', () => {
    const initialMessage = 'smart casual outfit for office in summer';
    const followUpMessage = 'only tshirts';

    // Initial request - no previous constraints
    const initialCanonical = canonicalizeCategory(initialMessage, mockOntology);
    expect(initialCanonical.canonical).toBe('UNKNOWN'); // Too broad

    // Follow-up switch
    const previousConstraints: SearchConstraints = {
      occasions: ['office'],
      seasons: ['summer'],
      inStockOnly: true,
    };
    const followUpDetection = detectFollowUpType(
      followUpMessage,
      previousConstraints,
      false,
      mockOntology,
    );
    expect(followUpDetection.followUpType).toBe('SWITCH');
    expect(followUpDetection.overrideCategory).toBe('TSHIRT');
  });

  it('should handle switch with "instead" keyword', () => {
    const followUpMessage = 'show me skirts instead';
    const previousConstraints: SearchConstraints = {
      category: 'dresses',
      occasions: ['office'],
      inStockOnly: true,
    };

    const followUpDetection = detectFollowUpType(
      followUpMessage,
      previousConstraints,
      false,
      mockOntology,
    );
    expect(followUpDetection.followUpType).toBe('SWITCH');
    expect(followUpDetection.overrideCategory).toBe('SKIRT');
  });

  it('should handle refinement maintaining category', () => {
    const followUpMessage = 'black ones';
    const previousConstraints: SearchConstraints = {
      category: 't shirt',
      inStockOnly: true,
    };

    const followUpDetection = detectFollowUpType(
      followUpMessage,
      previousConstraints,
      false,
      mockOntology,
    );
    expect(followUpDetection.followUpType).toBe('REFINE');
    expect(followUpDetection.carryOver.vibe).toBe(true);
    expect(followUpDetection.carryOver.hardFilters).toBe(true);
  });
});

