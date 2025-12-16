import { prisma } from '../src/lib/db';

async function checkProducts() {
  try {
    const total = await prisma.product.count();
    console.log('Total products:', total);
    
    const handCreams = await prisma.product.findMany({
      where: {
        OR: [
          { category: { contains: 'Hand', mode: 'insensitive' } },
          { subcategory: { contains: 'hand', mode: 'insensitive' } },
          { title: { contains: 'hand', mode: 'insensitive' } },
        ],
        stockStatus: 'in_stock',
      },
      take: 10,
      select: {
        id: true,
        title: true,
        category: true,
        subcategory: true,
        stockStatus: true,
      },
    });
    
    console.log('\nHand cream matches:', handCreams.length);
    handCreams.forEach((p) => {
      console.log(`- ${p.title}`);
      console.log(`  Category: ${p.category}, Subcategory: ${p.subcategory || 'N/A'}`);
    });
    
    // Check unique categories
    const categories = await prisma.product.groupBy({
      by: ['category'],
      _count: true,
      take: 20,
    });
    
    console.log('\nTop categories:');
    categories.forEach((c) => {
      console.log(`- ${c.category || 'NULL'}: ${c._count}`);
    });
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkProducts();






