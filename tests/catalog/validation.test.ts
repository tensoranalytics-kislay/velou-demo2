import { describe, it, expect } from 'vitest';
import type { UnifiedVendorCatalogRow } from '../../src/lib/catalog/types';
import {
  createEmptyStats,
  normalizeUnifiedRow,
  updateDatasetCoreStats,
  validateUnifiedRow,
} from '../../src/lib/catalog/validation';

describe('validation', () => {
  describe('normalizeUnifiedRow', () => {
    it('should normalize basic fields', () => {
      const raw = {
        product_id: '  PRD-123  ',
        title: 'Test Product',
        product_url: 'https://example.com/product',
      };

      const { normalized } = normalizeUnifiedRow(raw);

      expect(normalized.product_id).toBe('PRD-123');
      expect(normalized.title).toBe('Test Product');
      expect(normalized.product_url).toBe('https://example.com/product');
    });

    it('should convert empty strings to null', () => {
      const raw = {
        product_id: 'PRD-123',
        title: '',
        description: '   ',
        brand: 'Test Brand',
      };

      const { normalized } = normalizeUnifiedRow(raw);

      expect(normalized.title).toBeNull();
      expect(normalized.description).toBeNull();
      expect(normalized.brand).toBe('Test Brand');
    });

    it('should parse pipe_list fields into arrays', () => {
      const raw = {
        product_id: 'PRD-123',
        usage_contexts: 'beach wedding|office desk|casual weekend',
        style_tags: 'mid-century|minimalist',
        benefits: 'Hydrates Skin|Nourishes|Softens',
      };

      const { normalized } = normalizeUnifiedRow(raw);

      expect(normalized.usage_contexts).toEqual(['beach wedding', 'office desk', 'casual weekend']);
      expect(normalized.style_tags).toEqual(['mid-century', 'minimalist']);
      expect(normalized.benefits).toEqual(['Hydrates Skin', 'Nourishes', 'Softens']);
    });

    it('should handle empty pipe_list as empty array', () => {
      const raw = {
        product_id: 'PRD-123',
        usage_contexts: '',
        style_tags: '   |  |  ',
      };

      const { normalized } = normalizeUnifiedRow(raw);

      expect(normalized.usage_contexts).toEqual([]);
      expect(normalized.style_tags).toEqual([]);
    });

    it('should leave attribute_blob as raw string', () => {
      const raw = {
        product_id: 'PRD-123',
        attribute_blob: 'velou_attribute:Features:Sensitive,velou_attribute:Benefit:Softens Skin',
      };

      const { normalized } = normalizeUnifiedRow(raw);

      expect(normalized.attribute_blob).toBe(
        'velou_attribute:Features:Sensitive,velou_attribute:Benefit:Softens Skin'
      );
      expect(typeof normalized.attribute_blob).toBe('string');
    });

    it('should handle unknown fields gracefully', () => {
      const raw = {
        product_id: 'PRD-123',
        unknown_field: 'should be ignored',
        another_unknown: 'also ignored',
      };

      const { normalized } = normalizeUnifiedRow(raw);

      expect(normalized.product_id).toBe('PRD-123');
      // Unknown fields are not added to normalized row
      expect((normalized as any).unknown_field).toBeUndefined();
    });

    it('should parse numeric fields and return parsing issues', () => {
      const raw = {
        product_id: 'PRD-123',
        price: '19.99',
        sale_price: '14.99',
        inventory_quantity: '50',
        lead_time_days: '3',
      };

      const { normalized, parsingIssues } = normalizeUnifiedRow(raw);

      expect(normalized.price).toBe('19.99');
      expect(normalized.sale_price).toBe('14.99');
      expect(normalized.inventory_quantity).toBe('50');
      expect(normalized.lead_time_days).toBe('3');
      expect(parsingIssues).toHaveLength(0);
    });

    it('should handle invalid numeric fields with warnings', () => {
      const raw = {
        product_id: 'PRD-123',
        price: 'invalid',
        sale_price: 'not a number',
        inventory_quantity: 'abc',
        lead_time_days: 'xyz',
      };

      const { normalized, parsingIssues } = normalizeUnifiedRow(raw);

      expect(normalized.price).toBeNull();
      expect(normalized.sale_price).toBeNull();
      expect(normalized.inventory_quantity).toBeNull();
      expect(normalized.lead_time_days).toBeNull();
      expect(parsingIssues.length).toBeGreaterThan(0);
      expect(parsingIssues.some((issue) => issue.field === 'price')).toBe(true);
    });

    it('should uppercase currency field', () => {
      const raw = {
        product_id: 'PRD-123',
        currency: 'usd',
      };

      const { normalized } = normalizeUnifiedRow(raw);

      expect(normalized.currency).toBe('USD');
    });

    it('should handle comma-separated numbers in numeric fields', () => {
      const raw = {
        product_id: 'PRD-123',
        price: '1,999.99',
        inventory_quantity: '1,000',
      };

      const { normalized, parsingIssues } = normalizeUnifiedRow(raw);

      expect(normalized.price).toBe('1999.99');
      expect(normalized.inventory_quantity).toBe('1000');
      expect(parsingIssues).toHaveLength(0);
    });

    it('should normalize comprehensive L\'Occitane-like row', () => {
      const raw = {
        product_id: '01BM150K23',
        title: 'L\'Occitane Shea Butter Intensive Hand Balm',
        short_title: 'Shea Hand Balm',
        description: 'Nourishing hand balm for dry skin',
        product_url: 'https://example.com/product/01BM150K23',
        image_url_primary: 'https://example.com/images/hand-balm.jpg',
        brand: 'L\'Occitane',
        vertical: 'skincare',
        category: 'Hand Care',
        subcategory: 'Hand Cream',
        price: '29.00',
        currency: 'usd',
        sale_price: '24.99',
        inventory_status: 'in_stock',
        inventory_quantity: '50',
        lead_time_days: '3',
        ship_regions: 'US|CA|EU',
        usage_contexts: 'daily use|dry skin|sensitive skin',
        style_tags: 'luxury|natural|french',
        benefits: 'Hydrates Skin|Nourishes Skin|Softens Skin',
        claims: 'Vegan|Paraben Free|Silicone Free',
        safety_compliance: 'FDA Approved|Cruelty Free',
        usage_instructions: 'Massage onto nails and cuticles',
        sensory_profile: 'Creamy texture with soothing shea scent',
        compatibility: 'All Skin Types|Sensitive Skin',
        collection: 'Gift',
        label: 'velou',
        bullet_highlights: 'Intensive Moisture|Sensitive Skin Safe|Shea Scent',
        product_highlights: 'Vegan & Clean: Free from Parabens',
        product_details: 'Volume:5.3 fl oz|Origin:France|Type:Hand Care',
        materials: 'Shea Butter|Glycerin|Sunflower Seed Oil',
        ingredients: 'Aqua/Water|Shea Butter|Glycerin',
        dimensions: '2.5 x 1.5 x 5.0 inches',
        weight: '182.01g',
        size_fit_notes: 'Suitable for all hand sizes',
        attribute_chips: 'Vegan|Natural|French',
        attribute_blob: 'velou_attribute:Features:Sensitive,velou_attribute:Benefit:Softens',
      };

      const { normalized, parsingIssues } = normalizeUnifiedRow(raw);

      // Core fields
      expect(normalized.product_id).toBe('01BM150K23');
      expect(normalized.title).toBe('L\'Occitane Shea Butter Intensive Hand Balm');
      expect(normalized.brand).toBe('L\'Occitane');
      expect(normalized.currency).toBe('USD'); // Uppercased

      // Numeric fields (stored as strings after parsing, normalized)
      expect(normalized.price).toBe('29.00');
      expect(normalized.sale_price).toBe('24.99');
      expect(normalized.inventory_quantity).toBe('50');
      expect(normalized.lead_time_days).toBe('3');

      // Array fields (pipe_list)
      expect(normalized.usage_contexts).toEqual(['daily use', 'dry skin', 'sensitive skin']);
      expect(normalized.style_tags).toEqual(['luxury', 'natural', 'french']);
      expect(normalized.benefits).toEqual(['Hydrates Skin', 'Nourishes Skin', 'Softens Skin']);
      expect(normalized.claims).toEqual(['Vegan', 'Paraben Free', 'Silicone Free']);
      expect(normalized.safety_compliance).toEqual(['FDA Approved', 'Cruelty Free']);
      expect(normalized.compatibility).toEqual(['All Skin Types', 'Sensitive Skin']);
      expect(normalized.ship_regions).toEqual(['US', 'CA', 'EU']);
      expect(normalized.bullet_highlights).toEqual(['Intensive Moisture', 'Sensitive Skin Safe', 'Shea Scent']);
      expect(normalized.attribute_chips).toEqual(['Vegan', 'Natural', 'French']);

      // String fields
      expect(normalized.usage_instructions).toBe('Massage onto nails and cuticles');
      expect(normalized.sensory_profile).toBe('Creamy texture with soothing shea scent');
      expect(normalized.collection).toBe('Gift');
      expect(normalized.label).toBe('velou');

      // No parsing issues
      expect(parsingIssues).toHaveLength(0);
    });
  });

  describe('validateUnifiedRow', () => {
    it('should pass validation for minimal valid row', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
        // All other fields null
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // Should have warnings about missing recommended fields
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should fail if product_id is missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: null,
        title: 'Test Product',
        product_url: 'https://example.com/product',
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('product_id');
      expect(result.errors[0].message).toContain('product_id is required');
    });

    it('should fail if product_id is empty string', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: '   ',
        title: 'Test Product',
        product_url: 'https://example.com/product',
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field === 'product_id')).toBe(true);
    });

    it('should pass if short_title exists but title is missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: null,
        short_title: 'Short Title',
        product_url: 'https://example.com/product',
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail if both title and short_title are missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: null,
        short_title: null,
        product_url: 'https://example.com/product',
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
      expect(result.errors[0].message).toContain('Either "title" or "short_title"');
    });

    it('should fail if product_url is missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: null,
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field === 'product_url')).toBe(true);
    });

    it('should warn if no classification fields are present', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
        category: null,
        subcategory: null,
        taxon_path: null,
        vertical: null,
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'classification')).toBe(true);
      expect(result.warnings[0].message).toContain('classification');
    });

    it('should not warn if at least one classification field is present', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
        category: 'Apparel',
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'classification')).toBe(false);
    });

    it('should warn if description is missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
        description: null,
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'description')).toBe(true);
    });

    it('should warn if price is present but currency is missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
        price: '19.99',
        currency: null,
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'currency')).toBe(true);
      expect(result.warnings.find((w) => w.field === 'currency')?.message).toContain('currency');
    });

    it('should warn if price is missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
        price: null,
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'price')).toBe(true);
    });

    it('should warn if image_url_primary is missing', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
        image_url_primary: null,
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.field === 'image_url_primary')).toBe(true);
    });

    it('should include rowIndex in errors and warnings when provided', () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: null,
        title: 'Test Product',
        product_url: 'https://example.com/product',
      } as UnifiedVendorCatalogRow;

      const result = validateUnifiedRow(row, undefined, 42);

      expect(result.errors[0].rowIndex).toBe(42);
      expect(result.warnings[0].rowIndex).toBe(42);
    });
  });

  describe('updateDatasetCoreStats', () => {
    it('should increment totalRows', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.totalRows).toBe(1);
    });

    it('should count rows with core identity', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        product_url: 'https://example.com/product',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.rowsWithCoreIdentity).toBe(1);
    });

    it('should not count rows missing core identity', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: null,
        title: 'Test Product',
        product_url: 'https://example.com/product',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.rowsWithCoreIdentity).toBe(0);
    });

    it('should count rows with classification', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com',
        category: 'Apparel',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.rowsWithCoreClassification).toBe(1);
      expect(updated.rowsWithCategory).toBe(1);
    });

    it('should count rows with price and currency', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com',
        price: '19.99',
        currency: 'USD',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.rowsWithPrice).toBe(1);
      expect(updated.rowsWithCurrency).toBe(1);
    });

    it('should count rows with image', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com',
        image_url_primary: 'https://example.com/image.jpg',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.rowsWithImage).toBe(1);
    });

    it('should count rows with description', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com',
        description: 'Product description',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.rowsWithDescription).toBe(1);
    });

    it('should count rows with brand', () => {
      const stats = createEmptyStats();
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com',
        brand: 'Test Brand',
      } as UnifiedVendorCatalogRow;
      const result = validateUnifiedRow(row);

      const updated = updateDatasetCoreStats(stats, row, result);

      expect(updated.rowsWithBrand).toBe(1);
    });

    it('should accumulate stats across multiple rows', () => {
      const stats = createEmptyStats();

      const row1: UnifiedVendorCatalogRow = {
        product_id: 'PRD-1',
        title: 'Product 1',
        product_url: 'https://example.com/1',
        price: '19.99',
        currency: 'USD',
      } as UnifiedVendorCatalogRow;

      const row2: UnifiedVendorCatalogRow = {
        product_id: 'PRD-2',
        title: 'Product 2',
        product_url: 'https://example.com/2',
        category: 'Apparel',
        brand: 'Brand A',
      } as UnifiedVendorCatalogRow;

      const updated1 = updateDatasetCoreStats(stats, row1, validateUnifiedRow(row1));
      const updated2 = updateDatasetCoreStats(updated1, row2, validateUnifiedRow(row2));

      expect(updated2.totalRows).toBe(2);
      expect(updated2.rowsWithCoreIdentity).toBe(2);
      expect(updated2.rowsWithPrice).toBe(1);
      expect(updated2.rowsWithCurrency).toBe(1);
      expect(updated2.rowsWithCategory).toBe(1);
      expect(updated2.rowsWithBrand).toBe(1);
    });
  });

  describe('createEmptyStats', () => {
    it('should return stats with all zeros', () => {
      const stats = createEmptyStats();

      expect(stats.totalRows).toBe(0);
      expect(stats.rowsWithCoreIdentity).toBe(0);
      expect(stats.rowsWithCoreClassification).toBe(0);
      expect(stats.rowsWithPrice).toBe(0);
      expect(stats.rowsWithCurrency).toBe(0);
      expect(stats.rowsWithImage).toBe(0);
      expect(stats.rowsWithDescription).toBe(0);
      expect(stats.rowsWithCategory).toBe(0);
      expect(stats.rowsWithSubcategory).toBe(0);
      expect(stats.rowsWithBrand).toBe(0);
    });
  });
});

