/**
 * Query Parser
 * 
 * Uses LLM to separate product/category terms from constraint attributes.
 * Product terms are used for vector search, constraints for ranking.
 */

import { callLLM } from '../llm/provider';
import { buildQueryParserPrompt, LOVESHACKFANCY_QUERY_PARSER_SCHEMA } from './prompts';
import { logger } from '../telemetry/logger';
import { normalizeQueryForSearch } from './query-normalizer';

export type QueryConstraints = {
  colors?: string[] | null; // null = explicitly removed
  sizes?: string[] | null;
  occasions?: string[] | null;
  styles?: string[] | null;
  patterns?: string[] | null;
  seasons?: string[] | null;
  materials?: string[] | null;
  fits?: string[] | null;
  collections?: string[] | null;
  priceMinCents?: number | null; // null = explicitly removed
  priceMaxCents?: number | null; // null = explicitly removed
  embellishments?: string[] | null;
  necklines?: string[] | null;
  sleeveLengths?: string[] | null;
  lengths?: string[] | null; // e.g., "Mini", "Midi", "Maxi" for dresses
  ageGroups?: string[] | null; // e.g., "kids", "children", "toddler", "baby", "adult", "5-year-old", etc.
};

export type QueryParseResult = {
  productTerms: string; // Clean terms for vector search (e.g., "maxi dress")
  constraints: QueryConstraints;
  confidence: number;
};

/**
 * Parse a user query to separate product terms from constraints
 * 
 * @param query - Raw user query
 * @param lastConstraints - Previous constraints to merge with (for follow-ups)
 * @returns Parsed result with product terms and constraints
 */
