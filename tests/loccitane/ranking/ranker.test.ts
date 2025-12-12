/**
 * Tests for Product Ranker
 */

import { describe, it, expect } from 'vitest';
import { scoreProduct, sortProductsByScore } from '../../../src/lib/loccitane/ranking/ranker';
import type { RankingFeatures } from '../../../src/lib/loccitane/ranking/features';
import type { ProductWithLoccitaneAttributes } from '../../../src/lib/loccitane/ranking/features';
import type { QueryClassification } from '../../../src/lib/loccitane/classifier';

describe('scoreProduct', () => {
  const baseFeatures: RankingFeatures = {
    lexicalScore: 0.5,
    semanticSimilarity: 0.5,
    exactTitleMatch: false,
    titleTokenOverlap: 0.5,
    highlightsTokenOverlap: 0.3,
    concernsOverlap: 0,
    skinTypeMatch: 0.0,
    applicationAreaMatch: 0.0,
    productTypeMatch: 0.0,
    ingredientMatchCount: 0,
    madeWithoutMatchCount: 0,
    priceDistance: 0.0,
    popularityScore: 0.5,
    isBestseller: false,
    inventoryStatus: 1.0,
  };
  
  describe('query type: symptom_concern', () => {
    it('should give higher score to products with matching concerns', () => {
      const noConcernFeatures: RankingFeatures = { ...baseFeatures };
      const withConcernFeatures: RankingFeatures = {
        ...baseFeatures,
        concernsOverlap: 2, // Two matching concerns
      };
      
      const scoreNoConcern = scoreProduct(noConcernFeatures, 'symptom_concern');
      const scoreWithConcern = scoreProduct(withConcernFeatures, 'symptom_concern');
      
      expect(scoreWithConcern).toBeGreaterThan(scoreNoConcern);
    });
    
    it('should give higher score to products with matching skin type', () => {
      const noSkinTypeFeatures: RankingFeatures = { ...baseFeatures };
      const withSkinTypeFeatures: RankingFeatures = {
        ...baseFeatures,
        skinTypeMatch: 1.0,
      };
      
      const scoreNoSkinType = scoreProduct(noSkinTypeFeatures, 'symptom_concern');
      const scoreWithSkinType = scoreProduct(withSkinTypeFeatures, 'symptom_concern');
      
      expect(scoreWithSkinType).toBeGreaterThan(scoreNoSkinType);
    });
  });
  
  describe('query type: ingredient_exploration', () => {
    it('should give higher score to products with matching ingredients', () => {
      const noIngredientFeatures: RankingFeatures = { ...baseFeatures };
      const withIngredientFeatures: RankingFeatures = {
        ...baseFeatures,
        ingredientMatchCount: 2, // Two matching ingredients
      };
      
      const scoreNoIngredient = scoreProduct(noIngredientFeatures, 'ingredient_exploration');
      const scoreWithIngredient = scoreProduct(withIngredientFeatures, 'ingredient_exploration');
      
      expect(scoreWithIngredient).toBeGreaterThan(scoreNoIngredient);
    });
  });
  
  describe('query type: direct_product_search', () => {
    it('should give higher score to products with exact title match', () => {
      const noTitleMatchFeatures: RankingFeatures = { ...baseFeatures };
      const titleMatchFeatures: RankingFeatures = {
        ...baseFeatures,
        exactTitleMatch: true,
      };
      
      const scoreNoMatch = scoreProduct(noTitleMatchFeatures, 'direct_product_search');
      const scoreWithMatch = scoreProduct(titleMatchFeatures, 'direct_product_search');
      
      expect(scoreWithMatch).toBeGreaterThan(scoreNoMatch);
    });
    
    it('should give higher score to products with product type match', () => {
      const noTypeMatchFeatures: RankingFeatures = { ...baseFeatures };
      const typeMatchFeatures: RankingFeatures = {
        ...baseFeatures,
        productTypeMatch: 1.0,
      };
      
      const scoreNoMatch = scoreProduct(noTypeMatchFeatures, 'direct_product_search');
      const scoreWithMatch = scoreProduct(typeMatchFeatures, 'direct_product_search');
      
      expect(scoreWithMatch).toBeGreaterThan(scoreNoMatch);
    });
  });
  
  describe('price distance penalty', () => {
    it('should penalize products outside budget range', () => {
      const inRangeFeatures: RankingFeatures = {
        ...baseFeatures,
        priceDistance: 0.0,
      };
      const outOfRangeFeatures: RankingFeatures = {
        ...baseFeatures,
        priceDistance: 0.5, // 50% of max distance
      };
      
      const scoreInRange = scoreProduct(inRangeFeatures, 'direct_product_search');
      const scoreOutOfRange = scoreProduct(outOfRangeFeatures, 'direct_product_search');
      
      expect(scoreInRange).toBeGreaterThan(scoreOutOfRange);
    });
  });
  
  describe('inventory status', () => {
    it('should prefer in-stock items over out-of-stock', () => {
      const inStockFeatures: RankingFeatures = {
        ...baseFeatures,
        inventoryStatus: 1.0,
      };
      const outOfStockFeatures: RankingFeatures = {
        ...baseFeatures,
        inventoryStatus: 0.0,
      };
      
      const scoreInStock = scoreProduct(inStockFeatures, 'direct_product_search');
      const scoreOutOfStock = scoreProduct(outOfStockFeatures, 'direct_product_search');
      
      expect(scoreInStock).toBeGreaterThan(scoreOutOfStock);
    });
  });
  
  describe('popularity boost', () => {
    it('should boost bestseller products', () => {
      const regularFeatures: RankingFeatures = {
        ...baseFeatures,
        isBestseller: false,
      };
      const bestsellerFeatures: RankingFeatures = {
        ...baseFeatures,
        isBestseller: true,
      };
      
      const scoreRegular = scoreProduct(regularFeatures, 'gift_or_vague');
      const scoreBestseller = scoreProduct(bestsellerFeatures, 'gift_or_vague');
      
      expect(scoreBestseller).toBeGreaterThan(scoreRegular);
    });
  });
});

