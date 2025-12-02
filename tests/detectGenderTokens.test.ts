import { describe, it, expect } from 'vitest';
import { detectGenderTokens } from '../src/lib/llm/orchestrator/utils';

describe('detectGenderTokens', () => {
  it('should extract "mens" from "beach wedding for men"', () => {
    const result = detectGenderTokens('beach wedding for men');
    expect(result).toEqual(['mens']);
  });

  it('should extract "womens" from "women\'s coats"', () => {
    const result = detectGenderTokens("women's coats");
    expect(result).toEqual(['womens']);
  });

  it('should extract "unisex" from "unisex tees"', () => {
    const result = detectGenderTokens('unisex tees');
    expect(result).toEqual(['unisex']);
  });

  it('should extract "mens" from "mens"', () => {
    const result = detectGenderTokens('mens');
    expect(result).toEqual(['mens']);
  });

  it('should extract "mens" from "male"', () => {
    const result = detectGenderTokens('male clothing');
    expect(result).toEqual(['mens']);
  });

  it('should extract "mens" from "boy"', () => {
    const result = detectGenderTokens('boy shirt');
    expect(result).toEqual(['mens']);
  });

  it('should extract "mens" from "guy"', () => {
    const result = detectGenderTokens('for guys');
    expect(result).toEqual(['mens']);
  });

  it('should extract "mens" from "him"', () => {
    const result = detectGenderTokens('shirt for him');
    expect(result).toEqual(['mens']);
  });

  it('should extract "womens" from "female"', () => {
    const result = detectGenderTokens('female clothing');
    expect(result).toEqual(['womens']);
  });

  it('should extract "womens" from "girl"', () => {
    const result = detectGenderTokens('girl dress');
    expect(result).toEqual(['womens']);
  });

  it('should extract "womens" from "lady"', () => {
    const result = detectGenderTokens('lady blazer');
    expect(result).toEqual(['womens']);
  });

  it('should extract "womens" from "her"', () => {
    const result = detectGenderTokens('shirt for her');
    expect(result).toEqual(['womens']);
  });

  it('should return ["unisex"] when both men and women appear', () => {
    const result = detectGenderTokens('shirts for men and women');
    expect(result).toEqual(['unisex']);
  });

  it('should return undefined for neutral text', () => {
    const result = detectGenderTokens('show me some shirts');
    expect(result).toBeUndefined();
  });

  it('should handle case insensitivity', () => {
    expect(detectGenderTokens('MEN')).toEqual(['mens']);
    expect(detectGenderTokens('WOMEN')).toEqual(['womens']);
    expect(detectGenderTokens('UNISEX')).toEqual(['unisex']);
  });
});


