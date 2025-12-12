import { prisma } from '../../db';
import { deriveAttributeConstraintMeta } from '../../search';
import type { SearchConstraints } from '../../search/types';
import { logger } from '../../telemetry/logger';
import type { DatasetContext } from '../../catalog/datasetInspector';
import type { ProductCard } from './cards';
import {
  inferIntentAndConstraints,
  mergeConstraints,
  type AssistantIntent,
} from './intent';
import { callVelouRouter } from './intent-router';
import { getCatalogOntology } from '../../search/ontology';
import { detectFollowUpType } from './followup-detector';
import type { ProgressCallback } from './progress';
import { STAGE_PROGRESS } from './progress';
// Import flows (using index for cleaner imports)
import {
  runDiscoveryFlow,
  runPdpFlow,
  runPendingSuggestionFlow,
  runProductQaFlow,
} from './flows';
// Import helpers
import { buildNonProductChatReply } from './helpers';

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
  onProgress?: ProgressCallback;
};

// Re-export types from cards
export type { QueryChip, ProductCard } from './cards';

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

/**
 * Main Orchestrator Entry Point
 * 
 * Handles all assistant queries and routes them to the appropriate flow:
 * - Discovery: Product search queries
 * - PDP: Product detail page queries (shows product + related)
 * - Pending: Confirmed pending suggestions
 * - Product Q&A: Questions about a specific product
 * 
 * The orchestrator:
 * 1. Loads conversation context (from DB if missing)
 * 2. Handles pending suggestions (router + follow-up detection)
 * 3. Extracts intent and constraints from user message
 * 4. Routes to appropriate flow based on intent and productContextId
 * 5. Returns unified result format
 * 
 * Used by: AssistantService.handleAssistantQuery
 * API: POST /api/assistant, POST /api/assistant/stream
 * 
 * @param input - Assistant query input (message, context, session, etc.)
 * @returns Assistant query result (reply text, product cards, follow-up, etc.)
 */
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
      
      // If productContextId is set, always route to Q&A flow (text-only, no product cards)
      if (input.productContextId) {
        result = await runProductQaFlow(input.productContextId, input.message, datasetContext, input.onProgress);
      } else {
        result = await runDiscoveryFlow(mergedConstraints, input.message, intent, datasetContext, input.onProgress, input.conversationContext);
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
      // Stage 1: Understanding (already done before router check)
      input.onProgress?.('understanding', STAGE_PROGRESS.understanding);
      // Stage 2: Generating response
      const clarifyingReply = await buildNonProductChatReply(
        input.message,
        datasetContext,
        input.onProgress,
      );
      return {
        replyText: clarifyingReply,
        productCards: [],
        noExactMatch: false,
        intent: 'other' as AssistantIntent, // Mark as non-contextual
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

  // Stage 1: Understanding request (Intent & Constraints Extraction)
  input.onProgress?.('understanding', STAGE_PROGRESS.understanding);

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
    // Stage 2: Generating response (understanding already done)
    input.onProgress?.('generating', STAGE_PROGRESS.generating);
    const nonProductReply = await buildNonProductChatReply(
      input.message,
      datasetContext,
      input.onProgress,
    );
    return {
      replyText: nonProductReply,
      productCards: [],
      noExactMatch: false,
      intent: 'other' as AssistantIntent, // Mark as non-contextual for frontend
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
  
  // If productContextId is set, always route to Q&A flow (text-only, no product cards)
  if (input.productContextId) {
    result = await runProductQaFlow(input.productContextId, input.message, datasetContext, input.onProgress);
  } else {
    result = await runDiscoveryFlow(constraints, input.message, intent, datasetContext, input.onProgress, input.conversationContext);
  }

  return {
    ...result,
    intent,
    resolvedConstraints: constraints,
    usedFollowUpContext,
  };
}
