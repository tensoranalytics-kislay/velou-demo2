/**
 * Concept Index Cache
 * 
 * In-memory + disk cache for concept indexes, keyed by merchantId.
 * 
 * Features:
 * - In-memory cache for fast access
 * - Disk persistence to survive server restarts
 * - Pre-warming on server startup
 */

import type { ConceptIndex } from './index';
import { buildConceptIndex } from './index';
import { logger } from '../../telemetry/logger';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';

type CacheEntry = {
  index: ConceptIndex;
  builtAt: number;
};

// Serializable format for disk storage (Maps -> Objects, Sets -> Arrays)
type SerializableConceptIndex = {
  concerns: Record<string, string[]>;
  skinTypes: Record<string, string[]>;
  applicationAreas: Record<string, string[]>;
  ingredients: Record<string, string[]>;
  madeWithout: Record<string, string[]>;
  productTypes: Record<string, string[]>;
};

// In-memory cache: merchantId -> ConceptIndex
const cache = new Map<string, CacheEntry>();

// Cache TTL: 30 minutes (increased from 5 minutes for better persistence)
const CACHE_TTL_MS = 30 * 60 * 1000;

// Cache directory (in project root)
const CACHE_DIR = join(process.cwd(), '.cache', 'concept-index');

// Ensure cache directory exists
async function ensureCacheDir(): Promise<void> {
  try {
    if (!existsSync(CACHE_DIR)) {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    }
  } catch (error) {
    logger.warn('ensureCacheDir: failed to create cache directory', {
      error: error instanceof Error ? error.message : String(error),
      cacheDir: CACHE_DIR,
    });
  }
}

// Get cache file path for a merchant
function getCacheFilePath(merchantId: string): string {
  // Sanitize merchantId for filename (replace special chars)
  const safeMerchantId = merchantId.replace(/[^a-zA-Z0-9-_]/g, '_');
  return join(CACHE_DIR, `index-${safeMerchantId}.json`);
}

// Serialize ConceptIndex to JSON-serializable format
function serializeIndex(index: ConceptIndex): SerializableConceptIndex {
  const serializeMap = (map: Map<string, Set<string>>): Record<string, string[]> => {
    const result: Record<string, string[]> = {};
    for (const [key, value] of map.entries()) {
      result[key] = Array.from(value);
    }
    return result;
  };

  return {
    concerns: serializeMap(index.concerns),
    skinTypes: serializeMap(index.skinTypes),
    applicationAreas: serializeMap(index.applicationAreas),
    ingredients: serializeMap(index.ingredients),
    madeWithout: serializeMap(index.madeWithout),
    productTypes: serializeMap(index.productTypes),
  };
}

// Deserialize JSON format back to ConceptIndex
function deserializeIndex(data: SerializableConceptIndex): ConceptIndex {
  const deserializeMap = (obj: Record<string, string[]>): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    for (const [key, value] of Object.entries(obj)) {
      map.set(key, new Set(value));
    }
    return map;
  };

  return {
    concerns: deserializeMap(data.concerns),
    skinTypes: deserializeMap(data.skinTypes),
    applicationAreas: deserializeMap(data.applicationAreas),
    ingredients: deserializeMap(data.ingredients),
    madeWithout: deserializeMap(data.madeWithout),
    productTypes: deserializeMap(data.productTypes),
  };
}

// Load index from disk cache
async function loadFromDisk(merchantId: string): Promise<ConceptIndex | null> {
  try {
    const filePath = getCacheFilePath(merchantId);
    if (!existsSync(filePath)) {
      return null;
    }

    const fileContent = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContent) as { index: SerializableConceptIndex; builtAt: number };

    // Check if cache is still valid (within TTL)
    const age = Date.now() - data.builtAt;
    if (age >= CACHE_TTL_MS) {
      logger.debug('loadFromDisk: disk cache expired', {
        merchantId,
        ageMs: age,
        ageSeconds: Math.round(age / 1000),
      });
      // Delete expired cache file
      await fs.unlink(filePath).catch(() => {});
      return null;
    }

    const index = deserializeIndex(data.index);
    logger.debug('loadFromDisk: loaded from disk cache', {
      merchantId,
      cacheAgeMs: age,
      cacheAgeSeconds: Math.round(age / 1000),
    });
    return index;
  } catch (error) {
    logger.warn('loadFromDisk: failed to load from disk', {
      error: error instanceof Error ? error.message : String(error),
      merchantId,
    });
    return null;
  }
}

// Save index to disk cache
async function saveToDisk(merchantId: string, index: ConceptIndex): Promise<void> {
  try {
    await ensureCacheDir();
    const filePath = getCacheFilePath(merchantId);
    const data = {
      index: serializeIndex(index),
      builtAt: Date.now(),
    };
    await fs.writeFile(filePath, JSON.stringify(data), 'utf-8');
    logger.debug('saveToDisk: saved to disk cache', { merchantId });
  } catch (error) {
    logger.warn('saveToDisk: failed to save to disk', {
      error: error instanceof Error ? error.message : String(error),
      merchantId,
    });
    // Don't throw - disk cache is optional
  }
}

