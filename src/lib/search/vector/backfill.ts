/**
 * Backfill Product Embeddings
 * 
 * Production-ready utility to generate and store embeddings for products.
 * Idempotent: only processes products with `embedding IS NULL`.
 * 
 * See: docs/loccitane_multiview_retrieval.md (Phase 1.2)
 */

import { prisma } from '../../db';
import { logger } from '../../telemetry/logger';
import { embedText } from './index';
import { buildIndexedText } from '../utils';
import type { SearchResultItem } from '../types';
import { env } from '../../config';

export type EmbeddingBackfillOptions = {
  merchantId?: string;
  batchSize?: number;      // default: 50
  dryRun?: boolean;        // if true, logs but doesn't write
};

export type EmbeddingBackfillResult = {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ productId: string; error: string }>;
};

const DEFAULT_BATCH_SIZE = 50;

/**
 * Build indexed text from a raw Prisma product record
 * 
 * Converts a database product record to SearchResultItem format
 * for use with buildIndexedText.
 */
function buildSearchResultItemFromDb(product: {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory: string | null;
  attributes: unknown;
  enrichedColor?: string | null;
  ageGroup?: string | null;
  length?: string | null;
  formalityLevel?: string | null;
  temperatureIntent?: string | null;
  humidityFriendly?: boolean | null;
  occasionContext?: string[] | null;
  problemSolutions?: string[] | null;
  functionFeatures?: string[] | null;
  colorShade?: string | null;
  colorUndertone?: string | null;
  multicolor?: boolean | null;
  seasonalPalette?: string | null;
}): SearchResultItem {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    imageUrl: '', // Not needed for embedding
    productUrl: '', // Not needed for embedding
    priceCents: 0, // Not needed for embedding
    currency: 'USD', // Not needed for embedding
    category: product.category,
    subcategory: product.subcategory ?? undefined,
    stockStatus: 'in_stock', // Not needed for embedding
    attributes: product.attributes as Record<string, unknown>,
    enrichedColor: product.enrichedColor ?? undefined,
    ageGroup: product.ageGroup ?? undefined,
    length: product.length ?? undefined,
    formalityLevel: product.formalityLevel ?? undefined,
    temperatureIntent: product.temperatureIntent ?? undefined,
    humidityFriendly: product.humidityFriendly ?? undefined,
    occasionContext: product.occasionContext ?? undefined,
    problemSolutions: product.problemSolutions ?? undefined,
    functionFeatures: product.functionFeatures ?? undefined,
    colorShade: product.colorShade ?? undefined,
    colorUndertone: product.colorUndertone ?? undefined,
    multicolor: product.multicolor ?? undefined,
    seasonalPalette: product.seasonalPalette ?? undefined,
  };
}

/**
 * Update embeddings for a batch of products
 * 
 * Uses Prisma transaction with individual parameterized UPDATEs for safety and correctness.
 * pgvector requires the array format: '[0.1,0.2,...]'::vector
 */
