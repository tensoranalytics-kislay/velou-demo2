/**
 * JWT Token Management
 * 
 * Handles generation and verification of access and refresh tokens.
 * 
 * Security Notes:
 * - Access tokens: 7 days expiry (short-lived for security)
 * - Refresh tokens: 30 days expiry (longer-lived for UX)
 * - Tokens are signed with separate secrets for access and refresh
 * - Never log token contents or user passwords
 */

import jwt from 'jsonwebtoken';
import { env } from '../config';

// JWT Secrets from environment
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET must be set and at least 32 characters long. ' +
    'Generate with: openssl rand -base64 32'
  );
}

if (!REFRESH_TOKEN_SECRET || REFRESH_TOKEN_SECRET.length < 32) {
  throw new Error(
    'REFRESH_TOKEN_SECRET must be set and at least 32 characters long. ' +
    'Generate with: openssl rand -base64 32'
  );
}

// TypeScript: After validation, these are guaranteed to be strings
const JWT_SECRET_SAFE: string = JWT_SECRET;
const REFRESH_TOKEN_SECRET_SAFE: string = REFRESH_TOKEN_SECRET;

/**
 * Access token payload structure
 * Contains user identity and permissions
 */
export interface AccessTokenPayload {
  sub: string; // User ID
  merchantId: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  iat?: number; // Issued at (auto-added by jwt)
  exp?: number; // Expiration (auto-added by jwt)
}

/**
 * Refresh token payload structure
 * Contains minimal user identity for token refresh
 */
export interface RefreshTokenPayload {
  sub: string; // User ID
  merchantId: string;
  iat?: number; // Issued at (auto-added by jwt)
  exp?: number; // Expiration (auto-added by jwt)
}

/**
 * Token pair returned from generation
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Generate an access token (7 days expiry)
 * 
 * @param userId - User ID (from MerchantUser.id)
 * @param merchantId - Merchant ID (from Merchant.id)
 * @param role - User role (ADMIN | EDITOR | VIEWER)
 * @returns Signed JWT access token
 */
export function generateAccessToken(
  userId: string,
  merchantId: string,
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
): string {
  const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
    sub: userId,
    merchantId,
    role,
  };

  return jwt.sign(payload, JWT_SECRET_SAFE, {
    expiresIn: '7d',
    issuer: 'velou',
    audience: 'velou-admin',
  });
}

/**
 * Generate a refresh token (30 days expiry)
 * 
 * @param userId - User ID (from MerchantUser.id)
 * @param merchantId - Merchant ID (from Merchant.id)
 * @returns Signed JWT refresh token
 */
export function generateRefreshToken(
  userId: string,
  merchantId: string
): string {
  const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
    sub: userId,
    merchantId,
  };

  return jwt.sign(payload, REFRESH_TOKEN_SECRET_SAFE, {
    expiresIn: '30d',
    issuer: 'velou',
    audience: 'velou-admin',
  });
}

/**
 * Generate both access and refresh tokens
 * Convenience function for login/refresh flows
 * 
 * @param userId - User ID
 * @param merchantId - Merchant ID
 * @param role - User role
 * @returns Token pair with both tokens
 */
export function generateTokenPair(
  userId: string,
  merchantId: string,
  role: 'ADMIN' | 'EDITOR' | 'VIEWER'
): TokenPair {
  return {
    accessToken: generateAccessToken(userId, merchantId, role),
    refreshToken: generateRefreshToken(userId, merchantId),
  };
}

/**
 * Verify and decode an access token
 * 
 * @param token - JWT access token string
 * @returns Decoded token payload
 * @throws Error if token is invalid, expired, or malformed
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_SAFE, {
      issuer: 'velou',
      audience: 'velou-admin',
    }) as AccessTokenPayload;

    // Validate required fields
    if (!decoded.sub || !decoded.merchantId || !decoded.role) {
      throw new Error('Invalid token payload: missing required fields');
    }

    // Validate role
    if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(decoded.role)) {
      throw new Error('Invalid token payload: invalid role');
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Access token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid access token');
    }
    throw error;
  }
}

/**
 * Verify and decode a refresh token
 * 
 * @param token - JWT refresh token string
 * @returns Decoded token payload
 * @throws Error if token is invalid, expired, or malformed
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET_SAFE, {
      issuer: 'velou',
      audience: 'velou-admin',
    }) as RefreshTokenPayload;

    // Validate required fields
    if (!decoded.sub || !decoded.merchantId) {
      throw new Error('Invalid token payload: missing required fields');
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    }
    throw error;
  }
}

