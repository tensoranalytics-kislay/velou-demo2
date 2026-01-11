/**
 * Unit tests for intent-aware attribute filtering
 */

import { describe, it, expect } from 'vitest';
import { matchesAttributeFilters } from './attributes';
import type { ProductAttributes } from '../types';
import type { QueryConstraintsWithIntent } from '../../loveshackfancy/constraint-utils';

describe('matchesAttributeFilters with intent', () => {
  const mockAttributes: ProductAttributes = {
    color: 'Blue',
    material: 'Cotton',
    sizes: ['4', '6', '8'],
  };

  const mockEnrichedColumns = {
    length: null,
    formalityLevel: null,
    temperatureIntent: null,
    humidityFriendly: null,
    occasionContext: null,
    problemSolutions: null,
    functionFeatures: null,
    colorShade: null,
    colorUndertone: null,
    multicolor: null,
    seasonalPalette: null,
    enrichedColor: 'Blue',
    ageGroup: null,
  };

  describe('required intent', () => {
    it('should pass when product matches required constraint', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Blue'],
          intent: 'required',
        },
      };

      expect(
        matchesAttributeFilters(mockAttributes, constraints, undefined, undefined, undefined, mockEnrichedColumns)
      ).toBe(true);
    });

    it('should fail when product does not match required constraint', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Red'],
          intent: 'required',
        },
      };

      expect(
        matchesAttributeFilters(mockAttributes, constraints, undefined, undefined, undefined, mockEnrichedColumns)
      ).toBe(false);
    });
  });

  describe('excluded intent', () => {
    it('should pass when product does not have excluded value', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Red'],
          intent: 'excluded',
        },
      };

      expect(
        matchesAttributeFilters(mockAttributes, constraints, undefined, undefined, undefined, mockEnrichedColumns)
      ).toBe(true);
    });

    it('should fail when product has excluded value', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Blue'],
          intent: 'excluded',
        },
      };

      expect(
        matchesAttributeFilters(mockAttributes, constraints, undefined, undefined, undefined, mockEnrichedColumns)
      ).toBe(false);
    });
  });

  describe('strong and preferred intents', () => {
    it('should pass for strong intent (handled in ranking, not filtering)', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Blue'],
          intent: 'strong',
        },
      };

      // Strong intent should not filter (returns null from checkConstraintMatch)
      // Falls back to old format filtering
      expect(
        matchesAttributeFilters(mockAttributes, constraints, undefined, undefined, undefined, mockEnrichedColumns)
      ).toBe(true);
    });

    it('should pass for preferred intent (handled in ranking, not filtering)', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Blue'],
          intent: 'preferred',
        },
      };

      expect(
        matchesAttributeFilters(mockAttributes, constraints, undefined, undefined, undefined, mockEnrichedColumns)
      ).toBe(true);
    });
  });

  describe('backward compatibility', () => {
    it('should work with old format constraints (array)', () => {
      const constraints = {
        colors: ['Blue'],
        materials: ['Cotton'],
      };

      expect(
        matchesAttributeFilters(mockAttributes, constraints, undefined, undefined, undefined, mockEnrichedColumns)
      ).toBe(true);
    });
  });
});


