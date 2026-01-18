import { prisma } from './src/lib/db';

async function checkFloralProducts() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  try {
    console.log('🔍 Checking for products matching the filters...\n');
    
    // Check products with Floral pattern
    const floralCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM "Product" p
      WHERE p."merchantId" = ${merchantId}
        AND p."isActive" = true
        AND (
          LOWER(COALESCE(p.attributes->>'Pattern', '')) = 'floral'
          OR LOWER(COALESCE(p.attributes->>'pattern_print', '')) = 'floral'
        )
    `;
    
    // Check products with Beach/Vacation occasion
    const occasionCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM "Product" p
      WHERE p."merchantId" = ${merchantId}
        AND p."isActive" = true
        AND (
          LOWER(COALESCE(p.attributes->>'occasion', '')) LIKE '%beach%'
          OR LOWER(COALESCE(p.attributes->>'occasion', '')) LIKE '%vacation%'
          OR LOWER(COALESCE(p.attributes->>'occasionContext', '')) LIKE '%beach%'
          OR LOWER(COALESCE(p.attributes->>'occasionContext', '')) LIKE '%vacation%'
          OR (p."occasionContext" IS NOT NULL AND 
              (LOWER(p."occasionContext"::text) LIKE '%beach%' OR LOWER(p."occasionContext"::text) LIKE '%vacation%'))
        )
    `;
    
    // Check products with Summer season
    const summerCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM "Product" p
      WHERE p."merchantId" = ${merchantId}
        AND p."isActive" = true
        AND (
          LOWER(COALESCE(p.attributes->>'season', '')) LIKE '%summer%'
          OR LOWER(COALESCE(p.attributes->>'seasonalCues', '')) LIKE '%summer%'
        )
    `;
    
    // Check products matching ALL three (Pattern=Floral AND Occasion=Beach/Vacation AND Season=Summer)
    const allThreeCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM "Product" p
      WHERE p."merchantId" = ${merchantId}
        AND p."isActive" = true
        AND (
          LOWER(COALESCE(p.attributes->>'Pattern', '')) = 'floral'
          OR LOWER(COALESCE(p.attributes->>'pattern_print', '')) = 'floral'
        )
        AND (
          LOWER(COALESCE(p.attributes->>'occasion', '')) LIKE '%beach%'
          OR LOWER(COALESCE(p.attributes->>'occasion', '')) LIKE '%vacation%'
          OR LOWER(COALESCE(p.attributes->>'occasionContext', '')) LIKE '%beach%'
          OR LOWER(COALESCE(p.attributes->>'occasionContext', '')) LIKE '%vacation%'
          OR (p."occasionContext" IS NOT NULL AND 
              (LOWER(p."occasionContext"::text) LIKE '%beach%' OR LOWER(p."occasionContext"::text) LIKE '%vacation%'))
        )
        AND (
          LOWER(COALESCE(p.attributes->>'season', '')) LIKE '%summer%'
          OR LOWER(COALESCE(p.attributes->>'seasonalCues', '')) LIKE '%summer%'
        )
    `;
    
    // Get sample products with Floral pattern
    const floralSamples = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      pattern: string | null;
      occasion: string | null;
      season: string | null;
    }>>`
      SELECT 
        p.id, 
        p.title, 
        p.attributes->>'Pattern' as pattern,
        p.attributes->>'occasion' as occasion,
        p.attributes->>'season' as season
      FROM "Product" p
      WHERE p."merchantId" = ${merchantId}
        AND p."isActive" = true
        AND (
          LOWER(COALESCE(p.attributes->>'Pattern', '')) = 'floral'
          OR LOWER(COALESCE(p.attributes->>'pattern_print', '')) = 'floral'
        )
      LIMIT 10
    `;
    
    // Check products with Floral pattern AND in Women's Dresses category
    const floralDressesCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count
      FROM "Product" p
      WHERE p."merchantId" = ${merchantId}
        AND p."isActive" = true
        AND (
          LOWER(p."category") LIKE '%dress%'
          OR LOWER(COALESCE(p."subcategory", '')) LIKE '%dress%'
        )
        AND (
          LOWER(COALESCE(p.attributes->>'Pattern', '')) = 'floral'
          OR LOWER(COALESCE(p.attributes->>'pattern_print', '')) = 'floral'
        )
    `;
    
    console.log('📊 Database Query Results:\n');
    console.log(`✅ Products with Floral pattern: ${Number(floralCount[0].count)}`);
    console.log(`✅ Products with Beach/Vacation occasion: ${Number(occasionCount[0].count)}`);
    console.log(`✅ Products with Summer season: ${Number(summerCount[0].count)}`);
    console.log(`✅ Floral dresses (in dress category): ${Number(floralDressesCount[0].count)}`);
    console.log(`❌ Products matching ALL THREE (Floral + Beach/Vacation + Summer): ${Number(allThreeCount[0].count)}\n`);
    
    if (floralSamples.length > 0) {
      console.log('📦 Sample Floral Products:\n');
      floralSamples.forEach((product, idx) => {
        console.log(`${idx + 1}. ${product.title}`);
        console.log(`   Pattern: ${product.pattern || 'N/A'}`);
        console.log(`   Occasion: ${product.occasion || 'N/A'}`);
        console.log(`   Season: ${product.season || 'N/A'}`);
        console.log(`   ID: ${product.id}\n`);
      });
    }
    
    // Check what pattern values actually exist in the database
    const patternValues = await prisma.$queryRaw<Array<{ pattern: string; count: bigint }>>`
      SELECT 
        LOWER(COALESCE(p.attributes->>'Pattern', p.attributes->>'pattern_print', '')) as pattern,
        COUNT(*)::bigint as count
      FROM "Product" p
      WHERE p."merchantId" = ${merchantId}
        AND p."isActive" = true
        AND (
          p.attributes->>'Pattern' IS NOT NULL
          OR p.attributes->>'pattern_print' IS NOT NULL
        )
      GROUP BY LOWER(COALESCE(p.attributes->>'Pattern', p.attributes->>'pattern_print', ''))
      ORDER BY count DESC
      LIMIT 20
    `;
    
    console.log('📋 Pattern Values in Database (top 20):\n');
    patternValues.forEach(({ pattern, count }) => {
      if (pattern) {
        console.log(`   "${pattern}": ${Number(count)} products`);
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await prisma.$disconnect();
  }
}

checkFloralProducts();
