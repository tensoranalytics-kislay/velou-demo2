/**
 * Constraint-Based Ranking
 * 
 * Ranks products using weighted constraint matching instead of hard filtering.
 * This prevents over-filtering while ensuring products that match constraints
 * rank higher.
 */

import type { SearchResultItem } from '../../search/types';
import type { FashionConstraints } from '../classifier';
import { calculateConstraintMatchScore, type QueryContext, matchColor, matchMaterial, matchOccasion, matchPattern, matchSize, matchSeason, matchFit, matchRise, matchCollection, matchEmbellishments, matchAgeGroup, matchFormalityLevel, matchStyle, matchColorShade, matchColorUndertone, matchMulticolor, matchSeasonalPalette, matchTemperatureIntent, matchHumidityFriendly, matchOccasionContext, matchProblemSolutions, matchFunctionFeatures } from './constraint-matcher';
import type { EnrichedColumnValues } from '../../search/filtering/attributes';
import type { ProductAttributes } from '../../search/types';
import { logger } from '../../telemetry/logger';
import { extractConstraintValues, extractConstraintIntent, convertConstraintToSoft, getConstraintImportanceOrder, type QueryConstraintsWithIntent, type ConstraintWithIntent, type ConstraintIntent } from '../constraint-utils';

/**
 * Extract attribute value (handles both string and array formats)
 * Helper function for filtering logic
 */
