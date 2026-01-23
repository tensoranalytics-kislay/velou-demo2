import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
const prisma = new PrismaClient();

async function findAllFalsePositives() {
  const merchantId = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  
  console.log('Fetching all 832 products with set_vs_single = "Set"...');
  
  // Get ALL products with set_vs_single = 'Set'
  const products = await prisma.$queryRaw<Array<{
    id: string;
    title: string;
    category: string;
    set_vs_single: string | null;
    pack_size: string | null;
  }>>`
    SELECT 
      id,
      title,
      category,
      attributes->>'set_vs_single' as "set_vs_single",
      attributes->>'pack_size' as "pack_size"
    FROM "Product"
    WHERE attributes->>'set_vs_single' = 'Set'
      AND "isActive" = true
      AND "merchantId" = ${merchantId}
    ORDER BY category, title
  `;
  
  console.log(`Analyzing ${products.length} products...`);
  
  const falsePositives: Array<{
    id: string;
    title: string;
    category: string;
    pack_size: string | null;
  }> = [];
  
  const verifiedPacks: Array<{
    id: string;
    title: string;
    category: string;
    pack_size: string | null;
  }> = [];
  
  products.forEach((p) => {
    const titleLower = p.title.toLowerCase();
    const hasPackKeyword = titleLower.includes('pack') || 
                          titleLower.includes('bundle') ||
                          titleLower.includes('multi') ||
                          titleLower.includes('pair') ||
                          /\d+-pack/i.test(p.title) ||
                          /\d+-piece/i.test(p.title) ||
                          /\d+-set/i.test(p.title);
    
    // Valid pack_size (not null, not empty, not 'O/S')
    const hasValidPackSize = p.pack_size && 
                            p.pack_size !== '' && 
                            p.pack_size !== 'O/S' &&
                            !isNaN(Number(p.pack_size));
    
    if (hasPackKeyword || hasValidPackSize) {
      verifiedPacks.push({
        id: p.id,
        title: p.title,
        category: p.category,
        pack_size: p.pack_size
      });
    } else {
      falsePositives.push({
        id: p.id,
        title: p.title,
        category: p.category,
        pack_size: p.pack_size
      });
    }
  });
  
  console.log(`✅ Verified Pack Products: ${verifiedPacks.length}`);
  console.log(`❌ False Positives: ${falsePositives.length}`);
  console.log();
  
  // Group false positives by category
  const falsePositivesByCategory: Record<string, Array<typeof falsePositives[0]>> = {};
  falsePositives.forEach(fp => {
    if (!falsePositivesByCategory[fp.category]) {
      falsePositivesByCategory[fp.category] = [];
    }
    falsePositivesByCategory[fp.category].push(fp);
  });
  
  // Create markdown content
  let mdContent = '# False Positive Pack Products\n\n';
  mdContent += '## Summary\n\n';
  mdContent += `- **Total Products with \`set_vs_single = "Set"\`: ${products.length}**\n`;
  mdContent += `- **Verified Pack Products: ${verifiedPacks.length}**\n`;
  mdContent += `- **False Positives: ${falsePositives.length}**\n`;
  mdContent += `- **Accuracy: ${((verifiedPacks.length / products.length) * 100).toFixed(1)}%**\n\n`;
  
  mdContent += '## False Positives by Category\n\n';
  Object.entries(falsePositivesByCategory)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([category, items]) => {
      mdContent += `### ${category} (${items.length} products)\n\n`;
      items.forEach((item, idx) => {
        mdContent += `${idx + 1}. **${item.title}**\n`;
        mdContent += `   - ID: ${item.id}\n`;
        mdContent += `   - pack_size: ${item.pack_size || 'null'}\n`;
        mdContent += `\n`;
      });
      mdContent += '\n';
    });
  
  mdContent += '## All False Positives (Alphabetical)\n\n';
  falsePositives
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach((item, idx) => {
      mdContent += `${idx + 1}. **${item.title}** (${item.category})\n`;
      mdContent += `   - ID: ${item.id}\n`;
      mdContent += `   - pack_size: ${item.pack_size || 'null'}\n`;
      mdContent += `\n`;
    });
  
  // Write to file
  const filename = 'FALSE_POSITIVE_PACK_PRODUCTS.md';
  writeFileSync(filename, mdContent);
  
  console.log(`✅ Created ${filename}`);
  console.log(`   Total false positives: ${falsePositives.length}`);
  console.log(`   Categories affected: ${Object.keys(falsePositivesByCategory).length}`);
  
  await prisma.$disconnect();
}

findAllFalsePositives().catch(console.error);
