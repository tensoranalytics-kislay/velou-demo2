/**
 * POST /api/admin/{merchantId}/integrations/widget/regenerate
 * 
 * Regenerates the API key for widget authentication.
 * Requires authentication (ADMIN role only - destructive operation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { createAuthErrorResponse } from '@/middleware/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

/**
 * POST - Regenerate API key
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> }
) {
  try {
    // Require ADMIN role for key regeneration (destructive operation)
    const session = await requireRoleForRequest(request, ['ADMIN']);
    const { merchantId } = await params;

    // Verify merchantId matches session
    if (session.merchantId !== merchantId) {
      logger.warn('widget_regenerate_merchant_mismatch', {
        sessionMerchantId: session.merchantId,
        urlMerchantId: merchantId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = (await request.json()) as { apiKeyId?: string };

    // Get API key to regenerate
    let apiKey;
    if (body.apiKeyId) {
      apiKey = await prisma.apiKey.findFirst({
        where: {
          id: body.apiKeyId,
          merchantId: session.merchantId,
        },
      });
    } else {
      // Get primary active key
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

    // Generate new token
    const { randomBytes } = await import('crypto');
    const randomPart = randomBytes(16).toString('hex');
    const newToken = `pk_live_${randomPart}`;

    // Update API key with new token
    const updated = await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        token: newToken,
      },
      select: {
        id: true,
        name: true,
        token: true,
        allowedOrigins: true,
        createdAt: true,
      },
    });

    logger.info('widget_api_key_regenerated', {
      merchantId: session.merchantId,
      apiKeyId: apiKey.id,
      userId: session.userId,
    });

    return NextResponse.json({
      success: true,
      apiKey: updated.token,
      message: 'API key regenerated successfully. Update your widget installation with the new key.',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('widget_api_key_regenerate_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Failed to regenerate API key' },
      { status: 500 }
    );
  }
}

