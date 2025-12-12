/**
 * Next.js Middleware
 * 
 * Protects all /admin routes by requiring authentication.
 * Redirects unauthenticated users to a login page.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Check if a path is a public route (doesn't require auth)
 */
function isPublicRoute(pathname: string): boolean {
  const publicRoutes = [
    '/',
    '/api/health',
    '/api/assistant',
    '/api/assistant/stream',
    '/api/brand-info',
    '/api/chat/greeting',
    '/api/chat/placeholder',
    '/api/suggestions',
    '/api/metrics/product-click',
  ];
  
  // API auth routes are public (login, refresh)
  if (pathname.startsWith('/api/admin/auth/')) {
    return true;
  }
  
  return publicRoutes.includes(pathname);
}

/**
 * Check if a path is an admin route
 */
function isAdminRoute(pathname: string): boolean {
  return pathname.startsWith('/admin');
}

/**
 * Extract token from cookies (for page requests) or Authorization header (for API requests)
 */
function getTokenFromRequest(req: NextRequest): string | null {
  // Try Authorization header first (for API requests)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Try cookie (for page requests)
  const tokenCookie = req.cookies.get('accessToken');
  if (tokenCookie?.value) {
    return tokenCookie.value;
  }
  
  return null;
}

/**
 * Verify token is valid (Edge Runtime compatible)
 * Uses jose library instead of jsonwebtoken for Edge Runtime support
 */
async function isTokenValid(token: string): Promise<boolean> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      // Only log in development to avoid performance impact
      if (process.env.NODE_ENV === 'development') {
        console.error('[Middleware] JWT_SECRET not configured properly');
      }
      return false;
    }

    // Convert secret to Uint8Array for jose
    // jose requires the secret as a Uint8Array or a KeyObject
    const secretKey = new TextEncoder().encode(secret);

    // Verify token using jose (Edge Runtime compatible)
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: 'velou',
      audience: 'velou-admin',
    });

    // Validate required fields
    if (!payload.sub || !payload.merchantId || !payload.role) {
      return false;
    }

    // Validate role
    if (!['ADMIN', 'EDITOR', 'VIEWER'].includes(payload.role as string)) {
      return false;
    }

    return true;
  } catch (error) {
    // Silently fail - token is invalid
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // CRITICAL: ALWAYS allow login page FIRST - before any other checks
  // This prevents infinite redirect loops
  // Check for exact match (pathname doesn't include query params)
  // Also check for /admin/login/ to handle trailing slashes
  if (pathname === '/admin/login' || pathname === '/admin/login/') {
    return NextResponse.next();
  }
  
  // Skip public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }
  
  // Protect admin routes
  if (isAdminRoute(pathname)) {
    const token = getTokenFromRequest(request);
    
    if (!token) {
      // No token found, redirect to login
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    
    // Verify token is valid (async for Edge Runtime compatible verification)
    const isValid = await isTokenValid(token);
    if (!isValid) {
      // Token is invalid, redirect to login
      const loginUrl = new URL('/admin/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    
    // Token is valid, allow request
    return NextResponse.next();
  }
  
  // Protect admin API routes (except auth routes)
  if (pathname.startsWith('/api/admin/') && !pathname.startsWith('/api/admin/auth/')) {
    const token = getTokenFromRequest(request);
    
    if (!token || !(await isTokenValid(token))) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in.' },
        { status: 401 }
      );
    }
    
    return NextResponse.next();
  }
  
  // Allow all other routes
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

