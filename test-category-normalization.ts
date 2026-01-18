import { prisma } from './src/lib/db';

(async () => {
  // Get first 100 categories by product count
  const categories = await prisma.$queryRaw<Array<{category: string}>>`
    SELECT "category"
    FROM (
      SELECT DISTINCT "category", COUNT(*) as cnt
      FROM "Product"
      WHERE "category" IS NOT NULL 
        AND "category" != ''
        AND "isActive" = true
      GROUP BY "category"
      ORDER BY cnt DESC
      LIMIT 100
    ) subq
  `;
  
  const categoryList = categories.map(c => c.category);
  console.log('Top 100 categories to test:');
  categoryList.slice(0, 10).forEach((cat, i) => {
    console.log(`${i+1}. ${cat}`);
  });
  console.log(`\n... and ${categoryList.length - 10} more`);
  
  // Show sample products for first 3 categories
  for (const cat of categoryList.slice(0, 3)) {
    const products = await prisma.product.findMany({
      where: { category: cat, isActive: true },
      select: { id: true, title: true, category: true, gender: true, ageGroup: true },
      take: 5
    });
    console.log(`\n📦 Category: "${cat}" (${products.length} sample products)`);
    products.forEach((p, i) => {
      console.log(`   ${i+1}. ${p.title.substring(0, 60)}... (Gender: ${p.gender || 'null'}, Age: ${p.ageGroup?.substring(0, 30) || 'null'})`);
    });
  }
  
  await prisma.$disconnect();
})();
