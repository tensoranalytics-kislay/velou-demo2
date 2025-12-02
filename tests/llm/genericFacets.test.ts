/**
 * Tests for generic facet field extraction in intent/constraints
 */

import { describe, it, expect } from 'vitest';
import type { SearchConstraints } from '../../src/lib/search/types';
import {
  normalizeConstraintValues,
  normalizeConstraintArrays,
} from '../../src/lib/llm/orchestrator/utils';

describe('Generic Facet Fields', () => {
  describe('normalizeConstraintValues with generic facets', () => {
    it('should normalize useCases array', () => {
      const constraints: SearchConstraints = {
        useCases: ['travel', 'office', ''],
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.useCases).toEqual(['travel', 'office']);
    });

    it('should normalize styleTags array', () => {
      const constraints: SearchConstraints = {
        styleTags: ['minimalist', 'luxury', '  '],
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.styleTags).toEqual(['minimalist', 'luxury']);
    });

    it('should normalize benefits array', () => {
      const constraints: SearchConstraints = {
        benefits: ['durable', 'lightweight'],
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.benefits).toEqual(['durable', 'lightweight']);
    });

    it('should normalize claims array', () => {
      const constraints: SearchConstraints = {
        claims: ['certified organic', 'eco-friendly'],
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.claims).toEqual(['certified organic', 'eco-friendly']);
    });

    it('should normalize compatibility array', () => {
      const constraints: SearchConstraints = {
        compatibility: ['works with iOS', 'for small rooms'],
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.compatibility).toEqual(['works with iOS', 'for small rooms']);
    });

    it('should normalize sensoryProfile string', () => {
      const constraints: SearchConstraints = {
        sensoryProfile: 'citrus scent',
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.sensoryProfile).toBe('citrus scent');
    });

    it('should remove empty sensoryProfile', () => {
      const constraints: SearchConstraints = {
        sensoryProfile: '',
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.sensoryProfile).toBeUndefined();
    });

    it('should remove null sensoryProfile', () => {
      const constraints: SearchConstraints = {
        sensoryProfile: null as any,
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.sensoryProfile).toBeUndefined();
    });

    it('should handle all generic facets together', () => {
      const constraints: SearchConstraints = {
        useCases: ['travel', 'office'],
        styleTags: ['minimalist'],
        benefits: ['durable', 'lightweight'],
        claims: ['eco-friendly'],
        sensoryProfile: 'soft feel',
        compatibility: ['for tall people'],
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.useCases).toEqual(['travel', 'office']);
      expect(normalized.styleTags).toEqual(['minimalist']);
      expect(normalized.benefits).toEqual(['durable', 'lightweight']);
      expect(normalized.claims).toEqual(['eco-friendly']);
      expect(normalized.sensoryProfile).toBe('soft feel');
      expect(normalized.compatibility).toEqual(['for tall people']);
    });

    it('should handle empty arrays by converting to undefined', () => {
      const constraints: SearchConstraints = {
        useCases: [],
        styleTags: [''],
        benefits: null as any,
        query: 'test',
        inStockOnly: true,
      };

      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.useCases).toBeUndefined();
      expect(normalized.styleTags).toBeUndefined();
      expect(normalized.benefits).toBeUndefined();
    });
  });

  describe('normalizeConstraintArrays with generic facets', () => {
    it('should coerce useCases to string array', () => {
      const constraints: SearchConstraints = {
        useCases: 'travel' as any,
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);

      expect(constraints.useCases).toEqual(['travel']);
    });

    it('should coerce styleTags to string array', () => {
      const constraints: SearchConstraints = {
        styleTags: ['minimalist', 'luxury'],
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);

      expect(constraints.styleTags).toEqual(['minimalist', 'luxury']);
    });

    it('should coerce benefits to string array', () => {
      const constraints: SearchConstraints = {
        benefits: 'durable' as any,
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);

      expect(constraints.benefits).toEqual(['durable']);
    });

    it('should coerce claims to string array', () => {
      const constraints: SearchConstraints = {
        claims: ['certified organic'],
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);

      expect(constraints.claims).toEqual(['certified organic']);
    });

    it('should coerce compatibility to string array', () => {
      const constraints: SearchConstraints = {
        compatibility: 'works with iOS' as any,
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);

      expect(constraints.compatibility).toEqual(['works with iOS']);
    });

    it('should handle null/undefined gracefully', () => {
      const constraints: SearchConstraints = {
        useCases: null as any,
        styleTags: undefined,
        benefits: null as any,
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);

      expect(constraints.useCases).toBeUndefined();
      expect(constraints.styleTags).toBeUndefined();
      expect(constraints.benefits).toBeUndefined();
    });
  });

  describe('SearchConstraints type with generic facets', () => {
    it('should accept all generic facet fields', () => {
      const constraints: SearchConstraints = {
        useCases: ['travel', 'office'],
        styleTags: ['minimalist', 'luxury'],
        benefits: ['durable', 'lightweight', 'energy efficient'],
        claims: ['certified organic', 'B Corp', 'eco-friendly'],
        sensoryProfile: 'citrus scent',
        compatibility: ['works with iOS', 'for small rooms', 'for tall people'],
        query: 'lightweight, durable travel item for frequent flyers',
        inStockOnly: true,
      };

      expect(constraints.useCases).toEqual(['travel', 'office']);
      expect(constraints.styleTags).toEqual(['minimalist', 'luxury']);
      expect(constraints.benefits).toEqual(['durable', 'lightweight', 'energy efficient']);
      expect(constraints.claims).toEqual(['certified organic', 'B Corp', 'eco-friendly']);
      expect(constraints.sensoryProfile).toBe('citrus scent');
      expect(constraints.compatibility).toEqual(['works with iOS', 'for small rooms', 'for tall people']);
    });

    it('should work with vertical-agnostic examples', () => {
      // Example 1: Electronics
      const electronicsConstraints: SearchConstraints = {
        benefits: ['energy efficient', 'high performance'],
        compatibility: ['works with iOS', 'works with Android'],
        useCases: ['home office', 'travel'],
        query: 'energy efficient device for home office',
        inStockOnly: true,
      };

      expect(electronicsConstraints.benefits).toEqual(['energy efficient', 'high performance']);
      expect(electronicsConstraints.compatibility).toEqual(['works with iOS', 'works with Android']);
      expect(electronicsConstraints.useCases).toEqual(['home office', 'travel']);

      // Example 2: Furniture
      const furnitureConstraints: SearchConstraints = {
        styleTags: ['minimalist', 'modern'],
        compatibility: ['for small rooms'],
        benefits: ['durable', 'easy to assemble'],
        useCases: ['home office', 'gift'],
        query: 'minimalist furniture for small rooms',
        inStockOnly: true,
      };

      expect(furnitureConstraints.styleTags).toEqual(['minimalist', 'modern']);
      expect(furnitureConstraints.compatibility).toEqual(['for small rooms']);
      expect(furnitureConstraints.benefits).toEqual(['durable', 'easy to assemble']);
      expect(furnitureConstraints.useCases).toEqual(['home office', 'gift']);

      // Example 3: Beauty/Skincare
      const beautyConstraints: SearchConstraints = {
        benefits: ['hydrates skin', 'nourishes'],
        sensoryProfile: 'citrus scent',
        compatibility: ['for sensitive skin', 'for dry skin'],
        claims: ['vegan', 'cruelty-free'],
        useCases: ['night routine', 'daily use'],
        query: 'vegan skincare for sensitive skin',
        inStockOnly: true,
      };

      expect(beautyConstraints.benefits).toEqual(['hydrates skin', 'nourishes']);
      expect(beautyConstraints.sensoryProfile).toBe('citrus scent');
      expect(beautyConstraints.compatibility).toEqual(['for sensitive skin', 'for dry skin']);
      expect(beautyConstraints.claims).toEqual(['vegan', 'cruelty-free']);
      expect(beautyConstraints.useCases).toEqual(['night routine', 'daily use']);
    });

    it('should allow mixing traditional and generic facets', () => {
      const constraints: SearchConstraints = {
        category: 'Hand Care',
        colors: ['white'],
        benefits: ['hydrates skin'],
        sensoryProfile: 'creamy texture',
        compatibility: ['for sensitive skin'],
        priceMaxCents: 5000,
        query: 'creamy hand cream for sensitive skin',
        inStockOnly: true,
      };

      expect(constraints.category).toBe('Hand Care');
      expect(constraints.colors).toEqual(['white']);
      expect(constraints.benefits).toEqual(['hydrates skin']);
      expect(constraints.sensoryProfile).toBe('creamy texture');
      expect(constraints.compatibility).toEqual(['for sensitive skin']);
      expect(constraints.priceMaxCents).toBe(5000);
    });
  });

  describe('normalization edge cases', () => {
    it('should handle mixed valid and invalid values', () => {
      const constraints: SearchConstraints = {
        useCases: ['travel', '', 'office', '  ', 'gift'],
        styleTags: null as any,
        benefits: ['durable'],
        sensoryProfile: '  ',
        compatibility: [],
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);
      const normalized = normalizeConstraintValues(constraints);

      expect(normalized.useCases).toEqual(['travel', 'office', 'gift']);
      expect(normalized.styleTags).toBeUndefined();
      expect(normalized.benefits).toEqual(['durable']);
      // sensoryProfile with whitespace should be undefined after normalization
      expect(normalized.sensoryProfile).toBeUndefined();
      expect(normalized.compatibility).toBeUndefined();
    });

    it('should preserve valid values when some are invalid', () => {
      const constraints: SearchConstraints = {
        useCases: ['travel', 'office'],
        benefits: ['durable', '', 'lightweight'],
        sensoryProfile: 'citrus scent',
        query: 'test',
        inStockOnly: true,
      };

      normalizeConstraintArrays(constraints);
      const normalized = normalizeConstraintValues(constraints);

      // cleanArray filters empty strings
      expect(normalized.useCases).toEqual(['travel', 'office']);
      expect(normalized.benefits).toEqual(['durable', 'lightweight']);
      expect(normalized.sensoryProfile).toBe('citrus scent');
    });
  });
});

