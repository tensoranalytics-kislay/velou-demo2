/**
 * Constraint Utilities
 * 
 * Provides utilities for converting between old and new constraint formats
 * to maintain backward compatibility during the transition to intent-based constraints.
 */

/**
 * Constraint intent levels
 */
export type ConstraintIntent = 
  | 'required'      // "only wants" - strict requirement (hard filter, weight: 2.0)
  | 'strong'        // "seriously wants" - strong preference (show this + similar, weight: 1.5)
  | 'preferred'     // "mildly wants" - soft preference (can include but not required, weight: 0.5)
  | 'excluded';     // "does not want" - exclusion (hard filter out, weight: -1.0)

/**
 * Constraint with intent wrapper
 */
export type ConstraintWithIntent<T = string[]> = {
  values: T;
  intent: ConstraintIntent;
  similarValues?: string[]; // For 'strong' intent - similar values after expansion
};

/**
 * Price constraint with intent
 */
export type PriceConstraintWithIntent = {
  value: number;
  intent: ConstraintIntent;
};

/**
 * Boolean constraint with intent
 */
export type BooleanConstraintWithIntent = {
  value: boolean;
  intent: ConstraintIntent;
};

/**
 * String constraint with intent
 */
export type StringConstraintWithIntent = {
  value: string;
  intent: ConstraintIntent;
  similarValues?: string[]; // For 'strong' intent - similar values after expansion
};

/**
 * Old format QueryConstraints (for backward compatibility)
 */
export type QueryConstraintsOld = {
  colors?: string[] | null;
  sizes?: string[] | null;
  occasions?: string[] | null;
  styles?: string[] | null;
  patterns?: string[] | null;
  seasons?: string[] | null;
  materials?: string[] | null;
  fits?: string[] | null;
  collections?: string[] | null;
  priceMinCents?: number | null;
  priceMaxCents?: number | null;
  embellishments?: string[] | null;
  necklines?: string[] | null;
  sleeveLengths?: string[] | null;
  lengths?: string[] | null;
  ageGroups?: string[] | null;
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
};

/**
 * New format QueryConstraints with intent
 */
export type QueryConstraintsWithIntent = {
  colors?: ConstraintWithIntent | null;
  sizes?: ConstraintWithIntent | null;
  occasions?: ConstraintWithIntent | null;
  styles?: ConstraintWithIntent | null;
  patterns?: ConstraintWithIntent | null;
  seasons?: ConstraintWithIntent | null;
  materials?: ConstraintWithIntent | null;
  fits?: ConstraintWithIntent | null;
  collections?: ConstraintWithIntent | null;
  priceMinCents?: PriceConstraintWithIntent | null;
  priceMaxCents?: PriceConstraintWithIntent | null;
  embellishments?: ConstraintWithIntent | null;
  necklines?: ConstraintWithIntent | null;
  sleeveLengths?: ConstraintWithIntent | null;
  lengths?: ConstraintWithIntent | null;
  ageGroups?: ConstraintWithIntent | null;
  formalityLevel?: ConstraintWithIntent | null;
  temperatureIntent?: StringConstraintWithIntent | null;
  humidityFriendly?: BooleanConstraintWithIntent | null;
  occasionContext?: ConstraintWithIntent | null;
  problemSolutions?: ConstraintWithIntent | null;
  functionFeatures?: ConstraintWithIntent | null;
  colorShade?: ConstraintWithIntent | null;
  colorUndertone?: ConstraintWithIntent | null;
  multicolor?: BooleanConstraintWithIntent | null;
  seasonalPalette?: ConstraintWithIntent | null;
  careRequirements?: ConstraintWithIntent | null;
  rainWind?: StringConstraintWithIntent | null;
  travelFeatures?: ConstraintWithIntent | null;
  pockets?: StringConstraintWithIntent | null;
  liningType?: StringConstraintWithIntent | null;
  braSolution?: StringConstraintWithIntent | null;
  ecoMaterials?: ConstraintWithIntent | null;
  certifications?: StringConstraintWithIntent | null;
  origin?: StringConstraintWithIntent | null;
  adaptiveFeatures?: StringConstraintWithIntent | null;
  sensoryFriendly?: StringConstraintWithIntent | null;
  finish?: StringConstraintWithIntent | null;
  modestyCues?: ConstraintWithIntent | null;
  layeringIntent?: StringConstraintWithIntent | null;
  pairingIntent?: StringConstraintWithIntent | null;
};

