import { prisma } from '../../db';
import { searchProducts, searchProductsRelaxed, deriveAttributeConstraintMeta } from '../../search';
import type { SearchConstraints, SearchResultItem } from '../../search/types';
import { logger } from '../../telemetry/logger';
import type { DatasetContext } from '../../catalog/datasetInspector';
import {
  buildCardReason,
  buildDiscoveryReply,
  buildPendingReminderReply,
  buildPendingSummary,
  buildProductCard,
  buildQueryChips,
  buildSuitabilityReply,
  collectConstraintLabels,
  describeConstraints,
  evaluateProductFit,
  fetchProductsByIds,
  inferImplicitPreferences,
  productToResultItem,
  tokenize,
  type ProductCard,
} from './cards';
import { applyBrandVoiceToReply, maybeEnhanceReplyWithLlm } from './brandVoice';
import {
  inferIntentAndConstraints,
  isAffirmativeResponse,
  isHardOverride,
  looksLikeNewQuery,
  mergeConstraints,
  type AssistantIntent,
} from './intent';
import { callVelouRouter, type VelouRouterResult } from './intent-router';
import { getCatalogOntology } from '../../search/ontology';
import { CLARIFYING_REPLY, MAX_RECOMMENDATIONS, PRODUCT_REQUEST_KEYWORDS } from './constants';
import { extractHardTextFilterKeywords } from './utils';
import { detectFollowUpType } from './followup-detector';
import { callLLM, type LlmMessage } from '../provider';
import {
  buildClarifyingReplyPrompt,
  buildOutOfScopeReplyPrompt,
  buildPostCardsFollowupPrompt,
} from '../prompts';

// Export all types used by API/UI
export type ChatHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConversationContext = {
  lastIntent?: AssistantIntent | null;
  lastConstraints?: SearchConstraints | null;
  lastShownProductIds?: string[];
  lastUserQuery?: string | null;
  datasetContext?: DatasetContext | null;
};

export type AssistantQueryInput = {
  sessionId: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
  message: string;
  history?: ChatHistoryItem[];
  productContextId?: string;
  pendingSuggestion?: PendingSuggestionInput;
  conversationContext?: ConversationContext;
};

// Re-export types from cards
export type { QueryChip, ProductCard } from './cards';

// Helper function for flow decision
function shouldShowCards(message: string, constraints: SearchConstraints): boolean {
  const normalized = message.toLowerCase();
  if (PRODUCT_REQUEST_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  const hasCategory = Boolean(constraints.category || constraints.productTypes?.length);
  const hasPrice = Boolean(constraints.priceMinCents || constraints.priceMaxCents);
  const hasAttributes = Boolean(
    constraints.colors?.length ||
      constraints.materials?.length ||
      constraints.fabrics?.length ||
      constraints.occasions?.length ||
      constraints.seasons?.length ||
      constraints.sizes?.length ||
      constraints.genders?.length ||
      constraints.brands?.length,
  );

  if (!hasCategory && !hasPrice && !hasAttributes) {
    return false;
  }

  return true;
}

export type AssistantQueryResult = {
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  pendingSuggestion?: PendingSuggestionResult;
  intent?: AssistantIntent;
  resolvedConstraints?: SearchConstraints;
  usedFollowUpContext?: boolean;
  followupText?: string;
};

export type PendingSuggestionInput = {
  constraints: SearchConstraints;
  candidateIds: string[];
};

export type PendingSuggestionResult = PendingSuggestionInput & {
  summary: string;
};

// Re-export AssistantIntent for convenience
export type { AssistantIntent } from './intent';

async function runPendingSuggestionFlow(
  pending: PendingSuggestionInput,
  userMessage: string,
  datasetContext?: DatasetContext | null,
): Promise<AssistantQueryResult> {
  const products = await fetchProductsByIds(pending.candidateIds);
  if (products.length === 0) {
    let reply =
      "Those saved picks aren't available anymore.\n\nI can search again. Just tell me what you're looking for.";
    reply = await applyBrandVoiceToReply(reply);
    return {
      replyText: reply,
      productCards: [],
      noExactMatch: true,
    };
  }

  const implicitPrefs = inferImplicitPreferences(userMessage);
  const queryTokens = tokenize(userMessage);
  const queryChips = buildQueryChips(pending.constraints, implicitPrefs);
  const constraintLabels = collectConstraintLabels(pending.constraints);

  const evaluated = products
    .map((item) => evaluateProductFit(item, pending.constraints, implicitPrefs, queryTokens))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.priceCents - b.item.priceCents;
    })
    .slice(0, MAX_RECOMMENDATIONS);

  const shortlistedProducts = evaluated.map((entry) => entry.item);

  const cards = await Promise.all(
    evaluated.map(async ({ item, facts }) => {
      const reason = await buildCardReason({
        item,
        userMessage,
        constraintLabels,
        facts,
        implicitPrefs,
      });
      return buildProductCard(item, {
        reason,
        queryChips,
      });
    }),
  );

  let baseReply =
    cards.length === 1
      ? "Here's what I found for you."
      : `I found a few options that should work.\n\nTap any card to view details.`;
  baseReply = await applyBrandVoiceToReply(baseReply);

  const enhancedReply = await maybeEnhanceReplyWithLlm({
    baseReply,
    userMessage,
    intent: 'discovery',
    constraints: pending.constraints,
    products: shortlistedProducts,
    wasRelaxed: false,
    datasetContext,
  });

  const followupText = await buildPostCardsFollowupText(
    userMessage,
    pending.constraints,
    datasetContext,
  );

  return {
    replyText: enhancedReply,
    productCards: cards,
    noExactMatch: false,
    followupText,
  };
}

