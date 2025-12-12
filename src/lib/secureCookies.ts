/**
 * Secure Cookie Helpers
 * 
 * Provides secure cookie configuration for authentication tokens.
 * All auth cookies use httpOnly, secure, and strict SameSite for maximum security.
 */

/**
 * Secure cookie options for authentication tokens
 */
export const secureCookieOptions = {
  httpOnly: true, // Prevent JavaScript access (XSS protection)
  secure: process.env.NODE_ENV === 'production', // HTTPS only in production
  sameSite: 'strict' as const, // CSRF protection
  path: '/',
};

/**
 * Cookie options for access token (7 days)
 */
export const accessTokenCookieOptions = {
  ...secureCookieOptions,
  maxAge: 60 * 60 * 24 * 7, // 7 days
};

/**
 * Cookie options for refresh token (30 days)
 */
export const refreshTokenCookieOptions = {
  ...secureCookieOptions,
  maxAge: 60 * 60 * 24 * 30, // 30 days
};


