/**
 * Attribute Filtering
 * 
 * Filters products based on attribute constraints (colors, fabrics, materials, etc.).
 * This is schema-driven and vertical-aware, working with any unified catalog attributes.
 * 
 * The filtering logic:
 * - Enforces user-requested facet filters (hard constraints)
 * - Uses soft matching for some fields (useCases, benefits, compatibility)
 * - Validates colors against catalog ontology when available
 * - Category bridging via JSON categories/product types is best-effort
 */

import type { ProductAttributes, SearchConstraints } from '../types';
import type { AttributeConstraintMeta, CategoryOrCondition } from './types';
import { matchAnyColor } from './color-matcher';
import { matchAnyAgeGroup } from './age-group-matcher';
import type { ConstraintIntent, QueryConstraintsWithIntent, QueryConstraintsOld } from '../../loveshackfancy/constraint-utils';
import { extractConstraintValues, extractConstraintIntent, hasIntentFormat, flattenConstraintsWithIntent } from '../../loveshackfancy/constraint-utils';

// CategoryOrCondition is exported from types.ts

/**
 * Normalize string value (lowercase, trim)
 */
const normalize = (value?: string) => value?.toLowerCase().trim();

/**
 * Check if array includes all needles
 */
const arrayIncludes = (haystack: string[] | undefined, needles: string[] | undefined) => {
  if (!needles?.length) return true;
  if (!haystack?.length) return false;
  const hay = haystack.map((entry) => entry.toLowerCase());
  return needles.every((needle) => hay.includes(needle.toLowerCase()));
};

/**
 * Value matching with special handling for gender
 */
const valueMatches = (value: string | undefined, needles: string[] | undefined) => {
  if (!needles?.length) return true;
  if (!value) return false;
  const val = value.toLowerCase().trim();
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase().trim();
    // For gender, support both normalized (mens/womens) and CSV values (male/female)
    if (normalizedNeedle === 'mens' && (val === 'mens' || val === 'male')) return true;
    if (normalizedNeedle === 'womens' && (val === 'womens' || val === 'female')) return true;
    if (normalizedNeedle === 'unisex' && val === 'unisex') return true;
    // Default substring matching for other fields
    return val.includes(normalizedNeedle);
  });
};

/**
 * Substring matching for materials/fabrics
 * 
 * Example: "cotton" matches "75% Cotton 21% Polyester"
 */
const materialMatches = (value: string | undefined, needles: string[] | undefined) => {
  if (!needles?.length) return true;
  if (!value) return false;
  const val = value.toLowerCase();
  // Check if any needle appears as a substring in the value
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase();
    // Word boundary matching for better precision
    return val.includes(normalizedNeedle);
  });
};

/**
 * Strict color matching
 * 
 * Only match if color is exact or contains the base color word.
 * Colors must come from catalog color values only when ontology is provided.
 */
const colorMatches = (value: string | undefined, needles: string[] | undefined, colorOntology?: string[]) => {
  if (!needles?.length) return true;
  if (!value) return false;
  const val = value.toLowerCase().trim();
  
  // If ontology provided, validate that needles are in ontology
  if (colorOntology && colorOntology.length > 0) {
    const ontologyLower = colorOntology.map(c => c.toLowerCase());
    const validNeedles = needles.filter(needle => {
      const normalizedNeedle = needle.toLowerCase();
      // Check if needle matches any ontology color (exact or contains)
      return ontologyLower.some(ontColor => 
        ontColor === normalizedNeedle || 
        ontColor.includes(normalizedNeedle) || 
        normalizedNeedle.includes(ontColor)
      );
    });
    if (validNeedles.length === 0) return true; // If no valid colors, don't filter
    // Match against valid colors only
    return validNeedles.some((needle) => {
      const normalizedNeedle = needle.toLowerCase();
      return val === normalizedNeedle || val.includes(normalizedNeedle) || normalizedNeedle.includes(val);
    });
  }
  
  // Fallback to substring matching if no ontology
  return needles.some((needle) => {
    const normalizedNeedle = needle.toLowerCase();
    return val === normalizedNeedle || val.includes(normalizedNeedle) || normalizedNeedle.includes(val);
  });
};

