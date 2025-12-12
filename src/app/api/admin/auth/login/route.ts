/**
 * POST /api/admin/auth/login
 * 
 * Authenticate a merchant user and return JWT tokens.
 * 
 * Request Body:
 *   {
 *     "email": "user@example.com",
 *     "password": "securePassword123"
 *   }
 * 
 * Response (200):
 *   {
 *     "accessToken": "eyJhbGc...",
 *     "refreshToken": "eyJhbGc...",
 *     "user": {
 *       "id": "user-123",
 *       "email": "user@example.com",
 *       "role": "ADMIN",
 *       "merchantId": "merchant-123"
 *     }
 *   }
 * 
 * Errors:
 *   - 400: Invalid request body
 *   - 401: Invalid credentials
 *   - 403: User account is inactive
 *   - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateTokenPair } from '@/lib/auth/jwt';
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
    const { email, password } = body;

    // Validate input
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    // Find user by email
    const user = await prisma.merchantUser.findFirst({
      where: { email: email.toLowerCase().trim() },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    // Don't reveal if user exists (security best practice)
    // Always perform password verification to prevent timing attacks
    const isValidPassword = user
      ? await verifyPassword(password, user.passwordHash)
      : false;

    if (!user || !isValidPassword) {
      logger.warn('login_failed', {
        email: email.toLowerCase().trim(),
        reason: 'invalid_credentials',
      });

      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Check if user account is active
    if (!user.isActive) {
      logger.warn('login_failed', {
        email: user.email,
        userId: user.id,
        reason: 'account_inactive',
      });

      return NextResponse.json(
        { error: 'Account is inactive. Please contact an administrator.' },
        { status: 403 }
      );
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokenPair(
      user.id,
      user.merchantId,
      user.role
    );

    // Update last login timestamp
    await prisma.merchantUser.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    logger.info('login_success', {
      userId: user.id,
      email: user.email,
      merchantId: user.merchantId,
      role: user.role,
    });

    // Create response with tokens
    const response = NextResponse.json(
      {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          merchantId: user.merchantId,
          merchant: {
            id: user.merchant.id,
            name: user.merchant.name,
            slug: user.merchant.slug,
          },
        },
      },
      { status: 200 }
    );

    // Set secure HttpOnly cookies for authentication tokens
    // SECURITY: httpOnly prevents JavaScript access (XSS protection)
    // SECURITY: sameSite: 'strict' provides CSRF protection
    response.cookies.set('accessToken', accessToken, accessTokenCookieOptions);
    response.cookies.set('refreshToken', refreshToken, refreshTokenCookieOptions);

    return response;
  } catch (error) {
    logger.error('login_error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

