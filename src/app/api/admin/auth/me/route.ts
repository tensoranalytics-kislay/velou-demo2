/**
 * GET /api/admin/auth/me
 * 
 * Get current authenticated user information.
 * 
 * Request Headers:
 *   Authorization: Bearer <accessToken>
 * 
 * Response (200):
 *   {
 *     "user": {
 *       "id": "user-123",
 *       "email": "user@example.com",
 *       "role": "ADMIN",
 *       "merchantId": "merchant-123",
 *       "merchant": {
 *         "id": "merchant-123",
 *         "name": "Acme Corporation",
 *         "slug": "acme-corp"
 *       },
 *       "isActive": true,
 *       "lastLogin": "2024-12-06T12:00:00Z"
 *     }
 *   }
 * 
 * Errors:
 *   - 401: Unauthorized (invalid or missing token)
 *   - 404: User not found
 *   - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/middleware/auth';
import { createAuthErrorResponse } from '@/middleware/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

export async function GET(request: NextRequest) {
  try {
    // Require authentication
    const session = await requireAuth(request);

    // Fetch user from database
    const user = await prisma.merchantUser.findUnique({
      where: { id: session.userId },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            slug: true,
            brandName: true,
          },
        },
      },
    });

    if (!user) {
      logger.warn('me_user_not_found', {
        userId: session.userId,
      });

      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Verify user is still active
    if (!user.isActive) {
      logger.warn('me_user_inactive', {
        userId: user.id,
      });

      return NextResponse.json(
        { error: 'Account is inactive' },
        { status: 403 }
      );
    }

    // Verify merchant ID matches (security check)
    if (user.merchantId !== session.merchantId) {
      logger.warn('me_merchant_mismatch', {
        userId: user.id,
        sessionMerchantId: session.merchantId,
        userMerchantId: user.merchantId,
      });

      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Return user info (exclude sensitive fields)
    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          merchantId: user.merchantId,
          merchant: {
            id: user.merchant.id,
            name: user.merchant.name,
            slug: user.merchant.slug,
            brandName: user.merchant.brandName,
          },
          isActive: user.isActive,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    // Handle auth errors
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('me_error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}


