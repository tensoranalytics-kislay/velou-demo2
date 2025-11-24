/**
 * Follow-up detection logic
 * Detects whether a user message is a refinement, category switch, or confirmation
 */

import type { SearchConstraints } from '../../search/types';
import { canonicalizeCategory, type CanonicalCategory } from '../../search/canonicalize';
import type { CatalogOntology } from '../../search/ontology';

export type FollowUpType = 'REFINE' | 'SWITCH' | 'CONFIRM_SUGGESTION' | 'UNKNOWN';

export type FollowUpDetection = {
  isFollowUp: boolean;
  followUpType: FollowUpType;
  overrideCategory?: CanonicalCategory;
  detectedGender?: string; // "mens", "womens", or "unisex" if detected in message
  carryOver: {
    vibe: boolean; // season/occasion/style
    hardFilters: boolean; // color/size/price
  };
};

/**
 * Detects follow-up type from user message
 */
export function detectFollowUpType(
  userMessage: string,
  previousConstraints: SearchConstraints | null,
  hasPendingSuggestion: boolean,
  ontology: CatalogOntology,
): FollowUpDetection {
  const normalized = userMessage.toLowerCase().trim();

  // D) Heuristics for follow-up detection

  // Check for switch keywords: only/just/instead/show me X
  const switchPatterns = [
    /\b(only|just|instead|show me|switch to|not that|forget previous|reset)\s+([a-z\s]+)/i,
    /\b(only|just)\s+([a-z\s]+)\s+only/i,
  ];

  for (const pattern of switchPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const categoryText = match[2] || match[1];
      const canonical = canonicalizeCategory(categoryText, ontology);
      if (canonical.canonical !== 'UNKNOWN' && canonical.confidence > 0.3) {
        return {
          isFollowUp: true,
          followUpType: 'SWITCH',
          overrideCategory: canonical.canonical,
          carryOver: {
            vibe: /\b(same vibe|that vibe|keep.*vibe)\b/i.test(normalized),
            hardFilters: false, // Switch drops hard filters unless explicitly restated
          },
        };
      }
    }
  }

  // Check for explicit category mention without switch keywords
  if (previousConstraints) {
    const canonical = canonicalizeCategory(userMessage, ontology);
    if (canonical.canonical !== 'UNKNOWN' && canonical.confidence > 0.5) {
      // If new category detected and different from previous, it's a switch
      const prevCategory = Array.isArray(previousConstraints.category)
        ? previousConstraints.category[0]
        : previousConstraints.category;
      const prevCanonical = prevCategory
        ? canonicalizeCategory(prevCategory, ontology)
        : null;
      if (prevCanonical && prevCanonical.canonical !== canonical.canonical) {
        return {
          isFollowUp: true,
          followUpType: 'SWITCH',
          overrideCategory: canonical.canonical,
          carryOver: {
            vibe: false,
            hardFilters: false,
          },
        };
      }
    }
  }

  // Check for gender refinement patterns: "for men", "men's", "for women", etc.
  const genderRefinePatterns = [
    /\b(for|in)\s+(men|mens|men's|male|males)\b/i,
    /\b(for|in)\s+(women|womens|women's|female|females)\b/i,
    /\b(unisex|unisex)\b/i,
    /\b(men|mens|men's|male)\s+(though|please|only)\b/i,
    /\b(women|womens|women's|female)\s+(though|please|only)\b/i,
  ];

  for (const pattern of genderRefinePatterns) {
    if (pattern.test(normalized)) {
      // Extract gender from pattern
      let detectedGender: string | null = null;
      if (/\b(men|mens|men's|male|males)\b/i.test(normalized)) {
        detectedGender = 'mens';
      } else if (/\b(women|womens|women's|female|females)\b/i.test(normalized)) {
        detectedGender = 'womens';
      } else if (/\bunisex\b/i.test(normalized)) {
        detectedGender = 'unisex';
      }

      // Only return REFINE if no new category noun is present (to avoid SWITCH)
      const hasNewCategory = canonicalizeCategory(userMessage, ontology).canonical !== 'UNKNOWN';
      if (!hasNewCategory && detectedGender) {
        return {
          isFollowUp: true,
          followUpType: 'REFINE',
          detectedGender, // Return detected gender for constraintsDelta
          carryOver: {
            vibe: true, // Keep vibe for refinements
            hardFilters: true, // Keep hard filters for refinements
          },
        };
      }
    }
  }

  // Check for pairing/context follow-up patterns: "pair with it/that/these", "go with it", "match it", "similar to those"
  const pairingPatterns = [
    /\b(pair with it|pair with that|pair with these|go with it|match it|similar to those|with it|with that|with these)\b/i,
  ];

  for (const pattern of pairingPatterns) {
    if (pattern.test(normalized) && previousConstraints) {
      return {
        isFollowUp: true,
        followUpType: 'REFINE',
        carryOver: {
          vibe: true, // Keep vibe for pairing queries
          hardFilters: true, // Keep hard filters (including gender)
        },
      };
    }
  }

  // Check for refinement keywords: references to previous items
  const refinePatterns = [
    /\b(black|white|red|blue|green|navy|gray|grey|brown|pink|purple|yellow|orange)\s+(ones?|those|them)\b/i,
    /\b(cheaper|smaller|bigger|larger|longer|shorter)\b/i,
    /\b(more|less|different)\s+(color|size|style)\b/i,
    /\b(ones?|those|them|like that|same style)\b/i,
  ];

  for (const pattern of refinePatterns) {
    if (pattern.test(normalized)) {
      return {
        isFollowUp: true,
        followUpType: 'REFINE',
        carryOver: {
          vibe: true, // Keep vibe for refinements
          hardFilters: true, // Keep hard filters for refinements
        },
      };
    }
  }

  // Check for confirmation (only if pending suggestion exists)
  if (hasPendingSuggestion) {
    const confirmPatterns = [
      /\b(yes|yeah|ok|okay|sure|go ahead|show me|show them|that works|more like that|continue)\b/i,
    ];
    // Only confirm if NO new category noun is present
    const hasNewCategory = canonicalizeCategory(userMessage, ontology).canonical !== 'UNKNOWN';
    if (!hasNewCategory) {
      for (const pattern of confirmPatterns) {
        if (pattern.test(normalized)) {
          return {
            isFollowUp: true,
            followUpType: 'CONFIRM_SUGGESTION',
            carryOver: {
              vibe: true,
              hardFilters: true,
            },
          };
        }
      }
    }
  }

  // Default: not a follow-up
  return {
    isFollowUp: false,
    followUpType: 'UNKNOWN',
    carryOver: {
      vibe: false,
      hardFilters: false,
    },
  };
}

