import { prisma } from './src/lib/db';

async function checkWorkDresses() {
  const colors = ['White', 'Navy Blue', 'Black', 'Beige', 'Gray', 'Blush', 'Burgundy'];
  
  console.log('================================================================================');
  console.log('CHECKING WORK DRESSES IN DATABASE');
  console.log('================================================================================\n');
  
  // Check 1: Products with "Work" in occasionContext
  console.log('1. Checking products with "Work" in occasionContext...');
  const workProducts = await prisma.$queryRaw<Array<{ id: string; title: string; occasionContext: any; enriched_color: string | null; category: string }>>`
    SELECT 
      p.id,
      p.title,
      p."occasionContext",
      p.attributes->>'enriched_color' as enriched_color,
      p."category"
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
      AND LOWER(p."category") LIKE '%dress%'
    LIMIT 20
  `;
  
  console.log(`   Found ${workProducts.length} products with "Work" occasion\n`);
  
  if (workProducts.length > 0) {
    console.log('   Sample products:');
    workProducts.slice(0, 10).forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      OccasionContext: ${JSON.stringify(p.occasionContext)}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  }
  
  // Check 2: Products with "Work" AND matching colors
  console.log('\n2. Checking products with "Work" AND matching colors...');
  const workWithColors = await prisma.$queryRaw<Array<{ id: string; title: string; occasionContext: any; enriched_color: string | null; category: string }>>`
    SELECT 
      p.id,
      p.title,
      p."occasionContext",
      p.attributes->>'enriched_color' as enriched_color,
      p."category"
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
      AND LOWER(p."category") LIKE '%dress%'
      AND (
        LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%white%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%navy%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%black%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%beige%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%gray%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%grey%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%blush%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%burgundy%'
      )
    LIMIT 20
  `;
  
  console.log(`   Found ${workWithColors.length} products with "Work" AND matching colors\n`);
  
  if (workWithColors.length > 0) {
    console.log('   Products:');
    workWithColors.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      OccasionContext: ${JSON.stringify(p.occasionContext)}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  }
  
  // Check 3: Products in Women's Dresses category with Work
  console.log('\n3. Checking products in "Women\'s Dresses" category with "Work"...');
  const womensDressesWork = await prisma.$queryRaw<Array<{ id: string; title: string; occasionContext: any; enriched_color: string | null; category: string; ageGroup: string | null }>>`
    SELECT 
      p.id,
      p.title,
      p."occasionContext",
      p.attributes->>'enriched_color' as enriched_color,
      p."category",
      p."ageGroup"
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
      AND (
        LOWER(p."category") = 'women''s dresses'
        OR (LOWER(p."category") LIKE '%women%' AND LOWER(p."category") LIKE '%dress%')
      )
    LIMIT 20
  `;
  
  console.log(`   Found ${womensDressesWork.length} products in "Women's Dresses" with "Work"\n`);
  
  if (womensDressesWork.length > 0) {
    console.log('   Products:');
    womensDressesWork.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`      OccasionContext: ${JSON.stringify(p.occasionContext)}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  }
  
  // Check 4: Total count of Work dresses
  console.log('\n4. Total counts...');
  const totalWorkDresses = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
      AND LOWER(p."category") LIKE '%dress%'
  `;
  
  const totalWorkDressesWomens = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
      AND (
        LOWER(p."category") = 'women''s dresses'
        OR (LOWER(p."category") LIKE '%women%' AND LOWER(p."category") LIKE '%dress%')
      )
  `;
  
  const totalWorkDressesWithColors = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
      AND LOWER(p."category") LIKE '%dress%'
      AND (
        LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%white%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%navy%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%black%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%beige%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%gray%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%grey%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%blush%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%burgundy%'
      )
  `;
  
  console.log(`   Total Work dresses (any category): ${totalWorkDresses[0]?.count || 0}`);
  console.log(`   Total Work dresses (Women's Dresses): ${totalWorkDressesWomens[0]?.count || 0}`);
  console.log(`   Total Work dresses with matching colors: ${totalWorkDressesWithColors[0]?.count || 0}`);
  
  // Check 5: Sample products that should match our query
  console.log('\n5. Sample products that should match our query (Work + Colors + Women\'s Dresses)...');
  const matchingProducts = await prisma.$queryRaw<Array<{ id: string; title: string; occasionContext: any; enriched_color: string | null; category: string; ageGroup: string | null }>>`
    SELECT 
      p.id,
      p.title,
      p."occasionContext",
      p.attributes->>'enriched_color' as enriched_color,
      p."category",
      p."ageGroup"
    FROM "Product" p
    WHERE 
      p."occasionContext" IS NOT NULL 
      AND p."occasionContext" && ARRAY['Work']::text[]
      AND (
        LOWER(p."category") = 'women''s dresses'
        OR (LOWER(p."category") LIKE '%women%' AND LOWER(p."category") LIKE '%dress%')
      )
      AND (
        LOWER(COALESCE(p."ageGroup", '')) = 'adult'
        OR LOWER(COALESCE(p."ageGroup", '')) LIKE '%adult%'
        OR LOWER(p."category") LIKE '%women%'
        OR LOWER(p."category") LIKE '%ladies%'
      )
      AND (
        LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%white%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%navy%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%black%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%beige%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%gray%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%grey%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%blush%'
        OR LOWER(COALESCE(p.attributes->>'enriched_color', '')) LIKE '%burgundy%'
      )
    LIMIT 20
  `;
  
  console.log(`   Found ${matchingProducts.length} products matching all criteria\n`);
  
  if (matchingProducts.length > 0) {
    console.log('   Matching products:');
    matchingProducts.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`      OccasionContext: ${JSON.stringify(p.occasionContext)}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  } else {
    console.log('   ❌ No products found matching all criteria!');
  }
  
  console.log('\n================================================================================');
  console.log('SUMMARY');
  console.log('================================================================================');
  console.log(`Total Work dresses: ${totalWorkDresses[0]?.count || 0}`);
  console.log(`Total Work dresses (Women's Dresses): ${totalWorkDressesWomens[0]?.count || 0}`);
  console.log(`Total Work dresses with matching colors: ${totalWorkDressesWithColors[0]?.count || 0}`);
  console.log(`Products matching all criteria: ${matchingProducts.length}`);
  
  await prisma.$disconnect();
}

checkWorkDresses().catch(console.error);
