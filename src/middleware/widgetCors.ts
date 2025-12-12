/**
 * Widget CORS Middleware
 * 
 * Handles CORS headers for widget API endpoints.
 * Only allows origins that are in the API key's allowedOrigins list.
 */

import { NextRequest } from 'next/server';

/**
 * Generate CORS headers for widget requests
 * 
 * @param origin - Origin from request header
 * @param allowedOrigins - Array of allowed origins from API key
 * @returns CORS headers object, or empty object if origin not allowed
 * 
 * @example
 * ```typescript
 * const corsHeaders = widgetCorsHeaders(origin, apiKey.allowedOrigins);
 * return NextResponse.json(data, { headers: corsHeaders });
 * ```
 */
export function widgetCorsHeaders(
  origin: string | null,
  allowedOrigins: string[]
): Record<string, string> {
  // If no origin, return empty headers (server-to-server request)
  if (!origin) {
    return {};
  }

  // Normalize origin for comparison
  const normalizedOrigin = normalizeOrigin(origin);

  // Check if origin is allowed
  const isAllowed = allowedOrigins.length === 0 || allowedOrigins.some((allowed) => {
    const normalizedAllowed = normalizeOrigin(allowed);
    
    // Exact match
    if (normalizedOrigin === normalizedAllowed) {
      return true;
    }

    // Wildcard subdomain match (e.g., "*.example.com" matches "www.example.com")
    if (normalizedAllowed.startsWith('*.')) {
      const domain = normalizedAllowed.slice(2); // Remove "*."
      const originHost = normalizedOrigin.split('://')[1]?.split('/')[0] || '';
      
      // Check if origin host ends with domain
      if (originHost.endsWith(domain)) {
        // Ensure it's actually a subdomain (not just the domain itself)
        const subdomain = originHost.slice(0, -domain.length - 1);
        return subdomain.length > 0 && !subdomain.includes('.');
      }
    }

    return false;
  });

  if (!isAllowed) {
    // Origin not allowed - return empty headers (will be rejected by browser)
    return {};
  }

  // Return CORS headers
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Normalize origin for comparison
 * 
 * @param origin - Origin string
 * @returns Normalized origin (protocol + host, lowercase)
 */
function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return origin.toLowerCase();
  }
}

/**
 * Handle OPTIONS preflight request
 * 
 * @param req - NextRequest object
 * @param allowedOrigins - Array of allowed origins
 * @returns Response with CORS headers, or 403 if origin not allowed
 */
export function handleOptionsRequest(
  req: NextRequest,
  allowedOrigins: string[]
): Response | null {
  const origin = req.headers.get('Origin');
  
  if (!origin) {
    // No origin - allow (server-to-server request)
    return new Response(null, {
      status: 204,
      headers: widgetCorsHeaders(null, allowedOrigins),
    });
  }

  const corsHeaders = widgetCorsHeaders(origin, allowedOrigins);
  
  if (Object.keys(corsHeaders).length === 0) {
    // Origin not allowed
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}


