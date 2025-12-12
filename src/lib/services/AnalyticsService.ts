/**
 * AnalyticsService
 * 
 * Handles all analytics and metrics operations including:
 * - Event tracking
 * - Conversation analytics
 * - Product analytics
 * - Top queries and products
 * 
 * All operations are scoped to a specific merchantId for multi-tenant isolation.
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type { AnalyticsEvent, ConversationEvent, Product } from '@prisma/client';

export type DateRange = {
  start: Date;
  end: Date;
};

export type AnalyticsSnapshot = {
  totalConversations: number;
  totalMessages: number;
  totalClicks: number;
  averageResponseTime?: number;
  topQueries: Array<{ query: string; count: number }>;
  topProducts: Array<{ productId: string; clicks: number }>;
};

export type ProductAnalytics = {
  productId: string;
  totalClicks: number;
  totalViews: number;
  clickThroughRate: number;
  lastClicked?: Date;
  queries: Array<{ query: string; count: number }>;
};

/**
 * Track an analytics event
 * 
 * @param merchantId - Merchant ID
 * @param event - Event data
 */
export async function trackEvent(
  merchantId: string,
  event: Omit<AnalyticsEvent, 'id' | 'merchantId' | 'createdAt'>
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        merchant: { connect: { id: merchantId } },
        sessionId: event.sessionId,
        eventType: event.eventType,
        payload: event.payload as any,
        userDevice: event.userDevice,
        userPage: event.userPage,
        userReferer: event.userReferer,
      },
    });

    logger.debug('analytics_event_tracked', {
      merchantId,
      eventType: event.eventType,
      sessionId: event.sessionId,
    });
  } catch (error) {
    logger.error('track_event_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - analytics failures shouldn't break the app
  }
}

/**
 * Get conversation analytics for a merchant
 * 
 * @param merchantId - Merchant ID
 * @param dateRange - Date range for analytics
 * @returns Analytics snapshot
 */
