/**
 * CatalogService
 * 
 * Handles all catalog-related operations including:
 * - Product CRUD operations
 * - Catalog import from CSV
 * - Catalog statistics
 * 
 * All operations are scoped to a specific merchantId for multi-tenant isolation.
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import { ingestEnrichedCsvStream } from '../catalog/ingestEnrichedCsv';
import { Readable } from 'stream';
import type { Product, IngestionMode } from '@prisma/client';
import type { SearchConstraints } from '../search/types';
import type { EnrichedIngestionSummary } from '../catalog/ingestEnrichedCsv';

/**
 * Get products for a merchant with optional filters
 * 
 * @param merchantId - Merchant ID
 * @param filters - Optional search constraints
 * @returns Array of products
 */
export async function getProducts(
  merchantId: string,
  filters?: SearchConstraints
): Promise<Product[]> {
  try {
    const where: any = {
      merchantId,
      isActive: true,
    };

    // Apply filters if provided
    if (filters) {
      if (filters.category) {
        if (Array.isArray(filters.category)) {
          where.category = { in: filters.category };
        } else {
          where.category = filters.category;
        }
      }
      if (filters.priceMinCents) {
        where.priceCents = { ...where.priceCents, gte: filters.priceMinCents };
      }
      if (filters.priceMaxCents) {
        where.priceCents = { ...where.priceCents, lte: filters.priceMaxCents };
      }
      if (filters.brands?.length) {
        where.brand = { in: filters.brands };
      }
      if (filters.inStockOnly !== false) {
        where.stockStatus = 'in_stock';
      }
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 100,
    });

    return products;
  } catch (error) {
    logger.error('get_products_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get products');
  }
}

/**
 * Get product by ID
 * 
 * @param merchantId - Merchant ID (for verification)
 * @param productId - Product ID
 * @returns Product or null if not found
 */
export async function getProductById(
  merchantId: string,
  productId: string
): Promise<Product | null> {
  try {
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        merchantId,
      },
    });

    if (!product) {
      logger.warn('product_not_found', { merchantId, productId });
      return null;
    }

    return product;
  } catch (error) {
    logger.error('get_product_by_id_failed', {
      merchantId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get product');
  }
}

/**
 * Update product
 * 
 * @param merchantId - Merchant ID (for verification)
 * @param productId - Product ID
 * @param data - Partial product data to update
 * @returns Updated product
 * @throws Error if product not found, doesn't belong to merchant, or update fails
 */
export async function updateProduct(
  merchantId: string,
  productId: string,
  data: Partial<Product>
): Promise<Product> {
  try {
    // Verify product exists and belongs to merchant
    const existing = await getProductById(merchantId, productId);
    if (!existing) {
      throw new Error('Product not found');
    }

    // Remove merchantId from data if present (can't update relation directly)
    const { merchantId: _, ...updateData } = data as any;
    
    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });

    logger.info('product_updated', {
      merchantId,
      productId,
      updatedFields: Object.keys(data),
    });

    return updated;
  } catch (error) {
    logger.error('update_product_failed', {
      merchantId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete product (soft delete by setting isActive = false)
 * 
 * @param merchantId - Merchant ID (for verification)
 * @param productId - Product ID
 * @throws Error if product not found, doesn't belong to merchant, or deletion fails
 */
export async function deleteProduct(
  merchantId: string,
  productId: string
): Promise<void> {
  try {
    // Verify product exists and belongs to merchant
    const existing = await getProductById(merchantId, productId);
    if (!existing) {
      throw new Error('Product not found');
    }

    // Soft delete
    await prisma.product.update({
      where: { id: productId },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });

    logger.info('product_deleted', {
      merchantId,
      productId,
    });
  } catch (error) {
    logger.error('delete_product_failed', {
      merchantId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Import catalog from CSV
 * 
 * @param merchantId - Merchant ID
 * @param file - CSV file buffer
 * @param mode - Import mode (FULL_REPLACE or INCREMENTAL)
 * @param options - Additional import options
 * @returns Import summary
 */
export async function importCatalogCSV(
  merchantId: string,
  file: Buffer,
  mode: IngestionMode,
  options?: {
    vendorId?: string;
    vertical?: string;
    currency?: string;
    enableContextInference?: boolean;
  }
): Promise<EnrichedIngestionSummary> {
  try {
    // Verify merchant exists
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    // Convert buffer to stream
    const stream = Readable.from(file);

    // Use vendorId from options or default to merchantId
    const vendorId = options?.vendorId || merchantId;

    // Import catalog
    const summary = await ingestEnrichedCsvStream(stream, vendorId, merchantId, {
      mode,
    });

    logger.info('catalog_import_complete', {
      merchantId,
      batchId: summary.batchId,
      mode,
      totalRows: summary.totalRows,
      inserted: summary.inserted,
      updated: summary.updated,
    });

    return summary;
  } catch (error) {
    logger.error('catalog_import_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get catalog statistics for a merchant
 * 
 * @param merchantId - Merchant ID
 * @returns Catalog statistics
 */
export async function getCatalogStats(merchantId: string): Promise<{
  totalProducts: number;
  categories: string[];
  verticals: string[];
}> {
  try {
    // Get total products
    const totalProducts = await prisma.product.count({
      where: {
        merchantId,
        isActive: true,
      },
    });

    // Get unique categories
    const products = await prisma.product.findMany({
      where: {
        merchantId,
        isActive: true,
      },
      select: {
        category: true,
      },
      distinct: ['category'],
    });

    const categories = products
      .map((p) => p.category)
      .filter(Boolean)
      .sort();

    // Get vertical from merchant datasetContext
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { datasetContext: true },
    });

    const verticals: string[] = [];
    if (merchant?.datasetContext) {
      const context = merchant.datasetContext as any;
      if (context.vertical) {
        verticals.push(context.vertical);
      }
    }

    return {
      totalProducts,
      categories,
      verticals,
    };
  } catch (error) {
    logger.error('get_catalog_stats_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get catalog statistics');
  }
}

/**
 * Example usage in API route:
 * 
 * ```typescript
 * import { getProducts, importCatalogCSV } from '@/lib/services/CatalogService';
 * import { requireAuth } from '@/middleware/auth';
 * 
 * export async function GET(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const products = await getProducts(session.merchantId);
 *     return NextResponse.json({ products });
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to get products' }, { status: 500 });
 *   }
 * }
 * 
 * export async function POST(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const formData = await request.formData();
 *     const file = formData.get('file') as File;
 *     const buffer = Buffer.from(await file.arrayBuffer());
 *     
 *     const summary = await importCatalogCSV(
 *       session.merchantId,
 *       buffer,
 *       'FULL_REPLACE',
 *       { enableContextInference: true }
 *     );
 *     
 *     return NextResponse.json({ summary });
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to import catalog' }, { status: 500 });
 *   }
 * }
 * ```
 */

