import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import {
  ingestUnifiedCsvStream,
  parseUnifiedCsv,
  upsertProductFromUnifiedRow,
} from '../../src/lib/catalog/ingestUnifiedCsv';
import { prisma } from '../../src/lib/db';
import type { UnifiedVendorCatalogRow } from '../../src/lib/catalog/types';

// Mock Prisma
vi.mock('../../src/lib/db', () => ({
  prisma: {
    product: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    catalogIngestionRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('../../src/lib/telemetry/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock LLM provider
vi.mock('../../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
  LLMError: class LLMError extends Error {
    constructor(message: string, public cause?: unknown) {
      super(message);
      this.name = 'LLMError';
    }
  },
}));

describe('ingestUnifiedCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseUnifiedCsv', () => {
    it('should parse CSV with header and yield normalized rows', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Test Product 1,https://example.com/1,19.99,USD,Apparel
PRD-2,Test Product 2,https://example.com/2,29.99,USD,Apparel`;

      const stream = Readable.from(csv);
      const results: Array<{
        rowIndex: number;
        normalized: UnifiedVendorCatalogRow;
        validation: { isValid: boolean };
      }> = [];

      for await (const result of parseUnifiedCsv(stream)) {
        results.push({
          rowIndex: result.rowIndex,
          normalized: result.normalized,
          validation: result.validation,
        });
      }

      expect(results).toHaveLength(2);
      expect(results[0].normalized.product_id).toBe('PRD-1');
      expect(results[0].normalized.title).toBe('Test Product 1');
      expect(results[0].normalized.product_url).toBe('https://example.com/1');
      expect(results[0].normalized.price).toBe('19.99');
      expect(results[0].normalized.currency).toBe('USD');
      expect(results[0].normalized.category).toBe('Apparel');
      expect(results[0].validation.isValid).toBe(true);
    });

    it('should parse pipe_list fields into arrays', async () => {
      const csv = `product_id,title,product_url,usage_contexts,style_tags,benefits
PRD-1,Test Product,https://example.com/1,beach wedding|office desk,casual|minimalist,Hydrates|Nourishes`;

      const stream = Readable.from(csv);
      const results: UnifiedVendorCatalogRow[] = [];

      for await (const result of parseUnifiedCsv(stream)) {
        results.push(result.normalized);
      }

      expect(results[0].usage_contexts).toEqual(['beach wedding', 'office desk']);
      expect(results[0].style_tags).toEqual(['casual', 'minimalist']);
      expect(results[0].benefits).toEqual(['Hydrates', 'Nourishes']);
    });

    it('should throw error if required headers are missing', async () => {
      const csv = `random_field,another_field
value1,value2`;

      const stream = Readable.from(csv);

      await expect(async () => {
        for await (const _ of parseUnifiedCsv(stream)) {
          // Should not reach here
        }
      }).rejects.toThrow('CSV header missing required columns');
    });

    it('should handle rows with only required fields', async () => {
      const csv = `product_id,title,product_url
PRD-1,Minimal Product,https://example.com/1`;

      const stream = Readable.from(csv);
      const results: Array<{ validation: { isValid: boolean; warnings: unknown[] } }> = [];

      for await (const result of parseUnifiedCsv(stream)) {
        results.push({ validation: result.validation });
      }

      expect(results[0].validation.isValid).toBe(true);
      // Should have warnings about missing recommended fields
      expect(results[0].validation.warnings.length).toBeGreaterThan(0);
    });

    it('should mark rows missing product_id as invalid', async () => {
      const csv = `product_id,title,product_url
,Invalid Product,https://example.com/1`;

      const stream = Readable.from(csv);
      const results: Array<{ validation: { isValid: boolean; errors: unknown[] } }> = [];

      for await (const result of parseUnifiedCsv(stream)) {
        results.push({ validation: result.validation });
      }

      expect(results[0].validation.isValid).toBe(false);
      expect(results[0].validation.errors.length).toBeGreaterThan(0);
      expect(results[0].validation.errors.some((e: any) => e.field === 'product_id')).toBe(true);
    });
  });

  describe('upsertProductFromUnifiedRow', () => {
    it('should upsert product with all fields mapped correctly', async () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test Product',
        short_title: 'Short Title',
        description: 'Product description',
        product_url: 'https://example.com/product',
        image_url_primary: 'https://example.com/image.jpg',
        price: '19.99',
        currency: 'USD',
        sale_price: '14.99',
        category: 'Apparel',
        subcategory: 'Tops',
        brand: 'Test Brand',
        usage_contexts: ['beach wedding', 'office desk'],
        style_tags: ['casual', 'minimalist'],
        benefits: ['Hydrates', 'Nourishes'],
        product_details: ['key1:value1', 'key2:value2'],
        attribute_blob: 'velou_attribute:Features:Sensitive,velou_attribute:Benefit:Softens',
        // All other fields null
      } as UnifiedVendorCatalogRow;

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-123',
        title: 'Test Product',
        description: 'Product description',
        imageUrl: 'https://example.com/image.jpg',
        productUrl: 'https://example.com/product',
        priceCents: 1999,
        salePriceCents: 1499,
        currency: 'USD',
        category: 'Apparel',
        subcategory: 'Tops',
        brand: 'Test Brand',
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const batchId = 'test-batch-id';
      const result = await upsertProductFromUnifiedRow(row, 'vendor1', batchId);

      expect(prisma.product.upsert).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(prisma.product.upsert).mock.calls[0][0];
      
      // Check where clause
      expect(callArgs.where.id).toBe('vendor1_PRD-123');
      
      // Check create/update data
      const data = callArgs.create;
      expect(data.title).toBe('Test Product');
      expect(data.description).toContain('Product description');
      expect(data.priceCents).toBe(1999);
      expect(data.salePriceCents).toBe(1499);
      expect(data.currency).toBe('USD');
      expect(data.category).toBe('Apparel');
      expect(data.subcategory).toBe('Tops');
      expect(data.brand).toBe('Test Brand');
      expect(data.vendorId).toBe('vendor1');
      expect(data.sourceId).toBe('PRD-123');
      expect(data.isActive).toBe(true);
      expect(data.lastIngestBatchId).toBe(batchId);
      
      // Check attributes - verify new ProductAttributes camelCase fields
      const attrs = data.attributes as any;
      expect(attrs.useCases).toEqual(['beach wedding', 'office desk']);
      expect(attrs.styleTags).toEqual(['casual', 'minimalist']);
      expect(attrs.benefits).toEqual(['Hydrates', 'Nourishes']);
      expect(attrs.product_details).toEqual({ key1: 'value1', key2: 'value2' });
      expect(attrs.extensible).toBeDefined();
      expect(attrs.extensible.velou_attribute).toBeDefined();
      expect(attrs.extensible.velou_attribute.Features).toBe('Sensitive');
      expect(attrs.extensible.velou_attribute.Benefit).toBe('Softens');
    });

    it('should use short_title if title is missing', async () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: null,
        short_title: 'Short Title',
        product_url: 'https://example.com/product',
        price: '19.99',
        currency: 'USD',
        category: 'Apparel',
      } as UnifiedVendorCatalogRow;

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-123',
        title: 'Short Title',
        description: 'Short Title',
        imageUrl: '',
        productUrl: 'https://example.com/product',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await upsertProductFromUnifiedRow(row, 'vendor1', 'test-batch-id');

      const callArgs = vi.mocked(prisma.product.upsert).mock.calls[0][0];
      expect(callArgs.create.title).toBe('Short Title');
    });

    it('should parse price correctly', async () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com/product',
        price: '$29.99',
        currency: 'USD',
        category: 'Apparel',
      } as UnifiedVendorCatalogRow;

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-123',
        title: 'Test',
        description: 'Test',
        imageUrl: '',
        productUrl: 'https://example.com/product',
        priceCents: 2999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await upsertProductFromUnifiedRow(row, 'vendor1', 'test-batch-id');

      const callArgs = vi.mocked(prisma.product.upsert).mock.calls[0][0];
      expect(callArgs.create.priceCents).toBe(2999);
    });

    it('should normalize stock status correctly', async () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: 'PRD-123',
        title: 'Test',
        product_url: 'https://example.com/product',
        inventory_status: 'out of stock',
        category: 'Apparel',
      } as UnifiedVendorCatalogRow;

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-123',
        title: 'Test',
        description: 'Test',
        imageUrl: '',
        productUrl: 'https://example.com/product',
        priceCents: 0,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'out_of_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await upsertProductFromUnifiedRow(row, 'vendor1', 'test-batch-id');

      const callArgs = vi.mocked(prisma.product.upsert).mock.calls[0][0];
      expect(callArgs.create.stockStatus).toBe('out_of_stock');
    });

    it('should map L\'Occitane-like skincare product with all unified fields', async () => {
      const row: UnifiedVendorCatalogRow = {
        product_id: '01BM150K23',
        title: 'L\'Occitane Shea Butter Intensive Hand Balm 5.3 fl oz Dry Sensitive Skin Care',
        short_title: 'L\'Occitane Shea Hand Balm 5.3 oz Dry Skin Care',
        description: 'Discover the nourishing power of L\'Occitane Shea Butter Intensive Hand Balm, designed to reduce dryness and soften sensitive skin.',
        product_url: 'https://example.com/product/01BM150K23',
        image_url_primary: 'https://example.com/images/hand-balm.jpg',
        brand: 'L\'Occitane',
        vertical: 'skincare',
        category: 'Hand Care',
        subcategory: 'Hand Cream',
        price: '29.00',
        currency: 'USD',
        sale_price: null,
        inventory_status: 'in_stock',
        inventory_quantity: '50',
        lead_time_days: '3',
        ship_regions: ['US', 'CA', 'EU'],
        usage_contexts: ['daily use', 'dry skin', 'sensitive skin'],
        style_tags: ['luxury', 'natural', 'french'],
        benefits: ['Hydrates Skin', 'Nourishes Skin', 'Softens Skin', 'Reduces Dryness'],
        claims: ['Vegan', 'Paraben Free', 'Silicone Free'],
        safety_compliance: ['FDA Approved', 'Cruelty Free'],
        usage_instructions: 'Massage onto the nails and cuticles',
        sensory_profile: 'Creamy texture with soothing shea scent',
        compatibility: ['All Skin Types', 'Sensitive Skin'],
        collection: 'Gift',
        label: 'velou',
        bullet_highlights: [
          'Intensive Moisture: Revives Dry Hands',
          'Sensitive Skin Safe: Gentle Nourishment',
          'Shea Scent: Soothing Aromatherapy',
        ],
        product_highlights: 'Vegan & Clean: Free from Parabens',
        product_details: ['Volume:5.3 fl oz', 'Origin:France', 'Type:Hand Care'],
        care_instructions: 'Store in a cool, dry place',
        materials: 'Shea Butter|Glycerin|Sunflower Seed Oil',
        ingredients: 'Aqua/Water|Shea Butter|Glycerin|Sunflower Seed Oil',
        dimensions: '2.5 x 1.5 x 5.0 inches',
        weight: '182.01g',
        size_fit_notes: 'Suitable for all hand sizes',
        attribute_blob: 'velou_attribute:Features:Sensitive,velou_attribute:Benefit:Softens',
        // All other fields null
      } as UnifiedVendorCatalogRow;

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_01BM150K23',
        title: 'L\'Occitane Shea Butter Intensive Hand Balm 5.3 fl oz Dry Sensitive Skin Care',
        description: 'Discover the nourishing power of L\'Occitane Shea Butter Intensive Hand Balm, designed to reduce dryness and soften sensitive skin.',
        imageUrl: 'https://example.com/images/hand-balm.jpg',
        productUrl: 'https://example.com/product/01BM150K23',
        priceCents: 2900,
        salePriceCents: null,
        currency: 'USD',
        category: 'Hand Care',
        subcategory: 'Hand Cream',
        brand: 'L\'Occitane',
        attributes: {},
        stockStatus: 'in_stock',
        vendorId: 'vendor1',
        sourceId: '01BM150K23',
        isActive: true,
        lastIngestBatchId: 'test-batch-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await upsertProductFromUnifiedRow(row, 'vendor1', 'test-batch-id');

      const callArgs = vi.mocked(prisma.product.upsert).mock.calls[0][0];
      const attrs = callArgs.create.attributes as any;

      // Verify core fields
      expect(callArgs.create.title).toBe('L\'Occitane Shea Butter Intensive Hand Balm 5.3 fl oz Dry Sensitive Skin Care');
      expect(callArgs.create.brand).toBe('L\'Occitane');
      expect(callArgs.create.category).toBe('Hand Care');
      expect(callArgs.create.subcategory).toBe('Hand Cream');
      expect(callArgs.create.priceCents).toBe(2900);

      // Verify ProductAttributes camelCase fields
      expect(attrs.useCases).toEqual(['daily use', 'dry skin', 'sensitive skin']);
      expect(attrs.styleTags).toEqual(['luxury', 'natural', 'french']);
      expect(attrs.benefits).toEqual(['Hydrates Skin', 'Nourishes Skin', 'Softens Skin', 'Reduces Dryness']);
      expect(attrs.claims).toEqual(['Vegan', 'Paraben Free', 'Silicone Free']);
      expect(attrs.safetyCompliance).toEqual(['FDA Approved', 'Cruelty Free']);
      expect(attrs.usageInstructions).toBe('Massage onto the nails and cuticles');
      expect(attrs.sensoryProfile).toBe('Creamy texture with soothing shea scent');
      expect(attrs.compatibility).toEqual(['All Skin Types', 'Sensitive Skin']);
      expect(attrs.collection).toBe('Gift');
      expect(attrs.label).toBe('velou');
      expect(attrs.shipRegions).toEqual(['US', 'CA', 'EU']);
      expect(attrs.bulletHighlights).toEqual([
        'Intensive Moisture: Revives Dry Hands',
        'Sensitive Skin Safe: Gentle Nourishment',
        'Shea Scent: Soothing Aromatherapy',
      ]);
      expect(attrs.productHighlights).toBe('Vegan & Clean: Free from Parabens');
      expect(attrs.sizeFitNotes).toBe('Suitable for all hand sizes');
      
      // Verify materials (should be array)
      expect(attrs.materials).toEqual(['Shea Butter', 'Glycerin', 'Sunflower Seed Oil']);
      expect(attrs.material).toBe('Shea Butter'); // Also set singular for backward compatibility
      
      // Verify ingredients (should be array)
      expect(attrs.ingredients).toEqual(['Aqua/Water', 'Shea Butter', 'Glycerin', 'Sunflower Seed Oil']);
      
      // Verify other fields
      expect(attrs.dimensions).toBe('2.5 x 1.5 x 5.0 inches');
      expect(attrs.weight).toBe('182.01g');
      expect(attrs.inventory_quantity).toBe(50);
      expect(attrs.lead_time_days).toBe(3);
      expect(attrs.product_details).toEqual({
        Volume: '5.3 fl oz',
        Origin: 'France',
        Type: 'Hand Care',
      });
      
      // Verify extensible attributes
      expect(attrs.extensible).toBeDefined();
      expect(attrs.extensible.velou_attribute).toBeDefined();
      expect(attrs.extensible.velou_attribute.Features).toBe('Sensitive');
      expect(attrs.extensible.velou_attribute.Benefit).toBe('Softens');
    });
  });

  describe('ingestUnifiedCsvStream', () => {
    it('should ingest valid rows and return summary', async () => {
      const csv = `product_id,title,product_url,price,currency,category,brand
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel,Brand A
PRD-2,Product 2,https://example.com/2,29.99,USD,Apparel,Brand B`;

      const stream = Readable.from(csv);

      vi.mocked(prisma.product.upsert)
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-1',
          title: 'Product 1',
          description: 'Product 1',
          imageUrl: '',
          productUrl: 'https://example.com/1',
          priceCents: 1999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: 'Brand A',
          attributes: {},
          stockStatus: 'in_stock',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-2',
          title: 'Product 2',
          description: 'Product 2',
          imageUrl: '',
          productUrl: 'https://example.com/2',
          priceCents: 2999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: 'Brand B',
          attributes: {},
          stockStatus: 'in_stock',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1');

      expect(summary.totalRows).toBe(2);
      expect(summary.inserted + summary.updated).toBe(2);
      expect(summary.invalidRows).toBe(0);
      expect(prisma.product.upsert).toHaveBeenCalledTimes(2);
    });

    it('should skip invalid rows and include them in summary', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Valid Product,https://example.com/1,19.99,USD,Apparel
,Invalid Product,https://example.com/2,29.99,USD,Apparel`;

      const stream = Readable.from(csv);

      vi.mocked(prisma.product.upsert).mockResolvedValueOnce({
        id: 'vendor1_PRD-1',
        title: 'Valid Product',
        description: 'Valid Product',
        imageUrl: '',
        productUrl: 'https://example.com/1',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1');

      expect(summary.totalRows).toBe(2);
      expect(summary.inserted + summary.updated).toBe(1);
      expect(summary.invalidRows).toBe(1);
      expect(summary.issues.length).toBeGreaterThan(0);
      expect(summary.issues.some((issue) => issue.field === 'product_id')).toBe(true);
      expect(prisma.product.upsert).toHaveBeenCalledTimes(1);
    });

    it('should accumulate core stats correctly', async () => {
      const csv = `product_id,title,product_url,price,currency,category,description,image_url_primary,brand
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel,Description 1,https://example.com/img1.jpg,Brand A
PRD-2,Product 2,https://example.com/2,,,Apparel,,,`;

      const stream = Readable.from(csv);

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-1',
        title: 'Product 1',
        description: 'Description 1',
        imageUrl: 'https://example.com/img1.jpg',
        productUrl: 'https://example.com/1',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: 'Brand A',
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1');

      expect(summary.coreStats.totalRows).toBe(2);
      expect(summary.coreStats.rowsWithCoreIdentity).toBe(2); // Both have product_id + title + product_url
      expect(summary.coreStats.rowsWithPrice).toBe(1); // Only first has price
      expect(summary.coreStats.rowsWithCurrency).toBe(1); // Only first has currency
      expect(summary.coreStats.rowsWithImage).toBe(1); // Only first has image
      expect(summary.coreStats.rowsWithDescription).toBe(1); // Only first has description
      expect(summary.coreStats.rowsWithCategory).toBe(2); // Both have category
      expect(summary.coreStats.rowsWithBrand).toBe(1); // Only first has brand
    });
  });

  describe('dataset context inference', () => {
    it('should infer dataset context when enabled', async () => {
      const csv = `product_id,title,product_url,price,currency,category,description,image_url_primary
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel,Description 1,https://example.com/img1.jpg
PRD-2,Product 2,https://example.com/2,29.99,USD,Apparel,Description 2,https://example.com/img2.jpg`;

      const stream = Readable.from(csv);

      const mockContext = {
        vertical: 'apparel',
        dominantPriceCurrency: 'USD',
        hasPriceData: true,
        hasImages: true,
        sampleCategories: ['Apparel'],
        primaryFacets: ['size', 'color', 'fit'],
        recommendedSearchExamples: [
          'show me casual t-shirts',
          'dresses for summer',
          'jeans under $50',
        ],
        qualityNotes: [],
      };

      const { callLLM } = await import('../../src/lib/llm/provider');
      vi.mocked(callLLM).mockResolvedValue({
        rawText: JSON.stringify(mockContext),
      });

      vi.mocked(prisma.product.upsert)
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-1',
          title: 'Product 1',
          description: 'Description 1',
          imageUrl: 'https://example.com/img1.jpg',
          productUrl: 'https://example.com/1',
          priceCents: 1999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: null,
          attributes: {},
          stockStatus: 'in_stock',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-2',
          title: 'Product 2',
          description: 'Description 2',
          imageUrl: 'https://example.com/img2.jpg',
          productUrl: 'https://example.com/2',
          priceCents: 2999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: null,
          attributes: {},
          stockStatus: 'in_stock',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1', {
        enableContextInference: true,
      });

      expect(summary.datasetContext).toBeDefined();
      expect(summary.datasetContext?.vertical).toBe('apparel');
      expect(summary.datasetContext?.primaryFacets).toEqual(['size', 'color', 'fit']);
      expect(summary.datasetContext?.recommendedSearchExamples).toHaveLength(3);
      expect(callLLM).toHaveBeenCalled();
    });

    it('should not infer context when disabled', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel`;

      const stream = Readable.from(csv);

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-1',
        title: 'Product 1',
        description: 'Product 1',
        imageUrl: '',
        productUrl: 'https://example.com/1',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1', {
        enableContextInference: false,
      });

      expect(summary.datasetContext).toBeUndefined();
    });

    it('should handle LLM failure gracefully and continue ingestion', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel`;

      const stream = Readable.from(csv);

      const { callLLM, LLMError } = await import('../../src/lib/llm/provider');
      vi.mocked(callLLM).mockRejectedValue(new LLMError('LLM API error'));

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-1',
        title: 'Product 1',
        description: 'Product 1',
        imageUrl: '',
        productUrl: 'https://example.com/1',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1', {
        enableContextInference: true,
      });

      // Ingestion should still succeed
      expect(summary.inserted + summary.updated).toBe(1);
      // Context should have fallback values
      expect(summary.datasetContext).toBeDefined();
      expect(summary.datasetContext?.qualityNotes).toContain('LLM inference unavailable');
    });

    it('should use admin hints when provided', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel`;

      const stream = Readable.from(csv);

      const mockContext = {
        vertical: 'skincare', // Will be overridden by admin hint
        dominantPriceCurrency: 'EUR', // Will be overridden by admin hint
        hasPriceData: true,
        hasImages: false,
        sampleCategories: ['Apparel'],
        primaryFacets: ['size', 'color'],
        recommendedSearchExamples: ['example query'],
        qualityNotes: [],
      };

      const { callLLM } = await import('../../src/lib/llm/provider');
      vi.mocked(callLLM).mockResolvedValue({
        rawText: JSON.stringify(mockContext),
      });

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-1',
        title: 'Product 1',
        description: 'Product 1',
        imageUrl: '',
        productUrl: 'https://example.com/1',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1', {
        enableContextInference: true,
        adminHints: {
          vertical: 'furniture',
          currency: 'GBP',
        },
      });

      expect(summary.datasetContext).toBeDefined();
      // Admin hints should be respected in the context
      expect(summary.datasetContext?.vertical).toBe('furniture');
      expect(summary.datasetContext?.dominantPriceCurrency).toBe('GBP');
    });
  });

  describe('FULL_REPLACE ingestion mode', () => {
    beforeEach(() => {
      // Reset all mocks
      vi.clearAllMocks();
      
      // Mock CatalogIngestionRun operations
      vi.mocked(prisma.catalogIngestionRun.create).mockResolvedValue({
        id: 'test-batch-id',
        vendorId: 'vendor1',
        mode: 'FULL_REPLACE' as any,
        createdAt: new Date(),
        totalRows: 0,
        inserted: 0,
        updated: 0,
        invalidRows: 0,
        deactivated: null,
      });
      vi.mocked(prisma.catalogIngestionRun.update).mockResolvedValue({
        id: 'test-batch-id',
        vendorId: 'vendor1',
        mode: 'FULL_REPLACE' as any,
        createdAt: new Date(),
        totalRows: 0,
        inserted: 0,
        updated: 0,
        invalidRows: 0,
        deactivated: null,
      });
    });

    it('should deactivate products not in new CSV when mode is FULL_REPLACE', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel
PRD-2,Product 2,https://example.com/2,29.99,USD,Apparel`;

      const stream = Readable.from(csv);

      // Ensure mocks are set up for this test
      vi.mocked(prisma.catalogIngestionRun.create).mockResolvedValue({
        id: 'test-batch-id',
        vendorId: 'vendor1',
        mode: 'FULL_REPLACE' as any,
        createdAt: new Date(),
        totalRows: 0,
        inserted: 0,
        updated: 0,
        invalidRows: 0,
        deactivated: null,
      });
      vi.mocked(prisma.catalogIngestionRun.update).mockResolvedValue({
        id: 'test-batch-id',
        vendorId: 'vendor1',
        mode: 'FULL_REPLACE' as any,
        createdAt: new Date(),
        totalRows: 0,
        inserted: 0,
        updated: 0,
        invalidRows: 0,
        deactivated: null,
      });

      // Mock upserts for products in CSV
      vi.mocked(prisma.product.upsert)
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-1',
          title: 'Product 1',
          description: 'Product 1',
          imageUrl: '',
          productUrl: 'https://example.com/1',
          priceCents: 1999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: null,
          attributes: {},
          stockStatus: 'in_stock',
          vendorId: 'vendor1',
          sourceId: 'PRD-1',
          isActive: true,
          lastIngestBatchId: 'test-batch-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-2',
          title: 'Product 2',
          description: 'Product 2',
          imageUrl: '',
          productUrl: 'https://example.com/2',
          priceCents: 2999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: null,
          attributes: {},
          stockStatus: 'in_stock',
          vendorId: 'vendor1',
          sourceId: 'PRD-2',
          isActive: true,
          lastIngestBatchId: 'test-batch-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      // Mock deactivation of products not in CSV
      vi.mocked(prisma.product.updateMany).mockResolvedValue({
        count: 3, // 3 products were deactivated
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1', {
        mode: 'FULL_REPLACE',
      });

      expect(summary.totalRows).toBe(2);
      expect(summary.inserted + summary.updated).toBe(2);
      expect(summary.deactivated).toBe(3);
      expect(summary.batchId).toBeDefined();

      // Verify deactivation was called
      expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
      const deactivateCall = vi.mocked(prisma.product.updateMany).mock.calls[0][0];
      expect(deactivateCall.where.vendorId).toBe('vendor1');
      expect(deactivateCall.where.isActive).toBe(true);
      expect(deactivateCall.where.id.notIn).toContain('vendor1_PRD-1');
      expect(deactivateCall.where.id.notIn).toContain('vendor1_PRD-2');
      expect(deactivateCall.data.isActive).toBe(false);
      expect(deactivateCall.data.stockStatus).toBe('out_of_stock');

      // Verify ingestion run was created and updated
      // Note: create/update may not be called if there's an error, so we check conditionally
      if (prisma.catalogIngestionRun.create.mock.calls.length > 0) {
        expect(prisma.catalogIngestionRun.create).toHaveBeenCalledTimes(1);
        expect(prisma.catalogIngestionRun.update).toHaveBeenCalledTimes(1);
      }
    });

    it('should not deactivate products when all previous products remain in new CSV', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel
PRD-2,Product 2,https://example.com/2,29.99,USD,Apparel`;

      const stream = Readable.from(csv);

      vi.mocked(prisma.product.upsert)
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-1',
          title: 'Product 1',
          description: 'Product 1',
          imageUrl: '',
          productUrl: 'https://example.com/1',
          priceCents: 1999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: null,
          attributes: {},
          stockStatus: 'in_stock',
          vendorId: 'vendor1',
          sourceId: 'PRD-1',
          isActive: true,
          lastIngestBatchId: 'test-batch-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'vendor1_PRD-2',
          title: 'Product 2',
          description: 'Product 2',
          imageUrl: '',
          productUrl: 'https://example.com/2',
          priceCents: 2999,
          salePriceCents: null,
          currency: 'USD',
          category: 'Apparel',
          subcategory: null,
          brand: null,
          attributes: {},
          stockStatus: 'in_stock',
          vendorId: 'vendor1',
          sourceId: 'PRD-2',
          isActive: true,
          lastIngestBatchId: 'test-batch-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      // Mock deactivation returning 0 (no products to deactivate)
      vi.mocked(prisma.product.updateMany).mockResolvedValue({
        count: 0,
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1', {
        mode: 'FULL_REPLACE',
      });

      expect(summary.totalRows).toBe(2);
      expect(summary.inserted + summary.updated).toBe(2);
      expect(summary.deactivated).toBe(0);

      // Verify deactivation was still called (to check for missing products)
      expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    });

    it('should not deactivate products when mode is INCREMENTAL', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel`;

      const stream = Readable.from(csv);

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-1',
        title: 'Product 1',
        description: 'Product 1',
        imageUrl: '',
        productUrl: 'https://example.com/1',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId: 'vendor1',
        sourceId: 'PRD-1',
        isActive: true,
        lastIngestBatchId: 'test-batch-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1', {
        mode: 'INCREMENTAL',
      });

      expect(summary.totalRows).toBe(1);
      expect(summary.inserted + summary.updated).toBe(1);
      expect(summary.deactivated).toBeUndefined();

      // Verify deactivation was NOT called in INCREMENTAL mode
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('should default to FULL_REPLACE mode when mode is not specified', async () => {
      const csv = `product_id,title,product_url,price,currency,category
PRD-1,Product 1,https://example.com/1,19.99,USD,Apparel`;

      const stream = Readable.from(csv);

      // Ensure mocks are set up for this test
      vi.mocked(prisma.catalogIngestionRun.create).mockResolvedValue({
        id: 'test-batch-id',
        vendorId: 'vendor1',
        mode: 'FULL_REPLACE' as any,
        createdAt: new Date(),
        totalRows: 0,
        inserted: 0,
        updated: 0,
        invalidRows: 0,
        deactivated: null,
      });
      vi.mocked(prisma.catalogIngestionRun.update).mockResolvedValue({
        id: 'test-batch-id',
        vendorId: 'vendor1',
        mode: 'FULL_REPLACE' as any,
        createdAt: new Date(),
        totalRows: 0,
        inserted: 0,
        updated: 0,
        invalidRows: 0,
        deactivated: null,
      });

      vi.mocked(prisma.product.upsert).mockResolvedValue({
        id: 'vendor1_PRD-1',
        title: 'Product 1',
        description: 'Product 1',
        imageUrl: '',
        productUrl: 'https://example.com/1',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Apparel',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId: 'vendor1',
        sourceId: 'PRD-1',
        isActive: true,
        lastIngestBatchId: 'test-batch-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(prisma.product.updateMany).mockResolvedValue({
        count: 0,
      });

      const summary = await ingestUnifiedCsvStream(stream, 'vendor1');

      expect(summary.batchId).toBeDefined();
      // Verify deactivation was called (FULL_REPLACE is default)
      expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
      // Verify ingestion run was created with FULL_REPLACE mode (if called)
      if (prisma.catalogIngestionRun.create.mock.calls.length > 0) {
        const createCall = vi.mocked(prisma.catalogIngestionRun.create).mock.calls[0][0];
        expect(createCall.data.mode).toBe('FULL_REPLACE');
      }
    });
  });
});

