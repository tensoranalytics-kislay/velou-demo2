import { env } from '../../config';
import { callLLM, type LlmMessage } from '../provider';
import {
  CONTEXT_GATEKEEPER_PROMPT,
  CONTEXT_GATEKEEPER_JSON_SCHEMA,
  CONTEXT_GATEKEEPER_PROMPT_V2,
  CONTEXT_GATEKEEPER_V2_JSON_SCHEMA,
  INTENT_AND_CONSTRAINTS_PROMPT_V2,
  INTENT_AND_CONSTRAINTS_V2_JSON_SCHEMA,
  SEARCH_CONSTRAINTS_JSON_SCHEMA,
  VELOU_ROUTER_PROMPT,
  VELOU_ROUTER_JSON_SCHEMA,
  buildIntentAndConstraintsPrompt,
  buildDatasetContextHint,
} from '../prompts';
import { logger } from '../../telemetry/logger';
import { getCatalogOntology, type CatalogOntology } from '../../search/ontology';
import type { SearchConstraints } from '../../search/types';
import type { ConversationContext } from './index';
import type { DatasetContext } from '../../catalog/datasetInspector';
import {
  CATEGORY_KEYWORDS,
  COLOR_KEYWORDS,
  FABRIC_KEYWORDS,
  FIT_KEYWORDS,
  GENDER_KEYWORDS,
  MATERIAL_KEYWORDS,
  OCCASION_KEYWORDS,
  PDP_KEYWORDS,
  PRICE_REGEX,
  PRICE_RANGE_REGEX,
  SEASON_KEYWORDS,
  SIZE_KEYWORDS,
} from './constants';
import {
  AFFIRMATIVE_KEYWORDS,
  COMPARATIVE_KEYWORDS,
  NEW_QUERY_KEYWORDS,
  REFINEMENT_PREFIXES,
} from './constants';
import {
  extractNegatedTokens,
  extractHardTextFilterKeywords,
  extractGenderFromText,
  detectGenderTokens,
  fuzzyMatchValue,
  mergeArrays,
  normalizeCategoryFromMessage,
  normalizeConstraintArrays,
  normalizeConstraintValues,
  pushUnique,
  stripJsonFences,
} from './utils';

export type AssistantIntent = 'discovery' | 'pdp_suitability';

export type IntentResolution = {
  intent: AssistantIntent;
  constraints: SearchConstraints;
  // D) Explicit follow-up detection fields
  isFollowUp?: boolean;
  followUpType?: 'REFINE' | 'SWITCH' | 'CONFIRM_SUGGESTION' | 'UNKNOWN';
  overrideCategory?: string; // Canonical category if switching
  carryOver?: {
    vibe: boolean; // season/occasion/style
    hardFilters: boolean; // color/size/price
  };
};

type ArrayConstraintKey =
  | 'colors'
  | 'fabrics'
  | 'materials'
  | 'sizes'
  | 'occasions'
  | 'seasons'
  | 'useCases'
  | 'productTypes'
  | 'googleCategories'
  | 'customLabels4'
  | 'conditions'
  | 'ageGroups'
  | 'genders'
  | 'brands'
  | 'excludeProductIds';

type ScalarConstraintKey =
  | 'category'
  | 'priceMinCents'
  | 'priceMaxCents'
  | 'fit'
  | 'query'
  | 'inStockOnly';

export function mergeConstraints(
  base: SearchConstraints,
  updates: SearchConstraints,
  message: string,
  contextAction?: 'carry' | 'override' | 'reset',
  stickyKeys?: string[], // Keys that should persist unless explicitly overridden
): SearchConstraints {
  // Fix B: Override/reset-aware merging
  // If contextAction is "reset", start fresh (ignore base)
  if (contextAction === 'reset') {
    return { ...updates, inStockOnly: updates.inStockOnly ?? true };
  }

  // Default sticky keys: gender, inStockOnly, price (if not contradicted)
  const defaultStickyKeys = stickyKeys || ['genders', 'inStockOnly'];
  const isSticky = (key: string) => defaultStickyKeys.includes(key);

  // Extract gender from text as strongest override
  // Use detectGenderTokens for deterministic extraction
  const genderFromText = detectGenderTokens(message);

  // If contextAction is "override", clear incompatible constraints
  const isOverride = contextAction === 'override' || 
    /\b(only|just|instead|show me|switch to|not that|forget previous|reset)\b/i.test(message);

  const merged: SearchConstraints = { ...base };
  const negatedTokens = extractNegatedTokens(message);

  // If category changed OR override detected, clear incompatible constraints
  const categoryChanged = updates.category && updates.category !== base.category;
  if (categoryChanged || isOverride) {
    // Fix B: For override, drop previous attribute filters
    if (isOverride) {
      merged.colors = undefined;
      merged.fabrics = undefined;
      merged.materials = undefined;
      merged.fit = undefined;
      merged.occasions = undefined;
      merged.seasons = undefined;
      merged.useCases = undefined;
      merged.productTypes = undefined;
      // Keep sticky keys unless explicitly overridden
      if (updates.sizes !== undefined) merged.sizes = undefined;
      if (updates.genders !== undefined || genderFromText) {
        merged.genders = undefined; // Will be set by genderFromText or updates
      }
      if (updates.brands !== undefined) merged.brands = undefined;
    } else if (categoryChanged) {
      // Category changed but not override - clear incompatible filters
      merged.colors = undefined;
      merged.fabrics = undefined;
      merged.materials = undefined;
      merged.sizes = undefined;
      merged.fit = undefined;
      merged.occasions = undefined;
      merged.seasons = undefined;
      merged.useCases = undefined;
      merged.productTypes = undefined;
      // Keep sticky keys (gender, inStockOnly) even on category change
      if (!isSticky('genders') || (updates.genders === undefined && !genderFromText)) {
        merged.genders = undefined;
      }
      if (updates.brands !== undefined) merged.brands = undefined;
    }
    // Keep price range as it's category-agnostic (sticky)
    // Keep query as soft intent
  }
  const arrayKeys: ArrayConstraintKey[] = [
    'colors',
    'fabrics',
    'materials',
    'sizes',
    'occasions',
    'seasons',
    'useCases',
    'productTypes',
    'googleCategories',
    'customLabels4',
    'conditions',
    'ageGroups',
    'genders',
    'brands',
    'excludeProductIds',
  ];

  for (const key of arrayKeys) {
    // For sticky keys, preserve base value if updates don't override
    if (isSticky(key) && !updates[key] && base[key] && !genderFromText) {
      merged[key] = base[key];
      continue;
    }

    const combined = mergeArrays(
      merged[key],
      updates[key],
      negatedTokens,
    );
    if (combined) {
      merged[key] = combined;
    } else if (updates[key]?.length === 0 && merged[key]) {
      const filtered = mergeArrays(merged[key], [], negatedTokens);
      merged[key] = filtered;
    } else if (negatedTokens.length && merged[key]) {
      const filtered = (merged[key] ?? []).filter(
        (value) => !negatedTokens.includes(value.toLowerCase()),
      );
      merged[key] = filtered.length ? filtered : undefined;
    }
  }

  const scalarKeys: ScalarConstraintKey[] = [
    'category',
    'priceMinCents',
    'priceMaxCents',
    'fit',
    'query',
    'inStockOnly',
  ];

  const setScalarConstraint = <K extends ScalarConstraintKey>(
    key: K,
    value: SearchConstraints[K] | undefined,
  ) => {
    if (value === undefined) {
      // Keep sticky scalar values from base if not overridden
      if (isSticky(key) && base[key] !== undefined) {
        merged[key] = base[key];
      }
      return;
    }
    merged[key] = value;
  };

  for (const key of scalarKeys) {
    setScalarConstraint(key, updates[key]);
  }

  // Apply gender from text as strongest override (after all other merging)
  // CRITICAL: Detected gender from current message always wins
  if (genderFromText) {
    merged.genders = genderFromText;
    logger.debug('mergeConstraints gender override from text', {
      message,
      detectedGender: genderFromText,
      previousGender: base.genders,
      updatesGender: updates.genders,
      finalGender: merged.genders,
    });
  } else if (updates.genders?.length) {
    // If updates has genders (from LLM), use it
    merged.genders = updates.genders;
  } else if (isSticky('genders') && base.genders && !updates.genders) {
    // Keep sticky gender from base if not overridden
    merged.genders = base.genders;
  }

  // Ensure inStockOnly defaults to true if not set
  merged.inStockOnly = merged.inStockOnly ?? true;

  return merged;
}

