/**
 * Unit tests for constraint utilities
 */

import { describe, it, expect } from 'vitest';
import {
  extractConstraintValues,
  extractConstraintIntent,
  extractSimilarValues,
  flattenConstraintsWithIntent,
  normalizeConstraintsToIntent,
  hasIntentFormat,
  type ConstraintIntent,
  type QueryConstraintsWithIntent,
  type QueryConstraintsOld,
} from './constraint-utils';

describe('constraint-utils', () => {
  describe('extractConstraintValues', () => {
    it('should extract values from old format (array)', () => {
      const constraint = ['Blue', 'Red'];
      expect(extractConstraintValues(constraint)).toEqual(['Blue', 'Red']);
    });

    it('should extract values from new format (object with intent)', () => {
      const constraint = {
        values: ['Blue', 'Red'],
        intent: 'strong' as ConstraintIntent,
      };
      expect(extractConstraintValues(constraint)).toEqual(['Blue', 'Red']);
    });

    it('should return null for null constraint', () => {
      expect(extractConstraintValues(null)).toBeNull();
    });

    it('should return undefined for undefined constraint', () => {
      expect(extractConstraintValues(undefined)).toBeUndefined();
    });
  });

  describe('extractConstraintIntent', () => {
    it('should return strong for old format (array)', () => {
      const constraint = ['Blue', 'Red'];
      expect(extractConstraintIntent(constraint)).toBe('strong');
    });

    it('should extract intent from new format', () => {
      const constraint = {
        values: ['Blue'],
        intent: 'required' as ConstraintIntent,
      };
      expect(extractConstraintIntent(constraint)).toBe('required');
    });

    it('should return null for null constraint', () => {
      expect(extractConstraintIntent(null)).toBeNull();
    });
  });

  describe('extractSimilarValues', () => {
    it('should extract similar values from new format', () => {
      const constraint = {
        values: ['Blue'],
        intent: 'strong' as ConstraintIntent,
        similarValues: ['Navy', 'Teal'],
      };
      expect(extractSimilarValues(constraint)).toEqual(['Navy', 'Teal']);
    });

    it('should return undefined for old format', () => {
      const constraint = ['Blue', 'Red'];
      expect(extractSimilarValues(constraint)).toBeUndefined();
    });

    it('should return undefined when no similar values', () => {
      const constraint = {
        values: ['Blue'],
        intent: 'strong' as ConstraintIntent,
      };
      expect(extractSimilarValues(constraint)).toBeUndefined();
    });
  });

  describe('flattenConstraintsWithIntent', () => {
    it('should convert new format to old format', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Blue', 'Red'],
          intent: 'strong',
        },
        sizes: {
          values: ['4', '6'],
          intent: 'required',
        },
        priceMaxCents: {
          value: 10000,
          intent: 'strong',
        },
      };

      const flattened = flattenConstraintsWithIntent(constraints);
      expect(flattened.colors).toEqual(['Blue', 'Red']);
      expect(flattened.sizes).toEqual(['4', '6']);
      expect(flattened.priceMaxCents).toBe(10000);
    });

    it('should handle null constraints', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: null,
        sizes: {
          values: ['4'],
          intent: 'strong',
        },
      };

      const flattened = flattenConstraintsWithIntent(constraints);
      expect(flattened.colors).toBeNull();
      expect(flattened.sizes).toEqual(['4']);
    });
  });

  describe('normalizeConstraintsToIntent', () => {
    it('should convert old format to new format with default intent', () => {
      const constraints: QueryConstraintsOld = {
        colors: ['Blue', 'Red'],
        sizes: ['4'],
        priceMaxCents: 10000,
      };

      const normalized = normalizeConstraintsToIntent(constraints, 'strong');
      expect(normalized.colors).toEqual({
        values: ['Blue', 'Red'],
        intent: 'strong',
      });
      expect(normalized.sizes).toEqual({
        values: ['4'],
        intent: 'strong',
      });
      expect(normalized.priceMaxCents).toEqual({
        value: 10000,
        intent: 'strong',
      });
    });

    it('should use provided default intent', () => {
      const constraints: QueryConstraintsOld = {
        colors: ['Blue'],
      };

      const normalized = normalizeConstraintsToIntent(constraints, 'required');
      expect(normalized.colors).toEqual({
        values: ['Blue'],
        intent: 'required',
      });
    });

    it('should handle null constraints', () => {
      const constraints: QueryConstraintsOld = {
        colors: null,
        sizes: ['4'],
      };

      const normalized = normalizeConstraintsToIntent(constraints);
      expect(normalized.colors).toBeNull();
      expect(normalized.sizes).toEqual({
        values: ['4'],
        intent: 'strong',
      });
    });
  });

  describe('hasIntentFormat', () => {
    it('should return true for new format', () => {
      const constraints: QueryConstraintsWithIntent = {
        colors: {
          values: ['Blue'],
          intent: 'strong',
        },
      };
      expect(hasIntentFormat(constraints)).toBe(true);
    });

    it('should return false for old format', () => {
      const constraints: QueryConstraintsOld = {
        colors: ['Blue'],
      };
      expect(hasIntentFormat(constraints)).toBe(false);
    });
  });
});


