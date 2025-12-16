/**
 * Tests for L'Occitane Attribute Parser
 * 
 * Tests parsing of velou_attribute:Key:Value entries into structured attributes.
 */

import { describe, it, expect } from 'vitest';
import { parseLoccitaneAttributes, type StructuredLoccitaneAttributes } from '../../src/lib/loccitane/attributeParser';

describe('parseLoccitaneAttributes', () => {
  describe('with string[] input (raw product_details)', () => {
    it('should parse concerns correctly', () => {
      const productDetails = [
        'velou_attribute:Concern:Dryness',
        'velou_attribute:Concern:Rough Texture',
        'velou_attribute:Concern:Sensitive Skin',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.concerns).toEqual(['Dryness', 'Rough Texture', 'Sensitive Skin']);
      expect(result.canonicalConcerns).toContain('dryness');
      expect(result.canonicalConcerns).toContain('rough_texture');
      expect(result.canonicalConcerns).toContain('sensitive_skin');
    });
    
    it('should parse skin types correctly', () => {
      const productDetails = [
        'velou_attribute:Skin Type:Dry',
        'velou_attribute:Skin Type:Sensitive',
        'velou_attribute:Skin Type:All Skin Types',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.skinTypes).toEqual(['Dry', 'Sensitive', 'All Skin Types']);
    });
    
    it('should parse hair types correctly', () => {
      const productDetails = [
        'velou_attribute:Hair Type:All Hair Types',
        'velou_attribute:Hair Type:Fine',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.hairTypes).toEqual(['All Hair Types', 'Fine']);
    });
    
    it('should parse application areas correctly', () => {
      const productDetails = [
        'velou_attribute:Application Area:Scalp',
        'velou_attribute:Application Area:Body',
        'velou_attribute:Application Area:Face',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.applicationAreas).toEqual(['Scalp', 'Body', 'Face']);
    });
    
    it('should parse product type and formula', () => {
      const productDetails = [
        'velou_attribute:Type:Body Care',
        'velou_attribute:Type:Scalp Treatment',
        'velou_attribute:Formula:Serum',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      // Should prefer longer/more specific type
      expect(result.productType).toBe('Scalp Treatment');
      expect(result.formula).toBe('Serum');
    });
    
    it('should parse featured ingredients correctly', () => {
      const productDetails = [
        'velou_attribute:Featured Ingredients:Sweet Almond Oil',
        'velou_attribute:Featured Ingredients:Crushed Almond Shell',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.featuredIngredients).toEqual([
        'Sweet Almond Oil',
        'Crushed Almond Shell',
      ]);
      expect(result.canonicalIngredients).toContain('almond_oil');
      expect(result.canonicalIngredients).toContain('crushed_almond_shell');
    });
    
    it('should parse all ingredients correctly', () => {
      const productDetails = [
        'velou_attribute:Ingredients:Water',
        'velou_attribute:Ingredients:Niacinamide',
        'velou_attribute:Ingredients:Panthenol',
        'velou_attribute:Ingredients:Vitamin E',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.allIngredients.length).toBeGreaterThanOrEqual(4);
      expect(result.allIngredients).toContain('Water');
      expect(result.allIngredients).toContain('Niacinamide');
      expect(result.allIngredients).toContain('Panthenol');
      expect(result.allIngredients).toContain('Vitamin E');
      expect(result.canonicalIngredients).toContain('niacinamide');
      expect(result.canonicalIngredients).toContain('panthenol');
      expect(result.canonicalIngredients).toContain('vitamin_e');
    });
    
    it('should parse made without correctly', () => {
      const productDetails = [
        'velou_attribute:Made Without:Paraben Free',
        'velou_attribute:Made Without:Sulfate Free',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.madeWithout).toEqual(['Paraben Free', 'Sulfate Free']);
    });
    
    it('should parse age groups and gender correctly', () => {
      const productDetails = [
        'velou_attribute:Age Group:Adult',
        'velou_attribute:Gender:Unisex',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.ageGroups).toEqual(['Adult']);
      expect(result.genders).toEqual(['Unisex']);
    });
    
    it('should handle real-world L\'Occitane product data', () => {
      // Based on actual CSV row
      const productDetails = [
        'velou_attribute:Skin Type:All Skin Types',
        'velou_attribute:Concern:Rough Texture',
        'velou_attribute:Concern:Dryness',
        'velou_attribute:Featured Ingredients:Sweet Almond Oil',
        'velou_attribute:Featured Ingredients:Crushed Almond Shell',
        'velou_attribute:Type:Body Care',
        'velou_attribute:Formula:Scrub',
        'velou_attribute:Application Area:Body',
        'velou_attribute:Made Without:Paraben Free',
        'velou_attribute:Made Without:Sulfate Free',
        'velou_attribute:Age Group:Adult',
        'velou_attribute:Gender:Unisex',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.skinTypes).toEqual(['All Skin Types']);
      expect(result.concerns).toContain('Rough Texture');
      expect(result.concerns).toContain('Dryness');
      expect(result.featuredIngredients).toContain('Sweet Almond Oil');
      expect(result.featuredIngredients).toContain('Crushed Almond Shell');
      expect(result.productType).toBe('Body Care');
      expect(result.formula).toBe('Scrub');
      expect(result.applicationAreas).toEqual(['Body']);
      expect(result.madeWithout).toContain('Paraben Free');
      expect(result.madeWithout).toContain('Sulfate Free');
      expect(result.ageGroups).toEqual(['Adult']);
      expect(result.genders).toEqual(['Unisex']);
      
      // Check canonicalization
      expect(result.canonicalConcerns).toContain('rough_texture');
      expect(result.canonicalConcerns).toContain('dryness');
      expect(result.canonicalIngredients).toContain('almond_oil');
    });
    
    it('should handle scalp treatment product correctly', () => {
      // Based on actual CSV row for scalp serum
      const productDetails = [
        'velou_attribute:Type:Scalp Treatment',
        'velou_attribute:Formula:Serum',
        'velou_attribute:Concern:Dullness',
        'velou_attribute:Concern:Scalp Discomfort',
        'velou_attribute:Hair Type:All Hair Types',
        'velou_attribute:Featured Ingredients:Niacin',
        'velou_attribute:Featured Ingredients:Vitamin B5',
        'velou_attribute:Featured Ingredients:Vitamin E',
        'velou_attribute:Featured Ingredients:Lavender Essential Oil',
        'velou_attribute:Made Without:Paraben Free',
        'velou_attribute:Made Without:Sulfate Free',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.productType).toBe('Scalp Treatment');
      expect(result.formula).toBe('Serum');
      expect(result.concerns).toContain('Dullness');
      expect(result.concerns).toContain('Scalp Discomfort');
      expect(result.hairTypes).toEqual(['All Hair Types']);
      expect(result.featuredIngredients).toContain('Niacin');
      expect(result.featuredIngredients).toContain('Vitamin B5');
      expect(result.featuredIngredients).toContain('Vitamin E');
      expect(result.featuredIngredients).toContain('Lavender Essential Oil');
      expect(result.madeWithout).toContain('Paraben Free');
      expect(result.madeWithout).toContain('Sulfate Free');
      
      // Check canonicalization - "Scalp Discomfort" should map to "dry_scalp"
      expect(result.canonicalConcerns).toContain('dry_scalp');
      expect(result.canonicalConcerns).toContain('dullness');
    });
  });
  
  describe('with Record<string, string> input (parsed product_details)', () => {
    it('should parse from already-parsed object format', () => {
      const productDetails: Record<string, string> = {
        'Concern': 'Dryness',
        'Skin Type': 'Sensitive',
        'Type': 'Body Care',
        'Formula': 'Cream',
      };
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.concerns).toEqual(['Dryness']);
      expect(result.skinTypes).toEqual(['Sensitive']);
      expect(result.productType).toBe('Body Care');
      expect(result.formula).toBe('Cream');
    });
  });
  
  describe('canonicalization', () => {
    it('should canonicalize concern variants correctly', () => {
      const testCases = [
        { input: 'Dryness', expected: 'dryness' },
        { input: 'dry', expected: 'dryness' },
        { input: 'Dry Scalp', expected: 'dry_scalp' },
        { input: 'Scalp Discomfort', expected: 'dry_scalp' },
        { input: 'Dandruff', expected: 'dry_scalp' },
        { input: 'Aging', expected: 'aging' },
        { input: 'Fine Lines', expected: 'aging' },
        { input: 'Wrinkles', expected: 'aging' },
        { input: 'Sensitive Skin', expected: 'sensitive_skin' },
        { input: 'Rough Texture', expected: 'rough_texture' },
      ];
      
      for (const { input, expected } of testCases) {
        const productDetails = [`velou_attribute:Concern:${input}`];
        const result = parseLoccitaneAttributes(productDetails);
        expect(result.canonicalConcerns).toContain(expected);
      }
    });
    
    it('should canonicalize ingredient variants correctly', () => {
      const testCases = [
        { input: 'Shea Butter', expected: 'shea_butter' },
        { input: 'Shea', expected: 'shea_butter' },
        { input: 'Sweet Almond Oil', expected: 'almond_oil' },
        { input: 'Almond Oil', expected: 'almond_oil' },
        { input: 'Niacinamide', expected: 'niacinamide' },
        { input: 'Vitamin B3', expected: 'niacinamide' },
        { input: 'Panthenol', expected: 'panthenol' },
        { input: 'Vitamin B5', expected: 'panthenol' },
        { input: 'Vitamin E', expected: 'vitamin_e' },
      ];
      
      for (const { input, expected } of testCases) {
        const productDetails = [`velou_attribute:Ingredients:${input}`];
        const result = parseLoccitaneAttributes(productDetails);
        expect(result.canonicalIngredients).toContain(expected);
      }
    });
  });
  
  describe('edge cases', () => {
    it('should handle empty input gracefully', () => {
      const result = parseLoccitaneAttributes(null);
      expect(result.concerns).toEqual([]);
      expect(result.skinTypes).toEqual([]);
      expect(result.productType).toBeNull();
    });
    
    it('should handle undefined input gracefully', () => {
      const result = parseLoccitaneAttributes(undefined);
      expect(result.concerns).toEqual([]);
      expect(result.skinTypes).toEqual([]);
    });
    
    it('should handle empty array input', () => {
      const result = parseLoccitaneAttributes([]);
      expect(result.concerns).toEqual([]);
      expect(result.skinTypes).toEqual([]);
    });
    
    it('should ignore unknown keys gracefully', () => {
      const productDetails = [
        'velou_attribute:Unknown Key:Some Value',
        'velou_attribute:Concern:Dryness',
        'velou_attribute:Random Field:Random Value',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      // Should still parse known keys
      expect(result.concerns).toEqual(['Dryness']);
      // Unknown keys should not cause errors
      expect(result.concerns.length).toBe(1);
    });
    
    it('should handle malformed entries gracefully', () => {
      const productDetails = [
        'not_a_velou_attribute',
        'velou_attribute:Concern:Dryness',
        'velou_attribute:no_colon_here',
        'velou_attribute:Concern:', // Empty value
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      // Should still parse valid entries
      expect(result.concerns).toEqual(['Dryness']);
    });
    
    it('should handle case-insensitive key matching', () => {
      const productDetails = [
        'velou_attribute:concern:Dryness',
        'velou_attribute:SKIN TYPE:Sensitive',
        'velou_attribute:Application Area:Body',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.concerns).toEqual(['Dryness']);
      expect(result.skinTypes).toEqual(['Sensitive']);
      expect(result.applicationAreas).toEqual(['Body']);
    });
    
    it('should handle ingredients with comma/pipe separators', () => {
      const productDetails = [
        'velou_attribute:Featured Ingredients:Sweet Almond Oil,Crushed Almond Shell',
        'velou_attribute:Ingredients:Water|Glycerin|Niacinamide',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.featuredIngredients).toContain('Sweet Almond Oil');
      expect(result.featuredIngredients).toContain('Crushed Almond Shell');
      expect(result.allIngredients).toContain('Water');
      expect(result.allIngredients).toContain('Glycerin');
      expect(result.allIngredients).toContain('Niacinamide');
    });
    
    it('should handle made without with multiple values', () => {
      const productDetails = [
        'velou_attribute:Made Without:Paraben Free,Sulfate Free,Silicone Free',
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.madeWithout).toContain('Paraben Free');
      expect(result.madeWithout).toContain('Sulfate Free');
      expect(result.madeWithout).toContain('Silicone Free');
    });
    
    it('should deduplicate values in arrays', () => {
      const productDetails = [
        'velou_attribute:Concern:Dryness',
        'velou_attribute:Concern:Dryness', // Duplicate
        'velou_attribute:Skin Type:Sensitive',
        'velou_attribute:Skin Type:Sensitive', // Duplicate
      ];
      
      const result = parseLoccitaneAttributes(productDetails);
      
      expect(result.concerns).toEqual(['Dryness']); // Should not have duplicates
      expect(result.skinTypes).toEqual(['Sensitive']); // Should not have duplicates
    });
  });
  
  describe('integration with existing attributes', () => {
    it('should accept existing attributes as optional parameter', () => {
      const productDetails = ['velou_attribute:Concern:Dryness'];
      const existingAttrs = {
        collection: 'Shea',
        benefits: ['Moisturizing'],
      };
      
      const result = parseLoccitaneAttributes(productDetails, existingAttrs);
      
      // Should still parse correctly
      expect(result.concerns).toEqual(['Dryness']);
    });
  });
});