async function runDiscoveryFlow(
  constraints: SearchConstraints,
  userMessage: string,
  intent: AssistantIntent,
  datasetContext?: DatasetContext | null,
): Promise<AssistantQueryResult> {
  logger.debug('runDiscoveryFlow start', {
    constraints: {
      category: constraints.category,
      priceMaxCents: constraints.priceMaxCents,
      limit: constraints.limit ?? 8,
    },
  });

  if (!shouldShowCards(userMessage, constraints)) {
    const clarifyingReply = await buildClarifyingReply(
      userMessage,
      datasetContext,
    );
    return {
      replyText: clarifyingReply,
      productCards: [],
      noExactMatch: false,
    };
  }

  // Fix C: Extract hard text filter keywords when category is missing
  const hardTextFilters = !constraints.category
    ? extractHardTextFilterKeywords(userMessage, constraints.category)
    : (constraints as any).hardTextFilters as string[] | undefined;

  // Add hardTextFilters to constraints for searchProducts
  const constraintsWithHardFilters = {
    ...constraints,
    ...(hardTextFilters && hardTextFilters.length > 0 ? { hardTextFilters } : {}),
  } as SearchConstraints & { hardTextFilters?: string[] };

  logger.debug('runDiscoveryFlow hardTextFilters', {
    category: constraints.category,
    normalizedCategory: constraints.category,
    hardTextFiltersEnabled: !!hardTextFilters && hardTextFilters.length > 0,
    hardTextFilters: hardTextFilters,
  });

  const strictLimit = Math.max(constraints.limit ?? 4, 3);
  const { candidates, relaxedConstraints, wasRelaxed } = await searchProductsRelaxed(
    { ...constraintsWithHardFilters, limit: strictLimit },
    strictLimit,
    userMessage, // Pass userMessage for canonicalization
  );

  if (candidates.length === 0) {
    logger.warn('runDiscoveryFlow no products found, starting rescue stage', {
      constraints: {
        category: constraints.category,
        priceMaxCents: constraints.priceMaxCents,
      },
    });

    // C) No-results rescue stage
    try {
      const { callLLM } = await import('../provider');
      type LlmMessage = import('../provider').LlmMessage;
      const {
        CLOSEST_MATCH_RESCUE_PLAN_PROMPT,
        CLOSEST_MATCH_RESCUE_PLAN_JSON_SCHEMA,
        NO_RESULTS_REPLY_PROMPT_V2,
      } = await import('../prompts');
      const ontology = await getCatalogOntology();
      const { expandKeywordsForSearch } = await import('../../search/canonicalize');

      // Step 1: Call rescue plan prompt
      const expandedKeywords = constraints.query
        ? expandKeywordsForSearch([constraints.query])
        : [];
      
      const ontologySummary = `Categories: ${ontology.categories.slice(0, 20).join(', ')}
Colors: ${ontology.colors.slice(0, 20).join(', ')}
Materials: ${ontology.materials.slice(0, 20).join(', ')}`;

      const rescueMessages: LlmMessage[] = [
        {
          role: 'system',
          content: CLOSEST_MATCH_RESCUE_PLAN_PROMPT,
        },
        {
          role: 'user',
          content: `userMessage: "${userMessage}"

constraints: ${JSON.stringify(constraints)}
expandedKeywords: ${JSON.stringify(expandedKeywords)}

${ontologySummary}

Create a rescue search plan.`,
        },
      ];

      const rescuePlanResult = await callLLM({
        messages: rescueMessages,
        purpose: 'intent',
        expectJson: true,
        schema: CLOSEST_MATCH_RESCUE_PLAN_JSON_SCHEMA,
      });

      const { stripJsonFences } = await import('./utils');
      const cleaned = stripJsonFences(rescuePlanResult.rawText);
      const rescuePlan = JSON.parse(cleaned) as {
        rescueSearches: Array<{
          queryText: string;
          keywords: string[];
          categoryHints: string[];
          hardConstraints: Partial<SearchConstraints>;
        }>;
        rescueSummary: string;
      };

      // Step 2: Execute rescue searches sequentially
      const closestCandidates: SearchResultItem[] = [];
      for (const rescueSearch of rescuePlan.rescueSearches.slice(0, 3)) {
        const rescueConstraints: SearchConstraints = {
          ...rescueSearch.hardConstraints,
          query: rescueSearch.queryText,
          limit: 20, // Get more candidates for rescue
          // CRITICAL: Preserve original gender constraints from user query
          // The rescue plan might not include gender, so we must preserve it
          genders: constraints.genders || rescueSearch.hardConstraints.genders,
        };

        // Build category OR conditions from categoryHints
        if (rescueSearch.categoryHints.length > 0) {
          // Use keyword filters for category hints
          rescueConstraints.query = [
            rescueSearch.queryText,
            ...rescueSearch.categoryHints,
          ]
            .filter(Boolean)
            .join(' ');
        }

        const rescueResult = await searchProductsRelaxed(rescueConstraints, 20, userMessage);
        if (rescueResult.candidates.length > 0) {
          closestCandidates.push(...rescueResult.candidates.slice(0, 10));
        }
      }

      // Step 3: Get top 5 closest candidates
      const topClosest = closestCandidates
        .slice(0, 5)
        .map((item) => ({
          title: item.title,
          price: item.priceCents,
          color: (item.attributes?.color as string) || 'unknown',
          category: item.category,
        }));

      // Step 4: Call NO_RESULTS_REPLY_PROMPT_V2
      // Note: getBrandVoiceContext doesn't exist, using applyBrandVoiceToReply instead
      const brandContext = null; // Brand voice is applied via applyBrandVoiceToReply later
      const brandVoiceNote = brandContext ? `\n\nBrand voice instructions:\n${brandContext}` : '';

      const replyMessages: LlmMessage[] = [
        {
          role: 'system',
          content: `${NO_RESULTS_REPLY_PROMPT_V2}${brandVoiceNote}`,
        },
        {
          role: 'user',
          content: `userMessage: "${userMessage}"

constraints: ${JSON.stringify(constraints)}

closestCandidates: ${JSON.stringify(topClosest)}

Write a friendly response mentioning up to 3 closest products by title and asking 1-2 clarifying questions.`,
        },
      ];

      const replyResult = await callLLM({
        messages: replyMessages,
        purpose: 'final_reply',
        expectJson: false,
      });

      const noProductsReply = replyResult.rawText.trim();
      const finalReply = await applyBrandVoiceToReply(noProductsReply);

      return {
        replyText: finalReply,
        productCards: [],
        noExactMatch: true,
      };
    } catch (error) {
      logger.error('rescue_stage_failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to simple message
      let noProductsReply: string;
      if (constraints.category) {
        const categoryStr = Array.isArray(constraints.category)
          ? constraints.category.join(', ')
          : constraints.category;
        noProductsReply = `We don't have any **${categoryStr.toLowerCase()}** matching those filters right now.\n\nWould you like to see ${categoryStr.toLowerCase()} without those filters, or try a different category?`;
      } else {
        noProductsReply =
          "We don't have any products matching those filters.\n\nTry adjusting the price range, category, or other criteria. I'll search again with your updated preferences.";
      }
      noProductsReply = await applyBrandVoiceToReply(noProductsReply);

      return {
        replyText: noProductsReply,
        productCards: [],
        noExactMatch: true,
      };
    }
  }

  const implicitPrefs = inferImplicitPreferences(userMessage);
  const queryTokens = tokenize(userMessage);
  const scoringConstraints = wasRelaxed ? relaxedConstraints : constraints;

  const evaluated = candidates
    .map((item) => evaluateProductFit(item, scoringConstraints, implicitPrefs, queryTokens))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.priceCents - b.item.priceCents;
    });

  // Fix D: Deduplicate by product.id BEFORE slicing to limit
  const seenIds = new Set<string>();
  const uniqueEvaluated = evaluated.filter((entry) => {
    if (seenIds.has(entry.item.id)) return false;
    seenIds.add(entry.item.id);
    return true;
  });

  // Fix D: Add diversity step - group by category/subcategory, interleave
  const groupedByCategory = new Map<string, typeof uniqueEvaluated>();
  for (const entry of uniqueEvaluated) {
    const category = entry.item.category || 'other';
    if (!groupedByCategory.has(category)) {
      groupedByCategory.set(category, []);
    }
    groupedByCategory.get(category)!.push(entry);
  }

  // Interleave round-robin for diversity
  const interleaved: typeof uniqueEvaluated = [];
  const maxLen = Math.max(...Array.from(groupedByCategory.values()).map(g => g.length));
  for (let i = 0; i < maxLen && interleaved.length < strictLimit * 2; i++) {
    for (const group of groupedByCategory.values()) {
      if (group[i]) interleaved.push(group[i]);
    }
  }

  // Take top N from interleaved (or fallback to ranked if not enough)
  const diverseEvaluated = interleaved.length >= strictLimit
    ? interleaved.slice(0, strictLimit)
    : uniqueEvaluated.slice(0, strictLimit);

  const topEvaluations = diverseEvaluated;
  const shortlistedItems = topEvaluations.map((entry) => entry.item);
  const constraintLabels = collectConstraintLabels(constraints);
  const queryChips = buildQueryChips(constraints, implicitPrefs);

  const strictCards = await Promise.all(
    topEvaluations.map(async ({ item, facts }) => {
      const reason = await buildCardReason({
        item,
        userMessage,
        constraintLabels,
        facts,
        implicitPrefs,
      });
      return buildProductCard(item, { reason, queryChips });
    }),
  );
  
  // Fix D: Final deduplication by productUrl/canonicalSku (already done by ID, but ensure uniqueness)
  const { deduplicateProductCards } = await import('./cards');
  const deduplicatedCards = deduplicateProductCards(strictCards, strictLimit);
  
  logger.debug('deduplicateProductCards', {
    before: strictCards.length,
    after: deduplicatedCards.length,
    removed: strictCards.length - deduplicatedCards.length,
    requestedLimit: strictLimit,
    uniqueIds: new Set(deduplicatedCards.map(c => c.id)).size,
    uniqueImageUrls: new Set(deduplicatedCards.map(c => c.imageUrl).filter(Boolean)).size,
    duplicateImageUrls: strictCards.length - new Set(strictCards.map(c => c.imageUrl).filter(Boolean)).size,
  });

  // If we have products (even if relaxed), show them
  // Only create pending suggestion if we have many candidates but want user confirmation
  const hasManyCandidates = candidates.length >= 8;
  const categoryWasDropped = wasRelaxed && constraints.category && !relaxedConstraints.category;

  if (!wasRelaxed || !hasManyCandidates || categoryWasDropped) {
    // Show products directly - either strict match, or relaxed with few candidates, or category was dropped
    let baseReply: string;
    if (wasRelaxed) {
      if (categoryWasDropped && constraints.category) {
        const categoryStr = Array.isArray(constraints.category)
          ? constraints.category.join(', ')
          : constraints.category;
        baseReply = `I couldn't find **${categoryStr.toLowerCase()}** matching all your criteria.\n\nHere are some similar options:`;
      } else {
        baseReply = `Here are the closest matches I found.`;
      }
    } else {
      baseReply = buildDiscoveryReply(constraints, shortlistedItems);
    }
    baseReply = await applyBrandVoiceToReply(baseReply);

    const enhancedReply = await maybeEnhanceReplyWithLlm({
      baseReply,
      userMessage,
      intent,
      constraints: wasRelaxed ? relaxedConstraints : constraints,
      products: shortlistedItems,
      wasRelaxed,
      datasetContext,
    });

    const followupText = await buildPostCardsFollowupText(
      userMessage,
      wasRelaxed ? relaxedConstraints : constraints,
      datasetContext,
    );

    return {
      replyText: enhancedReply,
      productCards: deduplicatedCards,
      noExactMatch: wasRelaxed,
      followupText,
    };
  }

  // Only create pending suggestion if we have many candidates and category wasn't dropped
  const pendingSummaryCore = buildPendingSummary(relaxedConstraints, candidates.length);
  const summarySentence =
    pendingSummaryCore.charAt(0).toUpperCase() + pendingSummaryCore.slice(1) + '.';

  const pendingSuggestion: PendingSuggestionResult = {
    constraints: relaxedConstraints,
    candidateIds: candidates.map((item) => item.id),
    summary: summarySentence,
  };

  let baseReply = `Nothing hit every detail, but I found ${pendingSummaryCore}.\n\nWant me to show them?`;
  baseReply = await applyBrandVoiceToReply(baseReply);

  const enhancedReply = await maybeEnhanceReplyWithLlm({
    baseReply,
    userMessage,
    intent,
    constraints: relaxedConstraints,
    products: candidates.slice(0, strictLimit),
    wasRelaxed: true,
    datasetContext,
  });

  return {
    replyText: enhancedReply,
    productCards: [],
    noExactMatch: true,
    pendingSuggestion,
  };
}

