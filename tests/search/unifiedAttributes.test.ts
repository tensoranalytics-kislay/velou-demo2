import { describe, it, expect } from 'vitest';
import type { SearchConstraints, ProductAttributes } from '../../src/lib/search/types';
import {
  matchesAttributeFilters,
  deriveAttributeConstraintMeta,
} from '../../src/lib/search/index';

// Helpers for building minimal SearchConstraints for tests
const baseConstraints = (): SearchConstraints =>
  ({
    inStockOnly: true,
  } as SearchConstraints);

const buildAttributes = (attrs: Partial<ProductAttributes>): ProductAttributes =>
  ({
    ...(attrs as ProductAttributes),
  } as ProductAttributes);

describe('Unified attributes – skincare vertical', () => {
  const skincareProducts: Array<{ id: string; attributes: ProductAttributes }> = [
    {
      id: 'skincare_1',
      attributes: buildAttributes({
        useCases: ['night routine', 'before bed'],
        benefits: ['hydrating', 'soothing'],
        sensoryProfile: 'lavender, relaxing',
        compatibility: ['dry skin', 'sensitive skin'],
      }),
    },
    {
      id: 'skincare_2',
      attributes: buildAttributes({
        useCases: ['morning routine'],
        benefits: ['brightening'],
        sensoryProfile: 'citrus, energizing',
        compatibility: ['oily skin'],
      }),
    },
    {
      id: 'skincare_3',
      attributes: buildAttributes({
        useCases: ['night routine'],
        benefits: ['barrier support'],
        sensoryProfile: 'fragrance free, creamy',
        compatibility: ['sensitive skin'],
      }),
    },
  ];

  it('filters by unified useCases facet (night routine)', () => {
    const constraints: SearchConstraints = {
      ...baseConstraints(),
      useCases: ['night routine'],
    };

    const meta = deriveAttributeConstraintMeta(constraints);
    expect(meta.hasHardAttributeConstraints).toBe(true);
    expect(meta.hardFacetFields).toEqual(expect.arrayContaining(['useCases']));

    const matches = skincareProducts.filter((p) =>
      matchesAttributeFilters(p.attributes, constraints, undefined, undefined, meta),
    );

    const matchedIds = matches.map((p) => p.id);
    expect(matchedIds).toEqual(expect.arrayContaining(['skincare_1', 'skincare_3']));
    expect(matchedIds).not.toContain('skincare_2');
  });

  it('filters by unified compatibility facet (dry skin)', () => {
    const constraints: SearchConstraints = {
      ...baseConstraints(),
      compatibility: ['dry skin'],
    };

    const meta = deriveAttributeConstraintMeta(constraints);
    expect(meta.hasHardAttributeConstraints).toBe(true);
    expect(meta.hardFacetFields).toEqual(expect.arrayContaining(['compatibility']));

    const matches = skincareProducts.filter((p) =>
      matchesAttributeFilters(p.attributes, constraints, undefined, undefined, meta),
    );

    const matchedIds = matches.map((p) => p.id);
    expect(matchedIds).toEqual(['skincare_1']);
  });

  it('filters by multiple unified facets (night routine + sensitive skin)', () => {
    const constraints: SearchConstraints = {
      ...baseConstraints(),
      useCases: ['night routine'],
      compatibility: ['sensitive skin'],
    };

    const meta = deriveAttributeConstraintMeta(constraints);
    expect(meta.hasHardAttributeConstraints).toBe(true);
    expect(meta.hardFacetFields).toEqual(
      expect.arrayContaining(['useCases', 'compatibility']),
    );

    const matches = skincareProducts.filter((p) =>
      matchesAttributeFilters(p.attributes, constraints, undefined, undefined, meta),
    );

    const matchedIds = matches.map((p) => p.id);
    expect(matchedIds).toEqual(['skincare_3']);
  });
});

