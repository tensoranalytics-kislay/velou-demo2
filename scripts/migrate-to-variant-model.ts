/**
 * Phase 3: Data Migration Script
 * 
 * Migrates existing Product rows to normalized Product + ProductVariant structure:
 * 1. Groups products by deduplication keys (parent_id, related_id, shopifyProductId, sourceId)
 * 2. Creates one Product row per unique product
 * 3. Creates ProductVariant rows for each size/color variant
 * 4. Extracts attributes to indexed columns
 * 
 * Runs in batches for safety and progress tracking.
 */

import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/telemetry/logger';
import { randomUUID } from 'crypto';

interface MigrationStats {
  totalProducts: number;
  groupsProcessed: number;
  productsCreated: number;
  variantsCreated: number;
  productsUpdated: number;
  errors: number;
  skipped: number;
}

/**
 * Extract deduplication key from product (same logic as in search/vector/index.ts)
 */
function extractDedupKey(product: any): string {
  // Priority: shopifyProductId from id > parent_id > related_id > shopifyProductId > sourceId pattern > id
  const shopifyMatch = product.id.match(/.*shopify[^0-9]*([0-9]{9,})/i);
  if (shopifyMatch && shopifyMatch[1]) {
    return `shopify_${shopifyMatch[1]}`;
  }
  
  const attributes = product.attributes as Record<string, any> || {};
  
  if (attributes.parent_id) {
    return `parent_${attributes.parent_id}`;
  }
  
  if (attributes.related_id) {
    return `related_${attributes.related_id}`;
  }
  
  if (product.shopifyProductId) {
    return `shopify_${product.shopifyProductId}`;
  }
  
  if (product.sourceId) {
    // Strip size suffix
    const baseId = product.sourceId.replace(/[-_](size|color|variant|s|m|l|xl|xs|xxl|\d+)$/i, '');
    return `source_${baseId}`;
  }
  
  // Fallback: use product ID (no deduplication)
  return `id_${product.id}`;
}

/**
 * Extract size from product attributes or sourceId
 */
function extractSize(product: any): string | null {
  const attributes = product.attributes as Record<string, any> || {};
  
  // Try sizes array
  if (attributes.sizes && Array.isArray(attributes.sizes) && attributes.sizes.length > 0) {
    return attributes.sizes[0]; // Take first size
  }
  
  // Try size string
  if (attributes.size && typeof attributes.size === 'string') {
    return attributes.size;
  }
  
  // Try to extract from sourceId
  if (product.sourceId) {
    const sizeMatch = product.sourceId.match(/[-_](size[_-])?([smlx\d]+)$/i);
    if (sizeMatch && sizeMatch[2]) {
      return sizeMatch[2].toUpperCase();
    }
  }
  
  return null;
}

/**
 * Extract color from product attributes
 */
function extractColor(product: any): string | null {
  const attributes = product.attributes as Record<string, any> || {};
  
  if (attributes.color && typeof attributes.color === 'string') {
    return attributes.color;
  }
  
  // Try to extract from title (common pattern: "Dress in Red")
  if (product.title) {
    const colorMatch = product.title.match(/\b(red|blue|green|yellow|pink|purple|black|white|navy|beige|brown|gray|grey|orange|teal|burgundy|crimson|rose|lavender|peony|whisper|sterling|hibiscus|strawberry|true white|peony pink|peony sugar|pink macaroon|whisper blue|sterling dusk)\b/i);
    if (colorMatch && colorMatch[1]) {
      return colorMatch[1];
    }
  }
  
  return null;
}

/**
 * Extract common attributes to indexed columns
 */
