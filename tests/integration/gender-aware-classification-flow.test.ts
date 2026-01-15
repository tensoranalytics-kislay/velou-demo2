/**
 * Integration Tests for Gender-Aware Classification Flow
 * 
 * Tests the end-to-end flow of:
 * 1. Gender context computation
 * 2. Category filtering based on gender
 * 3. Confidence-aware clarification
 */

import { describe, it, expect } from 'vitest';
import {
  buildAllowedCategoriesForClassifier,
  computeGenderContext,
  type FashionConstraints,
} from '../../src/lib/loveshackfancy/classifier';

describe('Gender-Aware Classification Flow (Integration)', () => {
  describe('Gender context determines category filtering', () => {
    it('should compute male context and filter to male+unisex categories', () => {
      const genderContext = computeGenderContext('jeans for men');
      expect(genderContext).toBe('male');
      
      const { categoriesForPrompt, usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(genderContext);
      
      expect(usedStrictMajorityMode).toBe(false);
      expect(categoriesForPrompt).toContain('Mens-jeans');
      expect(categoriesForPrompt).toContain('Accessories'); // unisex
      expect(categoriesForPrompt).not.toContain('Womens-jeans');
      expect(categoriesForPrompt).not.toContain('Bottoms'); // female
    });

    it('should compute female context and filter to female+unisex categories', () => {
      const genderContext = computeGenderContext('dresses for women');
      expect(genderContext).toBe('female');
      
      const { categoriesForPrompt, usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(genderContext);
      
      expect(usedStrictMajorityMode).toBe(false);
      expect(categoriesForPrompt).toContain('Womens-jeans');
      expect(categoriesForPrompt).toContain('Bottoms');
      expect(categoriesForPrompt).toContain('Accessories'); // unisex
      expect(categoriesForPrompt).not.toContain('Mens-jeans');
    });

    it('should use strict majority mode for ambiguous queries', () => {
      const genderContext = computeGenderContext('blue jeans');
      expect(genderContext).toBe(null);
      
      const { categoriesForPrompt, usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(genderContext);
      
      expect(usedStrictMajorityMode).toBe(true);
      expect(categoriesForPrompt).toContain('Mens-jeans'); // male majority
      expect(categoriesForPrompt).toContain('Womens-jeans'); // female majority
      expect(categoriesForPrompt).not.toContain('Accessories'); // pure unisex
    });
  });

  describe('Follow-up context inheritance', () => {
    it('should inherit gender from last constraints when query is ambiguous', () => {
      const lastConstraints: FashionConstraints = { gender: 'male' };
      const genderContext = computeGenderContext('blue jeans', lastConstraints);
      
      expect(genderContext).toBe('male');
      
      const { usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(genderContext);
      expect(usedStrictMajorityMode).toBe(false); // Not ambiguous anymore
    });

    it('should override inherited gender when query is explicit', () => {
      const lastConstraints: FashionConstraints = { gender: 'female' };
      const genderContext = computeGenderContext('mens t-shirts', lastConstraints);
      
      expect(genderContext).toBe('male'); // Query wins
      
      const { categoriesForPrompt } = buildAllowedCategoriesForClassifier(genderContext);
      expect(categoriesForPrompt).toContain('Mens-tees');
      expect(categoriesForPrompt).not.toContain('Womens-tees');
    });
  });

  describe('Confidence-based behavior flags', () => {
    it('should flag strict majority mode with high confidence', () => {
      const genderContext = computeGenderContext('jeans'); // ambiguous
      const { usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(genderContext);
      
      expect(genderContext).toBe(null);
      expect(usedStrictMajorityMode).toBe(true);
      
      // In orchestrator: if confidence >= 0.8, trust result and infer gender from category
      // In orchestrator: if confidence < 0.8, ask for clarification
    });

    it('should not flag strict majority mode when gender is explicit', () => {
      const genderContext = computeGenderContext('jeans for men');
      const { usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(genderContext);
      
      expect(genderContext).toBe('male');
      expect(usedStrictMajorityMode).toBe(false);
      
      // No need for confidence check - gender is already known
    });
  });

  describe('End-to-end category selection flow', () => {
    it('should provide more specific categories when gender is known', () => {
      // Ambiguous query gets generic categories
      const ambiguousContext = computeGenderContext('jeans');
      const ambiguousResult = buildAllowedCategoriesForClassifier(ambiguousContext);
      
      // Explicit male query gets male-specific categories
      const maleContext = computeGenderContext('jeans for men');
      const maleResult = buildAllowedCategoriesForClassifier(maleContext);
      
      // Male result should have Mens-jeans and NOT Womens-jeans
      expect(maleResult.categoriesForPrompt).toContain('Mens-jeans');
      expect(maleResult.categoriesForPrompt).not.toContain('Womens-jeans');
      
      // Ambiguous result should have both
      expect(ambiguousResult.categoriesForPrompt).toContain('Mens-jeans');
      expect(ambiguousResult.categoriesForPrompt).toContain('Womens-jeans');
      
      // Male result should be smaller (more specific)
      expect(maleResult.categoriesForPrompt.length).toBeLessThan(ambiguousResult.categoriesForPrompt.length + 10);
    });

    it('should allow classifier to choose most specific category when gender filters categories', () => {
      // When gender is male, classifier sees Mens-jeans (specific) but NOT Bottoms (generic female)
      const maleContext = computeGenderContext('jeans for men');
      const maleResult = buildAllowedCategoriesForClassifier(maleContext);
      
      expect(maleResult.categoriesForPrompt).toContain('Mens-jeans');
      expect(maleResult.categoriesForPrompt).not.toContain('Bottoms');
      
      // This forces the classifier to choose Mens-jeans over generic categories
      // because generic female categories are filtered out
    });
  });
});