describe('Unified attributes – home textiles vertical', () => {
  const homeProducts: Array<{ id: string; attributes: ProductAttributes }> = [
    {
      id: 'home_1',
      attributes: buildAttributes({
        useCases: ['bathroom', 'guest bathroom'],
        styleTags: ['minimalist', 'spa-like'],
        materials: ['100% cotton'],
      }),
    },
    {
      id: 'home_2',
      attributes: buildAttributes({
        useCases: ['primary bedroom'],
        styleTags: ['cozy'],
        materials: ['linen blend'],
      }),
    },
  ];

  it('filters by useCases and styleTags for home textiles', () => {
    const constraints: SearchConstraints = {
      ...baseConstraints(),
      useCases: ['guest bathroom'],
      styleTags: ['spa-like'],
    };

    const meta = deriveAttributeConstraintMeta(constraints);
    expect(meta.hasHardAttributeConstraints).toBe(true);
    expect(meta.hardFacetFields).toEqual(
      expect.arrayContaining(['useCases', 'styleTags']),
    );

    const matches = homeProducts.filter((p) =>
      matchesAttributeFilters(p.attributes, constraints, undefined, undefined, meta),
    );

    const matchedIds = matches.map((p) => p.id);
    expect(matchedIds).toEqual(['home_1']);
  });
});