export function applyOntologyToConstraints(
  constraints: SearchConstraints,
  ontology: CatalogOntology,
): SearchConstraints {
  const droppedTerms: string[] = [];

  const mapArrayField = (field: ArrayConstraintKey, list: string[] | undefined) => {
    const values = constraints[field];
    if (!values?.length) {
      constraints[field] = undefined;
      return;
    }
    if (!list?.length) return;
    const normalized: string[] = [];
    for (const raw of values) {
      const canonical = fuzzyMatchValue(raw, list);
      if (canonical) {
        normalized.push(canonical);
      } else {
        droppedTerms.push(raw);
      }
    }
    constraints[field] = normalized.length ? Array.from(new Set(normalized)) : undefined;
  };

  const mapScalarField = (field: 'category', list: string[] | undefined) => {
    const value = constraints[field];
    if (!value || !list?.length) return;
    // Handle category as string or array
    if (Array.isArray(value)) {
      // For arrays, map each category
      const mapped: string[] = [];
      for (const cat of value) {
        const canonical = fuzzyMatchValue(cat, list);
        if (canonical) {
          mapped.push(canonical);
        } else {
          droppedTerms.push(cat);
        }
      }
      constraints[field] = mapped.length > 0 ? mapped : undefined;
    } else {
      const canonical = fuzzyMatchValue(value, list);
      if (canonical) {
        constraints[field] = canonical;
      } else {
        droppedTerms.push(value);
        constraints[field] = undefined;
      }
    }
  };

  mapScalarField('category', ontology.categories);
  mapArrayField('productTypes', ontology.productTypes);
  mapArrayField('colors', ontology.colors);
  mapArrayField('materials', ontology.materials);
  mapArrayField('fabrics', ontology.materials);
  // CRITICAL: Brands must match EXACTLY (case-insensitive) - no fuzzy/substring matching
  // This prevents "lucky brand" from matching partial brand names or other brands
  const mapBrandsStrict = () => {
    const values = constraints.brands;
    if (!values?.length || !ontology.brands?.length) {
      constraints.brands = undefined;
      return;
    }
    const normalized: string[] = [];
    const brandSet = new Set(ontology.brands.map(b => b.toLowerCase()));
    for (const raw of values) {
      const normalizedRaw = raw.trim().toLowerCase();
      // Only exact match (case-insensitive) - no substring matching
      const exactMatch = ontology.brands.find(b => b.toLowerCase() === normalizedRaw);
      if (exactMatch) {
        normalized.push(exactMatch);
      } else {
        droppedTerms.push(raw);
        logger.debug('brand_dropped_not_in_ontology', {
          requestedBrand: raw,
          availableBrands: ontology.brands.slice(0, 10),
        });
      }
    }
    constraints.brands = normalized.length ? Array.from(new Set(normalized)) : undefined;
  };
  mapBrandsStrict();
  // CRITICAL: Skip ontology validation for genders - they're already canonical (mens/womens/unisex)
  // The ontology may have "male"/"female" from CSV, but we use "mens"/"womens" in constraints
  // Don't drop genders just because they don't match ontology values
  // mapArrayField('genders', ontology.genders); // DISABLED - preserve detected genders
  mapArrayField('sizes', ontology.sizes);
  mapArrayField('googleCategories', ontology.googleCategories);
  mapArrayField('customLabels4', ontology.customLabels4);

  if (droppedTerms.length) {
    const extraQuery = droppedTerms.join(' ');
    constraints.query = constraints.query ? `${constraints.query} ${extraQuery}` : extraQuery;
  }

  if (constraints.inStockOnly === undefined) {
    constraints.inStockOnly = true;
  }

  return constraints;
}

