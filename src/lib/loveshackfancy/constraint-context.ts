/**
 * Context-Aware Constraint Filtering
 * 
 * Filters and transforms constraints based on category metadata to ensure
 * context-aware constraint application and prevent false negatives.
 */

import type { SearchConstraints } from '../search/types';
import { getCategoriesMetadata, type CategoryConstraintConfig } from './category-metadata';
import { logger } from '../telemetry/logger';

export type ContextAwareConstraints = {
  sqlFilters: SearchConstraints; // For hard SQL filtering (only applicable constraints)
  keywordTerms: string[]; // For fallback keyword search in titles/descriptions
  relaxedConstraints: SearchConstraints; // For progressive fallback (drop inapplicable)
  metadata: CategoryConstraintConfig; // Category metadata used
};

/**
 * Get context-aware constraints based on category metadata
 * 
 * @param constraints - Original search constraints
 * @param categories - Categories to filter for
 * @param originalQuery - Optional original user query for category-specific keyword extraction
 * @returns Context-aware constraints with separate sets for SQL filtering and keyword search
 */
export function getContextAwareConstraints(
  constraints: SearchConstraints,
  categories: string[],
  originalQuery?: string
): ContextAwareConstraints {
  if (categories.length === 0) {
    // No categories: return constraints as-is
    return {
      sqlFilters: constraints,
      keywordTerms: [],
      relaxedConstraints: constraints,
      metadata: getCategoriesMetadata([]),
    };
  }

  const metadata = getCategoriesMetadata(categories);
  const sqlFilters: SearchConstraints = { ...constraints };
  const keywordTerms: string[] = [];
  const relaxedConstraints: SearchConstraints = { ...constraints };

  // Extract category-specific keywords from the original query if provided
  let categoryKeywordsExtracted: string[] = [];
  if (originalQuery && metadata.allowKeywordMatching && metadata.contextWordMappings) {
    categoryKeywordsExtracted = extractCategoryKeywords(originalQuery, categories);
    // Merge with constraint-derived keywords (avoid duplicates)
    const existingKeywordsLower = new Set(keywordTerms.map(k => k.toLowerCase()));
    categoryKeywordsExtracted.forEach(keyword => {
      if (!existingKeywordsLower.has(keyword.toLowerCase())) {
        keywordTerms.push(keyword);
      }
    });
  }

  // Handle colors: check if they should be SQL filters or keyword terms
  if (constraints.colors && constraints.colors.length > 0) {
    if ((metadata.textOnlyConstraints as string[]).includes('colors')) {
      // Colors should be searched as keywords, not SQL filters
      // Check for context-dependent word mappings
      const mappedTerms: string[] = [];
      const unmappedColors: string[] = [];

      constraints.colors.forEach(color => {
        const colorLower = color.toLowerCase();
        // Check if this color word is mapped to something else (e.g., "lavender" → "scent" for perfumes)
        if (metadata.contextWordMappings && metadata.contextWordMappings[colorLower]) {
          mappedTerms.push(color);
        } else {
          unmappedColors.push(color);
        }
      });

      // Add mapped terms to keyword search
      keywordTerms.push(...mappedTerms);

      // For unmapped colors in text-only categories, also add to keyword terms
      // (e.g., "blue perfume" should search for "blue" in descriptions)
      keywordTerms.push(...unmappedColors);

      // Remove from SQL filters
      delete sqlFilters.colors;
      delete relaxedConstraints.colors;
    } else {
      // Colors are applicable as SQL filters
      // Keep in sqlFilters and relaxedConstraints
    }
  }

  // Handle materials: check if they should be SQL filters or keyword terms
  if (constraints.materials && constraints.materials.length > 0) {
    if ((metadata.textOnlyConstraints as string[]).includes('materials')) {
      // Materials should be searched as keywords, not SQL filters
      keywordTerms.push(...constraints.materials);
      delete sqlFilters.materials;
      delete relaxedConstraints.materials;
    } else if (!metadata.applicableConstraints.includes('materials')) {
      // Materials not applicable for this category
      keywordTerms.push(...constraints.materials);
      delete sqlFilters.materials;
      // Keep in relaxedConstraints for progressive fallback
    }
  }

  // Handle fabrics: check if they should be SQL filters or keyword terms
  if (constraints.fabrics && constraints.fabrics.length > 0) {
    if ((metadata.textOnlyConstraints as string[]).includes('fabrics')) {
      // Fabrics should be searched as keywords, not SQL filters
      keywordTerms.push(...constraints.fabrics);
      delete sqlFilters.fabrics;
      delete relaxedConstraints.fabrics;
    } else if (!metadata.applicableConstraints.includes('fabrics')) {
      // Fabrics not applicable for this category
      keywordTerms.push(...constraints.fabrics);
      delete sqlFilters.fabrics;
      // Keep in relaxedConstraints for progressive fallback
    }
  }

  // Handle useCases (includes rooms, which are mapped to useCases in SearchConstraints)
  if (constraints.useCases && constraints.useCases.length > 0) {
    if (!metadata.applicableConstraints.includes('useCases')) {
      // UseCases not applicable for this category
      keywordTerms.push(...constraints.useCases);
      delete sqlFilters.useCases;
      // Keep in relaxedConstraints for progressive fallback
    }
  }

  // Handle benefits
  if (constraints.benefits && constraints.benefits.length > 0) {
    if (!metadata.applicableConstraints.includes('benefits')) {
      // Benefits not applicable for this category
      keywordTerms.push(...constraints.benefits);
      delete sqlFilters.benefits;
      // Keep in relaxedConstraints for progressive fallback
    }
  }

  // Handle claims
  if (constraints.claims && constraints.claims.length > 0) {
    if (!metadata.applicableConstraints.includes('claims')) {
      // Claims not applicable for this category
      keywordTerms.push(...constraints.claims);
      delete sqlFilters.claims;
      // Keep in relaxedConstraints for progressive fallback
    }
  }

  // Handle compatibility
  if (constraints.compatibility && constraints.compatibility.length > 0) {
    if (!metadata.applicableConstraints.includes('compatibility')) {
      // Compatibility not applicable for this category
      keywordTerms.push(...constraints.compatibility);
      delete sqlFilters.compatibility;
      // Keep in relaxedConstraints for progressive fallback
    }
  }

  // Handle sensoryProfile
  if (constraints.sensoryProfile) {
    if (!metadata.applicableConstraints.includes('sensoryProfile')) {
      // SensoryProfile not applicable for this category
      keywordTerms.push(constraints.sensoryProfile);
      delete sqlFilters.sensoryProfile;
      // Keep in relaxedConstraints for progressive fallback
    }
  }

  // Remove inapplicable constraints from SQL filters
  if (!metadata.applicableConstraints.includes('sizes') && sqlFilters.sizes) {
    delete sqlFilters.sizes;
  }
  if (!metadata.applicableConstraints.includes('fit') && sqlFilters.fit) {
    delete sqlFilters.fit;
  }
  if (!metadata.applicableConstraints.includes('occasions') && sqlFilters.occasions) {
    delete sqlFilters.occasions;
  }
  if (!metadata.applicableConstraints.includes('seasons') && sqlFilters.seasons) {
    delete sqlFilters.seasons;
  }

  // Price is always applicable, keep it

  logger.debug('constraint_context: applied_category_metadata', {
    categories,
    originalConstraints: {
      colors: constraints.colors?.length || 0,
      materials: constraints.materials?.length || 0,
      fabrics: constraints.fabrics?.length || 0,
      sizes: constraints.sizes?.length || 0,
    },
    sqlFilters: {
      colors: sqlFilters.colors?.length || 0,
      materials: sqlFilters.materials?.length || 0,
      fabrics: sqlFilters.fabrics?.length || 0,
      sizes: sqlFilters.sizes?.length || 0,
    },
    keywordTerms: keywordTerms.length,
    categoryKeywordsExtracted: categoryKeywordsExtracted.length,
    categoryKeywordsSample: categoryKeywordsExtracted.slice(0, 3),
    applicableConstraints: metadata.applicableConstraints,
    textOnlyConstraints: metadata.textOnlyConstraints,
  });

  return {
    sqlFilters,
    keywordTerms,
    relaxedConstraints,
    metadata,
  };
}

