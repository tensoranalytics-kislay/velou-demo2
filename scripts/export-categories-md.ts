import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  console.log('📊 Exporting Categories to Markdown...\n');
  
  // Get all categories with product counts
  const categories = await prisma.product.groupBy({
    by: ['category', 'subcategory'],
    where: { isActive: true },
    _count: { id: true },
  });

  // Sort by product count (descending)
  const sortedCategories = categories.sort((a, b) => b._count.id - a._count.id);

  // Group by category
  const categoryMap = new Map<string, Array<{ subcategory: string | null; count: number }>>();
  
  for (const item of sortedCategories) {
    const cat = item.category || '(null)';
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat)!.push({
      subcategory: item.subcategory,
      count: item._count.id,
    });
  }

  // Calculate totals per category
  const categoryTotals = new Map<string, number>();
  for (const [cat, items] of categoryMap.entries()) {
    const total = items.reduce((sum, item) => sum + item.count, 0);
    categoryTotals.set(cat, total);
  }

  // Sort categories by total count
  const sortedCategoryNames = Array.from(categoryMap.keys()).sort((a, b) => {
    return (categoryTotals.get(b) || 0) - (categoryTotals.get(a) || 0);
  });

  // Generate markdown
  let markdown = '# Product Categories\n\n';
  markdown += `**Generated:** ${new Date().toISOString().split('T')[0]}\n\n`;
  markdown += `**Total Categories:** ${sortedCategoryNames.length}\n`;
  markdown += `**Total Products:** ${sortedCategories.reduce((sum, c) => sum + c._count.id, 0)}\n\n`;
  markdown += '---\n\n';

  // Write categories
  for (const category of sortedCategoryNames) {
    const items = categoryMap.get(category)!;
    const total = categoryTotals.get(category)!;
    const subcategories = items.filter(i => i.subcategory);
    const hasSubcategories = subcategories.length > 0;

    markdown += `## ${category}\n\n`;
    markdown += `**Total Products:** ${total}\n\n`;

    if (hasSubcategories) {
      markdown += '### Subcategories:\n\n';
      markdown += '| Subcategory | Products |\n';
      markdown += '|-------------|----------|\n';
      
      // Sort subcategories by count
      const sortedSubs = subcategories.sort((a, b) => b.count - a.count);
      for (const sub of sortedSubs) {
        markdown += `| ${sub.subcategory || 'None'} | ${sub.count} |\n`;
      }
      
      // Show products without subcategories if any
      const noSub = items.find(i => !i.subcategory);
      if (noSub) {
        markdown += `| None | ${noSub.count} |\n`;
      }
      
      markdown += '\n';
    } else {
      markdown += '*No subcategories*\n\n';
    }

    markdown += '---\n\n';
  }

  // Summary statistics
  markdown += '## Summary Statistics\n\n';
  
  const mens = sortedCategoryNames.filter(c => c.startsWith('Mens-'));
  const womens = sortedCategoryNames.filter(c => c.startsWith('Womens-') || c.includes("Women's"));
  const girls = sortedCategoryNames.filter(c => c.startsWith('Girls') || c.includes('Girls'));
  const kids = sortedCategoryNames.filter(c => c.includes('Tween') || c.includes('Baby'));
  
  markdown += '### Category Distribution\n\n';
  markdown += `- **Men's (Mens-*):** ${mens.length} categories\n`;
  markdown += `- **Women's (Womens-*):** ${womens.length} categories\n`;
  markdown += `- **Girls:** ${girls.length} categories\n`;
  markdown += `- **Kids/Baby:** ${kids.length} categories\n`;
  markdown += `- **Other/Unisex:** ${sortedCategoryNames.length - mens.length - womens.length - girls.length - kids.length} categories\n\n`;

  // Top 10 categories
  markdown += '### Top 10 Categories by Product Count\n\n';
  markdown += '| Rank | Category | Products |\n';
  markdown += '|------|----------|----------|\n';
  sortedCategoryNames.slice(0, 10).forEach((cat, i) => {
    markdown += `| ${i + 1} | ${cat} | ${categoryTotals.get(cat)} |\n`;
  });

  // Write file
  const outputPath = join(process.cwd(), 'CATEGORIES.md');
  writeFileSync(outputPath, markdown, 'utf-8');
  
  console.log(`✅ Categories exported to: ${outputPath}`);
  console.log(`   Total categories: ${sortedCategoryNames.length}`);
  console.log(`   Total products: ${sortedCategories.reduce((sum, c) => sum + c._count.id, 0)}\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
