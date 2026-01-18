import { prisma } from '../src/lib/db';

async function main() {
  console.log('📊 Analyzing Categories with 1-2 Products\n');
  
  // Get all categories with product counts
  const categories = await prisma.product.groupBy({
    by: ['category'],
    where: { isActive: true },
    _count: { id: true },
  });

  // Calculate total per category (combining subcategories)
  const categoryTotals = new Map<string, number>();
  for (const item of categories) {
    const cat = item.category || '(null)';
    const current = categoryTotals.get(cat) || 0;
    categoryTotals.set(cat, current + item._count.id);
  }

  // Filter categories with 1-2 products
  const smallCategories = Array.from(categoryTotals.entries())
    .filter(([_, count]) => count >= 1 && count <= 2)
    .sort((a, b) => b[1] - a[1]); // Sort by count descending

  const oneProduct = smallCategories.filter(([_, count]) => count === 1);
  const twoProducts = smallCategories.filter(([_, count]) => count === 2);

  const totalProductsInSmallCategories = smallCategories.reduce((sum, [_, count]) => sum + count, 0);

  console.log('📈 Results:\n');
  console.log(`   Categories with 1 product:  ${oneProduct.length}`);
  console.log(`   Categories with 2 products: ${twoProducts.length}`);
  console.log(`   Total categories (1-2):     ${smallCategories.length}`);
  console.log(`   Total products in these:    ${totalProductsInSmallCategories}\n`);

  // Show percentage
  const totalCategories = categoryTotals.size;
  const totalProducts = Array.from(categoryTotals.values()).reduce((sum, count) => sum + count, 0);
  
  console.log('📊 Percentages:\n');
  console.log(`   Small categories represent: ${((smallCategories.length / totalCategories) * 100).toFixed(1)}% of all categories`);
  console.log(`   Products in small categories: ${((totalProductsInSmallCategories / totalProducts) * 100).toFixed(1)}% of all products\n`);

  // Show some examples
  if (smallCategories.length > 0) {
    console.log('📋 Sample Categories (first 20):\n');
    smallCategories.slice(0, 20).forEach(([cat, count], i) => {
      const display = cat.length > 70 ? cat.substring(0, 67) + '...' : cat;
      console.log(`   ${(i + 1).toString().padStart(3)}. "${display}" - ${count} product${count > 1 ? 's' : ''}`);
    });
    if (smallCategories.length > 20) {
      console.log(`   ... and ${smallCategories.length - 20} more`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