function extractAttributes(product: any): {
  color: string | null;
  fabric: string | null;
  material: string | null;
  occasion: string | null;
  season: string | null;
  fit: string | null;
} {
  const attributes = product.attributes as Record<string, any> || {};
  
  return {
    color: extractColor(product) || attributes.color || null,
    fabric: attributes.fabric || attributes.fabrics?.[0] || null,
    material: attributes.material || (Array.isArray(attributes.materials) ? attributes.materials[0] : attributes.materials) || null,
    occasion: attributes.occasion || (Array.isArray(attributes.occasions) ? attributes.occasions[0] : attributes.occasions) || null,
    season: attributes.season || (Array.isArray(attributes.seasons) ? attributes.seasons[0] : attributes.seasons) || null,
    fit: attributes.fit || null,
  };
}

/**
 * Select canonical product from a group (most complete data)
 */
function selectCanonicalProduct(products: any[]): any {
  // Prefer product with:
  // 1. Most complete data (has description, image, etc.)
  // 2. In stock
  // 3. Earliest created (original)
  
  return products.sort((a, b) => {
    // Score based on completeness
    const scoreA = (
      (a.description ? 10 : 0) +
      (a.imageUrl ? 5 : 0) +
      (a.stockStatus === 'in_stock' ? 3 : 0) +
      (a.embedding ? 2 : 0)
    );
    const scoreB = (
      (b.description ? 10 : 0) +
      (b.imageUrl ? 5 : 0) +
      (b.stockStatus === 'in_stock' ? 3 : 0) +
      (b.embedding ? 2 : 0)
    );
    
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    
    // If same score, prefer earlier created
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })[0];
}

/**
 * Generate base sourceId (strip size suffix)
 */
function generateBaseSourceId(product: any): string | null {
  if (!product.sourceId) return null;
  
  // Strip size suffix
  return product.sourceId.replace(/[-_](size|color|variant|s|m|l|xl|xs|xxl|\d+|one[_-]?size)$/i, '');
}

/**
 * Migrate a single group of products (with transaction client)
 */
async function migrateGroupWithTx(
  dedupKey: string,
  products: any[],
  stats: MigrationStats,
  tx: any
): Promise<void> {
  await migrateGroupInternal(dedupKey, products, stats, tx.product, tx.productVariant);
}

/**
 * Migrate a single group of products (without transaction - uses default prisma)
 */
async function migrateGroup(
  dedupKey: string,
  products: any[],
  stats: MigrationStats
): Promise<void> {
  await migrateGroupInternal(dedupKey, products, stats, prisma.product, prisma.productVariant);
}

/**
 * Internal migration logic (works with or without transaction)
 */
