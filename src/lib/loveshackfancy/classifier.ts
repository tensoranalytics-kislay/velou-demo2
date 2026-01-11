/**
 * Query Classifier
 * 
 * LLM-based query classification and constraint extraction for LoveShackFancy queries.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import { LOVESHACKFANCY_QUERY_CLASSIFIER_PROMPT, LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA } from './prompts';
import { stripJsonFences } from '../llm/orchestrator/utils';
import { normalizeAgeGroups } from './age-group-normalizer';
import { validateAgeGroups, validateColors } from './dictionary-validator';
import { normalizeQueryForSearch } from './query-normalizer';

export type FashionConstraints = {
  // Existing clothing constraints
  styles?: string[] | null;
  lengths?: string[] | null;
  occasions?: string[] | null;
  seasons?: string[] | null;
  materials?: string[] | null;
  patterns?: string[] | null;
  colors?: string[] | null;
  sizes?: string[] | null;
  fits?: string[] | null;
  collections?: string[] | null;
  priceMinCents?: number | null;
  priceMaxCents?: number | null;
  embellishments?: string[] | null;
  necklines?: string[] | null;
  sleeveLengths?: string[] | null;
  ageGroups?: string[] | null;
  
  // Enriched fashion facets
  formalityLevel?: string[] | null;
  temperatureIntent?: string | null;
  humidityFriendly?: boolean | null;
  occasionContext?: string[] | null;
  problemSolutions?: string[] | null;
  functionFeatures?: string[] | null;
  colorShade?: string[] | null;
  colorUndertone?: string[] | null;
  multicolor?: boolean | null;
  seasonalPalette?: string[] | null;
  
  // Additional enriched attributes
  careRequirements?: string[] | null;
  rainWind?: string | null;
  travelFeatures?: string[] | null;
  pockets?: string | null;
  liningType?: string | null;
  braSolution?: string | null;
  ecoMaterials?: string[] | null;
  certifications?: string | null;
  origin?: string | null;
  adaptiveFeatures?: string | null;
  sensoryFriendly?: string | null;
  finish?: string | null;
  modestyCues?: string[] | null;
  layeringIntent?: string | null;
  pairingIntent?: string | null;
  
  // Category-specific constraints
  scents?: string[] | null;        // For Perfumes/Candles (lavender, vanilla, etc.)
  rooms?: string[] | null;          // For Home & Living (bedroom, bathroom, etc.)
  useCases?: string[] | null;       // Generic (travel, office, gift, etc.)
  benefits?: string[] | null;       // Generic (durable, lightweight, etc.)
  claims?: string[] | null;         // Generic (organic, vegan, etc.)
  sensoryProfile?: string | null;   // Generic (soft feel, citrus scent, etc.)
  compatibility?: string[] | null;  // Generic (works with iOS, for small rooms, etc.)
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
 * Classify query and extract constraints using LLM
 */
export async function classifyQuery(
  message: string,
  lastConstraints?: FashionConstraints | null,
  enhancedQuery?: string | null
): Promise<QueryClassification> {
  try {
    const lastConstraintsText = lastConstraints 
      ? JSON.stringify(lastConstraints, null, 2)
      : 'null';
    
    // Use enhanced query if provided, otherwise use original message
    const queryForClassification = enhancedQuery || message;
    
    const prompt = LOVESHACKFANCY_QUERY_CLASSIFIER_PROMPT
      .replace('{QUERY}', queryForClassification)
      .replace('{LAST_CONSTRAINTS}', lastConstraintsText);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a shopping assistant for LoveShackFancy. Classify queries and extract ALL possible constraints from context using semantic understanding. Think like a stylist who understands cultural sensitivity, appropriateness, and what works for different contexts. Extract both explicit and inferred constraints, ensuring explicit mentions override inferred ones.\n\nCRITICAL: You MUST extract ALL explicit constraints mentioned in the query. Examples:\n- "blue maxi dresses" MUST extract colors: ["Blue"] AND lengths: ["Maxi"]\n- "red mini dress" MUST extract colors: ["Red"] AND lengths: ["Mini"]\n- "long sleeve blue tops" MUST extract colors: ["Blue"] AND sleeveLengths: ["Long Sleeve"]\n\nDo NOT omit any explicitly mentioned constraints. If the user says "blue", extract it as a color. If they say "maxi", extract it as a length. If they say "long sleeves", extract it as sleeveLengths.',
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
    const extractArrayValues = (constraint: any): string[] | null | undefined => {
      if (!constraint) return constraint;
      if (Array.isArray(constraint)) return constraint; // Old format
      if (constraint.values && Array.isArray(constraint.values)) return constraint.values; // New format
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
    if (normalizedConstraints.fits) constraintsSummary.fits = normalizedConstraints.fits;
    if (normalizedConstraints.collections) constraintsSummary.collections = normalizedConstraints.collections;
    if (normalizedConstraints.embellishments) constraintsSummary.embellishments = normalizedConstraints.embellishments;
    if (normalizedConstraints.necklines) constraintsSummary.necklines = normalizedConstraints.necklines;
    if (normalizedConstraints.sleeveLengths) constraintsSummary.sleeveLengths = normalizedConstraints.sleeveLengths;
    if (normalizedConstraints.ageGroups) {
      // CRITICAL: First normalize, then validate against dictionary
      // This ensures only exact dataset values are used
      let normalized = normalizeAgeGroups(normalizedConstraints.ageGroups);
      
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
      
      constraintsSummary.ageGroups = validateAgeGroups(normalized);
      
      // Update normalized constraints with validated values
      normalizedConstraints.ageGroups = constraintsSummary.ageGroups.length > 0 
        ? constraintsSummary.ageGroups 
        : null;
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
    
    if (normalizedConstraints.colors) {
      // CRITICAL: Validate colors against dictionary
      // This ensures only exact dataset values are used
      const validated = validateColors(normalizedConstraints.colors);
      if (validated.length > 0) {
        constraintsSummary.colors = validated;
        normalizedConstraints.colors = validated;
      } else {
        // No valid colors found - remove from constraints
        constraintsSummary.colors = null;
        normalizedConstraints.colors = null;
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

    return {
      type: parsed.type,
      productTerms,
      constraints: normalizedConstraints,
      confidence: parsed.confidence,
    };
  } catch (error) {
    logger.error('classifyQuery: failed', {
      error: error instanceof Error ? error.message : String(error),
      query: message.substring(0, 100),
    });

    // Fallback: return empty classification
    return {
      type: 'gift_or_vague',
      productTerms: normalizeQueryForSearch(message),
      constraints: {},
      confidence: 0.0,
    };
  }
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
  } else if (constraints.occasions && constraints.occasions.length > 0) {
    type = 'occasion_based';
  } else if (constraints.lengths && constraints.lengths.length > 0) {
    type = 'style_exploration';
  } else if (constraints.sizes && constraints.sizes.length > 0) {
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

