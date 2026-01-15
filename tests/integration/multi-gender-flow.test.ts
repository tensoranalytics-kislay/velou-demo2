/**
 * Multi-Gender Integration Tests
 * 
 * End-to-end tests for gender-aware search flow.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { handleLoveshackfancyQuery } from '../../src/lib/loveshackfancy/orchestrator';
import { classifyQuery } from '../../src/lib/loveshackfancy/classifier';

const MERCHANT_ID = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

describe('Multi-Gender Flow Integration Tests', () => {
  describe('Gender Detection in Classifier', () => {
    it('should extract male gender from explicit query', async () => {
      const result = await classifyQuery("men's slim black jeans for work");
      
      expect(result.constraints.gender).toBe('male');
      expect(result.productTerms).toContain('jeans');
    });
    
    it('should extract female gender from explicit query', async () => {
      const result = await classifyQuery("women's maxi dress for wedding");
      
      expect(result.constraints.gender).toBe('female');
      expect(result.productTerms).toContain('dress');
    });
    
    it('should leave gender null for ambiguous queries', async () => {
      const result = await classifyQuery('comfortable t-shirt');
      
      expect(result.constraints.gender).toBeNull();
    });
  });
  
  describe('Gender Clarification Flow', () => {
    it('should ask for gender clarification when ambiguous', async () => {
      const result = await handleLoveshackfancyQuery({
        sessionId: 'test-session-gender-clarify',
        message: 'jeans',
        merchantId: MERCHANT_ID,
      });
      
      // Should return clarification with action buttons
      expect(result.route).toBe('GENDER_CLARIFICATION');
      expect(result.actions).toBeDefined();
      expect(result.actions?.length).toBe(2);
      expect(result.actions?.find(a => a.type === 'refine_gender' && a.payload.gender === 'male')).toBeDefined();
      expect(result.actions?.find(a => a.type === 'refine_gender' && a.payload.gender === 'female')).toBeDefined();
    });
    
    it('should NOT ask for clarification when gender is explicit', async () => {
      const result = await handleLoveshackfancyQuery({
        sessionId: 'test-session-mens-explicit',
        message: "men's jeans",
        merchantId: MERCHANT_ID,
      });
      
      // Should proceed with search, not ask for clarification
      expect(result.route).not.toBe('GENDER_CLARIFICATION');
      expect(result.productCards.length).toBeGreaterThan(0);
    });
  });
  
  describe('Gender Filtering', () => {
    it('should return only male products for male query', async () => {
      const result = await handleLoveshackfancyQuery({
        sessionId: 'test-session-mens-filter',
        message: "men's boxer briefs",
        merchantId: MERCHANT_ID,
      });
      
      // All returned products should be male or unisex
      for (const card of result.productCards) {
        const category = card.category?.toLowerCase() || '';
        expect(
          category.includes('mens') || 
          category.includes('male') || 
          category === 'accessories' || 
          category === 'other'
        ).toBe(true);
      }
    });
    
    it('should return only female products for female query', async () => {
      const result = await handleLoveshackfancyQuery({
        sessionId: 'test-session-womens-filter',
        message: "women's maxi dress for wedding",
        merchantId: MERCHANT_ID,
      });
      
      // All returned products should be female or unisex
      for (const card of result.productCards) {
        const category = card.category?.toLowerCase() || '';
        expect(
          category.includes('womens') ||
          category.includes('women') ||
          category.includes('female') ||
          category.includes('dress') ||
          category.includes('skirt') ||
          category === 'tops' ||
          category === 'accessories' ||
          category === 'other'
        ).toBe(true);
      }
    });
  });
  
  describe('Rise and Fit Constraints', () => {
    it('should extract rise constraint from query', async () => {
      const result = await classifyQuery('mid rise dark jeans');
      
      expect(result.constraints.rises).toBeDefined();
      // rises could be array or ConstraintWithIntent
      const riseValues = Array.isArray(result.constraints.rises) 
        ? result.constraints.rises 
        : (result.constraints.rises as any)?.values;
      expect(riseValues).toContain('Mid Rise');
    });
    
    it('should extract fit constraint from query', async () => {
      const result = await classifyQuery('slim fit jeans for work');
      
      expect(result.constraints.fits).toBeDefined();
      const fitValues = Array.isArray(result.constraints.fits)
        ? result.constraints.fits
        : (result.constraints.fits as any)?.values;
      expect(fitValues).toContain('Slim');
    });
  });
});