async function runPdpFlow(
  productContextId: string,
  constraints: SearchConstraints,
  userMessage: string,
  datasetContext?: DatasetContext | null,
): Promise<AssistantQueryResult> {
  const productRecord = await prisma.product.findUnique({ where: { id: productContextId } });
  if (!productRecord) {
    return runDiscoveryFlow(constraints, userMessage, 'discovery', datasetContext);
  }

  const baseProduct = productToResultItem(productRecord);
  const { products: related, wasRelaxed } = await searchProducts({
    ...constraints,
    category: baseProduct.category,
    excludeProductIds: [baseProduct.id],
    limit: 3,
    inStockOnly: true,
  });

  const implicitPrefs = inferImplicitPreferences(userMessage);
  const constraintLabels = collectConstraintLabels(constraints);
  const queryChips = buildQueryChips(constraints, implicitPrefs);

  const baseReason = await buildCardReason({
    item: baseProduct,
    userMessage,
    constraintLabels,
    facts: ["it is the specific piece you're currently viewing"],
    implicitPrefs,
  });
  const relatedCards = await Promise.all(
    related.map(async (item: SearchResultItem) => {
      const reason = await buildCardReason({
        item,
        userMessage,
        constraintLabels,
        facts: [
          `it shares the ${item.attributes.fabric ?? 'fabric'} finish you liked`,
          `it keeps the same ${item.category.toLowerCase()} vibe`,
        ],
        implicitPrefs,
      });
      return buildProductCard(item, {
        reason,
        queryChips,
      });
    }),
  );

  const productCards = [
    buildProductCard(baseProduct, {
      reason: baseReason,
      queryChips,
    }),
    ...relatedCards,
  ];

  let baseReply = buildSuitabilityReply(baseProduct, constraints);
  // Apply brand voice to rule-based reply
  baseReply = await applyBrandVoiceToReply(baseReply);

  const enhancedReply = await maybeEnhanceReplyWithLlm({
    baseReply,
    userMessage,
    intent: 'pdp_suitability',
    constraints,
    products: [baseProduct, ...related],
    wasRelaxed,
    datasetContext,
  });

  const followupText = await buildPostCardsFollowupText(
    userMessage,
    constraints,
    datasetContext,
  );

  return {
    replyText: enhancedReply,
    productCards,
    noExactMatch: wasRelaxed,
    followupText,
  };
}