async function updateEmbeddingsBatch(
  updates: Array<{ productId: string; embedding: number[] }>,
  dryRun: boolean
): Promise<number> {
  if (updates.length === 0) return 0;
  
  if (dryRun) {
    logger.debug('backfillProductEmbeddings: dry run - would update embeddings', {
      count: updates.length,
      productIds: updates.map(u => u.productId),
    });
    return updates.length;
  }
  
  // Use individual updates (Prisma transaction with raw SQL can be complex)
  // pgvector requires array format: '[0.1,0.2,...]'::vector
  // Process sequentially to avoid overwhelming the database
  let succeeded = 0;
  
  for (const update of updates) {
    try {
      // Format embedding as PostgreSQL array string: '[0.1,0.2,...]'
      const embeddingArray = `[${update.embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "Product" SET embedding = $1::vector WHERE id = $2`,
        embeddingArray,
        update.productId
      );
      succeeded++;
    } catch (err) {
      logger.error('backfillProductEmbeddings: update failed', {
        productId: update.productId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue with other products
    }
  }
  
  return succeeded;
}

/**
 * Backfill embeddings for products without embeddings
 * 
 * Idempotent: only processes products where `embedding IS NULL`.
 * Processes in batches with pagination to handle large catalogs efficiently.
 * 
 * @param options - Backfill options
 * @returns Summary of backfill operation
 */
export async function backfillProductEmbeddings(
  options: EmbeddingBackfillOptions = {}
): Promise<EmbeddingBackfillResult> {
  const { merchantId, batchSize = DEFAULT_BATCH_SIZE, dryRun = false } = options;
  
  // Validate configuration
  if (!env.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required for embedding generation');
  }
  
  const result: EmbeddingBackfillResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  
  const startTime = Date.now();
  
  logger.info('backfillProductEmbeddings: starting', {
    merchantId: merchantId || 'all merchants',
    batchSize,
    dryRun,
  });
  
  try {
    // Paginate through products with NULL embeddings
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      // Fetch batch of products with NULL embeddings
      const whereConditions = ['p.embedding IS NULL', 'p."isActive" = true'];
      const params: unknown[] = [];
      let paramIndex = 1;
      
      if (merchantId) {
        whereConditions.push(`p."merchantId" = $${paramIndex}`);
        params.push(merchantId);
        paramIndex++;
      }
      
      const query = `
        SELECT 
          p.id,
          p.title,
          p.description,
          p.category,
          p.subcategory,
          p.attributes,
          p."enrichedColor",
          p."ageGroup",
          p.length,
          p."formalityLevel",
          p."temperatureIntent",
          p."humidityFriendly",
          p."occasionContext",
          p."problemSolutions",
          p."functionFeatures",
          p."colorShade",
          p."colorUndertone",
          p.multicolor,
          p."seasonalPalette"
        FROM "Product" p
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY p."createdAt" ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(batchSize, offset);
      
      const products = await prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        description: string;
        category: string;
        subcategory: string | null;
        attributes: unknown;
        enrichedColor: string | null;
        ageGroup: string | null;
        length: string | null;
        formalityLevel: string | null;
        temperatureIntent: string | null;
        humidityFriendly: boolean | null;
        occasionContext: string[] | null;
        problemSolutions: string[] | null;
        functionFeatures: string[] | null;
        colorShade: string | null;
        colorUndertone: string | null;
        multicolor: boolean | null;
        seasonalPalette: string | null;
      }>>(query, ...params);
      
      if (products.length === 0) {
        hasMore = false;
        break;
      }
      
      logger.info('backfillProductEmbeddings: processing batch', {
        batchNumber: Math.floor(offset / batchSize) + 1,
        batchSize: products.length,
        offset,
        merchantId: merchantId || 'all',
      });
      
      // Process products in this batch
      const batchUpdates: Array<{ productId: string; embedding: number[] }> = [];
      const batchErrors: Array<{ productId: string; error: string }> = [];
      
      for (const product of products) {
        result.processed++;
        
        try {
          // Build indexed text using same logic as vector search
          const searchResultItem = buildSearchResultItemFromDb(product);
          const indexedText = buildIndexedText(searchResultItem);
          
          if (!indexedText || indexedText.trim().length === 0) {
            logger.warn('backfillProductEmbeddings: empty indexed text', {
              productId: product.id,
            });
            result.failed++;
            batchErrors.push({
              productId: product.id,
              error: 'Empty indexed text',
            });
            continue;
          }
          
          // Generate embedding
          const embedding = await embedText(indexedText);
          
          if (!embedding || embedding.length === 0) {
            throw new Error('Empty embedding returned from API');
          }
          
          batchUpdates.push({
            productId: product.id,
            embedding,
          });
          
          logger.debug('backfillProductEmbeddings: generated embedding', {
            productId: product.id,
            embeddingLength: embedding.length,
          });
        } catch (error) {
          result.failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          batchErrors.push({
            productId: product.id,
            error: errorMessage,
          });
          
          logger.error('backfillProductEmbeddings: error processing product', {
            productId: product.id,
            error: errorMessage,
          });
          
          // Continue with other products in batch
        }
      }
      
      // Update embeddings in bulk for this batch
      if (batchUpdates.length > 0) {
        const updated = await updateEmbeddingsBatch(batchUpdates, dryRun);
        result.succeeded += updated;
        
        if (!dryRun) {
          logger.info('backfillProductEmbeddings: batch updated', {
            updated,
            batchSize: batchUpdates.length,
          });
        }
      }
      
      // Collect errors
      result.errors.push(...batchErrors);
      
      // Move to next page
      // IMPORTANT: Increment offset by actual products fetched, not batchSize
      // This ensures we don't skip products if a batch returns fewer items
      offset += products.length;
      hasMore = products.length === batchSize;
      
      // Small delay between batches to avoid rate limits
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    
    const duration = Date.now() - startTime;
    logger.info('backfillProductEmbeddings: complete', {
      merchantId: merchantId || 'all merchants',
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      duration,
      dryRun,
    });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('backfillProductEmbeddings: fatal error', {
      error: error instanceof Error ? error.message : String(error),
      merchantId: merchantId || 'all merchants',
      duration,
    });
    throw error;
  }
}
