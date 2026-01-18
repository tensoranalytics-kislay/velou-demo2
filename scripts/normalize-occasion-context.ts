#!/usr/bin/env tsx

/**
 * Normalize Occasions - Migrate from occasion string to occasionContext array
 * 
 * This script normalizes occasions by migrating comma-separated values from the
 * `occasion` string column to the `occasionContext` array column.
 * 
 * Problem:
 * - `occasion` string column has 3,157 products with comma-separated values like "Evening, Party"
 * - Dictionary builder extracts these as single entries, creating 150 combinations
 * - Individual occasions like "Brunch" can't be matched when stored as "Brunch, Date Night, Daytime"
 * 
 * Solution:
 * 1. Load all products with comma-separated `occasion` strings
 * 2. Split comma-separated strings into individual occasions
 * 3. Merge with existing `occasionContext` array (deduplicate)
 * 4. Update `occasionContext` array and clear `occasion` string
 * 5. Update dictionary builder to split comma-separated strings from `occasion` column
 * 
 * Usage:
 *   npx tsx scripts/normalize-occasion-context.ts [--dry-run]
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 */

import { prisma } from '../src/lib/db';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const BACKUP_FILE = join(process.cwd(), 'occasion-context-normalization-backup.json');

interface NormalizationResult {
  processed: number;
  updated: number;
  skipped: number;
  totalOccasionsBefore: number;
  totalOccasionsAfter: number;
  errors: Array<{ productId: string; error: string }>;
}

/**
 * Split comma-separated string into individual occasions
 * Handles various formats: "Brunch, Date Night", "Brunch,Date Night", etc.
 */
function splitCommaSeparatedOccasions(value: string): string[] {
  return value
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0);
}

/**
 * Normalize an occasionContext array
 * - Split any comma-separated elements
 * - Deduplicate while preserving order
 * - Return normalized array
 */
function normalizeOccasionContext(occasionContext: string[] | null | undefined): string[] | null {
  if (!occasionContext || !Array.isArray(occasionContext) || occasionContext.length === 0) {
    return null;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of occasionContext) {
    if (!item || typeof item !== 'string') {
      continue;
    }

    // Check if item contains commas (comma-separated string)
    if (item.includes(',')) {
      // Split and add individual occasions
      const split = splitCommaSeparatedOccasions(item);
      for (const occ of split) {
        const trimmed = occ.trim();
        if (trimmed && !seen.has(trimmed)) {
          normalized.push(trimmed);
          seen.add(trimmed);
        }
      }
    } else {
      // Single occasion, just add if not seen
      const trimmed = item.trim();
      if (trimmed && !seen.has(trimmed)) {
        normalized.push(trimmed);
        seen.add(trimmed);
      }
    }
  }

  return normalized.length > 0 ? normalized : null;
}

/**
 * Backup original occasionContext values
 */
async function backupOccasionContexts(): Promise<Map<string, string[]>> {
  console.log('💾 Creating backup of original occasionContext values...\n');

  const products = await prisma.product.findMany({
    where: {
      occasionContext: { isEmpty: false },
      isActive: true,
    },
    select: {
      id: true,
      occasionContext: true,
    },
  });

  const backup: Record<string, string[]> = {};
  for (const product of products) {
    if (product.occasionContext && product.occasionContext.length > 0) {
      backup[product.id] = product.occasionContext;
    }
  }

  writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
  console.log(`   ✅ Backup saved: ${products.length} products backed up to ${BACKUP_FILE}\n`);

  return new Map(Object.entries(backup));
}

/**
 * Merge arrays, deduplicating while preserving order
 */
function mergeOccasionArrays(arr1: string[] | null, arr2: string[] | null): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  const addIfNotSeen = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed)) {
      merged.push(trimmed);
      seen.add(trimmed);
    }
  };

  if (arr1) {
    for (const item of arr1) {
      addIfNotSeen(item);
    }
  }

  if (arr2) {
    for (const item of arr2) {
      addIfNotSeen(item);
    }
  }

  return merged;
}

/**
 * Normalize occasions by migrating from occasion string to occasionContext array
 */
