import { prisma } from '../src/lib/db';

async function checkProgress() {
  const variantCount = await prisma.productVariant.count();
  const productCount = await prisma.product.count();
  const productsWithVariants = await prisma.product.count({
    where: {
      variants: {
        some: {},
      },
    },
  });
  
  console.log('Migration Progress:');
  console.log(`  Total Products: ${productCount}`);
  console.log(`  Variants Created: ${variantCount}`);
  console.log(`  Products with Variants: ${productsWithVariants}`);
  console.log(`  Average Variants per Product: ${(variantCount / productsWithVariants).toFixed(2)}`);
  
  await prisma.$disconnect();
}

checkProgress().catch(console.error);