export async function handleAssistantQuery(input: AssistantQueryInput): Promise<AssistantQueryResult> {
  logger.debug('handleAssistantQuery start', {
    message: input.message,
    pageType: input.pageType,
    productContextId: input.productContextId,
    hasPendingSuggestion: !!input.pendingSuggestion,
    hasConversationContext: !!input.conversationContext,
  });

  // DB fallback: if conversationContext is missing, load last constraints from ConversationEvent
  let effectiveContext = input.conversationContext;
  const datasetContext = input.conversationContext?.datasetContext ?? null;
  if (!effectiveContext) {
    try {
      const lastEvent = await prisma.conversationEvent.findFirst({
        where: {
          sessionId: input.sessionId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          userQuery: true,
          createdAt: true,
        },
      });

      if (lastEvent) {
        // Try to reconstruct minimal context from last query
        // Note: We don't store full constraints in ConversationEvent, so we'll use the query as a hint
        // For now, we'll just log that we found a previous event
        logger.debug('db_fallback_context_loaded', {
          sessionId: input.sessionId,
          lastQuery: lastEvent.userQuery,
          lastEventTime: lastEvent.createdAt,
        });
        // We can't fully reconstruct constraints from just the query, but we can use it as a hint
        // The gatekeeper will handle this as a new_search but with potential sticky carry
      }
    } catch (error) {
      logger.warn('db_fallback_context_failed', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: input.sessionId,
      });
    }
  }

  if (input.pendingSuggestion) {
    // Use VelouRouter LLM to decide how to handle pending suggestions
    const ontology = await getCatalogOntology();
    const conversationSummary = input.conversationContext?.lastUserQuery
      ? `User was looking for: ${input.conversationContext.lastUserQuery}`
      : 'No previous context';

    // Extract categories from pending suggestion constraints
    const pendingCategories: string[] = [];
    if (input.pendingSuggestion.constraints.category) {
      const category = input.pendingSuggestion.constraints.category;
      if (Array.isArray(category)) {
        pendingCategories.push(...category);
      } else {
        pendingCategories.push(category);
      }
    }
    if (input.pendingSuggestion.constraints.productTypes?.length) {
      pendingCategories.push(...input.pendingSuggestion.constraints.productTypes);
    }

    const routerResult = await callVelouRouter({
      last_user_message: input.message,
      conversation_summary: conversationSummary,
      previous_constraints: input.conversationContext?.lastConstraints ?? null,
      has_pending_suggestion: true,
      pending_suggestion_categories: pendingCategories,
      taxonomy_categories: [
        ...ontology.categories,
        ...ontology.productTypes,
        'tshirt',
        't-shirt',
        'tee',
        'tees',
        'skirt',
        'skirts',
        'jeans',
        'pants',
        'top',
        'tops',
        'shirt',
        'shirts',
        'shoes',
        'belt',
        'belts',
        'jacket',
        'jackets',
        'dress',
        'dresses',
        'shorts',
        'sweater',
        'sweaters',
        'blazer',
        'blazers',
      ],
    });

    logger.debug('velou_router_result', {
      action: routerResult.action,
      new_category: routerResult.new_category,
      keep_previous_constraints: routerResult.keep_previous_constraints,
      reason: routerResult.reason,
    });

    // E) Fix pending suggestion gating: Only confirm if followUpType == CONFIRM_SUGGESTION
    // Check if user included a canonical category noun - if so, always run discovery
    const followUpDetection = detectFollowUpType(
      input.message,
      input.conversationContext?.lastConstraints ?? null,
      true, // hasPendingSuggestion
      ontology,
    );

    if (routerResult.action === 'confirm_pending_suggestion' && followUpDetection.followUpType === 'CONFIRM_SUGGESTION') {
      logger.debug('pending_suggestion_confirmed', {
        candidateCount: input.pendingSuggestion.candidateIds.length,
        reason: routerResult.reason,
        followUpType: followUpDetection.followUpType,
      });
      const confirmed = await runPendingSuggestionFlow(
        input.pendingSuggestion,
        input.message,
        datasetContext,
      );
      return {
        ...confirmed,
        intent: input.conversationContext?.lastIntent ?? 'discovery',
        resolvedConstraints: input.pendingSuggestion.constraints,
        usedFollowUpContext: true,
      };
    }

    // E) If user includes a canonical category noun, always run discovery and override suggestion
    if (followUpDetection.followUpType === 'SWITCH' && followUpDetection.overrideCategory) {
      logger.debug('pending_suggestion_overridden_by_category', {
        overrideCategory: followUpDetection.overrideCategory,
        reason: 'User explicitly requested new category',
      });
      // Fall through to normal discovery flow below
    }

    // For override_search or refine_search, we need to merge router refinements with constraints
    if (routerResult.action === 'override_search' || routerResult.action === 'refine_search') {
      logger.debug('pending_suggestion_overridden_by_router', {
        action: routerResult.action,
        candidateCount: input.pendingSuggestion.candidateIds.length,
        reason: routerResult.reason,
      });

      // Build constraints from router result
      const routerConstraints: SearchConstraints = {
        inStockOnly: true,
      };

      // Apply new category if provided
      if (routerResult.new_category) {
        routerConstraints.category = routerResult.new_category;
      } else if (routerResult.keep_previous_constraints && input.conversationContext?.lastConstraints?.category) {
        routerConstraints.category = input.conversationContext.lastConstraints.category;
      }

      // Apply refinements from router
      if (routerResult.refinements.colors) {
        routerConstraints.colors = routerResult.refinements.colors;
      }
      if (routerResult.refinements.fabrics) {
        routerConstraints.fabrics = routerResult.refinements.fabrics;
      }
      if (routerResult.refinements.materials) {
        routerConstraints.materials = routerResult.refinements.materials;
      }
      if (routerResult.refinements.seasons) {
        routerConstraints.seasons = routerResult.refinements.seasons;
      }
      if (routerResult.refinements.occasions) {
        routerConstraints.occasions = routerResult.refinements.occasions;
      }
      if (routerResult.refinements.sizes) {
        routerConstraints.sizes = routerResult.refinements.sizes;
      }
      if (routerResult.refinements.fit) {
        routerConstraints.fit = routerResult.refinements.fit;
      }
      if (routerResult.refinements.priceMinCents !== null && routerResult.refinements.priceMinCents !== undefined) {
        routerConstraints.priceMinCents = routerResult.refinements.priceMinCents;
      }
      if (routerResult.refinements.priceMaxCents !== null && routerResult.refinements.priceMaxCents !== undefined) {
        routerConstraints.priceMaxCents = routerResult.refinements.priceMaxCents;
      }

      // Merge with previous constraints if keep_previous_constraints is true
      let finalConstraints = routerConstraints;
      if (routerResult.keep_previous_constraints && input.conversationContext?.lastConstraints) {
        finalConstraints = mergeConstraints(
          input.conversationContext.lastConstraints,
          routerConstraints,
          input.message,
        );
      }

      // Continue to normal LLM + search flow with router-provided constraints as base
      // The LLM will further refine these constraints
      const { intent, constraints, usedFollowUpContext } = await inferIntentAndConstraints(
        input.message,
        input.pageType,
        input.productContextId,
        input.conversationContext,
        input.history,
      );

      // Merge router constraints with LLM constraints (router takes precedence for category)
      const mergedConstraints = routerResult.new_category
        ? { ...constraints, category: routerResult.new_category }
        : constraints;

      let result: AssistantQueryResult;
      if (intent === 'pdp_suitability' && input.productContextId) {
        result = await runPdpFlow(
          input.productContextId,
          mergedConstraints,
          input.message,
          datasetContext,
        );
      } else {
        result = await runDiscoveryFlow(mergedConstraints, input.message, intent, datasetContext);
      }

      return {
        ...result,
        intent,
        resolvedConstraints: mergedConstraints,
        usedFollowUpContext,
      };
    }

    // For non_product_chat, return a dataset-aware LLM reply that
    // re-centers the conversation on product discovery.
    if (routerResult.action === 'non_product_chat') {
      const clarifyingReply = await buildNonProductChatReply(
        input.message,
        datasetContext,
      );
      return {
        replyText: clarifyingReply,
        productCards: [],
        noExactMatch: false,
        intent: input.conversationContext?.lastIntent ?? 'discovery',
        resolvedConstraints: input.pendingSuggestion.constraints,
        usedFollowUpContext: false,
      };
    }
  }

  // D) Check for confirm_to_show before calling inferIntentAndConstraints
  // This handles cases where user says "yes/show/anything" to pending suggestions
  if (input.pendingSuggestion && !input.pendingSuggestion.candidateIds.length) {
    // Pending suggestion with no candidates - treat as new search
  } else if (input.pendingSuggestion) {
    const normalized = input.message.toLowerCase();
    const confirmKeywords = ['yes', 'yeah', 'ok', 'sure', 'show', 'anything', 'whatever', 'nothing else', 'go ahead'];
    const isPureConfirmation = confirmKeywords.some(kw => 
      normalized === kw || normalized === `${kw} show` || normalized.startsWith(`${kw} `)
    );
    
    // Check if message is ONLY confirmation keywords (no new product type)
    if (isPureConfirmation) {
      logger.debug('confirm_to_show_detected', {
        message: input.message,
        candidateCount: input.pendingSuggestion.candidateIds.length,
      });
      const confirmed = await runPendingSuggestionFlow(
        input.pendingSuggestion,
        input.message,
        datasetContext,
      );
      return {
        ...confirmed,
        intent: input.conversationContext?.lastIntent ?? 'discovery',
        resolvedConstraints: input.pendingSuggestion.constraints,
        usedFollowUpContext: true,
      };
    }
  }

  const { intent, constraints, usedFollowUpContext } = await inferIntentAndConstraints(
    input.message,
    input.pageType,
    input.productContextId,
    input.conversationContext,
    input.history,
    !!input.pendingSuggestion,
  );

  // If the LLM decides this is not a discovery/PDP query, route to a
  // dataset-aware non-product reply instead of forcing rule-based text.
  if (intent !== 'discovery' && intent !== 'pdp_suitability') {
    const nonProductReply = await buildNonProductChatReply(
      input.message,
      datasetContext,
    );
    return {
      replyText: nonProductReply,
      productCards: [],
      noExactMatch: false,
      intent,
      resolvedConstraints: undefined,
      usedFollowUpContext,
    };
  }

  const attributeMeta = deriveAttributeConstraintMeta(constraints);

  logger.debug('handleAssistantQuery intent resolved', {
    intent,
    constraints: {
      category: constraints.category,
      priceMaxCents: constraints.priceMaxCents,
      hasAttributeFilters: attributeMeta.hasHardAttributeConstraints,
      hardFacetFields: attributeMeta.hardFacetFields,
      ignoredDerivedFacetFields: attributeMeta.ignoredDerivedFacetFields,
    },
  });

  let result: AssistantQueryResult;
  if (intent === 'pdp_suitability' && input.productContextId) {
    result = await runPdpFlow(input.productContextId, constraints, input.message, datasetContext);
  } else {
    result = await runDiscoveryFlow(constraints, input.message, intent, datasetContext);
  }

  return {
    ...result,
    intent,
    resolvedConstraints: constraints,
    usedFollowUpContext,
  };
}

