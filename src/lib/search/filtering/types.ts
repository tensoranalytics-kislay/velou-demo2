/**
 * Filtering Types
 * 
 * Shared types for filtering modules
 */

import type { SearchConstraints } from '../types';

/**
 * Category OR condition type (for category bridging)
 */
export type CategoryOrCondition = Array<{ category?: string; googleCategory?: string; productType?: string }>;

/**
 * Attribute constraint metadata
 * 
 * Used to determine which constraints are "hard" (user-requested) vs "derived" (auto-inferred)
 */
export type AttributeConstraintMeta = {
  hasHardAttributeConstraints: boolean;
  hasCategoryBridge: boolean;
  hardFacetFields: string[];
  ignoredDerivedFacetFields: string[];
};


