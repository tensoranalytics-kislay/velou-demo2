/**
 * GET /api/widget/{merchantId}/config
 * 
 * Returns widget configuration for the merchant (branding, colors, etc.).
 * Requires API key authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWidgetAuth, createWidgetAuthErrorResponse, WidgetAuthError } from '@/middleware/widgetAuth';
import { widgetCorsHeaders } from '@/middleware/widgetCors';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

/**
 * Handle OPTIONS preflight request
 */
export async function OPTIONS(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
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
export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const startTime = Date.now();
  let auth: Awaited<ReturnType<typeof requireWidgetAuth>> | null = null;
  let merchantId: string | undefined;

  try {
    // Authenticate request
    const resolvedParams = await params;
    merchantId = resolvedParams.merchantId;
    auth = await requireWidgetAuth(request, merchantId);
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth.apiKey.allowedOrigins);

    // Get merchant configuration
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        name: true,
        brandName: true,
        primaryColor: true,
        accentColor: true,
        backgroundColor: true,
        surfaceColor: true,
        borderColor: true,
        logoUrl: true,
        voiceInstructions: true,
        toneFormal: true,
        tonePlayful: true,
      },
    });

    if (!merchant) {
      logger.warn('widget_config_merchant_not_found', {
        merchantId: merchantId!,
      });
      return NextResponse.json(
        { error: 'Merchant not found' },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const duration = Date.now() - startTime;
    logger.info('widget_config_success', {
      merchantId: merchantId!,
      duration,
    });

    return NextResponse.json(
      {
        merchantName: merchant.name,
        brandColors: {
          primary: merchant.primaryColor,
          accent: merchant.accentColor,
          background: merchant.backgroundColor,
          surface: merchant.surfaceColor,
          border: merchant.borderColor,
        },
        voiceInstructions: merchant.voiceInstructions,
        toneFormal: merchant.toneFormal,
        tonePlayful: merchant.tonePlayful,
        logoUrl: merchant.logoUrl || undefined,
      },
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_config_auth_failed', {
        merchantId: merchantId!,
        status: error.status,
        duration,
      });
      return createWidgetAuthErrorResponse(error);
    }

    logger.error('widget_config_error', {
      merchantId: merchantId ?? 'unknown',
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth?.apiKey.allowedOrigins || []);

    return NextResponse.json(
      { error: 'Failed to load configuration' },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

