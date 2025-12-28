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
 * Check if product attributes match search constraints
 * 
 * This is data-agnostic - it only enforces user-requested facet filters.
 * Category bridging via JSON categories/product types is best-effort and never used to exclude on its own.
 * 
 * @param attributes - Product attributes (may be null/undefined)
 * @param constraints - Search constraints
 * @param categoryOr - Optional category OR conditions (for category bridging)
 * @param colorOntology - Optional color ontology for strict color matching
 * @param meta - Optional pre-computed attribute constraint metadata
 * @returns true if product matches all constraints
 * 
 * @example
 * ```typescript
 * const matches = matchesAttributeFilters(
 *   product.attributes,
 *   { colors: ['blue'], fabrics: ['cotton'] },
 *   undefined,
 *   ['blue', 'navy', 'teal'],
 * );
 * ```
 */
export function matchesAttributeFilters(
  attributes: ProductAttributes | null | undefined,
  constraints: SearchConstraints,
  categoryOr?: CategoryOrCondition,
  colorOntology?: string[],
  meta?: AttributeConstraintMeta,
): boolean {
  const metaInfo = meta ?? deriveAttributeConstraintMeta(constraints, categoryOr);
  
  if (!metaInfo.hasHardAttributeConstraints) {
    return true;
  }

  const attrs = attributes ?? undefined;
  if (!attrs) {
    return false;
  }

  if (constraints.colors?.length) {
    if (!colorMatches(attrs.color, constraints.colors, colorOntology)) return false;
  }

  if (constraints.fabrics?.length) {
    if (!materialMatches(attrs.fabric, constraints.fabrics)) return false;
  }

  if (constraints.materials?.length) {
    const materialMatchesString = materialMatches(attrs.material, constraints.materials);
    const materialMatchesArray =
      attrs.materials?.some((value) => materialMatches(value, constraints.materials)) ?? false;
    if (!materialMatchesString && !materialMatchesArray) return false;
  }

  if (constraints.fit && normalize(attrs.fit) !== normalize(constraints.fit)) return false;
  if (constraints.seasons?.length && !valueMatches(attrs.season, constraints.seasons)) return false;
  if (constraints.occasions?.length && !valueMatches(attrs.occasion, constraints.occasions))
    return false;
  if (constraints.sizes?.length && !arrayIncludes(attrs.sizes, constraints.sizes)) return false;
  if (constraints.lengths?.length && !valueMatches(attrs.length, constraints.lengths)) return false;
  
  // Use soft matching for useCases: check if any constraint value is contained in any product useCase (substring match)
  if (constraints.useCases?.length) {
    const productUseCases = attrs.useCases || [];
    const useCaseMatches = constraints.useCases.some((constraintUseCase) =>
      productUseCases.some((productUseCase) =>
        productUseCase.toLowerCase().includes(constraintUseCase.toLowerCase()) ||
        constraintUseCase.toLowerCase().includes(productUseCase.toLowerCase())
      )
    );
    if (!useCaseMatches) return false;
  }

  if (
    constraints.sensoryProfile &&
    !materialMatches(attrs.sensoryProfile, [constraints.sensoryProfile])
  )
    return false;

  // ProductTypes matching: check both standard productType and L'Occitane structured attributes
  if (constraints.productTypes?.length) {
    const standardMatch = valueMatches(attrs.productType, constraints.productTypes);
    
    // Also check L'Occitane structured productType if available
    const loccitaneMatch = 
      (attrs as any).loccitaneStructured?.productType &&
      valueMatches((attrs as any).loccitaneStructured.productType, constraints.productTypes);
    
    if (!standardMatch && !loccitaneMatch) {
      return false;
    }
  }
  if (
    constraints.googleCategories?.length &&
    !valueMatches(attrs.googleProductCategory, constraints.googleCategories)
  )
    return false;
  if (
    constraints.customLabels4?.length &&
    !valueMatches(attrs.customLabel4, constraints.customLabels4)
  )
    return false;
  if (constraints.conditions?.length && !valueMatches(attrs.condition, constraints.conditions))
    return false;
  if (constraints.ageGroups?.length && !valueMatches(attrs.ageGroup, constraints.ageGroups))
    return false;
  if (constraints.genders?.length && !valueMatches(attrs.gender, constraints.genders)) return false;
  if (constraints.brands?.length && !valueMatches(attrs.brand, constraints.brands)) return false;

  // Use soft matching for compatibility: check if any constraint value is contained in any product compatibility (substring match)
  if (constraints.compatibility?.length) {
    const productCompatibility = attrs.compatibility || [];
    const compatibilityMatches = constraints.compatibility.some((constraintCompat) =>
      productCompatibility.some((productCompat) =>
        productCompat.toLowerCase().includes(constraintCompat.toLowerCase()) ||
        constraintCompat.toLowerCase().includes(productCompat.toLowerCase())
      )
    );
    if (!compatibilityMatches) return false;
  }

  // Use soft matching for benefits: check if any constraint value is contained in any product benefit (substring match)
  if (constraints.benefits?.length) {
    const productBenefits = attrs.benefits || [];
    const benefitsMatches = constraints.benefits.some((constraintBenefit) =>
      productBenefits.some((productBenefit) =>
        productBenefit.toLowerCase().includes(constraintBenefit.toLowerCase()) ||
        constraintBenefit.toLowerCase().includes(productBenefit.toLowerCase())
      )
    );
    if (!benefitsMatches) return false;
  }

  // Use soft matching for claims: check if any constraint value is contained in any product claim (substring match)
  if (constraints.claims?.length) {
    const productClaims = attrs.claims || [];
    const claimsMatches = constraints.claims.some((constraintClaim) =>
      productClaims.some((productClaim) =>
        productClaim.toLowerCase().includes(constraintClaim.toLowerCase()) ||
        constraintClaim.toLowerCase().includes(productClaim.toLowerCase())
      )
    );
    if (!claimsMatches) return false;
  }

  return true;
}

