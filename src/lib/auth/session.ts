/**
 * Session Data Management
 * 
 * Handles extraction and validation of session data from requests.
 * Session data comes from JWT tokens in Authorization header.
 */

import { AccessTokenPayload } from './jwt';

/**
 * Session data structure
 * Extracted from JWT access token
 */
export interface SessionData {
  userId: string;
  merchantId: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  exp: number; // Token expiration timestamp
}

/**
 * Check if a token expiration timestamp has passed
 * 
 * @param exp - Expiration timestamp (Unix epoch seconds)
 * @returns true if token is expired, false otherwise
 */
export function isTokenExpired(exp: number): boolean {
  const now = Math.floor(Date.now() / 1000); // Current time in seconds
  return exp < now;
}

/**
 * Extract session data from JWT token payload
 * 
 * @param payload - Decoded JWT access token payload
 * @returns SessionData object or null if invalid
 */
export function extractSessionFromPayload(
  payload: AccessTokenPayload
): SessionData | null {
  if (!payload.sub || !payload.merchantId || !payload.role || !payload.exp) {
    return null;
  }

  // Check expiration
  if (isTokenExpired(payload.exp)) {
    return null;
  }

  return {
    userId: payload.sub,
    merchantId: payload.merchantId,
    role: payload.role,
    exp: payload.exp,
  };
}

/**
 * Extract token string from Request Authorization header or cookies
 * 
 * @param req - Next.js Request or NextRequest object
 * @returns Token string if found, null otherwise
 * 
 * Note: This function checks both Authorization header and cookies.
 * Actual verification should be done via verifyAccessToken() in jwt.ts
 */
export function extractTokenFromRequest(
  req: Request | { headers: Headers; cookies?: { get: (name: string) => { value: string } | undefined } }
): string | null {
  // Try Authorization header first (for API requests with explicit headers)
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    // Extract token from "Bearer <token>" format
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }
  }

  // Try cookie (for requests with HttpOnly cookies)
  // Check if req has cookies property (NextRequest)
  if ('cookies' in req && req.cookies) {
    const tokenCookie = req.cookies.get('accessToken');
    if (tokenCookie?.value) {
      return tokenCookie.value;
    }
  }

  return null;
}

