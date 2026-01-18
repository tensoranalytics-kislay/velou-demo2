import { prisma } from '../src/lib/db';

async function main() {
  console.log('🔍 Checking Size Storage in Database\n');
  console.log('─'.repeat(70) + '\n');

  await prisma.$connect();

  // Sample products to check size columns
  const sample = await prisma.product.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
      title: true,
      category: true,
      attributes: true,
    },
    take: 10,
  });

  console.log('📦 Sample Products with Attributes:\n');
  sample.forEach(p => {
    const attrs = p.attributes as any;
    console.log(`   ${p.category}: ${p.title.substring(0, 50)}`);
    console.log(`      Attributes.size: ${attrs?.size || 'null'}`);
    console.log(`      Attributes.Size: ${attrs?.Size || 'null'}`);
    console.log(`      Attributes.sizes: ${attrs?.sizes || 'null'}`);
    console.log(`      Attributes.Sizes: ${attrs?.Sizes || 'null'}`);
    console.log();
  });

  // Check how many products have size in attributes
  const productsWithSize = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT COUNT(*) as count
    FROM "Product"
    WHERE "isActive" = true
      AND (
        attributes->>'size' IS NOT NULL
        OR attributes->>'Size' IS NOT NULL
        OR attributes->>'sizes' IS NOT NULL
        OR attributes->>'Sizes' IS NOT NULL
      )
  `);

  console.log(`📊 Products with size in attributes: ${productsWithSize[0].count}\n`);

  // Check distinct size values
  const distinctSizes = await prisma.$queryRawUnsafe<Array<{ size: string }>>(`
    SELECT DISTINCT attributes->>'size' as size
    FROM "Product"
    WHERE "isActive" = true
      AND attributes->>'size' IS NOT NULL
    LIMIT 20
  `);

  console.log('📋 Sample Size Values:\n');
  distinctSizes.forEach(({ size }) => {
    console.log(`   - ${size}`);
  });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
