/**
 * Router Types and Context Builder
 * 
 * Defines types for turn routing and builds context JSON for LLM routing.
 */

import type { SearchConstraints } from '../search/types';

export type TurnRouterInput = {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  state: {
    pendingActions: Array<{ id: string; label: string; [key: string]: any }>;
    shownProductIds: string[];
    lastRankedProductIds: string[];
    memory: Record<string, any>;
  };
  merchant?: {
    brandName?: string;
    datasetContext?: any;
  };
  productContextId?: string;
  lastAssistantMessage?: string;
  lastConstraints?: SearchConstraints | null;
};

export type TurnRouterResult = {
  route: 'ACTION' | 'YES_NO' | 'REFINE' | 'DISCOVERY' | 'PDP_QA' | 'BRAND_INFO' | 'UNRELATED' | 'SAFETY_BLOCK' | 'AMBIGUOUS';
  confidence: number;
  action: { id: string; [key: string]: any } | null;
  yesNo: boolean | null;
  refinePatch: {
    priceMaxCents?: number;
    priceMinCents?: number;
    productTypes?: string[];
    concerns?: string[];
    ingredients?: string[];
    madeWithout?: string[];
    collections?: string[];
    applicationAreas?: string[];
    skinTypes?: string[];
    hairTypes?: string[];
    ageGroups?: string[];
    genders?: string[];
    size?: string;
    replace?: boolean;
  } | null;
  clarification?: { text: string; actions: Array<{ id: string; type: string; label: string }> } | null;
  referencedProductIndex?: number | null;
};

/**
 * Build compact context JSON for router LLM
 * Includes previous search constraints to help LLM understand what user is modifying
 */
export function buildTurnContext(input: TurnRouterInput): string {
  const context: Record<string, any> = {};

  // Include pending actions if any
  if (input.state.pendingActions?.length > 0) {
    context.pendingActions = input.state.pendingActions.map(a => ({
      id: a.id,
      label: a.label,
    }));
  }

  // Include previous search constraints (critical for REFINE routing)
  // Include full constraint context to help LLM understand what user is modifying
  if (input.lastConstraints) {
    const prevConstraints: Record<string, unknown> = {};
    if (input.lastConstraints.productTypes?.length) {
      prevConstraints.productTypes = input.lastConstraints.productTypes;
    }
    if (input.lastConstraints.priceMaxCents) {
      prevConstraints.priceMaxCents = input.lastConstraints.priceMaxCents;
    }
    if (input.lastConstraints.priceMinCents) {
      prevConstraints.priceMinCents = input.lastConstraints.priceMinCents;
    }
    if (input.lastConstraints.query) {
      prevConstraints.query = input.lastConstraints.query.substring(0, 100);
    }
    // Include concerns, ingredients, collections, etc. if present to give full context
    const lastConstraintsAny = input.lastConstraints as any;
    if (lastConstraintsAny.concerns?.length) {
      prevConstraints.concerns = lastConstraintsAny.concerns;
    }
    if (lastConstraintsAny.mustHaveIngredients?.length) {
      prevConstraints.mustHaveIngredients = lastConstraintsAny.mustHaveIngredients;
    }
    if (lastConstraintsAny.collections?.length) {
      prevConstraints.collections = lastConstraintsAny.collections;
    }
    if (lastConstraintsAny.skinTypes?.length) {
      prevConstraints.skinTypes = lastConstraintsAny.skinTypes;
    }
    if (lastConstraintsAny.applicationAreas?.length) {
      prevConstraints.applicationAreas = lastConstraintsAny.applicationAreas;
    }
    if (lastConstraintsAny.hairTypes?.length) {
      prevConstraints.hairTypes = lastConstraintsAny.hairTypes;
    }
    if (Object.keys(prevConstraints).length > 0) {
      context.previousSearch = prevConstraints;
    }
  }

  // Include product context if available
  if (input.productContextId) {
    context.productContextId = input.productContextId;
  }

  // Include last assistant message for context
  if (input.lastAssistantMessage) {
    context.lastAssistantMessage = input.lastAssistantMessage.substring(0, 200);
  }

  // Include shown products count
  if (input.state.shownProductIds?.length > 0) {
    context.shownProductCount = input.state.shownProductIds.length;
  }

  return JSON.stringify(context);
}

// Legacy route function for backward compatibility (if needed)
export async function routeTurn(input: TurnRouterInput): Promise<TurnRouterResult> {
  // This is a placeholder - the actual routing is done by routeTurnLLMFirst
  // This function might be used elsewhere for backward compatibility
  const { routeTurnLLMFirst } = await import('./turnRouter');
  return routeTurnLLMFirst(input);
}
