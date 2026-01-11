/**
 * Enriched CSV Ingestion Service
 * 
 * Ingests enriched CSV files, groups rows by item_group_id, and creates
 * Product records using the standardized mapping. Variant-level size/color
 * information (variant_sizes, variant_colors) is stored in Product.attributes
 * as arrays for efficient filtering. All enriched attributes are stored in
 * indexed columns on the Product model for fast querying.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import { parseEnrichedCsv } from './parseEnrichedCsv';
import type { EnrichedCatalogRow } from './enrichedTypes';
import { mapEnrichedToProduct } from './mapEnrichedToProduct';
import { IngestionMode } from '@prisma/client';

export interface IngestionSummary {
  totalRows: number;
  inserted: number;
  updated: number;
  invalidRows: number;
  issues: Array<{ level: 'error' | 'warning'; message: string; rowIndex?: number }>;
  batchId: string;
}

type IngestionOptions = {
  mode?: IngestionMode;
};

/**
 * Ingest enriched CSV stream into database
 * 
 * Groups rows by item_group_id, creates one Product per group.
 * Variant sizes and colors are stored in Product.attributes as arrays.
 * All enriched attributes are stored in indexed columns for fast querying.
 * 
 * @param stream - CSV file stream
 * @param vendorId - Vendor ID
 * @param merchantId - Merchant ID
 * @param options - Ingestion options
 * @returns Ingestion summary
 */
export async function ingestEnrichedCsvStream(
  stream: NodeJS.ReadableStream,
  vendorId: string,
  merchantId: string,
  options?: IngestionOptions,
): Promise<IngestionSummary> {
  const batchId = randomUUID();
  const summary: IngestionSummary = {
    totalRows: 0,
    inserted: 0,
    updated: 0,
    invalidRows: 0,
    issues: [],
    batchId,
  };

  const groups = new Map<string, EnrichedCatalogRow[]>();

  // Parse CSV and group by item_group_id
  for await (const { rowIndex, normalized } of parseEnrichedCsv(stream)) {
    summary.totalRows += 1;
    if (!normalized.id || !normalized.item_group_id || !normalized.title_clean || !normalized.link_base || !normalized.image_link) {
      summary.invalidRows += 1;
      summary.issues.push({ level: 'error', message: 'Missing required fields', rowIndex });
      continue;
    }
    const key = normalized.item_group_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(normalized);
  }

  // Full replace mode: delete existing products for this merchant
  if (options?.mode === IngestionMode.FULL_REPLACE) {
    await prisma.product.deleteMany({ where: { merchantId } });
  }

  // Process each product group
  const totalGroups = groups.size;
  let processedGroups = 0;
  
  for (const rows of groups.values()) {
    try {
      const { product } = mapEnrichedToProduct(rows, merchantId, vendorId, batchId);

      await prisma.product.upsert({
        where: { id: product.id },
        update: {
          ...product,
          updatedAt: new Date(),
        },
        create: product,
      });

      summary.inserted += 1;
      processedGroups += 1;
      
      // Log progress every 50 products
      if (processedGroups % 50 === 0 || processedGroups === totalGroups) {
        logger.info('Ingestion progress', {
          processed: processedGroups,
          total: totalGroups,
          percentage: Math.round((processedGroups / totalGroups) * 100),
        });
      }
    } catch (error) {
      summary.invalidRows += 1;
      summary.issues.push({
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      logger.error('Failed to upsert product group', {
        itemGroupId: rows[0]?.item_group_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

// Export as EnrichedIngestionSummary for backward compatibility
export type EnrichedIngestionSummary = IngestionSummary;
