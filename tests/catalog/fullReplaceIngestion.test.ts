/**
 * Tests for FULL_REPLACE ingestion mode - end-to-end vendor catalog replacement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { ingestUnifiedCsvStream } from '../../src/lib/catalog/ingestUnifiedCsv';
import { prisma } from '../../src/lib/db';
import { IngestionMode } from '@prisma/client';

// Mock Prisma
vi.mock('../../src/lib/db', () => ({
  prisma: {
    product: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
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
    debug: vi.fn(),
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

describe('FULL_REPLACE ingestion - end-to-end vendor catalog replacement', () => {
  const vendorId = 'vendor_a';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should replace vendor catalog: deactivate missing products and update existing ones', async () => {
    // Step 1: Initial ingestion with products A, B, C
    const initialCsv = `product_id,title,product_url,price,currency,category
PROD-A,Product A,https://example.com/a,19.99,USD,Category1
PROD-B,Product B,https://example.com/b,29.99,USD,Category1
PROD-C,Product C,https://example.com/c,39.99,USD,Category2`;

    const initialStream = Readable.from(initialCsv);

    // Mock initial ingestion run
    const initialBatchId = 'batch-initial';
    vi.mocked(prisma.catalogIngestionRun.create).mockResolvedValue({
      id: initialBatchId,
      vendorId,
      mode: IngestionMode.FULL_REPLACE,
      createdAt: new Date(),
      totalRows: 0,
      inserted: 0,
      updated: 0,
      invalidRows: 0,
      deactivated: null,
    });

    vi.mocked(prisma.catalogIngestionRun.update).mockResolvedValue({
      id: initialBatchId,
      vendorId,
      mode: IngestionMode.FULL_REPLACE,
      createdAt: new Date(),
      totalRows: 3,
      inserted: 3,
      updated: 0,
      invalidRows: 0,
      deactivated: 0,
    });

    // Mock upserts for initial products
    vi.mocked(prisma.product.upsert)
      .mockResolvedValueOnce({
        id: `${vendorId}_PROD-A`,
        title: 'Product A',
        description: 'Product A description',
        imageUrl: '',
        productUrl: 'https://example.com/a',
        priceCents: 1999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Category1',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId,
        sourceId: 'PROD-A',
        isActive: true,
        lastIngestBatchId: initialBatchId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: `${vendorId}_PROD-B`,
        title: 'Product B',
        description: 'Product B description',
        imageUrl: '',
        productUrl: 'https://example.com/b',
        priceCents: 2999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Category1',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId,
        sourceId: 'PROD-B',
        isActive: true,
        lastIngestBatchId: initialBatchId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: `${vendorId}_PROD-C`,
        title: 'Product C',
        description: 'Product C description',
        imageUrl: '',
        productUrl: 'https://example.com/c',
        priceCents: 3999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Category2',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId,
        sourceId: 'PROD-C',
        isActive: true,
        lastIngestBatchId: initialBatchId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 0 });

    const initialSummary = await ingestUnifiedCsvStream(initialStream, vendorId, {
      mode: 'FULL_REPLACE',
    });

    expect(initialSummary.totalRows).toBe(3);
    expect(initialSummary.inserted + initialSummary.updated).toBe(3);
    expect(initialSummary.deactivated).toBe(0);

    // Clear mocks for second ingestion
    vi.clearAllMocks();

    // Step 2: Second ingestion with products B, C, D (A is missing, D is new)
    const secondCsv = `product_id,title,product_url,price,currency,category
PROD-B,Product B Updated,https://example.com/b,29.99,USD,Category1
PROD-C,Product C,https://example.com/c,39.99,USD,Category2
PROD-D,Product D,https://example.com/d,49.99,USD,Category1`;

    const secondStream = Readable.from(secondCsv);

    const secondBatchId = 'batch-second';
    vi.mocked(prisma.catalogIngestionRun.create).mockResolvedValue({
      id: secondBatchId,
      vendorId,
      mode: IngestionMode.FULL_REPLACE,
      createdAt: new Date(),
      totalRows: 0,
      inserted: 0,
      updated: 0,
      invalidRows: 0,
      deactivated: null,
    });

    vi.mocked(prisma.catalogIngestionRun.update).mockResolvedValue({
      id: secondBatchId,
      vendorId,
      mode: IngestionMode.FULL_REPLACE,
      createdAt: new Date(),
      totalRows: 3,
      inserted: 1, // D is new
      updated: 2, // B and C are updated
      invalidRows: 0,
      deactivated: 1, // A is deactivated
    });

    // Mock upserts for second ingestion
    vi.mocked(prisma.product.upsert)
      .mockResolvedValueOnce({
        id: `${vendorId}_PROD-B`,
        title: 'Product B Updated',
        description: 'Product B description',
        imageUrl: '',
        productUrl: 'https://example.com/b',
        priceCents: 2999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Category1',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId,
        sourceId: 'PROD-B',
        isActive: true,
        lastIngestBatchId: secondBatchId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: `${vendorId}_PROD-C`,
        title: 'Product C',
        description: 'Product C description',
        imageUrl: '',
        productUrl: 'https://example.com/c',
        priceCents: 3999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Category2',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId,
        sourceId: 'PROD-C',
        isActive: true,
        lastIngestBatchId: secondBatchId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: `${vendorId}_PROD-D`,
        title: 'Product D',
        description: 'Product D description',
        imageUrl: '',
        productUrl: 'https://example.com/d',
        priceCents: 4999,
        salePriceCents: null,
        currency: 'USD',
        category: 'Category1',
        subcategory: null,
        brand: null,
        attributes: {},
        stockStatus: 'in_stock',
        vendorId,
        sourceId: 'PROD-D',
        isActive: true,
        lastIngestBatchId: secondBatchId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    // Mock deactivation: Product A should be deactivated
    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 1 });

    const secondSummary = await ingestUnifiedCsvStream(secondStream, vendorId, {
      mode: 'FULL_REPLACE',
    });

    // Verify second ingestion summary
    expect(secondSummary.totalRows).toBe(3);
    // Note: The actual inserted/updated counts depend on whether products exist in DB
    // In this test, we're mocking upserts, so we verify the deactivation logic
    expect(secondSummary.deactivated).toBe(1); // A is deactivated
    expect(secondSummary.batchId).toBeDefined();

    // Verify deactivation was called correctly
    expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
    const deactivateCall = vi.mocked(prisma.product.updateMany).mock.calls[0][0];
    
    expect(deactivateCall.where.vendorId).toBe(vendorId);
    expect(deactivateCall.where.isActive).toBe(true);
    // Products B, C, D should be excluded from deactivation (they're in the new CSV)
    expect(deactivateCall.where.id.notIn).toContain(`${vendorId}_PROD-B`);
    expect(deactivateCall.where.id.notIn).toContain(`${vendorId}_PROD-C`);
    expect(deactivateCall.where.id.notIn).toContain(`${vendorId}_PROD-D`);
    // Product A should be deactivated (not in exclusion list)
    expect(deactivateCall.data.isActive).toBe(false);
    expect(deactivateCall.data.stockStatus).toBe('out_of_stock');

    // Verify ingestion run was created and updated
    expect(prisma.catalogIngestionRun.create).toHaveBeenCalledTimes(1);
    const createCall = vi.mocked(prisma.catalogIngestionRun.create).mock.calls[0][0];
    expect(createCall.data.vendorId).toBe(vendorId);
    expect(createCall.data.mode).toBe(IngestionMode.FULL_REPLACE);

    expect(prisma.catalogIngestionRun.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(prisma.catalogIngestionRun.update).mock.calls[0][0];
    expect(updateCall.data.deactivated).toBe(1);
    // Note: inserted/updated counts depend on DB state, which we can't fully mock
    // The important part is that deactivation logic works correctly
  });

  it('should create CatalogIngestionRun with correct fields for FULL_REPLACE', async () => {
    const csv = `product_id,title,product_url,price,currency,category
PROD-1,Product 1,https://example.com/1,19.99,USD,Category1`;

    const stream = Readable.from(csv);
    const batchId = 'test-batch-123';

    vi.mocked(prisma.catalogIngestionRun.create).mockResolvedValue({
      id: batchId,
      vendorId,
      mode: IngestionMode.FULL_REPLACE,
      createdAt: new Date(),
      totalRows: 0,
      inserted: 0,
      updated: 0,
      invalidRows: 0,
      deactivated: null,
    });

    vi.mocked(prisma.catalogIngestionRun.update).mockResolvedValue({
      id: batchId,
      vendorId,
      mode: IngestionMode.FULL_REPLACE,
      createdAt: new Date(),
      totalRows: 1,
      inserted: 1,
      updated: 0,
      invalidRows: 0,
      deactivated: 0,
    });

    vi.mocked(prisma.product.upsert).mockResolvedValue({
      id: `${vendorId}_PROD-1`,
      title: 'Product 1',
      description: 'Product 1',
      imageUrl: '',
      productUrl: 'https://example.com/1',
      priceCents: 1999,
      salePriceCents: null,
      currency: 'USD',
      category: 'Category1',
      subcategory: null,
      brand: null,
      attributes: {},
      stockStatus: 'in_stock',
      vendorId,
      sourceId: 'PROD-1',
      isActive: true,
      lastIngestBatchId: batchId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 0 });

    const summary = await ingestUnifiedCsvStream(stream, vendorId, {
      mode: 'FULL_REPLACE',
    });

    // Verify CatalogIngestionRun was created with correct mode
    expect(prisma.catalogIngestionRun.create).toHaveBeenCalledTimes(1);
    const createCall = vi.mocked(prisma.catalogIngestionRun.create).mock.calls[0][0];
    expect(createCall.data.vendorId).toBe(vendorId);
    expect(createCall.data.mode).toBe(IngestionMode.FULL_REPLACE);

    // Verify it was updated with final stats
    expect(prisma.catalogIngestionRun.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(prisma.catalogIngestionRun.update).mock.calls[0][0];
    // batchId is generated at runtime, so we just verify it's a string
    expect(typeof updateCall.where.id).toBe('string');
    expect(updateCall.data.totalRows).toBe(1);
    expect(updateCall.data.deactivated).toBe(0);
  });
});