/**
 * Derive attribute constraint metadata
 * 
 * Determines which constraints are "hard" (user-requested) vs "derived" (auto-inferred).
 * Only explicit, user-facing facets count as hard filters.
 */
export function deriveAttributeConstraintMeta(
  constraints: SearchConstraints,
  categoryOr?: CategoryOrCondition,
): AttributeConstraintMeta {
  type FacetDescriptor = {
    key: keyof SearchConstraints;
    derived: boolean;
  };

  const USER_FACET_DESCRIPTORS: FacetDescriptor[] = [
    { key: 'colors', derived: false },
    { key: 'fabrics', derived: false },
    { key: 'materials', derived: false },
    { key: 'sizes', derived: false },
    { key: 'seasons', derived: false },
    { key: 'occasions', derived: false },
    { key: 'useCases', derived: false },
    { key: 'customLabels4', derived: false },
    { key: 'conditions', derived: false },
    { key: 'ageGroups', derived: false },
    { key: 'genders', derived: false },
    { key: 'brands', derived: false },
    // Classification-style bridges that may be auto-derived from category mapping
    { key: 'productTypes', derived: true },
    { key: 'googleCategories', derived: true },
    // Generic descriptive fields that LLMs may infer opportunistically
    { key: 'styleTags', derived: true },
    { key: 'benefits', derived: true },
    { key: 'claims', derived: true },
    { key: 'compatibility', derived: true },
  ];

  const hardFacetFields: string[] = [];
  const ignoredDerivedFacetFields: string[] = [];

  // Special handling: productTypes should NOT be ignored when explicitly requested
  const hasRequestedProductTypes = 
    constraints.productTypes && constraints.productTypes.length > 0;

  for (const descriptor of USER_FACET_DESCRIPTORS) {
    const rawValue = constraints[descriptor.key];
    const isActive = Array.isArray(rawValue)
      ? rawValue.length > 0
      : rawValue !== undefined && rawValue !== null && rawValue !== '';
    if (!isActive) continue;
    
    // Only ignore productTypes when NOT explicitly requested
    if (descriptor.derived) {
      if (descriptor.key === 'productTypes' && hasRequestedProductTypes) {
        // Don't ignore - treat as hard constraint
        if (!hardFacetFields.includes('productTypes')) {
          hardFacetFields.push('productTypes');
        }
      } else {
        ignoredDerivedFacetFields.push(descriptor.key as string);
      }
    } else if (!hardFacetFields.includes(descriptor.key as string)) {
      hardFacetFields.push(descriptor.key as string);
    }
  }

  if (constraints.fit) hardFacetFields.push('fit');
  if (constraints.sensoryProfile) hardFacetFields.push('sensoryProfile');

  return {
    hasHardAttributeConstraints: hardFacetFields.length > 0,
    hasCategoryBridge: Array.isArray(categoryOr) && categoryOr.length > 0,
    hardFacetFields,
    ignoredDerivedFacetFields,
  };
}

/**
 * Enriched column values from Product model
 * Used as primary source for filtering, with JSON attributes as fallback
 * 
 * MAPPING: Database Column → FashionConstraints Field
 * - color → colors
 * - fabric / material → materials
 * - occasion → occasions
 * - season → seasons
 * - fit → fits
 * - length → lengths
 * - sleeve → sleeveLengths
 * - neckline → necklines
 * - formalityLevel → formalityLevel
 * - temperatureIntent → temperatureIntent
 * - humidityFriendly → humidityFriendly
 * - occasionContext → occasionContext
 * - problemSolutions → problemSolutions
 * - functionFeatures → functionFeatures
 * - colorShade → colorShade
 * - colorUndertone → colorUndertone
 * - multicolor → multicolor
 * - seasonalPalette → seasonalPalette
 * - enrichedColor → colors (alternative source)
 * - ageGroup → ageGroups
 */
