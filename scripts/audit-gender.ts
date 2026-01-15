/**
 * Audit gender assignments in the Product table.
 *
 * This script:
 * - Summarizes gender counts by category.
 * - Lists a sample of apparel products that are NOT marked as "womens".
 * - Lists a sample of clearly non-apparel products that are NOT "unisex".
 *
 * Usage:
 *   npx tsx scripts/audit-gender.ts
 *
 * It uses DATABASE_URL from .env via Prisma.
 */

import { prisma } from '../src/lib/db';

const MERCHANT_ID = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
const SAMPLE_LIMIT = Number(process.env.SAMPLE_LIMIT || '50');

async function main() {
  console.log('🔍 Starting gender audit');
  console.log(`   Merchant ID:  ${MERCHANT_ID}`);
  console.log(`   Sample limit: ${SAMPLE_LIMIT}`);

  // 1) Summary by category + gender
  const summary = await prisma.product.groupBy({
    by: ['category'],
    where: {
      merchantId: MERCHANT_ID,
      isActive: true,
    },
    _count: true,
  });

  console.log('\n📊 Category counts (all products):');
  for (const row of summary.sort((a, b) => a.category.localeCompare(b.category))) {
    console.log(`   ${row.category.padEnd(35)} total: ${String(row._count).padStart(4)}`);
  }

  // Direct SQL to group by attributes->>'gender'
  console.log('\n📊 Gender by category:');
  const genderByCategory = await prisma.$queryRawUnsafe<
    { category: string; gender: string | null; count: number }[]
  >(`
    SELECT
      "category" AS category,
      attributes->>'gender' AS gender,
      COUNT(*)::int AS count
    FROM "Product"
    WHERE "merchantId" = $1 AND "isActive" = true
    GROUP BY category, attributes->>'gender'
    ORDER BY category, gender NULLS LAST
  `, MERCHANT_ID);

  for (const row of genderByCategory) {
    const g = row.gender ?? '<null>';
    console.log(
      `   ${row.category.padEnd(35)} gender=${g.padEnd(8)} count=${String(row.count).padStart(4)}`
    );
  }

  // Helper: simple apparel detector mirroring ingestion logic.
  function isApparelCategory(category: string): boolean {
    const cat = category.toLowerCase();
    const keywords = [
      'dress',
      'skirt',
      'top',
      'blouse',
      'shirt',
      'tee',
      't-shirt',
      'sweater',
      'cardigan',
      'hoodie',
      'jacket',
      'coat',
      'outerwear',
      'pant',
      'trouser',
      'jean',
      'denim',
      'short',
      'jumpsuit',
      'romper',
      'legging',
      'activewear',
      'sport',
      'loungewear',
      'sleepwear',
      'pajama',
      'swim',
      'bikini',
      'lingerie',
      'underwear',
      'intimates',
      'bra',
      'brief',
      'boxer',
      'sock',
    ];
    return keywords.some((kw) => cat.includes(kw));
  }

  // 2) Apparel-like products that are NOT womens
  console.log('\n⚠️  Apparel-like products with gender != "womens" (sample):');
  const apparelNotWomens = await prisma.product.findMany({
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
    take: 500, // fetch more, then filter in JS
  });

  let apparelNotWomensCount = 0;
  for (const p of apparelNotWomens) {
    const attrs = (p.attributes ?? {}) as Record<string, unknown>;
    const gender = typeof attrs.gender === 'string' ? attrs.gender : null;
    if (!isApparelCategory(p.category)) continue;
    if (gender === 'womens') continue;
    apparelNotWomensCount += 1;
    if (apparelNotWomensCount <= SAMPLE_LIMIT) {
      console.log(
        `   [${gender ?? '<null>'}] ${p.category} / ${p.subcategory ?? ''} | ${p.title} | ageGroup=${p.ageGroup ?? 'null'}`,
      );
    }
  }
  if (apparelNotWomensCount === 0) {
    console.log('   (none found in sample)');
  } else {
    console.log(`   → Total apparel not womens in sample: ${apparelNotWomensCount}`);
  }

  // 3) Clearly non-apparel products that are NOT unisex
  console.log('\n⚠️  Non-apparel products with gender != "unisex" (sample):');
  const nonApparel = await prisma.product.findMany({
    where: {
      merchantId: MERCHANT_ID,
      isActive: true,
    },
    select: {
      id: true,
      title: true,
      category: true,
      subcategory: true,
      attributes: true,
    },
    take: 500,
  });

  let nonApparelMisCount = 0;
  for (const p of nonApparel) {
    if (isApparelCategory(p.category)) continue;
    const attrs = (p.attributes ?? {}) as Record<string, unknown>;
    const gender = typeof attrs.gender === 'string' ? attrs.gender : null;
    if (!gender || gender === 'unisex') continue;
    nonApparelMisCount += 1;
    if (nonApparelMisCount <= SAMPLE_LIMIT) {
      console.log(
        `   [${gender}] ${p.category} / ${p.subcategory ?? ''} | ${p.title}`,
      );
    }
  }
  if (nonApparelMisCount === 0) {
    console.log('   (none found in sample)');
  } else {
    console.log(`   → Total non-apparel not unisex in sample: ${nonApparelMisCount}`);
  }

  console.log('\n✅ Gender audit complete');
}

main()
  .catch((err) => {
    console.error('❌ Gender audit failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

