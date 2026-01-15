import { prisma } from '../src/lib/db';

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ category: string | null; count: bigint }[]>(
    'SELECT "category", COUNT(*) AS count FROM "Product" WHERE "isActive" = true GROUP BY "category" ORDER BY count DESC, "category" ASC'
  );

  for (const row of rows) {
    const name = row.category ?? '(null)';
    console.log(`${name}\t${row.count.toString()}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
