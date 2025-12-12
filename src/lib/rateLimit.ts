/**
 * Rate Limiting
 * 
 * Provides rate limiting using Upstash Redis (with in-memory fallback).
 * 
 * Rate Limits:
 * - Auth endpoints: 10 requests per minute per IP
 * - LLM endpoints: 30 requests per minute per API key
 * - Widget endpoints: 100 requests per minute per API key
 */

import type { NextRequest } from 'next/server';

/**
 * In-memory rate limit store (fallback when Redis is not available)
 * Maps identifier -> { count: number, resetAt: number }
 */
const memoryStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Cached Redis connection (initialized once at module load)
 */
let cachedRedis: any = null;
let redisInitialized = false;

/**
 * Cached Ratelimit class (loaded once at module load)
 */
let RatelimitClass: any = null;

/**
 * Initialize Redis connection (called once at module load)
 */
async function initializeRedis() {
  if (redisInitialized) return;
  
  try {
    // Check if Redis is configured
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const { Ratelimit } = await import('@upstash/ratelimit');
      const { Redis } = await import('@upstash/redis');
      
      // Cache the Ratelimit class for later use
      RatelimitClass = Ratelimit;
      
      // Cache the Redis connection (this is the expensive part)
      cachedRedis = Redis.fromEnv();
      redisInitialized = true;
    }
  } catch (error) {
    // Redis not available, will use in-memory fallback
    redisInitialized = true; // Mark as initialized to prevent retries
  }
}

// Initialize Redis at module load (non-blocking)
if (typeof window === 'undefined') {
  initializeRedis().catch(() => {
    // Silently fail, will use in-memory fallback
  });
}

/**
 * Rate limit configuration
 */
export const RATE_LIMITS = {
  AUTH: {
    requests: 10,
    window: 60, // seconds
  },
  LLM: {
    requests: 30,
    window: 60, // seconds
  },
  WIDGET: {
    requests: 500, // 500 requests per minute per API key
    window: 60, // seconds
  },
} as const;

/**
 * Get client IP from request
 */
function getClientIp(request: NextRequest): string {
  // Try various headers (for proxies, load balancers, etc.)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  // Fallback to connection remote address (may not be available in Edge Runtime)
  return 'unknown';
}

/**
 * In-memory rate limiter (fallback)
 */
async function checkMemoryRateLimit(
  identifier: string,
  limit: number,
  window: number
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const now = Date.now();
  const resetAt = now + window * 1000;
  
  const entry = memoryStore.get(identifier);
  
  if (!entry || entry.resetAt < now) {
    // New window or expired entry
    memoryStore.set(identifier, { count: 1, resetAt });
    return {
      success: true,
      remaining: limit - 1,
      reset: resetAt,
    };
  }
  
  if (entry.count >= limit) {
    // Rate limited
    return {
      success: false,
      remaining: 0,
      reset: entry.resetAt,
    };
  }
  
  // Increment count
  entry.count++;
  memoryStore.set(identifier, entry);
  
  return {
    success: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
  };
}

/**
 * Clean up expired entries from memory store (run periodically)
 */
function cleanupMemoryStore() {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.resetAt < now) {
      memoryStore.delete(key);
    }
  }
}

// Clean up every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupMemoryStore, 5 * 60 * 1000);
}

/**
 * Check rate limit using Upstash Redis (with in-memory fallback)
 * 
 * @param identifier - Unique identifier (IP address, API key, etc.)
 * @param limit - Maximum number of requests
 * @param window - Time window in seconds
 * @returns Rate limit result
 */
export async function checkRateLimit(
  identifier: string,
  limit: number,
  window: number
): Promise<{ success: boolean; remaining: number; reset: number }> {
  // Ensure Redis is initialized (non-blocking)
  if (!redisInitialized) {
    await initializeRedis();
  }
  
  // Try Upstash Redis if available and initialized
  if (cachedRedis && RatelimitClass) {
    try {
      // Create a new ratelimit instance with the specific limit/window for this call
      // (We can't cache the Ratelimit instance because each call has different limits)
      const ratelimit = new RatelimitClass({
        redis: cachedRedis,
        limiter: RatelimitClass.slidingWindow(limit, `${window} s`),
      });
      
      const result = await ratelimit.limit(identifier);
      return {
        success: result.success,
        remaining: result.remaining,
        reset: result.reset,
      };
    } catch (error) {
      // Redis error, fall back to in-memory
      // Only log in development to avoid performance impact
      if (process.env.NODE_ENV === 'development') {
        console.warn('Redis rate limit check failed, using in-memory fallback:', error);
      }
    }
  }
  
  // Fallback to in-memory rate limiting
  return checkMemoryRateLimit(identifier, limit, window);
}

/**
 * Rate limit middleware for auth endpoints
 */
export async function rateLimitAuth(request: NextRequest): Promise<{
  success: boolean;
  response?: Response;
}> {
  const ip = getClientIp(request);
  const result = await checkRateLimit(
    `auth:${ip}`,
    RATE_LIMITS.AUTH.requests,
    RATE_LIMITS.AUTH.window
  );
  
  if (!result.success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: `Too many requests. Please try again after ${new Date(result.reset).toISOString()}`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(RATE_LIMITS.AUTH.requests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.reset),
            'Retry-After': String(Math.ceil((result.reset - Date.now()) / 1000)),
          },
        }
      ),
    };
  }
  
  return { success: true };
}

/**
 * Rate limit middleware for LLM endpoints
 */
export async function rateLimitLlm(
  request: NextRequest,
  apiKey?: string
): Promise<{
  success: boolean;
  response?: Response;
}> {
  // Use API key if provided, otherwise use IP
  const identifier = apiKey ? `llm:${apiKey}` : `llm:${getClientIp(request)}`;
  
  const result = await checkRateLimit(
    identifier,
    RATE_LIMITS.LLM.requests,
    RATE_LIMITS.LLM.window
  );
  
  if (!result.success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: `Too many requests. Please try again after ${new Date(result.reset).toISOString()}`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(RATE_LIMITS.LLM.requests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.reset),
            'Retry-After': String(Math.ceil((result.reset - Date.now()) / 1000)),
          },
        }
      ),
    };
  }
  
  return { success: true };
}

/**
 * Rate limit middleware for widget endpoints
 */
export async function rateLimitWidget(
  request: NextRequest,
  apiKey?: string
): Promise<{
  success: boolean;
  response?: Response;
}> {
  // Use API key if provided, otherwise use IP
  const identifier = apiKey ? `widget:${apiKey}` : `widget:${getClientIp(request)}`;
  
  const result = await checkRateLimit(
    identifier,
    RATE_LIMITS.WIDGET.requests,
    RATE_LIMITS.WIDGET.window
  );
  
  if (!result.success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: `Too many requests. Please try again after ${new Date(result.reset).toISOString()}`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(RATE_LIMITS.WIDGET.requests),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(result.reset),
            'Retry-After': String(Math.ceil((result.reset - Date.now()) / 1000)),
          },
        }
      ),
    };
  }
  
  return { success: true };
}