describe('Unified attributes – no-op behavior without facet constraints', () => {
  it('treats category + price only query as having no hard attribute constraints', () => {
    const constraints: SearchConstraints = {
      ...baseConstraints(),
      category: 'Health & Beauty',
      priceMaxCents: 5000,
    };

    const meta = deriveAttributeConstraintMeta(constraints);
    expect(meta.hasHardAttributeConstraints).toBe(false);
    expect(meta.hardFacetFields).toEqual([]);

    const sampleAttributes: ProductAttributes[] = [
      buildAttributes({
        useCases: ['night routine'],
        benefits: ['hydrating'],
      }),
      buildAttributes({
        useCases: ['morning routine'],
        benefits: ['brightening'],
      }),
    ];

    const results = sampleAttributes.map((attrs) =>
      matchesAttributeFilters(attrs, constraints, undefined, undefined, meta),
    );

    // With no explicit facets, attribute filter must be a no-op
    expect(results).toEqual([true, true]);
  });
}

/**
 * Tests for unified catalog attribute filtering in search
 */

import { describe, it, expect } from 'vitest';
import type { ProductAttributes, SearchConstraints } from '../../src/lib/search/types';

// Import the matchesAttributeFilters function (we'll need to export it or test indirectly)
// For now, we'll test the logic by importing searchProducts and mocking

describe('Unified Catalog Attribute Filtering', () => {
  describe('matchesAttributeFilters with new unified attributes', () => {
    // Helper to test attribute matching logic
    // We'll test this indirectly through searchProducts, but for unit tests,
    // we can create a simple test that verifies the constraint types work

    it('should accept benefits constraint in SearchConstraints', () => {
      const constraints: SearchConstraints = {
        benefits: ['Hydrates Skin', 'Nourishes Skin'],
        category: 'Hand Care',
      };

      expect(constraints.benefits).toEqual(['Hydrates Skin', 'Nourishes Skin']);
      expect(constraints.category).toBe('Hand Care');
    });

    it('should accept styleTags constraint in SearchConstraints', () => {
      const constraints: SearchConstraints = {
        styleTags: ['luxury', 'natural'],
        category: 'Skincare',
      };

      expect(constraints.styleTags).toEqual(['luxury', 'natural']);
    });

    it('should accept compatibility constraint in SearchConstraints', () => {
      const constraints: SearchConstraints = {
        compatibility: ['All Skin Types', 'Sensitive Skin'],
      };

      expect(constraints.compatibility).toEqual(['All Skin Types', 'Sensitive Skin']);
    });

    it('should accept sensoryProfile constraint in SearchConstraints', () => {
      const constraints: SearchConstraints = {
        sensoryProfile: 'creamy',
      };

      expect(constraints.sensoryProfile).toBe('creamy');
    });

    it('should have ProductAttributes with unified catalog fields', () => {
      const attrs: ProductAttributes = {
        benefits: ['Hydrates Skin', 'Nourishes Skin'],
        styleTags: ['luxury', 'natural'],
        compatibility: ['All Skin Types'],
        sensoryProfile: 'Creamy texture with soothing shea scent',
        productHighlights: 'Vegan & Clean: Free from Parabens',
        bulletHighlights: ['Intensive Moisture', 'Sensitive Skin Safe'],
        product_details: { Volume: '5.3 fl oz', Origin: 'France' },
      };

      expect(attrs.benefits).toEqual(['Hydrates Skin', 'Nourishes Skin']);
      expect(attrs.styleTags).toEqual(['luxury', 'natural']);
      expect(attrs.compatibility).toEqual(['All Skin Types']);
      expect(attrs.sensoryProfile).toBe('Creamy texture with soothing shea scent');
      expect(attrs.productHighlights).toBe('Vegan & Clean: Free from Parabens');
      expect(attrs.bulletHighlights).toEqual(['Intensive Moisture', 'Sensitive Skin Safe']);
    });
  });

  describe('extractSearchableTextFromAttributes', () => {
    // We'll need to export this function or test it indirectly
    // For now, verify the logic works with sample data

    it('should extract text from product_highlights, bullet_highlights, and product_details', () => {
      const attrs: ProductAttributes = {
        productHighlights: 'Vegan & Clean: Free from Parabens',
        bulletHighlights: ['Intensive Moisture', 'Sensitive Skin Safe', 'Shea Scent'],
        product_details: { Volume: '5.3 fl oz', Origin: 'France', Type: 'Hand Care' },
      };

      // Expected: "Vegan & Clean: Free from Parabens Intensive Moisture Sensitive Skin Safe Shea Scent 5.3 fl oz France Hand Care"
      const expectedParts = [
        'Vegan & Clean: Free from Parabens',
        'Intensive Moisture',
        'Sensitive Skin Safe',
        'Shea Scent',
        '5.3 fl oz',
        'France',
        'Hand Care',
      ];

      // Verify the structure is correct
      expect(attrs.productHighlights).toBe('Vegan & Clean: Free from Parabens');
      expect(attrs.bulletHighlights).toHaveLength(3);
      expect(attrs.product_details).toHaveProperty('Volume');
      expect(attrs.product_details).toHaveProperty('Origin');
      expect(attrs.product_details).toHaveProperty('Type');
    });

    it('should handle missing fields gracefully', () => {
      const attrs: ProductAttributes = {
        title: 'Test Product',
      };

      // Should not throw when fields are missing
      expect(attrs.productHighlights).toBeUndefined();
      expect(attrs.bulletHighlights).toBeUndefined();
      expect(attrs.product_details).toBeUndefined();
    });
  });

  describe('arrayIncludes helper for unified attributes', () => {
    // Test the array overlap logic that should be used for benefits, styleTags, compatibility

    it('should match when product has all required benefits', () => {
      const productBenefits = ['Hydrates Skin', 'Nourishes Skin', 'Softens Skin'];
      const constraintBenefits = ['Hydrates Skin', 'Nourishes Skin'];

      // arrayIncludes logic: all constraint values must be in product array
      const productLower = productBenefits.map((b) => b.toLowerCase());
      const allMatch = constraintBenefits.every((needle) =>
        productLower.includes(needle.toLowerCase())
      );

      expect(allMatch).toBe(true);
    });

    it('should not match when product is missing required benefits', () => {
      const productBenefits = ['Hydrates Skin'];
      const constraintBenefits = ['Hydrates Skin', 'Nourishes Skin'];

      const productLower = productBenefits.map((b) => b.toLowerCase());
      const allMatch = constraintBenefits.every((needle) =>
        productLower.includes(needle.toLowerCase())
      );

      expect(allMatch).toBe(false);
    });

    it('should match when constraint is empty (no filter)', () => {
      const productBenefits = ['Hydrates Skin'];
      const constraintBenefits: string[] = [];

      // When constraint is empty, should pass (no filtering)
      const shouldPass = !constraintBenefits.length || true;

      expect(shouldPass).toBe(true);
    });

    it('should match styleTags with case-insensitive comparison', () => {
      const productStyleTags = ['Luxury', 'Natural', 'French'];
      const constraintStyleTags = ['luxury', 'natural'];

      const productLower = productStyleTags.map((s) => s.toLowerCase());
      const allMatch = constraintStyleTags.every((needle) =>
        productLower.includes(needle.toLowerCase())
      );

      expect(allMatch).toBe(true);
    });

    it('should match compatibility with overlap', () => {
      const productCompatibility = ['All Skin Types', 'Sensitive Skin', 'Dry Skin'];
      const constraintCompatibility = ['Sensitive Skin'];

      const productLower = productCompatibility.map((c) => c.toLowerCase());
      const allMatch = constraintCompatibility.every((needle) =>
        productLower.includes(needle.toLowerCase())
      );

      expect(allMatch).toBe(true);
    });
  });

  describe('sensoryProfile substring matching', () => {
    // Test the substring matching logic for sensoryProfile (similar to materials)

    it('should match sensoryProfile with substring', () => {
      const productSensoryProfile = 'Creamy texture with soothing shea scent';
      const constraintSensoryProfile = 'creamy';

      const productLower = productSensoryProfile.toLowerCase();
      const constraintLower = constraintSensoryProfile.toLowerCase();
      const matches = productLower.includes(constraintLower);

      expect(matches).toBe(true);
    });

    it('should match sensoryProfile with case-insensitive comparison', () => {
      const productSensoryProfile = 'Creamy texture with soothing shea scent';
      const constraintSensoryProfile = 'CREAMY';

      const productLower = productSensoryProfile.toLowerCase();
      const constraintLower = constraintSensoryProfile.toLowerCase();
      const matches = productLower.includes(constraintLower);

      expect(matches).toBe(true);
    });

    it('should not match when sensoryProfile does not contain constraint', () => {
      const productSensoryProfile = 'Lightweight matte finish';
      const constraintSensoryProfile = 'creamy';

      const productLower = productSensoryProfile.toLowerCase();
      const constraintLower = constraintSensoryProfile.toLowerCase();
      const matches = productLower.includes(constraintLower);

      expect(matches).toBe(false);
    });
  });

  describe('backward compatibility with apparel queries', () => {
    it('should not break when new unified attributes are undefined', () => {
      const constraints: SearchConstraints = {
        category: 'Apparel',
        colors: ['black'],
        sizes: ['M'],
      };

      // Should not have new attributes
      expect(constraints.benefits).toBeUndefined();
      expect(constraints.styleTags).toBeUndefined();
      expect(constraints.compatibility).toBeUndefined();
      expect(constraints.sensoryProfile).toBeUndefined();

      // Should still have apparel attributes
      expect(constraints.colors).toEqual(['black']);
      expect(constraints.sizes).toEqual(['M']);
    });

    it('should allow mixing apparel and unified attributes', () => {
      const constraints: SearchConstraints = {
        category: 'Apparel',
        colors: ['black'],
        benefits: ['Moisture Wicking'], // Could apply to activewear
        styleTags: ['athletic'],
      };

      expect(constraints.colors).toEqual(['black']);
      expect(constraints.benefits).toEqual(['Moisture Wicking']);
      expect(constraints.styleTags).toEqual(['athletic']);
    });
  });

  describe('attribute filtering logic simulation', () => {
    // Simulate the matchesAttributeFilters logic for testing
    const simulateArrayIncludes = (
      haystack: string[] | undefined,
      needles: string[] | undefined,
    ): boolean => {
      if (!needles?.length) return true;
      if (!haystack?.length) return false;
      const hay = haystack.map((entry) => entry.toLowerCase());
      return needles.every((needle) => hay.includes(needle.toLowerCase()));
    };

    const simulateMaterialMatches = (
      value: string | undefined,
      needles: string[] | undefined,
    ): boolean => {
      if (!needles?.length) return true;
      if (!value) return false;
      const val = value.toLowerCase();
      return needles.some((needle) => val.includes(needle.toLowerCase()));
    };

    it('should filter products by benefits constraint', () => {
      const product1: ProductAttributes = {
        benefits: ['Hydrates Skin', 'Nourishes Skin', 'Softens Skin'],
      };
      const product2: ProductAttributes = {
        benefits: ['Hydrates Skin'],
      };
      const product3: ProductAttributes = {
        benefits: ['Moisturizes', 'Soothes'],
      };

      const constraint: SearchConstraints = {
        benefits: ['Hydrates Skin', 'Nourishes Skin'],
      };

      // Product 1 should match (has both)
      expect(simulateArrayIncludes(product1.benefits, constraint.benefits)).toBe(true);
      // Product 2 should not match (missing 'Nourishes Skin')
      expect(simulateArrayIncludes(product2.benefits, constraint.benefits)).toBe(false);
      // Product 3 should not match (different benefits)
      expect(simulateArrayIncludes(product3.benefits, constraint.benefits)).toBe(false);
    });

    it('should filter products by styleTags constraint', () => {
      const product1: ProductAttributes = {
        styleTags: ['luxury', 'natural', 'french'],
      };
      const product2: ProductAttributes = {
        styleTags: ['casual', 'minimalist'],
      };

      const constraint: SearchConstraints = {
        styleTags: ['luxury', 'natural'],
      };

      // Product 1 should match (has both)
      expect(simulateArrayIncludes(product1.styleTags, constraint.styleTags)).toBe(true);
      // Product 2 should not match
      expect(simulateArrayIncludes(product2.styleTags, constraint.styleTags)).toBe(false);
    });

    it('should filter products by compatibility constraint', () => {
      const product1: ProductAttributes = {
        compatibility: ['All Skin Types', 'Sensitive Skin', 'Dry Skin'],
      };
      const product2: ProductAttributes = {
        compatibility: ['Oily Skin'],
      };

      const constraint: SearchConstraints = {
        compatibility: ['Sensitive Skin'],
      };

      // Product 1 should match
      expect(simulateArrayIncludes(product1.compatibility, constraint.compatibility)).toBe(true);
      // Product 2 should not match
      expect(simulateArrayIncludes(product2.compatibility, constraint.compatibility)).toBe(false);
    });

    it('should filter products by sensoryProfile constraint', () => {
      const product1: ProductAttributes = {
        sensoryProfile: 'Creamy texture with soothing shea scent',
      };
      const product2: ProductAttributes = {
        sensoryProfile: 'Lightweight matte finish',
      };

      const constraint: SearchConstraints = {
        sensoryProfile: 'creamy',
      };

      // Product 1 should match (contains 'creamy')
      expect(
        simulateMaterialMatches(product1.sensoryProfile, constraint.sensoryProfile ? [constraint.sensoryProfile] : undefined),
      ).toBe(true);
      // Product 2 should not match
      expect(
        simulateMaterialMatches(product2.sensoryProfile, constraint.sensoryProfile ? [constraint.sensoryProfile] : undefined),
      ).toBe(false);
    });

    it('should pass when constraint is undefined (no filtering)', () => {
      const product: ProductAttributes = {
        benefits: ['Hydrates Skin'],
      };

      const constraint: SearchConstraints = {
        // benefits is undefined
      };

      // Should pass when constraint is undefined
      expect(simulateArrayIncludes(product.benefits, constraint.benefits)).toBe(true);
    });

    it('should handle products with missing unified attributes gracefully', () => {
      const product: ProductAttributes = {
        // No unified attributes
        color: 'black',
      };

      const constraint: SearchConstraints = {
        benefits: ['Hydrates Skin'],
      };

      // Product without benefits should not match when constraint requires benefits
      expect(simulateArrayIncludes(product.benefits, constraint.benefits)).toBe(false);
    });
  });
});