function extractAttrValue(attrs: ProductAttributes | null | undefined, key: string): string | string[] | undefined {
  if (!attrs) return undefined;
  
  // Try capitalized key first (most common in LoveShackFancy: "Color", "Occasion", "Style")
  const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
  const capitalizedValue = (attrs as any)[capitalizedKey];
  if (capitalizedValue !== undefined && capitalizedValue !== null) {
    return Array.isArray(capitalizedValue) ? capitalizedValue : [capitalizedValue];
  }
  
  // Try direct key (as-is)
  const directValue = (attrs as any)[key];
  if (directValue !== undefined && directValue !== null) {
    return Array.isArray(directValue) ? directValue : [directValue];
  }
  
  // Try lowercase key
  const lowercaseKey = key.toLowerCase();
  const lowercaseValue = (attrs as any)[lowercaseKey];
  if (lowercaseValue !== undefined && lowercaseValue !== null) {
    return Array.isArray(lowercaseValue) ? lowercaseValue : [lowercaseValue];
  }
  
  // Try underscore-separated key
  const underscoreKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  const underscoreValue = (attrs as any)[underscoreKey];
  if (underscoreValue !== undefined && underscoreValue !== null) {
    return Array.isArray(underscoreValue) ? underscoreValue : [underscoreValue];
  }
  
  // Try extensible attributes (nested structure)
  const extensible = (attrs as any).extensible;
  if (extensible && typeof extensible === 'object') {
    if (extensible[capitalizedKey] !== undefined && extensible[capitalizedKey] !== null) {
      const extValue = extensible[capitalizedKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    if (extensible[key] !== undefined && extensible[key] !== null) {
      const extValue = extensible[key];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    if (extensible[lowercaseKey] !== undefined && extensible[lowercaseKey] !== null) {
      const extValue = extensible[lowercaseKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
    if (extensible[underscoreKey] !== undefined && extensible[underscoreKey] !== null) {
      const extValue = extensible[underscoreKey];
      return Array.isArray(extValue) ? extValue : [extValue];
    }
  }
  
  return undefined;
}

/**
 * Normalize string for comparison (lowercase, trim)
 */
function normalize(str: string): string {
  return str.toLowerCase().trim();
}

/**
 * Check if a value matches any of the query values (fuzzy matching)
 * Returns confidence score 0-1
 */
function fuzzyMatch(
  productValue: string | string[] | undefined,
  queryValues: string[]
): number {
  if (!productValue || queryValues.length === 0) return 0;
  
  const productValues = Array.isArray(productValue) ? productValue : [productValue];
  const normalizedQuery = queryValues.map(normalize);
  
  // Check for exact matches first (highest confidence)
  for (const pv of productValues) {
    const normalizedPv = normalize(String(pv));
    for (const qv of normalizedQuery) {
      if (normalizedPv === qv) {
        return 1.0; // Exact match
      }
      // Check if product value contains query value or vice versa
      if (normalizedPv.includes(qv) || qv.includes(normalizedPv)) {
        return 0.8; // Partial match
      }
    }
  }
  
  return 0;
}

export type ProductWithVectorScore = {
  product: SearchResultItem;
  vectorScore: number; // Vector similarity score (0-1)
};

export type ProductWithFinalScore = {
  product: SearchResultItem;
  finalScore: number; // Final score after constraint boost
  constraintScore: number; // Constraint match score (0-1)
};

/**
 * Rank products using constraint-based weighted scoring
 * 
 * Combines vector similarity with constraint matching:
 * - Base score: vector similarity (0-1)
 * - Constraint boost: weighted constraint match scores
 * - Final score: baseScore + (constraintBoost × maxBoostFactor)
 * 
 * This ensures:
 * - Products that match constraints rank higher
 * - Products without constraint matches still appear (no hard filtering)
 * - Constraint boost is capped to prevent over-weighting
 * 
 * @param products - Products with their vector similarity scores
 * @param constraints - Query constraints to match against
 * @param maxConstraintBoost - Maximum boost factor for constraints (default 0.6 = 60% of base score)
 * @param queryContext - Optional query context for dynamic weight adjustment
 * @returns Products ranked by final score (descending)
 */
export async function rankWithConstraints(
  products: ProductWithVectorScore[],
  constraints: FashionConstraints,
  maxConstraintBoost: number = 0.6,
  queryContext?: QueryContext
): Promise<ProductWithFinalScore[]> {
  if (products.length === 0) return [];
  
  // Check if we have any constraints to match
  const hasConstraints = Object.values(constraints).some(
    v => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  );
  
  if (!hasConstraints) {
    // No constraints, all products have same constraint score (0)
    // Vector score is only used for product loading/retrieval, not final ranking
    return products.map(p => ({
      product: p.product,
      finalScore: 0, // No constraints = all products have same score (0)
      constraintScore: 0,
    }));
  }
  
  // PHASE 1: Hard filter products matching excluded constraints OR not matching required constraints BEFORE scoring
  // Extract enriched columns for all products to use in filtering
  const productsWithEnriched = products.map(({ product }) => {
    const enrichedColumns: EnrichedColumnValues = {
      color: product.color ?? null,
      fabric: product.fabric ?? null,
      material: product.material ?? null,
      occasion: product.occasion ?? null,
      season: product.season ?? null,
      fit: product.fit ?? null,
      length: product.length ?? null,
      sleeve: product.sleeve ?? null,
      neckline: product.neckline ?? null,
      formalityLevel: product.formalityLevel ?? null,
      temperatureIntent: product.temperatureIntent ?? null,
      humidityFriendly: product.humidityFriendly ?? null,
      occasionContext: product.occasionContext ?? null,
      problemSolutions: product.problemSolutions ?? null,
      functionFeatures: product.functionFeatures ?? null,
      colorShade: product.colorShade ?? null,
      colorUndertone: product.colorUndertone ?? null,
      multicolor: product.multicolor ?? null,
      seasonalPalette: product.seasonalPalette ?? null,
      enrichedColor: product.enrichedColor ?? null,
      ageGroup: product.ageGroup ?? null,
    };
    return { product, enrichedColumns };
  });
  
  // Filter out products that match excluded constraints OR don't match required constraints
  const filteredProductsWithEnriched = productsWithEnriched.filter(({ product, enrichedColumns }) => {
    const attrs = product.attributes;
    
    // Check each constraint type for excluded and required intent
    // Colors
    if (constraints.colors) {
      const intent = extractConstraintIntent(constraints.colors);
      const colorValues = extractConstraintValues(constraints.colors) || [];
      if (colorValues.length > 0) {
        const matchScore = matchColor(attrs, colorValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded color
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required color
        }
      }
    }
    
    // Materials
    if (constraints.materials) {
      const intent = extractConstraintIntent(constraints.materials);
      const materialValues = extractConstraintValues(constraints.materials) || [];
      if (materialValues.length > 0) {
        const matchScore = matchMaterial(attrs, materialValues);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded material
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required material
        }
      }
    }
    
    // Patterns
    if (constraints.patterns) {
      const intent = extractConstraintIntent(constraints.patterns);
      const patternValues = extractConstraintValues(constraints.patterns) || [];
      if (patternValues.length > 0) {
        const matchScore = matchPattern(attrs, patternValues);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded pattern
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required pattern
        }
      }
    }
    
    // Occasions
    if (constraints.occasions) {
      const intent = extractConstraintIntent(constraints.occasions);
      const occasionValues = extractConstraintValues(constraints.occasions) || [];
      if (occasionValues.length > 0) {
        const matchScore = matchOccasion(attrs, occasionValues, { 
          title: product.title, 
          description: product.description, 
          category: product.category, 
          subcategory: product.subcategory || undefined,
          attributes: product.attributes 
        }, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded occasion
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required occasion
        }
      }
    }
    
    // Sizes
    if (constraints.sizes) {
      const intent = extractConstraintIntent(constraints.sizes);
      const sizeValues = extractConstraintValues(constraints.sizes) || [];
      if (sizeValues.length > 0) {
        const matchScore = matchSize(attrs, sizeValues);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded size
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required size
        }
      }
    }
    
    // Seasons
    if (constraints.seasons) {
      const intent = extractConstraintIntent(constraints.seasons);
      const seasonValues = extractConstraintValues(constraints.seasons) || [];
      if (seasonValues.length > 0) {
        const matchScore = matchSeason(attrs, seasonValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded season
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required season
        }
      }
    }
    
    // Fits
    if (constraints.fits) {
      const intent = extractConstraintIntent(constraints.fits);
      const fitValues = extractConstraintValues(constraints.fits) || [];
      if (fitValues.length > 0) {
        const matchScore = matchFit(attrs, fitValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded fit
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required fit
        }
      }
    }
    
    // Rises (use matchRise pattern)
    if (constraints.rises) {
      const intent = extractConstraintIntent(constraints.rises);
      const riseValues = extractConstraintValues(constraints.rises) || [];
      if (riseValues.length > 0) {
        const matchScore = matchRise(attrs, riseValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded rise
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required rise
        }
      }
    }
    
    // Lengths (use fuzzyMatch pattern from constraint-matcher)
    if (constraints.lengths) {
      const intent = extractConstraintIntent(constraints.lengths);
      const lengthValues = extractConstraintValues(constraints.lengths) || [];
      if (lengthValues.length > 0) {
        const dbLength = enrichedColumns?.length ?? null;
        const attrLength = extractAttrValue(attrs, 'length') || extractAttrValue(attrs, 'Length');
        const finalLength = dbLength || attrLength;
        if (finalLength) {
          const matchScore = fuzzyMatch(finalLength, lengthValues);
          if (intent === 'excluded' && matchScore > 0) {
            return false; // Filter out - product matches excluded length
          }
          if (intent === 'required' && matchScore === 0) {
            return false; // Filter out - product doesn't match required length
          }
        } else if (intent === 'required') {
          // If required and product has no length attribute, filter out
          return false;
        }
      }
    }
    
    // Styles (use matchStyle pattern)
    if (constraints.styles) {
      const intent = extractConstraintIntent(constraints.styles);
      const styleValues = extractConstraintValues(constraints.styles) || [];
      if (styleValues.length > 0) {
        const matchScore = matchStyle(attrs, styleValues, { 
          title: product.title, 
          description: product.description, 
          category: product.category, 
          subcategory: product.subcategory || undefined,
          attributes: product.attributes 
        });
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded style
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required style
        }
      }
    }
    
    // Collections
    if (constraints.collections) {
      const intent = extractConstraintIntent(constraints.collections);
      const collectionValues = extractConstraintValues(constraints.collections) || [];
      if (collectionValues.length > 0) {
        const matchScore = matchCollection(attrs, collectionValues);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded collection
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required collection
        }
      }
    }
    
    // Necklines (use fuzzyMatch pattern)
    if (constraints.necklines) {
      const intent = extractConstraintIntent(constraints.necklines);
      const necklineValues = extractConstraintValues(constraints.necklines) || [];
      if (necklineValues.length > 0) {
        const dbNeckline = enrichedColumns?.neckline ?? null;
        const attrNeckline = extractAttrValue(attrs, 'neckline') || extractAttrValue(attrs, 'Neckline');
        const finalNeckline = dbNeckline || attrNeckline;
        if (finalNeckline) {
          const matchScore = fuzzyMatch(finalNeckline, necklineValues);
          if (intent === 'excluded' && matchScore > 0) {
            return false; // Filter out - product matches excluded neckline
          }
          if (intent === 'required' && matchScore === 0) {
            return false; // Filter out - product doesn't match required neckline
          }
        } else if (intent === 'required') {
          // If required and product has no neckline attribute, filter out
          return false;
        }
      }
    }
    
    // SleeveLengths (use fuzzyMatch pattern)
    if (constraints.sleeveLengths) {
      const intent = extractConstraintIntent(constraints.sleeveLengths);
      const sleeveLengthValues = extractConstraintValues(constraints.sleeveLengths) || [];
      if (sleeveLengthValues.length > 0) {
        const dbSleeve = enrichedColumns?.sleeve ?? null;
        const attrSleeveLength = extractAttrValue(attrs, 'sleeveLength') || extractAttrValue(attrs, 'Sleeve Length') || extractAttrValue(attrs, 'sleeve');
        const finalSleeveLength = dbSleeve || attrSleeveLength;
        if (finalSleeveLength) {
          const matchScore = fuzzyMatch(finalSleeveLength, sleeveLengthValues);
          if (intent === 'excluded' && matchScore > 0) {
            return false; // Filter out - product matches excluded sleeve length
          }
          if (intent === 'required' && matchScore === 0) {
            return false; // Filter out - product doesn't match required sleeve length
          }
        } else if (intent === 'required') {
          // If required and product has no sleeve length attribute, filter out
          return false;
        }
      }
    }
    
    // FormalityLevel
    if (constraints.formalityLevel) {
      const intent = extractConstraintIntent(constraints.formalityLevel);
      const formalityLevelValues = extractConstraintValues(constraints.formalityLevel) || [];
      if (formalityLevelValues.length > 0) {
        // Extract formalityLevel from product (database column or attributes)
        const dbFormalityLevel = enrichedColumns?.formalityLevel ?? null;
        const attrFormalityLevel = extractAttrValue(attrs, 'formalityLevel') || extractAttrValue(attrs, 'FormalityLevel');
        const finalFormalityLevel = dbFormalityLevel || attrFormalityLevel;
        if (finalFormalityLevel) {
          const matchScore = matchFormalityLevel(finalFormalityLevel, formalityLevelValues);
          if (intent === 'excluded' && matchScore > 0) {
            return false; // Filter out - product matches excluded formality level
          }
          if (intent === 'required' && matchScore === 0) {
            return false; // Filter out - product doesn't match required formality level
          }
        } else if (intent === 'required') {
          // If required and product has no formality level attribute, filter out
          return false;
        }
      }
    }
    
    // AgeGroups
    if (constraints.ageGroups) {
      const intent = extractConstraintIntent(constraints.ageGroups);
      const ageGroupValues = extractConstraintValues(constraints.ageGroups) || [];
      if (ageGroupValues.length > 0) {
        const matchScore = matchAgeGroup(product, ageGroupValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded age group
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required age group
        }
      }
    }
    
    // ColorShade
    if (constraints.colorShade) {
      const intent = extractConstraintIntent(constraints.colorShade);
      const colorShadeValues = extractConstraintValues(constraints.colorShade) || [];
      if (colorShadeValues.length > 0) {
        const dbColorShade = enrichedColumns?.colorShade ?? null;
        const attrColorShade = extractAttrValue(attrs, 'colorShade') || extractAttrValue(attrs, 'ColorShade');
        const finalColorShade = dbColorShade || attrColorShade;
        if (finalColorShade) {
          const matchScore = matchColorShade(Array.isArray(finalColorShade) ? finalColorShade[0] : finalColorShade, colorShadeValues);
          if (intent === 'excluded' && matchScore > 0) {
            return false; // Filter out - product matches excluded color shade
          }
          if (intent === 'required' && matchScore === 0) {
            return false; // Filter out - product doesn't match required color shade
          }
        } else if (intent === 'required') {
          // If required and product has no color shade attribute, filter out
          return false;
        }
      }
    }
    
    // ColorUndertone
    if (constraints.colorUndertone) {
      const intent = extractConstraintIntent(constraints.colorUndertone);
      const colorUndertoneValues = extractConstraintValues(constraints.colorUndertone) || [];
      if (colorUndertoneValues.length > 0) {
        const dbColorUndertone = enrichedColumns?.colorUndertone ?? null;
        const attrColorUndertone = extractAttrValue(attrs, 'colorUndertone') || extractAttrValue(attrs, 'ColorUndertone');
        const finalColorUndertone = dbColorUndertone || attrColorUndertone;
        if (finalColorUndertone) {
          const matchScore = matchColorUndertone(Array.isArray(finalColorUndertone) ? finalColorUndertone[0] : finalColorUndertone, colorUndertoneValues);
          if (intent === 'excluded' && matchScore > 0) {
            return false; // Filter out - product matches excluded color undertone
          }
          if (intent === 'required' && matchScore === 0) {
            return false; // Filter out - product doesn't match required color undertone
          }
        } else if (intent === 'required') {
          // If required and product has no color undertone attribute, filter out
          return false;
        }
      }
    }
    
    // Multicolor
    if (constraints.multicolor !== null && constraints.multicolor !== undefined) {
      const intent = extractConstraintIntent(constraints.multicolor);
      const multicolorValue = typeof constraints.multicolor === 'object' && 'value' in constraints.multicolor
        ? (constraints.multicolor as any).value as boolean
        : (typeof constraints.multicolor === 'boolean' ? constraints.multicolor : undefined);
      if (multicolorValue !== undefined) {
        const productMulticolor = enrichedColumns?.multicolor ?? (attrs as any).multicolor;
        const matchScore = matchMulticolor(
          typeof productMulticolor === 'boolean' ? productMulticolor : undefined,
          multicolorValue
        );
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded multicolor
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required multicolor
        }
      }
    }
    
    // SeasonalPalette
    if (constraints.seasonalPalette) {
      const intent = extractConstraintIntent(constraints.seasonalPalette);
      const seasonalPaletteValues = extractConstraintValues(constraints.seasonalPalette) || [];
      if (seasonalPaletteValues.length > 0) {
        const dbSeasonalPalette = enrichedColumns?.seasonalPalette ?? null;
        const attrSeasonalPalette = extractAttrValue(attrs, 'seasonalPalette') || extractAttrValue(attrs, 'SeasonalPalette');
        const finalSeasonalPalette = dbSeasonalPalette || attrSeasonalPalette;
        if (finalSeasonalPalette) {
          const matchScore = matchSeasonalPalette(Array.isArray(finalSeasonalPalette) ? finalSeasonalPalette[0] : finalSeasonalPalette, seasonalPaletteValues);
          if (intent === 'excluded' && matchScore > 0) {
            return false; // Filter out - product matches excluded seasonal palette
          }
          if (intent === 'required' && matchScore === 0) {
            return false; // Filter out - product doesn't match required seasonal palette
          }
        } else if (intent === 'required') {
          // If required and product has no seasonal palette attribute, filter out
          return false;
        }
      }
    }
    
    // Embellishments
    if (constraints.embellishments) {
      const intent = extractConstraintIntent(constraints.embellishments);
      const embellishmentValues = extractConstraintValues(constraints.embellishments) || [];
      if (embellishmentValues.length > 0) {
        const matchScore = matchEmbellishments(attrs, embellishmentValues);
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded embellishments
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required embellishments
        }
      }
    }
    
    // TemperatureIntent
    if (constraints.temperatureIntent !== null && constraints.temperatureIntent !== undefined) {
      const intent = extractConstraintIntent(constraints.temperatureIntent);
      const temperatureIntentValue = typeof constraints.temperatureIntent === 'object' && 'value' in constraints.temperatureIntent
        ? (constraints.temperatureIntent as any).value as string
        : (typeof constraints.temperatureIntent === 'string' ? constraints.temperatureIntent : undefined);
      if (temperatureIntentValue) {
        const productTemperatureIntent = enrichedColumns?.temperatureIntent ?? extractAttrValue(attrs, 'temperatureIntent');
        const matchScore = matchTemperatureIntent(
          Array.isArray(productTemperatureIntent) ? productTemperatureIntent[0] : productTemperatureIntent,
          temperatureIntentValue
        );
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded temperature intent
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required temperature intent
        }
      }
    }
    
    // HumidityFriendly
    if (constraints.humidityFriendly !== null && constraints.humidityFriendly !== undefined) {
      const intent = extractConstraintIntent(constraints.humidityFriendly);
      const humidityFriendlyValue = typeof constraints.humidityFriendly === 'object' && 'value' in constraints.humidityFriendly
        ? (constraints.humidityFriendly as any).value as boolean
        : (typeof constraints.humidityFriendly === 'boolean' ? constraints.humidityFriendly : undefined);
      if (humidityFriendlyValue !== undefined && humidityFriendlyValue !== null) {
        const productHumidityFriendly = enrichedColumns?.humidityFriendly ?? (attrs as any).humidityFriendly;
        const matchScore = matchHumidityFriendly(
          typeof productHumidityFriendly === 'boolean' ? productHumidityFriendly : undefined,
          humidityFriendlyValue
        );
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded humidity friendly
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required humidity friendly
        }
      }
    }
    
    // OccasionContext
    if (constraints.occasionContext) {
      const intent = extractConstraintIntent(constraints.occasionContext);
      const occasionContextValues = extractConstraintValues(constraints.occasionContext) || [];
      if (occasionContextValues.length > 0) {
        const productOccasionContext = enrichedColumns?.occasionContext ?? extractAttrValue(attrs, 'occasionContext');
        const matchScore = matchOccasionContext(
          Array.isArray(productOccasionContext) ? productOccasionContext : undefined,
          occasionContextValues
        );
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded occasion context
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required occasion context
        }
      }
    }
    
    // ProblemSolutions
    if (constraints.problemSolutions) {
      const intent = extractConstraintIntent(constraints.problemSolutions);
      const problemSolutionsValues = extractConstraintValues(constraints.problemSolutions) || [];
      if (problemSolutionsValues.length > 0) {
        const productProblemSolutions = enrichedColumns?.problemSolutions ?? extractAttrValue(attrs, 'problemSolutions');
        const matchScore = matchProblemSolutions(
          Array.isArray(productProblemSolutions) ? productProblemSolutions : undefined,
          problemSolutionsValues
        );
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded problem solutions
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required problem solutions
        }
      }
    }
    
    // FunctionFeatures
    if (constraints.functionFeatures) {
      const intent = extractConstraintIntent(constraints.functionFeatures);
      const functionFeaturesValues = extractConstraintValues(constraints.functionFeatures) || [];
      if (functionFeaturesValues.length > 0) {
        const productFunctionFeatures = enrichedColumns?.functionFeatures ?? extractAttrValue(attrs, 'functionFeatures');
        const matchScore = matchFunctionFeatures(
          Array.isArray(productFunctionFeatures) ? productFunctionFeatures : undefined,
          functionFeaturesValues
        );
        if (intent === 'excluded' && matchScore > 0) {
          return false; // Filter out - product matches excluded function features
        }
        if (intent === 'required' && matchScore === 0) {
          return false; // Filter out - product doesn't match required function features
        }
      }
    }
    
    return true; // Keep product if no excluded/required constraint violations
  });
  
  // Convert back to ProductWithVectorScore format
  const filteredProducts = filteredProductsWithEnriched.map(({ product }) => {
    const original = products.find(p => p.product.id === product.id);
    return original || { product, vectorScore: 0 };
  });
  
  // Log filtering results
  const filteredCount = products.length - filteredProducts.length;
  if (filteredCount > 0) {
    logger.info('required_and_excluded_constraints_hard_filtered', {
      originalCount: products.length,
      filteredCount: filteredProducts.length,
      removedCount: filteredCount,
      note: 'Products matching excluded constraints or not matching required constraints were hard filtered out',
    });
  }
  
  // PROGRESSIVE CONSTRAINT RELAXATION: If we have fewer than 4 results, progressively relax constraints
  // Target: 4 results (not just when 0) - ensures better user experience
  const TARGET_RESULTS = 4;
  if (filteredProducts.length < TARGET_RESULTS && products.length > 0) {
    return await progressivelyRelaxConstraints(products, constraints, maxConstraintBoost, queryContext, TARGET_RESULTS);
  }
  
  // Calculate constraint match scores first (to determine dynamic boost)
  // Using Promise.all() to allow event loop interleaving for better responsiveness
  const productsWithConstraintScores = await Promise.all(
    filteredProducts.map(async ({ product, vectorScore }) => {
      // Extract enriched columns from SearchResultItem for constraint matching
      // Extract ALL database columns first, then fallback to JSONB attributes
      const enrichedColumns: EnrichedColumnValues = {
        // Core indexed columns
        color: product.color ?? null,
        fabric: product.fabric ?? null,
        material: product.material ?? null,
        occasion: product.occasion ?? null,
        season: product.season ?? null,
        fit: product.fit ?? null,
        
        // Enriched attributes
        length: product.length ?? null,
        sleeve: product.sleeve ?? null,
        neckline: product.neckline ?? null,
        riseWaist: product.riseWaist ?? null,
        silhouetteCut: (product as any).silhouetteCut ?? null,
        formalityLevel: product.formalityLevel ?? null,
        temperatureIntent: product.temperatureIntent ?? null,
        humidityFriendly: product.humidityFriendly ?? null,
        occasionContext: product.occasionContext ?? null,
        problemSolutions: product.problemSolutions ?? null,
        functionFeatures: product.functionFeatures ?? null,
        colorShade: product.colorShade ?? null,
        colorUndertone: product.colorUndertone ?? null,
        multicolor: product.multicolor ?? null,
        seasonalPalette: product.seasonalPalette ?? null,
        enrichedColor: product.enrichedColor ?? null,
        ageGroup: product.ageGroup ?? null,
      };
      
      // Calculate constraint score (synchronous, but wrapped in Promise for parallel processing)
      const constraintScore = calculateConstraintMatchScore(
        product, // Pass full product object so ageGroup can be inferred from title/description
        constraints,
        queryContext, // Pass query context for dynamic weight adjustment
        enrichedColumns // Pass enriched columns for database column matching (occasion, occasionContext, etc.)
      );
      
      return {
        product,
        vectorScore,
        constraintScore,
      };
    })
  );
  
  // Calculate average constraint score to determine dynamic boost
  const avgConstraintScore = productsWithConstraintScores.reduce((sum, p) => sum + p.constraintScore, 0) / productsWithConstraintScores.length;
  const minConstraintScore = Math.min(...productsWithConstraintScores.map(p => p.constraintScore));
  const maxConstraintScore = Math.max(...productsWithConstraintScores.map(p => p.constraintScore));
  
  // Calculate final scores - ONLY use constraint score (vector score is only for product loading/retrieval)
  const productsWithScores: ProductWithFinalScore[] = productsWithConstraintScores.map(({ product, vectorScore, constraintScore }) => {
    // Final score: constraint score only (vector score is not used in final ranking)
    const finalScore = constraintScore;
    
    return {
      product,
      finalScore,
      constraintScore,
    };
  });
  
  // Sort by final score (descending), with tie-breaking by constraint score quality
  // This ensures that products with better constraint matches rank higher
  productsWithScores.sort((a, b) => {
    if (Math.abs(a.finalScore - b.finalScore) < 0.001) {
      // Tie-break by constraint score quality (higher constraint score = better match)
      return b.constraintScore - a.constraintScore;
    }
    return b.finalScore - a.finalScore;
  });
  
  // Log top 5 products with detailed scores
  const topProducts = productsWithScores.slice(0, 5).map((p, idx) => ({
    rank: idx + 1,
    productId: p.product.id,
    productTitle: p.product.title?.substring(0, 80),
    vectorScore: productsWithConstraintScores.find(pc => pc.product.id === p.product.id)?.vectorScore || 0,
    constraintScore: p.constraintScore,
    finalScore: p.finalScore,
  }));
  
  logger.info('constraint_ranking_applied', {
    productCount: productsWithScores.length,
    avgConstraintScore,
    minConstraintScore,
    maxConstraintScore,
    avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.finalScore, 0) / productsWithScores.length,
    topFinalScore: productsWithScores[0]?.finalScore,
    constraintFields: Object.keys(constraints).filter(k => constraints[k as keyof FashionConstraints] !== null && constraints[k as keyof FashionConstraints] !== undefined),
    topProducts,
    constraintValues: {
      colors: constraints.colors,
      patterns: constraints.patterns,
      occasions: constraints.occasions,
      materials: constraints.materials,
      sizes: constraints.sizes,
      ageGroups: constraints.ageGroups,
      priceMinCents: constraints.priceMinCents,
      priceMaxCents: constraints.priceMaxCents,
    },
  });
  
  logger.debug('constraint_ranking_applied', {
    productCount: productsWithScores.length,
    avgConstraintScore,
    avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.finalScore, 0) / productsWithScores.length,
    topFinalScore: productsWithScores[0]?.finalScore,
    constraintFields: Object.keys(constraints).filter(k => constraints[k as keyof FashionConstraints] !== null && constraints[k as keyof FashionConstraints] !== undefined),
  });
  
  return productsWithScores;
}