async function normalizeOccasionContexts(): Promise<NormalizationResult> {
  console.log(`📝 Migrating occasions from string column to array column${DRY_RUN ? ' (DRY RUN - no changes will be made)' : ''}...\n`);

  const result: NormalizationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    totalOccasionsBefore: 0,
    totalOccasionsAfter: 0,
    errors: [],
  };

  const batchSize = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    // Get products with comma-separated occasion strings OR existing occasionContext arrays
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { occasion: { contains: ',' } },
          { occasionContext: { isEmpty: false } },
        ],
      },
      select: {
        id: true,
        occasion: true,
        occasionContext: true,
      },
      take: batchSize,
      skip: offset,
    });

    if (products.length === 0) {
      hasMore = false;
      break;
    }

    for (const product of products) {
      result.processed++;

      // Extract occasions from occasion string column (split comma-separated)
      let occasionsFromString: string[] = [];
      if (product.occasion && product.occasion.includes(',')) {
        occasionsFromString = splitCommaSeparatedOccasions(product.occasion);
      } else if (product.occasion && !product.occasion.includes(',')) {
        // Single occasion (no comma)
        occasionsFromString = [product.occasion.trim()].filter(Boolean);
      }

      // Get existing occasionContext array
      const existingContext = product.occasionContext || [];

      // Count before
      const beforeCount = existingContext.length + (product.occasion ? 1 : 0);
      result.totalOccasionsBefore += beforeCount;

      // Merge occasions: existing occasionContext + split occasions from occasion string
      const merged = mergeOccasionArrays(existingContext, occasionsFromString);

      // Check if we need to update
      const needsUpdate = 
        (occasionsFromString.length > 0) || // Has occasions from string column to migrate
        (existingContext.length !== merged.length) || // Length changed (deduplication)
        JSON.stringify(existingContext.sort()) !== JSON.stringify(merged.sort()); // Contents changed

      if (!needsUpdate || merged.length === 0) {
        result.skipped++;
        result.totalOccasionsAfter += merged.length;
        continue;
      }

      result.totalOccasionsAfter += merged.length;

      try {
        if (!DRY_RUN) {
          await prisma.product.update({
            where: { id: product.id },
            data: {
              occasionContext: merged.length > 0 ? merged : [],
              // Clear occasion string column since we've migrated to occasionContext
              occasion: occasionsFromString.length > 0 ? null : product.occasion,
            },
          });
        }
        result.updated++;
      } catch (error) {
        result.errors.push({
          productId: product.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    offset += batchSize;

    if (products.length < batchSize) {
      hasMore = false;
    }

    // Log progress every 500 products
    if (result.processed % 500 === 0) {
      console.log(`   Progress: ${result.processed} processed, ${result.updated} updated, ${result.skipped} skipped`);
    }
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  console.log('🎯 OccasionContext Normalization Script\n');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE (will update database)'}\n`);

  try {
    // Step 1: Backup (only if not dry-run and no backup exists)
    if (!DRY_RUN && !existsSync(BACKUP_FILE)) {
      await backupOccasionContexts();
    }

    // Step 2: Normalize occasionContext arrays
    const result = await normalizeOccasionContexts();

    // Step 3: Summary
    console.log('\n📊 Summary:\n');
    console.log(`   Products processed: ${result.processed}`);
    console.log(`   Products updated: ${result.updated}`);
    console.log(`   Products skipped: ${result.skipped}`);
    console.log(`   Total occasions before: ${result.totalOccasionsBefore}`);
    console.log(`   Total occasions after: ${result.totalOccasionsAfter}`);
    console.log(`   Occasions reduction: ${result.totalOccasionsBefore - result.totalOccasionsAfter} (deduplicated)\n`);

    if (DRY_RUN) {
      console.log('   ⚠️  DRY RUN mode: No database changes were made');
      console.log('   Run without --dry-run to apply changes\n');
    } else {
      console.log('   ✅ Normalization complete!\n');
      console.log('   Next steps:');
      console.log('   1. Verify a sample of updated products');
      console.log('   2. Rebuild dictionaries: npx tsx scripts/build-constraint-dictionaries.ts\n');
    }

    if (result.errors.length > 0) {
      console.log(`   ⚠️  Errors (${result.errors.length}):`);
      result.errors.slice(0, 5).forEach(({ productId, error }) => {
        console.log(`      - Product ${productId}: ${error}`);
      });
      if (result.errors.length > 5) {
        console.log(`      ... and ${result.errors.length - 5} more errors`);
      }
      console.log();
    }
  } catch (error) {
    console.error('\n❌ Normalization failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
