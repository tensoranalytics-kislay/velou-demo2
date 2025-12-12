/**
 * GET /api/admin/{merchantId}/integrations/widget/config
 * 
 * Returns widget configuration including API key and allowed origins.
 * Requires authentication (any authenticated user).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  try {
    const session = await requireAuth(request);
    const { merchantId } = await params;

    // Verify merchantId matches session
    if (session.merchantId !== merchantId) {
      logger.warn('widget_config_merchant_mismatch', {
        sessionMerchantId: session.merchantId,
        urlMerchantId: merchantId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get merchant's active API keys
    const apiKeys = await prisma.apiKey.findMany({
      where: {
        merchantId: session.merchantId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        token: true,
        allowedOrigins: true,
        createdAt: true,
      },
    });

    // Get primary API key (first active key, or create one if none exists)
    let primaryApiKey = apiKeys[0];
    
    if (!primaryApiKey) {
      // Create a default API key if none exists
      const { randomBytes } = await import('crypto');
      const randomPart = randomBytes(16).toString('hex');
      const token = `pk_live_${randomPart}`;

      primaryApiKey = await prisma.apiKey.create({
        data: {
          merchantId: session.merchantId,
          name: 'Default Widget Key',
          token,
          allowedOrigins: [],
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          token: true,
          allowedOrigins: true,
          createdAt: true,
        },
      });
    }

    // Get widget metrics (simplified - in production, query AnalyticsEvent table)
    const metrics = {
      requestsLast24h: 0,
      errorsLast24h: 0,
      avgResponseTime: 0,
    };

    // Get last detected timestamp (from most recent analytics event)
    const lastEvent = await prisma.analyticsEvent.findFirst({
      where: {
        merchantId: session.merchantId,
        eventType: 'widget_loaded',
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    });

    // Determine health status (simplified - in production, use actual metrics)
    let health: 'connected' | 'degraded' | 'disconnected' = 'disconnected';
    if (lastEvent) {
      const hoursSinceLastEvent = (Date.now() - lastEvent.createdAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastEvent < 24) {
        health = metrics.errorsLast24h > 10 ? 'degraded' : 'connected';
      }
    }

    return NextResponse.json({
      apiKey: primaryApiKey.token,
      apiKeyId: primaryApiKey.id,
      apiKeyName: primaryApiKey.name,
      allowedOrigins: primaryApiKey.allowedOrigins.map((origin) => ({
        origin,
        verified: false, // TODO: Implement origin verification
        verifiedAt: null,
      })),
      lastDetected: lastEvent?.createdAt || null,
      health,
      metrics,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('widget_config_fetch_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to load widget configuration' },
      { status: 500 }
    );
  }
}