/**
 * Extract the original word from query preserving capitalization
 * 
 * @param query - Original query text
 * @param word - Word to extract (lowercase)
 * @returns Original word with preserved capitalization or null if not found
 */
function extractOriginalWord(query: string, word: string): string | null {
  // Use word boundary regex to match whole words only (case-insensitive)
  const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const match = query.match(regex);
  return match ? match[0] : null;
}

/**
 * Extract category-specific keywords from query text
 * 
 * Uses context word mappings to find relevant keywords in the query
 * that should be searched in product titles/descriptions.
 * 
 * @param query - Original user query
 * @param categories - Categories to extract keywords for
 * @returns Array of keywords to search for (preserving original capitalization)
 */
export function extractCategoryKeywords(
  query: string,
  categories: string[]
): string[] {
  if (categories.length === 0) {
    return [];
  }

  const metadata = getCategoriesMetadata(categories);
  
  if (!metadata.contextWordMappings || Object.keys(metadata.contextWordMappings).length === 0) {
    return [];
  }

  const extractedKeywords: string[] = [];
  const seenKeywords = new Set<string>(); // For case-insensitive deduplication

  // Iterate through all context word mappings
  for (const [mappedWord, _mappedValue] of Object.entries(metadata.contextWordMappings)) {
    // Try to find the word in the query (preserving capitalization)
    const originalWord = extractOriginalWord(query, mappedWord);
    
    if (originalWord) {
      const lowerKey = originalWord.toLowerCase();
      // Deduplicate case-insensitively
      if (!seenKeywords.has(lowerKey)) {
        seenKeywords.add(lowerKey);
        extractedKeywords.push(originalWord);
      }
    }
  }

  return extractedKeywords;
}

/**
 * Check if a word should be treated as a context-dependent term
 * 
 * @param word - Word to check
 * @param categories - Categories to check against
 * @returns True if the word should be treated as context-dependent
 */
export function isContextDependentWord(word: string, categories: string[]): boolean {
  if (categories.length === 0) return false;
  
  const metadata = getCategoriesMetadata(categories);
  const wordLower = word.toLowerCase();
  
  return metadata.contextWordMappings?.[wordLower] !== undefined;
}

/**
 * Get the mapped meaning of a context-dependent word
 * 
 * @param word - Word to map
 * @param categories - Categories to check against
 * @returns Mapped meaning (e.g., "scent" for "lavender" in Perfumes) or undefined
 */
export function getContextDependentMapping(word: string, categories: string[]): string | undefined {
  if (categories.length === 0) return undefined;
  
  const metadata = getCategoriesMetadata(categories);
  const wordLower = word.toLowerCase();
  
  return metadata.contextWordMappings?.[wordLower];
}

