import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { prisma } from '../src/lib/db';

type CategoryGenderRow = {
  category: string | null;
  gender: string | null;
  count: bigint;
};

async function main() {
  const MIN_RATIO = 0.95;

  // Aggregate counts by category + gender from the live catalog
  const rows = await prisma.$queryRaw<CategoryGenderRow[]>`
    SELECT "category", "gender", COUNT(*)::bigint AS count
    FROM "Product"
    WHERE "isActive" = true
      AND "gender" IS NOT NULL
      AND "category" IS NOT NULL
    GROUP BY "category", "gender"
  `;

  const stats = new Map<
    string,
    {
      total: number;
      genderCounts: Record<string, number>;
    }
  >();

  for (const row of rows) {
    if (!row.category || !row.gender) continue;
    const category = row.category;
    const gender = String(row.gender).toLowerCase();
    const count = Number(row.count);

    if (!stats.has(category)) {
      stats.set(category, { total: 0, genderCounts: {} });
    }
    const entry = stats.get(category)!;
    entry.total += count;
    entry.genderCounts[gender] = (entry.genderCounts[gender] || 0) + count;
  }

  const result: Record<string, 'male' | 'female' | 'unisex'> = {};

  for (const [category, { total, genderCounts }] of stats.entries()) {
    if (total === 0) continue;

    // Find dominant gender and its share
    const entries = Object.entries(genderCounts);
    entries.sort((a, b) => b[1] - a[1]);
    const [dominantGenderRaw, dominantCount] = entries[0];
    const ratio = dominantCount / total;

    if (ratio >= MIN_RATIO) {
      let normalized: 'male' | 'female' | 'unisex' | null = null;
      if (dominantGenderRaw === 'male' || dominantGenderRaw === 'mens') {
        normalized = 'male';
      } else if (dominantGenderRaw === 'female' || dominantGenderRaw === 'womens') {
        normalized = 'female';
      } else if (dominantGenderRaw === 'unisex') {
        normalized = 'unisex';
      }

      if (normalized) {
        result[category] = normalized;
      }
    }
  }

  const outputPath = join(
    __dirname,
    '..',
    'src',
    'lib',
    'catalog',
    'category-gender-map.generated.json',
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

  // Simple console summary
  const countsByGender: Record<string, number> = {};
  for (const gender of Object.values(result)) {
    countsByGender[gender] = (countsByGender[gender] || 0) + 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Generated category-gender map for ${Object.keys(result).length} categories (>= ${
      MIN_RATIO * 100
    }% single-gender). Breakdown:`,
    countsByGender,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Error building category-gender map', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

