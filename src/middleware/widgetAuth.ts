/**
 * Widget Authentication Middleware
 * 
 * Validates API key authentication for widget endpoints.
 * Widgets use API keys (not JWT) and must validate origin for CORS security.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';
import { rateLimitWidget } from '@/lib/rateLimit';

/**
 * Widget authentication context
 */
export interface WidgetAuthContext {
  apiKey: {
    id: string;
    merchantId: string;
    name: string;
    token: string;
    allowedOrigins: string[];
    isActive: boolean;
  };
  merchant: {
    id: string;
    slug: string;
    name: string;
    brandName: string;
  };
}

/**
 * Widget authentication error
 */
export class WidgetAuthError extends Error {
  constructor(
    public status: number,
    public message: string
  ) {
    super(message);
    this.name = 'WidgetAuthError';
  }
}

/**
 * Extract API key from Authorization header
 * 
 * @param req - NextRequest object
 * @returns API key string or null
 */
function extractApiKey(req: NextRequest): string | null {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader) {
    return null;
  }

  // Extract token from "Bearer <token>" format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Extract origin from request headers
 * 
 * @param req - NextRequest object
 * @returns Origin string or null
 */
function extractOrigin(req: NextRequest): string | null {
  // Try Origin header first (for CORS requests)
  const origin = req.headers.get('Origin');
  if (origin) {
    return origin;
  }

  // Fallback to Referer header (for same-origin requests)
  const referer = req.headers.get('Referer');
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Invalid referer URL
    }
  }

  return null;
}

/**
 * Normalize origin for comparison
 * 
 * @param origin - Origin string
 * @returns Normalized origin (protocol + host, no trailing slash)
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
 * Check if origin is allowed
 * 
 * @param origin - Origin to check
 * @param allowedOrigins - Array of allowed origins
 * @returns true if origin is allowed
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    // No restrictions - allow all origins (for development)
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  return allowedOrigins.some((allowed) => {
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
}

/**
 * Require widget authentication
 * 
 * Validates API key and origin for widget requests.
 * 
 * @param req - NextRequest object
 * @param merchantId - Merchant ID from URL parameter
 * @returns WidgetAuthContext with apiKey and merchant
 * @throws WidgetAuthError if authentication fails
 * 
 * @example
 * ```typescript
 * try {
 *   const auth = await requireWidgetAuth(request, merchantId);
 *   // Use auth.apiKey and auth.merchant
 * } catch (error) {
 *   if (error instanceof WidgetAuthError) {
 *     return NextResponse.json({ error: error.message }, { status: error.status });
 *   }
 *   throw error;
 * }
 * ```
 */
export async function requireWidgetAuth(
  req: NextRequest,
  merchantId: string
): Promise<WidgetAuthContext> {
  const startTime = Date.now();

  try {
    // Extract API key from Authorization header
    const apiKeyToken = extractApiKey(req);
    
    if (!apiKeyToken) {
      logger.warn('widget_auth_missing_key', {
        merchantId,
        endpoint: req.nextUrl.pathname,
      });
      throw new WidgetAuthError(401, 'Missing or invalid Authorization header. Expected: Bearer <api-key>');
    }

    // Validate API key format (should start with pk_live_ or sk_live_)
    if (!apiKeyToken.startsWith('pk_live_') && !apiKeyToken.startsWith('sk_live_')) {
      logger.warn('widget_auth_invalid_format', {
        merchantId,
        endpoint: req.nextUrl.pathname,
        keyPrefix: apiKeyToken.substring(0, 10),
      });
      throw new WidgetAuthError(401, 'Invalid API key format');
    }

    // Rate limiting (500 requests per minute per API key)
    const rateLimitResult = await rateLimitWidget(req, apiKeyToken);
    if (!rateLimitResult.success) {
      logger.warn('widget_rate_limit_exceeded', {
        merchantId,
        apiKey: apiKeyToken.substring(0, 20) + '...',
        endpoint: req.nextUrl.pathname,
      });
      throw new WidgetAuthError(429, 'Rate limit exceeded. Please try again later.');
    }

    // Query database for API key
    const apiKey = await prisma.apiKey.findUnique({
      where: { token: apiKeyToken },
      include: {
        merchant: {
          select: {
            id: true,
            slug: true,
            name: true,
            brandName: true,
          },
        },
      },
    });

    if (!apiKey) {
      logger.warn('widget_auth_key_not_found', {
        merchantId,
        endpoint: req.nextUrl.pathname,
        keyPrefix: apiKeyToken.substring(0, 20) + '...',
      });
      throw new WidgetAuthError(401, 'Invalid API key');
    }

    // Verify API key is active
    if (!apiKey.isActive) {
      logger.warn('widget_auth_key_inactive', {
        merchantId,
        apiKeyId: apiKey.id,
        endpoint: req.nextUrl.pathname,
      });
      throw new WidgetAuthError(401, 'API key is inactive');
    }

    // Verify merchant ID matches
    if (apiKey.merchantId !== merchantId) {
      logger.warn('widget_auth_merchant_mismatch', {
        merchantId,
        apiKeyMerchantId: apiKey.merchantId,
        apiKeyId: apiKey.id,
        endpoint: req.nextUrl.pathname,
      });
      throw new WidgetAuthError(403, 'API key does not belong to this merchant');
    }

    // Extract and validate origin
    const origin = extractOrigin(req);
    
    if (origin) {
      if (!isOriginAllowed(origin, apiKey.allowedOrigins)) {
        logger.warn('widget_auth_origin_not_allowed', {
          merchantId,
          origin,
          allowedOrigins: apiKey.allowedOrigins,
          endpoint: req.nextUrl.pathname,
        });
        throw new WidgetAuthError(403, 'Origin not allowed. Please check your API key configuration.');
      }
    } else {
      // No origin header - this is OK for server-to-server requests
      // But log it for monitoring
      logger.debug('widget_auth_no_origin', {
        merchantId,
        endpoint: req.nextUrl.pathname,
      });
    }

    const duration = Date.now() - startTime;

    logger.info('widget_auth_success', {
      merchantId,
      apiKeyId: apiKey.id,
      endpoint: req.nextUrl.pathname,
      origin: origin || 'none',
      duration,
    });

    return {
      apiKey: {
        id: apiKey.id,
        merchantId: apiKey.merchantId,
        name: apiKey.name,
        token: apiKey.token,
        allowedOrigins: apiKey.allowedOrigins,
        isActive: apiKey.isActive,
      },
      merchant: {
        id: apiKey.merchant.id,
        slug: apiKey.merchant.slug,
        name: apiKey.merchant.name,
        brandName: apiKey.merchant.brandName,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_auth_failed', {
        merchantId,
        endpoint: req.nextUrl.pathname,
        status: error.status,
        error: error.message,
        duration,
      });
      throw error;
    }

    // Unexpected error
    logger.error('widget_auth_error', {
      merchantId,
      endpoint: req.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
    });

    throw new WidgetAuthError(500, 'Authentication failed');
  }
}

/**
 * Create error response for widget auth errors
 * 
 * @param error - WidgetAuthError instance
 * @returns NextResponse with appropriate status and error message
 */
export function createWidgetAuthErrorResponse(error: WidgetAuthError): Response {
  return new Response(
    JSON.stringify({
      error: error.message,
    }),
    {
      status: error.status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}