export type EnrichedColumnValues = {
  brand?: string | null; // Brand name for brand-based boosting
  // Core indexed columns (Phase 2)
  color?: string | null; // Most common color (indexed)
  fabric?: string | null; // Fabric type (indexed)
  material?: string | null; // Material type (indexed)
  occasion?: string | null; // Single occasion column (e.g., "Daytime, Vacation") (indexed)
  season?: string | null; // Season (indexed)
  fit?: string | null; // Fit type (indexed)
  
  // Enriched attributes (Fit & Construction)
  length?: string | null; // Length (e.g., "Maxi", "Mini", "Midi")
  sleeve?: string | null; // Sleeve type (e.g., "Short", "Long", "Sleeveless")
  neckline?: string | null; // Neckline (e.g., "Round", "V-Neck", "Scoop")
  riseWaist?: string | null; // Rise/waist placement (e.g., "Low Rise", "Mid Rise", "High Rise")
  
  // Style & Occasion
  formalityLevel?: string | null; // Formality level (e.g., "Casual", "Semi-Formal", "Formal")
  occasionContext?: string[] | null; // Array of occasions (e.g., ["Daytime", "Vacation"])
  dressCode?: string | null; // Dress code
  seasonalCues?: string | null; // Seasonal cues
  silhouetteCut?: string | null; // Silhouette/style cut (e.g., "A-Line", "Wrap", "Fit and Flare", "Empire")
  
  // Weather & Comfort
  temperatureIntent?: string | null; // Temperature intent (e.g., "Warm Weather", "Cold Weather")
  humidityFriendly?: boolean | null; // Humidity friendly
  
  // Problem-Solution
  problemSolutions?: string[] | null; // Problem solutions (array)
  functionFeatures?: string[] | null; // Function features (array)
  
  // Color Details
  colorShade?: string | null; // Color shade (e.g., "Light", "Dark", "Medium")
  colorUndertone?: string | null; // Color undertone (e.g., "Warm", "Cool", "Neutral")
  multicolor?: boolean | null; // Multicolor flag
  seasonalPalette?: string | null; // Seasonal palette
  enrichedColor?: string | null; // User-friendly color terms (e.g., "White, Bright White, Pure White")
  
  // Demographics
  ageGroup?: string | null; // Age categories (e.g., "Adult", "Kids", "Baby, Toddler")
};

/**
 * Check if product attributes match search constraints
 * 
 * This function checks enriched columns FIRST (if provided), then falls back to JSON attributes.
 * This ensures we use indexed columns when available for better performance.
 * 
 * This is data-agnostic - it only enforces user-requested facet filters.
 * Category bridging via JSON categories/product types is best-effort and never used to exclude on its own.
 * 
 * @param attributes - Product attributes JSON (fallback source)
 * @param constraints - Search constraints
 * @param categoryOr - Optional category OR conditions (for category bridging)
 * @param colorOntology - Optional color ontology for strict color matching
 * @param meta - Optional pre-computed attribute constraint metadata
 * @param enrichedColumns - Optional enriched column values (primary source)
 * @returns true if product matches all constraints
 * 
 * @example
 * ```typescript
 * const matches = matchesAttributeFilters(
 *   product.attributes,
 *   { colors: ['blue'], fabrics: ['cotton'] },
 *   undefined,
 *   ['blue', 'navy', 'teal'],
 *   undefined,
 *   { length: 'Midi', formalityLevel: 'Semi-Formal' }
 * );
 * ```
 */
/**
 * Check if a constraint value matches with intent awareness
 * Returns null if constraint should not be used for filtering (handled in ranking)
 */
