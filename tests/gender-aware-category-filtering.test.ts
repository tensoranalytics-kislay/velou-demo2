/**
 * Tests for Gender-Aware Category Filtering
 * 
 * Validates that the classifier only sees gender-appropriate categories
 * and handles confidence-based clarification properly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAllowedCategoriesForClassifier,
  computeGenderContext,
  type FashionConstraints,
} from '../src/lib/loveshackfancy/classifier';
import { CATEGORY_GENDER_MAP } from '../src/lib/catalog/category-gender-map';

describe('Gender-Aware Category Filtering', () => {
  describe('computeGenderContext', () => {
    it('should detect male gender from query text', () => {
      const context = computeGenderContext('jeans for men');
      expect(context).toBe('male');
    });

    it('should detect female gender from query text', () => {
      const context = computeGenderContext('dresses for women');
      expect(context).toBe('female');
    });

    it('should use last constraints gender when query has no explicit gender', () => {
      const lastConstraints: FashionConstraints = { gender: 'male' };
      const context = computeGenderContext('blue jeans', lastConstraints);
      expect(context).toBe('male');
    });

    it('should prefer query gender over last constraints', () => {
      const lastConstraints: FashionConstraints = { gender: 'female' };
      const context = computeGenderContext('mens t-shirts', lastConstraints);
      expect(context).toBe('male');
    });

    it('should return null for ambiguous queries', () => {
      const context = computeGenderContext('blue jeans');
      expect(context).toBe(null);
    });

    it('should ignore unisex in last constraints', () => {
      const lastConstraints: FashionConstraints = { gender: 'unisex' };
      const context = computeGenderContext('jeans', lastConstraints);
      expect(context).toBe(null);
    });
  });

  describe('buildAllowedCategoriesForClassifier', () => {
    it('should return only male and unisex categories when gender context is male', () => {
      const { categoriesForPrompt, usedStrictMajorityMode } = buildAllowedCategoriesForClassifier('male');
      
      expect(usedStrictMajorityMode).toBe(false);
      expect(categoriesForPrompt.length).toBeGreaterThan(0);
      
      // Check that all returned categories are either male or unisex
      for (const category of categoriesForPrompt) {
        const gender = CATEGORY_GENDER_MAP[category];
        expect(gender === 'male' || gender === 'unisex').toBe(true);
      }
      
      // Should include Mens-jeans
      expect(categoriesForPrompt).toContain('Mens-jeans');
      
      // Should NOT include Womens-jeans or Bottoms (female)
      expect(categoriesForPrompt).not.toContain('Womens-jeans');
      expect(categoriesForPrompt).not.toContain('Bottoms');
      expect(categoriesForPrompt).not.toContain('Women\'s Dresses');
    });

    it('should return only female and unisex categories when gender context is female', () => {
      const { categoriesForPrompt, usedStrictMajorityMode } = buildAllowedCategoriesForClassifier('female');
      
      expect(usedStrictMajorityMode).toBe(false);
      expect(categoriesForPrompt.length).toBeGreaterThan(0);
      
      // Check that all returned categories are either female or unisex
      for (const category of categoriesForPrompt) {
        const gender = CATEGORY_GENDER_MAP[category];
        expect(gender === 'female' || gender === 'unisex').toBe(true);
      }
      
      // Should include Womens-jeans and Bottoms
      expect(categoriesForPrompt).toContain('Womens-jeans');
      expect(categoriesForPrompt).toContain('Bottoms');
      
      // Should NOT include Mens-jeans
      expect(categoriesForPrompt).not.toContain('Mens-jeans');
      expect(categoriesForPrompt).not.toContain('Mens-tees');
    });

    it('should return only strict majority categories (male/female, not unisex) when gender context is null', () => {
      const { categoriesForPrompt, usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(null);
      
      expect(usedStrictMajorityMode).toBe(true);
      expect(categoriesForPrompt.length).toBeGreaterThan(0);
      
      // Check that all returned categories are strictly male or female (NOT unisex)
      for (const category of categoriesForPrompt) {
        const gender = CATEGORY_GENDER_MAP[category];
        expect(gender === 'male' || gender === 'female').toBe(true);
        expect(gender).not.toBe('unisex');
      }
      
      // Should include gendered categories
      expect(categoriesForPrompt).toContain('Mens-jeans');
      expect(categoriesForPrompt).toContain('Womens-jeans');
      expect(categoriesForPrompt).toContain('Bottoms'); // female
      
      // Should NOT include unisex categories
      expect(categoriesForPrompt).not.toContain('Accessories');
      expect(categoriesForPrompt).not.toContain('Perfumes');
      expect(categoriesForPrompt).not.toContain('Bedding');
    });

    it('should use different category sets for male vs female vs ambiguous', () => {
      const maleResult = buildAllowedCategoriesForClassifier('male');
      const femaleResult = buildAllowedCategoriesForClassifier('female');
      const ambiguousResult = buildAllowedCategoriesForClassifier(null);
      
      // Male and female should have different categories
      const maleSet = new Set(maleResult.categoriesForPrompt);
      const femaleSet = new Set(femaleResult.categoriesForPrompt);
      const ambiguousSet = new Set(ambiguousResult.categoriesForPrompt);
      
      // Male should include male-specific categories
      expect(maleSet.has('Mens-jeans')).toBe(true);
      expect(maleSet.has('Womens-jeans')).toBe(false);
      
      // Female should include female-specific categories
      expect(femaleSet.has('Womens-jeans')).toBe(true);
      expect(femaleSet.has('Mens-jeans')).toBe(false);
      
      // Ambiguous should include both male and female categories
      expect(ambiguousSet.has('Mens-jeans')).toBe(true);
      expect(ambiguousSet.has('Womens-jeans')).toBe(true);
      
      // Ambiguous should NOT include unisex
      expect(ambiguousSet.has('Accessories')).toBe(false);
      
      // Male and female should include unisex
      expect(maleSet.has('Accessories')).toBe(true);
      expect(femaleSet.has('Accessories')).toBe(true);
    });
  });
});
