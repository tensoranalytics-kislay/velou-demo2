/**
 * Fix gender assignments in the Product table.
 *
 * Rules:
 * - All apparel categories (as defined by isApparelCategory) → gender = "womens"
 * - All non-apparel categories → gender = "unisex"
 *
 * This script normalizes existing data so that:
 * - Baby / kids / tween apparel are also marked womens.
 * - Any accidental "womens" on non-apparel (e.g. Tabletop) is flipped back to "unisex".
 *
 * Usage:
 *   npx tsx scripts/fix-gender-assignments.ts
 *
 * It uses DATABASE_URL from .env via Prisma.
 */

import { prisma } from '../src/lib/db';
import { inferGenderFromCategoryAndTitle } from '../src/lib/catalog/mapEnrichedToProduct';

const MERCHANT_ID = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || '200');

async function main() {
  console.log('🛠  Starting gender normalization');
  console.log(`   Merchant ID:  ${MERCHANT_ID}`);
  console.log(`   Batch size:   ${BATCH_SIZE}`);

  let offset = 0;
  let updatedTotal = 0;

  while (true) {
    const products = await prisma.product.findMany({
      where: {
        merchantId: MERCHANT_ID,
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        category: true,
        subcategory: true,
        ageGroup: true,
        attributes: true,
      },
      take: BATCH_SIZE,
      skip: offset,
    });

    if (products.length === 0) break;

    let batchUpdated = 0;

    for (const p of products) {
      const attrs = (p.attributes ?? {}) as Record<string, unknown>;
      const current =
        typeof attrs.gender === 'string' && attrs.gender.trim().length > 0
          ? attrs.gender.trim().toLowerCase()
          : null;

      const inferred = inferGenderFromCategoryAndTitle({
        category: p.category,
        subcategory: p.subcategory ?? null,
        title: p.title,
        ageGroup: p.ageGroup ?? null,
      });

      // Only update when different or missing.
      if (current === inferred) continue;

      attrs.gender = inferred;

      await prisma.product.update({
        where: { id: p.id },
        data: { attributes: attrs },
      });

      batchUpdated += 1;
    }

    updatedTotal += batchUpdated;
    offset += products.length;

    console.log(
      `   Processed ${offset} products (updated ${batchUpdated} in this batch, total updated: ${updatedTotal})`,
    );

    if (products.length < BATCH_SIZE) break;
  }

  console.log('\n✅ Gender normalization complete');
  console.log(`   Total products updated: ${updatedTotal}`);
}

main()
  .catch((err) => {
    console.error('❌ Gender normalization failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

