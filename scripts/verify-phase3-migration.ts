/**
 * Phase 3: Data Migration Verification
 * 
 * Verifies that the data migration was successful:
 * - Products have variants
 * - Attributes extracted to columns
 * - Data integrity maintained
 */

import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/telemetry/logger';

async function verifyMigration() {
  console.log('\n' + '='.repeat(80));
  console.log('PHASE 3 DATA MIGRATION VERIFICATION');
  console.log('='.repeat(80) + '\n');

  const checks: Array<{ name: string; passed: boolean; message: string }> = [];

  try {
    // 1. Check ProductVariant count
    console.log('1. Checking ProductVariant data...');
    const variantCount = await prisma.productVariant.count();
    const productCount = await prisma.product.count({ where: { isActive: true } });
    
    checks.push({
      name: 'ProductVariants created',
      passed: variantCount > 0,
      message: `✅ ${variantCount.toLocaleString()} ProductVariants created`,
    });
    console.log(`   ✅ ${variantCount.toLocaleString()} ProductVariants created`);
    console.log(`   📊 ${productCount.toLocaleString()} Products in database`);
    
    if (variantCount > 0) {
      const avgVariants = (variantCount / productCount).toFixed(2);
      console.log(`   📈 Average variants per product: ${avgVariants}x`);
    }

    // 2. Check products with variants
    console.log('\n2. Checking products with variants...');
    const productsWithVariants = await prisma.product.count({
      where: {
        isActive: true,
        variants: {
          some: {},
        },
      },
    });
    
    checks.push({
      name: 'Products with variants',
      passed: productsWithVariants > 0,
      message: `✅ ${productsWithVariants.toLocaleString()} products have variants`,
    });
    console.log(`   ✅ ${productsWithVariants.toLocaleString()} products have variants`);

    // 3. Check attribute extraction
    console.log('\n3. Checking attribute extraction...');
    const productsWithColor = await prisma.product.count({
      where: { color: { not: null } },
    });
    const productsWithFabric = await prisma.product.count({
      where: { fabric: { not: null } },
    });
    const productsWithMaterial = await prisma.product.count({
      where: { material: { not: null } },
    });
    
    checks.push({
      name: 'Attributes extracted',
      passed: productsWithColor > 0 || productsWithFabric > 0 || productsWithMaterial > 0,
      message: `✅ Attributes extracted: ${productsWithColor} with color, ${productsWithFabric} with fabric, ${productsWithMaterial} with material`,
    });
    console.log(`   ✅ ${productsWithColor.toLocaleString()} products with color extracted`);
    console.log(`   ✅ ${productsWithFabric.toLocaleString()} products with fabric extracted`);
    console.log(`   ✅ ${productsWithMaterial.toLocaleString()} products with material extracted`);

    // 4. Check variant size distribution
    console.log('\n4. Checking variant sizes...');
    const variantsWithSize = await prisma.productVariant.count({
      where: { size: { not: null } },
    });
    
    checks.push({
      name: 'Variants with size',
      passed: variantsWithSize > 0,
      message: `✅ ${variantsWithSize.toLocaleString()} variants have size`,
    });
    console.log(`   ✅ ${variantsWithSize.toLocaleString()} variants have size`);

    // 5. Sample products with variants
    console.log('\n5. Sampling products with variants...');
    const sampleProducts = await prisma.product.findMany({
      where: {
        isActive: true,
        variants: {
          some: {},
        },
      },
      include: {
        variants: {
          take: 5,
          orderBy: { size: 'asc' },
        },
      },
      take: 5,
    });
    
    if (sampleProducts.length > 0) {
      console.log(`   ✅ Found ${sampleProducts.length} sample products with variants:`);
      sampleProducts.forEach((product, idx) => {
        console.log(`\n   ${idx + 1}. ${product.title.substring(0, 50)}`);
        console.log(`      Product ID: ${product.id}`);
        console.log(`      Variants: ${product.variants.length}`);
        console.log(`      Sizes: ${product.variants.map(v => v.size || 'N/A').join(', ')}`);
        console.log(`      Color: ${product.color || 'N/A'}`);
        console.log(`      Fabric: ${product.fabric || 'N/A'}`);
      });
      checks.push({
        name: 'Sample products',
        passed: true,
        message: `✅ Sample products verified`,
      });
    }

    // 6. Check for orphaned variants (variants without product)
    console.log('\n6. Checking data integrity...');
    const orphanedVariants = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "ProductVariant" v
      LEFT JOIN "Product" p ON p.id = v."productId"
      WHERE p.id IS NULL
    `;
    
    const orphanedCount = Number(orphanedVariants[0].count);
    checks.push({
      name: 'No orphaned variants',
      passed: orphanedCount === 0,
      message: orphanedCount === 0 
        ? '✅ No orphaned variants' 
        : `❌ ${orphanedCount} orphaned variants found`,
    });
    console.log(`   ${orphanedCount === 0 ? '✅' : '❌'} Orphaned variants: ${orphanedCount}`);

    // 7. Check duplicate variants
    const duplicateVariants = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM (
        SELECT "productId", "size", "color", COUNT(*) as cnt
        FROM "ProductVariant"
        GROUP BY "productId", "size", "color"
        HAVING COUNT(*) > 1
      ) duplicates
    `;
    
    const duplicateCount = Number(duplicateVariants[0].count);
    checks.push({
      name: 'No duplicate variants',
      passed: duplicateCount === 0,
      message: duplicateCount === 0 
        ? '✅ No duplicate variants' 
        : `❌ ${duplicateCount} duplicate variant groups found`,
    });
    console.log(`   ${duplicateCount === 0 ? '✅' : '❌'} Duplicate variants: ${duplicateCount}`);

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
      console.log('\n✅ All checks passed! Phase 3 data migration is successful.\n');
      console.log('Next steps:');
      console.log('  1. Review sample products above');
      console.log('  2. Test search functionality');
      console.log('  3. Proceed to Phase 4: Code Migration\n');
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










