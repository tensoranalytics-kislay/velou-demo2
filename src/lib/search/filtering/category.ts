/**
 * Category Matching
 * 
 * Handles category and subcategory matching logic.
 * Supports both exact matching and broader matching (substring, canonical categories).
 * 
 * This module is primarily used by the query building layer to construct
 * category filters for database queries.
 */

import { CATEGORY_TREE, type CategoryTree } from '../../catalog/category-tree';
import { logger } from '../../telemetry/logger';

/**
 * Check if a product's category matches the constraint
 * 
 * Supports:
 * - Exact match
 * - Substring match (case-insensitive)
 * - Subcategory matching
 * 
 * @param productCategory - Product's category
 * @param productSubcategory - Product's subcategory (optional)
 * @param constraintCategory - Category constraint to match
 * @returns true if product matches category constraint
 */
export function matchCategory(
  productCategory: string,
  productSubcategory: string | null | undefined,
  constraintCategory: string | string[] | undefined,
): boolean {
  if (!constraintCategory) return true; // No constraint = match all

  const categories = Array.isArray(constraintCategory) ? constraintCategory : [constraintCategory];
  const productCatLower = productCategory.toLowerCase();
  const productSubcatLower = productSubcategory?.toLowerCase() || '';

  return categories.some((cat) => {
    const catLower = cat.toLowerCase();
    // Exact match
    if (productCatLower === catLower || productSubcatLower === catLower) return true;
    // Substring match
    if (productCatLower.includes(catLower) || catLower.includes(productCatLower)) return true;
    if (productSubcatLower.includes(catLower) || catLower.includes(productSubcatLower)) return true;
    return false;
  });
}

/**
 * Hand-tuned synonym / sibling groups for overlapping categories that
 * effectively contain the same type of products (tees, jeans, etc.).
 *
 * These groups are used in `expandCategoriesForOptimalCoverage` so that when
 * the classifier chooses *one* category (e.g. "Womens-tees") we search across
 * all closely-related categories in the same group (e.g. "Tops", "t-shirt").
 *
 * NOTE:
 * - Gender and age-group are still enforced via separate filters, so mixing
 *   mens/womens variants in the same group is safe.
 * - These groups were derived from inspecting the catalog counts and
 *   category names (Mott & Bow + LSF), focusing on the highest-volume
 *   overlapping apparel categories.
 */
const CATEGORY_SYNONYM_GROUPS: string[][] = [
  // Tees / tops across brands and taxonomies
  [
    'Womens-tees',
    'Mens-tees',
    'Tops',
    'Girls Tops',
    't-shirt',
    't-shirts',
    "men's t-shirts",
    'basic tees',
    'crew neck',
    'crew neck t-shirts',
    'fitted t-shirts',
    'graphic tee',
    'polo shirts',
    'shirt',
    'tank top',
    'top',
    'tops',
  ],
  // Jeans across mens/womens and specific jean cuts
  [
    'Mens-jeans',
    'Womens-jeans',
    'jeans',
    "men's jeans",
    "women's jeans",
    'skinny jeans',
    'cropped jeans',
    'mom jeans',
    'straight jeans',
    'straight leg jeans',
    'wide leg jeans',
  ],
];

function findSynonymGroup(category: string): string[] | null {
  const lower = category.toLowerCase();
  for (const group of CATEGORY_SYNONYM_GROUPS) {
    if (group.some((name) => name.toLowerCase() === lower)) {
      return group;
    }
  }
  return null;
}

/**
 * Expands category names to maximize product coverage by:
 * 1. Handling singular/plural variations (e.g., "Maxi Dress" → also check "Maxi Dresses" subcategory)
 * 2. Expanding parent categories to include all subcategories (when appropriate)
 * 3. Using CATEGORY_TREE to find related categories and subcategories
 * 
 * This function intelligently expands categories to ensure maximum product coverage.
 * For example, if the classifier returns "Maxi Dress" (a standalone category with few products),
 * it will also include "Women's Dresses" (which has "Maxi Dresses" as a subcategory with more products).
 * 
 * @param categories - Array of category names from classifier
 * @returns Expanded array of categories to search for
 * 
 * @example
 * ```typescript
 * // Input: ["Maxi Dress"]
 * // Output: ["Maxi Dress", "Women's Dresses"]
 * // Reason: "Maxi Dresses" exists as a subcategory under "Women's Dresses"
 * 
 * // Input: ["Women's Dresses"]
 * // Output: ["Women's Dresses"]
 * // Reason: Parent category already covers all subcategories via SQL LIKE pattern
 * 
 * // Input: ["Mini Dress"]
 * // Output: ["Mini Dress", "Women's Dresses"]
 * // Reason: "Mini Dresses" exists as a subcategory under "Women's Dresses"
 * ```
 */
