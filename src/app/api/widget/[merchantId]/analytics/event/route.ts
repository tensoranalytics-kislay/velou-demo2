/**
 * POST /api/widget/{merchantId}/analytics/event
 * 
 * Records analytics events from the widget.
 * Requires API key authentication.
 * Fire-and-forget - never blocks user interaction.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWidgetAuth, createWidgetAuthErrorResponse, WidgetAuthError } from '@/middleware/widgetAuth';
import { widgetCorsHeaders } from '@/middleware/widgetCors';
import { trackEvent } from '@/lib/services/AnalyticsService';
import { logger } from '@/lib/telemetry/logger';

type AnalyticsEventRequest = {
  sessionId: string;
  eventType: string;
  payload?: Record<string, any>;
  userDevice?: string;
  userPage?: string;
  userReferer?: string;
  createdAt?: number;
};

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
 * POST handler
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const startTime = Date.now();
  let auth: Awaited<ReturnType<typeof requireWidgetAuth>> | null = null;
  let merchantId: string | null = null;

  try {
    // Authenticate request
    const resolvedParams = await params;
    merchantId = resolvedParams.merchantId;
    auth = await requireWidgetAuth(request, merchantId);
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth.apiKey.allowedOrigins);

    // Parse request body
    const body = (await request.json()) as AnalyticsEventRequest;

    // Validate required fields
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return NextResponse.json(
        { error: 'Session ID is required' },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    if (!body.eventType || typeof body.eventType !== 'string') {
      return NextResponse.json(
        { error: 'Event type is required' },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // Validate payload if provided
    if (body.payload !== undefined && typeof body.payload !== 'object') {
      return NextResponse.json(
        { error: 'Payload must be an object' },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // Track event (fire and forget - don't await)
    trackEvent(merchantId, {
      sessionId: body.sessionId,
      eventType: body.eventType,
      payload: body.payload || {},
      userDevice: body.userDevice || request.headers.get('User-Agent') || null,
      userPage: body.userPage || request.headers.get('Referer') || null,
      userReferer: body.userReferer || request.headers.get('Referer') || null,
    }).catch((error) => {
      // Silently fail - analytics should never block responses
      logger.warn('widget_analytics_track_failed', {
        merchantId,
        eventType: body.eventType,
        sessionId: body.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    const duration = Date.now() - startTime;
    logger.info('widget_analytics_event_received', {
      merchantId,
      eventType: body.eventType,
      sessionId: body.sessionId,
      duration,
    });

    // Always return success immediately (fire and forget)
    return NextResponse.json(
      { success: true },
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_analytics_auth_failed', {
        merchantId: merchantId || 'unknown',
        status: error.status,
        duration,
      });
      return createWidgetAuthErrorResponse(error);
    }

    logger.error('widget_analytics_error', {
      merchantId: merchantId || 'unknown',
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    // Even on error, return success (fire and forget)
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth?.apiKey.allowedOrigins || []);

    return NextResponse.json(
      { success: true },
      {
        headers: corsHeaders,
      }
    );
  }
}

