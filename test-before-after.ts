import { prisma } from './src/lib/db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

(async () => {
  const mappingFile = join(process.cwd(), 'category-normalization-mapping.json');
  if (!existsSync(mappingFile)) {
    console.log('No mapping file found. Run normalization first.');
    process.exit(1);
  }
  
  const mappings = JSON.parse(readFileSync(mappingFile, 'utf-8'));
  console.log(`📋 Found ${mappings.length} category mappings\n`);
  
  // Show first 10 mappings
  for (const mapping of mappings.slice(0, 10)) {
    console.log(`"${mapping.original}" → "${mapping.normalized.category}"`);
    if (mapping.normalized.subcategory) {
      console.log(`  Subcategory: "${mapping.normalized.subcategory}"`);
    }
    if (mapping.reasoning) {
      console.log(`  Reasoning: ${mapping.reasoning}`);
    }
    
    // Show sample products before
    const beforeProducts = await prisma.product.findMany({
      where: { category: mapping.original, isActive: true },
      select: { id: true, title: true, category: true, gender: true },
      take: 3
    });
    
    console.log(`  Sample products (before):`);
    beforeProducts.forEach((p, i) => {
      console.log(`    ${i+1}. ${p.title.substring(0, 50)}... (Gender: ${p.gender || 'null'})`);
    });
    console.log();
  }
  
  await prisma.$disconnect();
})();