export function inferIntentAndConstraintsRuleBased(
  message: string,
  pageType: 'HOME' | 'PLP' | 'PDP',
  productContextId?: string,
): IntentResolution {
  const normalizedMessage = message.toLowerCase();
  const intent: AssistantIntent =
    productContextId && PDP_KEYWORDS.some((keyword) => normalizedMessage.includes(keyword))
      ? 'pdp_suitability'
      : 'discovery';

  const constraints: SearchConstraints = {
    query: message,
    inStockOnly: true,
  };

  const priceRange = PRICE_RANGE_REGEX.exec(normalizedMessage);
  if (priceRange) {
    constraints.priceMinCents = Number(priceRange[1]) * 100;
    constraints.priceMaxCents = Number(priceRange[3]) * 100;
  } else {
    const priceMatch = PRICE_REGEX.exec(normalizedMessage);
    if (priceMatch) {
      constraints.priceMaxCents = Number(priceMatch[2]) * 100;
    }
  }

  for (const [keyword, mapped] of Object.entries(SEASON_KEYWORDS)) {
    if (normalizedMessage.includes(keyword)) {
      constraints.seasons = [mapped];
      break; // Only take first season match
    }
  }

  for (const [keyword, mapped] of Object.entries(OCCASION_KEYWORDS)) {
    if (normalizedMessage.includes(keyword)) {
      constraints.occasions = [mapped];
      break; // Only take first occasion match
    }
  }

  for (const [keyword, category] of Object.entries(CATEGORY_KEYWORDS)) {
    if (normalizedMessage.includes(keyword)) {
      constraints.category = category;
      break;
    }
  }

  // Only set fabric/material if explicitly mentioned (avoid over-constraining)
  for (const fabric of FABRIC_KEYWORDS) {
    if (normalizedMessage.includes(fabric)) {
      constraints.fabrics = [fabric];
      break; // Only take first fabric match
    }
  }

  for (const [keyword, material] of Object.entries(MATERIAL_KEYWORDS)) {
    if (normalizedMessage.includes(keyword)) {
      constraints.materials = pushUnique(constraints.materials, material);
    }
  }

  // Only set fit if explicitly mentioned
  for (const fit of FIT_KEYWORDS) {
    if (normalizedMessage.includes(fit)) {
      constraints.fit = fit;
      break; // Only take first fit match
    }
  }

  // Use detectGenderTokens for deterministic gender extraction
  const detectedGenderTokens = detectGenderTokens(message);
  if (detectedGenderTokens) {
    constraints.genders = detectedGenderTokens;
  } else {
    // Fallback to GENDER_KEYWORDS if detectGenderTokens didn't find anything
    for (const [keyword, gender] of Object.entries(GENDER_KEYWORDS)) {
      if (normalizedMessage.includes(keyword)) {
        constraints.genders = pushUnique(constraints.genders, gender);
      }
    }
  }

  // Don't hardcode brand names - let the search handle brand matching from actual catalog data
  // Brand filtering should come from the catalog ontology, not hardcoded values

  // Only set colors if explicitly mentioned
  const colors = COLOR_KEYWORDS.filter((color) => normalizedMessage.includes(color));
  if (colors.length) constraints.colors = colors;

  // Only set sizes if explicitly mentioned with "size" keyword
  const sizes = SIZE_KEYWORDS.filter((size) => normalizedMessage.includes(`size ${size}`));
  if (sizes.length) constraints.sizes = sizes.map((size) => size.toUpperCase());

  if (pageType === 'PDP' && productContextId && intent === 'pdp_suitability') {
    constraints.excludeProductIds = [productContextId];
  }

  // Debug logging: log parsed constraints
  logger.debug('inferIntentAndConstraintsRuleBased', {
    intent,
    constraints: {
      category: constraints.category,
      priceMinCents: constraints.priceMinCents,
      priceMaxCents: constraints.priceMaxCents,
      fabrics: constraints.fabrics?.length ? `${constraints.fabrics.length} fabrics` : undefined,
      colors: constraints.colors?.length ? `${constraints.colors.length} colors` : undefined,
      seasons: constraints.seasons?.length ? `${constraints.seasons.length} seasons` : undefined,
      occasions: constraints.occasions?.length ? `${constraints.occasions.length} occasions` : undefined,
      sizes: constraints.sizes?.length ? `${constraints.sizes.length} sizes` : undefined,
      fit: constraints.fit,
      inStockOnly: constraints.inStockOnly,
    },
  });

  return { intent, constraints: normalizeConstraintArrays(constraints) };
}

type ContextGatekeeperResult = {
  threadType: 'follow_up' | 'new_search' | 'confirm_to_show';
  shouldUsePreviousContext: boolean;
  usedFollowUpContext: boolean;
  reasonBrief: string;
  standaloneQuery: string;
  constraintsDelta: Partial<SearchConstraints>;
  intent: AssistantIntent;
};

