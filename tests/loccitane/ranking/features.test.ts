/**
 * Tests for Ranking Features
 */

import { describe, it, expect } from 'vitest';
import { buildFeatures, type ProductWithLoccitaneAttributes } from '../../../src/lib/loccitane/ranking/features';
import type { QueryClassification } from '../../../src/lib/loccitane/classifier';

describe('buildFeatures', () => {
  const baseProduct: ProductWithLoccitaneAttributes = {
    id: 'prod1',
    title: 'Immortelle Reset Serum',
    description: 'Anti-aging serum with immortelle extract',
    imageUrl: 'https://example.com/image.jpg',
    productUrl: 'https://example.com/product',
    priceCents: 3500,
    salePriceCents: null,
    currency: 'USD',
    category: 'Face Care',
    stockStatus: 'in_stock',
    attributes: {
      loccitaneStructured: {
        concerns: ['Aging', 'Fine Lines'],
        skinTypes: ['Dry', 'Normal'],
        hairTypes: [],
        applicationAreas: ['Face'],
        productType: 'Serum',
        formula: null,
        featuredIngredients: ['Immortelle'],
        allIngredients: ['Immortelle', 'Hyaluronic Acid'],
        madeWithout: ['Paraben Free'],
        ageGroups: ['Adult'],
        genders: ['Unisex'],
        canonicalConcerns: ['aging'],
        canonicalIngredients: ['immortelle', 'hyaluronic acid'],
      },
      productHighlights: 'Anti-aging formula with immortelle extract',
      bulletHighlights: ['Reduces fine lines', 'Hydrating'],
    },
    shopifyBestseller: true,
    shopifySalesRank: 5,
  };
  
  describe('query-product match features', () => {
    it('should calculate lexical and semantic scores', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const features = buildFeatures(
        'immortelle serum',
        classification,
        baseProduct,
        { lexical: 0.8, semantic: 0.9 }
      );
      
      expect(features.lexicalScore).toBe(0.8);
      expect(features.semanticSimilarity).toBe(0.9);
    });
    
    it('should detect exact title match', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const features = buildFeatures(
        'Immortelle Reset Serum',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.exactTitleMatch).toBe(true);
    });
    
    it('should calculate title token overlap', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const features = buildFeatures(
        'immortelle serum reset',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      // Should have some overlap with "Immortelle Reset Serum"
      expect(features.titleTokenOverlap).toBeGreaterThan(0);
      expect(features.titleTokenOverlap).toBeLessThanOrEqual(1.0);
    });
    
    it('should calculate highlights token overlap', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const features = buildFeatures(
        'anti-aging hydrating',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      // Should overlap with highlights: "Anti-aging formula" and "Hydrating"
      expect(features.highlightsTokenOverlap).toBeGreaterThan(0);
    });
  });
  
  describe('attribute match features', () => {
    it('should calculate concerns overlap', () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          concerns: ['aging', 'dry_scalp'], // aging matches, dry_scalp doesn't
        },
      };
      
      const features = buildFeatures(
        'I have fine lines',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.concernsOverlap).toBe(1); // One match: aging
    });
    
    it('should calculate skin type match', () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          skinTypes: ['Dry'],
        },
      };
      
      const features = buildFeatures(
        'for dry skin',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.skinTypeMatch).toBe(1.0); // Matches "Dry"
    });
    
    it('should calculate application area match', () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          applicationAreas: ['Face'],
        },
      };
      
      const features = buildFeatures(
        'face product',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.applicationAreaMatch).toBe(1.0);
    });
    
    it('should calculate product type match', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {
          productTypes: ['Serum'],
        },
      };
      
      const features = buildFeatures(
        'serum',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.productTypeMatch).toBe(1.0);
    });
    
    it('should calculate ingredient match count', () => {
      const classification: QueryClassification = {
        type: 'ingredient_exploration',
        constraints: {
          mustHaveIngredients: ['immortelle', 'hyaluronic acid', 'retinol'],
        },
      };
      
      const features = buildFeatures(
        'immortelle hyaluronic acid',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.ingredientMatchCount).toBe(2); // immortelle and hyaluronic acid
    });
    
    it('should calculate madeWithout match count', () => {
      const classification: QueryClassification = {
        type: 'symptom_concern',
        constraints: {
          madeWithout: ['Paraben Free', 'Sulfate Free'],
        },
      };
      
      const features = buildFeatures(
        'paraben free',
        classification,
        baseProduct,
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.madeWithoutMatchCount).toBe(1); // Paraben Free matches
    });
  });
  
  describe('price & merch features', () => {
    it('should calculate price distance when in range', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {
          priceMinCents: 3000,
          priceMaxCents: 4000,
        },
      };
      
      const features = buildFeatures(
        'product under 40',
        classification,
        baseProduct, // price: 3500 cents (in range)
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.priceDistance).toBe(0.0); // In range
    });
    
    it('should calculate price distance when above range', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {
          priceMaxCents: 3000,
        },
      };
      
      const features = buildFeatures(
        'product under 30',
        classification,
        baseProduct, // price: 3500 cents (above range)
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.priceDistance).toBeGreaterThan(0); // Above range
    });
    
    it('should calculate popularity score from sales rank', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const features = buildFeatures(
        'product',
        classification,
        baseProduct, // rank 5
        { lexical: 0.5, semantic: 0.5 }
      );
      
      // Rank 5 should give high popularity (closer to 1.0)
      expect(features.popularityScore).toBeGreaterThan(0.9);
    });
    
    it('should set bestseller flag', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      const features = buildFeatures(
        'product',
        classification,
        baseProduct, // bestseller: true
        { lexical: 0.5, semantic: 0.5 }
      );
      
      expect(features.isBestseller).toBe(true);
    });
    
    it('should calculate inventory status', () => {
      const classification: QueryClassification = {
        type: 'direct_product_search',
        constraints: {},
      };
      
      // In stock
      const features1 = buildFeatures(
        'product',
        classification,
        baseProduct, // in_stock
        { lexical: 0.5, semantic: 0.5 }
      );
      expect(features1.inventoryStatus).toBe(1.0);
      
      // Low stock
      const features2 = buildFeatures(
        'product',
        classification,
        { ...baseProduct, stockStatus: 'low_stock' },
        { lexical: 0.5, semantic: 0.5 }
      );
      expect(features2.inventoryStatus).toBe(0.5);
      
      // Out of stock
      const features3 = buildFeatures(
        'product',
        classification,
        { ...baseProduct, stockStatus: 'out_of_stock' },
        { lexical: 0.5, semantic: 0.5 }
      );
      expect(features3.inventoryStatus).toBe(0.0);
    });
  });
});






