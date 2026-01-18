/**
 * Build category and subcategory dictionaries from database
 * Only includes categories with 3+ products (excluding small categories with 1-2 products)
 */

import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';

type CategoryDictionary = {
  categories: string[];
  subcategories: {
    [category: string]: string[];
  };
  categoryProductCounts: {
    [category: string]: number;
  };
  subcategoryProductCounts: {
    [category: string]: {
      [subcategory: string]: number;
    };
  };
  extractedAt: string;
  totalCategories: number;
  totalProducts: number;
};

async function buildCategoryDictionaries(): Promise<CategoryDictionary> {
  console.log('📊 Building Category Dictionaries...\n');
  console.log('   Filtering out categories with 1-2 products\n');

  // Get all categories with product counts
  const categoryGroups = await prisma.product.groupBy({
    by: ['category', 'subcategory'],
    where: { isActive: true },
    _count: { id: true },
  });

  // Calculate totals per category
  const categoryTotals = new Map<string, number>();
  const categorySubcategories = new Map<string, Map<string, number>>();

  for (const group of categoryGroups) {
    const cat = group.category || '(null)';
    const sub = group.subcategory || null;
    const count = group._count.id;

    // Update category total
    const currentTotal = categoryTotals.get(cat) || 0;
    categoryTotals.set(cat, currentTotal + count);

    // Update subcategory map
    if (!categorySubcategories.has(cat)) {
      categorySubcategories.set(cat, new Map());
    }
    const subMap = categorySubcategories.get(cat)!;
    if (sub) {
      const currentSubTotal = subMap.get(sub) || 0;
      subMap.set(sub, currentSubTotal + count);
    }
  }

  // Filter to categories with 3+ products
  const validCategories = Array.from(categoryTotals.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]); // Sort by count descending

  console.log(`   Categories with 3+ products: ${validCategories.length}`);
  console.log(`   Categories excluded (1-2 products): ${categoryTotals.size - validCategories.length}\n`);

  const categories = validCategories.map(([cat]) => cat);
  const categoryProductCounts: Record<string, number> = {};
  for (const [cat, count] of validCategories) {
    categoryProductCounts[cat] = count;
  }

  // Build subcategory dictionaries
  const subcategories: Record<string, string[]> = {};
  const subcategoryProductCounts: Record<string, Record<string, number>> = {};

  for (const category of categories) {
    const subMap = categorySubcategories.get(category);
    if (subMap && subMap.size > 0) {
      const subs = Array.from(subMap.entries())
        .filter(([_, count]) => count >= 1) // Include all subcategories with at least 1 product
        .sort((a, b) => b[1] - a[1]) // Sort by count
        .map(([sub]) => sub);
      
      if (subs.length > 0) {
        subcategories[category] = subs;
        
        // Store counts
        subcategoryProductCounts[category] = {};
        for (const [sub, count] of subMap.entries()) {
          if (subs.includes(sub)) {
            subcategoryProductCounts[category][sub] = count;
          }
        }
      }
    }
  }

  const totalProducts = validCategories.reduce((sum, [_, count]) => sum + count, 0);

  const dictionary: CategoryDictionary = {
    categories,
    subcategories,
    categoryProductCounts,
    subcategoryProductCounts,
    extractedAt: new Date().toISOString(),
    totalCategories: categories.length,
    totalProducts,
  };

  console.log('✅ Category Dictionary Built:\n');
  console.log(`   Categories: ${categories.length}`);
  console.log(`   Categories with subcategories: ${Object.keys(subcategories).length}`);
  console.log(`   Total products covered: ${totalProducts}\n`);

  // Show top 10 categories
  console.log('📈 Top 10 Categories:\n');
  validCategories.slice(0, 10).forEach(([cat, count], i) => {
    const subCount = subcategories[cat]?.length || 0;
    console.log(`   ${(i + 1).toString().padStart(2)}. ${cat.padEnd(40)} ${count} products${subCount > 0 ? ` (${subCount} subcategories)` : ''}`);
  });

  return dictionary;
}

async function main() {
  try {
    const dictionary = await buildCategoryDictionaries();
    
    const outputPath = join(process.cwd(), 'src/lib/loveshackfancy/category-dictionaries.json');
    writeFileSync(outputPath, JSON.stringify(dictionary, null, 2), 'utf-8');
    
    console.log(`\n✅ Dictionary saved to: ${outputPath}\n`);
  } catch (error) {
    console.error('❌ Failed:', error);
    if (error instanceof Error) {
      console.error('   Error:', error.message);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
