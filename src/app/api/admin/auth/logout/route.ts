/**
 * POST /api/admin/auth/logout
 * 
 * Logout endpoint (client-side token removal).
 * 
 * Note: Since we're using stateless JWT tokens, logout is primarily
 * handled client-side by removing tokens from storage. This endpoint
 * exists for consistency and potential future token blacklisting.
 * 
 * Request Headers:
 *   Authorization: Bearer <accessToken>
 * 
 * Response (200):
 *   {
 *     "message": "Logged out successfully"
 *   }
 * 
 * Errors:
 *   - 401: Unauthorized (invalid or missing token)
 *   - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/middleware/auth';
import { createAuthErrorResponse } from '@/middleware/auth';
import { logger } from '@/lib/telemetry/logger';

export async function POST(request: NextRequest) {
  try {
    // Verify authentication (optional, but good for logging)
    const session = await requireAuth(request);

    logger.info('logout_success', {
      userId: session.userId,
      merchantId: session.merchantId,
    });

    // Create response and clear cookies
    const response = NextResponse.json(
      { message: 'Logged out successfully' },
      { status: 200 }
    );

    // Clear authentication cookies
    response.cookies.set('accessToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });
    response.cookies.set('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch (error) {
    // Even if auth fails, we can still return success
    // (client will remove tokens anyway)
    logger.warn('logout_auth_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { message: 'Logged out successfully' },
      { status: 200 }
    );
  }
}