async function buildPostCardsFollowupText(
  userMessage: string,
  constraints: SearchConstraints,
  datasetContext?: DatasetContext | null,
): Promise<string | undefined> {
  try {
    const constraintSummary = describeConstraints(constraints);
    const prompt = buildPostCardsFollowupPrompt(datasetContext);

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `userMessage: "${userMessage}"

constraintSummary: "${constraintSummary || 'general preferences'}"`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    const text = result.rawText.trim();
    if (text.length) {
      return text;
    }
  } catch (error) {
    logger.error('post_cards_followup_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Deterministic fallback if LLM is unavailable or returned empty text
  const vertical = datasetContext?.vertical?.toLowerCase();
  const hasBudget = Boolean(constraints.priceMaxCents);
  const hasUseCases = Boolean(constraints.useCases?.length);

  if (vertical && vertical.includes('beauty')) {
    if (hasUseCases) {
      return 'Want something lighter, richer, or for a different concern? Tell me what you’d like to tweak.';
    }
    return 'If you’d like a different texture, concern focus, or price range, tell me and I’ll adjust these picks.';
  }

  if (vertical && (vertical.includes('home') || vertical.includes('decor'))) {
    return 'Need a different room, style, or budget? Tell me and I can pivot these suggestions.';
  }

  // Generic catalog fallback
  if (hasBudget) {
    return 'Want to go lighter, more premium, or switch categories? Tell me and I’ll refine these results.';
  }

  return 'If you’d like a different category, style, or price range, tell me and I’ll tweak these options.';
}

/**
 * Build a dataset-aware clarifying reply when the user has given a
 * product-ish but underspecified request (no clear category/price/facets),
 * using an LLM first and falling back to the older rule-based copy.
 */
async function buildClarifyingReply(
  userMessage: string,
  datasetContext?: DatasetContext | null,
): Promise<string> {
  try {
    const prompt = buildClarifyingReplyPrompt(datasetContext);
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `userMessage: "${userMessage}"`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    const text = result.rawText.trim();
    if (text.length) {
      return text;
    }
  } catch (error) {
    logger.error('clarifying_reply_llm_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Deterministic, brand-voiced fallback if LLM is unavailable
  let fallback = CLARIFYING_REPLY;
  fallback = await applyBrandVoiceToReply(fallback);
  return fallback;
}

/**
 * Build a dataset-aware LLM reply for non-product or out-of-scope chat.
 * This is used as a richer fallback when the router or intent detector
 * classifies the message as "non_product_chat" or "other/qa".
 */
async function buildNonProductChatReply(
  userMessage: string,
  datasetContext?: DatasetContext | null,
): Promise<string> {
  try {
    const prompt = buildOutOfScopeReplyPrompt(datasetContext);
    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `userMessage: "${userMessage}"`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    const text = result.rawText.trim();
    if (text.length) {
      return text;
    }
  } catch (error) {
    logger.error('non_product_chat_llm_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Deterministic, brand-voiced fallback if LLM is unavailable
  let fallback =
    "I'm here to help you find products in this catalog. Tell me a category, concern, or price range and I'll pull options that fit.";
  fallback = await applyBrandVoiceToReply(fallback);
  return fallback;
}

