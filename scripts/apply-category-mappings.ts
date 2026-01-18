#!/usr/bin/env tsx

/**
 * Apply Verified Category Mappings to Database
 * 
 * This script loads verified mappings from category-normalization-mapping.json
 * and applies them to the database, updating Product.category and Product.subcategory.
 * 
 * Usage:
 *   npx tsx scripts/apply-category-mappings.ts [--dry-run]
 */

import { prisma } from '../src/lib/db';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const MAPPING_FILE = join(process.cwd(), 'category-normalization-mapping.json');
const BACKUP_FILE = join(process.cwd(), 'category-normalization-backup.json');

interface CategoryMapping {
  original: string;
  normalized: {
    category: string;
    subcategory: string | null;
  };
  verified: boolean;
  productCount?: number;
}

async function backupCategories(): Promise<Map<string, { category: string; subcategory: string | null }>> {
  console.log('💾 Creating backup of original categories...\n');
  
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      await prisma.$connect();
      const products = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, category: true, subcategory: true },
      });

      const backup: Record<string, { category: string; subcategory: string | null }> = {};
      for (const product of products) {
        if (product.category) {
          backup[product.id] = {
            category: product.category,
            subcategory: product.subcategory || null,
          };
        }
      }

      writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
      console.log(`   ✅ Backup saved: ${products.length} products backed up to ${BACKUP_FILE}\n`);
      return new Map(Object.entries(backup));
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        console.error(`   ❌ Failed to backup after ${maxAttempts} attempts`);
        throw error;
      }
      console.log(`   ⚠️  Backup attempt ${attempts} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
    }
  }
  
  throw new Error('Backup failed after retries');
}

async function applyMappings(): Promise<void> {
  console.log('📝 Loading verified mappings...\n');
  
  if (!existsSync(MAPPING_FILE)) {
    throw new Error(`Mapping file not found: ${MAPPING_FILE}`);
  }

  const allMappings = JSON.parse(readFileSync(MAPPING_FILE, 'utf-8')) as CategoryMapping[];
  const verifiedMappings = allMappings.filter(m => m.verified === true);
  
  console.log(`   Total mappings in file: ${allMappings.length}`);
  console.log(`   Verified mappings: ${verifiedMappings.length}\n`);

  if (verifiedMappings.length === 0) {
    throw new Error('No verified mappings found in file');
  }

  // Create a map for quick lookup: original category → normalized
  const mappingMap = new Map<string, { category: string; subcategory: string | null }>();
  for (const mapping of verifiedMappings) {
    mappingMap.set(mapping.original, mapping.normalized);
  }

  console.log(`📝 Updating categories in database${DRY_RUN ? ' (DRY RUN - no changes will be made)' : ''}...\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors: Array<{ productId: string; error: string }> = [];

  const batchSize = 100;
  const categoryKeys = Array.from(mappingMap.keys());
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const batchCategories = categoryKeys.slice(offset, offset + batchSize);
    if (batchCategories.length === 0) {
      hasMore = false;
      break;
    }

    try {
      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          category: { in: batchCategories },
        },
        select: {
          id: true,
          category: true,
          subcategory: true,
        },
      });

      for (const product of products) {
        if (!product.category) {
          skipped++;
          continue;
        }

        const mapping = mappingMap.get(product.category);
        if (!mapping) {
          skipped++;
          continue;
        }

        processed++;

        // Skip if already normalized (avoid unnecessary updates)
        if (product.category === mapping.category && product.subcategory === mapping.subcategory) {
          skipped++;
          continue;
        }

        try {
          if (!DRY_RUN) {
            await prisma.product.update({
              where: { id: product.id },
              data: {
                category: mapping.category,
                subcategory: mapping.subcategory,
              },
            });
          }
          updated++;
        } catch (error) {
          errors.push({
            productId: product.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      offset += batchSize;
      hasMore = offset < categoryKeys.length;

      if (processed % 500 === 0) {
        console.log(`   Progress: ${processed} processed, ${updated} updated, ${skipped} skipped`);
      }
    } catch (error) {
      console.error(`   ❌ Error processing batch at offset ${offset}:`, error);
      // Continue with next batch
      offset += batchSize;
      hasMore = offset < categoryKeys.length;
    }
  }

  console.log('\n📊 Summary:\n');
  console.log(`   Categories with mappings: ${mappingMap.size}`);
  console.log(`   Products processed: ${processed}`);
  console.log(`   Products updated: ${updated}`);
  console.log(`   Products skipped: ${skipped}`);
  console.log(`   Errors: ${errors.length}\n`);

  if (DRY_RUN) {
    console.log('   ⚠️  DRY RUN mode: No database changes were made');
    console.log('   Run without --dry-run to apply changes\n');
  } else {
    console.log('   ✅ Category normalization complete!\n');
  }

  if (errors.length > 0) {
    console.log(`   ⚠️  Update errors (${errors.length}):`);
    errors.slice(0, 10).forEach(({ productId, error }) => {
      console.log(`      - Product ${productId}: ${error}`);
    });
    if (errors.length > 10) {
      console.log(`      ... and ${errors.length - 10} more errors`);
    }
    console.log();
  }
}

async function main() {
  console.log('🎯 Apply Category Mappings to Database\n');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE (will update database)'}\n`);

  try {
    // Ensure database connection
    await prisma.$connect();
    
    // Step 1: Backup (if not dry run and backup doesn't exist)
    if (!DRY_RUN && !existsSync(BACKUP_FILE)) {
      await backupCategories();
    }

    // Step 2: Apply mappings
    await applyMappings();

    if (!DRY_RUN) {
      console.log('Next steps:');
      console.log('   1. Verify a sample of updated products');
      console.log('   2. Check category count: SELECT COUNT(DISTINCT "category") FROM "Product" WHERE "isActive" = true\n');
    }
  } catch (error) {
    console.error('\n❌ Failed:', error);
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
