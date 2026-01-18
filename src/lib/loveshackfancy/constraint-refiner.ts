/**
 * Dictionary-Based Constraint Refinement
 * 
 * Uses LLM to map user queries onto static constraint dictionaries for ranking.
 * This runs AFTER hard filters and provides soft ranking signals.
 */

import { callLLM } from '../llm/provider';
import { buildConstraintRefinementPrompt, CONSTRAINT_REFINEMENT_SCHEMA, extractCategorySpecificDictionaryValues } from './prompts';
import { validateConstraintValues } from './dictionary-matcher';
import { logger } from '../telemetry/logger';
import type { RefinedConstraints } from './constraint-utils';
import { refinedConstraintsToIntent, type QueryConstraintsWithIntent } from './constraint-utils';
import type { CategoryDictionaryMap } from '../search/filtering/category-dictionaries';

/**
 * Parameters for constraint refinement
 */
export type ConstraintRefinementParams = {
  query: string;
  classificationConstraints?: Partial<import('./classifier').FashionConstraints> | null;
  gender?: string | null;
  categories?: string[];
  ageGroup?: string | null;
  candidateCount?: number;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  categoryDictionaries?: CategoryDictionaryMap;
};

/**
 * Result from constraint refinement
 */
export type ConstraintRefinementResult = {
  refinedConstraints: RefinedConstraints;
  validatedConstraints: QueryConstraintsWithIntent;
  validationStats: {
    total: number;
    validated: number;
    dropped: number;
  };
};

/**
 * Refine constraints using dictionary-based LLM mapping
 * 
 * This function:
 * 1. Builds a prompt with static constraint dictionaries
 * 2. Calls LLM to select relevant dictionary values
 * 3. Validates LLM output against dictionaries
 * 4. Converts to QueryConstraintsWithIntent format for ranking
 * 
 * @param params - Refinement parameters
 * @returns Refined and validated constraints for ranking
 */