export async function callContextGatekeeper(input: {
  currentMessage: string;
  previousUserMessages: string[];
  previousConstraints: SearchConstraints | null;
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  pendingSuggestion?: { summary: string } | null;
}): Promise<ContextGatekeeperResult> {
  // Use V2 prompt (supports confirm_to_show)
  const useV2 = true; // TODO: Make configurable via env var
  const prompt = useV2 ? CONTEXT_GATEKEEPER_PROMPT_V2 : CONTEXT_GATEKEEPER_PROMPT;
  const schema = useV2 ? CONTEXT_GATEKEEPER_V2_JSON_SCHEMA : CONTEXT_GATEKEEPER_JSON_SCHEMA;

  if (env.llmProvider === 'mock') {
    // Fallback to rule-based for mock
    // Check for pairing patterns first
    const isPairingFollowUp = /(pair with it|pair with that|pair with these|go with it|match it|similar to those|with it|with that|with these)/i.test(input.currentMessage);
    
    const isFollowUp = Boolean(
      input.previousConstraints &&
        (isPairingFollowUp || (isFollowUpMessage(input.currentMessage) && !looksLikeNewQuery(input.currentMessage))),
    );
    const isConfirm = Boolean(useV2 && input.pendingSuggestion && isAffirmativeResponse(input.currentMessage));
    
    // For new_search, still allow sticky constraints if previousConstraints has genders
    const allowStickyCarry = Boolean(!isFollowUp && !isConfirm && input.previousConstraints?.genders && 
      !extractGenderFromText(input.currentMessage)); // No explicit gender override
    
    return {
      threadType: isConfirm ? 'confirm_to_show' : (isFollowUp ? 'follow_up' : 'new_search'),
      shouldUsePreviousContext: isFollowUp || isConfirm || allowStickyCarry,
      usedFollowUpContext: isFollowUp || isConfirm,
      reasonBrief: isConfirm 
        ? 'Rule-based: detected confirmation' 
        : isPairingFollowUp 
          ? 'Rule-based: detected pairing follow-up'
          : (isFollowUp ? 'Rule-based: detected follow-up pattern' : (allowStickyCarry ? 'Rule-based: sticky constraints carry' : 'Rule-based: new search detected')),
      standaloneQuery: input.currentMessage,
      constraintsDelta: {},
      intent: input.productContextId && input.pageType === 'PDP' ? 'pdp_suitability' : 'discovery',
    };
  }

  try {
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: useV2
          ? `userMessage: "${input.currentMessage}"
lastUserQuery: ${input.previousUserMessages[input.previousUserMessages.length - 1] || 'null'}
lastConstraints: ${JSON.stringify(input.previousConstraints || null)}
pendingSuggestion: ${input.pendingSuggestion ? JSON.stringify({ summary: input.pendingSuggestion.summary }) : 'null'}
history: ${JSON.stringify(input.previousUserMessages.slice(-3))}

Output JSON with threadType, shouldUsePreviousContext, and reasonBrief.`
          : `currentMessage: "${input.currentMessage}"

previousUserMessages: ${JSON.stringify(input.previousUserMessages)}
previousConstraints: ${JSON.stringify(input.previousConstraints)}
pageType: ${input.pageType}
productContextId: ${input.productContextId || null}

Output JSON with threadType, shouldUsePreviousContext, usedFollowUpContext, reasonBrief, standaloneQuery, constraintsDelta, and intent.`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'intent',
      expectJson: true,
      schema,
    });

    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as any;

    // Handle V2 vs V1 format
    if (useV2) {
      // V2 format: threadType can be 'confirm_to_show'
      if (!parsed.threadType || !['follow_up', 'new_search', 'confirm_to_show'].includes(parsed.threadType)) {
        throw new Error(`Invalid threadType: ${parsed.threadType}`);
      }
      // V2 doesn't have intent, constraintsDelta, standaloneQuery - add defaults
      return {
        threadType: parsed.threadType,
        shouldUsePreviousContext: parsed.shouldUsePreviousContext ?? (parsed.threadType !== 'new_search'),
        usedFollowUpContext: parsed.shouldUsePreviousContext ?? (parsed.threadType !== 'new_search'),
        reasonBrief: parsed.reasonBrief || 'V2 gatekeeper result',
        standaloneQuery: input.currentMessage,
        constraintsDelta: {},
        intent: input.productContextId && input.pageType === 'PDP' ? 'pdp_suitability' : 'discovery',
      } as ContextGatekeeperResult;
    } else {
      // V1 format
      if (!parsed.threadType || !['follow_up', 'new_search'].includes(parsed.threadType)) {
        throw new Error(`Invalid threadType: ${parsed.threadType}`);
      }
      if (!parsed.intent || !['discovery', 'pdp_suitability'].includes(parsed.intent)) {
        throw new Error(`Invalid intent: ${parsed.intent}`);
      }

      // Normalize constraintsDelta to remove bad sentinel values
      if (parsed.constraintsDelta) {
        const normalizedDelta = normalizeConstraintValues(parsed.constraintsDelta as SearchConstraints);
        parsed.constraintsDelta = normalizedDelta;
      }

      return parsed as ContextGatekeeperResult;
    }
  } catch (error) {
    logger.error('context_gatekeeper_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback to rule-based
    const isFollowUp = Boolean(
      input.previousConstraints &&
        isFollowUpMessage(input.currentMessage) &&
        !looksLikeNewQuery(input.currentMessage),
    );
    return {
      threadType: isFollowUp ? 'follow_up' : 'new_search',
      shouldUsePreviousContext: isFollowUp,
      usedFollowUpContext: isFollowUp,
      reasonBrief: isFollowUp ? 'Rule-based: detected follow-up pattern' : 'Rule-based: new search detected',
      standaloneQuery: input.currentMessage,
      constraintsDelta: {},
      intent: input.productContextId && input.pageType === 'PDP' ? 'pdp_suitability' : 'discovery',
    };
  }
}

