/**
 * Helper to retrieve DatasetContext from Merchant
 * This context is inferred during catalog ingestion and used to adapt
 * LLM prompts and search behavior to the catalog's vertical and available facets.
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type { DatasetContext } from './datasetInspector';

/**
 * Retrieve DatasetContext from Merchant (non-blocking, returns null if not available)
 */
export async function getDatasetContext(): Promise<DatasetContext | null> {
  try {
    const merchant = await prisma.merchant.findUnique({
      where: { slug: 'default' },
      select: { datasetContext: true },
    });

    if (!merchant || !merchant.datasetContext) {
      logger.debug('dataset_context_not_found', {
        message: 'No DatasetContext in Merchant, prompts will use generic language',
        hasMerchant: !!merchant,
        hasDatasetContext: !!merchant?.datasetContext,
      });
      console.log('[getDatasetContext] No DatasetContext found:', {
        hasMerchant: !!merchant,
        hasDatasetContext: !!merchant?.datasetContext,
      });
      return null;
    }

    // Prisma returns JSON as unknown, so we need to validate/cast it
    const context = merchant.datasetContext as unknown as DatasetContext;

    // Basic validation
    if (typeof context !== 'object' || context === null) {
      logger.warn('dataset_context_invalid', {
        message: 'DatasetContext in Merchant is not a valid object',
      });
      return null;
    }

    logger.debug('dataset_context_loaded', {
      vertical: context.vertical,
      hasPrimaryFacets: Boolean(context.primaryFacets?.length),
      hasSampleCategories: Boolean(context.sampleCategories?.length),
    });

    return context;
  } catch (error) {
    logger.warn('failed_to_load_dataset_context', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

