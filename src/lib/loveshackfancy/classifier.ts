/**
 * Query Classifier
 * 
 * LLM-based query classification and constraint extraction for LoveShackFancy queries.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import { buildQueryClassifierPrompt, LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA } from './prompts';
import { stripJsonFences } from '../llm/orchestrator/utils';
import { normalizeAgeGroups } from './age-group-normalizer';
import { validateAgeGroups, validateColors } from './dictionary-validator';
import { normalizeQueryForSearch } from './query-normalizer';
import { validateConstraintValues } from './dictionary-matcher';
import { extractConstraintValues, extractConstraintIntent, type ConstraintWithIntent } from './constraint-utils';
import { detectGenderFromQuery } from './gender-detector';
import { CATEGORY_GENDER_MAP, type Gender } from '../catalog/category-gender-map';

export type FashionConstraints = {
  // Gender (NEW - for multi-gender support)
  gender?: 'male' | 'female' | 'unisex' | null;
  
  // Existing clothing constraints
  // Note: Runtime supports both string[] and ConstraintWithIntent formats for intent-based matching
  styles?: string[] | ConstraintWithIntent | null;
  lengths?: string[] | ConstraintWithIntent | null;
  occasions?: string[] | ConstraintWithIntent | null;
  seasons?: string[] | ConstraintWithIntent | null;
  materials?: string[] | ConstraintWithIntent | null;
  patterns?: string[] | ConstraintWithIntent | null;
  colors?: string[] | ConstraintWithIntent | null;
  sizes?: string[] | ConstraintWithIntent | null;
  fits?: string[] | ConstraintWithIntent | null;
  rises?: string[] | ConstraintWithIntent | null; // NEW - for rise/waist placement (Low Rise, Mid Rise, High Rise)
  collections?: string[] | ConstraintWithIntent | null;
  priceMinCents?: number | null;
  priceMaxCents?: number | null;
  embellishments?: string[] | ConstraintWithIntent | null;
  necklines?: string[] | ConstraintWithIntent | null;
  sleeveLengths?: string[] | ConstraintWithIntent | null;
  ageGroups?: string[] | ConstraintWithIntent | null;
  inclusivitySizing?: string[] | ConstraintWithIntent | null; // Plus Size, Petite, Tall, Extended Sizes, Standard Sizing
  setVsSingle?: string | ConstraintWithIntent | null; // "Set" for pack products, "Single" for individual items
  
  // Enriched fashion facets
  formalityLevel?: string[] | ConstraintWithIntent | null;
  temperatureIntent?: string | null;
  humidityFriendly?: boolean | null;
  occasionContext?: string[] | ConstraintWithIntent | null;
  problemSolutions?: string[] | ConstraintWithIntent | null;
  functionFeatures?: string[] | ConstraintWithIntent | null;
  colorShade?: string[] | ConstraintWithIntent | null;
  colorUndertone?: string[] | ConstraintWithIntent | null;
  multicolor?: boolean | null;
  seasonalPalette?: string[] | ConstraintWithIntent | null;
  
  // Additional enriched attributes
  careRequirements?: string[] | ConstraintWithIntent | null;
  rainWind?: string | null;
  travelFeatures?: string[] | ConstraintWithIntent | null;
  pockets?: string | null;
  liningType?: string | null;
  braSolution?: string | null;
  ecoMaterials?: string[] | ConstraintWithIntent | null;
  certifications?: string | null;
  origin?: string | null;
  adaptiveFeatures?: string | null;
  sensoryFriendly?: string | null;
  finish?: string | null;
  modestyCues?: string[] | ConstraintWithIntent | null;
  layeringIntent?: string | null;
  pairingIntent?: string | null;
  
  // Category-specific constraints
  scents?: string[] | ConstraintWithIntent | null;        // For Perfumes/Candles (lavender, vanilla, etc.)
  rooms?: string[] | ConstraintWithIntent | null;          // For Home & Living (bedroom, bathroom, etc.)
  useCases?: string[] | ConstraintWithIntent | null;       // Generic (travel, office, gift, etc.)
  benefits?: string[] | ConstraintWithIntent | null;       // Generic (durable, lightweight, etc.)
  claims?: string[] | ConstraintWithIntent | null;         // Generic (organic, vegan, etc.)
  sensoryProfile?: string | null;   // Generic (soft feel, citrus scent, etc.)
  compatibility?: string[] | ConstraintWithIntent | null;  // Generic (works with iOS, for small rooms, etc.)
};

export type QueryClassification = {
  type:
    | 'direct_product_search'
    | 'occasion_based'
    | 'style_exploration'
    | 'fit_and_size'
    | 'gift_or_vague'
    | 'unrelated';
  productTerms: string;
  constraints: FashionConstraints;
  confidence: number;
};

/**
 * Extended classification result with metadata about gender context
 */
export type ClassificationWithMetadata = {
  classification: QueryClassification;
  usedStrictMajorityMode: boolean;
  genderContext: 'male' | 'female' | null;
};

/**
 * Build allowed categories for classifier based on gender context
 * 
 * @param genderContext - Resolved gender from query/constraints ('male' | 'female' | null)
 * @param hasExplicitProductType - Whether the query explicitly mentions a product type (e.g., "tops", "dresses", "jeans")
 * @returns Allowed categories and metadata about filtering mode
 */
export function buildAllowedCategoriesForClassifier(
  genderContext: 'male' | 'female' | null,
  hasExplicitProductType: boolean = false
): { categoriesForPrompt: string[]; usedStrictMajorityMode: boolean } {
  const allEntries = Object.entries(CATEGORY_GENDER_MAP);

  // Case 1: Gender is explicit (directly or indirectly from query/constraints)
  // Include:
  // - Categories matching the explicit gender (e.g., "Women's Dresses" for female)
  // - Unisex categories (since they're for both genders)
  // Exclude:
  // - Opposite gender categories (e.g., don't include "Men's" categories if gender is female, and vice versa)
  if (genderContext) {
    const allowed = allEntries
      .filter(([, categoryGender]) => {
        // Include matching gender categories
        if (categoryGender === genderContext) return true;
        // Include unisex categories (for both genders)
        if (categoryGender === 'unisex') return true;
        // Exclude opposite gender categories
        return false;
      })
      .map(([category]) => category);
    
    logger.debug('buildAllowedCategoriesForClassifier: gender_explicit', {
      genderContext,
      totalCategories: allEntries.length,
      allowedCategories: allowed.length,
      sampleAllowed: allowed.slice(0, 10),
      note: `Including ${genderContext} and unisex categories, excluding opposite gender categories`,
    });
    
    return { categoriesForPrompt: allowed, usedStrictMajorityMode: false };
  }

  // Case 2: Gender is NOT interpretable (ambiguous query)
  // If product type is explicitly mentioned, include ALL categories (male, female, unisex)
  // This allows matching "top" to "Tops" even when gender is ambiguous
  // Otherwise, only show categories with strict gender majority (≥95%: male or female, NOT unisex)
  if (hasExplicitProductType) {
    const allowed = allEntries.map(([category]) => category);
    
    logger.debug('buildAllowedCategoriesForClassifier: gender_ambiguous_with_product_type', {
      genderContext: null,
      totalCategories: allEntries.length,
      allowedCategories: allowed.length,
      sampleAllowed: allowed.slice(0, 10),
      note: 'Product type explicitly mentioned - including all categories (male, female, unisex) for gender-agnostic matching',
    });
    
    return { categoriesForPrompt: allowed, usedStrictMajorityMode: false };
  }

  // Case 3: Gender ambiguous AND no explicit product type
  // Only show categories with strict gender majority (≥95%: male or female, NOT unisex)
  // This ensures the classifier only sees clearly gendered categories when gender is unknown
  const allowed = allEntries
    .filter(([, categoryGender]) => categoryGender === 'male' || categoryGender === 'female')
    .map(([category]) => category);
  
  logger.debug('buildAllowedCategoriesForClassifier: gender_ambiguous_strict_majority', {
    genderContext: null,
    totalCategories: allEntries.length,
    strictMajorityCategories: allowed.length,
    sampleAllowed: allowed.slice(0, 10),
    note: 'Using only strict gender majority categories (≥95% male or female) for ambiguous queries',
  });
  
  return { categoriesForPrompt: allowed, usedStrictMajorityMode: true };
}