function checkConstraintMatch(
  constraint: any,
  constraintType: string,
  productValue: any,
  matchFn: (productValue: any, constraintValues: string[]) => boolean
): boolean | null {
  if (!constraint) return null;
  
  // Extract values and intent from constraint (handles both old and new formats)
  const values = extractConstraintValues(constraint);
  const intent = extractConstraintIntent(constraint);
  
  if (!values || values.length === 0) return null;
  
  // Hard filters: required and excluded
  if (intent === 'required') {
    // Must match exactly - hard filter
    return matchFn(productValue, values);
  }
  
  if (intent === 'excluded') {
    // Must NOT match - hard filter
    return !matchFn(productValue, values);
  }
  
  // Soft filters: strong and preferred - handled in ranking, not filtering
  // Return null to indicate this constraint should not filter (but will be used in ranking)
  return null;
}

export function matchesAttributeFilters(
  attributes: ProductAttributes | null | undefined,
  constraints: SearchConstraints | QueryConstraintsWithIntent,
  categoryOr?: CategoryOrCondition,
  colorOntology?: string[],
  meta?: AttributeConstraintMeta,
  enrichedColumns?: EnrichedColumnValues | null,
): boolean {
  // Normalize constraints to old format for compatibility
  const normalizedConstraints: SearchConstraints = hasIntentFormat(constraints as any)
    ? flattenConstraintsWithIntent(constraints as QueryConstraintsWithIntent) as SearchConstraints
    : constraints as SearchConstraints;
  
  const metaInfo = meta ?? deriveAttributeConstraintMeta(normalizedConstraints, categoryOr);
  
  if (!metaInfo.hasHardAttributeConstraints) {
    return true;
  }

  const attrs = attributes ?? undefined;
  if (!attrs) {
    return false;
  }

  // Check intent-aware constraints for hard filtering (required/excluded)
  // For 'strong' and 'preferred' intents, we skip filtering (handled in ranking)
  
  // Color matching: use multi-level color matcher (enriched_color → variant_colors → color)
  if (constraints.colors) {
    const colorMatch = checkConstraintMatch(
      constraints.colors,
      'colors',
      {
        enrichedColor: enrichedColumns?.enrichedColor ?? (attrs as any).enriched_color,
        variantColors: (attrs as any).variant_colors,
        color: attrs.color,
      },
      (productColors, constraintColors) => matchAnyColor(productColors, constraintColors)
    );
    
    if (colorMatch !== null) {
      if (!colorMatch) return false;
    } else if (normalizedConstraints.colors?.length) {
      // Fallback to old format if intent format didn't filter
      const productColors = {
        enrichedColor: enrichedColumns?.enrichedColor ?? (attrs as any).enriched_color,
        variantColors: (attrs as any).variant_colors,
        color: attrs.color,
      };
      if (!matchAnyColor(productColors, normalizedConstraints.colors)) {
        return false;
      }
    }
  }

  // Materials
  if (constraints.materials) {
    const materialMatch = checkConstraintMatch(
      constraints.materials,
      'materials',
      attrs,
      (productAttrs, constraintMaterials) => {
        const materialMatchesString = materialMatches(productAttrs.material, constraintMaterials);
        const materialMatchesArray =
          productAttrs.materials?.some((value: string) => materialMatches(value, constraintMaterials)) ?? false;
        return materialMatchesString || materialMatchesArray;
      }
    );
    if (materialMatch !== null && !materialMatch) return false;
    // Fallback to old format
    if (materialMatch === null && normalizedConstraints.materials?.length) {
      const materialMatchesString = materialMatches(attrs.material, normalizedConstraints.materials);
      const materialMatchesArray =
        attrs.materials?.some((value) => materialMatches(value, normalizedConstraints.materials!)) ?? false;
      if (!materialMatchesString && !materialMatchesArray) return false;
    }
  }

  // Fabrics (fallback to old format)
  if (normalizedConstraints.fabrics?.length) {
    if (!materialMatches(attrs.fabric, normalizedConstraints.fabrics)) return false;
  }

  // Fit
  if (normalizedConstraints.fit && normalize(attrs.fit) !== normalize(normalizedConstraints.fit)) return false;
  
  // Seasons
  if (constraints.seasons) {
    const seasonMatch = checkConstraintMatch(
      constraints.seasons,
      'seasons',
      attrs.season,
      (productSeason, constraintSeasons) => valueMatches(productSeason, constraintSeasons)
    );
    if (seasonMatch !== null && !seasonMatch) return false;
    if (seasonMatch === null && normalizedConstraints.seasons?.length) {
      if (!valueMatches(attrs.season, normalizedConstraints.seasons)) return false;
    }
  }
  
  // Occasions
  if (constraints.occasions) {
    const occasionMatch = checkConstraintMatch(
      constraints.occasions,
      'occasions',
      attrs.occasion,
      (productOccasion, constraintOccasions) => valueMatches(productOccasion, constraintOccasions)
    );
    if (occasionMatch !== null && !occasionMatch) return false;
    if (occasionMatch === null && normalizedConstraints.occasions?.length) {
      if (!valueMatches(attrs.occasion, normalizedConstraints.occasions)) return false;
    }
  }
  
  // Size matching: check variant_sizes from attributes first, then fallback to sizes
  if (constraints.sizes) {
    const sizeMatch = checkConstraintMatch(
      constraints.sizes,
      'sizes',
      attrs,
      (productAttrs, constraintSizes) => {
        const variantSizes = (productAttrs as any).variant_sizes as string[] | undefined;
        const sizesArray = variantSizes?.length ? variantSizes : productAttrs.sizes;
        return arrayIncludes(sizesArray, constraintSizes);
      }
    );
    if (sizeMatch !== null && !sizeMatch) return false;
    if (sizeMatch === null && normalizedConstraints.sizes?.length) {
      const variantSizes = (attrs as any).variant_sizes as string[] | undefined;
      const sizesArray = variantSizes?.length ? variantSizes : attrs.sizes;
      if (!arrayIncludes(sizesArray, normalizedConstraints.sizes)) return false;
    }
  }
  
  // Length: check enriched column first, then JSON fallback
  const lengthsValues = extractConstraintValues(constraints.lengths);
  if (lengthsValues && lengthsValues.length > 0) {
    const lengthValue = enrichedColumns?.length ?? attrs.length;
    if (!valueMatches(lengthValue ?? undefined, lengthsValues)) return false;
  }

  // Enriched attribute filters: check enriched columns first, then JSON fallback
  // Formality level
  const formalityLevelValues = extractConstraintValues(constraints.formalityLevel);
  if (formalityLevelValues && formalityLevelValues.length > 0) {
    const formalityValue = enrichedColumns?.formalityLevel ?? (attrs as any).formalityLevel;
    if (!valueMatches(formalityValue ?? undefined, formalityLevelValues)) return false;
  }

  // Temperature intent
  const temperatureIntentValue = typeof constraints.temperatureIntent === 'object' && constraints.temperatureIntent !== null && 'value' in constraints.temperatureIntent
    ? constraints.temperatureIntent.value
    : constraints.temperatureIntent;
  if (temperatureIntentValue) {
    const tempValue = enrichedColumns?.temperatureIntent ?? (attrs as any).temperatureIntent;
    if (normalize(tempValue ?? undefined) !== normalize(temperatureIntentValue)) return false;
  }

  // Humidity friendly
  const humidityFriendlyValue = typeof constraints.humidityFriendly === 'object' && constraints.humidityFriendly !== null && 'value' in constraints.humidityFriendly
    ? constraints.humidityFriendly.value
    : constraints.humidityFriendly;
  if (humidityFriendlyValue !== undefined) {
    const humidityValue = enrichedColumns?.humidityFriendly ?? (attrs as any).humidityFriendly;
    if (typeof humidityValue === 'boolean') {
      if (humidityValue !== humidityFriendlyValue) return false;
    } else if (humidityValue === undefined || humidityValue === null) {
      return false; // Required but missing
    }
  }

  // Occasion context (array) - duplicate check (already handled above with intent-aware filtering)
  // This is a fallback for old format constraints
  const occasionContextValues = extractConstraintValues(constraints.occasionContext);
  if (occasionContextValues && occasionContextValues.length > 0) {
    const occasionArray = enrichedColumns?.occasionContext ?? (attrs as any).occasionContext;
    if (!Array.isArray(occasionArray) || occasionArray.length === 0) {
      return false;
    }
    const occasionLower = occasionArray.map((o: string) => o.toLowerCase());
    const hasMatch = occasionContextValues.some((constraintOccasion) =>
      occasionLower.includes(constraintOccasion.toLowerCase())
    );
    if (!hasMatch) return false;
  }

  // Problem solutions (array) - duplicate check (already handled above with intent-aware filtering)
  const problemSolutionsValues2 = extractConstraintValues(constraints.problemSolutions);
  if (problemSolutionsValues2 && problemSolutionsValues2.length > 0) {
    const solutionsArray = enrichedColumns?.problemSolutions ?? (attrs as any).problemSolutions;
    if (!Array.isArray(solutionsArray) || solutionsArray.length === 0) {
      return false;
    }
    const solutionsLower = solutionsArray.map((s: string) => s.toLowerCase());
    const hasMatch = problemSolutionsValues2.some((constraintSolution) =>
      solutionsLower.includes(constraintSolution.toLowerCase())
    );
    if (!hasMatch) return false;
  }

  // Function features (array) - duplicate check (already handled above with intent-aware filtering)
  const functionFeaturesValues2 = extractConstraintValues(constraints.functionFeatures);
  if (functionFeaturesValues2 && functionFeaturesValues2.length > 0) {
    const featuresArray = enrichedColumns?.functionFeatures ?? (attrs as any).functionFeatures;
    if (!Array.isArray(featuresArray) || featuresArray.length === 0) {
    return false;
    }
    const featuresLower = featuresArray.map((f: string) => f.toLowerCase());
    const hasMatch = functionFeaturesValues2.some((constraintFeature) =>
      featuresLower.includes(constraintFeature.toLowerCase())
    );
    if (!hasMatch) return false;
  }

  // Color shade - duplicate check (already handled above with intent-aware filtering)
  const colorShadeValues2 = extractConstraintValues(constraints.colorShade);
  if (colorShadeValues2 && colorShadeValues2.length > 0) {
    const shadeValue = enrichedColumns?.colorShade ?? (attrs as any).colorShade;
    if (!valueMatches(shadeValue ?? undefined, colorShadeValues2)) return false;
  }

  // Color undertone - duplicate check (already handled above with intent-aware filtering)
  const colorUndertoneValues2 = extractConstraintValues(constraints.colorUndertone);
  if (colorUndertoneValues2 && colorUndertoneValues2.length > 0) {
    const undertoneValue = enrichedColumns?.colorUndertone ?? (attrs as any).colorUndertone;
    if (!valueMatches(undertoneValue ?? undefined, colorUndertoneValues2)) return false;
  }

  // Multicolor
  const multicolorValue2 = typeof constraints.multicolor === 'object' && constraints.multicolor !== null && 'value' in constraints.multicolor
    ? constraints.multicolor.value
    : constraints.multicolor;
  if (multicolorValue2 !== undefined) {
    const multicolorValue = enrichedColumns?.multicolor ?? (attrs as any).multicolor;
    if (typeof multicolorValue === 'boolean') {
      if (multicolorValue !== multicolorValue2) return false;
    } else if (multicolorValue === undefined || multicolorValue === null) {
      return false; // Required but missing
    }
  }

  // Seasonal palette
  const seasonalPaletteValues = extractConstraintValues(constraints.seasonalPalette);
  if (seasonalPaletteValues && seasonalPaletteValues.length > 0) {
    const paletteValue = enrichedColumns?.seasonalPalette ?? (attrs as any).seasonalPalette;
    if (!valueMatches(paletteValue ?? undefined, seasonalPaletteValues)) return false;
  }
  
  // Use soft matching for useCases: check if any constraint value is contained in any product useCase (substring match)
  if ((normalizedConstraints as any).useCases?.length) {
    const productUseCases = attrs.useCases || [];
    const useCaseMatches = (normalizedConstraints as any).useCases.some((constraintUseCase: string) =>
      productUseCases.some((productUseCase) =>
        productUseCase.toLowerCase().includes(constraintUseCase.toLowerCase()) ||
        constraintUseCase.toLowerCase().includes(productUseCase.toLowerCase())
      )
    );
    if (!useCaseMatches) return false;
  }

  if (
    (normalizedConstraints as any).sensoryProfile &&
    !materialMatches(attrs.sensoryProfile, [(normalizedConstraints as any).sensoryProfile])
  )
    return false;

  // ProductTypes matching: check both standard productType and L'Occitane structured attributes
  if ((normalizedConstraints as any).productTypes?.length) {
    const standardMatch = valueMatches(attrs.productType, (normalizedConstraints as any).productTypes);
    
    // Also check L'Occitane structured productType if available
    const loccitaneMatch = 
      (attrs as any).loccitaneStructured?.productType &&
      valueMatches((attrs as any).loccitaneStructured.productType, (normalizedConstraints as any).productTypes);
    
    if (!standardMatch && !loccitaneMatch) {
      return false;
    }
  }
  if (
    (normalizedConstraints as any).googleCategories?.length &&
    !valueMatches(attrs.googleProductCategory, (normalizedConstraints as any).googleCategories)
  )
    return false;
  if (
    (normalizedConstraints as any).customLabels4?.length &&
    !valueMatches(attrs.customLabel4, (normalizedConstraints as any).customLabels4)
  )
    return false;
  if ((normalizedConstraints as any).conditions?.length && !valueMatches(attrs.condition, (normalizedConstraints as any).conditions))
    return false;
  // Age group matching: use hierarchical age group matcher
  const ageGroupsValues = extractConstraintValues(constraints.ageGroups);
  if (ageGroupsValues && ageGroupsValues.length > 0) {
    const productAgeGroup = enrichedColumns?.ageGroup ?? attrs.ageGroup;
    if (!matchAnyAgeGroup(productAgeGroup, ageGroupsValues)) {
    return false;
    }
  }
  if ((normalizedConstraints as any).genders?.length && !valueMatches(attrs.gender, (normalizedConstraints as any).genders)) return false;
  if ((normalizedConstraints as any).brands?.length && !valueMatches(attrs.brand, (normalizedConstraints as any).brands)) return false;

  // Use soft matching for compatibility: check if any constraint value is contained in any product compatibility (substring match)
  if ((normalizedConstraints as any).compatibility?.length) {
    const productCompatibility = attrs.compatibility || [];
    const compatibilityMatches = (normalizedConstraints as any).compatibility.some((constraintCompat: string) =>
      productCompatibility.some((productCompat) =>
        productCompat.toLowerCase().includes(constraintCompat.toLowerCase()) ||
        constraintCompat.toLowerCase().includes(productCompat.toLowerCase())
      )
    );
    if (!compatibilityMatches) return false;
  }

  // Use soft matching for benefits: check if any constraint value is contained in any product benefit (substring match)
  if ((normalizedConstraints as any).benefits?.length) {
    const productBenefits = attrs.benefits || [];
    const benefitsMatches = (normalizedConstraints as any).benefits.some((constraintBenefit: string) =>
      productBenefits.some((productBenefit) =>
        productBenefit.toLowerCase().includes(constraintBenefit.toLowerCase()) ||
        constraintBenefit.toLowerCase().includes(productBenefit.toLowerCase())
      )
    );
    if (!benefitsMatches) return false;
  }

  // Use soft matching for claims: check if any constraint value is contained in any product claim (substring match)
  if ((normalizedConstraints as any).claims?.length) {
    const productClaims = attrs.claims || [];
    const claimsMatches = (normalizedConstraints as any).claims.some((constraintClaim: string) =>
      productClaims.some((productClaim) =>
        productClaim.toLowerCase().includes(constraintClaim.toLowerCase()) ||
        constraintClaim.toLowerCase().includes(productClaim.toLowerCase())
      )
    );
    if (!claimsMatches) return false;
  }

  return true;
}
