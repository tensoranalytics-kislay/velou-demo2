/**
 * Backfill gender attribute for existing products.
 *
 * Logic:
 * - Apparel categories → gender = "womens"
 * - Non-apparel or ambiguous categories → gender = "unisex"
 * - Kids / baby items remain "unisex" (we already have ageGroup)
 *
 * Usage:
 *   npx tsx scripts/backfill-gender.ts
 */

import { prisma } from '../src/lib/db';
import { inferGenderFromCategoryAndTitle } from '../src/lib/catalog/mapEnrichedToProduct';

const MERCHANT_ID = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || '200');

async function main() {
  console.log('🚀 Starting gender backfill');
  console.log(`   Merchant ID: ${MERCHANT_ID}`);
  console.log(`   Batch size:  ${BATCH_SIZE}`);

  let offset = 0;
  let updatedTotal = 0;

  // Process in batches to avoid loading the full catalog into memory.
  while (true) {
    const products = await prisma.product.findMany({
      where: {
        merchantId: MERCHANT_ID,
        isActive: true,
      },
      select: {
        id: true,
        category: true,
        subcategory: true,
        title: true,
        ageGroup: true,
        attributes: true,
      },
      take: BATCH_SIZE,
      skip: offset,
    });

    if (products.length === 0) {
      break;
    }

    let batchUpdated = 0;

    for (const product of products) {
      const attrs = (product.attributes ?? {}) as Record<string, unknown>;

      // Skip if gender is already set.
      if (typeof attrs.gender === 'string' && attrs.gender.trim().length > 0) {
        continue;
      }

      const inferred = inferGenderFromCategoryAndTitle({
        category: product.category,
        subcategory: product.subcategory ?? null,
        title: product.title,
        ageGroup: product.ageGroup ?? null,
      });

      // Only write if we actually inferred something.
      if (!inferred) continue;

      attrs.gender = inferred;

      await prisma.product.update({
        where: { id: product.id },
        data: { attributes: attrs },
      });

      batchUpdated += 1;
    }

    updatedTotal += batchUpdated;
    offset += products.length;

    console.log(
      `   Processed ${offset} products (updated ${batchUpdated} in this batch, total updated: ${updatedTotal})`,
    );

    if (products.length < BATCH_SIZE) {
      break;
    }
  }

  console.log('\n✅ Gender backfill complete');
  console.log(`   Total products updated: ${updatedTotal}`);
}

main()
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