/**
 * Compute gender context for classifier from query and last constraints
 * 
 * Priority:
 * 1. Explicit gender from current query text
 * 2. Gender from last constraints (follow-up context)
 * 3. null (ambiguous - will trigger strict majority mode)
 */
export function computeGenderContext(
  message: string,
  lastConstraints?: FashionConstraints | null
): 'male' | 'female' | null {
  // 1. Check for explicit gender in current query
  const explicitGender = detectGenderFromQuery(message);
  if (explicitGender) {
    return explicitGender;
  }
  
  // 2. Check last constraints (follow-up context)
  if (lastConstraints?.gender && lastConstraints.gender !== 'unisex') {
    return lastConstraints.gender as 'male' | 'female';
  }
  
  // 3. No gender signal - ambiguous
  return null;
}

/**
 * Classify query and extract constraints using LLM
 * Returns extended metadata including gender context and strict majority mode flag
 */
export async function classifyQueryWithMetadata(
  message: string,
  lastConstraints?: FashionConstraints | null,
  enhancedQuery?: string | null,
  classifiedCategories?: string[]
): Promise<ClassificationWithMetadata> {
  const startTime = Date.now();
  const queryForClassification = enhancedQuery || message;
  
  logger.info('classifyQuery: starting', {
    query: queryForClassification.substring(0, 100),
    hasLastConstraints: !!lastConstraints,
    hasEnhancedQuery: !!enhancedQuery,
  });

  // STEP 1: Compute gender context BEFORE calling LLM
  const genderContext = computeGenderContext(message, lastConstraints);
  
  logger.info('classifyQuery: gender_context_computed', {
    query: queryForClassification.substring(0, 100),
    genderContext,
    lastConstraintsGender: lastConstraints?.gender,
    note: 'Gender context computed before building classifier prompt',
  });
  
  // STEP 2: Detect if product type is explicitly mentioned (for gender-agnostic category matching)
  const queryLower = queryForClassification.toLowerCase();
  const productTypeKeywords = [
    'top', 'tops', 'dress', 'dresses', 'jeans', 'pants', 'shirt', 'shirts', 'blouse', 'blouses',
    'skirt', 'skirts', 'shorts', 'swimsuit', 'swimwear', 'bikini', 'loungewear', 'pajama', 'robe',
    'sweater', 'sweaters', 'cardigan', 'cardigans', 'jacket', 'jackets', 'coat', 'activewear',
    'jewelry', 'accessories', 'bag', 'bags', 'tote', 'wallet', 'belt', 'scarf',
    'perfume', 'perfumes', 'fragrance', 'scents',
    'bedding', 'bed sheets', 'towels', 'candle', 'candles', 'decor', 'decoration', 'tabletop',
    'kitchenware', 'dishware', 'bottoms', 'hoodie', 'hoodies', 'pullover', 'pullovers'
  ];
  const hasExplicitProductType = productTypeKeywords.some(keyword => queryLower.includes(keyword));
  
  // STEP 3: Build allowed categories based on gender context and product type detection
  const { categoriesForPrompt, usedStrictMajorityMode } = buildAllowedCategoriesForClassifier(genderContext, hasExplicitProductType);
  
  logger.info('classifyQuery: allowed_categories_computed', {
    query: queryForClassification.substring(0, 100),
    genderContext,
    usedStrictMajorityMode,
    allowedCategoryCount: categoriesForPrompt.length,
    sampleCategories: categoriesForPrompt.slice(0, 15),
    note: 'Category list filtered based on gender context before building classifier prompt',
  });

  try {
    const lastConstraintsText = lastConstraints 
      ? JSON.stringify(lastConstraints, null, 2)
      : 'null';
    
    // STEP 3: Build prompt with gender-filtered categories and category-specific dictionaries
    const basePrompt = buildQueryClassifierPrompt(categoriesForPrompt, classifiedCategories);
    const prompt = basePrompt
      .replace('{QUERY}', queryForClassification)
      .replace('{LAST_CONSTRAINTS}', lastConstraintsText);

    const llmStartTime = Date.now();
    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a shopping assistant for a fashion brand serving both men\'s and women\'s customers. Classify queries and extract ALL possible constraints from context using semantic understanding. Think like a stylist who understands cultural sensitivity, appropriateness, and what works for different contexts across genders. Extract both explicit and inferred constraints, ensuring explicit mentions override inferred ones.\n\n**GENDER EXTRACTION**: Extract gender from keywords like "mens", "womens", "for him", "for her", etc. Leave as null if not explicitly mentioned.\n\nCRITICAL: You MUST extract ALL explicit constraints mentioned in the query. Examples:\n- "blue maxi dresses" MUST extract colors: ["Blue"] AND lengths: ["Maxi"] AND gender: "female"\n- "red mini dress" MUST extract colors: ["Red"] AND lengths: ["Mini"] AND gender: "female"\n- "slim black jeans for work" MUST extract fits: ["Slim"] AND colors: ["Black"] AND occasions: ["Work"]\n- "men\'s t-shirts size medium" MUST extract gender: "male" AND sizes: ["M"]\n\nDo NOT omit any explicitly mentioned constraints. Extract gender, fits, rises, colors, lengths, sleeveLengths, sizes, and all other attributes.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA,
      maxTokens: 2000, // Increased from 1000 to allow full constraint extraction
    });
    const llmDuration = Date.now() - llmStartTime;

    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as any;

    // Log raw LLM response for debugging constraint extraction
    logger.info('classifyQuery: llm_raw_response', {
      query: queryForClassification.substring(0, 100),
      rawTextLength: result.rawText.length,
      parsedType: parsed.type,
      parsedConstraints: parsed.constraints,
      parsedColors: parsed.constraints?.colors,
      parsedLengths: parsed.constraints?.lengths,
      parsedSleeveLengths: parsed.constraints?.sleeveLengths,
      parsedAgeGroups: parsed.constraints?.ageGroups,
      note: 'Raw LLM response for constraint extraction debugging',
    });

    // Helper to extract values from either old or new format
    // CRITICAL: Preserve intent format if it exists (for excluded constraints)
    // This is essential for excluded constraints to work correctly
    const extractArrayValues = (constraint: any): string[] | ConstraintWithIntent | null | undefined => {
      if (!constraint) return constraint;
      if (Array.isArray(constraint)) return constraint; // Old format (array)
      // If it has intent format (e.g., { values: ['Black'], intent: 'excluded' }), preserve it
      if (constraint.intent && constraint.values && Array.isArray(constraint.values)) {
        return constraint as ConstraintWithIntent; // Return full intent format
      }
      // If it has values but no intent, extract just values (backward compatibility)
      if (constraint.values && Array.isArray(constraint.values)) return constraint.values;
      return null;
    };

    const extractPriceValue = (constraint: any): number | null | undefined => {
      if (constraint === null || constraint === undefined) return constraint;
      if (typeof constraint === 'number') return constraint; // Old format
      if (constraint.value && typeof constraint.value === 'number') return constraint.value; // New format
      return null;
    };

    const extractStringValue = (constraint: any): string | null | undefined => {
      if (constraint === null || constraint === undefined) return constraint;
      if (typeof constraint === 'string') return constraint; // Old format
      if (constraint.value && typeof constraint.value === 'string') return constraint.value; // New format
      return null;
    };

    const extractBooleanValue = (constraint: any): boolean | null | undefined => {
      if (constraint === null || constraint === undefined) return constraint;
      if (typeof constraint === 'boolean') return constraint; // Old format
      if (constraint.value && typeof constraint.value === 'boolean') return constraint.value; // New format
      return null;
    };

    // Helper to detect if constraints are inferred from modesty/cultural context
    // Returns true if constraint should be wrapped in ConstraintWithIntent format with intent: 'strong'
    const shouldWrapInferredConstraintAsStrong = (
      constraint: string[] | ConstraintWithIntent | null | undefined,
      query: string,
      constraintType: 'necklines' | 'sleeveLengths' | 'lengths'
    ): boolean => {
      if (!constraint) return false;
      
      // Check if already in intent format
      if (typeof constraint === 'object' && constraint !== null && 'values' in constraint) return false;
      
      // Must be an array (not ConstraintWithIntent)
      if (!Array.isArray(constraint)) return false;
      
      const constraintArray: string[] = constraint;
      if (constraintArray.length === 0) return false;
      
      const queryLower = query.toLowerCase();
      const modestyKeywords = ['modest', 'muslim', 'islamic', 'conservative', 'traditional wedding', 'religious'];
      const isModestyContext = modestyKeywords.some(kw => queryLower.includes(kw));
      
      if (!isModestyContext) return false;
      
      // For lengths: check if values match inferred modesty lengths
      if (constraintType === 'lengths') {
        const modestyLengths = ['maxi', 'midi'];
        const hasModestyLength = constraintArray.some(v => 
          modestyLengths.some(ml => v.toLowerCase().includes(ml.toLowerCase()))
        );
        return hasModestyLength;
      }
      
      // For necklines: check if values match inferred modesty necklines
      if (constraintType === 'necklines') {
        const modestyNecklines = ['high neck', 'round neck', 'mock neck', 'turtleneck', 'boat neck'];
        const hasModestyNeckline = constraintArray.some(v => 
          modestyNecklines.some(mn => v.toLowerCase().includes(mn.toLowerCase()))
        );
        return hasModestyNeckline;
      }
      
      // For sleeveLengths: check if values match inferred modesty sleeves
      if (constraintType === 'sleeveLengths') {
        const modestySleeves = ['long sleeve', 'three-quarter sleeve'];
        const hasModestySleeve = constraintArray.some(v => 
          modestySleeves.some(ms => v.toLowerCase().includes(ms.toLowerCase()))
        );
        return hasModestySleeve;
      }
      
      return false;
    };

    // Normalize product terms
    const productTerms = parsed.productTerms 
      ? normalizeQueryForSearch(parsed.productTerms)
      : normalizeQueryForSearch(queryForClassification);

    // Normalize constraints from intent format to old format (for backward compatibility)
    const normalizedConstraints: FashionConstraints = {};

    // Extract and log constraint extraction results for debugging
    const extractedColors = parsed.constraints.colors ? extractArrayValues(parsed.constraints.colors) : null;
    const extractedLengths = parsed.constraints.lengths ? extractArrayValues(parsed.constraints.lengths) : null;
    const extractedSleeveLengths = parsed.constraints.sleeveLengths ? extractArrayValues(parsed.constraints.sleeveLengths) : null;
    const extractedAgeGroups = parsed.constraints.ageGroups ? extractArrayValues(parsed.constraints.ageGroups) : null;

    logger.info('classifyQuery: constraint_extraction_results', {
      query: queryForClassification.substring(0, 100),
      extractedColors,
      extractedLengths,
      extractedSleeveLengths,
      extractedAgeGroups,
      colorsFormat: parsed.constraints.colors ? (Array.isArray(parsed.constraints.colors) ? 'array' : typeof parsed.constraints.colors) : 'null',
      lengthsFormat: parsed.constraints.lengths ? (Array.isArray(parsed.constraints.lengths) ? 'array' : typeof parsed.constraints.lengths) : 'null',
      sleeveLengthsFormat: parsed.constraints.sleeveLengths ? (Array.isArray(parsed.constraints.sleeveLengths) ? 'array' : typeof parsed.constraints.sleeveLengths) : 'null',
      ageGroupsFormat: parsed.constraints.ageGroups ? (Array.isArray(parsed.constraints.ageGroups) ? 'array' : typeof parsed.constraints.ageGroups) : 'null',
      note: 'Extracted constraints after normalization - verify all explicit constraints were extracted',
    });

    // Normalize array constraints
    if (parsed.constraints.colors) {
      normalizedConstraints.colors = extractArrayValues(parsed.constraints.colors);
    }
    if (parsed.constraints.sizes) {
      normalizedConstraints.sizes = extractArrayValues(parsed.constraints.sizes);
    }
    if (parsed.constraints.occasions) {
      normalizedConstraints.occasions = extractArrayValues(parsed.constraints.occasions);
    }
    if (parsed.constraints.styles) {
      normalizedConstraints.styles = extractArrayValues(parsed.constraints.styles);
    }
    if (parsed.constraints.patterns) {
      normalizedConstraints.patterns = extractArrayValues(parsed.constraints.patterns);
    }
    if (parsed.constraints.seasons) {
      normalizedConstraints.seasons = extractArrayValues(parsed.constraints.seasons);
    }
    if (parsed.constraints.materials) {
      normalizedConstraints.materials = extractArrayValues(parsed.constraints.materials);
    }
    if (parsed.constraints.fits) {
      normalizedConstraints.fits = extractArrayValues(parsed.constraints.fits);
    }
    if (parsed.constraints.collections) {
      normalizedConstraints.collections = extractArrayValues(parsed.constraints.collections);
    }
    if (parsed.constraints.embellishments) {
      normalizedConstraints.embellishments = extractArrayValues(parsed.constraints.embellishments);
    }
    if (parsed.constraints.necklines) {
      normalizedConstraints.necklines = extractArrayValues(parsed.constraints.necklines);
    }
    if (parsed.constraints.sleeveLengths) {
      normalizedConstraints.sleeveLengths = extractArrayValues(parsed.constraints.sleeveLengths);
    }
    if (parsed.constraints.ageGroups) {
      normalizedConstraints.ageGroups = extractArrayValues(parsed.constraints.ageGroups);
    }
    if (parsed.constraints.inclusivitySizing) {
      normalizedConstraints.inclusivitySizing = extractArrayValues(parsed.constraints.inclusivitySizing);
    }
    if (parsed.constraints.setVsSingle) {
      // setVsSingle can be a string or ConstraintWithIntent
      if (typeof parsed.constraints.setVsSingle === 'string') {
        normalizedConstraints.setVsSingle = parsed.constraints.setVsSingle;
      } else if (parsed.constraints.setVsSingle && typeof parsed.constraints.setVsSingle === 'object' && 'values' in parsed.constraints.setVsSingle) {
        // Extract first value from array (should be "Set" or "Single")
        const values = parsed.constraints.setVsSingle.values;
        if (values && values.length > 0) {
          normalizedConstraints.setVsSingle = values[0]; // Take first value
        }
      }
    }
    if (parsed.constraints.lengths) {
      normalizedConstraints.lengths = extractArrayValues(parsed.constraints.lengths);
    }
    if (parsed.constraints.formalityLevel) {
      normalizedConstraints.formalityLevel = extractArrayValues(parsed.constraints.formalityLevel);
    }
    if (parsed.constraints.occasionContext) {
      normalizedConstraints.occasionContext = extractArrayValues(parsed.constraints.occasionContext);
    }
    if (parsed.constraints.problemSolutions) {
      normalizedConstraints.problemSolutions = extractArrayValues(parsed.constraints.problemSolutions);
    }
    if (parsed.constraints.functionFeatures) {
      normalizedConstraints.functionFeatures = extractArrayValues(parsed.constraints.functionFeatures);
    }
    if (parsed.constraints.colorShade) {
      normalizedConstraints.colorShade = extractArrayValues(parsed.constraints.colorShade);
    }
    if (parsed.constraints.colorUndertone) {
      normalizedConstraints.colorUndertone = extractArrayValues(parsed.constraints.colorUndertone);
    }
    if (parsed.constraints.seasonalPalette) {
      normalizedConstraints.seasonalPalette = extractArrayValues(parsed.constraints.seasonalPalette);
    }
    if (parsed.constraints.modestyCues) {
      normalizedConstraints.modestyCues = extractArrayValues(parsed.constraints.modestyCues);
    }
    if (parsed.constraints.careRequirements) {
      normalizedConstraints.careRequirements = extractArrayValues(parsed.constraints.careRequirements);
    }
    if (parsed.constraints.travelFeatures) {
      normalizedConstraints.travelFeatures = extractArrayValues(parsed.constraints.travelFeatures);
    }
    if (parsed.constraints.ecoMaterials) {
      normalizedConstraints.ecoMaterials = extractArrayValues(parsed.constraints.ecoMaterials);
    }
    if (parsed.constraints.scents) {
      normalizedConstraints.scents = extractArrayValues(parsed.constraints.scents);
    }
    if (parsed.constraints.rooms) {
      normalizedConstraints.rooms = extractArrayValues(parsed.constraints.rooms);
    }
    if (parsed.constraints.useCases) {
      normalizedConstraints.useCases = extractArrayValues(parsed.constraints.useCases);
    }
    if (parsed.constraints.benefits) {
      normalizedConstraints.benefits = extractArrayValues(parsed.constraints.benefits);
    }
    if (parsed.constraints.claims) {
      normalizedConstraints.claims = extractArrayValues(parsed.constraints.claims);
    }
    if (parsed.constraints.compatibility) {
      normalizedConstraints.compatibility = extractArrayValues(parsed.constraints.compatibility);
    }

    // Normalize price constraints
    if (parsed.constraints.priceMinCents !== undefined) {
      normalizedConstraints.priceMinCents = extractPriceValue(parsed.constraints.priceMinCents);
    }
    if (parsed.constraints.priceMaxCents !== undefined) {
      normalizedConstraints.priceMaxCents = extractPriceValue(parsed.constraints.priceMaxCents);
    }

    // Normalize string constraints
    if (parsed.constraints.temperatureIntent !== undefined) {
      normalizedConstraints.temperatureIntent = extractStringValue(parsed.constraints.temperatureIntent);
    }
    if (parsed.constraints.rainWind !== undefined) {
      normalizedConstraints.rainWind = extractStringValue(parsed.constraints.rainWind);
    }
    if (parsed.constraints.pockets !== undefined) {
      normalizedConstraints.pockets = extractStringValue(parsed.constraints.pockets);
    }
    if (parsed.constraints.liningType !== undefined) {
      normalizedConstraints.liningType = extractStringValue(parsed.constraints.liningType);
    }
    if (parsed.constraints.braSolution !== undefined) {
      normalizedConstraints.braSolution = extractStringValue(parsed.constraints.braSolution);
    }
    if (parsed.constraints.certifications !== undefined) {
      normalizedConstraints.certifications = extractStringValue(parsed.constraints.certifications);
    }
    if (parsed.constraints.origin !== undefined) {
      normalizedConstraints.origin = extractStringValue(parsed.constraints.origin);
    }
    if (parsed.constraints.adaptiveFeatures !== undefined) {
      normalizedConstraints.adaptiveFeatures = extractStringValue(parsed.constraints.adaptiveFeatures);
    }
    if (parsed.constraints.sensoryFriendly !== undefined) {
      normalizedConstraints.sensoryFriendly = extractStringValue(parsed.constraints.sensoryFriendly);
    }
    if (parsed.constraints.finish !== undefined) {
      normalizedConstraints.finish = extractStringValue(parsed.constraints.finish);
    }
    if (parsed.constraints.layeringIntent !== undefined) {
      normalizedConstraints.layeringIntent = extractStringValue(parsed.constraints.layeringIntent);
    }
    if (parsed.constraints.pairingIntent !== undefined) {
      normalizedConstraints.pairingIntent = extractStringValue(parsed.constraints.pairingIntent);
    }
    if (parsed.constraints.sensoryProfile !== undefined) {
      normalizedConstraints.sensoryProfile = extractStringValue(parsed.constraints.sensoryProfile);
    }

    // Normalize boolean constraints
    if (parsed.constraints.humidityFriendly !== undefined) {
      normalizedConstraints.humidityFriendly = extractBooleanValue(parsed.constraints.humidityFriendly);
    }
    if (parsed.constraints.multicolor !== undefined) {
      normalizedConstraints.multicolor = extractBooleanValue(parsed.constraints.multicolor);
    }

    // Log all extracted constraints and product type hints
    const constraintsSummary: Record<string, any> = {};
    if (normalizedConstraints.colors) constraintsSummary.colors = normalizedConstraints.colors;
    if (normalizedConstraints.sizes) constraintsSummary.sizes = normalizedConstraints.sizes;
    if (normalizedConstraints.occasions) constraintsSummary.occasions = normalizedConstraints.occasions;
    if (normalizedConstraints.styles) constraintsSummary.styles = normalizedConstraints.styles;
    if (normalizedConstraints.patterns) constraintsSummary.patterns = normalizedConstraints.patterns;
    if (normalizedConstraints.materials) constraintsSummary.materials = normalizedConstraints.materials;
    if (normalizedConstraints.seasons) constraintsSummary.seasons = normalizedConstraints.seasons;
    // Validate fits
    if (normalizedConstraints.fits) {
      const fitValues = extractConstraintValues(normalizedConstraints.fits) || (Array.isArray(normalizedConstraints.fits) ? normalizedConstraints.fits : []);
      const fitIntent = extractConstraintIntent(normalizedConstraints.fits);
      const validated = validateConstraintValues('fits', fitValues);
      if (validated && validated.length > 0) {
        const finalFits = fitIntent ? { values: validated, intent: fitIntent } : validated;
        constraintsSummary.fits = finalFits;
        normalizedConstraints.fits = finalFits;
      } else {
        constraintsSummary.fits = null;
        normalizedConstraints.fits = null;
        logger.warn('classifier_constraint_validation: invalid fits', {
          query: queryForClassification.substring(0, 100),
          providedValues: fitValues,
        });
      }
    }
    
    // Validate rises
    if (normalizedConstraints.rises) {
      const riseValues = extractConstraintValues(normalizedConstraints.rises) || (Array.isArray(normalizedConstraints.rises) ? normalizedConstraints.rises : []);
      const riseIntent = extractConstraintIntent(normalizedConstraints.rises);
      const validated = validateConstraintValues('rises', riseValues);
      if (validated && validated.length > 0) {
        const finalRises = riseIntent ? { values: validated, intent: riseIntent } : validated;
        constraintsSummary.rises = finalRises;
        normalizedConstraints.rises = finalRises;
      } else {
        constraintsSummary.rises = null;
        normalizedConstraints.rises = null;
        logger.warn('classifier_constraint_validation: invalid rises', {
          query: queryForClassification.substring(0, 100),
          providedValues: riseValues,
        });
      }
    }
    
    if (normalizedConstraints.collections) constraintsSummary.collections = normalizedConstraints.collections;
    if (normalizedConstraints.embellishments) constraintsSummary.embellishments = normalizedConstraints.embellishments;
    
    // Validate necklines
    if (normalizedConstraints.necklines) {
      const necklineValues = extractConstraintValues(normalizedConstraints.necklines) || (Array.isArray(normalizedConstraints.necklines) ? normalizedConstraints.necklines : []);
      const necklineIntent = extractConstraintIntent(normalizedConstraints.necklines);
      const validated = validateConstraintValues('necklines', necklineValues);
      if (validated && validated.length > 0) {
        const finalNecklines = necklineIntent ? { values: validated, intent: necklineIntent } : validated;
        constraintsSummary.necklines = finalNecklines;
        normalizedConstraints.necklines = finalNecklines;
      } else {
        constraintsSummary.necklines = null;
        normalizedConstraints.necklines = null;
        logger.warn('classifier_constraint_validation: invalid necklines', {
          query: queryForClassification.substring(0, 100),
          providedValues: necklineValues,
        });
      }
    }
    
    // Validate sleeveLengths
    if (normalizedConstraints.sleeveLengths) {
      const sleeveValues = extractConstraintValues(normalizedConstraints.sleeveLengths) || (Array.isArray(normalizedConstraints.sleeveLengths) ? normalizedConstraints.sleeveLengths : []);
      const sleeveIntent = extractConstraintIntent(normalizedConstraints.sleeveLengths);
      const validated = validateConstraintValues('sleeveLengths', sleeveValues);
      if (validated && validated.length > 0) {
        const finalSleeves = sleeveIntent ? { values: validated, intent: sleeveIntent } : validated;
        constraintsSummary.sleeveLengths = finalSleeves;
        normalizedConstraints.sleeveLengths = finalSleeves;
      } else {
        constraintsSummary.sleeveLengths = null;
        normalizedConstraints.sleeveLengths = null;
        logger.warn('classifier_constraint_validation: invalid sleeveLengths', {
          query: queryForClassification.substring(0, 100),
          providedValues: sleeveValues,
        });
      }
    }
    
    if (normalizedConstraints.ageGroups) {
      // CRITICAL: First normalize, then validate against dictionary
      // This ensures only exact dataset values are used
      // Extract values if it's in intent format, preserve intent after validation
      const ageGroupValues = extractConstraintValues(normalizedConstraints.ageGroups) || (Array.isArray(normalizedConstraints.ageGroups) ? normalizedConstraints.ageGroups : []);
      const ageGroupIntent = extractConstraintIntent(normalizedConstraints.ageGroups);
      let normalized = normalizeAgeGroups(ageGroupValues);
      
      // CRITICAL: Validate extracted age groups against the original query
      // If the query mentions a specific age (e.g., "12 year old") but the LLM extracted
      // a different age group (e.g., "Kids"), correct it based on the query pattern
      const queryText = (enhancedQuery || message).toLowerCase();
      
      // Check for age patterns in the query and validate/correct the extracted age group
      const agePatternChecks = [
        // Tween (10-12)
        { pattern: /\b(10|11|12)[\s-]*(?:year|years)[\s-]*old\b/, expectedAgeGroup: 'Tween' },
        { pattern: /\b(?:for my|for|my)[\s]+(10|11|12)[\s]*(?:year|years)[\s]*old\b/, expectedAgeGroup: 'Tween' },
        { pattern: /\bage[\s]+(10|11|12)\b/, expectedAgeGroup: 'Tween' },
        // Teen (13-19)
        { pattern: /\b(13|14|15|16|17|18|19)[\s-]*(?:year|years)[\s-]*old\b/, expectedAgeGroup: 'Teen' },
        { pattern: /\b(?:for my|for|my)[\s]+(13|14|15|16|17|18|19)[\s]*(?:year|years)[\s]*old\b/, expectedAgeGroup: 'Teen' },
        { pattern: /\bage[\s]+(13|14|15|16|17|18|19)\b/, expectedAgeGroup: 'Teen' },
        // Kids (4-9)
        { pattern: /\b(4|5|6|7|8|9)[\s-]*(?:year|years)[\s-]*old\b/, expectedAgeGroup: 'Kids' },
        { pattern: /\b(?:for my|for|my)[\s]+(4|5|6|7|8|9)[\s]*(?:year|years)[\s]*old\b/, expectedAgeGroup: 'Kids' },
        { pattern: /\bage[\s]+(4|5|6|7|8|9)\b/, expectedAgeGroup: 'Kids' },
        // Toddler (2-3)
        { pattern: /\b(2|3)[\s-]*(?:year|years)[\s-]*old\b/, expectedAgeGroup: 'Toddler' },
        { pattern: /\b(?:for my|for|my)[\s]+(2|3)[\s]*(?:year|years)[\s]*old\b/, expectedAgeGroup: 'Toddler' },
        { pattern: /\bage[\s]+(2|3)\b/, expectedAgeGroup: 'Toddler' },
      ];
      
      for (const { pattern, expectedAgeGroup } of agePatternChecks) {
        if (pattern.test(queryText)) {
          const expectedNormalized = normalizeAgeGroups([expectedAgeGroup]);
          const expectedValidated = validateAgeGroups(expectedNormalized);
          
          // If the extracted age group doesn't match the expected one from the query,
          // override it with the correct one
          if (expectedValidated.length > 0) {
            const extractedMatchesExpected = normalized.some(ag => 
              expectedValidated.some(eag => ag.toLowerCase() === eag.toLowerCase())
            );
            
            if (!extractedMatchesExpected) {
              logger.warn('age_group_mismatch_corrected', {
                query: message.substring(0, 100),
                enhancedQuery: enhancedQuery?.substring(0, 100),
                extractedAgeGroups: normalized,
                expectedAgeGroup: expectedValidated,
                note: 'Age group extracted by LLM did not match query pattern - corrected to match query',
              });
              normalized = expectedValidated;
            }
          }
          break; // Only check the first matching pattern
        }
      }
      
      // CRITICAL: Check if "for adult" or similar adult terminology appears at the END of the query
      // If so, REPLACE all earlier age groups with just ["Adult"]
      // This handles cases like "clothes for my 6 year old and 12 year old only red dresses for adult"
      const originalQueryText = (enhancedQuery || message);
      const adultTermPattern = /\b(for\s+(?:adult|adults|women|men|ladies|gentlemen|woman|man))\b/i;
      const adultTermMatches = originalQueryText.match(adultTermPattern);
      if (adultTermMatches && adultTermMatches.length > 0) {
        // Check if the adult term appears near the END of the query (last 30% of query length)
        // Use the original (not lowercased) query for index calculation
        const matchIndex = adultTermMatches[0] ? originalQueryText.indexOf(adultTermMatches[0]) : -1;
        const queryLength = originalQueryText.length;
        const isNearEnd = matchIndex >= queryLength * 0.7; // Last 30% of query
        
        if (isNearEnd) {
          // REPLACE all age groups with just ["Adult"]
          logger.info('age_group_replacement_detected', {
            query: message.substring(0, 100),
            originalAgeGroups: normalized,
            replacementReason: `Adult terminology ("${adultTermMatches[0]}") appears at end of query and replaces earlier age mentions`,
            matchIndex,
            queryLength,
            isNearEnd,
            note: 'Age group constraint REPLACED (not merged) - adult terminology at end takes precedence',
          });
          normalized = ['Adult'];
        }
      }
      
      const validatedAgeGroups = validateAgeGroups(normalized);
      
      // Preserve intent format after validation
      const finalAgeGroups = validatedAgeGroups.length > 0 
        ? (ageGroupIntent ? { values: validatedAgeGroups, intent: ageGroupIntent } : validatedAgeGroups)
        : null;
      constraintsSummary.ageGroups = finalAgeGroups;
      normalizedConstraints.ageGroups = finalAgeGroups;
    } else {
      // FALLBACK: If no age groups extracted but query contains age-related keywords or patterns,
      // try to infer at least one age group from the query text
      const queryLower = (enhancedQuery || message).toLowerCase();
      
      // First, try to match age patterns like "12 year old", "12-year-old", etc.
      const agePatternMatches = [
        // Tween (10-12)
        { pattern: /\b(10|11|12)[\s-]*(?:year|years)[\s-]*old\b/, ageGroup: 'Tween' },
        { pattern: /\b(?:for my|for|my)[\s]+(10|11|12)[\s]*(?:year|years)[\s]*old\b/, ageGroup: 'Tween' },
        { pattern: /\bage[\s]+(10|11|12)\b/, ageGroup: 'Tween' },
        // Teen (13-19)
        { pattern: /\b(13|14|15|16|17|18|19)[\s-]*(?:year|years)[\s-]*old\b/, ageGroup: 'Teen' },
        { pattern: /\b(?:for my|for|my)[\s]+(13|14|15|16|17|18|19)[\s]*(?:year|years)[\s]*old\b/, ageGroup: 'Teen' },
        { pattern: /\bage[\s]+(13|14|15|16|17|18|19)\b/, ageGroup: 'Teen' },
        // Kids (4-9)
        { pattern: /\b(4|5|6|7|8|9)[\s-]*(?:year|years)[\s-]*old\b/, ageGroup: 'Kids' },
        { pattern: /\b(?:for my|for|my)[\s]+(4|5|6|7|8|9)[\s]*(?:year|years)[\s]*old\b/, ageGroup: 'Kids' },
        { pattern: /\bage[\s]+(4|5|6|7|8|9)\b/, ageGroup: 'Kids' },
        // Toddler (2-3)
        { pattern: /\b(2|3)[\s-]*(?:year|years)[\s-]*old\b/, ageGroup: 'Toddler' },
        { pattern: /\b(?:for my|for|my)[\s]+(2|3)[\s]*(?:year|years)[\s]*old\b/, ageGroup: 'Toddler' },
        { pattern: /\bage[\s]+(2|3)\b/, ageGroup: 'Toddler' },
      ];
      
      let inferredAgeGroup: string | null = null;
      for (const { pattern, ageGroup } of agePatternMatches) {
        if (pattern.test(queryLower)) {
          inferredAgeGroup = ageGroup;
          break;
        }
      }
      
      // If no pattern matched, try keyword matching
      if (!inferredAgeGroup) {
        const ageKeywords = {
          'baby': 'Baby',
          'infant': 'Baby',
          'toddler': 'Toddler',
          'kids': 'Kids',
          'children': 'Kids',
          'child': 'Kids',
          'teen': 'Teen',
          'teenager': 'Teen',
          'tween': 'Tween',
          'pre-teen': 'Tween',
          'preteen': 'Tween',
          'adult': 'Adult',
          'women': 'Adult',
          'men': 'Adult',
        };
        
        for (const [keyword, ageGroup] of Object.entries(ageKeywords)) {
          if (new RegExp(`\\b${keyword}\\b`).test(queryLower)) {
            inferredAgeGroup = ageGroup;
            break;
          }
        }
      }
      
      if (inferredAgeGroup) {
        const normalized = normalizeAgeGroups([inferredAgeGroup]);
        const validated = validateAgeGroups(normalized);
        if (validated.length > 0) {
          constraintsSummary.ageGroups = validated;
          normalizedConstraints.ageGroups = validated;
          logger.info('age_group_inferred_from_fallback', {
            query: message.substring(0, 100),
            enhancedQuery: enhancedQuery?.substring(0, 100),
            inferredAgeGroups: validated,
            source: 'pattern_or_keyword_fallback',
            note: 'Age group was not extracted by LLM but inferred from query patterns or keywords as fallback',
          });
        }
      }
    }
    
    // Validate all constraints against dictionaries
    // This ensures only values that exist in the database are used
    
    if (normalizedConstraints.colors) {
      // CRITICAL: Validate colors against dictionary
      // This ensures only exact dataset values are used
      // Extract values if it's in intent format, preserve intent after validation
      const colorValues = extractConstraintValues(normalizedConstraints.colors) || (Array.isArray(normalizedConstraints.colors) ? normalizedConstraints.colors : []);
      const colorIntent = extractConstraintIntent(normalizedConstraints.colors);
      const validated = validateColors(colorValues);
      if (validated.length > 0) {
        const finalColors = colorIntent ? { values: validated, intent: colorIntent } : validated;
        constraintsSummary.colors = finalColors;
        normalizedConstraints.colors = finalColors;
      } else {
        // No valid colors found - remove from constraints
        constraintsSummary.colors = null;
        normalizedConstraints.colors = null;
        logger.warn('classifier_constraint_validation: invalid colors', {
          query: queryForClassification.substring(0, 100),
          providedValues: colorValues,
        });
      }
    }
    
    // Validate materials
    if (normalizedConstraints.materials) {
      const materialValues = extractConstraintValues(normalizedConstraints.materials) || (Array.isArray(normalizedConstraints.materials) ? normalizedConstraints.materials : []);
      const materialIntent = extractConstraintIntent(normalizedConstraints.materials);
      const validated = validateConstraintValues('materials', materialValues);
      if (validated && validated.length > 0) {
        const finalMaterials = materialIntent ? { values: validated, intent: materialIntent } : validated;
        constraintsSummary.materials = finalMaterials;
        normalizedConstraints.materials = finalMaterials;
      } else {
        constraintsSummary.materials = null;
        normalizedConstraints.materials = null;
        logger.warn('classifier_constraint_validation: invalid materials', {
          query: queryForClassification.substring(0, 100),
          providedValues: normalizedConstraints.materials,
        });
      }
    }
    
    // Validate occasions
    if (normalizedConstraints.occasions) {
      const occasionValues = extractConstraintValues(normalizedConstraints.occasions) || (Array.isArray(normalizedConstraints.occasions) ? normalizedConstraints.occasions : []);
      const occasionIntent = extractConstraintIntent(normalizedConstraints.occasions);
      const validated = validateConstraintValues('occasions', occasionValues);
      if (validated && validated.length > 0) {
        const finalOccasions = occasionIntent ? { values: validated, intent: occasionIntent } : validated;
        constraintsSummary.occasions = finalOccasions;
        normalizedConstraints.occasions = finalOccasions;
      } else {
        constraintsSummary.occasions = null;
        normalizedConstraints.occasions = null;
        logger.warn('classifier_constraint_validation: invalid occasions', {
          query: queryForClassification.substring(0, 100),
          providedValues: occasionValues,
        });
      }
    }
    
    // Validate styles
    if (normalizedConstraints.styles) {
      const styleValues = extractConstraintValues(normalizedConstraints.styles) || (Array.isArray(normalizedConstraints.styles) ? normalizedConstraints.styles : []);
      const styleIntent = extractConstraintIntent(normalizedConstraints.styles);
      const validated = validateConstraintValues('styles', styleValues);
      if (validated && validated.length > 0) {
        const finalStyles = styleIntent ? { values: validated, intent: styleIntent } : validated;
        constraintsSummary.styles = finalStyles;
        normalizedConstraints.styles = finalStyles;
      } else {
        constraintsSummary.styles = null;
        normalizedConstraints.styles = null;
        logger.warn('classifier_constraint_validation: invalid styles', {
          query: queryForClassification.substring(0, 100),
          providedValues: styleValues,
        });
      }
    }
    
    // Validate patterns
    if (normalizedConstraints.patterns) {
      const patternValues = extractConstraintValues(normalizedConstraints.patterns) || (Array.isArray(normalizedConstraints.patterns) ? normalizedConstraints.patterns : []);
      const patternIntent = extractConstraintIntent(normalizedConstraints.patterns);
      const validated = validateConstraintValues('patterns', patternValues);
      if (validated && validated.length > 0) {
        const finalPatterns = patternIntent ? { values: validated, intent: patternIntent } : validated;
        constraintsSummary.patterns = finalPatterns;
        normalizedConstraints.patterns = finalPatterns;
      } else {
        constraintsSummary.patterns = null;
        normalizedConstraints.patterns = null;
        logger.warn('classifier_constraint_validation: invalid patterns', {
          query: queryForClassification.substring(0, 100),
          providedValues: patternValues,
        });
      }
    }
    
    // Validate sizes
    if (normalizedConstraints.sizes) {
      const sizeValues = extractConstraintValues(normalizedConstraints.sizes) || (Array.isArray(normalizedConstraints.sizes) ? normalizedConstraints.sizes : []);
      const sizeIntent = extractConstraintIntent(normalizedConstraints.sizes);
      const validated = validateConstraintValues('sizes', sizeValues);
      if (validated && validated.length > 0) {
        const finalSizes = sizeIntent ? { values: validated, intent: sizeIntent } : validated;
        constraintsSummary.sizes = finalSizes;
        normalizedConstraints.sizes = finalSizes;
      } else {
        constraintsSummary.sizes = null;
        normalizedConstraints.sizes = null;
        logger.warn('classifier_constraint_validation: invalid sizes', {
          query: queryForClassification.substring(0, 100),
          providedValues: sizeValues,
        });
      }
    }
    
    // Validate lengths
    if (normalizedConstraints.lengths) {
      const lengthValues = extractConstraintValues(normalizedConstraints.lengths) || (Array.isArray(normalizedConstraints.lengths) ? normalizedConstraints.lengths : []);
      const lengthIntent = extractConstraintIntent(normalizedConstraints.lengths);
      const validated = validateConstraintValues('lengths', lengthValues);
      if (validated && validated.length > 0) {
        // Wrap in ConstraintWithIntent format with 'strong' intent if inferred and not already wrapped
        let finalLengths: string[] | ConstraintWithIntent;
        if (lengthIntent) {
          finalLengths = { values: validated, intent: lengthIntent };
        } else if (shouldWrapInferredConstraintAsStrong(validated, queryForClassification, 'lengths')) {
          finalLengths = { values: validated, intent: 'strong' };
        } else {
          finalLengths = validated;
        }
        constraintsSummary.lengths = finalLengths;
        normalizedConstraints.lengths = finalLengths;
      } else {
        constraintsSummary.lengths = null;
        normalizedConstraints.lengths = null;
        logger.warn('classifier_constraint_validation: invalid lengths', {
          query: queryForClassification.substring(0, 100),
          providedValues: lengthValues,
        });
      }
    }
    
    // Validate formalityLevel
    if (normalizedConstraints.formalityLevel) {
      const formalityValues = extractConstraintValues(normalizedConstraints.formalityLevel) || (Array.isArray(normalizedConstraints.formalityLevel) ? normalizedConstraints.formalityLevel : []);
      const formalityIntent = extractConstraintIntent(normalizedConstraints.formalityLevel);
      const validated = validateConstraintValues('formalityLevel', formalityValues);
      if (validated && validated.length > 0) {
        const finalFormality = formalityIntent ? { values: validated, intent: formalityIntent } : validated;
        constraintsSummary.formalityLevel = finalFormality;
        normalizedConstraints.formalityLevel = finalFormality;
      } else {
        constraintsSummary.formalityLevel = null;
        normalizedConstraints.formalityLevel = null;
        logger.warn('classifier_constraint_validation: invalid formalityLevel', {
          query: queryForClassification.substring(0, 100),
          providedValues: formalityValues,
        });
      }
    }
    if (normalizedConstraints.priceMinCents !== undefined) constraintsSummary.priceMinCents = normalizedConstraints.priceMinCents;
    if (normalizedConstraints.priceMaxCents !== undefined) constraintsSummary.priceMaxCents = normalizedConstraints.priceMaxCents;
    if (normalizedConstraints.scents) constraintsSummary.scents = normalizedConstraints.scents;
    if (normalizedConstraints.rooms) constraintsSummary.rooms = normalizedConstraints.rooms;
    if (normalizedConstraints.useCases) constraintsSummary.useCases = normalizedConstraints.useCases;
    if (normalizedConstraints.benefits) constraintsSummary.benefits = normalizedConstraints.benefits;
    if (normalizedConstraints.claims) constraintsSummary.claims = normalizedConstraints.claims;
    if (normalizedConstraints.sensoryProfile) constraintsSummary.sensoryProfile = normalizedConstraints.sensoryProfile;
    if (normalizedConstraints.compatibility) constraintsSummary.compatibility = normalizedConstraints.compatibility;

    // Validate that explicitly mentioned constraints were extracted
    const queryLower = queryForClassification.toLowerCase();
    const missingConstraints: string[] = [];
    
    // Check for explicit color mentions
    const colorWords = ['blue', 'red', 'white', 'black', 'pink', 'yellow', 'green', 'navy', 'gray', 'grey', 'beige', 'brown', 'purple', 'orange', 'coral', 'mint', 'lavender', 'blush', 'ivory', 'cream', 'tan', 'teal', 'turquoise', 'emerald', 'burgundy', 'maroon', 'plum', 'charcoal', 'sage', 'olive', 'rust', 'terracotta', 'gold', 'silver', 'peach', 'lemon', 'sky blue', 'baby blue'];
    const hasColorMention = colorWords.some(color => queryLower.includes(color));
    if (hasColorMention && !normalizedConstraints.colors) {
      missingConstraints.push('colors');
    }
    
    // Check for explicit length mentions
    const lengthWords = ['maxi', 'mini', 'midi', 'long dress', 'short dress', 'knee-length', 'ankle-length'];
    const hasLengthMention = lengthWords.some(length => queryLower.includes(length));
    if (hasLengthMention && !normalizedConstraints.lengths) {
      missingConstraints.push('lengths');
    }
    
    // Check for explicit sleeve mentions
    const sleeveWords = ['long sleeves', 'long sleeve', 'short sleeves', 'short sleeve', 'sleeveless', 'cap sleeves', 'three-quarter'];
    const hasSleeveMention = sleeveWords.some(sleeve => queryLower.includes(sleeve));
    if (hasSleeveMention && !normalizedConstraints.sleeveLengths) {
      missingConstraints.push('sleeveLengths');
    }
    
    if (missingConstraints.length > 0) {
      logger.warn('classifier_constraints_missing', {
        query: queryForClassification.substring(0, 200),
        missingConstraints,
        extractedConstraints: Object.keys(constraintsSummary).filter(k => constraintsSummary[k] !== null && constraintsSummary[k] !== undefined),
        note: 'Explicitly mentioned constraints were not extracted by LLM - this may indicate a constraint extraction issue',
      });
    }

    logger.info('classifier_constraints_extracted', {
      query: message.substring(0, 200),
      type: parsed.type,
      productTerms,
      confidence: parsed.confidence,
      constraintsCount: Object.keys(constraintsSummary).length,
      colors: normalizedConstraints.colors,
      lengths: normalizedConstraints.lengths,
      sleeveLengths: normalizedConstraints.sleeveLengths,
      ageGroups: normalizedConstraints.ageGroups,
      missingConstraints: missingConstraints.length > 0 ? missingConstraints : undefined,
      allConstraints: constraintsSummary,
      hasLastConstraints: !!lastConstraints,
      lastConstraintsKeys: lastConstraints ? Object.keys(lastConstraints).filter(k => lastConstraints![k as keyof typeof lastConstraints] !== undefined && lastConstraints![k as keyof typeof lastConstraints] !== null) : [],
    });

    logger.debug('fashion_query_classified', {
      query: message.substring(0, 100),
      type: parsed.type,
      productTerms,
      constraintsCount: Object.keys(normalizedConstraints).length,
    });

    const totalDuration = Date.now() - startTime;
    logger.info('classifyQuery: complete', {
      query: queryForClassification.substring(0, 100),
      type: parsed.type,
      totalDurationMs: totalDuration,
      totalDurationSeconds: (totalDuration / 1000).toFixed(2),
      llmDurationMs: llmDuration,
      llmDurationSeconds: (llmDuration / 1000).toFixed(2),
      constraintsCount: Object.keys(normalizedConstraints).length,
      genderContext,
      usedStrictMajorityMode,
    });

    return {
      classification: {
        type: parsed.type,
        productTerms,
        constraints: normalizedConstraints,
        confidence: parsed.confidence,
      },
      usedStrictMajorityMode,
      genderContext,
    };
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    logger.error('classifyQuery: failed', {
      error: error instanceof Error ? error.message : String(error),
      query: queryForClassification.substring(0, 100),
      totalDurationMs: totalDuration,
      totalDurationSeconds: (totalDuration / 1000).toFixed(2),
    });

    // Fallback: return empty classification with metadata
    return {
      classification: {
        type: 'gift_or_vague',
        productTerms: normalizeQueryForSearch(message),
        constraints: {},
        confidence: 0.0,
      },
      usedStrictMajorityMode: false,
      genderContext: null,
    };
  }
}