/**
 * Extract constraint values from either old or new format
 */
export function extractConstraintValues(
  constraint: ConstraintWithIntent | string[] | null | undefined
): string[] | null | undefined {
  if (!constraint) return constraint;
  if (Array.isArray(constraint)) return constraint; // Old format
  return constraint.values; // New format
}

/**
 * Extract constraint intent from either old or new format
 * Defaults to 'strong' for old format (backward compatibility)
 */
export function extractConstraintIntent(
  constraint: ConstraintWithIntent | StringConstraintWithIntent | BooleanConstraintWithIntent | PriceConstraintWithIntent | string[] | string | number | boolean | null | undefined
): ConstraintIntent | null {
  if (!constraint) return null;
  if (Array.isArray(constraint)) return 'strong'; // Old format - default to strong
  if (typeof constraint === 'string' || typeof constraint === 'number' || typeof constraint === 'boolean') return 'strong'; // Old format - default to strong
  if ('intent' in constraint) return constraint.intent; // New format
  return 'strong'; // Fallback
}

/**
 * Extract similar values from constraint (only for new format with 'strong' intent)
 */
export function extractSimilarValues(
  constraint: ConstraintWithIntent | string[] | null | undefined
): string[] | undefined {
  if (!constraint || Array.isArray(constraint)) return undefined; // Old format or no similar values
  return constraint.similarValues;
}

/**
 * Flatten constraints with intent to old format
 * Converts new format to old format for backward compatibility
 */
export function flattenConstraintsWithIntent(
  constraints: QueryConstraintsWithIntent
): QueryConstraintsOld {
  const flattened: QueryConstraintsOld = {};
  
  // Array constraints
  const arrayFields: Array<keyof QueryConstraintsWithIntent> = [
    'colors', 'sizes', 'occasions', 'styles', 'patterns', 'seasons', 'materials',
    'fits', 'collections', 'embellishments', 'necklines', 'sleeveLengths',
    'lengths', 'ageGroups', 'formalityLevel', 'occasionContext',
    'problemSolutions', 'functionFeatures', 'colorShade', 'colorUndertone',
    'seasonalPalette', 'careRequirements', 'travelFeatures', 'ecoMaterials',
    'modestyCues'
  ];
  
  for (const field of arrayFields) {
    const constraint = constraints[field];
    if (constraint && 'values' in constraint) {
      flattened[field as keyof QueryConstraintsOld] = constraint.values as any;
    } else if (constraint === null) {
      (flattened as any)[field] = null;
    }
  }
  
  // Price constraints
  if (constraints.priceMinCents && 'value' in constraints.priceMinCents) {
    flattened.priceMinCents = constraints.priceMinCents.value;
  } else if (constraints.priceMinCents === null) {
    flattened.priceMinCents = null;
  }
  
  if (constraints.priceMaxCents && 'value' in constraints.priceMaxCents) {
    flattened.priceMaxCents = constraints.priceMaxCents.value;
  } else if (constraints.priceMaxCents === null) {
    flattened.priceMaxCents = null;
  }
  
  // String constraints
  const stringFields: Array<keyof QueryConstraintsWithIntent> = [
    'temperatureIntent', 'rainWind', 'pockets', 'liningType', 'braSolution',
    'certifications', 'origin', 'adaptiveFeatures', 'sensoryFriendly',
    'finish', 'layeringIntent', 'pairingIntent'
  ];
  
  for (const field of stringFields) {
    const constraint = constraints[field];
    if (constraint && 'value' in constraint) {
      (flattened as any)[field] = constraint.value;
    } else if (constraint === null) {
      (flattened as any)[field] = null;
    }
  }
  
  // Boolean constraints
  if (constraints.humidityFriendly && 'value' in constraints.humidityFriendly) {
    flattened.humidityFriendly = constraints.humidityFriendly.value;
  } else if (constraints.humidityFriendly === null) {
    flattened.humidityFriendly = null;
  }
  
  if (constraints.multicolor && 'value' in constraints.multicolor) {
    flattened.multicolor = constraints.multicolor.value;
  } else if (constraints.multicolor === null) {
    flattened.multicolor = null;
  }
  
  return flattened;
}