export async function getConversationAnalytics(
  merchantId: string,
  dateRange: DateRange
): Promise<AnalyticsSnapshot> {
  try {
    // Get conversation events in date range
    const events = await prisma.conversationEvent.findMany({
      where: {
        merchantId,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    });

    // Calculate metrics
    const uniqueSessions = new Set(events.map((e) => e.sessionId));
    const totalConversations = uniqueSessions.size;
    const totalMessages = events.length;
    const totalClicks = events.filter((e) => e.clicked).length;

    // Get top queries
    const queryCounts = new Map<string, number>();
    events.forEach((event) => {
      const query = event.userQuery;
      queryCounts.set(query, (queryCounts.get(query) || 0) + 1);
    });

    const topQueries = Array.from(queryCounts.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get top products by clicks
    const productClicks = new Map<string, number>();
    events.forEach((event) => {
      if (event.clickedProductId) {
        productClicks.set(
          event.clickedProductId,
          (productClicks.get(event.clickedProductId) || 0) + 1
        );
      }
    });

    const topProducts = Array.from(productClicks.entries())
      .map(([productId, clicks]) => ({ productId, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    return {
      totalConversations,
      totalMessages,
      totalClicks,
      topQueries,
      topProducts,
    };
  } catch (error) {
    logger.error('get_conversation_analytics_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get conversation analytics');
  }
}

/**
 * Get analytics for a specific product
 * 
 * @param merchantId - Merchant ID
 * @param productId - Product ID
 * @returns Product analytics
 */
export async function getProductAnalytics(
  merchantId: string,
  productId: string
): Promise<ProductAnalytics> {
  try {
    // Verify product belongs to merchant
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        merchantId,
      },
    });

    if (!product) {
      throw new Error('Product not found');
    }

    // Get all events for this product
    const clickEvents = await prisma.conversationEvent.findMany({
      where: {
        merchantId,
        clickedProductId: productId,
        clicked: true,
      },
    });

    // Get view events for this product
    // Note: JSON filtering in Prisma is limited, so we fetch and filter in memory
    const allViewEvents = await prisma.analyticsEvent.findMany({
      where: {
        merchantId,
        eventType: 'product_viewed',
      },
    });

    const viewEvents = allViewEvents.filter((event) => {
      const payload = event.payload as any;
      return payload?.productId === productId;
    });

    const totalClicks = clickEvents.length;
    const totalViews = viewEvents.length;
    const clickThroughRate = totalViews > 0 ? totalClicks / totalViews : 0;
    const lastClicked = clickEvents.length > 0
      ? clickEvents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].createdAt
      : undefined;

    // Get queries that led to this product
    const queries = new Map<string, number>();
    clickEvents.forEach((event) => {
      const query = event.userQuery;
      queries.set(query, (queries.get(query) || 0) + 1);
    });

    const queryList = Array.from(queries.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count);

    return {
      productId,
      totalClicks,
      totalViews,
      clickThroughRate,
      lastClicked,
      queries: queryList,
    };
  } catch (error) {
    logger.error('get_product_analytics_failed', {
      merchantId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get product analytics');
  }
}

/**
 * Get top queries for a merchant
 * 
 * @param merchantId - Merchant ID
 * @param limit - Number of queries to return
 * @returns Array of top queries
 */
export async function getTopQueries(
  merchantId: string,
  limit: number = 10
): Promise<string[]> {
  try {
    const events = await prisma.conversationEvent.findMany({
      where: {
        merchantId,
      },
      select: {
        userQuery: true,
      },
      take: 1000, // Sample size
    });

    const queryCounts = new Map<string, number>();
    events.forEach((event) => {
      const query = event.userQuery;
      queryCounts.set(query, (queryCounts.get(query) || 0) + 1);
    });

    return Array.from(queryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query]) => query);
  } catch (error) {
    logger.error('get_top_queries_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get top queries');
  }
}

/**
 * Get top products by clicks for a merchant
 * 
 * @param merchantId - Merchant ID
 * @param limit - Number of products to return
 * @returns Array of top products
 */
export async function getTopProducts(
  merchantId: string,
  limit: number = 10
): Promise<Product[]> {
  try {
    // Get click events
    const clickEvents = await prisma.conversationEvent.findMany({
      where: {
        merchantId,
        clicked: true,
        clickedProductId: { not: null },
      },
      select: {
        clickedProductId: true,
      },
    });

    // Count clicks per product
    const productClicks = new Map<string, number>();
    clickEvents.forEach((event) => {
      if (event.clickedProductId) {
        productClicks.set(
          event.clickedProductId,
          (productClicks.get(event.clickedProductId) || 0) + 1
        );
      }
    });

    // Get top product IDs
    const topProductIds = Array.from(productClicks.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([productId]) => productId);

    // Fetch products
    const products = await prisma.product.findMany({
      where: {
        merchantId,
        id: { in: topProductIds },
        isActive: true,
      },
    });

    // Sort by click count
    const sortedProducts = products.sort((a, b) => {
      const clicksA = productClicks.get(a.id) || 0;
      const clicksB = productClicks.get(b.id) || 0;
      return clicksB - clicksA;
    });

    return sortedProducts;
  } catch (error) {
    logger.error('get_top_products_failed', {
      merchantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to get top products');
  }
}

/**
 * Example usage in API route:
 * 
 * ```typescript
 * import { getConversationAnalytics, trackEvent } from '@/lib/services/AnalyticsService';
 * import { requireAuth } from '@/middleware/auth';
 * 
 * export async function GET(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const { searchParams } = new URL(request.url);
 *     
 *     const analytics = await getConversationAnalytics(session.merchantId, {
 *       start: new Date(searchParams.get('start') || Date.now() - 30 * 24 * 60 * 60 * 1000),
 *       end: new Date(searchParams.get('end') || Date.now()),
 *     });
 *     
 *     return NextResponse.json(analytics);
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to get analytics' }, { status: 500 });
 *   }
 * }
 * 
 * export async function POST(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const body = await request.json();
 *     
 *     await trackEvent(session.merchantId, {
 *       sessionId: body.sessionId,
 *       eventType: body.eventType,
 *       payload: body.payload,
 *     });
 *     
 *     return NextResponse.json({ success: true });
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to track event' }, { status: 500 });
 *   }
 * }
 * ```
 */