export function expandCategoriesForOptimalCoverage(
  categories: string[]
): string[] {
  if (!categories || categories.length === 0) {
    return [];
  }

  const expanded = new Set<string>();
  
  // Common singular/plural patterns for dress types and other categories
  const singularToPluralMap: Record<string, { parent: string; plural: string }> = {
    'Maxi Dress': { parent: "Women's Dresses", plural: 'Maxi Dresses' },
    'Mini Dress': { parent: "Women's Dresses", plural: 'Mini Dresses' },
    'Midi Dress': { parent: "Women's Dresses", plural: 'Midi Dresses' },
  };
  
  // Check if both a specific dress type AND its parent category are present
  // If so, remove the parent to avoid overly broad matching
  // Example: ["Maxi Dress", "Women's Dresses"] → ["Maxi Dress"] only
  const categoriesLower = categories.map(c => c.toLowerCase());
  const hasSpecificDressType = categoriesLower.some(cat => 
    cat.includes('maxi dress') || cat.includes('mini dress') || cat.includes('midi dress')
  );
  const hasWomensDresses = categoriesLower.includes("women's dresses");
  
  // Filter categories: remove "Women's Dresses" if a specific dress type is present
  let categoriesToProcess = categories;
  if (hasSpecificDressType && hasWomensDresses) {
    // Remove "Women's Dresses" if we have a specific dress type
    // The specific dress type will catch both standalone and subcategory products via SQL filter
    categoriesToProcess = categories.filter(cat => cat.toLowerCase() !== "women's dresses");
    logger.debug('category_expansion_removing_broad_parent', {
      originalCategories: categories,
      filteredCategories: categoriesToProcess,
      reason: 'specific_dress_type_present_so_removing_broad_parent_to_avoid_incorrect_matches',
      note: 'SQL filter on specific dress type will catch both standalone category and subcategory products',
    });
  }

  // Build reverse map: plural subcategory → parent category (for lookup only)
  const pluralToParentMap: Map<string, string> = new Map();
  for (const [singular, { parent, plural }] of Object.entries(singularToPluralMap)) {
    pluralToParentMap.set(plural.toLowerCase(), parent);
  }

  // Iterate through CATEGORY_TREE to find all parent-child relationships
  // This builds a map of subcategory name → parent category for all categories in the tree
  const subcategoryToParentMap: Map<string, string> = new Map();
  for (const [parentCategory, { subcategories }] of Object.entries(CATEGORY_TREE)) {
    for (const subcategory of subcategories) {
      const subcatLower = subcategory.toLowerCase();
      // If multiple parents have the same subcategory name, keep the first one found
      // In practice, subcategory names should be unique within parent categories
      if (!subcategoryToParentMap.has(subcatLower)) {
        subcategoryToParentMap.set(subcatLower, parentCategory);
      }
    }
  }

  // Process each category (using filtered list if "Women's Dresses" was removed)
  for (const category of categoriesToProcess) {
    expanded.add(category); // Always include the original category

    // First, expand via synonym/sibling groups for overlapping categories.
    // Example: "Womens-tees" → also include "Tops", "t-shirt", etc.
    const synonymGroup = findSynonymGroup(category);
    if (synonymGroup) {
      for (const related of synonymGroup) {
        expanded.add(related);
      }
      logger.debug('category_expansion_synonym_group', {
        originalCategory: category,
        expandedCategories: synonymGroup,
        reason: 'overlapping_apparel_categories_share_similar_products',
      });
    }
    
    const categoryLower = category.toLowerCase();

    // Case 1: For specific dress types (Maxi Dress, Mini Dress, Midi Dress), DO NOT expand to parent
    // The SQL filter already checks both category AND subcategory fields individually:
    // - category = "Maxi Dress" OR subcategory = "Maxi Dresses" 
    // This will naturally catch products with category="Women's Dresses" AND subcategory="Maxi Dresses"
    // Expanding to "Women's Dresses" would incorrectly include products with subcategory="Mini Dresses"
    // Example: "Maxi Dress" should NOT expand to "Women's Dresses" because that would match mini dresses too
    if (singularToPluralMap[category]) {
      // DO NOT expand specific dress types to parent category - SQL subcategory check handles this
      logger.debug('category_expansion_skipped_specific_dress_type', {
        originalCategory: category,
        reason: 'specific_dress_types_should_not_expand_to_parent_to_avoid_broad_matching',
        note: 'SQL filter already checks both category and subcategory fields individually',
      });
      // Still check for plural variations in subcategories (handled in Case 4 below)
      // Don't continue here - let it fall through to Case 4 to handle plural variations
    }    // Case 2: Check if this category is a subcategory name
    // CRITICAL: For specific dress subcategories (Maxi Dresses, Mini Dresses, Midi Dresses),
    // DO NOT expand to parent "Women's Dresses" because that would be too broad and match other subcategories
    // The SQL filter already checks subcategory field, so products with category="Women's Dresses" AND subcategory="Maxi Dresses"
    // will be caught via the subcategory check without needing to expand to the parent
    const parentCategory = subcategoryToParentMap.get(categoryLower);
    if (parentCategory) {
      // Check if this is a specific dress subcategory that should NOT expand to parent
      const isSpecificDressSubcategory = categoryLower.includes('maxi dress') || 
                                         categoryLower.includes('mini dress') || 
                                         categoryLower.includes('midi dress');
      
      if (isSpecificDressSubcategory) {
        // DO NOT expand specific dress subcategories to parent
        logger.debug('category_expansion_skipped_specific_dress_subcategory', {
          originalCategory: category,
          parentCategory,
          reason: 'specific_dress_subcategories_should_not_expand_to_parent_to_avoid_broad_matching',
          note: 'SQL filter already checks subcategory field, so parent expansion not needed',
        });
      } else {
        // For non-dress subcategories, it's safe to expand to parent (e.g., "Sports Bra" → "Activewear")
        expanded.add(parentCategory);
        logger.debug('category_expansion_subcategory_to_parent', {
          originalCategory: category,
          expandedCategory: parentCategory,
          reason: 'subcategory_expands_to_parent_non_dress_category',
        });
        continue;
      }
    }

    // Case 3: Check if this category is a parent that contains subcategories matching plural patterns
    // Example: "Women's Dresses" already covers "Maxi Dresses" via SQL LIKE, so no expansion needed
    // But we should check if any of its subcategories match singular patterns from other input categories
    if (CATEGORY_TREE[category]) {
      const { subcategories: subs } = CATEGORY_TREE[category];
      // If this parent category has subcategories, the SQL LIKE pattern will naturally match them
      // No additional expansion needed, but log for debugging
      logger.debug('category_expansion_parent_with_subcategories', {
        originalCategory: category,
        subcategoryCount: subs.length,
        reason: 'parent_category_naturally_covers_subcategories_via_sql',
      });
      continue;
    }

    // Case 4: Check for plural variations in subcategories
    // CRITICAL: For specific dress types (Maxi, Mini, Midi), DO NOT expand to parent category
    // The SQL filter uses LIKE patterns that will naturally match plural variations:
    // - category LIKE "%Maxi Dress%" matches both "Maxi Dress" and "Maxi Dresses"  
    // - subcategory LIKE "%Maxi Dress%" matches subcategory="Maxi Dresses" (plural)
    // Expanding to "Women's Dresses" would incorrectly include products with subcategory="Mini Dresses"
    if (!categoryLower.endsWith('s')) {
      // Category is singular, check if plural form exists as a subcategory
      const pluralVariation = categoryLower + 's'; // Add 's' to get plural
      const parentForPlural = subcategoryToParentMap.get(pluralVariation);
      
      // Check if this is a specific dress type that should NOT expand to parent
      const isSpecificDressType = categoryLower.includes('maxi dress') || 
                                  categoryLower.includes('mini dress') || 
                                  categoryLower.includes('midi dress');
      
      if (parentForPlural && !isSpecificDressType) {
        // Only expand to parent for non-dress categories (e.g., "Sports Bra" → "Activewear")
        expanded.add(parentForPlural);
        logger.debug('category_expansion_plural_variation', {
          originalCategory: category,
          pluralVariation,
          expandedCategory: parentForPlural,
          reason: 'plural_variation_found_in_subcategories_non_dress',
        });
      } else if (parentForPlural && isSpecificDressType) {
        // DO NOT expand specific dress types to parent - SQL LIKE pattern handles plural matching
        logger.debug('category_expansion_skipped_plural_variation_dress_type', {
          originalCategory: category,
          pluralVariation,
          parentCategory: parentForPlural,
          reason: 'specific_dress_types_should_not_expand_to_parent_to_avoid_broad_matching',
          note: 'SQL LIKE pattern will naturally match plural variations in subcategory field',
        });
      }
    }

    // Case 5: Handle singular variations for plural categories
    // If category is "Maxi Dresses" (plural) but "Maxi Dress" (singular) exists as a standalone category
    if (categoryLower.endsWith('s')) {
      const singular = categoryLower.slice(0, -1);
      // Check if this singular form exists as a standalone category in CATEGORY_TREE
      const matchingCategory = Object.keys(CATEGORY_TREE).find(cat => cat.toLowerCase() === singular);
      if (matchingCategory && !expanded.has(matchingCategory)) {
        expanded.add(matchingCategory);
        logger.debug('category_expansion_plural_to_singular', {
          originalCategory: category,
          singularVariation: singular,
          matchingCategory,
          reason: 'plural_category_expands_to_singular_standalone',
        });
      }
    }
  }

  const expandedArray = Array.from(expanded);
  
  logger.debug('category_expansion_complete', {
    inputCategories: categories,
    expandedCategories: expandedArray,
    expansionCount: expandedArray.length - categories.length,
  });

  return expandedArray;
}