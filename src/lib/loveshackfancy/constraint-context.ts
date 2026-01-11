/**
 * Context-Aware Constraint Filtering
 * 
 * Filters and transforms constraints based on category metadata to ensure
 * context-aware constraint application and prevent false negatives.
 */

import type { SearchConstraints } from '../search/types';
import { getCategoriesMetadata, type CategoryConstraintConfig } from './category-metadata';
import { logger } from '../telemetry/logger';
import { extractConstraintValues, extractConstraintIntent, hasIntentFormat } from './constraint-utils';

/**
 * Helper to extract constraint values and handle excluded intent
 * Returns { values, excludedValues } where values are included constraints and excludedValues are excluded constraints
 */
function extractConstraintWithExcluded(
  constraint: any
): { values: string[] | null; excludedValues: string[] | null } {
  if (!constraint) return { values: null, excludedValues: null };
  
  const values = extractConstraintValues(constraint);
  const intent = extractConstraintIntent(constraint);
  
  if (intent === 'excluded') {
    return { values: null, excludedValues: values || null };
  } else {
    return { values: values || null, excludedValues: null };
  }
}

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
  // Extract color values from intent format if needed
  const colorValues = extractConstraintValues(constraints.colors);
  const colorIntent = extractConstraintIntent(constraints.colors);
  
  if (colorValues && colorValues.length > 0) {
    if ((metadata.textOnlyConstraints as string[]).includes('colors')) {
      // Colors should be searched as keywords, not SQL filters
      // Check for context-dependent word mappings
      const mappedTerms: string[] = [];
      const unmappedColors: string[] = [];

      colorValues.forEach(color => {
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
      // Store as string array for SQL filters (excluded colors will be handled in SQL with NOT conditions)
      // For excluded colors, we still need to pass the values to SQL so it can add NOT conditions
      sqlFilters.colors = colorValues;
      relaxedConstraints.colors = colorValues;
      
      // Store the intent separately if needed (for SQL NOT conditions)
      if (colorIntent === 'excluded') {
        // Mark that colors should be excluded in SQL
        (sqlFilters as any).excludedColors = colorValues;
        (relaxedConstraints as any).excludedColors = colorValues;
      }
    }
  }

  // Handle materials: check if they should be SQL filters or keyword terms
  const { values: materialValues, excludedValues: excludedMaterials } = extractConstraintWithExcluded(constraints.materials);
  
  if (materialValues && materialValues.length > 0) {
    if ((metadata.textOnlyConstraints as string[]).includes('materials')) {
      // Materials should be searched as keywords, not SQL filters
      keywordTerms.push(...materialValues);
      delete sqlFilters.materials;
      delete relaxedConstraints.materials;
    } else if (!metadata.applicableConstraints.includes('materials')) {
      // Materials not applicable for this category
      keywordTerms.push(...materialValues);
      delete sqlFilters.materials;
      // Keep in relaxedConstraints for progressive fallback
    } else {
      // Materials are applicable as filters
      sqlFilters.materials = materialValues;
      relaxedConstraints.materials = materialValues;
    }
  }
  
  // Store excluded materials separately
  if (excludedMaterials && excludedMaterials.length > 0) {
    (sqlFilters as any).excludedMaterials = excludedMaterials;
    (relaxedConstraints as any).excludedMaterials = excludedMaterials;
  }

  // Handle fabrics: check if they should be SQL filters or keyword terms
  const { values: fabricValues, excludedValues: excludedFabrics } = extractConstraintWithExcluded(constraints.fabrics);
  
  if (fabricValues && fabricValues.length > 0) {
    if ((metadata.textOnlyConstraints as string[]).includes('fabrics')) {
      // Fabrics should be searched as keywords, not SQL filters
      keywordTerms.push(...fabricValues);
      delete sqlFilters.fabrics;
      delete relaxedConstraints.fabrics;
    } else if (!metadata.applicableConstraints.includes('fabrics')) {
      // Fabrics not applicable for this category
      keywordTerms.push(...fabricValues);
      delete sqlFilters.fabrics;
      // Keep in relaxedConstraints for progressive fallback
    } else {
      // Fabrics are applicable as filters
      sqlFilters.fabrics = fabricValues;
      relaxedConstraints.fabrics = fabricValues;
    }
  }
  
  // Store excluded fabrics separately
  if (excludedFabrics && excludedFabrics.length > 0) {
    (sqlFilters as any).excludedFabrics = excludedFabrics;
    (relaxedConstraints as any).excludedFabrics = excludedFabrics;
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

  // Handle sizes
  const { values: sizeValues, excludedValues: excludedSizes } = extractConstraintWithExcluded(constraints.sizes);
  if (sizeValues && sizeValues.length > 0) {
    if (!metadata.applicableConstraints.includes('sizes')) {
      delete sqlFilters.sizes;
    } else {
      sqlFilters.sizes = sizeValues;
      relaxedConstraints.sizes = sizeValues;
    }
  }
  if (excludedSizes && excludedSizes.length > 0) {
    (sqlFilters as any).excludedSizes = excludedSizes;
    (relaxedConstraints as any).excludedSizes = excludedSizes;
  }
  
  // Handle occasions
  const { values: occasionValues, excludedValues: excludedOccasions } = extractConstraintWithExcluded(constraints.occasions);
  if (occasionValues && occasionValues.length > 0) {
    if (!metadata.applicableConstraints.includes('occasions')) {
      delete sqlFilters.occasions;
    } else {
      sqlFilters.occasions = occasionValues;
      relaxedConstraints.occasions = occasionValues;
    }
  }
  if (excludedOccasions && excludedOccasions.length > 0) {
    (sqlFilters as any).excludedOccasions = excludedOccasions;
    (relaxedConstraints as any).excludedOccasions = excludedOccasions;
  }
  
  // Handle seasons
  const { values: seasonValues, excludedValues: excludedSeasons } = extractConstraintWithExcluded(constraints.seasons);
  if (seasonValues && seasonValues.length > 0) {
    if (!metadata.applicableConstraints.includes('seasons')) {
      delete sqlFilters.seasons;
    } else {
      sqlFilters.seasons = seasonValues;
      relaxedConstraints.seasons = seasonValues;
    }
  }
  if (excludedSeasons && excludedSeasons.length > 0) {
    (sqlFilters as any).excludedSeasons = excludedSeasons;
    (relaxedConstraints as any).excludedSeasons = excludedSeasons;
  }
  
  // Handle fit (single value, not array)
  const fitConstraint = constraints.fit;
  const fitValue = typeof fitConstraint === 'object' && fitConstraint !== null && 'value' in fitConstraint
    ? (fitConstraint as any).value
    : fitConstraint;
  const fitIntent = extractConstraintIntent(fitConstraint);
  if (fitValue) {
    if (!metadata.applicableConstraints.includes('fit')) {
      delete sqlFilters.fit;
    } else {
      if (fitIntent === 'excluded') {
        (sqlFilters as any).excludedFit = fitValue;
        (relaxedConstraints as any).excludedFit = fitValue;
      } else {
        sqlFilters.fit = fitValue as string;
        relaxedConstraints.fit = fitValue as string;
      }
    }
  }
  
  // Handle styleTags (styles)
  const { values: styleTagValues, excludedValues: excludedStyleTags } = extractConstraintWithExcluded((constraints as any).styleTags);
  if (styleTagValues && styleTagValues.length > 0) {
    sqlFilters.styleTags = styleTagValues;
    relaxedConstraints.styleTags = styleTagValues;
  }
  if (excludedStyleTags && excludedStyleTags.length > 0) {
    (sqlFilters as any).excludedStyleTags = excludedStyleTags;
    (relaxedConstraints as any).excludedStyleTags = excludedStyleTags;
  }
  
  // Handle pattern (single value, not array - stored in ProductAttributes.pattern)
  const patternConstraint = (constraints as any).pattern;
  const patternValue = typeof patternConstraint === 'object' && patternConstraint !== null && 'value' in patternConstraint
    ? (patternConstraint as any).value
    : patternConstraint;
  const patternIntent = extractConstraintIntent(patternConstraint);
  if (patternValue) {
    if (patternIntent === 'excluded') {
      (sqlFilters as any).excludedPattern = patternValue;
      (relaxedConstraints as any).excludedPattern = patternValue;
    } else {
      (sqlFilters as any).pattern = patternValue;
      (relaxedConstraints as any).pattern = patternValue;
    }
  }

  // Handle ageGroups - always applicable as hard filters, preserve in sqlFilters
  // CRITICAL: Age groups must always be preserved as hard SQL filters
  // Extract age groups using the helper, but also check direct format as fallback
  const { values: ageGroupValues, excludedValues: excludedAgeGroups } = extractConstraintWithExcluded(constraints.ageGroups);
  
  // Determine final age group values to use (try extracted first, then direct, then any format)
  let finalAgeGroupValues: string[] | undefined = undefined;
  if (ageGroupValues && ageGroupValues.length > 0) {
    finalAgeGroupValues = ageGroupValues;
  } else if (constraints.ageGroups) {
    // Fallback: extract directly from constraints if helper didn't work
    if (Array.isArray(constraints.ageGroups)) {
      finalAgeGroupValues = constraints.ageGroups;
    } else if (typeof constraints.ageGroups === 'object' && constraints.ageGroups !== null && 'values' in constraints.ageGroups) {
      // New format with intent
      const intentAgeGroups = (constraints.ageGroups as any).values;
      if (Array.isArray(intentAgeGroups) && intentAgeGroups.length > 0) {
        finalAgeGroupValues = intentAgeGroups;
      }
    }
  }
  
  // Always preserve age groups in sqlFilters if they exist (hard filter)
  if (finalAgeGroupValues && finalAgeGroupValues.length > 0) {
    sqlFilters.ageGroups = finalAgeGroupValues;
    relaxedConstraints.ageGroups = finalAgeGroupValues;
    logger.debug('constraint_context: age_groups_preserved_in_sql_filters', {
      categories,
      ageGroups: finalAgeGroupValues,
      originalFormat: constraints.ageGroups ? (Array.isArray(constraints.ageGroups) ? 'array' : 'object') : 'undefined',
      note: 'Age groups preserved as hard SQL filters',
    });
  } else if (constraints.ageGroups) {
    // Log warning if age groups exist but couldn't be extracted
    logger.warn('constraint_context: age_groups_failed_to_extract', {
      categories,
      originalAgeGroups: constraints.ageGroups,
      note: 'Age groups exist in constraints but failed to extract - this should not happen',
    });
  }
  
  // Handle excluded age groups
  if (excludedAgeGroups && excludedAgeGroups.length > 0) {
    (sqlFilters as any).excludedAgeGroups = excludedAgeGroups;
    (relaxedConstraints as any).excludedAgeGroups = excludedAgeGroups;
  }

  // Handle lengths - always applicable as hard filters, preserve in sqlFilters
  // CRITICAL: Lengths must always be preserved as hard SQL filters
  // Extract lengths using the helper, but also check direct format as fallback
  const { values: lengthValues, excludedValues: excludedLengths } = extractConstraintWithExcluded(constraints.lengths);
  
  // Determine final length values to use (try extracted first, then direct, then any format)
  let finalLengthValues: string[] | undefined = undefined;
  if (lengthValues && lengthValues.length > 0) {
    finalLengthValues = lengthValues;
  } else if (constraints.lengths) {
    // Fallback: extract directly from constraints if helper didn't work
    if (Array.isArray(constraints.lengths)) {
      finalLengthValues = constraints.lengths;
    } else if (typeof constraints.lengths === 'object' && constraints.lengths !== null && 'values' in constraints.lengths) {
      // New format with intent
      const intentLengths = (constraints.lengths as any).values;
      if (Array.isArray(intentLengths) && intentLengths.length > 0) {
        finalLengthValues = intentLengths;
      }
    }
  }
  
  // Always preserve lengths in sqlFilters if they exist (hard filter)
  if (finalLengthValues && finalLengthValues.length > 0) {
    sqlFilters.lengths = finalLengthValues;
    relaxedConstraints.lengths = finalLengthValues;
    logger.debug('constraint_context: lengths_preserved_in_sql_filters', {
      categories,
      lengths: finalLengthValues,
      originalFormat: constraints.lengths ? (Array.isArray(constraints.lengths) ? 'array' : 'object') : 'undefined',
      note: 'Lengths preserved as hard SQL filters',
    });
  } else if (constraints.lengths) {
    // Log warning if lengths exist but couldn't be extracted
    logger.warn('constraint_context: lengths_failed_to_extract', {
      categories,
      originalLengths: constraints.lengths,
      note: 'Lengths exist in constraints but failed to extract - this should not happen',
    });
  }
  
  // Handle excluded lengths
  if (excludedLengths && excludedLengths.length > 0) {
    (sqlFilters as any).excludedLengths = excludedLengths;
    (relaxedConstraints as any).excludedLengths = excludedLengths;
  }

  // Handle sleeves (mapped from sleeveLengths) - preserve in sqlFilters for post-SQL filtering
  // CRITICAL: sleeves are post-filterable attributes - preserved in sqlFilters but applied via post-SQL filtering, not in SQL
  const { values: sleeveValues, excludedValues: excludedSleeves } = extractConstraintWithExcluded(constraints.sleeves);
  
  let finalSleeveValues: string[] | undefined = undefined;
  if (sleeveValues && sleeveValues.length > 0) {
    finalSleeveValues = sleeveValues;
  } else if (constraints.sleeves) {
    if (Array.isArray(constraints.sleeves)) {
      finalSleeveValues = constraints.sleeves;
    } else if (typeof constraints.sleeves === 'object' && constraints.sleeves !== null && 'values' in constraints.sleeves) {
      const intentSleeves = (constraints.sleeves as any).values;
      if (Array.isArray(intentSleeves) && intentSleeves.length > 0) {
        finalSleeveValues = intentSleeves;
      }
    }
  }
  
  if (finalSleeveValues && finalSleeveValues.length > 0) {
    sqlFilters.sleeves = finalSleeveValues;
    relaxedConstraints.sleeves = finalSleeveValues;
    logger.debug('constraint_context: sleeves_preserved_in_sql_filters', {
      categories,
      sleeves: finalSleeveValues,
      note: 'Sleeves preserved in sqlFilters for post-SQL filtering (not applied in SQL)',
    });
  }
  
  if (excludedSleeves && excludedSleeves.length > 0) {
    (sqlFilters as any).excludedSleeves = excludedSleeves;
    (relaxedConstraints as any).excludedSleeves = excludedSleeves;
  }

  // Handle necklines - preserve in sqlFilters for post-SQL filtering
  // CRITICAL: necklines are post-filterable attributes - preserved in sqlFilters but applied via post-SQL filtering, not in SQL
  const { values: necklineValues, excludedValues: excludedNecklines } = extractConstraintWithExcluded(constraints.necklines);
  
  let finalNecklineValues: string[] | undefined = undefined;
  if (necklineValues && necklineValues.length > 0) {
    finalNecklineValues = necklineValues;
  } else if (constraints.necklines) {
    if (Array.isArray(constraints.necklines)) {
      finalNecklineValues = constraints.necklines;
    } else if (typeof constraints.necklines === 'object' && constraints.necklines !== null && 'values' in constraints.necklines) {
      const intentNecklines = (constraints.necklines as any).values;
      if (Array.isArray(intentNecklines) && intentNecklines.length > 0) {
        finalNecklineValues = intentNecklines;
      }
    }
  }
  
  if (finalNecklineValues && finalNecklineValues.length > 0) {
    sqlFilters.necklines = finalNecklineValues;
    relaxedConstraints.necklines = finalNecklineValues;
    logger.debug('constraint_context: necklines_preserved_in_sql_filters', {
      categories,
      necklines: finalNecklineValues,
      note: 'Necklines preserved in sqlFilters for post-SQL filtering (not applied in SQL)',
    });
  }
  
  if (excludedNecklines && excludedNecklines.length > 0) {
    (sqlFilters as any).excludedNecklines = excludedNecklines;
    (relaxedConstraints as any).excludedNecklines = excludedNecklines;
  }

  // Handle formalityLevel - preserve in sqlFilters for post-SQL filtering
  // CRITICAL: formalityLevel is a post-filterable attribute - preserved in sqlFilters but applied via post-SQL filtering, not in SQL
  const { values: formalityLevelValues, excludedValues: excludedFormalityLevels } = extractConstraintWithExcluded(constraints.formalityLevel);
  
  let finalFormalityLevelValues: string[] | undefined = undefined;
  if (formalityLevelValues && formalityLevelValues.length > 0) {
    finalFormalityLevelValues = formalityLevelValues;
  } else if (constraints.formalityLevel) {
    if (Array.isArray(constraints.formalityLevel)) {
      finalFormalityLevelValues = constraints.formalityLevel;
    } else if (typeof constraints.formalityLevel === 'object' && constraints.formalityLevel !== null && 'values' in constraints.formalityLevel) {
      const intentFormalityLevels = (constraints.formalityLevel as any).values;
      if (Array.isArray(intentFormalityLevels) && intentFormalityLevels.length > 0) {
        finalFormalityLevelValues = intentFormalityLevels;
      }
    }
  }
  
  if (finalFormalityLevelValues && finalFormalityLevelValues.length > 0) {
    sqlFilters.formalityLevel = finalFormalityLevelValues;
    relaxedConstraints.formalityLevel = finalFormalityLevelValues;
    logger.debug('constraint_context: formalityLevel_preserved_in_sql_filters', {
      categories,
      formalityLevel: finalFormalityLevelValues,
      note: 'FormalityLevel preserved in sqlFilters for post-SQL filtering (not applied in SQL)',
    });
  }
  
  if (excludedFormalityLevels && excludedFormalityLevels.length > 0) {
    (sqlFilters as any).excludedFormalityLevels = excludedFormalityLevels;
    (relaxedConstraints as any).excludedFormalityLevels = excludedFormalityLevels;
  }

  // Handle colorShade - preserve in sqlFilters for post-SQL filtering
  // CRITICAL: colorShade is a post-filterable attribute - preserved in sqlFilters but applied via post-SQL filtering, not in SQL
  const { values: colorShadeValues, excludedValues: excludedColorShades } = extractConstraintWithExcluded(constraints.colorShade);
  
  let finalColorShadeValues: string[] | undefined = undefined;
  if (colorShadeValues && colorShadeValues.length > 0) {
    finalColorShadeValues = colorShadeValues;
  } else if (constraints.colorShade) {
    if (Array.isArray(constraints.colorShade)) {
      finalColorShadeValues = constraints.colorShade;
    } else if (typeof constraints.colorShade === 'object' && constraints.colorShade !== null && 'values' in constraints.colorShade) {
      const intentColorShades = (constraints.colorShade as any).values;
      if (Array.isArray(intentColorShades) && intentColorShades.length > 0) {
        finalColorShadeValues = intentColorShades;
      }
    }
  }
  
  if (finalColorShadeValues && finalColorShadeValues.length > 0) {
    sqlFilters.colorShade = finalColorShadeValues;
    relaxedConstraints.colorShade = finalColorShadeValues;
    logger.debug('constraint_context: colorShade_preserved_in_sql_filters', {
      categories,
      colorShade: finalColorShadeValues,
      note: 'ColorShade preserved in sqlFilters for post-SQL filtering (not applied in SQL)',
    });
  }
  
  if (excludedColorShades && excludedColorShades.length > 0) {
    (sqlFilters as any).excludedColorShades = excludedColorShades;
    (relaxedConstraints as any).excludedColorShades = excludedColorShades;
  }

  // Price is always applicable, keep it

  logger.debug('constraint_context: applied_category_metadata', {
    categories,
    originalConstraints: {
      colors: extractConstraintValues(constraints.colors)?.length || 0,
      materials: extractConstraintValues(constraints.materials)?.length || 0,
      fabrics: extractConstraintValues(constraints.fabrics)?.length || 0,
      sizes: extractConstraintValues(constraints.sizes)?.length || 0,
      occasions: extractConstraintValues(constraints.occasions)?.length || 0,
      seasons: extractConstraintValues(constraints.seasons)?.length || 0,
      lengths: extractConstraintValues(constraints.lengths)?.length || 0,
      sleeves: extractConstraintValues(constraints.sleeves)?.length || 0,
      necklines: extractConstraintValues(constraints.necklines)?.length || 0,
      formalityLevel: extractConstraintValues(constraints.formalityLevel)?.length || 0,
      colorShade: extractConstraintValues(constraints.colorShade)?.length || 0,
    },
    sqlFilters: {
      colors: sqlFilters.colors?.length || 0,
      materials: sqlFilters.materials?.length || 0,
      fabrics: sqlFilters.fabrics?.length || 0,
      sizes: sqlFilters.sizes?.length || 0,
      occasions: sqlFilters.occasions?.length || 0,
      seasons: sqlFilters.seasons?.length || 0,
      lengths: sqlFilters.lengths?.length || 0,
      sleeves: sqlFilters.sleeves?.length || 0,
      necklines: sqlFilters.necklines?.length || 0,
      formalityLevel: sqlFilters.formalityLevel?.length || 0,
      colorShade: sqlFilters.colorShade?.length || 0,
    },
    excludedFilters: {
      colors: (sqlFilters as any).excludedColors?.length || 0,
      materials: (sqlFilters as any).excludedMaterials?.length || 0,
      fabrics: (sqlFilters as any).excludedFabrics?.length || 0,
      sizes: (sqlFilters as any).excludedSizes?.length || 0,
      occasions: (sqlFilters as any).excludedOccasions?.length || 0,
      seasons: (sqlFilters as any).excludedSeasons?.length || 0,
      styleTags: (sqlFilters as any).excludedStyleTags?.length || 0,
      pattern: (sqlFilters as any).excludedPattern ? 1 : 0,
      fit: (sqlFilters as any).excludedFit ? 1 : 0,
      lengths: (sqlFilters as any).excludedLengths?.length || 0,
      sleeves: (sqlFilters as any).excludedSleeves?.length || 0,
      necklines: (sqlFilters as any).excludedNecklines?.length || 0,
      formalityLevel: (sqlFilters as any).excludedFormalityLevels?.length || 0,
      colorShade: (sqlFilters as any).excludedColorShades?.length || 0,
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
