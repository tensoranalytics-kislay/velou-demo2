#!/usr/bin/env tsx

/**
 * Show before/after category comparison with sample products
 */

import { prisma } from './src/lib/db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface CategoryMapping {
  original: string;
  normalized: {
    category: string;
    subcategory: string | null;
  };
  productCount: number;
  sampleProducts: string[];
  verified: boolean;
  reasoning?: string;
}

(async () => {
  const mappingFile = join(process.cwd(), 'category-normalization-mapping.json');
  if (!existsSync(mappingFile)) {
    console.log('❌ No mapping file found. Run normalization first.');
    process.exit(1);
  }

  const mappings: CategoryMapping[] = JSON.parse(readFileSync(mappingFile, 'utf-8'));
  
  if (mappings.length === 0) {
    console.log('⚠️  Mapping file is empty. Normalization may not have completed successfully.');
    process.exit(1);
  }

  console.log('📊 Category Normalization - Before/After Comparison\n');
  console.log(`Total mappings: ${mappings.length}\n`);
  console.log('=' .repeat(80) + '\n');

  // Show first 15 mappings with sample products
  const sampleMappings = mappings.slice(0, 15);
  
  for (const mapping of sampleMappings) {
    console.log(`📦 "${mapping.original}"`);
    console.log(`   → "${mapping.normalized.category}"`);
    if (mapping.normalized.subcategory) {
      console.log(`   Subcategory: "${mapping.normalized.subcategory}"`);
    }
    if (mapping.reasoning) {
      console.log(`   Reasoning: ${mapping.reasoning}`);
    }
    console.log(`   Products: ${mapping.productCount}`);
    console.log(`   Verified: ${mapping.verified ? '✅' : '❌'}\n`);

    // Show sample products from BEFORE (original category)
    const beforeProducts = await prisma.product.findMany({
      where: {
        category: mapping.original,
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        category: true,
        subcategory: true,
        gender: true,
        ageGroup: true,
      },
      take: 5,
      orderBy: { id: 'asc' },
    });

    console.log('   Sample Products (BEFORE):');
    beforeProducts.forEach((p, i) => {
      const title = p.title.length > 60 ? p.title.substring(0, 57) + '...' : p.title;
      console.log(`     ${i + 1}. ${title}`);
      console.log(`        Category: "${p.category}" | Gender: ${p.gender || 'null'} | Age: ${p.ageGroup?.substring(0, 40) || 'null'}`);
    });
    
    // If category was normalized, check if products with new category exist
    if (mapping.original !== mapping.normalized.category) {
      const afterProducts = await prisma.product.findMany({
        where: {
          category: mapping.normalized.category,
          isActive: true,
        },
        select: {
          id: true,
          title: true,
          category: true,
          subcategory: true,
        },
        take: 3,
      });
      
      if (afterProducts.length > 0) {
        console.log(`\n   Sample Products (AFTER - from "${mapping.normalized.category}"):`);
        afterProducts.forEach((p, i) => {
          const title = p.title.length > 60 ? p.title.substring(0, 57) + '...' : p.title;
          console.log(`     ${i + 1}. ${title}`);
          console.log(`        Category: "${p.category}"`);
        });
      }
    }
    
    console.log('\n' + '-'.repeat(80) + '\n');
  }

  // Summary statistics
  console.log('\n📈 Summary Statistics:\n');
  const verifiedCount = mappings.filter(m => m.verified).length;
  const unverifiedCount = mappings.length - verifiedCount;
  
  const uniqueBefore = new Set(mappings.map(m => m.original)).size;
  const uniqueAfter = new Set(mappings.map(m => m.normalized.category)).size;
  
  console.log(`   Total categories processed: ${mappings.length}`);
  console.log(`   Unique categories before: ${uniqueBefore}`);
  console.log(`   Unique categories after: ${uniqueAfter}`);
  console.log(`   Categories normalized: ${mappings.filter(m => m.original !== m.normalized.category).length}`);
  console.log(`   Verified mappings: ${verifiedCount}`);
  console.log(`   Unverified mappings: ${unverifiedCount}\n`);

  // Show category reduction
  const categoryReduction = ((uniqueBefore - uniqueAfter) / uniqueBefore * 100).toFixed(1);
  console.log(`   Category reduction: ${uniqueBefore} → ${uniqueAfter} (${categoryReduction}% reduction)\n`);

  await prisma.$disconnect();
})();
