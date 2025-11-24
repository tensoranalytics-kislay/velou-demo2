import { describe, it, expect } from 'vitest';
import { detectGenderTokens } from '../src/lib/llm/orchestrator/utils';

describe('detectGenderTokens (extractGenderFromText)', () => {
  it('should extract "mens" from "show me blazers for men"', () => {
    const result = detectGenderTokens('show me blazers for men');
    expect(result).toEqual(['mens']);
  });

  it('should extract "womens" from "women\'s beach dress"', () => {
    const result = detectGenderTokens("women's beach dress");
    expect(result).toEqual(['womens']);
  });

  it('should extract "unisex" from "unisex hoodie"', () => {
    const result = detectGenderTokens('unisex hoodie');
    expect(result).toEqual(['unisex']);
  });

  it('should extract "mens" from "for guys"', () => {
    const result = detectGenderTokens('for guys');
    expect(result).toEqual(['mens']);
  });

  it('should handle negation: "not for men, for women" → ["womens"]', () => {
    const result = detectGenderTokens('not for men, for women');
    expect(result).toEqual(['womens']);
  });

  it('should return undefined for neutral text', () => {
    const result = detectGenderTokens('show me some shirts');
    expect(result).toBeUndefined();
  });

  it('should extract "mens" from "mens"', () => {
    const result = detectGenderTokens('mens');
    expect(result).toEqual(['mens']);
  });

  it('should extract "womens" from "womens"', () => {
    const result = detectGenderTokens('womens');
    expect(result).toEqual(['womens']);
  });

  it('should extract "mens" from "male"', () => {
    const result = detectGenderTokens('male clothing');
    expect(result).toEqual(['mens']);
  });

  it('should extract "womens" from "female"', () => {
    const result = detectGenderTokens('female clothing');
    expect(result).toEqual(['womens']);
  });

  it('should extract "womens" from "ladies"', () => {
    const result = detectGenderTokens('ladies dress');
    expect(result).toEqual(['womens']);
  });

  it('should extract "mens" from "gents"', () => {
    const result = detectGenderTokens('gents shirt');
    expect(result).toEqual(['mens']);
  });
});