/**
 * Progressively relax constraints when all products are filtered out
 * Drops soft constraints first, then converts hard constraints to soft for ranking
 * This prevents returning zero results while still respecting user preferences through ranking
 */
async function progressivelyRelaxConstraints(
  products: ProductWithVectorScore[],
  originalConstraints: FashionConstraints,
  maxConstraintBoost: number,
  queryContext?: QueryContext,
  targetResults: number = 4 // NEW: Target number of results (default: 4)
): Promise<ProductWithFinalScore[]> {
  // NEVER relax gender, category, or ageGroups - these are HARD SQL filters
  const NEVER_RELAX = ['gender', 'category', 'ageGroups'];
  
  logger.debug('constraint_relaxation_starting', {
    originalCount: products.length,
    targetResults,
    constraintTypes: Object.keys(originalConstraints).filter(k => 
      originalConstraints[k as keyof typeof originalConstraints] !== null && 
      originalConstraints[k as keyof typeof originalConstraints] !== undefined &&
      !NEVER_RELAX.includes(k)
    ).length,
    neverRelaxed: NEVER_RELAX,
    note: `Starting progressive constraint relaxation to target ${targetResults} results. Gender, category, and ageGroups will NEVER be relaxed.`,
  });
  
  // Get constraint importance ordering (least to most important)
  // Filter out gender, category, and ageGroups - these are never relaxed
  const importanceOrder = getConstraintImportanceOrder().filter(item => 
    !NEVER_RELAX.includes(item.field as string)
  );
  
  // Create a relaxed constraints copy for progressive relaxation
  let relaxedConstraints: FashionConstraints = { ...originalConstraints };
  
  // First, try ranking with original constraints to see if we already have enough results
  const initialProducts = await performRankingWithFilters(
    products,
    relaxedConstraints,
    maxConstraintBoost,
    queryContext
  );
  
  if (initialProducts.length >= targetResults) {
    logger.info('constraint_relaxation_not_needed', {
      resultCount: initialProducts.length,
      targetResults,
      note: 'Already have enough results, no relaxation needed',
    });
    return initialProducts;
  }
  
  // Step 1: Drop soft constraints (preferred/strong) first, one by one
  for (const { field, category } of importanceOrder) {
    if (category === 'soft' && relaxedConstraints[field] !== null && relaxedConstraints[field] !== undefined) {
      const intent = extractConstraintIntent(relaxedConstraints[field]);
      // Only drop soft constraints (preferred/strong), keep hard constraints (required) for now
      if (intent === 'preferred' || intent === 'strong') {
        relaxedConstraints = { ...relaxedConstraints, [field]: null };
        
        logger.debug('constraint_relaxation_soft_dropped', {
          field,
          intent,
          category,
          note: 'Dropped soft constraint (preferred/strong) for relaxation',
        });
        
        // Retry with relaxed constraints (will call rankWithConstraints which will filter again)
        const relaxedProducts = await performRankingWithFilters(
          products,
          relaxedConstraints,
          maxConstraintBoost,
          queryContext
        );
        
        if (relaxedProducts.length >= targetResults) {
          logger.info('constraint_relaxation_soft_success', {
            field,
            resultCount: relaxedProducts.length,
            targetResults,
            note: 'Successfully relaxed constraints by dropping soft constraint - reached target',
          });
          return relaxedProducts;
        }
        
        // If still no results, continue with this constraint dropped and try next
      }
    }
  }
  
  // Step 2: Convert hard constraints (required) to soft (preferred) one by one
  for (const { field, category } of importanceOrder) {
    if (category === 'hard' && relaxedConstraints[field] !== null && relaxedConstraints[field] !== undefined) {
      const intent = extractConstraintIntent(relaxedConstraints[field]);
      // Convert required to preferred (soft) for ranking instead of removing
      if (intent === 'required') {
        // Only convert if constraint has intent format (new format)
        const currentConstraint = relaxedConstraints[field];
        let softConstraint: any = currentConstraint;
        if (currentConstraint && typeof currentConstraint === 'object' && 'intent' in currentConstraint) {
          softConstraint = convertConstraintToSoft(currentConstraint);
        } else {
          // Old format - can't convert, but also won't filter out (old format = soft by default)
          // Skip this constraint and continue
          continue;
        }
        relaxedConstraints = { ...relaxedConstraints, [field]: softConstraint };
        
        logger.debug('constraint_relaxation_hard_to_soft', {
          field,
          originalIntent: intent,
          newIntent: 'preferred',
          category,
          note: 'Converted required constraint to preferred (soft) for ranking',
        });
        
        // Retry with relaxed constraints (required constraint now soft, won't filter out products)
        const relaxedProducts = await performRankingWithFilters(
          products,
          relaxedConstraints,
          maxConstraintBoost,
          queryContext
        );
        
        if (relaxedProducts.length >= targetResults) {
          logger.info('constraint_relaxation_hard_to_soft_success', {
            field,
            resultCount: relaxedProducts.length,
            targetResults,
            note: 'Successfully relaxed constraints by converting required to preferred - reached target',
          });
          return relaxedProducts;
        }
        
        // If still no results, keep this constraint as soft and try next
      }
    }
  }
  
  // Step 3: If still no results, drop all remaining hard constraints
  logger.warn('constraint_relaxation_all_dropped', {
    originalCount: products.length,
    note: 'All constraints relaxed but still no results, falling back to vector scores only',
  });
  
  // Final fallback: no constraints, all products have same constraint score (0)
  // Vector score is only used for product loading/retrieval, not final ranking
  return products.map(p => ({
    product: p.product,
    finalScore: 0, // No constraints = all products have same score (0)
    constraintScore: 0,
  }));
}

