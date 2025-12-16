/**
 * Concept Index Initialization
 * 
 * Pre-warms concept index cache on server startup.
 * This module should be imported early in the application lifecycle.
 */

import { logger } from '../../telemetry/logger';
import { prewarmAllConceptIndexes } from './cache';

let prewarmStarted = false;
let prewarmPromise: Promise<void> | null = null;

/**
 * Pre-warm concept index cache for all merchants (idempotent)
 * 
 * This function can be called multiple times safely - it will only
 * pre-warm once per process. Subsequent calls return the same promise.
 * 
 * @returns Promise that resolves when pre-warming is complete
 */
export function initializeConceptIndexCache(): Promise<void> {
  if (prewarmPromise) {
    return prewarmPromise;
  }
  
  if (prewarmStarted) {
    // Already started, return a resolved promise
    return Promise.resolve();
  }
  
  prewarmStarted = true;
  
  // Start pre-warming asynchronously (don't block)
  prewarmPromise = (async () => {
    try {
      logger.info('initializeConceptIndexCache: starting pre-warm for all merchants');
      await prewarmAllConceptIndexes();
      logger.info('initializeConceptIndexCache: pre-warm complete');
    } catch (error) {
      logger.error('initializeConceptIndexCache: pre-warm failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
  
  return prewarmPromise;
}

/**
 * Initialize concept index cache for all merchants
 * 
 * This is called automatically when the module is imported.
 * For Next.js, importing this module in API routes will trigger initialization.
 */
if (typeof window === 'undefined') {
  // Only run on server-side
  initializeConceptIndexCache().catch(() => {
    // Errors already logged in initializeConceptIndexCache
  });
}

