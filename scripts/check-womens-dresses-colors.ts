import { prisma } from '../src/lib/db';

async function main() {
  console.log('🔍 Checking Colors for "Women\'s Dresses" Category\n');
  console.log('─'.repeat(70) + '\n');

  await prisma.$connect();

  // Get all active products in Women's Dresses category
  const products = await prisma.product.findMany({
    where: {
      category: "Women's Dresses",
      isActive: true,
    },
    select: {
      id: true,
      enrichedColor: true,
      color: true,
    },
  });

  console.log(`📦 Total Products: ${products.length}\n`);

  // Extract all unique colors
  const colorSet = new Set<string>();
  const colorFrequency = new Map<string, number>();

  for (const product of products) {
    // Parse enrichedColor (comma-separated)
    if (product.enrichedColor) {
      const colors = product.enrichedColor.split(',').map(c => c.trim()).filter(Boolean);
      for (const c of colors) {
        const normalized = c.trim().toLowerCase();
        if (normalized) {
          colorSet.add(normalized);
          colorFrequency.set(normalized, (colorFrequency.get(normalized) || 0) + 1);
        }
      }
    }
    
    // Parse color column (fallback)
    if (product.color) {
      const normalized = product.color.trim().toLowerCase();
      if (normalized) {
        colorSet.add(normalized);
        colorFrequency.set(normalized, (colorFrequency.get(normalized) || 0) + 1);
      }
    }
  }

  const sortedColors = Array.from(colorFrequency.entries())
    .sort((a, b) => b[1] - a[1]);

  console.log(`🎨 Total Unique Colors: ${colorSet.size}\n`);
  console.log('📊 Color Distribution (Top 20):\n');
  
  sortedColors.slice(0, 20).forEach(([color, count], index) => {
    const percentage = ((count / products.length) * 100).toFixed(1);
    console.log(`   ${(index + 1).toString().padStart(2)}. ${color.padEnd(25)} ${count.toString().padStart(4)} products (${percentage}%)`);
  });

  if (sortedColors.length > 20) {
    console.log(`   ... and ${sortedColors.length - 20} more colors\n`);
  } else {
    console.log();
  }

  console.log('─'.repeat(70) + '\n');
  console.log('📈 Comparison:\n');
  console.log(`   Global dictionary: 582 colors`);
  console.log(`   Women's Dresses:   ${colorSet.size} colors`);
  console.log(`   Reduction:         ${((1 - colorSet.size / 582) * 100).toFixed(1)}% fewer colors\n`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