/**
 * Internal function to perform hard filtering and ranking (used by relaxation logic)
 * This extracts the core ranking logic to avoid infinite recursion during relaxation
 */
async function performRankingWithFilters(
  products: ProductWithVectorScore[],
  constraints: FashionConstraints,
  maxConstraintBoost: number,
  queryContext?: QueryContext
): Promise<ProductWithFinalScore[]> {
  if (products.length === 0) return [];
  
  // Check if we have any constraints to match
  const hasConstraints = Object.values(constraints).some(
    v => v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  );
  
  if (!hasConstraints) {
    // No constraints, all products have same constraint score (0)
    // Vector score is only used for product loading/retrieval, not final ranking
    return products.map(p => ({
      product: p.product,
      finalScore: 0, // No constraints = all products have same score (0)
      constraintScore: 0,
    }));
  }
  
  // PHASE 1: Hard filter products matching excluded constraints OR not matching required constraints BEFORE scoring
  // Extract enriched columns for all products to use in filtering
  const productsWithEnriched = products.map(({ product }) => {
    const enrichedColumns: EnrichedColumnValues = {
      color: product.color ?? null,
      fabric: product.fabric ?? null,
      material: product.material ?? null,
      occasion: product.occasion ?? null,
      season: product.season ?? null,
      fit: product.fit ?? null,
      length: product.length ?? null,
      sleeve: product.sleeve ?? null,
      neckline: product.neckline ?? null,
      formalityLevel: product.formalityLevel ?? null,
      temperatureIntent: product.temperatureIntent ?? null,
      humidityFriendly: product.humidityFriendly ?? null,
      occasionContext: product.occasionContext ?? null,
      problemSolutions: product.problemSolutions ?? null,
      functionFeatures: product.functionFeatures ?? null,
      colorShade: product.colorShade ?? null,
      colorUndertone: product.colorUndertone ?? null,
      multicolor: product.multicolor ?? null,
      seasonalPalette: product.seasonalPalette ?? null,
      enrichedColor: product.enrichedColor ?? null,
      ageGroup: product.ageGroup ?? null,
    };
    return { product, enrichedColumns };
  });
  
  // Apply hard filtering (same logic as main function)
  const filteredProductsWithEnriched = productsWithEnriched.filter(({ product, enrichedColumns }) => {
    const attrs = product.attributes;
    
    // Check each constraint type for excluded and required intent
    // (Include all constraint checks here - same as main function)
    // Colors
    if (constraints.colors) {
      const intent = extractConstraintIntent(constraints.colors);
      const colorValues = extractConstraintValues(constraints.colors) || [];
      if (colorValues.length > 0) {
        const matchScore = matchColor(attrs, colorValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Continue with all other constraints (fits, rises, etc.)...
    // For brevity, include key ones - the rest follow same pattern
    
    // Fits
    if (constraints.fits) {
      const intent = extractConstraintIntent(constraints.fits);
      const fitValues = extractConstraintValues(constraints.fits) || [];
      if (fitValues.length > 0) {
        const matchScore = matchFit(attrs, fitValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Rises
    if (constraints.rises) {
      const intent = extractConstraintIntent(constraints.rises);
      const riseValues = extractConstraintValues(constraints.rises) || [];
      if (riseValues.length > 0) {
        const matchScore = matchRise(attrs, riseValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // ColorShade
    if (constraints.colorShade) {
      const intent = extractConstraintIntent(constraints.colorShade);
      const colorShadeValues = extractConstraintValues(constraints.colorShade) || [];
      if (colorShadeValues.length > 0) {
        const dbColorShade = enrichedColumns?.colorShade ?? null;
        const attrColorShade = extractAttrValue(attrs, 'colorShade') || extractAttrValue(attrs, 'ColorShade');
        const finalColorShade = dbColorShade || attrColorShade;
        if (finalColorShade) {
          const matchScore = matchColorShade(Array.isArray(finalColorShade) ? finalColorShade[0] : finalColorShade, colorShadeValues);
          if (intent === 'excluded' && matchScore > 0) return false;
          if (intent === 'required' && matchScore === 0) return false;
        } else if (intent === 'required') {
          return false;
        }
      }
    }
    
    // AgeGroups (always check)
    if (constraints.ageGroups) {
      const intent = extractConstraintIntent(constraints.ageGroups);
      const ageGroupValues = extractConstraintValues(constraints.ageGroups) || [];
      if (ageGroupValues.length > 0) {
        const matchScore = matchAgeGroup(product, ageGroupValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Materials
    if (constraints.materials) {
      const intent = extractConstraintIntent(constraints.materials);
      const materialValues = extractConstraintValues(constraints.materials) || [];
      if (materialValues.length > 0) {
        const matchScore = matchMaterial(attrs, materialValues);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Patterns
    if (constraints.patterns) {
      const intent = extractConstraintIntent(constraints.patterns);
      const patternValues = extractConstraintValues(constraints.patterns) || [];
      if (patternValues.length > 0) {
        const matchScore = matchPattern(attrs, patternValues);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Occasions
    if (constraints.occasions) {
      const intent = extractConstraintIntent(constraints.occasions);
      const occasionValues = extractConstraintValues(constraints.occasions) || [];
      if (occasionValues.length > 0) {
        const matchScore = matchOccasion(attrs, occasionValues, { 
          title: product.title, 
          description: product.description, 
          category: product.category, 
          subcategory: product.subcategory || undefined,
          attributes: product.attributes 
        }, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Sizes
    if (constraints.sizes) {
      const intent = extractConstraintIntent(constraints.sizes);
      const sizeValues = extractConstraintValues(constraints.sizes) || [];
      if (sizeValues.length > 0) {
        const matchScore = matchSize(attrs, sizeValues);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Seasons
    if (constraints.seasons) {
      const intent = extractConstraintIntent(constraints.seasons);
      const seasonValues = extractConstraintValues(constraints.seasons) || [];
      if (seasonValues.length > 0) {
        const matchScore = matchSeason(attrs, seasonValues, enrichedColumns);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Styles
    if (constraints.styles) {
      const intent = extractConstraintIntent(constraints.styles);
      const styleValues = extractConstraintValues(constraints.styles) || [];
      if (styleValues.length > 0) {
        const matchScore = matchStyle(attrs, styleValues, { 
          title: product.title, 
          description: product.description, 
          category: product.category, 
          subcategory: product.subcategory || undefined,
          attributes: product.attributes 
        });
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // Lengths
    if (constraints.lengths) {
      const intent = extractConstraintIntent(constraints.lengths);
      const lengthValues = extractConstraintValues(constraints.lengths) || [];
      if (lengthValues.length > 0) {
        const dbLength = enrichedColumns?.length ?? null;
        const attrLength = extractAttrValue(attrs, 'length') || extractAttrValue(attrs, 'Length');
        const finalLength = dbLength || attrLength;
        if (finalLength) {
          const matchScore = fuzzyMatch(finalLength, lengthValues);
          if (intent === 'excluded' && matchScore > 0) return false;
          if (intent === 'required' && matchScore === 0) return false;
        } else if (intent === 'required') {
          return false;
        }
      }
    }
    
    // Necklines
    if (constraints.necklines) {
      const intent = extractConstraintIntent(constraints.necklines);
      const necklineValues = extractConstraintValues(constraints.necklines) || [];
      if (necklineValues.length > 0) {
        const dbNeckline = enrichedColumns?.neckline ?? null;
        const attrNeckline = extractAttrValue(attrs, 'neckline') || extractAttrValue(attrs, 'Neckline');
        const finalNeckline = dbNeckline || attrNeckline;
        if (finalNeckline) {
          const matchScore = fuzzyMatch(finalNeckline, necklineValues);
          if (intent === 'excluded' && matchScore > 0) return false;
          if (intent === 'required' && matchScore === 0) return false;
        } else if (intent === 'required') {
          return false;
        }
      }
    }
    
    // SleeveLengths
    if (constraints.sleeveLengths) {
      const intent = extractConstraintIntent(constraints.sleeveLengths);
      const sleeveLengthValues = extractConstraintValues(constraints.sleeveLengths) || [];
      if (sleeveLengthValues.length > 0) {
        const dbSleeve = enrichedColumns?.sleeve ?? null;
        const attrSleeveLength = extractAttrValue(attrs, 'sleeveLength') || extractAttrValue(attrs, 'Sleeve Length') || extractAttrValue(attrs, 'sleeve');
        const finalSleeveLength = dbSleeve || attrSleeveLength;
        if (finalSleeveLength) {
          const matchScore = fuzzyMatch(finalSleeveLength, sleeveLengthValues);
          if (intent === 'excluded' && matchScore > 0) return false;
          if (intent === 'required' && matchScore === 0) return false;
        } else if (intent === 'required') {
          return false;
        }
      }
    }
    
    // Collections
    if (constraints.collections) {
      const intent = extractConstraintIntent(constraints.collections);
      const collectionValues = extractConstraintValues(constraints.collections) || [];
      if (collectionValues.length > 0) {
        const matchScore = matchCollection(attrs, collectionValues);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // FormalityLevel
    if (constraints.formalityLevel) {
      const intent = extractConstraintIntent(constraints.formalityLevel);
      const formalityLevelValues = extractConstraintValues(constraints.formalityLevel) || [];
      if (formalityLevelValues.length > 0) {
        const dbFormalityLevel = enrichedColumns?.formalityLevel ?? null;
        const attrFormalityLevel = extractAttrValue(attrs, 'formalityLevel') || extractAttrValue(attrs, 'FormalityLevel');
        const finalFormalityLevel = dbFormalityLevel || attrFormalityLevel;
        if (finalFormalityLevel) {
          const matchScore = matchFormalityLevel(finalFormalityLevel, formalityLevelValues);
          if (intent === 'excluded' && matchScore > 0) return false;
          if (intent === 'required' && matchScore === 0) return false;
        } else if (intent === 'required') {
          return false;
        }
      }
    }
    
    // ColorUndertone
    if (constraints.colorUndertone) {
      const intent = extractConstraintIntent(constraints.colorUndertone);
      const colorUndertoneValues = extractConstraintValues(constraints.colorUndertone) || [];
      if (colorUndertoneValues.length > 0) {
        const dbColorUndertone = enrichedColumns?.colorUndertone ?? null;
        const attrColorUndertone = extractAttrValue(attrs, 'colorUndertone') || extractAttrValue(attrs, 'ColorUndertone');
        const finalColorUndertone = dbColorUndertone || attrColorUndertone;
        if (finalColorUndertone) {
          const matchScore = matchColorUndertone(Array.isArray(finalColorUndertone) ? finalColorUndertone[0] : finalColorUndertone, colorUndertoneValues);
          if (intent === 'excluded' && matchScore > 0) return false;
          if (intent === 'required' && matchScore === 0) return false;
        } else if (intent === 'required') {
          return false;
        }
      }
    }
    
    // Multicolor
    if (constraints.multicolor !== null && constraints.multicolor !== undefined) {
      const intent = extractConstraintIntent(constraints.multicolor);
      const multicolorValue = typeof constraints.multicolor === 'object' && 'value' in constraints.multicolor
        ? (constraints.multicolor as any).value as boolean
        : (typeof constraints.multicolor === 'boolean' ? constraints.multicolor : undefined);
      if (multicolorValue !== undefined) {
        const productMulticolor = enrichedColumns?.multicolor ?? (attrs as any).multicolor;
        const matchScore = matchMulticolor(
          typeof productMulticolor === 'boolean' ? productMulticolor : undefined,
          multicolorValue
        );
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // SeasonalPalette
    if (constraints.seasonalPalette) {
      const intent = extractConstraintIntent(constraints.seasonalPalette);
      const seasonalPaletteValues = extractConstraintValues(constraints.seasonalPalette) || [];
      if (seasonalPaletteValues.length > 0) {
        const dbSeasonalPalette = enrichedColumns?.seasonalPalette ?? null;
        const attrSeasonalPalette = extractAttrValue(attrs, 'seasonalPalette') || extractAttrValue(attrs, 'SeasonalPalette');
        const finalSeasonalPalette = dbSeasonalPalette || attrSeasonalPalette;
        if (finalSeasonalPalette) {
          const matchScore = matchSeasonalPalette(Array.isArray(finalSeasonalPalette) ? finalSeasonalPalette[0] : finalSeasonalPalette, seasonalPaletteValues);
          if (intent === 'excluded' && matchScore > 0) return false;
          if (intent === 'required' && matchScore === 0) return false;
        } else if (intent === 'required') {
          return false;
        }
      }
    }
    
    // Embellishments
    if (constraints.embellishments) {
      const intent = extractConstraintIntent(constraints.embellishments);
      const embellishmentValues = extractConstraintValues(constraints.embellishments) || [];
      if (embellishmentValues.length > 0) {
        const matchScore = matchEmbellishments(attrs, embellishmentValues);
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // TemperatureIntent
    if (constraints.temperatureIntent !== null && constraints.temperatureIntent !== undefined) {
      const intent = extractConstraintIntent(constraints.temperatureIntent);
      const temperatureIntentValue = typeof constraints.temperatureIntent === 'object' && 'value' in constraints.temperatureIntent
        ? (constraints.temperatureIntent as any).value as string
        : (typeof constraints.temperatureIntent === 'string' ? constraints.temperatureIntent : undefined);
      if (temperatureIntentValue) {
        const productTemperatureIntent = enrichedColumns?.temperatureIntent ?? extractAttrValue(attrs, 'temperatureIntent');
        const matchScore = matchTemperatureIntent(
          Array.isArray(productTemperatureIntent) ? productTemperatureIntent[0] : productTemperatureIntent,
          temperatureIntentValue
        );
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // HumidityFriendly
    if (constraints.humidityFriendly !== null && constraints.humidityFriendly !== undefined) {
      const intent = extractConstraintIntent(constraints.humidityFriendly);
      const humidityFriendlyValue = typeof constraints.humidityFriendly === 'object' && 'value' in constraints.humidityFriendly
        ? (constraints.humidityFriendly as any).value as boolean
        : (typeof constraints.humidityFriendly === 'boolean' ? constraints.humidityFriendly : undefined);
      if (humidityFriendlyValue !== undefined && humidityFriendlyValue !== null) {
        const productHumidityFriendly = enrichedColumns?.humidityFriendly ?? (attrs as any).humidityFriendly;
        const matchScore = matchHumidityFriendly(
          typeof productHumidityFriendly === 'boolean' ? productHumidityFriendly : undefined,
          humidityFriendlyValue
        );
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // OccasionContext
    if (constraints.occasionContext) {
      const intent = extractConstraintIntent(constraints.occasionContext);
      const occasionContextValues = extractConstraintValues(constraints.occasionContext) || [];
      if (occasionContextValues.length > 0) {
        const productOccasionContext = enrichedColumns?.occasionContext ?? extractAttrValue(attrs, 'occasionContext');
        const matchScore = matchOccasionContext(
          Array.isArray(productOccasionContext) ? productOccasionContext : undefined,
          occasionContextValues
        );
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // ProblemSolutions
    if (constraints.problemSolutions) {
      const intent = extractConstraintIntent(constraints.problemSolutions);
      const problemSolutionsValues = extractConstraintValues(constraints.problemSolutions) || [];
      if (problemSolutionsValues.length > 0) {
        const productProblemSolutions = enrichedColumns?.problemSolutions ?? extractAttrValue(attrs, 'problemSolutions');
        const matchScore = matchProblemSolutions(
          Array.isArray(productProblemSolutions) ? productProblemSolutions : undefined,
          problemSolutionsValues
        );
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    // FunctionFeatures
    if (constraints.functionFeatures) {
      const intent = extractConstraintIntent(constraints.functionFeatures);
      const functionFeaturesValues = extractConstraintValues(constraints.functionFeatures) || [];
      if (functionFeaturesValues.length > 0) {
        const productFunctionFeatures = enrichedColumns?.functionFeatures ?? extractAttrValue(attrs, 'functionFeatures');
        const matchScore = matchFunctionFeatures(
          Array.isArray(productFunctionFeatures) ? productFunctionFeatures : undefined,
          functionFeaturesValues
        );
        if (intent === 'excluded' && matchScore > 0) return false;
        if (intent === 'required' && matchScore === 0) return false;
      }
    }
    
    return true; // Keep product if no excluded/required constraint violations
  });
  
  // Convert back to ProductWithVectorScore format
  const filteredProducts = filteredProductsWithEnriched.map(({ product }) => {
    const original = products.find(p => p.product.id === product.id);
    return original || { product, vectorScore: 0 };
  });
  
  // If still no products after filtering, return empty (will trigger further relaxation)
  if (filteredProducts.length === 0) {
    return [];
  }
  
  // PHASE 2: Calculate constraint scores and rank
  const productsWithConstraintScores = await Promise.all(
    filteredProducts.map(async ({ product, vectorScore }) => {
      const enrichedColumns: EnrichedColumnValues = {
        color: product.color ?? null,
        fabric: product.fabric ?? null,
        material: product.material ?? null,
        occasion: product.occasion ?? null,
        season: product.season ?? null,
        fit: product.fit ?? null,
        length: product.length ?? null,
        sleeve: product.sleeve ?? null,
        neckline: product.neckline ?? null,
        riseWaist: product.riseWaist ?? null,
        formalityLevel: product.formalityLevel ?? null,
        temperatureIntent: product.temperatureIntent ?? null,
        humidityFriendly: product.humidityFriendly ?? null,
        occasionContext: product.occasionContext ?? null,
        problemSolutions: product.problemSolutions ?? null,
        functionFeatures: product.functionFeatures ?? null,
        colorShade: product.colorShade ?? null,
        colorUndertone: product.colorUndertone ?? null,
        multicolor: product.multicolor ?? null,
        seasonalPalette: product.seasonalPalette ?? null,
        enrichedColor: product.enrichedColor ?? null,
        ageGroup: product.ageGroup ?? null,
      };
      
      const constraintScore = calculateConstraintMatchScore(
        product,
        constraints,
        queryContext,
        enrichedColumns
      );
      
      return { product, vectorScore, constraintScore };
    })
  );
  
  // Calculate final scores - ONLY use constraint score (vector score is only for product loading/retrieval)
  const productsWithScores: ProductWithFinalScore[] = productsWithConstraintScores.map(({ product, vectorScore, constraintScore }) => {
    // Final score: constraint score only (vector score is not used in final ranking)
    const finalScore = constraintScore;
    return { product, finalScore, constraintScore };
  });
  
  // Sort by final score
  productsWithScores.sort((a, b) => {
    if (Math.abs(a.finalScore - b.finalScore) < 0.001) {
      return b.constraintScore - a.constraintScore;
    }
    return b.finalScore - a.finalScore;
  });
  
  return productsWithScores;
}