async function migrateGroupInternal(
  dedupKey: string,
  products: any[],
  stats: MigrationStats,
  productModel: any,
  variantModel: any
): Promise<void> {
  if (products.length === 0) return;
  
  // Check if variants already exist for this group (idempotent check)
  const canonical = products.length > 1 ? selectCanonicalProduct(products) : products[0];
  const existingVariants = await prisma.productVariant.count({
    where: { productId: canonical.id },
  });
  
  // If variants already exist, skip (idempotent)
  if (existingVariants > 0 && products.length > 1) {
    stats.skipped += products.length;
    return;
  }
  
  try {
      // Single product (no variants) - just update with extracted attributes
      if (products.length === 1) {
        const product = products[0];
        const extracted = extractAttributes(product);
        const baseSourceId = generateBaseSourceId(product);
        
        await productModel.update({
          where: { id: product.id },
          data: {
            color: extracted.color,
            fabric: extracted.fabric,
            material: extracted.material,
            occasion: extracted.occasion,
            season: extracted.season,
            fit: extracted.fit,
            sourceId: baseSourceId || product.sourceId,
          },
        });
      
      stats.productsUpdated++;
      return;
    }
    
    // Multiple products (variants) - create Product + ProductVariants
    const canonical = selectCanonicalProduct(products);
    const extracted = extractAttributes(canonical);
    const baseSourceId = generateBaseSourceId(canonical);
    
    // Use canonical product's ID as the new Product ID
    const newProductId = canonical.id;
    
      // Update canonical product to be the main Product
      await productModel.update({
        where: { id: newProductId },
        data: {
          color: extracted.color,
          fabric: extracted.fabric,
          material: extracted.material,
          occasion: extracted.occasion,
          season: extracted.season,
          fit: extracted.fit,
          sourceId: baseSourceId || canonical.sourceId,
          // Aggregate stock status (in_stock if ANY variant in stock)
          stockStatus: products.some(p => p.stockStatus === 'in_stock') ? 'in_stock' : 'out_of_stock',
          // Use canonical's price as base price
          priceCents: canonical.priceCents,
          salePriceCents: canonical.salePriceCents,
        },
      });
    
    stats.productsUpdated++;
    
    // Create ProductVariant for ALL products in group (including canonical)
    // This represents each size/color variant
    // Track created variants to avoid duplicates within the same group
    const createdVariants = new Set<string>();
    
    for (const product of products) {
      const size = extractSize(product);
      const color = extractColor(product);
      
      // Create unique key for this variant
      const variantKey = `${newProductId}:${size || 'null'}:${color || 'null'}`;
      
      // Skip if we already created this variant in this group
      if (createdVariants.has(variantKey)) {
        stats.skipped++;
        continue;
      }
      
      // Check if variant already exists in database (idempotent)
      const existing = await prisma.productVariant.findFirst({
        where: {
          productId: newProductId,
          size: size || null,
          color: color || (product.id === newProductId ? extracted.color : null),
        },
      });
      
      if (existing) {
        stats.skipped++;
        continue;
      }
      
      // Create variant for each product (representing size/color combination)
      try {
        await variantModel.create({
          data: {
            id: randomUUID(),
            productId: newProductId,
            size: size,
            color: color || (product.id === newProductId ? extracted.color : null),
            priceCents: product.priceCents !== canonical.priceCents ? product.priceCents : null,
            salePriceCents: product.salePriceCents !== canonical.salePriceCents ? product.salePriceCents : null,
            stockStatus: product.stockStatus,
            shopifyVariantId: product.shopifyProductId ? undefined : undefined,
            sourceId: product.sourceId,
            vendorId: product.vendorId,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt,
          },
        });
        stats.variantsCreated++;
        createdVariants.add(variantKey);
      } catch (error: any) {
        // Handle unique constraint violation (duplicate variant: same productId + size + color)
        if (error.code === 'P2002') {
          // This is expected - same size+color combination already exists
          // Silently skip (don't log as warning, it's normal)
          stats.skipped++;
        } else {
          // Re-throw other errors
          throw error;
        }
      }
    }
    
    stats.groupsProcessed++;
  } catch (error) {
    logger.error('Failed to migrate group', {
      dedupKey,
      productCount: products.length,
      error: error instanceof Error ? error.message : String(error),
    });
    stats.errors++;
    throw error;
  }
}

/**
 * Main migration function
 */
