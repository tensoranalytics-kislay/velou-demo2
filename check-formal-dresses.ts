import { prisma } from './src/lib/db';

async function checkFormalDresses() {
  console.log('================================================================================');
  console.log('CHECKING FORMAL DRESSES IN DATABASE');
  console.log('================================================================================\n');
  
  // Check 1: All products with "Formal" in occasionContext
  console.log('1. Checking all products with "Formal" in occasionContext...');
  const formalProducts = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string; 
    category: string;
    occasionContext: any; 
    enriched_color: string | null;
    ageGroup: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p."occasionContext",
      p.attributes->>'enriched_color' as enriched_color,
      p."ageGroup"
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Formal']::text[]
    ORDER BY p."category"
    LIMIT 50
  `;
  
  console.log(`   Found ${formalProducts.length} products with "Formal" occasion\n`);
  
  // Group by category
  const byCategory = new Map<string, number>();
  formalProducts.forEach(p => {
    const count = byCategory.get(p.category) || 0;
    byCategory.set(p.category, count + 1);
  });
  
  console.log('   By category:');
  Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`     ${cat}: ${count} products`);
    });
  
  // Check 2: Dresses specifically with "Formal"
  console.log('\n2. Checking dresses with "Formal" occasion...');
  const formalDresses = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string; 
    category: string;
    subcategory: string | null;
    occasionContext: any; 
    enriched_color: string | null;
    ageGroup: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p."subcategory",
      p."occasionContext",
      p.attributes->>'enriched_color' as enriched_color,
      p."ageGroup"
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Formal']::text[]
      AND LOWER(p."category") LIKE '%dress%'
    ORDER BY p."category"
    LIMIT 50
  `;
  
  console.log(`   Found ${formalDresses.length} dresses with "Formal" occasion\n`);
  
  if (formalDresses.length > 0) {
    console.log('   Formal dresses:');
    formalDresses.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      Subcategory: ${p.subcategory || 'N/A'}`);
      console.log(`      AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`      OccasionContext: ${JSON.stringify(p.occasionContext)}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  }
  
  // Check 3: Women's Dresses specifically
  console.log('\n3. Checking "Women\'s Dresses" with "Formal" occasion...');
  const womensFormalDresses = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string; 
    category: string;
    subcategory: string | null;
    occasionContext: any; 
    enriched_color: string | null;
    ageGroup: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p."subcategory",
      p."occasionContext",
      p.attributes->>'enriched_color' as enriched_color,
      p."ageGroup"
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Formal']::text[]
      AND (
        LOWER(p."category") = 'women''s dresses'
        OR (LOWER(p."category") LIKE '%women%' AND LOWER(p."category") LIKE '%dress%')
      )
    LIMIT 50
  `;
  
  console.log(`   Found ${womensFormalDresses.length} "Women's Dresses" with "Formal" occasion\n`);
  
  if (womensFormalDresses.length > 0) {
    console.log('   Women\'s Formal Dresses:');
    womensFormalDresses.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      Subcategory: ${p.subcategory || 'N/A'}`);
      console.log(`      AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`      OccasionContext: ${JSON.stringify(p.occasionContext)}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  }
  
  // Check 4: Total counts
  console.log('\n4. Total counts...');
  const totalFormal = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Formal']::text[]
  `;
  
  const totalFormalDresses = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Formal']::text[]
      AND LOWER(p."category") LIKE '%dress%'
  `;
  
  const totalWomensFormalDresses = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Formal']::text[]
      AND (
        LOWER(p."category") = 'women''s dresses'
        OR (LOWER(p."category") LIKE '%women%' AND LOWER(p."category") LIKE '%dress%')
      )
  `;
  
  console.log(`   Total products with "Formal" occasion: ${totalFormal[0]?.count || 0}`);
  console.log(`   Total dresses with "Formal" occasion: ${totalFormalDresses[0]?.count || 0}`);
  console.log(`   Total "Women's Dresses" with "Formal" occasion: ${totalWomensFormalDresses[0]?.count || 0}`);
  
  // Check 5: Other formal-related occasions
  console.log('\n5. Checking other formal-related occasions in dresses...');
  const weddingDresses = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Wedding']::text[]
      AND LOWER(p."category") LIKE '%dress%'
  `;
  
  const eveningDresses = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Evening']::text[]
      AND LOWER(p."category") LIKE '%dress%'
  `;
  
  const blackTieDresses = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND (
        p."occasionContext" && ARRAY['Black Tie']::text[]
        OR p."occasionContext" && ARRAY['BlackTie']::text[]
      )
      AND LOWER(p."category") LIKE '%dress%'
  `;
  
  console.log('   Formal-related occasions in dresses:');
  console.log(`     Wedding: ${weddingDresses[0]?.count || 0} products`);
  console.log(`     Evening: ${eveningDresses[0]?.count || 0} products`);
  console.log(`     Black Tie: ${blackTieDresses[0]?.count || 0} products`);
  
  // Sample wedding dresses
  if (Number(weddingDresses[0]?.count || 0) > 0) {
    console.log('\n   Sample Wedding dresses:');
    const samples = await prisma.$queryRaw<Array<{ 
      id: string; 
      title: string; 
      category: string;
      occasionContext: any; 
      enriched_color: string | null;
    }>>`
      SELECT 
        p.id,
        p.title,
        p."category",
        p."occasionContext",
        p.attributes->>'enriched_color' as enriched_color
      FROM "Product" p
      WHERE 
        p."occasionContext" IS NOT NULL 
        AND p."occasionContext" && ARRAY['Wedding']::text[]
        AND LOWER(p."category") LIKE '%dress%'
      LIMIT 10
    `;
    
    samples.forEach((p, i) => {
      console.log(`     ${i + 1}. ${p.title} (${p.category})`);
      console.log(`        Color: ${p.enriched_color || 'N/A'}`);
    });
  }
  
  await prisma.$disconnect();
}

checkFormalDresses().catch(console.error);
