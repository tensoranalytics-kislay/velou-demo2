import { prisma } from './src/lib/db';

async function checkDressOccasions() {
  console.log('================================================================================');
  console.log('CHECKING OCCASION VALUES FOR DRESSES');
  console.log('================================================================================\n');
  
  // Check 1: All unique occasion values in occasionContext for dresses
  console.log('1. All unique occasion values in occasionContext column for dresses:');
  const occasionValues = await prisma.$queryRaw<Array<{ 
    occasion: string;
    count: bigint;
  }>>`
    SELECT 
      unnest(p."occasionContext") as occasion,
      COUNT(*) as count
    FROM "Product" p
    WHERE LOWER(p."category") LIKE '%dress%'
      AND p."occasionContext" IS NOT NULL
      AND array_length(p."occasionContext", 1) > 0
    GROUP BY unnest(p."occasionContext")
    ORDER BY count DESC
  `;
  
  console.log(`   Found ${occasionValues.length} unique occasion values:\n`);
  occasionValues.forEach((row, i) => {
    console.log(`   ${i + 1}. "${row.occasion}": ${row.count} dresses`);
  });
  
  // Check 2: Formalwear-related occasions
  console.log('\n\n2. Formalwear-related occasions:');
  const formalOccasions = ['Formal', 'Wedding', 'Evening', 'Cocktail', 'Black Tie', 'Gala', 'Prom', 'Ball', 'Dinner', 'Event'];
  const formalOccasionCounts = await prisma.$queryRaw<Array<{ 
    occasion: string;
    count: bigint;
  }>>`
    WITH occasion_expanded AS (
      SELECT unnest(p."occasionContext") as occasion
      FROM "Product" p
      WHERE LOWER(p."category") LIKE '%dress%'
        AND p."occasionContext" IS NOT NULL
        AND array_length(p."occasionContext", 1) > 0
    )
    SELECT 
      occasion,
      COUNT(*) as count
    FROM occasion_expanded
    WHERE (
      occasion ILIKE '%formal%'
      OR occasion ILIKE '%wedding%'
      OR occasion ILIKE '%evening%'
      OR occasion ILIKE '%cocktail%'
      OR occasion ILIKE '%black%tie%'
      OR occasion ILIKE '%gala%'
      OR occasion ILIKE '%prom%'
      OR occasion ILIKE '%ball%'
      OR occasion ILIKE '%dinner%'
      OR occasion ILIKE '%event%'
    )
    GROUP BY occasion
    ORDER BY count DESC
  `;
  
  if (formalOccasionCounts.length > 0) {
    console.log(`   Found ${formalOccasionCounts.length} formalwear-related occasions:\n`);
    formalOccasionCounts.forEach((row, i) => {
      console.log(`   ${i + 1}. "${row.occasion}": ${row.count} dresses`);
    });
  } else {
    console.log('   No formalwear-related occasions found');
  }
  
  // Check 3: Sample products with formalwear occasions
  console.log('\n\n3. Sample dresses with formalwear occasions:');
  const formalDresses = await prisma.$queryRaw<Array<{ 
    id: string;
    title: string;
    category: string;
    occasionContext: any;
    formalityLevel: string | null;
  }>>`
    SELECT 
      p.id,
      p.title,
      p."category",
      p."occasionContext",
      p."formalityLevel"
    FROM "Product" p
    WHERE LOWER(p."category") LIKE '%dress%'
      AND p."occasionContext" IS NOT NULL
      AND (
        p."occasionContext" && ARRAY['Wedding']::text[]
        OR p."occasionContext" && ARRAY['Evening']::text[]
        OR p."occasionContext" && ARRAY['Cocktail']::text[]
        OR p."occasionContext" && ARRAY['Formal']::text[]
      )
    LIMIT 10
  `;
  
  console.log(`   Found ${formalDresses.length} sample dresses:\n`);
  formalDresses.forEach((dress, i) => {
    console.log(`   ${i + 1}. ${dress.title}`);
    console.log(`      ID: ${dress.id}`);
    console.log(`      Occasions: ${Array.isArray(dress.occasionContext) ? dress.occasionContext.join(', ') : dress.occasionContext || 'N/A'}`);
    console.log(`      Formality Level: ${dress.formalityLevel || 'N/A'}`);
    console.log('');
  });
  
  // Check 4: Occasion distribution by category
  console.log('\n\n4. Top occasions by dress category:');
  const occasionByCategory = await prisma.$queryRaw<Array<{ 
    category: string;
    occasion: string;
    count: bigint;
  }>>`
    WITH occasion_expanded AS (
      SELECT 
        p."category",
        unnest(p."occasionContext") as occasion
      FROM "Product" p
      WHERE LOWER(p."category") LIKE '%dress%'
        AND p."occasionContext" IS NOT NULL
        AND array_length(p."occasionContext", 1) > 0
    )
    SELECT 
      category,
      occasion,
      COUNT(*) as count
    FROM occasion_expanded
    GROUP BY category, occasion
    ORDER BY category, count DESC
  `;
  
  const categoryMap = new Map<string, Array<{occasion: string; count: number}>>();
  occasionByCategory.forEach(row => {
    const cat = row.category || 'Unknown';
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat)!.push({ occasion: row.occasion, count: Number(row.count) });
  });
  
  categoryMap.forEach((occasions, category) => {
    console.log(`\n   ${category}:`);
    occasions.slice(0, 5).forEach((occ, i) => {
      console.log(`     ${i + 1}. "${occ.occasion}": ${occ.count} dresses`);
    });
  });
  
  // Check 5: Work vs Formal occasions comparison
  console.log('\n\n5. Work vs Formal occasions comparison:');
  const workFormalComparison = await prisma.$queryRaw<Array<{ 
    occasion: string;
    count: bigint;
  }>>`
    WITH occasion_expanded AS (
      SELECT unnest(p."occasionContext") as occasion
      FROM "Product" p
      WHERE LOWER(p."category") LIKE '%dress%'
        AND p."occasionContext" IS NOT NULL
        AND array_length(p."occasionContext", 1) > 0
    )
    SELECT 
      occasion,
      COUNT(*) as count
    FROM occasion_expanded
    WHERE occasion IN ('Work', 'Formal', 'Wedding', 'Evening', 'Cocktail')
    GROUP BY occasion
    ORDER BY count DESC
  `;
  
  console.log('   Occasion counts:\n');
  workFormalComparison.forEach(row => {
    console.log(`     "${row.occasion}": ${row.count} dresses`);
  });
  
  await prisma.$disconnect();
}

checkDressOccasions().catch(console.error);
