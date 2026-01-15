/**
 * Quick check for the Product.gender column.
 *
 * Prints distinct gender values and counts from the Product table,
 * so we can verify the column exists and is populated correctly.
 *
 * Usage:
 *   npx tsx scripts/check-gender-column.ts
 */

import { prisma } from '../src/lib/db';

const MERCHANT_ID = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';

async function main() {
  console.log('🔎 Checking Product.gender column');
  console.log(`   Merchant ID: ${MERCHANT_ID}`);

  const rows = await prisma.product.groupBy({
    by: ['gender'],
    where: {
      merchantId: MERCHANT_ID,
      isActive: true,
    },
    _count: true,
  });

  if (!rows.length) {
    console.log('   No products found for this merchant.');
  } else {
    console.log('\n📊 Gender distribution (Product.gender):');
    for (const row of rows) {
      const g = row.gender ?? '<null>';
      console.log(`   gender=${g.padEnd(8)} count=${String(row._count).padStart(4)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Failed to check Product.gender:', err);
  process.exit(1);
});

