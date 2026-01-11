import { prisma } from '../src/lib/db';

async function checkProductStructure() {
  try {
    const merchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!merchant) {
      console.error('Default merchant not found');
      process.exit(1);
    }

    // Get a red dress product
    const products = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      category: string;
      attributes: any;
      stockStatus: string;
    }>>(
      `SELECT id, title, category, attributes, "stockStatus"
       FROM "Product"
       WHERE "isActive" = true
         AND "merchantId" = $1
         AND LOWER(title) LIKE '%red%'
         AND LOWER(category) LIKE '%dress%'
       LIMIT 3`,
      merchant.id
    );

    console.log(`Found ${products.length} red dresses:\n`);
    
    products.forEach((product, idx) => {
      console.log(`Product ${idx + 1}:`);
      console.log(`  Title: ${product.title}`);
      console.log(`  Category: ${product.category}`);
      console.log(`  Stock: ${product.stockStatus}`);
      console.log(`  Attributes:`, JSON.stringify(product.attributes, null, 2));
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkProductStructure();


