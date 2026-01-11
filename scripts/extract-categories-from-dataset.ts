/**
 * Extract category tree from database
 * 
 * Queries all products to extract unique categories and subcategories,
 * then builds a category tree structure for use in classification.
 */

import { prisma } from '../src/lib/db.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

type CategoryTree = {
  [category: string]: {
    subcategories: string[];
    paths: string[];
  };
};

async function extractCategoryTree(): Promise<CategoryTree> {
  console.log('Extracting category tree from database...');
  
  // Query all products to get unique category/subcategory combinations
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
    },
    select: {
      category: true,
      subcategory: true,
    },
    distinct: ['category', 'subcategory'],
  });
  
  console.log(`Found ${products.length} unique category/subcategory combinations`);
  
  // Build category tree
  const tree: CategoryTree = {};
  
  for (const product of products) {
    if (!product.category) continue;
    
    const category = product.category;
    
    if (!tree[category]) {
      tree[category] = {
        subcategories: [],
        paths: [],
      };
    }
    
    // Add subcategory if it exists and isn't already in the list
    if (product.subcategory) {
      if (!tree[category].subcategories.includes(product.subcategory)) {
        tree[category].subcategories.push(product.subcategory);
      }
      
      // Build path
      const path = `${category} > ${product.subcategory}`;
      if (!tree[category].paths.includes(path)) {
        tree[category].paths.push(path);
      }
    }
  }
  
  // Sort subcategories alphabetically
  for (const category in tree) {
    tree[category].subcategories.sort();
    tree[category].paths.sort();
  }
  
  console.log(`Extracted ${Object.keys(tree).length} categories`);
  console.log('Categories:', Object.keys(tree).join(', '));
  
  return tree;
}

async function main() {
  try {
    const tree = await extractCategoryTree();
    
    // Generate TypeScript module
    const outputPath = join(process.cwd(), 'src/lib/catalog/category-tree.ts');
    const content = `/**
 * Category Tree
 * 
 * Auto-generated from database. Contains all categories and subcategories
 * present in the current dataset.
 * 
 * Generated: ${new Date().toISOString()}
 */

export type CategoryTree = {
  [category: string]: {
    subcategories: string[];
    paths: string[];
  };
};

export const CATEGORY_TREE: CategoryTree = ${JSON.stringify(tree, null, 2)};

/**
 * Get all categories
 */
export function getAllCategories(): string[] {
  return Object.keys(CATEGORY_TREE);
}

/**
 * Get subcategories for a specific category
 */
export function getSubcategoriesForCategory(category: string): string[] {
  return CATEGORY_TREE[category]?.subcategories || [];
}

/**
 * Check if a category exists in the dataset
 */
export function categoryExists(category: string): boolean {
  return category in CATEGORY_TREE;
}

/**
 * Get all paths for a category
 */
export function getPathsForCategory(category: string): string[] {
  return CATEGORY_TREE[category]?.paths || [];
}

/**
 * Find closest matching category using fuzzy matching
 */
export function findClosestCategory(query: string): string | null {
  const queryLower = query.toLowerCase();
  const categories = getAllCategories();
  
  // Exact match (case-insensitive)
  const exact = categories.find(c => c.toLowerCase() === queryLower);
  if (exact) return exact;
  
  // Contains match
  const contains = categories.find(c => 
    c.toLowerCase().includes(queryLower) || queryLower.includes(c.toLowerCase())
  );
  if (contains) return contains;
  
  // Word match (e.g., "dress" matches "Women's Dresses")
  const words = queryLower.split(/\s+/);
  for (const word of words) {
    if (word.length < 3) continue; // Skip short words
    const wordMatch = categories.find(c => 
      c.toLowerCase().split(/\s+/).some(catWord => catWord.includes(word) || word.includes(catWord))
    );
    if (wordMatch) return wordMatch;
  }
  
  return null;
}
`;
    
    writeFileSync(outputPath, content, 'utf-8');
    console.log(`\nCategory tree written to: ${outputPath}`);
    console.log(`Total categories: ${Object.keys(tree).length}`);
    
    // Print summary
    for (const [category, data] of Object.entries(tree)) {
      console.log(`\n${category}:`);
      console.log(`  Subcategories: ${data.subcategories.length}`);
      if (data.subcategories.length > 0) {
        console.log(`  ${data.subcategories.slice(0, 5).join(', ')}${data.subcategories.length > 5 ? '...' : ''}`);
      }
    }
    
  } catch (error) {
    console.error('Error extracting category tree:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


