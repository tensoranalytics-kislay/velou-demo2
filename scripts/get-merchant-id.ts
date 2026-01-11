import { prisma } from '../src/lib/db';

async function main() {
  const merchants = await prisma.merchant.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      brandName: true,
    },
  });

  console.log('Merchants in database:');
  console.log(JSON.stringify(merchants, null, 2));

  if (merchants.length === 0) {
    console.log('\n⚠️  No merchants found. You may need to create one first.');
  } else {
    console.log(`\n✅ Found ${merchants.length} merchant(s)`);
    console.log('\nUse the ID from above for ingestion.');
  }

  await prisma.$disconnect();
}

main().catch(console.error);




