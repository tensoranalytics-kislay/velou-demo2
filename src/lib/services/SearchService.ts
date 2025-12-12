/**
 * SearchService
 * 
 * Wraps the search functionality with merchantId filtering.
 * This ensures all search results are scoped to a specific merchant.
 * 
 * The underlying search logic remains unchanged - we just filter results by merchantId.
 */

import { searchProducts as searchProductsCore } from '../search';
import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type { SearchConstraints, ProductSearchResult } from '../search/types';

/**
 * Search products for a merchant
 * 
 * This wraps the existing searchProducts function and filters results by merchantId.
 * All search logic (ranking, filtering, relaxation) remains unchanged.
 * 
 * @param merchantId - Merchant ID (required for multi-tenant isolation)
 * @param constraints - Search constraints
 * @param userMessage - Optional user message for context
 * @returns Search results filtered by merchantId
 */
export async function searchProducts(
  merchantId: string,
  constraints: SearchConstraints = {},
  userMessage?: string
): Promise<ProductSearchResult> {
  try {
    // Verify merchant exists
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });

    if (!merchant) {
      logger.warn('search_merchant_not_found', { merchantId });
      return {
        products: [],
        wasRelaxed: false,
      };
    }

    // Call the core search function with merchantId
    // The core function now filters by merchantId at the database level
    const result = await searchProductsCore(constraints, userMessage, merchantId);

    logger.debug('search_products_complete', {
      merchantId,
      resultCount: result.products.length,
      wasRelaxed: result.wasRelaxed,
    });

    return result;
  } catch (error) {
    logger.error('search_products_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to search products');
  }
}

/**
 * Example usage in API route:
 * 
 * ```typescript
 * import { searchProducts } from '@/lib/services/SearchService';
 * import { requireAuth } from '@/middleware/auth';
 * 
 * export async function POST(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const body = await request.json();
 *     
 *     const results = await searchProducts(session.merchantId, {
 *       query: body.query,
 *       category: body.category,
 *       priceMinCents: body.priceMin,
 *       priceMaxCents: body.priceMax,
 *     });
 *     
 *     return NextResponse.json(results);
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
 *   }
 * }
 * ```
 */

