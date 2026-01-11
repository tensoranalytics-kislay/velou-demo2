/**
 * Unit tests for constraint matcher with intent-based weighting
 */

import { describe, it, expect } from 'vitest';
import {
  getIntentWeight,
  calculateConstraintMatchScore,
} from './constraint-matcher';
import type { ConstraintIntent } from '../constraint-utils';
import type { SearchResultItem } from '../../search/types';

describe('constraint-matcher', () => {
  describe('getIntentWeight', () => {
    it('should return 2.0 for required intent', () => {
      expect(getIntentWeight('required')).toBe(2.0);
    });

    it('should return 1.5 for strong intent', () => {
      expect(getIntentWeight('strong')).toBe(1.5);
    });

    it('should return 0.5 for preferred intent', () => {
      expect(getIntentWeight('preferred')).toBe(0.5);
    });

    it('should return -1.0 for excluded intent', () => {
      expect(getIntentWeight('excluded')).toBe(-1.0);
    });

    it('should return 1.0 for null intent (backward compatibility)', () => {
      expect(getIntentWeight(null)).toBe(1.0);
    });
  });

  describe('calculateConstraintMatchScore', () => {
    const mockProduct: SearchResultItem = {
      id: 'test-1',
      title: 'Blue Cotton Dress',
      description: 'A beautiful blue cotton dress',
      imageUrl: 'https://example.com/image.jpg',
      productUrl: 'https://example.com/product',
      priceCents: 10000,
      currency: 'USD',
      category: "Women's Dresses",
      stockStatus: 'in_stock',
      attributes: {
        color: 'Blue',
        material: 'Cotton',
        sizes: ['4', '6', '8'],
      },
    };

    it('should calculate score with old format constraints (backward compatibility)', () => {
      const constraints = {
        colors: ['Blue'],
        materials: ['Cotton'],
      };

      const score = calculateConstraintMatchScore(mockProduct, constraints);
      expect(score).toBeGreaterThan(0);
    });

    it('should calculate score with new format constraints (intent-aware)', () => {
      const constraints: any = {
        colors: {
          values: ['Blue'],
          intent: 'required' as ConstraintIntent,
        },
        materials: {
          values: ['Cotton'],
          intent: 'strong' as ConstraintIntent,
        },
      };

      const score = calculateConstraintMatchScore(mockProduct, constraints);
      expect(score).toBeGreaterThan(0);
    });

    it('should apply higher weight for required intent', () => {
      const requiredConstraints: any = {
        colors: {
          values: ['Blue'],
          intent: 'required' as ConstraintIntent,
        },
      };

      const strongConstraints: any = {
        colors: {
          values: ['Blue'],
          intent: 'strong' as ConstraintIntent,
        },
      };

      const requiredScore = calculateConstraintMatchScore(mockProduct, requiredConstraints);
      const strongScore = calculateConstraintMatchScore(mockProduct, strongConstraints);

      // Required intent should have higher weighted score
      expect(requiredScore).toBeGreaterThan(strongScore);
    });

    it('should apply negative weight for excluded intent', () => {
      const excludedConstraints: any = {
        colors: {
          values: ['Red'], // Product is Blue, not Red
          intent: 'excluded' as ConstraintIntent,
        },
      };

      const score = calculateConstraintMatchScore(mockProduct, excludedConstraints);
      // Excluded intent with non-matching value should have lower/zero score
      expect(score).toBeLessThanOrEqual(0);
    });
  });
});

