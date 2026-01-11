/**
 * Verify Phase 2 Migration
 * 
 * Checks that the migration was applied successfully:
 * - ProductVariant table exists
 * - New columns added to Product
 * - Indexes created
 * - Foreign key works
 */

import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/telemetry/logger';

async function verifyMigration() {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE 2 MIGRATION VERIFICATION');
  console.log('='.repeat(80) + '\n');

  const checks: Array<{ name: string; passed: boolean; message: string }> = [];

  try {
    // 1. Check ProductVariant table exists
    console.log('1. Checking ProductVariant table...');
    try {
      const variantCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM "ProductVariant"
      `;
      checks.push({
        name: 'ProductVariant table exists',
        passed: true,
        message: `✅ ProductVariant table exists (${variantCount[0].count} rows)`,
      });
      console.log(`   ✅ ProductVariant table exists (${variantCount[0].count} rows)`);
    } catch (error) {
      checks.push({
        name: 'ProductVariant table exists',
        passed: false,
        message: `❌ ProductVariant table does not exist: ${error instanceof Error ? error.message : String(error)}`,
      });
      console.log(`   ❌ ProductVariant table does not exist`);
    }

    // 2. Check new columns on Product
    console.log('\n2. Checking new columns on Product table...');
    const newColumns = ['color', 'fabric', 'material', 'occasion', 'season', 'fit'];
    for (const column of newColumns) {
      try {
        const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'Product' AND column_name = ${column}
        `;
        const exists = result.length > 0;
        checks.push({
          name: `Product.${column} column`,
          passed: exists,
          message: exists ? `✅ Product.${column} column exists` : `❌ Product.${column} column missing`,
        });
        console.log(`   ${exists ? '✅' : '❌'} Product.${column} column ${exists ? 'exists' : 'missing'}`);
      } catch (error) {
        checks.push({
          name: `Product.${column} column`,
          passed: false,
          message: `❌ Error checking Product.${column}: ${error instanceof Error ? error.message : String(error)}`,
        });
        console.log(`   ❌ Error checking Product.${column}`);
      }
    }

    // 3. Check indexes on ProductVariant
    console.log('\n3. Checking indexes on ProductVariant...');
    const variantIndexes = [
      'idx_variant_product_id',
      'idx_variant_size',
      'idx_variant_color',
      'idx_variant_stock_status',
      'unique_product_variant',
    ];
    for (const indexName of variantIndexes) {
      try {
        const result = await prisma.$queryRaw<Array<{ indexname: string }>>`
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename = 'ProductVariant' AND indexname = ${indexName}
        `;
        const exists = result.length > 0;
        checks.push({
          name: `ProductVariant index: ${indexName}`,
          passed: exists,
          message: exists ? `✅ Index ${indexName} exists` : `❌ Index ${indexName} missing`,
        });
        console.log(`   ${exists ? '✅' : '❌'} Index ${indexName} ${exists ? 'exists' : 'missing'}`);
      } catch (error) {
        checks.push({
          name: `ProductVariant index: ${indexName}`,
          passed: false,
          message: `❌ Error checking index ${indexName}`,
        });
        console.log(`   ❌ Error checking index ${indexName}`);
      }
    }

    // 4. Check indexes on Product
    console.log('\n4. Checking new indexes on Product...');
    const productIndexes = [
      'idx_product_color',
      'idx_product_fabric',
      'idx_product_material',
      'idx_product_occasion',
      'idx_product_season',
      'idx_product_fit',
      'idx_product_source_id',
    ];
    for (const indexName of productIndexes) {
      try {
        const result = await prisma.$queryRaw<Array<{ indexname: string }>>`
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename = 'Product' AND indexname = ${indexName}
        `;
        const exists = result.length > 0;
        checks.push({
          name: `Product index: ${indexName}`,
          passed: exists,
          message: exists ? `✅ Index ${indexName} exists` : `❌ Index ${indexName} missing`,
        });
        console.log(`   ${exists ? '✅' : '❌'} Index ${indexName} ${exists ? 'exists' : 'missing'}`);
      } catch (error) {
        checks.push({
          name: `Product index: ${indexName}`,
          passed: false,
          message: `❌ Error checking index ${indexName}`,
        });
        console.log(`   ❌ Error checking index ${indexName}`);
      }
    }

    // 5. Check foreign key constraint
    console.log('\n5. Checking foreign key constraint...');
    try {
      const result = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'ProductVariant' 
          AND constraint_type = 'FOREIGN KEY'
          AND constraint_name = 'ProductVariant_productId_fkey'
      `;
      const exists = result.length > 0;
      checks.push({
        name: 'Foreign key constraint',
        passed: exists,
        message: exists ? '✅ Foreign key constraint exists' : '❌ Foreign key constraint missing',
      });
      console.log(`   ${exists ? '✅' : '❌'} Foreign key constraint ${exists ? 'exists' : 'missing'}`);
    } catch (error) {
      checks.push({
        name: 'Foreign key constraint',
        passed: false,
        message: `❌ Error checking foreign key: ${error instanceof Error ? error.message : String(error)}`,
      });
      console.log(`   ❌ Error checking foreign key`);
    }

    // 6. Test Prisma client
    console.log('\n6. Testing Prisma client...');
    try {
      // Test that we can query ProductVariant
      await prisma.productVariant.findFirst();
      checks.push({
        name: 'Prisma client ProductVariant',
        passed: true,
        message: '✅ Prisma client can query ProductVariant',
      });
      console.log('   ✅ Prisma client can query ProductVariant');

      // Test that Product has variants relation
      const product = await prisma.product.findFirst({
        include: { variants: true },
      });
      checks.push({
        name: 'Product.variants relation',
        passed: true,
        message: '✅ Product.variants relation works',
      });
      console.log('   ✅ Product.variants relation works');
    } catch (error) {
      checks.push({
        name: 'Prisma client',
        passed: false,
        message: `❌ Prisma client error: ${error instanceof Error ? error.message : String(error)}`,
      });
      console.log(`   ❌ Prisma client error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('VERIFICATION SUMMARY');
    console.log('='.repeat(80) + '\n');

    const passed = checks.filter(c => c.passed).length;
    const total = checks.length;
    const allPassed = passed === total;

    checks.forEach(check => {
      console.log(check.message);
    });

    console.log(`\n${passed}/${total} checks passed`);

    if (allPassed) {
      console.log('\n✅ All checks passed! Phase 2 migration is successful.\n');
      console.log('Next steps:');
      console.log('  1. Proceed to Phase 3: Data Migration');
      console.log('  2. Create data migration script');
      console.log('  3. Populate ProductVariant table\n');
    } else {
      console.log('\n⚠️  Some checks failed. Please review the errors above.\n');
    }

    await prisma.$disconnect();
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    logger.error('Verification failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error('\n❌ Verification failed:', error);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  verifyMigration();
}










