import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';

type ProductClickFilters = {
  category?: string;
  subcategory?: string;
  brand?: string;
  priceMin?: number;
  priceMax?: number;
  dateRange?: '7d' | '30d' | 'all';
};

type SortOption = 'clicks_desc' | 'clicks_asc' | 'title_asc' | 'title_desc' | 'price_asc' | 'price_desc';

export async function GET(request: NextRequest) {
  try {
    // Require authentication (any authenticated user can view metrics)
    const session = await requireAuth(request);
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') || undefined;
    const subcategory = searchParams.get('subcategory') || undefined;
    const brand = searchParams.get('brand') || undefined;
    // Convert dollars to cents for price filters
    const priceMin = searchParams.get('priceMin') ? Math.round(parseFloat(searchParams.get('priceMin')!) * 100) : undefined;
    const priceMax = searchParams.get('priceMax') ? Math.round(parseFloat(searchParams.get('priceMax')!) * 100) : undefined;
    const dateRange = (searchParams.get('dateRange') as '7d' | '30d' | 'all') || '30d';
    const sortBy = (searchParams.get('sortBy') as SortOption) || 'clicks_desc';
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100;

    // Calculate date filter
    let dateFilter: Date | undefined;
    if (dateRange === '7d') {
      dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateRange === '30d') {
      dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all clicked products with their click counts (filtered by merchantId)
    const clickedEvents = await prisma.conversationEvent.findMany({
      where: {
        merchantId: session.merchantId,
        clicked: true,
        clickedProductId: { not: null },
        ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
      },
      select: {
        clickedProductId: true,
        createdAt: true,
      },
    });

    // Count clicks per product
    const clickCounts = new Map<string, number>();
    for (const event of clickedEvents) {
      if (event.clickedProductId) {
        clickCounts.set(event.clickedProductId, (clickCounts.get(event.clickedProductId) || 0) + 1);
      }
    }

    // Get filter options early (before checking if there are clicks)
    // This ensures filter options are always available
    // Use distinct queries to get unique values efficiently
    const allProductsForFilters = await prisma.product.findMany({
      where: {
        merchantId: session.merchantId,
        isActive: true,
      },
      select: {
        category: true,
        subcategory: true,
        brand: true,
      },
      take: 10000, // Limit to prevent memory issues with very large catalogs
    });

    // Extract unique values for filter options
    const categories = Array.from(new Set(allProductsForFilters.map((p) => p.category).filter(Boolean))).sort() as string[];
    const subcategories = Array.from(new Set(allProductsForFilters.map((p) => p.subcategory).filter(Boolean))).sort() as string[];
    const brands = Array.from(new Set(allProductsForFilters.map((p) => p.brand).filter(Boolean))).sort() as string[];

    if (clickCounts.size === 0) {
      return NextResponse.json({
        products: [],
        totalProducts: 0,
        totalClicks: 0,
        filterOptions: {
          categories,
          subcategories,
          brands,
        },
      });
    }

    // Get product details for clicked products
    const productIds = Array.from(clickCounts.keys());
    
    // Build where clause for filters (include merchantId)
    const whereClause: any = {
      merchantId: session.merchantId,
      id: { in: productIds },
      isActive: true,
    };

    if (category) {
      whereClause.category = { contains: category, mode: 'insensitive' };
    }
    if (subcategory) {
      whereClause.subcategory = { contains: subcategory, mode: 'insensitive' };
    }
    if (brand) {
      whereClause.brand = { contains: brand, mode: 'insensitive' };
    }
    if (priceMin !== undefined || priceMax !== undefined) {
      whereClause.priceCents = {};
      if (priceMin !== undefined) {
        whereClause.priceCents.gte = priceMin;
      }
      if (priceMax !== undefined) {
        whereClause.priceCents.lte = priceMax;
      }
    }

    const products = await prisma.product.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        priceCents: true,
        salePriceCents: true,
        currency: true,
        category: true,
        subcategory: true,
        brand: true,
        imageUrl: true,
      },
    });

    // Combine product data with click counts
    const productsWithClicks = products
      .map((product) => ({
        ...product,
        clickCount: clickCounts.get(product.id) || 0,
      }))
      .filter((p) => p.clickCount > 0);

    // Sort products
    let sorted = [...productsWithClicks];
    switch (sortBy) {
      case 'clicks_desc':
        sorted.sort((a, b) => b.clickCount - a.clickCount);
        break;
      case 'clicks_asc':
        sorted.sort((a, b) => a.clickCount - b.clickCount);
        break;
      case 'title_asc':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'title_desc':
        sorted.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'price_asc':
        sorted.sort((a, b) => {
          const priceA = a.salePriceCents || a.priceCents;
          const priceB = b.salePriceCents || b.priceCents;
          return priceA - priceB;
        });
        break;
      case 'price_desc':
        sorted.sort((a, b) => {
          const priceA = a.salePriceCents || a.priceCents;
          const priceB = b.salePriceCents || b.priceCents;
          return priceB - priceA;
        });
        break;
    }

    // Apply limit
    const limited = sorted.slice(0, limit);

    const totalClicks = Array.from(clickCounts.values()).reduce((sum, count) => sum + count, 0);

    logger.debug('product_clicks_metrics_fetched', {
      productCount: limited.length,
      totalClicks,
      filters: { category, subcategory, brand, priceMin, priceMax, dateRange },
      sortBy,
    });

    return NextResponse.json({
      products: limited,
      totalProducts: productsWithClicks.length,
      totalClicks,
      filterOptions: {
        categories,
        subcategories,
        brands,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('product_clicks_metrics_failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to fetch product click metrics', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

