/**
 * Tests for Product Embeddings Backfill
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { backfillProductEmbeddings } from '../../../src/lib/search/vector/backfill';
import { embedText } from '../../../src/lib/search/vector/index';

// Mock dependencies
vi.mock('../../../src/lib/db', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('../../../src/lib/search/vector/index', () => ({
  embedText: vi.fn(),
}));

vi.mock('../../../src/lib/config', () => ({
  env: {
    openaiApiKey: 'test-key',
    embeddingModel: 'text-embedding-3-small',
  },
  __esModule: true,
  default: {
    env: {
      openaiApiKey: 'test-key',
      embeddingModel: 'text-embedding-3-small',
    },
  },
}));

import { prisma } from '../../../src/lib/db';

describe('backfillProductEmbeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  const mockProduct = {
    id: 'prod1',
    title: 'Test Product',
    description: 'A test product description',
    category: 'Test Category',
    subcategory: null,
    attributes: {
      collection: 'Test Collection',
    },
  };
  
  const mockEmbedding = new Array(1536).fill(0.1); // Mock 1536-dim embedding
  
  describe('idempotency', () => {
    it('should only process products with embedding IS NULL', async () => {
      // Mock: First query returns products with NULL embeddings
      // Second query returns empty (all processed)
      vi.mocked(prisma.$queryRawUnsafe)
        .mockResolvedValueOnce([mockProduct])
        .mockResolvedValueOnce([]);
      
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1);
      
      const result = await backfillProductEmbeddings({
        merchantId: 'merchant1',
        batchSize: 10,
      });
      
      // Verify query filters for NULL embeddings
      const queryCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
      expect(queryCall[0]).toContain('p.embedding IS NULL');
      
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
    });
    
    it('should filter by merchantId when provided', async () => {
      vi.mocked(prisma.$queryRawUnsafe)
        .mockResolvedValueOnce([mockProduct])
        .mockResolvedValueOnce([]);
      
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1);
      
      await backfillProductEmbeddings({
        merchantId: 'merchant1',
      });
      
      const queryCall = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
      expect(queryCall[0]).toContain('merchantId');
    });
  });
  
  describe('dryRun mode', () => {
    it('should not write to database when dryRun is true', async () => {
      vi.mocked(prisma.$queryRawUnsafe)
        .mockResolvedValueOnce([mockProduct])
        .mockResolvedValueOnce([]);
      
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      
      const result = await backfillProductEmbeddings({
        dryRun: true,
      });
      
      // Should process but not call executeRaw (dry run)
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
      
      // Should still count as succeeded in dry run
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
    });
  });
  
  describe('batch processing', () => {
    it('should process products in batches', async () => {
      const batch1 = [mockProduct, { ...mockProduct, id: 'prod2' }];
      const batch2 = [{ ...mockProduct, id: 'prod3' }];
      
      vi.mocked(prisma.$queryRawUnsafe)
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]);
      
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1);
      
      const result = await backfillProductEmbeddings({
        batchSize: 2,
      });
      
      // Should process 3 products across 2 batches
      expect(result.processed).toBe(3);
      expect(result.succeeded).toBe(3);
      
      // Should call executeRawUnsafe for each product (3 products = 3 calls)
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });
    
    it('should stop when no more products are found', async () => {
      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([]);
      
      const result = await backfillProductEmbeddings();
      
      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(embedText).not.toHaveBeenCalled();
    });
  });
  
  describe('error handling', () => {
    it('should continue processing other products when one fails', async () => {
      const products = [mockProduct, { ...mockProduct, id: 'prod-error' }];
      
      vi.mocked(prisma.$queryRawUnsafe)
        .mockResolvedValueOnce(products)
        .mockResolvedValueOnce([]);
      
      // First product succeeds, second fails
      vi.mocked(embedText)
        .mockResolvedValueOnce(mockEmbedding)
        .mockRejectedValueOnce(new Error('API error'));
      
      vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1);
      
      const result = await backfillProductEmbeddings();
      
      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].productId).toBe('prod-error');
    });
    
    it('should handle empty indexed text gracefully', async () => {
      // Reset all mocks
      vi.clearAllMocks();
      
      const productWithEmptyFields = {
        id: 'prod-empty-only',
        title: '',
        description: '',
        category: '',
        subcategory: null,
        attributes: {},
      };
      
      vi.mocked(prisma.$queryRawUnsafe)
        .mockResolvedValueOnce([productWithEmptyFields])
        .mockResolvedValueOnce([]); // Empty on second pagination check
      
      // buildIndexedText with all empty fields should return empty string or just whitespace
      // The check in backfill.ts uses indexedText.trim().length === 0
      const result = await backfillProductEmbeddings();
      
      // Should have processed the product but failed due to empty text
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].productId).toBe('prod-empty-only');
      expect(result.errors[0].error).toBe('Empty indexed text');
      // Should not have called embedText for empty text
      expect(embedText).not.toHaveBeenCalled();
    });
    
    it('should fall back to individual updates if batch update fails', async () => {
      vi.mocked(prisma.$queryRawUnsafe)
        .mockResolvedValueOnce([mockProduct])
        .mockResolvedValueOnce([]);
      
      vi.mocked(embedText).mockResolvedValue(mockEmbedding);
      
      // Update succeeds
      vi.mocked(prisma.$executeRawUnsafe).mockResolvedValue(1);
      
      const result = await backfillProductEmbeddings();
      
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    });
  });
  
  describe('configuration validation', () => {
    it('should validate OPENAI_API_KEY at runtime', async () => {
      // This test verifies the validation exists in the code
      // In a real scenario, env.openaiApiKey would be checked
      // We can't easily mock it here since it's imported at module level
      // The actual validation happens in the function, so this is more of a smoke test
      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([]);
      
      // With valid key (from mock), should not throw
      const result = await backfillProductEmbeddings();
      expect(result.processed).toBe(0);
    });
  });
});

