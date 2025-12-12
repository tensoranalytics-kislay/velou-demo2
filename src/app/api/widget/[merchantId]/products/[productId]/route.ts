/**
 * GET /api/widget/{merchantId}/products/{productId}
 * 
 * Returns full product details for a specific product.
 * Requires API key authentication.
 * Used when user clicks "Ask about product" in the widget.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWidgetAuth, createWidgetAuthErrorResponse, WidgetAuthError } from '@/middleware/widgetAuth';
import { widgetCorsHeaders } from '@/middleware/widgetCors';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

/**
 * Handle OPTIONS preflight request
 */
export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string; productId: string }> }
) {
  try {
    const { merchantId } = await params;
    const auth = await requireWidgetAuth(request, merchantId);
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth.apiKey.allowedOrigins);
    
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  } catch (error) {
    const origin = request.headers.get('Origin');
    return new Response(null, {
      status: 204,
      headers: widgetCorsHeaders(origin, []),
    });
  }
}

/**
 * GET handler
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string; productId: string }> }
) {
  const startTime = Date.now();
  let auth: Awaited<ReturnType<typeof requireWidgetAuth>> | null = null;
  let merchantId: string | undefined;
  let productId: string | undefined;

  try {
    // Authenticate request
    const resolvedParams = await params;
    merchantId = resolvedParams.merchantId;
    productId = resolvedParams.productId;
    auth = await requireWidgetAuth(request, merchantId);
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth.apiKey.allowedOrigins);

    // Get product (scoped to merchant)
    const product = await prisma.product.findFirst({
      where: {
        id: productId!,
        merchantId: merchantId!,
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        priceCents: true,
        salePriceCents: true,
        currency: true,
        category: true,
        subcategory: true,
        brand: true,
        attributes: true,
        stockStatus: true,
        productUrl: true,
        reviewScore: true,
        reviewCount: true,
      },
    });

    if (!product) {
      logger.warn('widget_product_not_found', {
        merchantId: merchantId ?? 'unknown',
        productId: productId ?? 'unknown',
      });
      return NextResponse.json(
        { error: 'Product not found' },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const duration = Date.now() - startTime;
    logger.info('widget_product_success', {
      merchantId: merchantId!,
      productId: productId!,
      duration,
    });

    return NextResponse.json(
      {
        id: product.id,
        title: product.title,
        description: product.description,
        imageUrl: product.imageUrl,
        priceCents: product.priceCents,
        salePriceCents: product.salePriceCents,
        currency: product.currency,
        category: product.category,
        subcategory: product.subcategory,
        brand: product.brand,
        attributes: product.attributes,
        stockStatus: product.stockStatus,
        productUrl: product.productUrl,
        reviewScore: product.reviewScore,
        reviewCount: product.reviewCount,
      },
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_product_auth_failed', {
        merchantId: merchantId ?? 'unknown',
        productId: productId ?? 'unknown',
        status: error.status,
        duration,
      });
      return createWidgetAuthErrorResponse(error);
    }

    logger.error('widget_product_error', {
      merchantId,
      productId,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth?.apiKey.allowedOrigins || []);

    return NextResponse.json(
      { error: 'Failed to load product' },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