describe('sortProductsByScore', () => {
  const baseProduct: ProductWithLoccitaneAttributes = {
    id: 'prod1',
    title: 'Product 1',
    description: 'Description 1',
    imageUrl: 'https://example.com/1.jpg',
    productUrl: 'https://example.com/product1',
    priceCents: 2000,
    salePriceCents: null,
    currency: 'USD',
    category: 'Face Care',
    stockStatus: 'in_stock',
    attributes: {
      loccitaneStructured: {
        concerns: ['Aging'],
        skinTypes: ['Dry'],
        hairTypes: [],
        applicationAreas: ['Face'],
        productType: 'Serum',
        formula: null,
        featuredIngredients: ['Immortelle'],
        allIngredients: ['Immortelle'],
        madeWithout: [],
        ageGroups: ['Adult'],
        genders: ['Unisex'],
        canonicalConcerns: ['aging'],
        canonicalIngredients: ['immortelle'],
      },
    },
  };
  
  it('should sort products by score (highest first)', () => {
    const classification: QueryClassification = {
      type: 'symptom_concern',
      constraints: {
        concerns: ['aging'],
      },
    };
    
    const products: ProductWithLoccitaneAttributes[] = [
      {
        ...baseProduct,
        id: 'prod-low',
        attributes: {
          loccitaneStructured: {
            ...baseProduct.attributes.loccitaneStructured,
            concerns: ['Dryness'], // No match
            canonicalConcerns: ['dryness'],
          },
        },
      },
      {
        ...baseProduct,
        id: 'prod-high',
        attributes: {
          loccitaneStructured: {
            ...baseProduct.attributes.loccitaneStructured,
            concerns: ['Aging', 'Fine Lines'], // Matches
            canonicalConcerns: ['aging', 'fine_lines'],
          },
        },
      },
    ];
    
    const lexicalScores = new Map<string, number>([
      ['prod-low', 0.5],
      ['prod-high', 0.5],
    ]);
    const semanticScores = new Map<string, number>([
      ['prod-low', 0.5],
      ['prod-high', 0.5],
    ]);
    
    const sorted = sortProductsByScore(
      'I have fine lines',
      classification,
      products,
      { lexicalScores, semanticScores }
    );
    
    // Higher scoring product (with concern match) should be first
    expect(sorted[0].id).toBe('prod-high');
  });
  
  it('should deduplicate by productUrl', () => {
    const classification: QueryClassification = {
      type: 'direct_product_search',
      constraints: {},
    };
    
    const products: ProductWithLoccitaneAttributes[] = [
      baseProduct,
      {
        ...baseProduct,
        id: 'prod2', // Different ID but same URL
      },
    ];
    
    const lexicalScores = new Map<string, number>([
      ['prod1', 0.5],
      ['prod2', 0.6],
    ]);
    const semanticScores = new Map<string, number>([
      ['prod1', 0.5],
      ['prod2', 0.6],
    ]);
    
    const sorted = sortProductsByScore(
      'product',
      classification,
      products,
      { lexicalScores, semanticScores }
    );
    
    // Should only have one product (deduplicated)
    expect(sorted.length).toBe(1);
    // Should keep the one with higher score (prod2)
    expect(sorted[0].id).toBe('prod2');
  });
});



