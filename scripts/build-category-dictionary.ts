#!/usr/bin/env tsx

/**
 * Build Category Dictionary from Normalized Categories
 * 
 * Creates a dictionary of all unique normalized categories and subcategories
 * for use in LLM constraint extraction.
 */

import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_FILE = join(process.cwd(), 'src/lib/loveshackfancy/category-dictionary.json');

interface CategoryDictionary {
  categories: string[];
  subcategories: string[];
  categorySubcategoryMap: Record<string, string[]>;
  extractedAt: string;
  totalProducts: number;
}

async function buildCategoryDictionary(): Promise<CategoryDictionary> {
  console.log('📚 Building category dictionary from normalized categories...\n');

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      category: true,
      subcategory: true,
    },
  });

  console.log(`   Loaded ${products.length} products\n`);

  const categories = new Set<string>();
  const subcategories = new Set<string>();
  const categorySubcategoryMap: Record<string, Set<string>> = {};

  for (const product of products) {
    if (product.category) {
      categories.add(product.category.trim());
      
      if (product.subcategory) {
        const sub = product.subcategory.trim();
        subcategories.add(sub);
        
        if (!categorySubcategoryMap[product.category]) {
          categorySubcategoryMap[product.category] = new Set<string>();
        }
        categorySubcategoryMap[product.category].add(sub);
      }
    }
  }

  // Convert Sets to sorted arrays
  const categoryArray = Array.from(categories).sort();
  const subcategoryArray = Array.from(subcategories).sort();
  const categorySubcategoryMapArray: Record<string, string[]> = {};
  
  for (const [category, subs] of Object.entries(categorySubcategoryMap)) {
    categorySubcategoryMapArray[category] = Array.from(subs).sort();
  }

  return {
    categories: categoryArray,
    subcategories: subcategoryArray,
    categorySubcategoryMap: categorySubcategoryMapArray,
    extractedAt: new Date().toISOString(),
    totalProducts: products.length,
  };
}

async function main() {
  console.log('🎯 Build Category Dictionary\n');

  try {
    const dictionary = await buildCategoryDictionary();

    console.log('✅ Category dictionary extracted:\n');
    console.log(`   Total categories: ${dictionary.categories.length}`);
    console.log(`   Total subcategories: ${dictionary.subcategories.length}`);
    console.log(`   Categories with subcategories: ${Object.keys(dictionary.categorySubcategoryMap).length}\n`);

    // Show top categories
    console.log('📋 Sample Categories (first 20):\n');
    dictionary.categories.slice(0, 20).forEach((cat, i) => {
      const subs = dictionary.categorySubcategoryMap[cat] || [];
      console.log(`   ${(i + 1).toString().padStart(2)}. ${cat}${subs.length > 0 ? ` (${subs.length} subcategories)` : ''}`);
    });

    // Show categories with most subcategories
    const categoriesWithSubs = Object.entries(dictionary.categorySubcategoryMap)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    if (categoriesWithSubs.length > 0) {
      console.log('\n📋 Categories with Most Subcategories:\n');
      categoriesWithSubs.forEach(([cat, subs], i) => {
        console.log(`   ${(i + 1).toString().padStart(2)}. ${cat}: ${subs.slice(0, 5).join(', ')}${subs.length > 5 ? ` (+${subs.length - 5} more)` : ''}`);
      });
    }

    writeFileSync(OUTPUT_FILE, JSON.stringify(dictionary, null, 2));
    console.log(`\n💾 Saved to: ${OUTPUT_FILE}\n`);

    console.log('✅ Category dictionary built successfully!\n');
  } catch (error) {
    console.error('\n❌ Failed to build category dictionary:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
