/**
 * Migration Preparation Script - Phase 1
 * 
 * Prepares the database for migration by:
 * - Validating data integrity
 * - Creating backup recommendations
 * - Generating migration plan
 */

import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/telemetry/logger';
import { analyzeDatabase, type AnalysisResults } from './analyze-database';

interface MigrationPlan {
  estimatedUniqueProducts: number;
  estimatedVariants: number;
  productsNeedingManualReview: number;
  storageReductionEstimate: number;
  migrationBatches: Array<{
    batchNumber: number;
    dedupKey: string;
    productIds: string[];
    variantCount: number;
  }>;
  risks: string[];
  recommendations: string[];
}

/**
 * Generate migration plan based on analysis results
 */
export async function generateMigrationPlan(
  results: AnalysisResults,
  batchSize: number = 1000
): Promise<MigrationPlan> {
  logger.info('Generating migration plan', { batchSize });
  
  // Group duplicate groups into batches
  const migrationBatches: MigrationPlan['migrationBatches'] = [];
  let currentBatch: string[] = [];
  let currentBatchNumber = 1;
  let currentBatchSize = 0;
  
  for (const group of results.duplicateGroups) {
    if (currentBatchSize + group.variantCount > batchSize && currentBatch.length > 0) {
      // Start new batch
      migrationBatches.push({
        batchNumber: currentBatchNumber++,
        dedupKey: `batch_${currentBatchNumber}`,
        productIds: currentBatch,
        variantCount: currentBatchSize,
      });
      currentBatch = [];
      currentBatchSize = 0;
    }
    
    currentBatch.push(...group.productIds);
    currentBatchSize += group.variantCount;
  }
  
  // Add remaining products
  if (currentBatch.length > 0) {
    migrationBatches.push({
      batchNumber: currentBatchNumber,
      dedupKey: `batch_${currentBatchNumber}`,
      productIds: currentBatch,
      variantCount: currentBatchSize,
    });
  }
  
  // Identify risks
  const risks: string[] = [];
  
  if (results.productsWithoutDedupKey > 0) {
    risks.push(
      `${results.productsWithoutDedupKey} products lack deduplication keys and may not be properly grouped`
    );
  }
  
  if (results.avgVariantsPerProduct > 10) {
    risks.push(
      `High variant count (${results.avgVariantsPerProduct.toFixed(1)} per product) may indicate data quality issues`
    );
  }
  
  if (results.duplicateGroups.length === 0) {
    risks.push('No duplicate groups found - verify deduplication logic is correct');
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  recommendations.push('Run full database backup before migration');
  recommendations.push('Test migration on staging environment first');
  recommendations.push(`Process in ${batchSize} product batches to avoid timeouts`);
  recommendations.push('Keep old Product rows during migration (add isMigrated flag)');
  recommendations.push('Verify data integrity after each batch');
  
  if (results.productsWithoutDedupKey > 0) {
    recommendations.push(
      `Review ${results.productsWithoutDedupKey} products without deduplication keys manually`
    );
  }
  
  const storageReduction = ((1 - 1 / results.avgVariantsPerProduct) * 100);
  recommendations.push(
    `Expected storage reduction: ~${storageReduction.toFixed(1)}%`
  );
  
  return {
    estimatedUniqueProducts: results.uniqueProducts,
    estimatedVariants: results.totalProducts,
    productsNeedingManualReview: results.productsWithoutDedupKey,
    storageReductionEstimate: storageReduction,
    migrationBatches,
    risks,
    recommendations,
  };
}

/**
 * Validate data integrity before migration
 */
export async function validateDataIntegrity(merchantId?: string): Promise<{
  isValid: boolean;
  issues: Array<{ severity: 'error' | 'warning'; message: string }>;
}> {
  const issues: Array<{ severity: 'error' | 'warning'; message: string }> = [];
  
  const whereClause = merchantId ? { merchantId, isActive: true } : { isActive: true };
  
  // Check for products with missing required fields
  const missingTitles = await prisma.product.count({
    where: {
      ...whereClause,
      title: { in: ['', null] },
    },
  });
  
  if (missingTitles > 0) {
    issues.push({
      severity: 'error',
      message: `${missingTitles} products have missing or empty titles`,
    });
  }
  
  // Check for products with invalid categories
  const missingCategories = await prisma.product.count({
    where: {
      ...whereClause,
      category: { in: ['', null] },
    },
  });
  
  if (missingCategories > 0) {
    issues.push({
      severity: 'warning',
      message: `${missingCategories} products have missing categories`,
    });
  }
  
  // Check for products with invalid price
  const invalidPrices = await prisma.product.count({
    where: {
      ...whereClause,
      priceCents: { lte: 0 },
    },
  });
  
  if (invalidPrices > 0) {
    issues.push({
      severity: 'warning',
      message: `${invalidPrices} products have invalid prices (<= 0)`,
    });
  }
  
  // Check for orphaned products (no merchant)
  const orphanedProducts = await prisma.product.count({
    where: {
      ...whereClause,
      merchant: null,
    },
  });
  
  if (orphanedProducts > 0) {
    issues.push({
      severity: 'error',
      message: `${orphanedProducts} products are missing merchant relationship`,
    });
  }
  
  const isValid = issues.filter(i => i.severity === 'error').length === 0;
  
  return { isValid, issues };
}

/**
 * Print migration plan
 */
export function printMigrationPlan(plan: MigrationPlan): void {
  console.log('\n' + '='.repeat(80));
  console.log('MIGRATION PLAN');
  console.log('='.repeat(80) + '\n');
  
  console.log('📊 ESTIMATES');
  console.log('─'.repeat(80));
  console.log(`Unique Products:          ${plan.estimatedUniqueProducts.toLocaleString()}`);
  console.log(`Total Variants:          ${plan.estimatedVariants.toLocaleString()}`);
  console.log(`Manual Review Needed:     ${plan.productsNeedingManualReview.toLocaleString()}`);
  console.log(`Storage Reduction:        ~${plan.storageReductionEstimate.toFixed(1)}%`);
  console.log(`Migration Batches:        ${plan.migrationBatches.length}\n`);
  
  console.log('⚠️  RISKS');
  console.log('─'.repeat(80));
  if (plan.risks.length === 0) {
    console.log('  No major risks identified\n');
  } else {
    plan.risks.forEach((risk, idx) => {
      console.log(`  ${idx + 1}. ${risk}`);
    });
    console.log();
  }
  
  console.log('✅ RECOMMENDATIONS');
  console.log('─'.repeat(80));
  plan.recommendations.forEach((rec, idx) => {
    console.log(`  ${idx + 1}. ${rec}`);
  });
  console.log();
  
  console.log('📦 MIGRATION BATCHES');
  console.log('─'.repeat(80));
  console.log(`Total batches: ${plan.migrationBatches.length}`);
  if (plan.migrationBatches.length > 0) {
    const avgBatchSize = plan.migrationBatches.reduce((sum, b) => sum + b.variantCount, 0) / plan.migrationBatches.length;
    console.log(`Avg batch size: ${avgBatchSize.toFixed(0)} variants`);
    console.log(`\nFirst 10 batches:`);
    plan.migrationBatches.slice(0, 10).forEach(batch => {
      console.log(`  Batch ${batch.batchNumber}: ${batch.variantCount} variants, ${batch.productIds.length} products`);
    });
  }
  console.log();
  
  console.log('='.repeat(80) + '\n');
}

/**
 * Export migration plan to JSON
 */
export async function exportMigrationPlan(
  plan: MigrationPlan,
  outputPath: string = 'migration-plan.json'
): Promise<void> {
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, JSON.stringify(plan, null, 2));
  console.log(`\n✅ Migration plan exported to: ${outputPath}\n`);
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
    const batchSize = parseInt(process.env.BATCH_SIZE || '1000', 10);
    
    console.log('Preparing migration plan...\n');
    console.log(`Merchant ID: ${merchantId || 'ALL MERCHANTS'}`);
    console.log(`Batch Size: ${batchSize}\n`);
    
    // Validate data integrity
    console.log('Validating data integrity...');
    const validation = await validateDataIntegrity(merchantId);
    
    if (!validation.isValid) {
      console.log('\n❌ Data integrity validation failed:\n');
      validation.issues.forEach(issue => {
        const icon = issue.severity === 'error' ? '❌' : '⚠️';
        console.log(`${icon} ${issue.message}`);
      });
      console.log('\nPlease fix these issues before proceeding with migration.\n');
      process.exit(1);
    }
    
    if (validation.issues.length > 0) {
      console.log('\n⚠️  Warnings found:\n');
      validation.issues.forEach(issue => {
        console.log(`  ⚠️  ${issue.message}`);
      });
      console.log();
    } else {
      console.log('✅ Data integrity validation passed\n');
    }
    
    // Analyze database
    console.log('Analyzing database...');
    const analysis = await analyzeDatabase(merchantId);
    
    // Generate migration plan
    console.log('Generating migration plan...');
    const plan = await generateMigrationPlan(analysis, batchSize);
    
    // Print plan
    printMigrationPlan(plan);
    
    // Export plan
    await exportMigrationPlan(plan, 'migration-plan.json');
    
    console.log('✅ Migration preparation complete!\n');
    console.log('Next steps:');
    console.log('  1. Review migration-plan.json');
    console.log('  2. Run database backup');
    console.log('  3. Test migration on staging');
    console.log('  4. Proceed to Phase 2: Schema Migration\n');
    
    // Close database connection
    await prisma.$disconnect();
    
    process.exit(0);
  } catch (error) {
    logger.error('Migration preparation failed', {
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
      console.error('\n❌ Preparation failed:', error);
    }
    
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

