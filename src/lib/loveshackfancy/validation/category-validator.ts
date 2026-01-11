/**
 * Category Validation Module
 * 
 * Validates products match query's intended category to prevent cross-category contamination.
 * Uses category tree for fuzzy matching and handles multi-category queries.
 */

import { getAllCategories, getSubcategoriesForCategory, findClosestCategory, CATEGORY_TREE } from '../../catalog/category-tree';
import { logger } from '../../telemetry/logger';
import type { SearchResultItem } from '../../search/types';

export type CategoryValidationResult = {
  isValid: boolean;
  confidence: number;
  matchType: 'exact' | 'hierarchical' | 'related' | 'mismatch';
  reason: string;
};

export type ProductCategoryValidation = {
  product: SearchResultItem;
  validation: CategoryValidationResult;
};

/**
 * Extract keywords from a category name for matching
 * e.g., "Women's Dresses" → ["women", "dress", "dresses"]
 */
export function extractCategoryKeywords(category: string): string[] {
  const keywords: string[] = [];
  const lower = category.toLowerCase();
  
  // Split by common separators and extract meaningful words
  const words = lower
    .split(/[\s'&-]+/)
    .filter(w => w.length > 2) // Skip short words like "a", "an", "the"
    .map(w => w.replace(/s$/, '')); // Remove plural 's' for matching
  
  keywords.push(...words);
  
  // Add plural forms for common words
  words.forEach(word => {
    if (!word.endsWith('s')) {
      keywords.push(word + 's');
    }
  });
  
  return [...new Set(keywords)]; // Remove duplicates
}

/**
 * Calculate category similarity score (0-1)
 * Higher score = more similar categories
 */
export function getCategorySimilarity(
  productCategory: string | null | undefined,
  queryCategory: string
): number {
  if (!productCategory) return 0;
  
  const productLower = productCategory.toLowerCase();
  const queryLower = queryCategory.toLowerCase();
  
  // Exact match
  if (productLower === queryLower) return 1.0;
  
  // Contains match - only for proper hierarchical relationships
  // e.g., "Women's Dresses" contains "Dresses", "Girls Tops" contains "Tops"
  // But NOT "Phone Cases" matching "Tops" (no substring overlap)
  // Check if one category is a prefix/suffix of the other (for hierarchical matches)
  // This handles cases like "Tops" → "Girls Tops" or "Dresses" → "Women's Dresses"
  if (productLower.startsWith(queryLower + ' ') || productLower.endsWith(' ' + queryLower) ||
      queryLower.startsWith(productLower + ' ') || queryLower.endsWith(' ' + productLower)) {
    return 0.9;
  }
  
  // Also check if one category name contains the other as a complete word
  // e.g., "Women's Dresses" contains "Dresses" as a word
  const productWords = productLower.split(/\s+/);
  const queryWords = queryLower.split(/\s+/);
  
  // Check if all words from the shorter category appear in the longer category as complete words
  if (productWords.length > 1 || queryWords.length > 1) {
    const shorter = productWords.length <= queryWords.length ? productWords : queryWords;
    const longer = productWords.length > queryWords.length ? productWords : queryWords;
    
    // All words from shorter must appear in longer as complete words (exact match)
    const allWordsMatchAsCompleteWords = shorter.every(word => 
      longer.some(lw => lw === word)
    );
    
    if (allWordsMatchAsCompleteWords && shorter.length > 0) {
      return 0.9;
    }
  }
  
  // Check if product category is a subcategory of query category
  const subcategories = getSubcategoriesForCategory(queryCategory);
  if (subcategories.some(sub => sub.toLowerCase() === productLower)) {
    return 0.85;
  }
  
  // Check if query category is a subcategory of product category
  const productSubcategories = getSubcategoriesForCategory(productCategory);
  if (productSubcategories.some(sub => sub.toLowerCase() === queryLower)) {
    return 0.85;
  }
  
  // Keyword matching
  const productKeywords = extractCategoryKeywords(productCategory);
  const queryKeywords = extractCategoryKeywords(queryCategory);
  
  const matchingKeywords = productKeywords.filter(k => 
    queryKeywords.some(qk => k.includes(qk) || qk.includes(k))
  );
  
  if (matchingKeywords.length > 0) {
    return 0.6 + (matchingKeywords.length / Math.max(productKeywords.length, queryKeywords.length)) * 0.2;
  }
  
  // Check for related categories (same parent or similar vertical)
  // e.g., "Dresses" and "Tops" are both apparel
  const relatedCategories = getRelatedCategories(productCategory, queryCategory);
  if (relatedCategories) {
    return 0.4;
  }
  
  return 0;
}

/**
 * Get the category group (Apparel, Accessories, Home & Living, etc.) for a category
 */
function getCategoryGroup(category: string): string {
  const apparelCategories = [
    "Women's Dresses", "Tops", "Bottoms", "Skirts", "Skorts",
    "Activewear", "Swimsuits", "Bikini Sets", "Swim Cover-ups",
    "Cold Weather Essentials", "Loungewear", "Robes", "Pajama Set",
    "Shoes", "Ski Jackets", "Ski Tops", "Ski Shoes", "Sweaters",
    "Mini Dress", "Maxi Dress", "Tote Bags"
  ];
  
  const kidsCategories = [
    "Girls Tops", "Girls Bottoms", "Girls Dresses", "Girls Swimwear",
    "Baby & Toddler Bottoms", "Tween Pants", "Tween Sweaters", "Tween Dresses"
  ];
  
  const accessoriesCategories = [
    "Accessories", "Jewelry", "Hair Accessories", "Pocket Squares",
    "Phone Cases", "Soap Dispensers", "Makeup Kit"
  ];
  
  const homeCategories = [
    "Bedding", "Bathroom", "Towels", "Tabletop", "Kitchen & Dining",
    "Stationary", "Interiors", "Candle", "Decorative Dishes", "Fragrance Tray", "Pets"
  ];
  
  const personalCareCategories = [
    "Perfumes"
  ];
  
  if (apparelCategories.includes(category) || kidsCategories.includes(category)) {
    return 'Apparel';
  }
  if (accessoriesCategories.includes(category)) {
    return 'Accessories';
  }
  if (homeCategories.includes(category)) {
    return 'Home & Living';
  }
  if (personalCareCategories.includes(category)) {
    return 'Personal Care';
  }
  
  return 'Unknown';
}

/**
 * Check if two categories are related (same parent category or similar vertical)
 */
function getRelatedCategories(
  category1: string,
  category2: string
): boolean {
  // Apparel categories are related
  const apparelCategories = [
    "Women's Dresses", "Tops", "Bottoms", "Skirts", "Skorts",
    "Activewear", "Swimsuits", "Bikini Sets", "Swim Cover-ups",
    "Cold Weather Essentials", "Loungewear", "Robes", "Pajama Set",
    "Shoes", "Ski Jackets", "Ski Tops", "Ski Shoes", "Sweaters",
    "Mini Dress", "Maxi Dress"
  ];
  
  // Kids categories are related
  const kidsCategories = [
    "Girls Tops", "Girls Bottoms", "Girls Dresses", "Girls Swimwear",
    "Baby & Toddler Bottoms", "Tween Pants", "Tween Sweaters", "Tween Dresses"
  ];
  
  // Accessories are related
  const accessoriesCategories = [
    "Accessories", "Jewelry", "Hair Accessories", "Pocket Squares",
    "Phone Cases", "Soap Dispensers", "Makeup Kit", "Tote Bags"
  ];
  
  // Home & Living are related
  const homeCategories = [
    "Bedding", "Bathroom", "Towels", "Tabletop", "Kitchen & Dining",
    "Stationary", "Interiors", "Candle", "Decorative Dishes", "Fragrance Tray"
  ];
  
  const isInGroup = (cat: string, group: string[]) => group.includes(cat);
  
  return (
    (isInGroup(category1, apparelCategories) && isInGroup(category2, apparelCategories)) ||
    (isInGroup(category1, kidsCategories) && isInGroup(category2, kidsCategories)) ||
    (isInGroup(category1, accessoriesCategories) && isInGroup(category2, accessoriesCategories)) ||
    (isInGroup(category1, homeCategories) && isInGroup(category2, homeCategories))
  );
}

/**
 * Detect if product category is a mismatch with query categories
 * Returns true if it's a cross-category contamination (e.g., "Dresses" vs "Towels")
 */
export function isCategoryMismatch(
  productCategory: string | null | undefined,
  queryCategories: string[]
): boolean {
  if (!productCategory || queryCategories.length === 0) return false;
  
  // Check similarity for each query category
  const similarities = queryCategories.map(qCat => 
    getCategorySimilarity(productCategory, qCat)
  );
  
  const maxSimilarity = Math.max(...similarities);
  
  // If similarity is very low (< 0.3), it's a mismatch
  // This catches cross-category contamination (e.g., "Dresses" vs "Towels")
  return maxSimilarity < 0.3;
}

/**
 * Validate if product category matches query's intended category
 */
export function validateProductCategory(
  product: SearchResultItem,
  queryCategories: string[],
  categoryConfidence: number
): CategoryValidationResult {
  const productCategory = product.category;
  
  if (!productCategory) {
    return {
      isValid: false,
      confidence: 0,
      matchType: 'mismatch',
      reason: 'Product has no category',
    };
  }
  
  if (queryCategories.length === 0) {
    // No query categories specified - allow product (vague query)
    return {
      isValid: true,
      confidence: 0.5,
      matchType: 'related',
      reason: 'No query categories specified',
    };
  }
  
  // Check for exact match
  const exactMatch = queryCategories.some(qCat => 
    productCategory.toLowerCase() === qCat.toLowerCase()
  );
  
  if (exactMatch) {
    return {
      isValid: true,
      confidence: 1.0,
      matchType: 'exact',
      reason: `Product category "${productCategory}" exactly matches query category`,
    };
  }
  
  // Check for hierarchical match (subcategory)
  const hierarchicalMatch = queryCategories.some(qCat => {
    const subcategories = getSubcategoriesForCategory(qCat);
    return subcategories.some(sub => 
      sub.toLowerCase() === productCategory.toLowerCase()
    );
  });
  
  if (hierarchicalMatch) {
    return {
      isValid: true,
      confidence: 0.9,
      matchType: 'hierarchical',
      reason: `Product category "${productCategory}" is a subcategory of query category`,
    };
  }
  
  // CRITICAL: Check for cross-category contamination BEFORE allowing related matches
  // If product and query are in completely different verticals, reject immediately
  // e.g., "Phone Cases" (Accessories) vs "Tops" (Apparel) = mismatch
  const isCrossCategoryContamination = queryCategories.every(qCat => {
    // Check if they're in different category groups
    const productGroup = getCategoryGroup(productCategory);
    const queryGroup = getCategoryGroup(qCat);
    return productGroup !== queryGroup;
  });
  
  if (isCrossCategoryContamination) {
    return {
      isValid: false,
      confidence: 0,
      matchType: 'mismatch',
      reason: `Product category "${productCategory}" is in a different category group than query categories (cross-category contamination prevented)`,
    };
  }
  
  // CRITICAL: Check for obvious mis-categorization in subcategory
  // If subcategory clearly belongs to a different category group, reject
  // e.g., category "Tops" with subcategory "Laptop Case" should be in "Phone Cases" (Accessories)
  if (product.subcategory) {
    const subcategoryLower = product.subcategory.toLowerCase();
    const productGroup = getCategoryGroup(productCategory);
    
    // Check if subcategory suggests a different category group
    const accessoryKeywords = ['case', 'bag', 'jewelry', 'accessory', 'phone', 'laptop', 'tote', 'backpack', 'cosmetic', 'soap'];
    const homeKeywords = ['bedding', 'towel', 'bathroom', 'tabletop', 'candle', 'interior', 'wallpaper', 'dish'];
    const apparelKeywords = ['dress', 'top', 'bottom', 'skirt', 'pant', 'sweater', 'jacket', 'shoe', 'swim', 'lounge'];
    
    const isAccessorySubcategory = accessoryKeywords.some(keyword => subcategoryLower.includes(keyword));
    const isHomeSubcategory = homeKeywords.some(keyword => subcategoryLower.includes(keyword));
    const isApparelSubcategory = apparelKeywords.some(keyword => subcategoryLower.includes(keyword));
    
    // If subcategory suggests a different group than the category, flag as suspicious
    if ((isAccessorySubcategory && productGroup !== 'Accessories') ||
        (isHomeSubcategory && productGroup !== 'Home & Living') ||
        (isApparelSubcategory && productGroup === 'Accessories')) {
      // Only reject if query category confidence is high (we're being strict)
      if (categoryConfidence >= 0.7) {
        return {
          isValid: false,
          confidence: 0.3,
          matchType: 'mismatch',
          reason: `Product category "${productCategory}" with subcategory "${product.subcategory}" appears mis-categorized (subcategory suggests different category group)`,
        };
      }
    }
  }
  
  // Check for related match (same parent or similar vertical)
  const relatedMatch = queryCategories.some(qCat => 
    getRelatedCategories(productCategory, qCat)
  );
  
  // Calculate similarity scores
  const similarities = queryCategories.map(qCat => 
    getCategorySimilarity(productCategory, qCat)
  );
  const maxSimilarity = Math.max(...similarities);
  
  // Use category confidence to determine strictness
  // High confidence (>= 0.7): Strict filtering (exact/hierarchical only)
  // Medium confidence (0.5-0.7): Allow related categories with similarity >= 0.4
  // Low confidence (< 0.5): More lenient, allow related with similarity >= 0.3
  
  if (categoryConfidence >= 0.7) {
    // High confidence: Only exact or hierarchical matches
    if (hierarchicalMatch) {
      return {
        isValid: true,
        confidence: 0.9,
        matchType: 'hierarchical',
        reason: `Product category "${productCategory}" is a subcategory of query category (high confidence)`,
      };
    }
    return {
      isValid: false,
      confidence: maxSimilarity,
      matchType: 'mismatch',
      reason: `Product category "${productCategory}" does not match query categories (high confidence requires exact/hierarchical match)`,
    };
  } else if (categoryConfidence >= 0.5) {
    // Medium confidence: Allow related categories with similarity >= 0.4
    if (relatedMatch && maxSimilarity >= 0.4) {
      return {
        isValid: true,
        confidence: maxSimilarity,
        matchType: 'related',
        reason: `Product category "${productCategory}" is related to query category (medium confidence)`,
      };
    }
    return {
      isValid: false,
      confidence: maxSimilarity,
      matchType: 'mismatch',
      reason: `Product category "${productCategory}" does not match query categories (medium confidence requires similarity >= 0.4)`,
    };
  } else {
    // Low confidence: More lenient, allow related with similarity >= 0.3
    if (relatedMatch && maxSimilarity >= 0.3) {
      return {
        isValid: true,
        confidence: maxSimilarity,
        matchType: 'related',
        reason: `Product category "${productCategory}" is related to query category (low confidence, lenient)`,
      };
    }
    return {
      isValid: false,
      confidence: maxSimilarity,
      matchType: 'mismatch',
      reason: `Product category "${productCategory}" does not match query categories (low confidence requires similarity >= 0.3)`,
    };
  }
}

/**
 * Validate all products against query categories
 */
export function validateAllProducts(
  products: SearchResultItem[],
  queryCategories: string[],
  categoryConfidence: number
): ProductCategoryValidation[] {
  return products.map(product => ({
    product,
    validation: validateProductCategory(product, queryCategories, categoryConfidence),
  }));
}

/**
 * Filter products by category validation
 */
export function filterProductsByCategoryValidation(
  validations: ProductCategoryValidation[]
): SearchResultItem[] {
  const validProducts = validations
    .filter(v => v.validation.isValid)
    .map(v => v.product);
  
  const invalidCount = validations.length - validProducts.length;
  
  if (invalidCount > 0) {
    logger.info('products_filtered_by_category', {
      totalProducts: validations.length,
      validProducts: validProducts.length,
      filteredCount: invalidCount,
      invalidReasons: validations
        .filter(v => !v.validation.isValid)
        .map(v => ({
          productId: v.product.id,
          productCategory: v.product.category,
          reason: v.validation.reason,
          matchType: v.validation.matchType,
        })),
    });
  }
  
  return validProducts;
}
