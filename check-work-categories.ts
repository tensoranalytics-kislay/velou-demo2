import { prisma } from './src/lib/db';

async function checkWorkCategories() {
  console.log('================================================================================');
  console.log('CHECKING WORK-RELATED CLOTHING BY CATEGORY');
  console.log('================================================================================\n');
  
  // Get all products with "Work" in occasionContext, grouped by category
  const workByCategory = await prisma.$queryRaw<Array<{ category: string; count: bigint }>>`
    SELECT 
      p."category",
      COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
    GROUP BY p."category"
    ORDER BY count DESC
  `;
  
  console.log('Work-related products by category:');
  console.log('-----------------------------------\n');
  
  let total = 0;
  workByCategory.forEach((row, i) => {
    const count = Number(row.count);
    total += count;
    console.log(`${i + 1}. ${row.category}: ${count} products`);
  });
  
  console.log(`\nTotal: ${total} products with "Work" occasion\n`);
  
  // Get sample products from top categories
  console.log('\n================================================================================');
  console.log('SAMPLE PRODUCTS FROM TOP CATEGORIES');
  console.log('================================================================================\n');
  
  for (const categoryRow of workByCategory.slice(0, 5)) {
    const category = categoryRow.category;
    const count = Number(categoryRow.count);
    
    console.log(`\n${category} (${count} products):`);
    console.log('─'.repeat(60));
    
    const samples = await prisma.$queryRaw<Array<{ 
      id: string; 
      title: string; 
      occasionContext: any; 
      enriched_color: string | null;
      ageGroup: string | null;
      subcategory: string | null;
    }>>`
      SELECT 
        p.id,
        p.title,
        p."occasionContext",
        p.attributes->>'enriched_color' as enriched_color,
        p."ageGroup",
        p."subcategory"
      FROM "Product" p
      WHERE 
        p."occasionContext" IS NOT NULL 
        AND p."occasionContext" && ARRAY['Work']::text[]
        AND p."category" = ${category}
      LIMIT 10
    `;
    
    samples.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.title}`);
      console.log(`     ID: ${p.id}`);
      console.log(`     Subcategory: ${p.subcategory || 'N/A'}`);
      console.log(`     AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`     Color: ${p.enriched_color || 'N/A'}`);
      console.log(`     Occasions: ${JSON.stringify(p.occasionContext)}`);
      console.log('');
    });
  }
  
  // Check subcategories too
  console.log('\n================================================================================');
  console.log('WORK-RELATED CLOTHING BY SUBCATEGORY');
  console.log('================================================================================\n');
  
  const workBySubcategory = await prisma.$queryRaw<Array<{ 
    category: string;
    subcategory: string | null; 
    count: bigint 
  }>>`
    SELECT 
      p."category",
      p."subcategory",
      COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
    GROUP BY p."category", p."subcategory"
    ORDER BY count DESC
    LIMIT 20
  `;
  
  console.log('Top subcategories:');
  workBySubcategory.forEach((row, i) => {
    const count = Number(row.count);
    const subcat = row.subcategory || '(no subcategory)';
    console.log(`${i + 1}. ${row.category} > ${subcat}: ${count} products`);
  });
  
  await prisma.$disconnect();
}

checkWorkCategories().catch(console.error);