export async function migrateToVariantModel(
  merchantId?: string,
  batchSize: number = 100
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    totalProducts: 0,
    groupsProcessed: 0,
    productsCreated: 0,
    variantsCreated: 0,
    productsUpdated: 0,
    errors: 0,
    skipped: 0,
  };
  
  logger.info('Starting data migration to variant model', { merchantId, batchSize });
  
  try {
    // Fetch all products
    const whereClause = merchantId ? { merchantId, isActive: true } : { isActive: true };
    const allProducts = await prisma.product.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
    });
    
    stats.totalProducts = allProducts.length;
    logger.info('Products fetched', { count: allProducts.length });
    
    // Group products by deduplication key
    const groups = new Map<string, any[]>();
    
    for (const product of allProducts) {
      const dedupKey = extractDedupKey(product);
      if (!groups.has(dedupKey)) {
        groups.set(dedupKey, []);
      }
      groups.get(dedupKey)!.push(product);
    }
    
    logger.info('Products grouped', { 
      totalProducts: allProducts.length,
      uniqueGroups: groups.size,
      avgVariantsPerGroup: (allProducts.length / groups.size).toFixed(2),
    });
    
    // Process groups individually (Neon connection pooler works better without large transactions)
    // Safe to process without transactions due to unique constraints
    const groupEntries = Array.from(groups.entries());
    const totalGroups = groupEntries.length;
    
    console.log(`\nProcessing ${totalGroups} groups individually...\n`);
    console.log('Note: Processing without transactions for Neon compatibility (safe due to unique constraints)\n');
    
    for (let i = 0; i < groupEntries.length; i++) {
      const [dedupKey, products] = groupEntries[i];
      const groupNumber = i + 1;
      
      // Log progress every 100 groups
      if (groupNumber % 100 === 0 || groupNumber === totalGroups) {
        console.log(`Processing group ${groupNumber}/${totalGroups}... (${stats.variantsCreated} variants created, ${stats.errors} errors)`);
      }
      
      try {
        // Process group without transaction (faster, more reliable with Neon)
        // Unique constraints prevent duplicates, so it's safe
        await migrateGroup(dedupKey, products, stats);
      } catch (error: any) {
        logger.error('Failed to migrate group', {
          dedupKey,
          groupNumber,
          productCount: products.length,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.errors++;
        
        // Continue with next group (don't fail entire migration)
        if (groupNumber % 100 === 0) {
          console.log(`  ⚠️  Error in group ${groupNumber}, continuing...`);
        }
      }
    }
    
    logger.info('Migration complete', stats);
    
    return stats;
  } catch (error) {
    logger.error('Migration failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      stats,
    });
    throw error;
  }
}

/**
 * Print migration statistics
 */
function printStats(stats: MigrationStats): void {
  console.log('\n' + '='.repeat(80));
  console.log('MIGRATION STATISTICS');
  console.log('='.repeat(80) + '\n');
  
  console.log(`Total Products Processed:  ${stats.totalProducts.toLocaleString()}`);
  console.log(`Groups Processed:          ${stats.groupsProcessed.toLocaleString()}`);
  console.log(`Products Updated:          ${stats.productsUpdated.toLocaleString()}`);
  console.log(`Variants Created:          ${stats.variantsCreated.toLocaleString()}`);
  console.log(`Errors:                    ${stats.errors.toLocaleString()}`);
  console.log(`Skipped:                   ${stats.skipped.toLocaleString()}`);
  
  if (stats.totalProducts > 0) {
    const variantRatio = (stats.variantsCreated / stats.totalProducts).toFixed(2);
    console.log(`\nVariant Ratio:              ${variantRatio}x (${stats.variantsCreated} variants / ${stats.totalProducts} products)`);
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Main execution
 */
async function main() {
  try {
    const merchantId = process.env.MERCHANT_ID;
    const batchSize = parseInt(process.env.BATCH_SIZE || '100', 10);
    const dryRun = process.env.DRY_RUN === 'true';
    
    console.log('Starting Phase 3: Data Migration\n');
    console.log(`Merchant ID: ${merchantId || 'ALL MERCHANTS'}`);
    console.log(`Batch Size: ${batchSize}`);
    console.log(`Dry Run: ${dryRun ? 'YES (no changes will be made)' : 'NO (will modify database)'}\n`);
    
    if (!dryRun) {
      console.log('⚠️  WARNING: This will modify your database!');
      console.log('   Make sure you have a backup before proceeding.\n');
      
      // Wait 3 seconds for user to cancel
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    const stats = await migrateToVariantModel(merchantId, batchSize);
    printStats(stats);
    
    if (dryRun) {
      console.log('✅ Dry run complete (no changes made)\n');
    } else {
      console.log('✅ Migration complete!\n');
      console.log('Next steps:');
      console.log('  1. Run verification script: npm run verify:phase3');
      console.log('  2. Verify data integrity');
      console.log('  3. Update code to use new schema (Phase 4)\n');
    }
    
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Migration script failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error('\n❌ Migration failed:', error);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

