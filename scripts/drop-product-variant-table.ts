import { prisma } from '../src/lib/db';

async function main() {
  console.log('🗑️  Dropping ProductVariant table and related constraints...\n');

  try {
    // Drop foreign key constraint
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProductVariant" DROP CONSTRAINT IF EXISTS "ProductVariant_productId_fkey";
    `);

    // Drop all indexes
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_product_id";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_size";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_color";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_stock_status";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_shopify_id";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_source_id";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_product_size";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "idx_variant_size_stock";`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "unique_product_variant";`);

    // Drop the table
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ProductVariant";`);

    console.log('✅ Successfully dropped ProductVariant table and all related objects\n');
  } catch (error) {
    console.error('❌ Error dropping ProductVariant table:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});




