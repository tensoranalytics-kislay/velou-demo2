import { prisma } from '../src/lib/db';

async function main() {
  console.log('📊 Category Count After Normalization\n');
  
  // Total unique categories
  const uniqueCategories = await prisma.product.groupBy({
    by: ['category'],
    where: { isActive: true },
    _count: { id: true },
  });

  console.log(`✅ Total unique categories: ${uniqueCategories.length}\n`);

  // Top 20 categories by product count
  const topCategories = uniqueCategories
    .sort((a, b) => b._count.id - a._count.id)
    .slice(0, 20);

  console.log('📈 Top 20 Categories by Product Count:\n');
  topCategories.forEach((cat, i) => {
    console.log(`   ${(i + 1).toString().padStart(2)}. ${cat.category?.padEnd(35) || '(null)'} - ${cat._count.id} products`);
  });

  // Categories with subcategories
  const withSubcategory = await prisma.product.count({
    where: {
      isActive: true,
      subcategory: { not: null },
    },
  });

  const totalProducts = await prisma.product.count({
    where: { isActive: true },
  });

  console.log(`\n📋 Products with subcategories: ${withSubcategory}`);
  console.log(`📦 Total active products: ${totalProducts}`);
  
  // Distribution
  const mens = uniqueCategories.filter(c => c.category?.startsWith('Mens-'));
  const womens = uniqueCategories.filter(c => c.category?.startsWith('Womens-') || c.category?.includes("Women's"));
  const girls = uniqueCategories.filter(c => c.category?.startsWith('Girls') || c.category?.includes('Girls'));
  const kids = uniqueCategories.filter(c => c.category?.includes('Tween') || c.category?.includes('Baby'));

  console.log(`\n📊 Category Distribution:\n`);
  console.log(`   Men's (Mens-*):     ${mens.length} categories`);
  console.log(`   Women's (Womens-*): ${womens.length} categories`);
  console.log(`   Girls:              ${girls.length} categories`);
  console.log(`   Kids/Baby:          ${kids.length} categories`);
  console.log(`   Other/Unisex:       ${uniqueCategories.length - mens.length - womens.length - girls.length - kids.length} categories`);
  
  console.log(`\n✅ Normalization Results:`);
  console.log(`   Before: ~2,854 unique categories`);
  console.log(`   After:  ${uniqueCategories.length} unique categories`);
  console.log(`   Reduction: ~${Math.round((1 - uniqueCategories.length / 2854) * 100)}%`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
