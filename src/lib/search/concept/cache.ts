/**
 * Concept Index Cache
 * 
 * Simple in-memory cache for concept indexes, keyed by merchantId.
 * 
 * TODO: Add TTL-based invalidation or manual invalidation hooks
 * TODO: Consider moving to Redis for multi-instance deployments
 */

import type { ConceptIndex } from './index';
import { buildConceptIndex } from './index';
import { logger } from '../../telemetry/logger';

type CacheEntry = {
  index: ConceptIndex;
  builtAt: number;
};

// In-memory cache: merchantId -> ConceptIndex
const cache = new Map<string, CacheEntry>();

// Cache TTL: 5 minutes (configurable via env var in future)
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get concept index for a merchant (with caching)
 * 
 * Lazy-builds the index on first call and caches it.
 * Subsequent calls return cached index until TTL expires.
 * 
 * @param merchantId - Merchant ID (use 'default' or specific merchant ID)
 * @param forceRebuild - Force rebuild even if cached
 * @returns ConceptIndex
 */
export async function getConceptIndex(
  merchantId?: string,
  forceRebuild = false
): Promise<ConceptIndex> {
  const cacheKey = merchantId || 'default';
  const now = Date.now();
  
  // Check cache
  if (!forceRebuild) {
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.builtAt) < CACHE_TTL_MS) {
      logger.debug('getConceptIndex: cache hit', { merchantId: cacheKey });
      return cached.index;
    }
  }
  
  // Build index
  logger.info('getConceptIndex: building index', { merchantId: cacheKey, forceRebuild });
  const index = await buildConceptIndex(merchantId);
  
  // Cache it
  cache.set(cacheKey, {
    index,
    builtAt: now,
  });
  
  return index;
}

/**
 * Invalidate cache for a merchant
 * 
 * @param merchantId - Merchant ID (use 'default' or specific merchant ID)
 */
export function invalidateConceptIndex(merchantId?: string): void {
  const cacheKey = merchantId || 'default';
  cache.delete(cacheKey);
  logger.debug('invalidateConceptIndex: cache invalidated', { merchantId: cacheKey });
}

/**
 * Clear all cached indexes
 */
export function clearConceptIndexCache(): void {
  cache.clear();
  logger.debug('clearConceptIndexCache: all caches cleared');
}





