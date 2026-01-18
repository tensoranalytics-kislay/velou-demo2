import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkFits() {
  const products = await prisma.product.findMany({
    where: {
      category: { contains: 'Mens-jeans', mode: 'insensitive' },
      gender: { in: ['male', 'unisex'] },
      fit: { not: null }
    },
    select: {
      fit: true
    }
  });

  const fitCounts: Record<string, number> = {};
  products.forEach(p => {
    if (p.fit) {
      const fit = p.fit.toLowerCase().trim();
      fitCounts[fit] = (fitCounts[fit] || 0) + 1;
    }
  });

  console.log('Fit values in Mens-jeans products:');
  Object.entries(fitCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([fit, count]) => {
      console.log(`  ${fit}: ${count}`);
    });
  
  await prisma.$disconnect();
}

checkFits().catch(console.error);
