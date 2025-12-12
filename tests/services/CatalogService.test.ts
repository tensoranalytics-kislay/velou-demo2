/**
 * CatalogService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  importCatalogCSV,
  getCatalogStats,
} from '@/lib/services/CatalogService';
import { prisma } from '@/lib/db';
import { ingestUnifiedCsvStream } from '@/lib/catalog/ingestUnifiedCsv';

// Mock dependencies
vi.mock('@/lib/db');
vi.mock('@/lib/catalog/ingestUnifiedCsv');

const mockPrisma = vi.mocked(prisma);
const mockIngestUnifiedCsvStream = vi.mocked(ingestUnifiedCsvStream);

describe('CatalogService', () => {
  const mockMerchantId = 'merchant-123';
  const mockProduct = {
    id: 'product-123',
    merchantId: mockMerchantId,
    title: 'Test Product',
    description: 'Test Description',
    imageUrl: 'https://example.com/image.jpg',
    productUrl: 'https://example.com/product',
    priceCents: 1999,
    salePriceCents: null,
    currency: 'USD',
    category: 'skincare',
    subcategory: 'moisturizer',
    brand: 'Test Brand',
    attributes: {},
    stockStatus: 'in_stock' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    vendorId: null,
    sourceId: null,
    isActive: true,
    lastIngestBatchId: null,
    shopifyProductId: null,
    shopifyHandle: null,
    shopifyVariantIds: [],
    shopifyBestseller: false,
    shopifyTrending: false,
    shopifySalesRank: null,
    reviewScore: null,
    reviewCount: null,
    reviewsJson: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getProducts', () => {
    it('should return products for merchant', async () => {
      mockPrisma.product.findMany = vi.fn().mockResolvedValue([mockProduct]);

      const result = await getProducts(mockMerchantId);

      expect(result).toEqual([mockProduct]);
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: {
          merchantId: mockMerchantId,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });

    it('should apply filters when provided', async () => {
      mockPrisma.product.findMany = vi.fn().mockResolvedValue([mockProduct]);

      await getProducts(mockMerchantId, {
        category: 'skincare',
        priceMinCents: 1000,
        priceMaxCents: 5000,
        limit: 20,
      });

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith({
        where: {
          merchantId: mockMerchantId,
          isActive: true,
          category: 'skincare',
          priceCents: { gte: 1000, lte: 5000 },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    });
  });

  describe('getProductById', () => {
    it('should return product when found', async () => {
      mockPrisma.product.findFirst = vi.fn().mockResolvedValue(mockProduct);

      const result = await getProductById(mockMerchantId, 'product-123');

      expect(result).toEqual(mockProduct);
      expect(mockPrisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'product-123',
          merchantId: mockMerchantId,
        },
      });
    });

    it('should return null when product not found', async () => {
      mockPrisma.product.findFirst = vi.fn().mockResolvedValue(null);

      const result = await getProductById(mockMerchantId, 'product-123');

      expect(result).toBeNull();
    });
  });

  describe('updateProduct', () => {
    it('should update product', async () => {
      mockPrisma.product.findFirst = vi.fn().mockResolvedValue(mockProduct);
      mockPrisma.product.update = vi.fn().mockResolvedValue({
        ...mockProduct,
        title: 'Updated Product',
      });

      const result = await updateProduct(mockMerchantId, 'product-123', {
        title: 'Updated Product',
      });

      expect(result.title).toBe('Updated Product');
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product-123' },
        data: {
          title: 'Updated Product',
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should throw error when product not found', async () => {
      mockPrisma.product.findFirst = vi.fn().mockResolvedValue(null);

      await expect(
        updateProduct(mockMerchantId, 'product-123', { title: 'Updated' })
      ).rejects.toThrow('Product not found');
    });
  });

  describe('deleteProduct', () => {
    it('should soft delete product', async () => {
      mockPrisma.product.findFirst = vi.fn().mockResolvedValue(mockProduct);
      mockPrisma.product.update = vi.fn().mockResolvedValue({
        ...mockProduct,
        isActive: false,
      });

      await deleteProduct(mockMerchantId, 'product-123');

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product-123' },
        data: {
          isActive: false,
          updatedAt: expect.any(Date),
        },
      });
    });
  });

  describe('importCatalogCSV', () => {
    it('should import catalog and update datasetContext', async () => {
      const mockMerchant = {
        id: mockMerchantId,
        datasetContext: null,
      };
      const mockSummary = {
        totalRows: 100,
        inserted: 95,
        updated: 5,
        invalidRows: 0,
        issues: [],
        coreStats: {} as any,
        datasetContext: {
          vertical: 'skincare',
          primaryFacets: [],
          sampleCategories: [],
        } as any,
        batchId: 'batch-123',
      };

      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(mockMerchant);
      mockIngestUnifiedCsvStream.mockResolvedValue(mockSummary);
      mockPrisma.merchant.update = vi.fn().mockResolvedValue(mockMerchant);

      const result = await importCatalogCSV(
        mockMerchantId,
        Buffer.from('test'),
        'FULL_REPLACE',
        { enableContextInference: true }
      );

      expect(result).toEqual(mockSummary);
      expect(mockPrisma.merchant.update).toHaveBeenCalledWith({
        where: { id: mockMerchantId },
        data: {
          datasetContext: mockSummary.datasetContext,
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should throw error when merchant not found', async () => {
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue(null);

      await expect(
        importCatalogCSV(mockMerchantId, Buffer.from('test'), 'FULL_REPLACE')
      ).rejects.toThrow('Merchant not found');
    });
  });

  describe('getCatalogStats', () => {
    it('should return catalog statistics', async () => {
      mockPrisma.product.count = vi.fn().mockResolvedValue(100);
      mockPrisma.product.findMany = vi.fn().mockResolvedValue([
        { category: 'skincare' },
        { category: 'apparel' },
        { category: 'skincare' },
      ]);
      mockPrisma.merchant.findUnique = vi.fn().mockResolvedValue({
        datasetContext: { vertical: 'skincare' },
      });

      const result = await getCatalogStats(mockMerchantId);

      expect(result.totalProducts).toBe(100);
      expect(result.categories).toEqual(['apparel', 'skincare']);
      expect(result.verticals).toEqual(['skincare']);
    });
  });
});