export async function refineConstraintsWithDictionaries(
  params: ConstraintRefinementParams
): Promise<ConstraintRefinementResult> {
  const startTime = Date.now();
  
  // Count classification constraints provided for validation
  const classificationConstraintCount = params.classificationConstraints 
    ? Object.keys(params.classificationConstraints).filter(
        key => params.classificationConstraints![key as keyof typeof params.classificationConstraints] !== null 
          && params.classificationConstraints![key as keyof typeof params.classificationConstraints] !== undefined
      ).length 
    : 0;
  
  logger.debug('constraint_refinement_starting', {
    query: params.query.substring(0, 100),
    gender: params.gender,
    categories: params.categories,
    ageGroup: params.ageGroup,
    candidateCount: params.candidateCount,
    hasCategoryDictionaries: !!params.categoryDictionaries,
    categoryDictionaryCount: params.categoryDictionaries?.size || 0,
    hasClassificationConstraints: !!params.classificationConstraints,
    classificationConstraintCount,
    note: params.classificationConstraints 
      ? 'Validating classification constraints against dictionaries' 
      : 'Extracting constraints from query',
  });
  
  // Build prompt
  const prompt = buildConstraintRefinementPrompt({
    ...params,
    categoryDictionaries: params.categoryDictionaries,
  });
  
  // Log that dictionaries are in the prompt
  const hasCategorySpecificInPrompt = prompt.includes('category-specific');
  logger.debug('constraint_refinement_prompt_built', {
    query: params.query.substring(0, 100),
    promptLength: prompt.length,
    hasCategorySpecificInPrompt,
    categoryDictionaryCount: params.categoryDictionaries?.size || 0,
  });
  
  // Call LLM
  let rawResponse: string;
  try {
    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a fashion ranking assistant that maps user queries to constraint dictionaries.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: CONSTRAINT_REFINEMENT_SCHEMA,
    });
    rawResponse = result.rawText;
  } catch (error) {
    logger.error('constraint_refinement_llm_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: params.query.substring(0, 100),
    });
    
    // Return empty refinement on failure
    return {
      refinedConstraints: {},
      validatedConstraints: {},
      validationStats: { total: 0, validated: 0, dropped: 0 },
    };
  }
  
  // Parse LLM response
  let parsed: RefinedConstraints;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (error) {
    logger.error('constraint_refinement_parse_failed', {
      error: error instanceof Error ? error.message : String(error),
      rawResponse: rawResponse?.substring(0, 500) || 'undefined',
      query: params.query.substring(0, 100),
    });
    
    return {
      refinedConstraints: {},
      validatedConstraints: {},
      validationStats: { total: 0, validated: 0, dropped: 0 },
    };
  }
  
  logger.debug('constraint_refinement_llm_response', {
    query: params.query.substring(0, 100),
    rawConstraints: {
      colors: parsed.colors?.length || 0,
      materials: parsed.materials?.length || 0,
      occasions: parsed.occasions?.length || 0,
      styles: parsed.styles?.length || 0,
      patterns: parsed.patterns?.length || 0,
      sizes: parsed.sizes?.length || 0,
      lengths: parsed.lengths?.length || 0,
      fits: parsed.fits?.length || 0,
      rises: parsed.rises?.length || 0,
      formalityLevel: parsed.formalityLevel?.length || 0,
      necklines: parsed.necklines?.length || 0,
      sleeveLengths: parsed.sleeveLengths?.length || 0,
      collections: parsed.collections?.length || 0,
      seasons: parsed.seasons?.length || 0,
      colorShade: parsed.colorShade?.length || 0,
      embellishments: parsed.embellishments?.length || 0,
    },
    importance: parsed.importance,
  });
  
  // Extract category-specific dictionary values for validation
  const categorySpecificValues = extractCategorySpecificDictionaryValues(
    params.categoryDictionaries,
    params.categories
  );
  
  // Validate each constraint type against dictionaries
  const validated: RefinedConstraints = {
    importance: parsed.importance || {},
  };
  
  let totalRawValues = 0;
  let validatedValues = 0;
  let droppedValues = 0;
  
  // Helper to validate and count
  const validateAndCount = (
    constraintType: 'colors' | 'materials' | 'occasions' | 'styles' | 'patterns' | 'sizes' | 'lengths' | 'formalityLevel' | 'fits' | 'rises' | 'necklines' | 'sleeveLengths' | 'collections' | 'seasons' | 'colorShade' | 'embellishments',
    rawValues: string[] | undefined,
    categorySpecificKey?: string
  ): string[] | undefined => {
    if (!rawValues || rawValues.length === 0) return undefined;
    
    totalRawValues += rawValues.length;
    // Use category-specific values if available, otherwise fall back to global dictionary
    // Map colorShade to colorShades for dictionary lookup
    const lookupKey = categorySpecificKey === 'colorShade' ? 'colorShades' : (categorySpecificKey || constraintType);
    const categorySpecific = lookupKey ? categorySpecificValues.get(lookupKey) : undefined;
    const validValues = validateConstraintValues(constraintType, rawValues, categorySpecific);
    
    if (validValues && validValues.length > 0) {
      validatedValues += validValues.length;
      droppedValues += rawValues.length - validValues.length;
      return validValues;
    } else {
      droppedValues += rawValues.length;
      return undefined;
    }
  };
  
  // Validate all constraint types (use category-specific when available)
  validated.colors = validateAndCount('colors', parsed.colors, 'colors');
  validated.materials = validateAndCount('materials', parsed.materials, 'materials');
  validated.occasions = validateAndCount('occasions', parsed.occasions, 'occasions');
  validated.styles = validateAndCount('styles', parsed.styles, 'styles');
  validated.patterns = validateAndCount('patterns', parsed.patterns, 'patterns');
  validated.sizes = validateAndCount('sizes', parsed.sizes, 'sizes');
  validated.lengths = validateAndCount('lengths', parsed.lengths, 'lengths');
  validated.fits = validateAndCount('fits', parsed.fits, 'fits');
  validated.rises = validateAndCount('rises', parsed.rises, 'rises');
  validated.formalityLevel = validateAndCount('formalityLevel', parsed.formalityLevel, 'formalityLevel');
  validated.necklines = validateAndCount('necklines', parsed.necklines, 'necklines');
  validated.sleeveLengths = validateAndCount('sleeveLengths', parsed.sleeveLengths, 'sleeves');
  validated.collections = validateAndCount('collections', parsed.collections, 'collections');
  validated.seasons = validateAndCount('seasons', parsed.seasons, 'seasons');
  validated.colorShade = validateAndCount('colorShade', parsed.colorShade, 'colorShade');
  validated.embellishments = validateAndCount('embellishments', parsed.embellishments, 'embellishments');
  
  logger.info('constraint_refinement_validation_complete', {
    query: params.query.substring(0, 100),
    totalRawValues,
    validatedValues,
    droppedValues,
    validatedConstraints: {
      colors: validated.colors?.length || 0,
      materials: validated.materials?.length || 0,
      occasions: validated.occasions?.length || 0,
      styles: validated.styles?.length || 0,
      patterns: validated.patterns?.length || 0,
      sizes: validated.sizes?.length || 0,
      lengths: validated.lengths?.length || 0,
      fits: validated.fits?.length || 0,
      rises: validated.rises?.length || 0,
      formalityLevel: validated.formalityLevel?.length || 0,
      necklines: validated.necklines?.length || 0,
      sleeveLengths: validated.sleeveLengths?.length || 0,
      collections: validated.collections?.length || 0,
      seasons: validated.seasons?.length || 0,
      colorShade: validated.colorShade?.length || 0,
      embellishments: validated.embellishments?.length || 0,
    },
    importance: validated.importance,
  });
  
  // Convert to QueryConstraintsWithIntent format
  const validatedWithIntent = refinedConstraintsToIntent(validated);
  
  const duration = Date.now() - startTime;
  logger.info('constraint_refinement_complete', {
    query: params.query.substring(0, 100),
    durationMs: duration,
    durationSeconds: (duration / 1000).toFixed(2),
    constraintTypesRefined: Object.keys(validatedWithIntent).filter(k => validatedWithIntent[k as keyof QueryConstraintsWithIntent] !== null).length,
  });
  
  return {
    refinedConstraints: validated,
    validatedConstraints: validatedWithIntent,
    validationStats: {
      total: totalRawValues,
      validated: validatedValues,
      dropped: droppedValues,
    },
  };
}

/**
 * Merge refined constraints with existing constraints
 * Refined constraints override existing ones where present
 */
export function mergeRefinedConstraints(
  existingConstraints: QueryConstraintsWithIntent,
  refinedConstraints: QueryConstraintsWithIntent
): QueryConstraintsWithIntent {
  const merged: QueryConstraintsWithIntent = { ...existingConstraints };
  
  // Merge each constraint type (refined takes precedence)
  const constraintKeys: Array<keyof QueryConstraintsWithIntent> = [
    'colors', 'materials', 'occasions', 'styles', 'patterns', 'sizes', 
    'lengths', 'fits', 'rises', 'formalityLevel', 'necklines', 'sleeveLengths',
    'collections', 'seasons', 'colorShade', 'embellishments'
  ];
  
  for (const key of constraintKeys) {
    const refinedValue = refinedConstraints[key];
    if (refinedValue !== undefined && refinedValue !== null) {
      (merged as any)[key] = refinedValue;
    }
  }
  
  return merged;
}