/**
 * Get concept index for a merchant (with caching)
 * 
 * Checks in-memory cache first, then disk cache, then builds if needed.
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
  
  // Check in-memory cache first
  if (!forceRebuild) {
    const cached = cache.get(cacheKey);
    if (cached) {
      const age = now - cached.builtAt;
      if (age < CACHE_TTL_MS) {
        logger.debug('getConceptIndex: in-memory cache hit', { 
          merchantId: cacheKey,
          cacheAgeMs: age,
          cacheAgeSeconds: Math.round(age / 1000),
        });
        return cached.index;
      } else {
        logger.debug('getConceptIndex: in-memory cache expired', {
          merchantId: cacheKey,
          cacheAgeMs: age,
          cacheAgeSeconds: Math.round(age / 1000),
          ttlMs: CACHE_TTL_MS,
        });
      }
    }
  }
  
  // Check disk cache if in-memory cache missed
  if (!forceRebuild) {
    const diskCheckStart = Date.now();
    const diskIndex = await loadFromDisk(cacheKey);
    const diskCheckDuration = Date.now() - diskCheckStart;
    if (diskIndex) {
      // Load into in-memory cache for fast access
      cache.set(cacheKey, {
        index: diskIndex,
        builtAt: now, // Use current time as builtAt to restart TTL
      });
      logger.info('getConceptIndex: loaded from disk cache', {
        merchantId: cacheKey,
        cacheSize: cache.size,
        diskCheckDurationMs: diskCheckDuration,
      });
      return diskIndex;
    } else {
      logger.debug('getConceptIndex: disk cache miss', {
        merchantId: cacheKey,
        diskCheckDurationMs: diskCheckDuration,
      });
    }
  }
  
  // Build index if not cached
  const buildStart = Date.now();
  logger.info('getConceptIndex: building index', { merchantId: cacheKey, forceRebuild });
  const index = await buildConceptIndex(merchantId);
  
  // Cache it (in-memory and disk)
  const buildDuration = Date.now() - buildStart;
  cache.set(cacheKey, {
    index,
    builtAt: now,
  });
  
  // Save to disk asynchronously (don't wait)
  saveToDisk(cacheKey, index).catch((error) => {
    logger.warn('getConceptIndex: failed to save to disk (non-blocking)', {
      error: error instanceof Error ? error.message : String(error),
      merchantId: cacheKey,
    });
  });
  
  logger.info('getConceptIndex: index built and cached', {
    merchantId: cacheKey,
    buildDurationMs: buildDuration,
    buildDurationSeconds: Math.round(buildDuration / 1000),
    cacheSize: cache.size,
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
 * Clear all cached indexes (in-memory only)
 */
export function clearConceptIndexCache(): void {
  cache.clear();
  logger.debug('clearConceptIndexCache: all in-memory caches cleared');
}

/**
 * Pre-warm concept index cache for a merchant
 * 
 * Loads the index into memory/disk cache on server startup to avoid
 * first-query latency. Best called during application initialization.
 * 
 * @param merchantId - Merchant ID to pre-warm (defaults to 'default')
 * @returns Promise that resolves when pre-warming is complete
 */
export async function prewarmConceptIndex(merchantId?: string): Promise<void> {
  const cacheKey = merchantId || 'default';
  try {
    logger.info('prewarmConceptIndex: starting', { merchantId: cacheKey });
    const startTime = Date.now();
    
    // This will check cache (in-memory + disk) first, then build if needed
    await getConceptIndex(merchantId, false);
    
    const duration = Date.now() - startTime;
    logger.info('prewarmConceptIndex: complete', {
      merchantId: cacheKey,
      durationMs: duration,
      durationSeconds: Math.round(duration / 1000),
    });
  } catch (error) {
    logger.error('prewarmConceptIndex: failed', {
      error: error instanceof Error ? error.message : String(error),
      merchantId: cacheKey,
    });
    // Don't throw - pre-warming is best-effort
  }
}

/**
 * Pre-warm concept index for all active merchants
 * 
 * Finds all merchants and pre-warms their indexes.
 * Useful for server startup initialization.
 */
export async function prewarmAllConceptIndexes(): Promise<void> {
  try {
    const { prisma } = await import('../../db');
    const merchants = await prisma.merchant.findMany({
      select: { id: true },
      take: 10, // Limit to first 10 merchants to avoid long startup
    });
    
    logger.info('prewarmAllConceptIndexes: starting', { merchantCount: merchants.length });
    
    // Pre-warm default merchant first
    await prewarmConceptIndex();
    
    // Pre-warm other merchants in parallel (but limit concurrency)
    const promises = merchants.slice(0, 5).map(merchant => 
      prewarmConceptIndex(merchant.id).catch(error => {
        logger.warn('prewarmAllConceptIndexes: failed for merchant', {
          merchantId: merchant.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
    
    await Promise.all(promises);
    
    logger.info('prewarmAllConceptIndexes: complete', { merchantCount: merchants.length });
  } catch (error) {
    logger.error('prewarmAllConceptIndexes: failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - pre-warming is best-effort
  }
}





