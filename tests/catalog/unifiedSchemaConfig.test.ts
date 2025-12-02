import { describe, it, expect } from 'vitest';
import {
  getFieldDefinition,
  getFieldsByGroup,
  UNIFIED_CATALOG_SCHEMA,
  type FieldGroup,
} from '../../src/lib/catalog/unifiedSchemaConfig';

describe('unifiedSchemaConfig', () => {
  describe('UNIFIED_CATALOG_SCHEMA', () => {
    it('should define all required identity fields', () => {
      const identityFields = getFieldsByGroup('identity');
      const fieldNames = identityFields.map((f) => f.name);

      expect(fieldNames).toContain('product_id');
      expect(fieldNames).toContain('product_url');
      expect(fieldNames).toContain('image_url_primary');
      expect(fieldNames).toContain('brand');
    });

    it('should define all required classification fields', () => {
      const classificationFields = getFieldsByGroup('classification');
      const fieldNames = classificationFields.map((f) => f.name);

      expect(fieldNames).toContain('category');
      expect(fieldNames).toContain('subcategory');
      expect(fieldNames).toContain('usage_contexts');
      expect(fieldNames).toContain('style_tags');
    });

    it('should define all required commercial fields', () => {
      const commercialFields = getFieldsByGroup('commercial');
      const fieldNames = commercialFields.map((f) => f.name);

      expect(fieldNames).toContain('currency');
      expect(fieldNames).toContain('price');
      expect(fieldNames).toContain('sale_price');
      expect(fieldNames).toContain('inventory_status');
    });

    it('should define all required copy fields', () => {
      const copyFields = getFieldsByGroup('copy');
      const fieldNames = copyFields.map((f) => f.name);

      expect(fieldNames).toContain('title');
      expect(fieldNames).toContain('short_title');
      expect(fieldNames).toContain('description');
    });

    it('should have product_id as hard required', () => {
      const field = getFieldDefinition('product_id');
      expect(field).toBeDefined();
      expect(field?.requiredLevel).toBe('hard');
      expect(field?.mapsTo?.field).toBe('id');
    });

    it('should have product_url as recommended (but effectively required)', () => {
      const field = getFieldDefinition('product_url');
      expect(field).toBeDefined();
      expect(field?.requiredLevel).toBe('recommended');
      expect(field?.mapsTo?.field).toBe('productUrl');
    });

    it('should have title as recommended (with short_title fallback)', () => {
      const field = getFieldDefinition('title');
      expect(field).toBeDefined();
      expect(field?.requiredLevel).toBe('recommended');
      expect(field?.mapsTo?.field).toBe('title');
    });

    it('should map pipe_list fields to attributes subPath', () => {
      const usageContexts = getFieldDefinition('usage_contexts');
      expect(usageContexts?.type).toBe('pipe_list');
      expect(usageContexts?.mapsTo?.subPath).toBe('usage_contexts');

      const styleTags = getFieldDefinition('style_tags');
      expect(styleTags?.type).toBe('pipe_list');
      expect(styleTags?.mapsTo?.subPath).toBe('style_tags');
    });

    it('should map direct DB fields correctly', () => {
      const category = getFieldDefinition('category');
      expect(category?.mapsTo?.field).toBe('category');
      expect(category?.mapsTo?.subPath).toBeUndefined();

      const brand = getFieldDefinition('brand');
      expect(brand?.mapsTo?.field).toBe('brand');
      expect(brand?.mapsTo?.subPath).toBeUndefined();
    });
  });

  describe('getFieldDefinition', () => {
    it('should find field by exact name (case-insensitive)', () => {
      const field1 = getFieldDefinition('product_id');
      const field2 = getFieldDefinition('PRODUCT_ID');
      const field3 = getFieldDefinition('  product_id  ');

      expect(field1).toBeDefined();
      expect(field2).toBeDefined();
      expect(field3).toBeDefined();
      expect(field1?.name).toBe('product_id');
      expect(field2?.name).toBe('product_id');
      expect(field3?.name).toBe('product_id');
    });

    it('should return undefined for unknown fields', () => {
      const field = getFieldDefinition('unknown_field_xyz');
      expect(field).toBeUndefined();
    });
  });

  describe('getFieldsByGroup', () => {
    it('should return all fields for a given group', () => {
      const identityFields = getFieldsByGroup('identity');
      expect(identityFields.length).toBeGreaterThan(0);
      expect(identityFields.every((f) => f.group === 'identity')).toBe(true);

      const classificationFields = getFieldsByGroup('classification');
      expect(classificationFields.length).toBeGreaterThan(0);
      expect(classificationFields.every((f) => f.group === 'classification')).toBe(true);
    });

    it('should return empty array for non-existent group', () => {
      const fields = getFieldsByGroup('nonexistent' as FieldGroup);
      expect(fields).toEqual([]);
    });
  });

  describe('field type consistency', () => {
    it('should have pipe_list type for pipe-delimited fields', () => {
      const pipeListFields = UNIFIED_CATALOG_SCHEMA.filter((f) => f.type === 'pipe_list');
      const expectedPipeListFields = [
        'usage_contexts',
        'style_tags',
        'ship_regions',
        'bullet_highlights',
        'product_details',
        'benefits',
        'claims',
        'safety_compliance',
        'compatibility',
        'attribute_chips',
      ];

      const actualNames = pipeListFields.map((f) => f.name);
      for (const expected of expectedPipeListFields) {
        expect(actualNames).toContain(expected);
      }
    });
  });
});