/**
 * Normalize constraints to intent format
 * Converts old format to new format (defaults to 'strong' intent)
 */
export function normalizeConstraintsToIntent(
  constraints: QueryConstraintsOld,
  defaultIntent: ConstraintIntent = 'strong'
): QueryConstraintsWithIntent {
  const normalized: QueryConstraintsWithIntent = {};
  
  // Array constraints
  const arrayFields: Array<keyof QueryConstraintsOld> = [
    'colors', 'sizes', 'occasions', 'styles', 'patterns', 'seasons', 'materials',
    'fits', 'collections', 'embellishments', 'necklines', 'sleeveLengths',
    'lengths', 'ageGroups', 'formalityLevel', 'occasionContext',
    'problemSolutions', 'functionFeatures', 'colorShade', 'colorUndertone',
    'seasonalPalette', 'careRequirements', 'travelFeatures', 'ecoMaterials',
    'modestyCues'
  ];
  
  for (const field of arrayFields) {
    const value = constraints[field];
    if (value && Array.isArray(value)) {
      (normalized as any)[field] = {
        values: value,
        intent: defaultIntent,
      };
    } else if (value === null) {
      (normalized as any)[field] = null;
    }
  }
  
  // Price constraints
  if (typeof constraints.priceMinCents === 'number') {
    normalized.priceMinCents = {
      value: constraints.priceMinCents,
      intent: defaultIntent,
    };
  } else if (constraints.priceMinCents === null) {
    normalized.priceMinCents = null;
  }
  
  if (typeof constraints.priceMaxCents === 'number') {
    normalized.priceMaxCents = {
      value: constraints.priceMaxCents,
      intent: defaultIntent,
    };
  } else if (constraints.priceMaxCents === null) {
    normalized.priceMaxCents = null;
  }
  
  // String constraints
  const stringFields: Array<keyof QueryConstraintsOld> = [
    'temperatureIntent', 'rainWind', 'pockets', 'liningType', 'braSolution',
    'certifications', 'origin', 'adaptiveFeatures', 'sensoryFriendly',
    'finish', 'layeringIntent', 'pairingIntent'
  ];
  
  for (const field of stringFields) {
    const value = constraints[field];
    if (typeof value === 'string') {
      (normalized as any)[field] = {
        value,
        intent: defaultIntent,
      };
    } else if (value === null) {
      (normalized as any)[field] = null;
    }
  }
  
  // Boolean constraints
  if (typeof constraints.humidityFriendly === 'boolean') {
    normalized.humidityFriendly = {
      value: constraints.humidityFriendly,
      intent: defaultIntent,
    };
  } else if (constraints.humidityFriendly === null) {
    normalized.humidityFriendly = null;
  }
  
  if (typeof constraints.multicolor === 'boolean') {
    normalized.multicolor = {
      value: constraints.multicolor,
      intent: defaultIntent,
    };
  } else if (constraints.multicolor === null) {
    normalized.multicolor = null;
  }
  
  return normalized;
}

/**
 * Check if constraints are in new format (with intent)
 */
export function hasIntentFormat(
  constraints: QueryConstraintsWithIntent | QueryConstraintsOld
): constraints is QueryConstraintsWithIntent {
  // Check if any constraint has the intent structure
  const sampleField = constraints.colors;
  if (!sampleField) return false;
  if (Array.isArray(sampleField)) return false; // Old format
  return 'intent' in sampleField; // New format
}