export async function parseQuery(
  query: string,
  lastConstraints?: QueryConstraints | null
): Promise<QueryParseResult> {
  // First normalize the query to remove filler words
  const normalizedQuery = normalizeQueryForSearch(query);
  
  try {
    const prompt = buildQueryParserPrompt(normalizedQuery, lastConstraints);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a query parser for fashion shopping. Extract product terms and constraints from user queries. IMPORTANT: Always extract ageGroups when age information is mentioned (e.g., "for kids", "5-year-old", "toddler", "baby"). Distinguish between age (ageGroups) and size (sizes). Return valid JSON matching the schema exactly.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: LOVESHACKFANCY_QUERY_PARSER_SCHEMA,
      maxTokens: 500, // Limit response size for faster processing
    });

    const parsed = JSON.parse(result.rawText) as QueryParseResult;
    
    logger.info('query_parser_llm_response', {
      query: normalizedQuery.substring(0, 200),
      productTerms: parsed.productTerms,
      constraintsFromLLM: {
        colors: parsed.constraints.colors,
        sizes: parsed.constraints.sizes,
        occasions: parsed.constraints.occasions,
        styles: parsed.constraints.styles,
        patterns: parsed.constraints.patterns,
        materials: parsed.constraints.materials,
        seasons: parsed.constraints.seasons,
        fits: parsed.constraints.fits,
        collections: parsed.constraints.collections,
        embellishments: parsed.constraints.embellishments,
        necklines: parsed.constraints.necklines,
        sleeveLengths: parsed.constraints.sleeveLengths,
        ageGroups: parsed.constraints.ageGroups,
        priceMinCents: parsed.constraints.priceMinCents,
        priceMaxCents: parsed.constraints.priceMaxCents,
      },
      confidence: parsed.confidence,
      hasLastConstraints: !!lastConstraints,
    });
    
    // Merge with lastConstraints if this is a follow-up
    let mergedConstraints: QueryConstraints = {};
    if (lastConstraints) {
      // Start with previous constraints (including explicit removals - null values)
      mergedConstraints = { ...lastConstraints };
      
      // Override with new constraints from current query
      if (parsed.constraints) {
        // CRITICAL: Respect explicit removals (null) from lastConstraints
        // If lastConstraints has null for a field, it means it was explicitly removed
        // Only override if the parsed result has a new value (not undefined)
        
        // For arrays: only update if new values are provided AND not explicitly removed in lastConstraints
        if (lastConstraints.colors === null) {
          // Explicitly removed - keep as null/undefined, don't overwrite
          mergedConstraints.colors = undefined;
        } else if (parsed.constraints.colors && parsed.constraints.colors.length > 0) {
          mergedConstraints.colors = parsed.constraints.colors;
        }
        
        if (lastConstraints.sizes === null) {
          mergedConstraints.sizes = undefined;
        } else if (parsed.constraints.sizes && parsed.constraints.sizes.length > 0) {
          mergedConstraints.sizes = parsed.constraints.sizes;
        }
        
        if (lastConstraints.occasions === null) {
          mergedConstraints.occasions = undefined;
        } else if (parsed.constraints.occasions && parsed.constraints.occasions.length > 0) {
          mergedConstraints.occasions = parsed.constraints.occasions;
        }
        
        if (lastConstraints.styles === null) {
          mergedConstraints.styles = undefined;
        } else if (parsed.constraints.styles && parsed.constraints.styles.length > 0) {
          mergedConstraints.styles = parsed.constraints.styles;
        }
        
        if (lastConstraints.patterns === null) {
          mergedConstraints.patterns = undefined;
        } else if (parsed.constraints.patterns && parsed.constraints.patterns.length > 0) {
          mergedConstraints.patterns = parsed.constraints.patterns;
        }
        
        if (lastConstraints.seasons === null) {
          mergedConstraints.seasons = undefined;
        } else if (parsed.constraints.seasons && parsed.constraints.seasons.length > 0) {
          mergedConstraints.seasons = parsed.constraints.seasons;
        }
        
        if (lastConstraints.materials === null) {
          mergedConstraints.materials = undefined;
        } else if (parsed.constraints.materials && parsed.constraints.materials.length > 0) {
          mergedConstraints.materials = parsed.constraints.materials;
        }
        
        if (lastConstraints.fits === null) {
          mergedConstraints.fits = undefined;
        } else if (parsed.constraints.fits && parsed.constraints.fits.length > 0) {
          mergedConstraints.fits = parsed.constraints.fits;
        }
        
        if (lastConstraints.collections === null) {
          mergedConstraints.collections = undefined;
        } else if (parsed.constraints.collections && parsed.constraints.collections.length > 0) {
          mergedConstraints.collections = parsed.constraints.collections;
        }
        
        if (lastConstraints.embellishments === null) {
          mergedConstraints.embellishments = undefined;
        } else if (parsed.constraints.embellishments && parsed.constraints.embellishments.length > 0) {
          mergedConstraints.embellishments = parsed.constraints.embellishments;
        }
        
        if (lastConstraints.necklines === null) {
          mergedConstraints.necklines = undefined;
        } else if (parsed.constraints.necklines && parsed.constraints.necklines.length > 0) {
          mergedConstraints.necklines = parsed.constraints.necklines;
        }
        
        if (lastConstraints.sleeveLengths === null) {
          mergedConstraints.sleeveLengths = undefined;
        } else if (parsed.constraints.sleeveLengths && parsed.constraints.sleeveLengths.length > 0) {
          mergedConstraints.sleeveLengths = parsed.constraints.sleeveLengths;
        }
        
        if (lastConstraints.ageGroups === null) {
          mergedConstraints.ageGroups = undefined;
        } else if (parsed.constraints.ageGroups && parsed.constraints.ageGroups.length > 0) {
          mergedConstraints.ageGroups = parsed.constraints.ageGroups;
        }
        
        // For price, handle explicit removal (null), updates (number), and independent min/max
        // null = explicitly removed, undefined = not mentioned, number = set/update
        if (lastConstraints.priceMinCents === null) {
          // Explicitly removed - keep as undefined, don't overwrite
          mergedConstraints.priceMinCents = undefined;
        } else if (parsed.constraints.priceMinCents === null) {
          // Explicitly removed in current query
          mergedConstraints.priceMinCents = undefined;
        } else if (typeof parsed.constraints.priceMinCents === 'number') {
          // Update min (independent of max - can have min without max, or both)
          mergedConstraints.priceMinCents = parsed.constraints.priceMinCents;
        }
        // Note: If priceMinCents is undefined in parsed result, keep existing value from lastConstraints
        
        if (lastConstraints.priceMaxCents === null) {
          // Explicitly removed - keep as undefined, don't overwrite
          mergedConstraints.priceMaxCents = undefined;
        } else if (parsed.constraints.priceMaxCents === null) {
          // Explicitly removed in current query
          mergedConstraints.priceMaxCents = undefined;
        } else if (typeof parsed.constraints.priceMaxCents === 'number') {
          // Update max (independent of min - can have max without min, or both)
          mergedConstraints.priceMaxCents = parsed.constraints.priceMaxCents;
        }
        // Note: If priceMaxCents is undefined in parsed result, keep existing value from lastConstraints
      }
    } else {
      // No previous constraints, use parsed constraints as-is
      mergedConstraints = parsed.constraints || {};
    }
    
    // Clean up constraints: remove null/undefined/empty arrays, ensure proper types
    const cleanedConstraints: QueryConstraints = {};
    if (mergedConstraints) {
      if (Array.isArray(mergedConstraints.colors) && mergedConstraints.colors.length > 0) {
        cleanedConstraints.colors = mergedConstraints.colors;
      }
      if (Array.isArray(mergedConstraints.sizes) && mergedConstraints.sizes.length > 0) {
        cleanedConstraints.sizes = mergedConstraints.sizes;
      }
      if (Array.isArray(mergedConstraints.occasions) && mergedConstraints.occasions.length > 0) {
        cleanedConstraints.occasions = mergedConstraints.occasions;
      }
      if (Array.isArray(mergedConstraints.styles) && mergedConstraints.styles.length > 0) {
        cleanedConstraints.styles = mergedConstraints.styles;
      }
      if (Array.isArray(mergedConstraints.patterns) && mergedConstraints.patterns.length > 0) {
        cleanedConstraints.patterns = mergedConstraints.patterns;
      }
      if (Array.isArray(mergedConstraints.seasons) && mergedConstraints.seasons.length > 0) {
        cleanedConstraints.seasons = mergedConstraints.seasons;
      }
      if (Array.isArray(mergedConstraints.materials) && mergedConstraints.materials.length > 0) {
        cleanedConstraints.materials = mergedConstraints.materials;
      }
      if (Array.isArray(mergedConstraints.fits) && mergedConstraints.fits.length > 0) {
        cleanedConstraints.fits = mergedConstraints.fits;
      }
      if (Array.isArray(mergedConstraints.collections) && mergedConstraints.collections.length > 0) {
        cleanedConstraints.collections = mergedConstraints.collections;
      }
      if (Array.isArray(mergedConstraints.embellishments) && mergedConstraints.embellishments.length > 0) {
        cleanedConstraints.embellishments = mergedConstraints.embellishments;
      }
      if (Array.isArray(mergedConstraints.necklines) && mergedConstraints.necklines.length > 0) {
        cleanedConstraints.necklines = mergedConstraints.necklines;
      }
      if (Array.isArray(mergedConstraints.sleeveLengths) && mergedConstraints.sleeveLengths.length > 0) {
        cleanedConstraints.sleeveLengths = mergedConstraints.sleeveLengths;
      }
      if (Array.isArray(mergedConstraints.ageGroups) && mergedConstraints.ageGroups.length > 0) {
        cleanedConstraints.ageGroups = mergedConstraints.ageGroups;
      }
      if (typeof mergedConstraints.priceMinCents === 'number') {
        cleanedConstraints.priceMinCents = mergedConstraints.priceMinCents;
      }
      if (typeof mergedConstraints.priceMaxCents === 'number') {
        cleanedConstraints.priceMaxCents = mergedConstraints.priceMaxCents;
      }
    }
    
    // Ensure productTerms is not empty
    if (!parsed.productTerms || parsed.productTerms.trim().length === 0) {
      // Fallback: use normalized query as product terms
      parsed.productTerms = normalizedQuery || query;
    } else {
      // Further normalize product terms (remove any remaining filler words)
      parsed.productTerms = normalizeQueryForSearch(parsed.productTerms);
    }
    
    const constraintCount = Object.keys(cleanedConstraints).length;
    
    logger.info('query_parsed_internal', {
      originalQuery: query.substring(0, 100),
      normalizedQuery: normalizedQuery.substring(0, 100),
      productTerms: parsed.productTerms,
      constraintCount,
      constraints: cleanedConstraints,
      confidence: parsed.confidence,
    });

    return {
      productTerms: parsed.productTerms,
      constraints: cleanedConstraints,
      confidence: parsed.confidence || 0.5,
    };
  } catch (error) {
    logger.error('query_parsing_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 100),
    });
    
    // Fallback: return normalized query as product terms with no constraints
    return {
      productTerms: normalizedQuery || query,
      constraints: {},
      confidence: 0.3,
    };
  }
}

