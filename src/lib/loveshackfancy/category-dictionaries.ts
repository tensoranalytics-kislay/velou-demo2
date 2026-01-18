/**
 * Category Dictionary Loader
 * 
 * Loads category and subcategory dictionaries from the database
 * Only includes categories with 3+ products (excluding small categories)
 */

import categoryDictionariesJson from './category-dictionaries.json';

export type CategoryDictionary = {
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

let dictionaries: CategoryDictionary | null = null;

/**
 * Load category dictionaries from JSON file
 */
export function loadCategoryDictionaries(): CategoryDictionary {
  if (!dictionaries) {
    dictionaries = categoryDictionariesJson as CategoryDictionary;
  }
  return dictionaries;
}

/**
 * Get all categories from dictionary
 */
export function getCategories(): string[] {
  const dict = loadCategoryDictionaries();
  return dict.categories;
}

/**
 * Get subcategories for a specific category
 */
export function getSubcategoriesForCategory(category: string): string[] {
  const dict = loadCategoryDictionaries();
  return dict.subcategories[category] || [];
}

/**
 * Get product count for a category
 */
export function getCategoryProductCount(category: string): number {
  const dict = loadCategoryDictionaries();
  return dict.categoryProductCounts[category] || 0;
}

/**
 * Get product count for a subcategory
 */
export function getSubcategoryProductCount(category: string, subcategory: string): number {
  const dict = loadCategoryDictionaries();
  return dict.subcategoryProductCounts[category]?.[subcategory] || 0;
}

/**
 * Format categories with subcategories for LLM prompt
 */
export function formatCategoriesForPrompt(categories: string[]): string {
  const dict = loadCategoryDictionaries();
  const lines: string[] = [];
  
  for (const category of categories) {
    const productCount = getCategoryProductCount(category);
    const subs = getSubcategoriesForCategory(category);
    
    if (subs.length > 0) {
      lines.push(`- "${category}" (${productCount} products, subcategories: ${subs.join(', ')})`);
    } else {
      lines.push(`- "${category}" (${productCount} products)`);
    }
  }
  
  return lines.join('\n');
}
