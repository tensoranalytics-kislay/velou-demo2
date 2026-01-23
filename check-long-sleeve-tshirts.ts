import { prisma } from './src/lib/db';

async function checkLongSleeveTshirts() {
  console.log('================================================================================');
  console.log('CHECKING LONG SLEEVE T-SHIRTS IN DATABASE');
  console.log('================================================================================\n');
  
  // Check 1: Women's t-shirts with long sleeves
  console.log('1. Checking "Womens-tees" category with long sleeves...');
  const womensTeesLongSleeve = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string; 
    category: string;
    sleeve: string | null;
    sleeveLength: string | null;
    ageGroup: string | null;
    enriched_color: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p.attributes->>'sleeve' as sleeve,
      p.attributes->>'sleeveLength' as sleeveLength,
      p."ageGroup",
      p.attributes->>'enriched_color' as enriched_color
    FROM "Product" p
    WHERE 
      LOWER(p."category") = 'womens-tees'
      AND (
        LOWER(COALESCE(p.attributes->>'sleeve', '')) LIKE '%long%'
        OR LOWER(COALESCE(p.attributes->>'sleeveLength', '')) LIKE '%long%'
        OR LOWER(COALESCE(p.attributes->>'sleeveLength', '')) = 'long'
        OR (p.attributes->'extensible' IS NOT NULL AND (
          LOWER(COALESCE(p.attributes->'extensible'->>'sleeve', '')) LIKE '%long%'
          OR LOWER(COALESCE(p.attributes->'extensible'->>'sleeveLength', '')) LIKE '%long%'
        ))
      )
    LIMIT 20
  `;
  
  console.log(`   Found ${womensTeesLongSleeve.length} products\n`);
  
  if (womensTeesLongSleeve.length > 0) {
    console.log('   Products:');
    womensTeesLongSleeve.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Category: ${p.category}`);
      console.log(`      AgeGroup: ${p.ageGroup || 'N/A'}`);
      console.log(`      Sleeve: ${p.sleeve || p.sleeveLength || 'N/A'}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  }
  
  // Check 2: All women's t-shirts (any sleeve length)
  console.log('\n2. Checking all "Womens-tees" category products...');
  const allWomensTees = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Product" p
    WHERE LOWER(p."category") = 'womens-tees'
  `;
  console.log(`   Total "Womens-tees" products: ${allWomensTees[0]?.count || 0}`);
  
  // Check 3: Women's t-shirts by sleeve length
  console.log('\n3. Checking "Womens-tees" by sleeve length...');
  const bySleeve = await prisma.$queryRaw<Array<{ 
    sleeve: string;
    count: bigint;
  }>>`
    SELECT 
      COALESCE(
        p.attributes->>'sleeve',
        p.attributes->>'sleeveLength',
        p.attributes->'extensible'->>'sleeve',
        p.attributes->'extensible'->>'sleeveLength',
        'Unknown'
      ) as sleeve,
      COUNT(*) as count
    FROM "Product" p
    WHERE LOWER(p."category") = 'womens-tees'
    GROUP BY 
      COALESCE(
        p.attributes->>'sleeve',
        p.attributes->>'sleeveLength',
        p.attributes->'extensible'->>'sleeve',
        p.attributes->'extensible'->>'sleeveLength',
        'Unknown'
      )
    ORDER BY count DESC
  `;
  
  console.log('   Sleeve length distribution:');
  bySleeve.forEach(row => {
    console.log(`     ${row.sleeve || 'N/A'}: ${row.count} products`);
  });
  
  // Check 4: Sample products that should match
  console.log('\n4. Sample products that should match the query...');
  const matchingProducts = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string; 
    category: string;
    sleeve: string | null;
    sleeveLength: string | null;
    ageGroup: string | null;
    enriched_color: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p.attributes->>'sleeve' as sleeve,
      p.attributes->>'sleeveLength' as sleeveLength,
      p."ageGroup",
      p.attributes->>'enriched_color' as enriched_color
    FROM "Product" p
    WHERE 
      LOWER(p."category") = 'womens-tees'
      AND (
        LOWER(COALESCE(p."ageGroup", '')) = 'adult'
        OR LOWER(COALESCE(p."ageGroup", '')) LIKE '%adult%'
        OR LOWER(p."category") LIKE '%women%'
      )
      AND (
        LOWER(COALESCE(p.attributes->>'sleeve', '')) LIKE '%long%'
        OR LOWER(COALESCE(p.attributes->>'sleeveLength', '')) LIKE '%long%'
        OR LOWER(COALESCE(p.attributes->>'sleeveLength', '')) = 'long'
        OR (p.attributes->'extensible' IS NOT NULL AND (
          LOWER(COALESCE(p.attributes->'extensible'->>'sleeve', '')) LIKE '%long%'
          OR LOWER(COALESCE(p.attributes->'extensible'->>'sleeveLength', '')) LIKE '%long%'
        ))
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
      console.log(`      Sleeve: ${p.sleeve || p.sleeveLength || 'N/A'}`);
      console.log(`      Color: ${p.enriched_color || 'N/A'}`);
      console.log('');
    });
  } else {
    console.log('   ❌ No products found matching all criteria!');
  }
  
  // Check 5: Check if products have "Long" vs "long" vs "Long Sleeve" etc.
  console.log('\n5. Checking exact sleeve value formats...');
  const sleeveFormats = await prisma.$queryRaw<Array<{ 
    sleeveValue: string;
    count: bigint;
  }>>`
    SELECT 
      COALESCE(
        p.attributes->>'sleeve',
        p.attributes->>'sleeveLength',
        p.attributes->'extensible'->>'sleeve',
        p.attributes->'extensible'->>'sleeveLength'
      ) as sleeveValue,
      COUNT(*) as count
    FROM "Product" p
    WHERE 
      LOWER(p."category") = 'womens-tees'
      AND (
        p.attributes->>'sleeve' IS NOT NULL
        OR p.attributes->>'sleeveLength' IS NOT NULL
        OR (p.attributes->'extensible' IS NOT NULL AND (
          p.attributes->'extensible'->>'sleeve' IS NOT NULL
          OR p.attributes->'extensible'->>'sleeveLength' IS NOT NULL
        ))
      )
      AND (
        LOWER(COALESCE(p.attributes->>'sleeve', '')) LIKE '%long%'
        OR LOWER(COALESCE(p.attributes->>'sleeveLength', '')) LIKE '%long%'
        OR (p.attributes->'extensible' IS NOT NULL AND (
          LOWER(COALESCE(p.attributes->'extensible'->>'sleeve', '')) LIKE '%long%'
          OR LOWER(COALESCE(p.attributes->'extensible'->>'sleeveLength', '')) LIKE '%long%'
        ))
      )
    GROUP BY 
      COALESCE(
        p.attributes->>'sleeve',
        p.attributes->>'sleeveLength',
        p.attributes->'extensible'->>'sleeve',
        p.attributes->'extensible'->>'sleeveLength'
      )
    ORDER BY count DESC
  `;
  
  console.log('   Sleeve value formats for long sleeves:');
  sleeveFormats.forEach(row => {
    console.log(`     "${row.sleeveValue || 'N/A'}": ${row.count} products`);
  });
  
  // Check 6: Sample products from Womens-tees to see what sleeve data they have
  console.log('\n6. Sample products from "Womens-tees" to check sleeve data...');
  const samples = await prisma.$queryRaw<Array<{ 
    id: string; 
    title: string;
    sleeve: string | null;
    sleeveLength: string | null;
    extensibleSleeve: string | null;
    extensibleSleeveLength: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p.attributes->>'sleeve' as sleeve,
      p.attributes->>'sleeveLength' as sleeveLength,
      p.attributes->'extensible'->>'sleeve' as extensibleSleeve,
      p.attributes->'extensible'->>'sleeveLength' as extensibleSleeveLength
    FROM "Product" p
    WHERE LOWER(p."category") = 'womens-tees'
    LIMIT 10
  `;
  
  console.log('   Sample products:');
  samples.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.title}`);
    console.log(`      ID: ${p.id}`);
    console.log(`      sleeve: ${p.sleeve || 'N/A'}`);
    console.log(`      sleeveLength: ${p.sleeveLength || 'N/A'}`);
    console.log(`      extensible.sleeve: ${p.extensibleSleeve || 'N/A'}`);
    console.log(`      extensible.sleeveLength: ${p.extensibleSleeveLength || 'N/A'}`);
    console.log('');
  });
  
  await prisma.$disconnect();
}

checkLongSleeveTshirts().catch(console.error);
