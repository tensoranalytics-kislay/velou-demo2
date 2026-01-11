/**
 * Database Analysis Script - Phase 1
 * 
 * Analyzes the current database structure to understand:
 * - Product duplication patterns
 * - Size variant distribution
 * - Deduplication key availability
 * - Data quality issues
 */

import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/telemetry/logger';

interface AnalysisResults {
  totalProducts: number;
  uniqueProducts: number;
  avgVariantsPerProduct: number;
  productsWithParentId: number;
  productsWithRelatedId: number;
  productsWithShopifyId: number;
  productsWithoutDedupKey: number;
  sizeDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  duplicateGroups: Array<{
    dedupKey: string;
    variantCount: number;
    productIds: string[];
  }>;
  sampleDuplicates: Array<{
    id: string;
    title: string;
    dedupKey: string;
    size: string | null;
    parentId: string | null;
    relatedId: string | null;
  }>;
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
 * Run comprehensive database analysis
 */
export async function analyzeDatabase(merchantId?: string): Promise<AnalysisResults> {
  logger.info('Starting database analysis', { merchantId });
  
  const whereClause = merchantId ? { merchantId, isActive: true } : { isActive: true };
  
  // 1. Basic counts
  const totalProducts = await prisma.product.count({ where: whereClause });
  logger.info('Total products', { totalProducts });
  
  // 2. Products with deduplication keys
  const productsWithParentId = await prisma.product.count({
    where: {
      ...whereClause,
      attributes: {
        path: ['parent_id'],
        not: null,
      },
    },
  });
  
  const productsWithRelatedId = await prisma.product.count({
    where: {
      ...whereClause,
      attributes: {
        path: ['related_id'],
        not: null,
      },
    },
  });
  
  const productsWithShopifyId = await prisma.product.count({
    where: {
      ...whereClause,
      shopifyProductId: { not: null },
    },
  });
  
  // 3. Fetch all products to analyze deduplication
  logger.info('Fetching all products for analysis...');
  const allProducts = await prisma.product.findMany({
    where: whereClause,
    select: {
      id: true,
      title: true,
      category: true,
      sourceId: true,
      shopifyProductId: true,
      attributes: true,
    },
  });
  
  logger.info('Products fetched', { count: allProducts.length });
  
  // 4. Group by deduplication key
  const dedupGroups = new Map<string, typeof allProducts>();
  const dedupKeyToProducts = new Map<string, typeof allProducts>();
  
  for (const product of allProducts) {
    const dedupKey = extractDedupKey(product);
    
    if (!dedupGroups.has(dedupKey)) {
      dedupGroups.set(dedupKey, []);
    }
    dedupGroups.get(dedupKey)!.push(product);
    
    // Also track by base key (without prefix)
    const baseKey = dedupKey.replace(/^(shopify_|parent_|related_|source_|id_)/, '');
    if (!dedupKeyToProducts.has(baseKey)) {
      dedupKeyToProducts.set(baseKey, []);
    }
    dedupKeyToProducts.get(baseKey)!.push(product);
  }
  
  // 5. Calculate unique products (groups with more than 1 product are variants)
  const duplicateGroups: AnalysisResults['duplicateGroups'] = [];
  let totalVariants = 0;
  let uniqueProductCount = 0;
  
  for (const [dedupKey, products] of dedupGroups.entries()) {
    if (products.length > 1) {
      // This is a group of variants
      totalVariants += products.length;
      uniqueProductCount += 1;
      duplicateGroups.push({
        dedupKey,
        variantCount: products.length,
        productIds: products.map(p => p.id),
      });
    } else if (dedupKey.startsWith('id_')) {
      // Single product with no deduplication key (unique)
      uniqueProductCount += 1;
    } else {
      // Single product with deduplication key (might be unique or might be missing variants)
      uniqueProductCount += 1;
    }
  }
  
  // 6. Products without any deduplication key
  const productsWithoutDedupKey = Array.from(dedupGroups.entries())
    .filter(([key, products]) => key.startsWith('id_') && products.length === 1)
    .reduce((sum, [, products]) => sum + products.length, 0);
  
  // 7. Size distribution
  const sizeDistribution: Record<string, number> = {};
  for (const product of allProducts) {
    const size = extractSize(product);
    if (size) {
      sizeDistribution[size] = (sizeDistribution[size] || 0) + 1;
    }
  }
  
  // 8. Category distribution
  const categoryDistribution: Record<string, number> = {};
  for (const product of allProducts) {
    const category = product.category || 'Uncategorized';
    categoryDistribution[category] = (categoryDistribution[category] || 0) + 1;
  }
  
  // 9. Sample duplicates (top 10 groups with most variants)
  const topDuplicateGroups = duplicateGroups
    .sort((a, b) => b.variantCount - a.variantCount)
    .slice(0, 10);
  
  const sampleDuplicates: AnalysisResults['sampleDuplicates'] = [];
  for (const group of topDuplicateGroups) {
    const products = dedupGroups.get(group.dedupKey) || [];
    for (const product of products.slice(0, 3)) { // Sample first 3 variants
      const attributes = product.attributes as Record<string, any> || {};
      sampleDuplicates.push({
        id: product.id,
        title: product.title,
        dedupKey: group.dedupKey,
        size: extractSize(product),
        parentId: attributes.parent_id || null,
        relatedId: attributes.related_id || null,
      });
    }
  }
  
  const avgVariantsPerProduct = totalProducts > 0 ? totalProducts / uniqueProductCount : 0;
  
  const results: AnalysisResults = {
    totalProducts,
    uniqueProducts: uniqueProductCount,
    avgVariantsPerProduct,
    productsWithParentId,
    productsWithRelatedId,
    productsWithShopifyId,
    productsWithoutDedupKey,
    sizeDistribution,
    categoryDistribution,
    duplicateGroups: duplicateGroups.sort((a, b) => b.variantCount - a.variantCount),
    sampleDuplicates,
  };
  
  return results;
}

/**
 * Print analysis results in a readable format
 */
export function printAnalysisResults(results: AnalysisResults): void {
  console.log('\n' + '='.repeat(80));
  console.log('DATABASE ANALYSIS RESULTS');
  console.log('='.repeat(80) + '\n');
  
  console.log('📊 BASIC STATISTICS');
  console.log('─'.repeat(80));
  console.log(`Total Products:           ${results.totalProducts.toLocaleString()}`);
  console.log(`Unique Products:          ${results.uniqueProducts.toLocaleString()}`);
  console.log(`Avg Variants per Product: ${results.avgVariantsPerProduct.toFixed(2)}`);
  console.log(`Duplication Factor:      ${(results.totalProducts / results.uniqueProducts).toFixed(2)}x\n`);
  
  console.log('🔑 DEDUPLICATION KEY AVAILABILITY');
  console.log('─'.repeat(80));
  console.log(`Products with parent_id:  ${results.productsWithParentId.toLocaleString()} (${((results.productsWithParentId / results.totalProducts) * 100).toFixed(1)}%)`);
  console.log(`Products with related_id: ${results.productsWithRelatedId.toLocaleString()} (${((results.productsWithRelatedId / results.totalProducts) * 100).toFixed(1)}%)`);
  console.log(`Products with shopifyId:  ${results.productsWithShopifyId.toLocaleString()} (${((results.productsWithShopifyId / results.totalProducts) * 100).toFixed(1)}%)`);
  console.log(`Products without key:    ${results.productsWithoutDedupKey.toLocaleString()} (${((results.productsWithoutDedupKey / results.totalProducts) * 100).toFixed(1)}%)\n`);
  
  console.log('📦 DUPLICATE GROUPS');
  console.log('─'.repeat(80));
  console.log(`Total duplicate groups:   ${results.duplicateGroups.length.toLocaleString()}`);
  if (results.duplicateGroups.length > 0) {
    const maxVariants = Math.max(...results.duplicateGroups.map(g => g.variantCount));
    const minVariants = Math.min(...results.duplicateGroups.map(g => g.variantCount));
    const avgVariants = results.duplicateGroups.reduce((sum, g) => sum + g.variantCount, 0) / results.duplicateGroups.length;
    console.log(`Max variants in group:   ${maxVariants}`);
    console.log(`Min variants in group:   ${minVariants}`);
    console.log(`Avg variants in group:   ${avgVariants.toFixed(2)}\n`);
    
    console.log('Top 10 duplicate groups:');
    results.duplicateGroups.slice(0, 10).forEach((group, idx) => {
      console.log(`  ${idx + 1}. ${group.dedupKey}: ${group.variantCount} variants`);
    });
    console.log();
  }
  
  console.log('👕 SIZE DISTRIBUTION');
  console.log('─'.repeat(80));
  const sortedSizes = Object.entries(results.sizeDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);
  sortedSizes.forEach(([size, count]) => {
    const percentage = ((count / results.totalProducts) * 100).toFixed(1);
    console.log(`  ${size.padEnd(10)} ${count.toString().padStart(6)} (${percentage}%)`);
  });
  console.log();
  
  console.log('📁 CATEGORY DISTRIBUTION (Top 20)');
  console.log('─'.repeat(80));
  const sortedCategories = Object.entries(results.categoryDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);
  sortedCategories.forEach(([category, count]) => {
    const percentage = ((count / results.totalProducts) * 100).toFixed(1);
    console.log(`  ${category.padEnd(40)} ${count.toString().padStart(6)} (${percentage}%)`);
  });
  console.log();
  
  console.log('🔍 SAMPLE DUPLICATES');
  console.log('─'.repeat(80));
  results.sampleDuplicates.slice(0, 15).forEach((product, idx) => {
    console.log(`${idx + 1}. ${product.title.substring(0, 50)}`);
    console.log(`   ID: ${product.id}`);
    console.log(`   Dedup Key: ${product.dedupKey}`);
    console.log(`   Size: ${product.size || 'N/A'}`);
    console.log(`   Parent ID: ${product.parentId || 'N/A'}`);
    console.log(`   Related ID: ${product.relatedId || 'N/A'}`);
    console.log();
  });
  
  console.log('='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80) + '\n');
}

