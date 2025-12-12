/**
 * Authentication Middleware
 * 
 * Provides middleware functions for protecting API routes.
 * 
 * Usage:
 *   // Require authentication
 *   const session = await requireAuth(request);
 *   
 *   // Require specific merchant
 *   const session = await requireMerchantAuth(request, merchantId);
 *   
 *   // Require specific role
 *   const session = await requireRole(request, merchantId, ['ADMIN', 'EDITOR']);
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '../lib/auth/jwt';
import {
  extractTokenFromRequest,
  extractSessionFromPayload,
  type SessionData,
} from '../lib/auth/session';

/**
 * UserRole type from Prisma schema
 */
export type UserRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

/**
 * Authentication error response
 */
class AuthError extends Error {
  constructor(
    public status: number,
    public message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Require valid authentication token
 * 
 * Extracts and verifies JWT token from Authorization header or cookies.
 * 
 * @param req - Next.js NextRequest or Request object
 * @returns SessionData if authentication successful
 * @throws AuthError with 401 status if authentication fails
 * 
 * Example:
 *   try {
 *     const session = await requireAuth(request);
 *     // User is authenticated, proceed with request
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *   }
 */
export async function requireAuth(req: NextRequest | Request): Promise<SessionData> {
  // Extract token from Authorization header or cookies
  const token = extractTokenFromRequest(req);
  
  if (!token) {
    throw new AuthError(
      401,
      'Missing or invalid authentication token. Check Authorization header or cookies.'
    );
  }

  try {
    // Verify and decode token
    const payload = verifyAccessToken(token);
    
    // Extract session data
    const session = extractSessionFromPayload(payload);
    
    if (!session) {
      throw new AuthError(401, 'Invalid or expired token');
    }

    return session;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    
    // Handle JWT verification errors
    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        throw new AuthError(401, 'Token expired');
      }
      if (error.message.includes('Invalid')) {
        throw new AuthError(401, 'Invalid token');
      }
    }
    
    throw new AuthError(401, 'Authentication failed');
  }
}

/**
 * Require authentication AND verify merchant ID matches
 * 
 * Ensures the authenticated user belongs to the specified merchant.
 * Used for multi-tenant data isolation.
 * 
 * @param req - Next.js Request object
 * @param merchantId - Expected merchant ID
 * @returns SessionData if authentication and merchant match
 * @throws AuthError with 401 if authentication fails, 403 if merchant mismatch
 * 
 * Example:
 *   try {
 *     const session = await requireMerchantAuth(request, 'merchant-123');
 *     // User is authenticated and belongs to merchant-123
 *   } catch (error) {
 *     if (error.status === 401) {
 *       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *     }
 *     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 *   }
 */
export async function requireMerchantAuth(
  req: Request,
  merchantId: string
): Promise<SessionData> {
  // First require authentication
  const session = await requireAuth(req);

  // Verify merchant ID matches
  if (session.merchantId !== merchantId) {
    throw new AuthError(
      403,
      'Access denied: user does not belong to this merchant'
    );
  }

  return session;
}

/**
 * Require authentication AND verify user has required role
 * 
 * Ensures the authenticated user has one of the allowed roles.
 * Used for role-based access control (RBAC).
 * 
 * @param req - Next.js Request object
 * @param merchantId - Expected merchant ID (for multi-tenant isolation)
 * @param allowedRoles - Array of roles that are allowed
 * @returns SessionData if authentication and role check pass
 * @throws AuthError with 401 if authentication fails, 403 if role insufficient
 * 
 * Example:
 *   try {
 *     const session = await requireRole(request, 'merchant-123', ['ADMIN', 'EDITOR']);
 *     // User is authenticated, belongs to merchant-123, and is ADMIN or EDITOR
 *   } catch (error) {
 *     if (error.status === 401) {
 *       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 *     }
 *     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
 *   }
 */
export async function requireRole(
  req: Request,
  merchantId: string,
  allowedRoles: UserRole[]
): Promise<SessionData> {
  // First require merchant authentication
  const session = await requireMerchantAuth(req, merchantId);

  // Verify user has required role
  if (!allowedRoles.includes(session.role)) {
    throw new AuthError(
      403,
      `Access denied: requires one of [${allowedRoles.join(', ')}], user has ${session.role}`
    );
  }

  return session;
}

/**
 * Helper to create error response from AuthError
 * 
 * @param error - AuthError instance
 * @returns NextResponse with appropriate status and error message
 */
export function createAuthErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }

  // Unknown error
  return NextResponse.json(
    { error: 'Authentication failed' },
    { status: 500 }
  );
}

