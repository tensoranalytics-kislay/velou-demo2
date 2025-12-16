#!/usr/bin/env tsx
/**
 * Diagnostic script to check embedding backfill statistics
 */

import { prisma } from '../src/lib/db';

async function checkStats() {
  try {
    // Total products
    const total = await prisma.product.count();
    console.log('\n📊 Product Statistics\n');
    console.log(`Total products: ${total}`);

    // Active vs inactive
    const activeCount = await prisma.product.count({
      where: { isActive: true },
    });
    const inactiveCount = await prisma.product.count({
      where: { isActive: false },
    });
    console.log(`\nActive: ${activeCount}`);
    console.log(`Inactive: ${inactiveCount}`);

    // Embedding status (use raw SQL since Prisma doesn't handle vector NULL checks well)
    const embeddingStats = await prisma.$queryRawUnsafe<Array<{
      embedding_status: string;
      count: bigint;
    }>>(`
      SELECT 
        CASE 
          WHEN embedding IS NULL THEN 'NULL'
          WHEN embedding IS NOT NULL THEN 'HAS_EMBEDDING'
        END as embedding_status,
        COUNT(*) as count
      FROM "Product"
      GROUP BY embedding_status
    `);

    console.log('\n📈 Embedding Status:');
    for (const stat of embeddingStats) {
      console.log(`  ${stat.embedding_status}: ${stat.count}`);
    }

    // Active products with NULL embeddings (what backfill should process)
    const shouldBackfill = await prisma.$queryRawUnsafe<Array<{
      should_backfill: bigint;
    }>>(`
      SELECT COUNT(*) as should_backfill
      FROM "Product"
      WHERE "isActive" = true AND embedding IS NULL
    `);

    console.log(`\n✅ Should backfill (active + NULL embedding): ${shouldBackfill[0]?.should_backfill || 0}`);

    // Active products with embeddings
    const alreadyHasEmbedding = await prisma.$queryRawUnsafe<Array<{
      already_has_embedding: bigint;
    }>>(`
      SELECT COUNT(*) as already_has_embedding
      FROM "Product"
      WHERE "isActive" = true AND embedding IS NOT NULL
    `);

    console.log(`✅ Already has embedding (active): ${alreadyHasEmbedding[0]?.already_has_embedding || 0}`);

    // Inactive products breakdown
    const inactiveWithEmbedding = await prisma.$queryRawUnsafe<Array<{
      inactive_with_embedding: bigint;
    }>>(`
      SELECT COUNT(*) as inactive_with_embedding
      FROM "Product"
      WHERE "isActive" = false AND embedding IS NOT NULL
    `);

    const inactiveWithoutEmbedding = await prisma.$queryRawUnsafe<Array<{
      inactive_without_embedding: bigint;
    }>>(`
      SELECT COUNT(*) as inactive_without_embedding
      FROM "Product"
      WHERE "isActive" = false AND embedding IS NULL
    `);

    console.log(`\n⚠️  Inactive products (not processed by backfill):`);
    console.log(`  With embedding: ${inactiveWithEmbedding[0]?.inactive_with_embedding || 0}`);
    console.log(`  Without embedding: ${inactiveWithoutEmbedding[0]?.inactive_without_embedding || 0}`);

    console.log('\n💡 Tip: The backfill only processes active products by default.');
    console.log('   If you want to backfill inactive products too, you can modify the query.\n');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkStats();