async function inferIntentAndConstraintsWithLlm(input: {
  message: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  previousConstraints?: SearchConstraints | null;
  isFollowUp?: boolean;
  ontology: CatalogOntology;
  standaloneQuery?: string;
  constraintsDelta?: Partial<SearchConstraints>;
  datasetContext?: DatasetContext | null;
}): Promise<IntentResolution> {
  const contextJson = JSON.stringify({
    pageType: input.pageType,
    productContextId: input.productContextId || null,
    previousConstraints: input.previousConstraints ?? null,
    isFollowUp: input.isFollowUp ?? false,
  });

  // Use V2 prompt if available (feature flag via env or default to V2)
  const useV2 = true; // TODO: Make configurable via env var
  const datasetContext = input.datasetContext ?? null;
  const prompt = useV2
    ? INTENT_AND_CONSTRAINTS_PROMPT_V2
    : buildIntentAndConstraintsPrompt(datasetContext);
  const schema = useV2 ? INTENT_AND_CONSTRAINTS_V2_JSON_SCHEMA : SEARCH_CONSTRAINTS_JSON_SCHEMA;

  // Build taxonomy categories list for the prompt (includes actual DB categories + common synonyms)
  const taxonomyCategories = [
    ...input.ontology.categories,
    ...input.ontology.productTypes,
    // Add common synonyms that map to taxonomy
    'tshirt',
    't-shirt',
    'tee',
    'tees',
    'skirt',
    'skirts',
    'jean',
    'jeans',
    'pant',
    'pants',
    'top',
    'tops',
    'shirt',
    'shirts',
    'dress',
    'dresses',
    'short',
    'shorts',
    'sweater',
    'sweaters',
    'jacket',
    'jackets',
    'blazer',
    'blazers',
    'bag',
    'bags',
    'belt',
    'belts',
    'shoe',
    'shoes',
    'sneaker',
    'sneakers',
    'boot',
    'boots',
    'sandal',
    'sandals',
  ];

  const ontologySummaryV1 = `
taxonomy_categories: ${JSON.stringify([...new Set(taxonomyCategories)].slice(0, 50))}
Known colors: ${input.ontology.colors.slice(0, 30).join(', ')}
Known materials/fabrics: ${input.ontology.materials.slice(0, 30).join(', ')}
Known brands: ${input.ontology.brands.slice(0, 20).join(', ')}
  `.trim();

  // Use standaloneQuery if provided (from gatekeeper), otherwise use original message
  const queryToUse = input.standaloneQuery || input.message;
  
  // Pre-LLM seed: detect gender tokens deterministically
  const detectedGenderTokens = detectGenderTokens(queryToUse);
  const constraintsDelta: Partial<SearchConstraints> = input.constraintsDelta || {};
  if (detectedGenderTokens) {
    constraintsDelta.genders = detectedGenderTokens;
    logger.debug('detectGenderTokens pre-LLM', {
      message: queryToUse,
      detectedGenders: detectedGenderTokens,
    });
  }

  // Build context message with previous constraints and message
  const previousUserMessage = input.isFollowUp ? 'Previous user message available in context' : null;
  const contextMessage = input.isFollowUp
    ? `latest_user_message: "${queryToUse}"

previous_constraints: ${JSON.stringify(input.previousConstraints || {})}

previous_user_message: ${previousUserMessage || 'null'}

Catalog ontology:
${ontologySummaryV1}

Output JSON with intent, contextAction, constraints, and query.`
    : `latest_user_message: "${queryToUse}"

previous_constraints: null

previous_user_message: null

Catalog ontology:
${ontologySummaryV1}

Output JSON with intent, contextAction, constraints, and query.`;

  // Build ontology summary for V2
  const ontologySummaryV2 = `CATEGORIES: ${input.ontology.categories.slice(0, 50).join(', ')}
COLORS: ${input.ontology.colors.slice(0, 30).join(', ')}
MATERIALS: ${input.ontology.materials.slice(0, 30).join(', ')}
SIZES: ${input.ontology.sizes.slice(0, 20).join(', ')}
BRANDS: ${input.ontology.brands.slice(0, 20).join(', ')}
GENDERS: ${input.ontology.genders.join(', ')}
AGE_GROUPS: ${(input.ontology as any).ageGroups?.join(', ') || 'adult, kids'}
SEASONS: ${(input.ontology as any).seasons?.join(', ') || 'summer, winter, spring, fall'}
OCCASIONS: ${(input.ontology as any).occasions?.join(', ') || 'office, casual, formal, party'}`.trim();

  const datasetContextHint = buildDatasetContextHint(datasetContext);

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: useV2
        ? prompt.replace('{CATEGORIES}', input.ontology.categories.slice(0, 50).join(', '))
            .replace('{COLORS}', input.ontology.colors.slice(0, 30).join(', '))
            .replace('{MATERIALS}', input.ontology.materials.slice(0, 30).join(', '))
            .replace('{SIZES}', input.ontology.sizes.slice(0, 20).join(', '))
            .replace('{BRANDS}', input.ontology.brands.slice(0, 20).join(', '))
            .replace('{GENDERS}', input.ontology.genders.join(', '))
            .replace('{AGE_GROUPS}', (input.ontology as any).ageGroups?.join(', ') || 'adult, kids')
            .replace('{SEASONS}', (input.ontology as any).seasons?.join(', ') || 'summer, winter, spring, fall')
            .replace('{OCCASIONS}', (input.ontology as any).occasions?.join(', ') || 'office, casual, formal, party')
            .replace('{DATASET_CONTEXT_HINT}', datasetContextHint || 'Note: Use generic facet fields (useCases, styleTags, benefits, claims, sensoryProfile, compatibility) only when user language clearly maps to them and the catalog likely supports them.')
        : prompt,
    },
    {
      role: 'user',
      content: useV2
        ? `userMessage: "${queryToUse}"

previousConstraints: ${JSON.stringify(input.previousConstraints || {})}

${ontologySummaryV2}

Extract intent, constraints, and expandedKeywords.`
        : contextMessage.replace('Catalog ontology:', 'Catalog ontology:').replace(ontologySummaryV1, ontologySummaryV1),
    },
  ];

  const result = await callLLM({
    messages,
    purpose: 'intent',
    expectJson: true,
    schema,
  });

  // Fix E: Use safe JSON parsing with fallback
  const { safeParseLlmJson } = await import('./json-parse');
  
  // Build fallback from previous constraints + rule-based refinements
  const fallbackConstraints: Partial<SearchConstraints> = {
    ...input.previousConstraints,
    ...constraintsDelta, // Includes detected genders
    inStockOnly: true,
  };
  
  const parseResult = safeParseLlmJson<{
    intent?: string;
    constraints?: Partial<SearchConstraints>;
    expandedKeywords?: string[];
    needsFollowUp?: boolean;
    missingSlots?: string[];
    contextAction?: string;
    query?: string;
  }>(result.rawText, {
    intent: 'discovery',
    constraints: fallbackConstraints,
  });
  
  if (!parseResult.success) {
    logger.error('llm_intent_parsing_failed', {
      error: parseResult.error,
      provider: env.llmProvider,
      usingFallback: true,
    });
    // Use fallback constraints with rule-based refinements
    const queryText = input.message;
    return {
      intent: 'discovery',
      constraints: {
        query: queryText,
        ...fallbackConstraints,
      } as SearchConstraints,
    } as IntentResolution & { contextAction?: string };
  }
  
  const parsed = parseResult.data!;
  
  try {

    // Handle V2 vs V1 parsing
    let contextAction: string | undefined;
    let queryText: string;
    let expandedKeywords: string[] | undefined;

    if (useV2 && 'expandedKeywords' in parsed) {
      // V2 format
      expandedKeywords = parsed.expandedKeywords;
      contextAction = 'carry'; // V2 doesn't have contextAction, default to carry
      queryText = parsed.constraints?.query || queryToUse;
      
      // Log expandedKeywords extraction
      logger.debug('expandedKeywords_extracted', {
        expandedKeywords: expandedKeywords,
        expandedKeywordsCount: expandedKeywords?.length || 0,
        source: 'llm_v2',
        message: queryToUse,
      });
    } else {
      // V1 format
      contextAction = (parsed as any).contextAction;
      queryText = (parsed as any).query || queryToUse;
      
      // Log if expandedKeywords were missing
      logger.debug('expandedKeywords_missing', {
        source: 'llm_v1_or_missing',
        message: queryToUse,
        hasExpandedKeywords: 'expandedKeywords' in parsed,
      });
    }

    // Handle new schema format with contextAction and query
    // Map "other" intent to "discovery" for backward compatibility
    const intent = parsed.intent === 'other' ? 'discovery' : parsed.intent || 'discovery';
    
    // For PDP, check if it's a suitability query
    const finalIntent: AssistantIntent =
      input.pageType === 'PDP' && input.productContextId ? 'pdp_suitability' : (intent as AssistantIntent);

    if (!['discovery', 'pdp_suitability'].includes(finalIntent)) {
      throw new Error(`Invalid intent: ${finalIntent}`);
    }

    // Fix C: Parse comma-separated category string into array (multi-category outfits)
    let category = parsed.constraints?.category;
    if (typeof category === 'string' && category.includes(',')) {
      category = category.split(',').map(c => c.trim()).filter(Boolean);
    }
    
    // Start with constraintsDelta from gatekeeper, then merge LLM-extracted constraints
    // CRITICAL: Detected genders from user message MUST override LLM output
    const constraints: SearchConstraints = {
      query: queryText,
      inStockOnly: true,
      ...parsed.constraints, // LLM-extracted constraints first
      ...constraintsDelta, // Then apply constraintsDelta (includes pre-LLM detected genders)
      ...(category && { category }), // Use parsed category (may be array)
      ...(expandedKeywords && { expandedKeywords }),
    };

    // CRITICAL FIX: Always override with pre-LLM detected genders if present (strongest override)
    // This ensures user's explicit gender request (men/male) overrides any LLM bias
    if (detectedGenderTokens) {
      constraints.genders = detectedGenderTokens;
      logger.debug('detectGenderTokens applied (OVERRIDE)', {
        message: queryToUse,
        detectedGenders: detectedGenderTokens,
        llmGenders: parsed.constraints?.genders,
        finalGenders: constraints.genders,
      });
    } else if (!constraints.genders?.length) {
      // Fallback to extractGenderFromMessage if detectGenderTokens didn't find anything
      const { extractGenderFromMessage } = await import('./utils');
      const detectedGender = extractGenderFromMessage(queryToUse);
      if (detectedGender) {
        constraints.genders = [detectedGender];
        logger.debug('extractGenderFromMessage fallback', {
          message: queryToUse,
          detectedGender,
          llmGenders: parsed.constraints?.genders,
        });
      }
    } else {
      // Log when LLM genders are used (should be rare if detection is working)
      logger.debug('gender_constraints_source', {
        message: queryToUse,
        source: 'llm',
        llmGenders: parsed.constraints?.genders,
        detectedGenderTokens: detectedGenderTokens,
        finalGenders: constraints.genders,
      });
    }

    // Clean query augmentation: remove duplicate gender tokens
    if (constraints.query && constraints.genders?.length) {
      const queryLower = constraints.query.toLowerCase();
      const genderTokens = ['mens', 'womens', 'men', 'women', 'male', 'female', 'unisex'];
      const hasGenderToken = genderTokens.some(token => queryLower.includes(token));
      
      // If query already contains gender token, don't append
      // Also ensure keywordFilters don't inject cross-gender terms
      if (hasGenderToken) {
        // Query already has gender, no need to append
        logger.debug('query_augmentation_skip', {
          query: constraints.query,
          reason: 'query already contains gender token',
        });
      }
    }

    // B) Map colors to catalog using color mapping utility
    if (constraints.colors?.length && input.ontology.colors.length > 0) {
      const { mapColorToCatalog } = await import('../../search/canonicalize');
      const mappedColors: string[] = [];
      for (const userColor of constraints.colors) {
        const catalogColors = mapColorToCatalog(userColor, input.ontology.colors);
        mappedColors.push(...catalogColors);
      }
      constraints.colors = mappedColors.length > 0 ? [...new Set(mappedColors)] : undefined;
    }

    // B) Map materials to catalog using material mapping utility
    if (constraints.materials?.length) {
      const { mapMaterialToCatalog } = await import('../../search/canonicalize');
      const mappedMaterials: string[] = [];
      for (const userMaterial of constraints.materials) {
        const catalogMaterials = mapMaterialToCatalog(userMaterial);
        mappedMaterials.push(...catalogMaterials);
      }
      constraints.materials = mappedMaterials.length > 0 ? [...new Set(mappedMaterials)] : undefined;
    }

    // B) Strip colors/price from query text (V2 requirement)
    if (useV2 && constraints.query) {
      // Remove color mentions
      if (constraints.colors?.length) {
        for (const color of constraints.colors) {
          constraints.query = constraints.query.replace(new RegExp(`\\b${color}\\b`, 'gi'), '').trim();
        }
      }
      // Remove price mentions (basic pattern)
      constraints.query = constraints.query.replace(/\$\d+/g, '').replace(/\bunder\s+\$\d+/gi, '').trim();
    }

    // Handle contextAction for merging logic
    // Note: The actual merging happens in the caller (inferIntentAndConstraints)
    // based on gatekeeper result. contextAction is informational for now.
    // If contextAction is "reset", caller should not merge with previous constraints
    // If "override", merge but drop conflicting fields when category changes
    // If "carry", merge normally
    // This is handled by the mergeConstraints function and gatekeeper logic

    // Convert null to undefined for price fields (Prisma requires undefined, not null)
    if (parsed.constraints?.priceMaxCents !== null && parsed.constraints?.priceMaxCents !== undefined) {
      constraints.priceMaxCents = parsed.constraints.priceMaxCents;
    } else {
      constraints.priceMaxCents = undefined;
    }
    if (parsed.constraints?.priceMinCents !== null && parsed.constraints?.priceMinCents !== undefined) {
      constraints.priceMinCents = parsed.constraints.priceMinCents;
    } else {
      constraints.priceMinCents = undefined;
    }

    if (input.pageType === 'PDP' && input.productContextId && finalIntent === 'pdp_suitability') {
      constraints.excludeProductIds = [input.productContextId];
    }

    // Normalize bad sentinel values (empty strings, 0, etc.)
    const normalized = normalizeConstraintArrays(constraints);
    const cleanedConstraints = normalizeConstraintValues(normalized);

    return {
      intent: finalIntent,
      constraints: cleanedConstraints,
      contextAction, // Include contextAction in result for merging logic
    } as IntentResolution & { contextAction?: string };
  } catch (error) {
    throw new Error(`Failed to parse LLM response as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function inferIntentAndConstraints(
  message: string,
  pageType: 'HOME' | 'PLP' | 'PDP',
  productContextId: string | undefined,
  conversationContext?: ConversationContext,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  hasPendingSuggestion?: boolean,
): Promise<IntentResolution & { usedFollowUpContext: boolean }> {
  const ontology = await getCatalogOntology();
  const previousConstraints = conversationContext?.lastConstraints ?? null;
  const datasetContext = conversationContext?.datasetContext ?? null;
  
  // Extract previous user messages from history (last 5 user messages)
  const previousUserMessages = history
    ? history
        .filter((msg) => msg.role === 'user')
        .map((msg) => msg.content)
        .slice(-5)
    : conversationContext?.lastUserQuery
      ? [conversationContext.lastUserQuery]
      : [];

  // Step 1: Call context gatekeeper to decide if we should use previous context
  const pendingSuggestionForGatekeeper = hasPendingSuggestion
    ? { summary: 'Pending suggestion available' } // Simplified for gatekeeper
    : null;
  const gatekeeperResult = await callContextGatekeeper({
    currentMessage: message,
    previousUserMessages,
    previousConstraints,
    pageType,
    productContextId,
    pendingSuggestion: pendingSuggestionForGatekeeper,
  });

  logger.debug('context_gatekeeper_result', {
    threadType: gatekeeperResult.threadType,
    shouldUsePreviousContext: gatekeeperResult.shouldUsePreviousContext,
    reasonBrief: gatekeeperResult.reasonBrief,
    intent: gatekeeperResult.intent,
  });

  const shouldUsePreviousContext = gatekeeperResult.shouldUsePreviousContext;
  const effectivePreviousConstraints = shouldUsePreviousContext ? previousConstraints : null;

  // D) Detect follow-up type for merge logic
  const followUpDetection = await (async () => {
    const { detectFollowUpType } = await import('./followup-detector');
    return detectFollowUpType(
      message,
      effectivePreviousConstraints,
      hasPendingSuggestion ?? false,
      ontology,
    );
  })();

  const normalizeResult = async (
    result: IntentResolution,
    usedFollowUpContext: boolean,
    contextAction?: string,
    followUpDetection?: { followUpType?: string; overrideCategory?: string; detectedGender?: string; carryOver?: { vibe: boolean; hardFilters: boolean } },
  ) => {
    let baseConstraints = result.constraints;

    // Fix A: Deterministic synonym normalization BEFORE merging
    // Handle category as string or array
    const categoryToNormalize = Array.isArray(result.constraints.category)
      ? result.constraints.category[0]
      : result.constraints.category;
    const normalizedCategory = categoryToNormalize
      ? normalizeCategoryFromMessage(message, categoryToNormalize, ontology)
      : undefined;
    if (normalizedCategory && normalizedCategory !== categoryToNormalize) {
      baseConstraints = { ...baseConstraints, category: normalizedCategory };
      logger.debug('normalizeCategoryFromMessage', {
        originalCategory: result.constraints.category,
        normalizedCategory,
        message,
      });
    }

    // Fix C: Extract hard text filter keywords when category is still missing
    const hardTextFilters = !normalizedCategory
      ? extractHardTextFilterKeywords(message, normalizedCategory)
      : undefined;
    if (hardTextFilters && hardTextFilters.length > 0) {
      (baseConstraints as any).hardTextFilters = hardTextFilters;
      logger.debug('extractHardTextFilterKeywords', {
        hardTextFiltersEnabled: true,
        hardTextFilters,
        message,
      });
    }

    // D) Handle follow-up types: SWITCH drops incompatible constraints
    if (usedFollowUpContext && effectivePreviousConstraints) {
      const isSwitch = followUpDetection?.followUpType === 'SWITCH';
      const isRefine = followUpDetection?.followUpType === 'REFINE';
      
      if (isSwitch && followUpDetection.overrideCategory) {
        // SWITCH: Set category from overrideCategory (canonical category)
        // Map canonical category to DB category format
        const {
          canonicalizeCategory: canonicalizeCategoryDynamic,
          detectCategoryProfile: detectCategoryProfileDynamic,
          getExpandedLeafCategories: getExpandedLeafCategoriesDynamic,
          getAllSynonyms: getAllSynonymsDynamic,
        } = await import('../../search/canonicalize');
        const profile = detectCategoryProfileDynamic(ontology, {
          verticalHint: datasetContext?.vertical,
        });
        const canonical = canonicalizeCategoryDynamic(
          followUpDetection.overrideCategory,
          ontology,
          profile,
        );
        if (canonical.canonical !== 'UNKNOWN' && profile) {
          const group = profile.groups[canonical.canonical];
          if (group?.expandedLeafCats?.length) {
            baseConstraints.category = getExpandedLeafCategoriesDynamic(
              canonical.canonical,
              ontology,
              profile,
            )[0];
          } else if (group?.synonyms?.length) {
            baseConstraints.category = group.synonyms[0];
          }
          if (canonical.canonical === 'TSHIRT') {
            (baseConstraints as any).hardTextFilters =
              getAllSynonymsDynamic(canonical.canonical, profile) || ['t shirt', 'tshirt', 'tee'];
          }
        }
        
        // SWITCH: Drop derived filters, keep only explicit hard filters if carryOver.hardFilters
        baseConstraints = mergeConstraints(
          effectivePreviousConstraints,
          baseConstraints,
          message,
          'override', // Force override mode
        );
        // Drop incompatible constraints unless user explicitly restated them
        if (!followUpDetection.carryOver?.vibe) {
          baseConstraints.seasons = undefined;
          baseConstraints.occasions = undefined;
          baseConstraints.useCases = undefined;
        }
        if (!followUpDetection.carryOver?.hardFilters) {
          baseConstraints.colors = undefined;
          baseConstraints.fabrics = undefined;
          baseConstraints.materials = undefined;
          baseConstraints.sizes = undefined;
        }
        // Keep genders sticky even on SWITCH unless explicitly overridden
        if (effectivePreviousConstraints?.genders && !baseConstraints.genders) {
          baseConstraints.genders = effectivePreviousConstraints.genders;
        }
      } else if (isRefine) {
        // REFINE: Merge normally, keep vibe and hard filters (including sticky gender)
        baseConstraints = mergeConstraints(
          effectivePreviousConstraints,
          baseConstraints,
          message,
          'carry', // Force carry mode - sticky keys will persist
          ['genders', 'inStockOnly'], // Explicit sticky keys
        );
        // Add detected gender to constraints if present (overrides sticky)
        if (followUpDetection?.detectedGender) {
          baseConstraints.genders = [followUpDetection.detectedGender];
        }
      } else {
        // Default merge - allow sticky carry even for new_search
        const shouldCarrySticky = !effectivePreviousConstraints || 
          (effectivePreviousConstraints.genders && !extractGenderFromText(message));
        baseConstraints = mergeConstraints(
          effectivePreviousConstraints || {},
          baseConstraints,
          message,
          contextAction as 'carry' | 'override' | 'reset' | undefined,
          shouldCarrySticky ? ['genders', 'inStockOnly'] : undefined, // Sticky keys if no override
        );
      }
      
      logger.debug('mergeConstraints', {
        contextAction,
        followUpType: followUpDetection?.followUpType,
        overrideCategory: followUpDetection?.overrideCategory,
        previousCategory: effectivePreviousConstraints.category,
        newCategory: baseConstraints.category,
        previousGenders: effectivePreviousConstraints.genders,
        newGenders: baseConstraints.genders,
        message,
      });
    }
    
    const constraints = normalizeConstraintArrays(baseConstraints);
    logger.debug('before_applyOntology', {
      genders: constraints.genders,
      category: constraints.category,
    });
    const mapped = applyOntologyToConstraints(constraints, ontology);
    logger.debug('after_applyOntology', {
      genders: mapped.genders,
      category: mapped.category,
    });
    return { intent: result.intent, constraints: mapped, usedFollowUpContext };
  };

  if (env.llmProvider === 'mock') {
    const ruleResult = inferIntentAndConstraintsRuleBased(message, pageType, productContextId);
    return await normalizeResult(ruleResult, shouldUsePreviousContext);
  }

  try {
    const result = await inferIntentAndConstraintsWithLlm({
      message,
      pageType,
      productContextId,
      previousConstraints: effectivePreviousConstraints,
      isFollowUp: shouldUsePreviousContext,
      ontology,
      standaloneQuery: gatekeeperResult.standaloneQuery,
      constraintsDelta: gatekeeperResult.constraintsDelta,
      datasetContext,
    });
    
    // Use intent from gatekeeper if it's more specific (e.g., pdp_suitability)
    const finalIntent = gatekeeperResult.intent === 'pdp_suitability' ? gatekeeperResult.intent : result.intent;
    
    // Extract contextAction from LLM result if available
    const contextAction = (result as any).contextAction as string | undefined;
    
    logger.debug('inferIntentAndConstraintsWithLlm', {
      intent: finalIntent,
      contextAction,
      expandedKeywords: result.constraints.expandedKeywords,
      expandedKeywordsCount: result.constraints.expandedKeywords?.length || 0,
      constraints: {
        category: result.constraints.category,
        priceMinCents: result.constraints.priceMinCents,
        priceMaxCents: result.constraints.priceMaxCents,
        fabrics: result.constraints.fabrics?.length ? `${result.constraints.fabrics.length} fabrics` : undefined,
        colors: result.constraints.colors?.length ? `${result.constraints.colors.length} colors` : undefined,
        seasons: result.constraints.seasons?.length ? `${result.constraints.seasons.length} seasons` : undefined,
        occasions: result.constraints.occasions?.length ? `${result.constraints.occasions.length} occasions` : undefined,
        sizes: result.constraints.sizes?.length ? `${result.constraints.sizes.length} sizes` : undefined,
        fit: result.constraints.fit,
        genders: result.constraints.genders, // CRITICAL: Log genders to debug
        inStockOnly: result.constraints.inStockOnly,
      },
    });
    
    return normalizeResult(
      { ...result, intent: finalIntent },
      shouldUsePreviousContext,
      contextAction,
      followUpDetection,
    );
  } catch (error) {
    logger.error('llm_intent_parsing_failed', {
      error: error instanceof Error ? error.message : String(error),
      provider: env.llmProvider,
    });
    const ruleResult = inferIntentAndConstraintsRuleBased(message, pageType, productContextId);
    return await normalizeResult(ruleResult, shouldUsePreviousContext, undefined, followUpDetection);
  }
}

// Detector functions
export function isFollowUpMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 6) return true;
  if (REFINEMENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  if (COMPARATIVE_KEYWORDS.some((keyword) => normalized.includes(keyword))) return true;
  return false;
}

export function isAffirmativeResponse(message: string): boolean {
  const normalized = message.toLowerCase();
  return AFFIRMATIVE_KEYWORDS.some((keyword) => normalized === keyword || normalized.includes(keyword));
}

export function looksLikeNewQuery(message: string): boolean {
  const normalized = message.toLowerCase();
  return NEW_QUERY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Detects hard override patterns that should bypass pending suggestions
 * Examples: "only tshirts", "just skirts", "show me tops", "instead", "switch to"
 */
export function isHardOverride(message: string): boolean {
  const normalized = message.toLowerCase().trim();

  // Hard override patterns: "only/just/show me + product category"
  const hardOverridePatterns = [
    /\bonly\s+(t-?shirts?|tees?|skirts?|jeans?|tops?|shirts?|shoes?|belts?|dresses?|pants?|shorts?|jackets?|sweaters?|blazers?)\b/i,
    /\bjust\s+(t-?shirts?|tees?|skirts?|tops?|shirts?|jeans?|dresses?|pants?|shorts?)\b/i,
    /\bshow\s+me\s+(t-?shirts?|tees?|skirts?|tops?|shirts?|jeans?|dresses?|pants?|shorts?)\b/i,
    /\binstead\b/i,
    /\bswitch\s+to\b/i,
    /\bnot\s+\w+,\s*(just|only)\s+\w+/i, // "not jeans, just tops"
    /\bfilter\s+to\b/i,
    /\bchange\s+to\b/i,
  ];

  // Check if message matches any hard override pattern
  if (hardOverridePatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // Also check for explicit category mentions that differ from context
  // This is a fallback - the LLM will handle this more intelligently
  const categoryKeywords = [
    'tshirt',
    'tee',
    'skirt',
    'jean',
    'top',
    'shirt',
    'dress',
    'pant',
    'short',
    'jacket',
    'sweater',
    'blazer',
  ];

  // If message contains "only/just" + a category keyword, it's likely an override
  const hasOnlyJust = /\b(only|just)\b/.test(normalized);
  const hasCategory = categoryKeywords.some((cat) => normalized.includes(cat));

  if (hasOnlyJust && hasCategory) {
    return true;
  }

  return false;
}

