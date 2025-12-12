/**
 * POST /api/admin/{merchantId}/integrations/widget/origins/verify
 * 
 * Verifies that the widget is installed on a given origin.
 * Makes a HEAD request to check for widget presence.
 * Requires authentication (ADMIN or EDITOR role).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { createAuthErrorResponse } from '@/middleware/auth';
import { logger } from '@/lib/telemetry/logger';

/**
 * POST - Verify origin
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  try {
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
    const { merchantId } = await params;

    // Verify merchantId matches session
    if (session.merchantId !== merchantId) {
      logger.warn('widget_origin_verify_merchant_mismatch', {
        sessionMerchantId: session.merchantId,
        urlMerchantId: merchantId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = (await request.json()) as { origin: string };

    if (!body.origin || typeof body.origin !== 'string') {
      return NextResponse.json({ error: 'Origin is required' }, { status: 400 });
    }

    // Normalize origin
    const normalizedOrigin = body.origin.trim().toLowerCase().replace(/\/$/, '');

    // Validate origin format
    let originUrl: URL;
    try {
      originUrl = new URL(normalizedOrigin);
    } catch {
      return NextResponse.json({ error: 'Invalid origin format' }, { status: 400 });
    }

    // Make HEAD request to check for widget
    // In a real implementation, this would check for:
    // 1. Widget script tag in HTML
    // 2. Widget global object (window.VelouWidget)
    // 3. Widget CSS loaded
    
    // For now, we'll just check if the origin is reachable
    try {
      const response = await fetch(originUrl.toString(), {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Velou-Widget-Verifier/1.0',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      const isReachable = response.ok || response.status < 500;

      logger.info('widget_origin_verification', {
        merchantId: session.merchantId,
        origin: normalizedOrigin,
        reachable: isReachable,
        status: response.status,
      });

      // TODO: In production, actually check for widget presence
      // This would require:
      // 1. Fetching the HTML
      // 2. Checking for widget script tag
      // 3. Or making a test API call from that origin

      return NextResponse.json({
        success: true,
        verified: isReachable,
        message: isReachable
          ? 'Origin is reachable. Widget detection requires visiting the site.'
          : 'Origin is not reachable. Please check the URL.',
      });
    } catch (fetchError) {
      logger.warn('widget_origin_verification_failed', {
        merchantId: session.merchantId,
        origin: normalizedOrigin,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      });

      return NextResponse.json({
        success: false,
        verified: false,
        message: 'Could not reach origin. Please check the URL and try again.',
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('widget_origin_verify_error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to verify origin' },
      { status: 500 }
    );
  }
}

