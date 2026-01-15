/**
 * Gender Detection Tests
 * 
 * Tests for gender detection and clarification logic.
 */

import { describe, it, expect } from 'vitest';
import { detectGenderFromQuery, shouldClarifyGender, resolveGender } from '../src/lib/loveshackfancy/gender-detector';

describe('detectGenderFromQuery', () => {
  it('should detect male from explicit keywords', () => {
    expect(detectGenderFromQuery("men's jeans")).toBe('male');
    expect(detectGenderFromQuery('mens t-shirts')).toBe('male');
    expect(detectGenderFromQuery('for him')).toBe('male');
    expect(detectGenderFromQuery('boyfriend jeans')).toBe('male');
    expect(detectGenderFromQuery('looking for something for my husband')).toBe('male');
  });
  
  it('should detect female from explicit keywords', () => {
    expect(detectGenderFromQuery("women's dress")).toBe('female');
    expect(detectGenderFromQuery('womens jeans')).toBe('female');
    expect(detectGenderFromQuery('for her')).toBe('female');
    expect(detectGenderFromQuery('girlfriend gift')).toBe('female');
    expect(detectGenderFromQuery('something for my wife')).toBe('female');
  });
  
  it('should return null for ambiguous queries', () => {
    expect(detectGenderFromQuery('blue jeans')).toBe(null);
    expect(detectGenderFromQuery('comfortable t-shirt')).toBe(null);
    expect(detectGenderFromQuery('hoodie')).toBe(null);
    expect(detectGenderFromQuery('athletic shorts')).toBe(null);
  });
  
  it('should be case-insensitive', () => {
    expect(detectGenderFromQuery('MENS JEANS')).toBe('male');
    expect(detectGenderFromQuery('Womens Dress')).toBe('female');
  });
});

describe('shouldClarifyGender', () => {
  it('should NOT clarify when gender is explicitly detected', () => {
    const topCategories = ['Mens-jeans', 'Womens-jeans']; // Mixed
    expect(shouldClarifyGender("men's jeans", topCategories)).toBe(false);
    expect(shouldClarifyGender("women's jeans", topCategories)).toBe(false);
  });
  
  it('should NOT clarify when all categories are same gender', () => {
    const maleCategories = ['Mens-jeans', 'Mens-tees', 'Mens-shorts'];
    expect(shouldClarifyGender('jeans', maleCategories)).toBe(false);
    
    const femaleCategories = ["Women's Dresses", 'Tops', 'Skirts'];
    expect(shouldClarifyGender('dress', femaleCategories)).toBe(false);
  });
  
  it('should clarify when categories span multiple genders', () => {
    const mixedCategories = ['Mens-jeans', 'Womens-jeans'];
    expect(shouldClarifyGender('jeans', mixedCategories)).toBe(true);
    
    const mixedTees = ['Mens-tees', 'Womens-tees'];
    expect(shouldClarifyGender('t-shirt', mixedTees)).toBe(true);
  });
  
  it('should NOT clarify when classified gender is provided', () => {
    const mixedCategories = ['Mens-jeans', 'Womens-jeans'];
    expect(shouldClarifyGender('jeans', mixedCategories, 'male')).toBe(false);
    expect(shouldClarifyGender('jeans', mixedCategories, 'female')).toBe(false);
  });
});

describe('resolveGender', () => {
  it('should prioritize classified gender', () => {
    const mixedCategories = ['Mens-jeans', 'Womens-jeans'];
    expect(resolveGender('jeans', mixedCategories, 'male')).toBe('male');
    expect(resolveGender('jeans', mixedCategories, 'female')).toBe('female');
  });
  
  it('should use detected gender if no classified gender', () => {
    const mixedCategories = ['Mens-jeans', 'Womens-jeans'];
    expect(resolveGender("men's jeans", mixedCategories)).toBe('male');
    expect(resolveGender("women's jeans", mixedCategories)).toBe('female');
  });
  
  it('should infer from categories when all same gender', () => {
    const maleCategories = ['Mens-jeans', 'Mens-tees'];
    expect(resolveGender('jeans', maleCategories)).toBe('male');
    
    const femaleCategories = ["Women's Dresses", 'Tops'];
    expect(resolveGender('dress', femaleCategories)).toBe('female');
  });
  
  it('should return null for ambiguous cases', () => {
    const mixedCategories = ['Mens-jeans', 'Womens-jeans'];
    expect(resolveGender('jeans', mixedCategories)).toBe(null);
  });
});
