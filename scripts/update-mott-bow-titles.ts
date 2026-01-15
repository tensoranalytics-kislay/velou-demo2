#!/usr/bin/env tsx
/**
 * CLI Script: Update Mott & Bow Product Titles
 *
 * Fixes cases where Mott & Bow products in the `Product` table have
 * generic titles like "Mens-jeans" by replacing them with the correct,
 * human-readable titles from the original deduplicated feed.
 *
 * Matching strategy:
 * - Uses the `item group id` (or `id` fallback) from mott_bow_deduplicated.csv
 * - Matches this against `Product.id` for rows with `vendorId = 'mott_bow'`
 *
 * Embeddings and all other fields are left untouched.
 *
 * Usage:
 *   # Recommended: point to the deduped CSV wherever it lives on disk
 *   MOTT_BOW_DEDUP_CSV_PATH=/absolute/path/to/mott_bow_deduplicated.csv \\
 *     npx tsx scripts/update-mott-bow-titles.ts
 *
 *   # Optional dry run (logs what would be updated, no DB writes)
 *   DRY_RUN=true MOTT_BOW_DEDUP_CSV_PATH=/path/to/mott_bow_deduplicated.csv \\
 *     npx tsx scripts/update-mott-bow-titles.ts
 *
 * Defaults:
 *   - If MOTT_BOW_DEDUP_CSV_PATH is not set, it will look for
 *     ./mott_bow_deduplicated.csv in the project root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/telemetry/logger';

const VENDOR_ID = 'mott_bow';

type TitleRow = {
  title: string;
  id?: string;
  'item group id'?: string;
  'item_group_id'?: string;
};

type TitleMap = Map<string, string>;

function getCsvPath(): string {
  const envPath = process.env.MOTT_BOW_DEDUP_CSV_PATH;
  if (envPath && envPath.trim().length > 0) {
    return envPath;
  }
  // Fallback: look for mott_bow_deduplicated.csv in the project root
  return path.resolve(process.cwd(), 'mott_bow_deduplicated.csv');
}

function isDryRun(): boolean {
  return process.env.DRY_RUN === 'true';
}

async function loadTitleMap(csvPath: string): Promise<TitleMap> {
  return new Promise<TitleMap>((resolve, reject) => {
    if (!fs.existsSync(csvPath)) {
      reject(new Error(`CSV file not found at path: ${csvPath}`));
      return;
    }

    const titleMap: TitleMap = new Map();
    let rowIndex = 0;

    const stream = fs.createReadStream(csvPath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    parser.on('data', (raw: TitleRow) => {
      rowIndex += 1;
      const title = (raw.title || '').trim();
      const itemGroupId =
        (raw['item group id'] || raw['item_group_id'] || raw.id || '').trim();

      if (!itemGroupId || !title) {
        return;
      }

      // Later rows can override earlier ones for the same group id;
      // they should all be variants of the same logical product.
      titleMap.set(itemGroupId, title);
    });

    parser.on('error', (err) => {
      reject(err);
    });

    parser.on('end', () => {
      resolve(titleMap);
    });

    stream.pipe(parser);
  });
}

async function main() {
  const csvPath = getCsvPath();
  const dryRun = isDryRun();

  console.log('\n' + '='.repeat(60));
  console.log('🔧 Updating Mott & Bow product titles');
  console.log('='.repeat(60));
  console.log(`CSV Path: ${csvPath}`);
  console.log(`Vendor ID filter: ${VENDOR_ID}`);
  console.log(`Dry Run: ${dryRun ? 'YES (no writes)' : 'NO (will update DB)'}`);
  console.log('');

  try {
    const titleMap = await loadTitleMap(csvPath);
    console.log(`Loaded ${titleMap.size} title mappings from CSV\n`);

    let totalMatched = 0;
    let totalUpdated = 0;

    for (const [itemGroupId, title] of titleMap.entries()) {
      // Product.id is the item_group_id (fallback to id) in ingestion
      const where = {
        id: itemGroupId,
        vendorId: VENDOR_ID,
      } as const;

      if (dryRun) {
        const count = await prisma.product.count({ where });
        if (count > 0) {
          totalMatched += count;
          console.log(
            `[DRY RUN] Would update title for ${count} product(s) with id='${itemGroupId}' to "${title}"`,
          );
        }
        continue;
      }

      const result = await prisma.product.updateMany({
        where,
        data: {
          title,
          updatedAt: new Date(),
        },
      });

      if (result.count > 0) {
        totalMatched += result.count;
        totalUpdated += result.count;
        logger.info('Updated Mott & Bow product title', {
          productId: itemGroupId,
          vendorId: VENDOR_ID,
          newTitle: title,
          affectedRows: result.count,
        });
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Title update run complete');
    console.log('='.repeat(60));
    console.log(`Total CSV title mappings: ${titleMap.size}`);
    console.log(`Products matched in DB:    ${totalMatched}`);
    console.log(`Products updated in DB:    ${totalUpdated}`);
    console.log('');

    if (dryRun) {
      console.log(
        'Dry run mode was enabled. Re-run without DRY_RUN=true to apply these changes.',
      );
    } else {
      console.log(
        'Embeddings and all other fields were left untouched; only Product.title was modified.',
      );
    }
  } catch (error) {
    console.error('\n❌ Failed to update Mott & Bow titles');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  prisma
    .$disconnect()
    .catch(() => {
      // ignore
    })
    .finally(() => {
      process.exit(1);
    });
});

