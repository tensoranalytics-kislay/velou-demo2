/**
 * POST /api/admin/auth/refresh
 * 
 * Refresh access token using refresh token.
 * 
 * Request Body:
 *   {
 *     "refreshToken": "eyJhbGc..."
 *   }
 * 
 * Response (200):
 *   {
 *     "accessToken": "eyJhbGc...",
 *     "refreshToken": "eyJhbGc..."
 *   }
 * 
 * Errors:
 *   - 400: Invalid request body
 *   - 401: Invalid or expired refresh token
 *   - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyRefreshToken,
  generateTokenPair,
} from '@/lib/auth/jwt';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';
import { accessTokenCookieOptions, refreshTokenCookieOptions } from '@/lib/secureCookies';
import { rateLimitAuth } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Rate limiting for auth endpoints
    const rateLimitResult = await rateLimitAuth(request);
    if (!rateLimitResult.success) {
      return rateLimitResult.response!;
    }
    
    // Parse request body
    const body = await request.json();
    const { refreshToken } = body;

    // Validate input
    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json(
        { error: 'Refresh token is required' },
        { status: 400 }
      );
    }

    // Verify refresh token
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (error) {
      logger.warn('refresh_token_invalid', {
        error: error instanceof Error ? error.message : String(error),
      });

      return NextResponse.json(
        { error: 'Invalid or expired refresh token' },
        { status: 401 }
      );
    }

    // Verify user still exists and is active
    const user = await prisma.merchantUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        merchantId: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      logger.warn('refresh_user_not_found', {
        userId: payload.sub,
      });

      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      logger.warn('refresh_user_inactive', {
        userId: user.id,
      });

      return NextResponse.json(
        { error: 'Account is inactive' },
        { status: 403 }
      );
    }

    // Verify merchant ID matches (security check)
    if (user.merchantId !== payload.merchantId) {
      logger.warn('refresh_merchant_mismatch', {
        userId: user.id,
        tokenMerchantId: payload.merchantId,
        userMerchantId: user.merchantId,
      });

      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Generate new token pair
    const tokens = generateTokenPair(user.id, user.merchantId, user.role);

    logger.info('refresh_success', {
      userId: user.id,
      merchantId: user.merchantId,
    });

    // Create response with tokens
    const response = NextResponse.json(tokens, { status: 200 });

    // Set secure HttpOnly cookies for new tokens
    response.cookies.set('accessToken', tokens.accessToken, accessTokenCookieOptions);
    response.cookies.set('refreshToken', tokens.refreshToken, refreshTokenCookieOptions);

    return response;
  } catch (error) {
    logger.error('refresh_error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

