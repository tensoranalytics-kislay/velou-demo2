import { prisma } from '../src/lib/db';
import { deduplicateProductsByCategory } from '../src/lib/search/vector/index';

async function testRedDressSearch() {
  try {
    const merchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!merchant) {
      console.error('Default merchant not found');
      process.exit(1);
    }

    console.log('Testing red dress search with updated color filter...\n');

    // Test the deduplicateProductsByCategory function with red color filter
    const productIds = await deduplicateProductsByCategory(
      {
        inStockOnly: true,
        merchantId: merchant.id,
        categories: ["Women's Dresses"],
        colors: ['Red'],
      },
      1500,
      undefined,
      false // Don't skip color filter
    );

    console.log(`Found ${productIds.length} red dresses with color filter:`);
    
    if (productIds.length > 0) {
      // Get details of first 5 products
      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds.slice(0, 5) },
        },
        select: {
          id: true,
          title: true,
          category: true,
          attributes: true,
        },
      });

      products.forEach((product, idx) => {
        const variantColors = (product.attributes as any)?.variant_colors || [];
        const enrichedColor = (product.attributes as any)?.enriched_color || 'N/A';
        console.log(`${idx + 1}. ${product.title}`);
        console.log(`   Category: ${product.category}`);
        console.log(`   Variant Colors: ${JSON.stringify(variantColors)}`);
        console.log(`   Enriched Color: ${enrichedColor}`);
        console.log('');
      });
    } else {
      console.log('No red dresses found!');
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testRedDressSearch();


