import { prisma } from '../src/lib/db';

async function main() {
  const rows = await prisma.$queryRawUnsafe<{
    id: string;
    title: string | null;
    category: string | null;
    subcategory: string | null;
  }[]>(
    `SELECT id, "title", "category", "subcategory"
     FROM "Product"
     WHERE "isActive" = true
       AND (
         LOWER("title") LIKE '%suit%'
         OR LOWER("title") LIKE '%blazer%'
         OR LOWER("title") LIKE '%chino%'
         OR LOWER("title") LIKE '%trouser%'
         OR LOWER("title") LIKE '%formal%'
       )
     ORDER BY "category" ASC, "title" ASC
     LIMIT 50`
  );

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