/**
 * Export results to JSON file
 */
export async function exportAnalysisResults(
  results: AnalysisResults,
  outputPath: string = 'database-analysis-results.json'
): Promise<void> {
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Analysis results exported to: ${outputPath}\n`);
}

/**
 * Test database connection
 */
async function testConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Check database connection first
    console.log('Checking database connection...');
    const isConnected = await testConnection();
    
    if (!isConnected) {
      console.error('\n❌ Database connection failed!\n');
      console.error('Please check:');
      console.error('  1. DATABASE_URL environment variable is set correctly');
      console.error('  2. Database server is running and accessible');
      console.error('  3. Network/firewall allows connections to the database');
      console.error('  4. Database credentials are correct\n');
      console.error('To set DATABASE_URL:');
      console.error('  export DATABASE_URL="postgresql://user:password@host:port/database"');
      console.error('  Or add it to your .env file\n');
      
      // Check if DATABASE_URL is set
      if (!process.env.DATABASE_URL) {
        console.error('⚠️  DATABASE_URL environment variable is not set!\n');
      } else {
        // Mask password in connection string for display
        const maskedUrl = process.env.DATABASE_URL.replace(
          /:\/\/[^:]+:[^@]+@/,
          '://***:***@'
        );
        console.error(`Current DATABASE_URL: ${maskedUrl}\n`);
      }
      
      process.exit(1);
    }
    
    console.log('✅ Database connection successful\n');
    
    const merchantId = process.env.MERCHANT_ID;
    
    console.log('Starting database analysis...\n');
    console.log(`Merchant ID: ${merchantId || 'ALL MERCHANTS'}\n`);
    
    const results = await analyzeDatabase(merchantId);
    printAnalysisResults(results);
    
    // Export to JSON
    await exportAnalysisResults(results, 'database-analysis-results.json');
    
    // Summary for migration planning
    console.log('📋 MIGRATION PLANNING SUMMARY');
    console.log('─'.repeat(80));
    console.log(`Estimated unique products to migrate: ${results.uniqueProducts.toLocaleString()}`);
    console.log(`Estimated variants to create: ${results.totalProducts.toLocaleString()}`);
    console.log(`Products that need manual review: ${results.productsWithoutDedupKey.toLocaleString()}`);
    console.log(`Storage reduction estimate: ~${((1 - 1 / results.avgVariantsPerProduct) * 100).toFixed(1)}%`);
    console.log();
    
    // Close database connection
    await prisma.$disconnect();
    
    process.exit(0);
  } catch (error) {
    logger.error('Database analysis failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Check if it's a connection error
    if (error instanceof Error && error.message.includes("Can't reach database server")) {
      console.error('\n❌ Database connection error!\n');
      console.error('The database server is not reachable. Please check:');
      console.error('  1. Database server is running');
      console.error('  2. Network connectivity');
      console.error('  3. Firewall rules allow connections');
      console.error('  4. DATABASE_URL is correct\n');
    } else {
      console.error('\n❌ Analysis failed:', error);
    }
    
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

