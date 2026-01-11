import { prisma } from '../src/lib/db';

async function checkRedDresses() {
  try {
    // Get default merchant
    const defaultMerchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!defaultMerchant) {
      console.error('Default merchant not found');
      process.exit(1);
    }

    console.log('Checking for red dresses in the database...\n');

    // Query 1: Check dresses with "Red" in color attribute (exact match)
    const redDressesExact = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      category: string;
      color: string | null;
      stockStatus: string;
    }>>(
      `SELECT 
        id,
        title,
        category,
        COALESCE(attributes->>'Color', attributes->>'color', attributes->'extensible'->>'color') as color,
        "stockStatus"
      FROM "Product"
      WHERE "isActive" = true
        AND "merchantId" = $1
        AND (
          LOWER(category) LIKE '%dress%'
        )
        AND (
          LOWER(COALESCE(attributes->>'Color', '')) = 'red'
          OR LOWER(COALESCE(attributes->>'color', '')) = 'red'
          OR LOWER(COALESCE(attributes->'extensible'->>'color', '')) = 'red'
          OR LOWER(COALESCE(attributes->>'Color', '')) LIKE '%red%'
          OR LOWER(COALESCE(attributes->>'color', '')) LIKE '%red%'
          OR LOWER(COALESCE(attributes->'extensible'->>'color', '')) LIKE '%red%'
        )
      LIMIT 20`,
      defaultMerchant.id
    );

    console.log(`Found ${redDressesExact.length} products with "red" in color attribute:`);
    redDressesExact.forEach((product, idx) => {
      console.log(`${idx + 1}. ${product.title}`);
      console.log(`   Category: ${product.category}`);
      console.log(`   Color: ${product.color || 'N/A'}`);
      console.log(`   Stock: ${product.stockStatus}`);
      console.log(`   ID: ${product.id}\n`);
    });

    // Query 2: Check all dresses to see what colors they have
    const allDresses = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      category: string;
      color: string | null;
      stockStatus: string;
    }>>(
      `SELECT 
        id,
        title,
        category,
        COALESCE(attributes->>'Color', attributes->>'color', attributes->'extensible'->>'color') as color,
        "stockStatus"
      FROM "Product"
      WHERE "isActive" = true
        AND "merchantId" = $1
        AND LOWER(category) LIKE '%dress%'
      ORDER BY color
      LIMIT 50`,
      defaultMerchant.id
    );

    console.log(`\n\nSample of all dresses (first 50) to see color distribution:`);
    const colorCounts = new Map<string, number>();
    allDresses.forEach((product) => {
      const color = product.color || 'N/A';
      colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
    });

    console.log('\nColor distribution:');
    Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([color, count]) => {
        console.log(`  ${color}: ${count}`);
      });

    // Query 3: Check if any products have "red" in the title
    const redInTitle = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      category: string;
      color: string | null;
    }>>(
      `SELECT 
        id,
        title,
        category,
        COALESCE(attributes->>'Color', attributes->>'color', attributes->'extensible'->>'color') as color
      FROM "Product"
      WHERE "isActive" = true
        AND "merchantId" = $1
        AND LOWER(category) LIKE '%dress%'
        AND LOWER(title) LIKE '%red%'
      LIMIT 20`,
      defaultMerchant.id
    );

    console.log(`\n\nFound ${redInTitle.length} dresses with "red" in title:`);
    redInTitle.forEach((product, idx) => {
      console.log(`${idx + 1}. ${product.title}`);
      console.log(`   Category: ${product.category}`);
      console.log(`   Color attribute: ${product.color || 'N/A'}\n`);
    });

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total dresses checked: ${allDresses.length}`);
    console.log(`Dresses with "red" in color attribute: ${redDressesExact.length}`);
    console.log(`Dresses with "red" in title: ${redInTitle.length}`);
    console.log(`In-stock red dresses: ${redDressesExact.filter(p => p.stockStatus === 'in_stock').length}`);

  } catch (error) {
    console.error('Error checking red dresses:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkRedDresses();


