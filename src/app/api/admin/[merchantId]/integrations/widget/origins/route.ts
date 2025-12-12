/**
 * POST /api/admin/{merchantId}/integrations/widget/origins
 * DELETE /api/admin/{merchantId}/integrations/widget/origins
 * 
 * Add or remove allowed origins for widget CORS.
 * Requires authentication (ADMIN or EDITOR role).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { createAuthErrorResponse } from '@/middleware/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

/**
 * POST - Add a new origin
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
      logger.warn('widget_origin_add_merchant_mismatch', {
        sessionMerchantId: session.merchantId,
        urlMerchantId: merchantId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = (await request.json()) as { origin: string; apiKeyId?: string };

    if (!body.origin || typeof body.origin !== 'string') {
      return NextResponse.json({ error: 'Origin is required' }, { status: 400 });
    }

    // Normalize origin (remove trailing slash, convert to lowercase)
    const normalizedOrigin = body.origin.trim().toLowerCase().replace(/\/$/, '');

    // Validate origin format
    try {
      new URL(normalizedOrigin);
    } catch {
      return NextResponse.json({ error: 'Invalid origin format. Must be a valid URL (e.g., https://example.com)' }, { status: 400 });
    }

    // Get API key (use provided ID or find primary key)
    let apiKey;
    if (body.apiKeyId) {
      apiKey = await prisma.apiKey.findFirst({
        where: {
          id: body.apiKeyId,
          merchantId: session.merchantId,
        },
      });
    } else {
      apiKey = await prisma.apiKey.findFirst({
        where: {
          merchantId: session.merchantId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Check if origin already exists
    if (apiKey.allowedOrigins.includes(normalizedOrigin)) {
      return NextResponse.json({ error: 'Origin already exists' }, { status: 400 });
    }

    // Add origin
    const updated = await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        allowedOrigins: {
          push: normalizedOrigin,
        },
      },
    });

    logger.info('widget_origin_added', {
      merchantId: session.merchantId,
      apiKeyId: apiKey.id,
      origin: normalizedOrigin,
    });

    return NextResponse.json({
      success: true,
      origin: normalizedOrigin,
      allowedOrigins: updated.allowedOrigins,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('widget_origin_add_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to add origin' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove an origin
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  try {
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
    const { merchantId } = await params;

    // Verify merchantId matches session
    if (session.merchantId !== merchantId) {
      logger.warn('widget_origin_remove_merchant_mismatch', {
        sessionMerchantId: session.merchantId,
        urlMerchantId: merchantId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const origin = searchParams.get('origin');
    const apiKeyId = searchParams.get('apiKeyId');

    if (!origin) {
      return NextResponse.json({ error: 'Origin is required' }, { status: 400 });
    }

    // Get API key
    let apiKey;
    if (apiKeyId) {
      apiKey = await prisma.apiKey.findFirst({
        where: {
          id: apiKeyId,
          merchantId: session.merchantId,
        },
      });
    } else {
      apiKey = await prisma.apiKey.findFirst({
        where: {
          merchantId: session.merchantId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Remove origin
    const updated = await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        allowedOrigins: {
          set: apiKey.allowedOrigins.filter((o) => o !== origin),
        },
      },
    });

    logger.info('widget_origin_removed', {
      merchantId: session.merchantId,
      apiKeyId: apiKey.id,
      origin,
    });

    return NextResponse.json({
      success: true,
      allowedOrigins: updated.allowedOrigins,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('widget_origin_remove_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to remove origin' },
      { status: 500 }
    );
  }
}