/**
 * Classify query and extract constraints using LLM (backward-compatible wrapper)
 * 
 * This is the original function signature for backward compatibility.
 * Use classifyQueryWithMetadata for new code that needs gender context metadata.
 */
export async function classifyQuery(
  message: string,
  lastConstraints?: FashionConstraints | null,
  enhancedQuery?: string | null
): Promise<QueryClassification> {
  const result = await classifyQueryWithMetadata(message, lastConstraints, enhancedQuery);
  return result.classification;
}

/**
 * Infer classification from keywords (fallback)
 * 
 * Simple keyword-based classification when LLM fails.
 * This is a last-resort fallback that uses pattern matching.
 * 
 * @param message - User query message
 * @returns QueryClassification with inferred constraints
 */
export function inferClassificationFromKeywords(
  message: string
): QueryClassification {
  const messageLower = message.toLowerCase();
  const constraints: FashionConstraints = {};

  // Extract basic constraints from keywords
  const colorKeywords: Record<string, string> = {
    'white': 'White',
    'black': 'Black',
    'red': 'Red',
    'blue': 'Blue',
    'green': 'Green',
    'pink': 'Pink',
    'yellow': 'Yellow',
    'purple': 'Purple',
    'orange': 'Orange',
    'brown': 'Brown',
    'gray': 'Gray',
    'grey': 'Gray',
    'navy': 'Navy',
    'beige': 'Beige',
    'cream': 'Cream',
    'ivory': 'Ivory',
  };

  const sizeKeywords = ['xs', 'small', 's', 'medium', 'm', 'large', 'l', 'xl', 'xxl', '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20'];
  const occasionKeywords: Record<string, string> = {
    'wedding': 'Wedding',
    'beach': 'Beach',
    'office': 'Office',
    'casual': 'Casual',
    'formal': 'Formal',
    'party': 'Party',
    'cocktail': 'Cocktail',
    'evening': 'Evening',
    'vacation': 'Vacation',
    'date': 'Date Night',
    'date night': 'Date Night',
    'romantic date': 'Date Night',
    'evening date': 'Date Night',
  };

  const styleKeywords: Record<string, string> = {
    'mini': 'Mini',
    'maxi': 'Maxi',
    'midi': 'Midi',
    'a-line': 'A-Line',
    'fitted': 'Fitted',
    'loose': 'Loose',
    'wrap': 'Wrap',
  };

  // Extract colors
  const foundColors: string[] = [];
  for (const [keyword, color] of Object.entries(colorKeywords)) {
    if (messageLower.includes(keyword)) {
      foundColors.push(color);
    }
  }
  if (foundColors.length > 0) {
    constraints.colors = foundColors;
  }

  // Extract sizes
  const foundSizes: string[] = [];
  for (const size of sizeKeywords) {
    if (messageLower.includes(`size ${size}`) || messageLower.includes(` ${size} `) || messageLower.endsWith(` ${size}`)) {
      foundSizes.push(size.toUpperCase());
    }
  }
  if (foundSizes.length > 0) {
    constraints.sizes = foundSizes;
  }

  // Extract occasions
  const foundOccasions: string[] = [];
  for (const [keyword, occasion] of Object.entries(occasionKeywords)) {
    if (messageLower.includes(keyword)) {
      foundOccasions.push(occasion);
    }
  }
  if (foundOccasions.length > 0) {
    constraints.occasions = foundOccasions;
  }

  // Extract styles/lengths
  const foundLengths: string[] = [];
  for (const [keyword, style] of Object.entries(styleKeywords)) {
    if (messageLower.includes(keyword)) {
      if (['mini', 'maxi', 'midi'].includes(keyword)) {
        foundLengths.push(style);
      }
    }
  }
  if (foundLengths.length > 0) {
    constraints.lengths = foundLengths;
  }

  // Extract price
  const priceMatch = messageLower.match(/(?:under|below|less than|up to)\s*\$?(\d+)/);
  if (priceMatch) {
    const price = parseInt(priceMatch[1], 10);
    constraints.priceMaxCents = price * 100;
  }

  const overPriceMatch = messageLower.match(/(?:over|above|more than|at least)\s*\$?(\d+)/);
  if (overPriceMatch) {
    const price = parseInt(overPriceMatch[1], 10);
    constraints.priceMinCents = price * 100;
  }

  // Determine query type
  let type: QueryClassification['type'] = 'gift_or_vague';
  if (messageLower.includes('dress') || messageLower.includes('top') || messageLower.includes('bottom') || messageLower.includes('skirt')) {
    type = 'direct_product_search';
  } else if (constraints.occasions && (extractConstraintValues(constraints.occasions) || []).length > 0) {
    type = 'occasion_based';
  } else if (constraints.lengths && (extractConstraintValues(constraints.lengths) || []).length > 0) {
    type = 'style_exploration';
  } else if (constraints.sizes && (extractConstraintValues(constraints.sizes) || []).length > 0) {
    type = 'fit_and_size';
  }

  logger.debug('inferClassificationFromKeywords: complete', {
    message: message.substring(0, 100),
    type,
    constraintsCount: Object.keys(constraints).length,
  });

  return {
    type,
    productTerms: normalizeQueryForSearch(message),
    constraints,
    confidence: 0.3, // Low confidence for keyword-based inference
  };
}

