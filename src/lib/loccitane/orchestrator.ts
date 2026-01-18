/**
 * L'Occitane-Optimized Orchestrator
 * 
 * Multi-view retrieval + ML ranking + RAG reply generation.
 * Fast, accurate query handler using retrieval-first architecture.
 * 
 * See: docs/loccitane_multiview_retrieval.md
 */

import { logger } from '../telemetry/logger';
import type { SearchConstraints, SearchResultItem } from '../search/types';
// ProductCard type and utilities - moved from legacy orchestrator
import type { ProductCard } from '../llm/orchestrator/cards';
import { productToResultItem, fetchProductsByIds } from '../llm/orchestrator/cards';
import { prisma } from '../db';
import { checkQuerySafety } from './safety';
import { routeTurn } from './router';
import { routeTurnLLMFirst } from './turnRouter';
import type { TurnRouterInput, TurnRouterResult } from './router';
import { generateMicroReply } from './microReply';
import { classifyQuery, type QueryClassification } from './classifier';
import { multiViewRetrieval } from './retrieval';
import { sortProductsByScore } from './ranking/ranker';
import type { ProductWithLoccitaneAttributes } from './ranking/ranker';
import { generateReplyWithRag } from './reply';
import { buildProductReason } from './reasons';
import type { StructuredLoccitaneAttributes } from './attributeParser';
import type { ProductAttributes } from '../search/types';
import { normalizeProductType, normalizeIngredient, normalizeAvoidIngredients } from './normalization';
import { normalizeIngredientCanonical, normalizeConcernCanonical } from './classifier';
import type { ProgressCallback } from '../llm/types';
import { STAGE_PROGRESS } from '../llm/types';

import type { ActionProposal } from './actions';
import { generateActionId } from './actions';
import { getActionLabels } from './actionLabels';
import { 
  setPendingActions, 
  getState,
  appendShownProducts,
  advanceRankCursor,
  setLastRankedProducts,
  type ConversationStateData 
} from '../chat/ConversationStateService';
import { generateActionSpecs } from './actions';
import { handleNonDiscoveryQuery } from './nonDiscovery';
import type { DatasetContext } from '../catalog/datasetInspector';

export type LoccitaneQueryResult = {
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  followupText?: string;
  actions?: ActionProposal[];
  route?: string; // Dialogue route (for analytics)
  actionType?: string; // Action type if ACTION_REQUEST (for analytics)
  resolvedConstraints?: SearchConstraints; // Resolved constraints used for this query (for follow-up context)
  resolvedClassificationConstraints?: QueryClassification['constraints'] & { size?: string }; // Classification constraints for merging in follow-ups (including size)
};

type LoccitaneQueryInput = {
  sessionId: string;
  message: string;
  lastConstraints?: SearchConstraints | null;
  lastClassificationConstraints?: QueryClassification['constraints'] | null; // Previous classification constraints (collections, concerns, etc.)
  lastShownProductIds?: string[];
  merchantId?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onProgress?: ProgressCallback;
  searchMethods?: {
    lexical: boolean;
    semantic: boolean;
    concept: boolean;
  };
  productContextId?: string; // Product ID for product-specific queries
  conversationState?: ConversationStateData; // Optional conversation state for action handling
  merchantData?: {
    brandName?: string;
    voiceInstructions?: string;
    datasetContext?: any;
    faq?: Array<{ question: string; answer: string }> | null;
  };
}

/**
 * Load products with L'Occitane structured attributes
 */
async function loadLoccitaneProducts(
  productIds: string[],
  merchantId?: string
): Promise<ProductWithLoccitaneAttributes[]> {
  if (productIds.length === 0) return [];
  
  // OPTIMIZATION: Load products in parallel batches for faster loading
  // PostgreSQL IN clauses with >100 items can be slow, but parallel batches are faster
  const BATCH_SIZE = 100;
  const batches: string[][] = [];
  
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    batches.push(productIds.slice(i, i + BATCH_SIZE));
  }
  
  // Load all batches in parallel for better performance
  const batchPromises = batches.map(batch =>
    prisma.product.findMany({
      where: {
        id: { in: batch },
        isActive: true,
        ...(merchantId ? { merchantId } : {}),
      },
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        productUrl: true,
        priceCents: true,
        salePriceCents: true,
        currency: true,
        category: true,
        subcategory: true,
        stockStatus: true,
        attributes: true,
        shopifyBestseller: true,
        shopifySalesRank: true,
      },
    })
  );
  
  const batchResults = await Promise.all(batchPromises);
  const allProducts = batchResults.flat();
  
  const products = allProducts;
  
  // Convert to ProductWithLoccitaneAttributes, filtering for those with structured attributes
  const loccitaneProducts: ProductWithLoccitaneAttributes[] = [];
  
  for (const product of products) {
    const attrs = (product.attributes as unknown) as ProductAttributes;
    const structured = attrs?.loccitaneStructured as StructuredLoccitaneAttributes | undefined;
    
    // Only include products with structured attributes
    if (structured) {
      const resultItem: SearchResultItem = {
        id: product.id,
        title: product.title,
        description: product.description,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        priceCents: product.priceCents,
        salePriceCents: product.salePriceCents,
        currency: product.currency,
        category: product.category,
        stockStatus: product.stockStatus,
        attributes: attrs,
      };
      
      loccitaneProducts.push({
        ...resultItem,
        attributes: {
          ...resultItem.attributes,
          loccitaneStructured: structured,
        },
        shopifyBestseller: product.shopifyBestseller || false,
        shopifySalesRank: product.shopifySalesRank,
      });
    }
  }
  
  return loccitaneProducts;
}

/**
 * Map new route types to legacy route types for backward compatibility
 */
function mapNewRouteToLegacy(route: TurnRouterResult['route']): string {
  const routeMap: Record<TurnRouterResult['route'], string> = {
    'ACTION': 'ACTION_REQUEST',
    'YES_NO': 'AFFIRMATION', // Will be handled specially
    'REFINE': 'FOLLOWUP_REFINE',
    'DISCOVERY': 'DISCOVERY',
    'PDP_QA': 'PDP_QA',
    'BRAND_INFO': 'BRAND_OR_PRODUCT_INFO',
    'UNRELATED': 'SMALLTALK_OR_RANDOM',
    'AMBIGUOUS': 'SMALLTALK_OR_RANDOM',
    'SAFETY_BLOCK': 'SAFETY_BLOCK',
  };
  return routeMap[route] || 'DISCOVERY';
}

/**
 * Handle action requests (e.g., "show more") deterministically without LLM
 * Returns next batch of products from cached ranked list
 */
async function handleActionRequest(
  input: LoccitaneQueryInput,
  actionType: string | undefined,
  conversationState: ConversationStateData
): Promise<LoccitaneQueryResult | null> {
  // Only handle show_more action deterministically
  if (actionType !== 'show_more') {
    return null; // Let other actions fall through to discovery
  }

  const { merchantId, sessionId } = input;
  if (!merchantId || !sessionId) {
    logger.warn('handleActionRequest: missing merchantId or sessionId');
    return null;
  }

  const { lastRankedProductIds, lastRankCursor, shownProductIds } = conversationState;

  // Check if we have cached ranked products
  if (!lastRankedProductIds || lastRankedProductIds.length === 0) {
    logger.debug('handleActionRequest: no cached ranked products, falling through to discovery');
    return null;
  }

  // Get next 4 products from cursor position, excluding already shown
  const candidateIds = lastRankedProductIds.slice(lastRankCursor);
  const nextBatchIds = candidateIds.filter(id => !shownProductIds.includes(id)).slice(0, 4);

  if (nextBatchIds.length === 0) {
    logger.debug('handleActionRequest: no more products to show');
    return {
      replyText: "You've seen all available options! Would you like to refine your search?",
      productCards: [],
      noExactMatch: false,
    };
  }

  // Load products
  input.onProgress?.('loading_product', STAGE_PROGRESS.loading_product);
  const products = await loadLoccitaneProducts(nextBatchIds, merchantId);

  if (products.length === 0) {
    logger.warn('handleActionRequest: failed to load products', { productIds: nextBatchIds });
    return null;
  }

  // Build product cards
  const productCards: ProductCard[] = products.map((product) => {
    const structured = product.attributes.loccitaneStructured;
    const keyAttributes: string[] = [];
    
    const normalizeForDisplay = (value: string): string => value.replace(/_/g, ' ');
    
    if (structured.canonicalConcerns.length > 0) {
      keyAttributes.push(...structured.canonicalConcerns.slice(0, 2).map(normalizeForDisplay));
    }
    if (structured.canonicalIngredients.length > 0) {
      keyAttributes.push(...structured.canonicalIngredients.slice(0, 2).map(normalizeForDisplay));
    }
    if (structured.applicationAreas.length > 0) {
      keyAttributes.push(normalizeForDisplay(structured.applicationAreas[0]));
    }
    
    const finalAttributes = keyAttributes.slice(0, 5);
    
    return {
      id: product.id,
      title: product.title,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      priceCents: product.priceCents,
      salePriceCents: product.salePriceCents || null,
      currency: product.currency,
      reason: `Chosen because it matches your search criteria.`,
      keyAttributes: finalAttributes,
      queryChips: [],
      stockStatus: product.stockStatus,
    };
  });

  // Update state: mark products as shown and advance cursor
  const newShownIds = [...shownProductIds, ...nextBatchIds];
  await appendShownProducts(merchantId, sessionId, nextBatchIds);
  await advanceRankCursor(merchantId, sessionId, nextBatchIds.length);

  // Generate simple actions (refine price, etc.) - no LLM needed, use simple defaults
  const remainingAfterCursor = lastRankedProductIds.slice(lastRankCursor + nextBatchIds.length).filter(id => !shownProductIds.includes(id));
  const hasMore = remainingAfterCursor.length > 0;
  const actions: ActionProposal[] = [];
  
  if (hasMore) {
    actions.push({
      id: generateActionId('show_more'),
      type: 'show_more',
      label: 'Show more',
    });
  }

  // Add refine price action as a simple suggestion
  actions.push({
    id: generateActionId('refine_price'),
    type: 'refine_price',
    label: 'Show cheaper options',
  });

  // Save actions
  await setPendingActions(merchantId, sessionId, actions);

  input.onProgress?.('complete', STAGE_PROGRESS.complete);

  return {
    replyText: `Here are ${nextBatchIds.length} more options.`,
    productCards,
    noExactMatch: false,
    actions: actions.length > 0 ? actions : undefined,
    route: 'ACTION_REQUEST',
    actionType: 'show_more',
  };
}

/**
 * Main query handler - multi-view retrieval + ranking + RAG
 */
export async function handleLoccitaneQuery(
  input: LoccitaneQueryInput,
): Promise<LoccitaneQueryResult> {
  const startTime = Date.now();
  const { onProgress } = input;
  
  logger.debug('handleLoccitaneQuery start', {
    message: input.message,
    sessionId: input.sessionId,
    merchantId: input.merchantId,
    productContextId: input.productContextId,
    hasProductContext: !!input.productContextId,
  });
  
  // Step 1: Safety gate
  onProgress?.('safety_check', STAGE_PROGRESS.safety_check);
  const safetyCheck = checkQuerySafety(input.message);
  if (!safetyCheck.safe) {
    logger.info('handleLoccitaneQuery: unsafe or non-shopping query', {
      reason: 'reason' in safetyCheck ? safetyCheck.reason : 'unknown',
      message: input.message.substring(0, 100),
    });
    
    // Handle self-harm/crisis queries with compassionate response
    if ('reason' in safetyCheck && safetyCheck.reason === 'self_harm') {
      onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
      // Small delay to show progress
      await new Promise(resolve => setTimeout(resolve, 100));
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "I hear that you're going through a difficult time, and I want you to know that your feelings are valid and you're not alone. While I'm here to help with beauty and skincare products, I'm not equipped to provide the support you might need right now.\n\nPlease reach out to someone you trust—a friend, family member, or mental health professional. If you're in immediate crisis, please contact your local emergency services or a crisis hotline like the National Suicide Prevention Lifeline at 988 (in the US) or your local crisis hotline.\n\nYou deserve support, and there are people who can help.",
        productCards: [],
        noExactMatch: true,
        route: 'SAFETY_BLOCK',
      };
    }
    
    // Handle other unsafe content
    if ('reason' in safetyCheck && safetyCheck.reason === 'unsafe') {
      onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
      await new Promise(resolve => setTimeout(resolve, 100));
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "I'm here to help you find beauty and skincare products. If you have questions about products, I'm happy to help!",
        productCards: [],
        noExactMatch: true,
        route: 'SAFETY_BLOCK',
      };
    }
    
    // Handle non_shopping queries with witty redirect (rule-based detection)
    if ('reason' in safetyCheck && safetyCheck.reason === 'non_shopping') {
      onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
      await new Promise(resolve => setTimeout(resolve, 100));
      onProgress?.('complete', STAGE_PROGRESS.complete);
      
      const wittyResponses = [
        "I appreciate your question, but I'm specialized in helping you discover beauty and personal care products! Think of me as your skincare and wellness guide.\n\nI can help you find products for specific needs—like a hand cream for dry hands, a shampoo for dandruff, or something with your favorite scent like lavender or shea butter. What would you like to explore?",
        "While I'd love to chat about that, I'm here to help you find the perfect beauty and personal care products from L'Occitane!\n\nWhether you're looking for something specific (like a serum, body lotion, or face cream), addressing a skin concern (dryness, sensitivity, aging), or exploring ingredients (shea butter, almond oil, immortelle), I'm here to help. What can I assist you with?",
      ];
      
      // Select response based on message length for variety
      const selectedResponse = input.message.length > 30 ? wittyResponses[1] : wittyResponses[0];
      
      return {
        replyText: selectedResponse,
        productCards: [],
        noExactMatch: true,
        route: 'SMALLTALK_OR_RANDOM',
      };
    }
  }
  
  // Step 2: Dialogue routing (LLM-first, no keyword enumeration)
  onProgress?.('routing', STAGE_PROGRESS.routing);
  
  // Get conversation state for router (to check pendingActions for yes/no mapping)
  let conversationStateForRouter: ConversationStateData | undefined;
  if (input.conversationState) {
    conversationStateForRouter = input.conversationState;
  } else if (input.merchantId && input.sessionId) {
    try {
      conversationStateForRouter = await getState(input.merchantId, input.sessionId);
    } catch (error) {
      logger.warn('handleLoccitaneQuery: failed to load conversation state for router', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Create default state
      conversationStateForRouter = {
        shownProductIds: [],
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions: [],
        memory: {},
      };
    }
  } else {
    // Create default state if none available
    conversationStateForRouter = {
      shownProductIds: [],
      lastRankedProductIds: [],
      lastRankCursor: 0,
      pendingActions: [],
      memory: {},
    };
  }
  
  // Get last assistant message from history for context
  const lastAssistantMessage = input.history
    ?.slice()
    .reverse()
    .find(msg => msg.role === 'assistant')?.content;
  
  // Use LLM-first router
  const routerInput: TurnRouterInput = {
    message: input.message,
    history: input.history,
    state: {
      pendingActions: conversationStateForRouter.pendingActions || [],
      shownProductIds: conversationStateForRouter.shownProductIds || [],
      lastRankedProductIds: conversationStateForRouter.lastRankedProductIds || [],
      memory: conversationStateForRouter.memory || {},
    },
    merchant: {
      brandName: input.merchantData?.brandName,
      datasetContext: input.merchantData?.datasetContext,
    },
    productContextId: input.productContextId,
    lastAssistantMessage,
    lastConstraints: input.lastConstraints || null, // Pass previous constraints for REFINE routing
  };
  
  const routerResult = await routeTurnLLMFirst(routerInput);
  
  logger.debug('handleLoccitaneQuery: LLM-first router complete', {
    route: routerResult.route,
    confidence: routerResult.confidence,
    message: input.message.substring(0, 100),
  });
  
  // Handle routes that don't require discovery pipeline
  
  // SAFETY_BLOCK
  if (routerResult.route === 'SAFETY_BLOCK') {
    // Shouldn't happen since safety is checked first, but handle it
    logger.warn('handleLoccitaneQuery: router detected SAFETY_BLOCK after safety check passed', {
      message: input.message.substring(0, 100),
    });
    onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
    await new Promise(resolve => setTimeout(resolve, 100));
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: "I'm here to help you find beauty and skincare products. If you have questions about products, I'm happy to help!",
      productCards: [],
      noExactMatch: true,
      route: 'SAFETY_BLOCK',
    };
  }
  
  // ACTION - Execute action from router result
  if (routerResult.route === 'ACTION') {
    logger.debug('handleLoccitaneQuery: ACTION route', {
      action: routerResult.action,
      message: input.message.substring(0, 100),
    });
    
    // If router provided action.id, use it; otherwise infer from action.type
    if (routerResult.action?.id && conversationStateForRouter?.pendingActions) {
      const action = conversationStateForRouter.pendingActions.find(a => a.id === routerResult.action!.id);
      if (action && action.type === 'show_more' && input.merchantId && input.sessionId) {
        const actionResult = await handleActionRequest(input, 'show_more', conversationStateForRouter);
        if (actionResult) {
          return actionResult;
        }
      }
    } else if (routerResult.action?.type === 'show_more' && input.merchantId && input.sessionId) {
      const actionResult = await handleActionRequest(input, 'show_more', conversationStateForRouter);
      if (actionResult) {
        return actionResult;
      }
    }
    
    // Fall through to discovery for other actions
    logger.debug('handleLoccitaneQuery: ACTION falling through to discovery');
  }
  
  // YES_NO - Map yes/no to pending actions
  if (routerResult.route === 'YES_NO') {
    logger.debug('handleLoccitaneQuery: YES_NO route', {
      yesNo: routerResult.yesNo,
      pendingActionsCount: conversationStateForRouter?.pendingActions?.length || 0,
    });
    
    if (routerResult.yesNo === true && conversationStateForRouter?.pendingActions && conversationStateForRouter.pendingActions.length > 0) {
      const primaryAction = conversationStateForRouter.pendingActions[0];
      if (primaryAction.type === 'show_more' && input.merchantId && input.sessionId) {
        const actionResult = await handleActionRequest(input, 'show_more', conversationStateForRouter);
        if (actionResult) {
          return actionResult;
        }
      }
      // For other actions, use action label as message
      input.message = primaryAction.label || input.message;
    } else if (routerResult.yesNo === false && conversationStateForRouter?.pendingActions && conversationStateForRouter.pendingActions.length > 1) {
      const secondaryAction = conversationStateForRouter.pendingActions[1];
      if (secondaryAction.type !== 'show_more') {
        input.message = secondaryAction.label || input.message;
      } else {
        // User said no to show_more, ask clarifying question
        const microReply = await generateMicroReply(
          input.message,
          'AMBIGUOUS',
          {
            brandName: input.merchantData?.brandName,
            datasetContext: input.merchantData?.datasetContext,
            faq: input.merchantData?.faq,
          }
        );
        onProgress?.('complete', STAGE_PROGRESS.complete);
        return {
          replyText: microReply.replyText,
          productCards: [],
          noExactMatch: true,
          actions: microReply.actions,
          route: 'YES_NO',
        };
      }
    } else {
      // No pending actions or unclear - generate micro reply
      const microReply = await generateMicroReply(
        input.message,
        'AMBIGUOUS',
        {
          brandName: input.merchantData?.brandName,
          datasetContext: input.merchantData?.datasetContext,
          faq: input.merchantData?.faq,
        }
      );
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: microReply.replyText,
        productCards: [],
        noExactMatch: true,
        actions: microReply.actions,
        route: 'YES_NO',
      };
    }
    
    // Fall through to discovery if we modified input.message
  }
  
  // BRAND_INFO - Use micro reply generator
  if (routerResult.route === 'BRAND_INFO') {
    logger.debug('handleLoccitaneQuery: BRAND_INFO route', {
      message: input.message.substring(0, 100),
    });
    
    onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
    
    const microReply = await generateMicroReply(
      input.message,
      'BRAND_INFO',
      {
        brandName: input.merchantData?.brandName,
        voiceInstructions: input.merchantData?.voiceInstructions,
        datasetContext: input.merchantData?.datasetContext,
        faq: input.merchantData?.faq,
      },
      input.productContextId
    );
    
    // Save actions to pending
    if (microReply.actions && microReply.actions.length > 0 && input.merchantId && input.sessionId) {
      await setPendingActions(input.merchantId, input.sessionId, microReply.actions);
    }
    
    onProgress?.('complete', STAGE_PROGRESS.complete);
    
    return {
      replyText: microReply.replyText,
      productCards: [],
      noExactMatch: true,
      actions: microReply.actions,
      route: 'BRAND_INFO',
    };
  }
  
  // UNRELATED - Use micro reply generator
  if (routerResult.route === 'UNRELATED') {
    logger.debug('handleLoccitaneQuery: UNRELATED route', {
      message: input.message.substring(0, 100),
    });
    
    onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
    
    const microReply = await generateMicroReply(
      input.message,
      'UNRELATED',
      {
        brandName: input.merchantData?.brandName,
        voiceInstructions: input.merchantData?.voiceInstructions,
        datasetContext: input.merchantData?.datasetContext,
        faq: input.merchantData?.faq,
      }
    );
    
    // Save actions to pending
    if (microReply.actions && microReply.actions.length > 0 && input.merchantId && input.sessionId) {
      await setPendingActions(input.merchantId, input.sessionId, microReply.actions);
    }
    
    onProgress?.('complete', STAGE_PROGRESS.complete);
    
    return {
      replyText: microReply.replyText,
      productCards: [],
      noExactMatch: true,
      actions: microReply.actions,
      route: 'UNRELATED',
    };
  }
  
  // AMBIGUOUS - Use clarification from router or generate micro reply
  if (routerResult.route === 'AMBIGUOUS') {
    logger.debug('handleLoccitaneQuery: AMBIGUOUS route', {
      message: input.message.substring(0, 100),
      hasClarification: !!routerResult.clarification,
    });
    
    onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
    
    if (routerResult.clarification) {
      // Use router-provided clarification
      const actions = routerResult.clarification.actions || [];
      if (actions.length > 0 && input.merchantId && input.sessionId) {
        await setPendingActions(input.merchantId, input.sessionId, actions);
      }
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: routerResult.clarification.text,
        productCards: [],
        noExactMatch: true,
        actions: actions.length > 0 ? (actions as ActionProposal[]) : undefined,
        route: 'AMBIGUOUS',
      };
    } else {
      // Generate micro reply as fallback
      const microReply = await generateMicroReply(
        input.message,
        'AMBIGUOUS',
        {
          brandName: input.merchantData?.brandName,
          datasetContext: input.merchantData?.datasetContext,
          faq: input.merchantData?.faq,
        }
      );
      if (microReply.actions && microReply.actions.length > 0 && input.merchantId && input.sessionId) {
        await setPendingActions(input.merchantId, input.sessionId, microReply.actions);
      }
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: microReply.replyText,
        productCards: [],
        noExactMatch: true,
        actions: microReply.actions,
        route: 'AMBIGUOUS',
      };
    }
  }
  
  // Legacy route handlers removed - new LLM-first router uses ACTION, YES_NO, BRAND_INFO, UNRELATED instead
  
  // Step 3: Load product context if provided (for product-specific queries)
  // This must happen BEFORE classification so we can use isProductSpecificQuery
  let productContextProduct: ProductWithLoccitaneAttributes | null = null;
  let isProductSpecificQuery = false;
  if (input.productContextId) {
    // Use Q&A-specific progress stage for product-specific queries
    onProgress?.('loading_product', STAGE_PROGRESS.loading_product);
    const contextProducts = await loadLoccitaneProducts([input.productContextId], input.merchantId);
    if (contextProducts.length > 0) {
      productContextProduct = contextProducts[0];
      isProductSpecificQuery = true;
      logger.debug('handleLoccitaneQuery: product context loaded - product-specific query', {
        productId: input.productContextId,
        productTitle: productContextProduct.title,
      });
    } else {
      logger.warn('handleLoccitaneQuery: product context not found', {
        productId: input.productContextId,
      });
    }
  }
  
  // Step 4: Query classification (only for DISCOVERY, REFINE, PDP_QA, and ACTION routes that need discovery)
  // Skip classification for routes that don't need it (already handled above)
  if (routerResult.route !== 'DISCOVERY' && routerResult.route !== 'REFINE' && routerResult.route !== 'PDP_QA' && routerResult.route !== 'ACTION' && routerResult.route !== 'YES_NO') {
    // Should not reach here, but handle gracefully
    logger.warn('handleLoccitaneQuery: unexpected route requiring classification', {
      route: routerResult.route,
      message: input.message.substring(0, 100),
    });
    onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "I'm here to help you find beauty and skincare products. What would you like to explore?",
        productCards: [],
        noExactMatch: true,
        route: routerResult.route,
      };
  }
  
  // For product-specific queries, skip classification and use a simple classification
  const classifyStart = Date.now();
  let classification: QueryClassification;
  
  if (isProductSpecificQuery && productContextProduct) {
    // For product-specific queries, skip classification and move to analyzing
    classification = {
      type: 'direct_product_search' as const,
      constraints: {},
    };
    // Move to analyzing stage (processing product information)
    onProgress?.('analyzing', STAGE_PROGRESS.analyzing);
    logger.debug('handleLoccitaneQuery: product-specific query - using simplified classification', {
      productId: input.productContextId,
      message: input.message,
    });
  } else {
    // Normal classification for discovery queries
    onProgress?.('classifying', STAGE_PROGRESS.classifying);
    classification = await classifyQuery(input.message, input.history);
  }
  const classifyDuration = Date.now() - classifyStart;
  
  // Extract size constraint - preserve from previous constraints unless being replaced
  let sizeConstraint: string | undefined;
  
  // Preserve size from previous constraints if available
  // Note: size is not in QueryClassification['constraints'] type, but we store it in resolvedClassificationConstraints
  const previousConstraintsWithSize = input.lastClassificationConstraints as (typeof input.lastClassificationConstraints & { size?: string }) | null;
  if (previousConstraintsWithSize?.size) {
    sizeConstraint = previousConstraintsWithSize.size;
  }
  
  // Check if refinePatch indicates replacement BEFORE merging previous constraints
  const refinePatchWillReplace = routerResult.route === 'REFINE' && routerResult.refinePatch?.replace === true;
  const refinePatchConstraints = routerResult.route === 'REFINE' && routerResult.refinePatch ? {
    productTypes: routerResult.refinePatch.productTypes,
    ingredients: routerResult.refinePatch.ingredients,
    concerns: routerResult.refinePatch.concerns,
    collections: routerResult.refinePatch.collections,
    applicationAreas: routerResult.refinePatch.applicationAreas,
    skinTypes: routerResult.refinePatch.skinTypes,
    hairTypes: routerResult.refinePatch.hairTypes,
    ageGroups: routerResult.refinePatch.ageGroups,
    genders: routerResult.refinePatch.genders,
    madeWithout: routerResult.refinePatch.madeWithout,
    size: routerResult.refinePatch.size,
  } : {};
  
  // Merge lastConstraints with new classification for REFINE routes
  // Also handle ACTION/YES_NO routes that have lastConstraints (might be refinements routed incorrectly)
  // IMPORTANT: If refinePatch has replace=true for a constraint type, DON'T merge previous values for that type
  const shouldMergeConstraints = (routerResult.route === 'REFINE' || 
    ((routerResult.route === 'ACTION' || routerResult.route === 'YES_NO') && (input.lastConstraints || input.lastClassificationConstraints))) && 
    (input.lastConstraints || input.lastClassificationConstraints);
  
  if (shouldMergeConstraints) {
    // Merge previous constraints with new classification constraints
    const previousSearch = input.lastConstraints;
    const previousClassification = input.lastClassificationConstraints;
    
    // Merge productTypes from SearchConstraints
    // Skip if refinePatch will replace productTypes
    if (previousSearch?.productTypes && !(refinePatchWillReplace && refinePatchConstraints.productTypes)) {
      if (!classification.constraints.productTypes?.length) {
        classification.constraints.productTypes = previousSearch.productTypes;
      } else {
        // Combine, deduplicate
        const combined = [...new Set([...previousSearch.productTypes, ...classification.constraints.productTypes])];
        classification.constraints.productTypes = combined;
      }
    }
    
    // Merge classification-level constraints from previous classification
    // CRITICAL: Preserve ALL constraint types unless they're explicitly being replaced by refinePatch
    // This ensures follow-up queries only modify what's mentioned, preserving everything else
    if (previousClassification) {
      // Helper function to preserve array constraint type from previous classification
      // CRITICAL: Normalize preserved values to handle misspellings (e.g., "lavendar" -> "lavender_oil")
      const preserveArrayConstraint = (
        key: keyof QueryClassification['constraints'],
        refinePatchKey?: keyof typeof refinePatchConstraints,
        normalizeFn?: (value: string) => string
      ) => {
        const previousValues = (previousClassification as any)[key] as string[] | undefined;
        // Use hasOwnProperty to check if refinePatch explicitly mentions this constraint (even if empty array)
        // This is critical: empty array [] is falsy but still means "clear this constraint" when replace: true
        const refinePatchMentionsThis = refinePatchKey && Object.prototype.hasOwnProperty.call(refinePatchConstraints, refinePatchKey);
        const refinePatchWillReplaceThis = refinePatchWillReplace && refinePatchMentionsThis;
        
        // Only preserve if:
        // 1. Previous has values
        // 2. NOT being replaced by refinePatch (or refinePatch doesn't mention this constraint type)
        if (previousValues?.length && !refinePatchWillReplaceThis) {
          // Normalize preserved values if normalization function provided
          // This handles cases where previous values might have misspellings
          const normalizedPreviousValues = normalizeFn 
            ? previousValues.map(normalizeFn).filter(Boolean)
            : previousValues;
          
          if (normalizedPreviousValues.length === 0) return; // All values filtered out after normalization
          
          const currentValues = (classification.constraints as any)[key] as string[] | undefined;
          if (!currentValues?.length) {
            // No current values, preserve normalized previous
            (classification.constraints as any)[key] = normalizedPreviousValues;
          } else {
            // Combine and deduplicate (normalize current values too if needed)
            const normalizedCurrentValues = normalizeFn 
              ? currentValues.map(normalizeFn).filter(Boolean)
              : currentValues;
            const combined = [...normalizedPreviousValues, ...normalizedCurrentValues];
            (classification.constraints as any)[key] = [...new Set(combined)];
          }
        }
      };
      
      // Preserve all constraint types unless being replaced
      // IMPORTANT: Normalize ingredients to handle misspellings when preserving from previous queries
      preserveArrayConstraint('collections', 'collections');
      preserveArrayConstraint('concerns', 'concerns');
      preserveArrayConstraint('applicationAreas', 'applicationAreas');
      preserveArrayConstraint('skinTypes', 'skinTypes');
      preserveArrayConstraint('hairTypes', 'hairTypes');
      preserveArrayConstraint('mustHaveIngredients', 'ingredients', normalizeIngredientCanonical);
      preserveArrayConstraint('madeWithout', 'madeWithout', normalizeIngredientCanonical);
      preserveArrayConstraint('ageGroups', 'ageGroups');
      preserveArrayConstraint('genders', 'genders');
      
      // Preserve size constraint (stored separately, not in QueryClassification['constraints'])
      const previousConstraintsWithSize = previousClassification as (typeof previousClassification & { size?: string });
      if (previousConstraintsWithSize.size && !(refinePatchWillReplace && refinePatchConstraints.size)) {
        // Size was already preserved at the top of the function, but we ensure it's not overridden here
        // (sizeConstraint variable is set earlier)
      }
      
      // Preserve price constraints (unless being replaced by refinePatch)
      if (!(routerResult.route === 'REFINE' && routerResult.refinePatch && 
            (routerResult.refinePatch.priceMaxCents !== undefined || routerResult.refinePatch.priceMinCents !== undefined))) {
        if (!classification.constraints.priceMaxCents && previousClassification.priceMaxCents) {
          classification.constraints.priceMaxCents = previousClassification.priceMaxCents;
        }
        if (!classification.constraints.priceMinCents && previousClassification.priceMinCents) {
          classification.constraints.priceMinCents = previousClassification.priceMinCents;
        }
      }
    }
    
    // Also preserve price from previousSearch (SearchConstraints) if not in refinePatch or new classification
    // This is handled above for previousClassification, but also check previousSearch for completeness
    if (previousSearch && !(routerResult.route === 'REFINE' && routerResult.refinePatch && (routerResult.refinePatch.priceMaxCents !== undefined || routerResult.refinePatch.priceMinCents !== undefined))) {
      if (!classification.constraints.priceMaxCents && previousSearch.priceMaxCents) {
        classification.constraints.priceMaxCents = previousSearch.priceMaxCents;
      }
      if (!classification.constraints.priceMinCents && previousSearch.priceMinCents) {
        classification.constraints.priceMinCents = previousSearch.priceMinCents;
      }
    }
    
    logger.debug('handleLoccitaneQuery: merged lastConstraints with classification', {
      previousSearchConstraints: {
        productTypes: previousSearch?.productTypes,
        priceMaxCents: previousSearch?.priceMaxCents,
        priceMinCents: previousSearch?.priceMinCents,
      },
      previousClassificationConstraints: {
        collections: previousClassification?.collections,
        concerns: previousClassification?.concerns,
        applicationAreas: previousClassification?.applicationAreas,
        skinTypes: previousClassification?.skinTypes,
        hairTypes: previousClassification?.hairTypes,
        mustHaveIngredients: previousClassification?.mustHaveIngredients,
        madeWithout: previousClassification?.madeWithout,
        ageGroups: previousClassification?.ageGroups,
        genders: previousClassification?.genders,
        priceMaxCents: previousClassification?.priceMaxCents,
        priceMinCents: previousClassification?.priceMinCents,
        size: (previousClassification as any)?.size,
      },
      refinePatchWillReplace,
      refinePatchConstraints,
      mergedConstraints: {
        productTypes: classification.constraints.productTypes,
        collections: classification.constraints.collections,
        concerns: classification.constraints.concerns,
        applicationAreas: classification.constraints.applicationAreas,
        skinTypes: classification.constraints.skinTypes,
        hairTypes: classification.constraints.hairTypes,
        mustHaveIngredients: classification.constraints.mustHaveIngredients,
        madeWithout: classification.constraints.madeWithout,
        ageGroups: classification.constraints.ageGroups,
        genders: classification.constraints.genders,
        priceMaxCents: classification.constraints.priceMaxCents,
        priceMinCents: classification.constraints.priceMinCents,
        size: sizeConstraint,
      },
    });
  }
  
  // Merge refinePatch from router if route is REFINE
  // IMPORTANT: refinePatch takes precedence over classification constraints since it's the router's explicit interpretation
  if (routerResult.route === 'REFINE' && routerResult.refinePatch) {
    const patch = routerResult.refinePatch;
    const shouldReplace = patch.replace === true;
    
    // Extract size constraint (e.g., "travel", "2.1 fl oz", "small")
    // If refinePatch has size, use it (respects replace flag - if replace: true, overwrites; if false, adds)
    // But since size is typically additive (e.g., "travel size" adds to existing search), we use the patch value
    if (patch.size !== undefined) {
      if (shouldReplace && patch.size) {
        // Replace: use new size (even if empty string, clear the constraint)
        sizeConstraint = patch.size ? String(patch.size).toLowerCase() : undefined;
      } else if (patch.size) {
        // Add: use new size (refinement adds size constraint, but doesn't replace existing if present)
        // In practice, we'll use the new size value since size refinements typically replace (e.g., "travel size" is the new size)
        sizeConstraint = String(patch.size).toLowerCase();
      }
      // If patch.size is explicitly empty/null and replace: true, clear sizeConstraint (already handled above)
    }
    
    // Merge price constraints (always replace price - it's a refinement)
    if (patch.priceMaxCents !== undefined) {
      classification.constraints.priceMaxCents = patch.priceMaxCents;
    }
    if (patch.priceMinCents !== undefined) {
      classification.constraints.priceMinCents = patch.priceMinCents;
    }
    
    // Helper function to merge array constraints (add or replace)
    // refinePatch takes precedence: if refinePatch specifies a constraint, use it (overwrites classification)
    // CRITICAL: Normalize refinePatch values before using them to handle misspellings and variations
    const mergeArrayConstraint = (
      key: keyof QueryClassification['constraints'],
      patchValues: string[] | undefined,
      normalizeFn?: (value: string) => string
    ) => {
      // Handle undefined (not specified in patch) - don't modify constraint
      if (patchValues === undefined) return;
      
      // CRITICAL: Empty array with replace: true means CLEAR the constraint
      // This handles cases like "no need to be specific to lavendar" -> ingredients: [] with replace: true
      if (shouldReplace && patchValues.length === 0) {
        (classification.constraints as any)[key] = undefined;
        return;
      }
      
      // Skip empty arrays when replace: false (don't apply empty additions)
      if (!shouldReplace && patchValues.length === 0) return;
      
      // Normalize patch values if normalization function provided
      // This handles misspellings (e.g., "lavendar" -> "lavender_oil") and variations
      const normalizedPatchValues = normalizeFn 
        ? patchValues.map(normalizeFn).filter(Boolean)
        : patchValues;
      
      // If all values filtered out after normalization and replace: true, clear constraint
      if (shouldReplace && normalizedPatchValues.length === 0) {
        (classification.constraints as any)[key] = undefined;
        return;
      }
      
      // Skip if all normalized values filtered out and replace: false
      if (!shouldReplace && normalizedPatchValues.length === 0) return;
      
      if (shouldReplace) {
        // Replace: use only normalized refinePatch values (router's interpretation overrides classification)
        // This ensures router's intent takes precedence over classification's extraction
        (classification.constraints as any)[key] = normalizedPatchValues;
      } else {
        // Add: combine normalized refinePatch with existing (classification may have extracted same values - deduplicate)
        // Normalize and deduplicate to avoid issues with different representations (e.g., "lavender" vs "lavender_oil")
        const existing = (classification.constraints as any)[key] || [];
        const combined = [...existing, ...normalizedPatchValues];
        // Deduplicate by normalizing values (basic deduplication - more sophisticated normalization happens later)
        (classification.constraints as any)[key] = [...new Set(combined)];
      }
    };
    
    // Merge all constraint types that are present in refinePatch
    // CRITICAL: Only constraints mentioned in refinePatch are affected
    // All other constraints are preserved from previous queries (handled in merge step above)
    // IMPORTANT: Normalize ALL constraint types using canonical maps to handle misspellings intelligently
    // This ensures "lavendar" -> "lavender_oil", "face creme" -> "face_moisturizer", "dry skin" -> "dryness", etc.
    mergeArrayConstraint('productTypes', patch.productTypes, normalizeProductType);
    mergeArrayConstraint('concerns', patch.concerns, normalizeConcernCanonical);
    mergeArrayConstraint('mustHaveIngredients', patch.ingredients, normalizeIngredientCanonical);
    mergeArrayConstraint('madeWithout', patch.madeWithout, normalizeIngredientCanonical);
    mergeArrayConstraint('collections', patch.collections);
    mergeArrayConstraint('applicationAreas', patch.applicationAreas);
    mergeArrayConstraint('skinTypes', patch.skinTypes);
    mergeArrayConstraint('hairTypes', patch.hairTypes);
    mergeArrayConstraint('ageGroups', patch.ageGroups);
    mergeArrayConstraint('genders', patch.genders);
    
    logger.debug('handleLoccitaneQuery: merged refinePatch from router', {
      refinePatch: patch,
      sizeConstraint,
      shouldReplace,
    });
  }
  
  // Also merge refinePatch for legacy FOLLOWUP_REFINE (backward compatibility)
  const legacyRoute = mapNewRouteToLegacy(routerResult.route);
  if (legacyRoute === 'FOLLOWUP_REFINE' && (routerResult as any).refinePatch) {
    const patch = (routerResult as any).refinePatch;
    if (patch.priceMaxCents !== undefined) {
      classification.constraints.priceMaxCents = patch.priceMaxCents;
    }
    if (patch.priceMinCents !== undefined) {
      classification.constraints.priceMinCents = patch.priceMinCents;
    }
  }
  
  logger.debug('handleLoccitaneQuery: classification complete', {
    query: input.message.substring(0, 100),
    type: classification.type,
    route: routerResult.route,
    constraints: {
      concerns: classification.constraints.concerns,
      skinTypes: classification.constraints.skinTypes,
      applicationAreas: classification.constraints.applicationAreas,
      productTypes: classification.constraints.productTypes,
      ingredients: classification.constraints.mustHaveIngredients,
      madeWithout: classification.constraints.madeWithout,
      collections: classification.constraints.collections,
      priceMaxCents: classification.constraints.priceMaxCents,
      priceMinCents: classification.constraints.priceMinCents,
    },
    constraintsKeys: Object.keys(classification.constraints).filter(
      key => {
        const value = classification.constraints[key as keyof typeof classification.constraints];
        return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
      }
    ),
  });
  
  // Auto-select search method based on query characteristics if not provided
  const autoSelectSearchMethod = (
    query: string,
    classification: QueryClassification
  ): { lexical: boolean; semantic: boolean; concept: boolean } => {
    const queryLength = query.trim().length;
    const queryWords = query.trim().split(/\s+/).length;
    
    // Count total constraints
    const constraintCount = 
      (classification.constraints.concerns?.length || 0) +
      (classification.constraints.skinTypes?.length || 0) +
      (classification.constraints.hairTypes?.length || 0) +
      (classification.constraints.applicationAreas?.length || 0) +
      (classification.constraints.productTypes?.length || 0) +
      (classification.constraints.collections?.length || 0) +
      (classification.constraints.mustHaveIngredients?.length || 0) +
      (classification.constraints.avoidIngredients?.length || 0) +
      (classification.constraints.madeWithout?.length || 0) +
      (classification.constraints.ageGroups?.length || 0) +
      (classification.constraints.genders?.length || 0) +
      (classification.constraints.priceMinCents ? 1 : 0) +
      (classification.constraints.priceMaxCents ? 1 : 0);
    
    // Default to fast mode (semantic + concept), only use advanced for truly complex queries
    // Use advanced mode (all methods) for:
    // 1. Very complex queries (very long or many words)
    // 2. Vague/gift queries (need broader search)
    // 3. Many constraints (5+ indicates complex multi-faceted query)
    // 4. Symptom/concern queries (may need lexical for exact matches)
    // 5. Price range queries (complex filtering)
    const useAdvanced = 
      queryLength > 80 ||                    // Very long queries (was 50)
      queryWords > 12 ||                      // Many words (was 8)
      classification.type === 'gift_or_vague' || // Vague queries need all methods
      classification.type === 'symptom_concern' || // Symptom queries may need lexical
      constraintCount >= 5 ||                 // Many constraints (was 3) - only for complex multi-faceted queries
      (classification.constraints.priceMinCents && classification.constraints.priceMaxCents); // Price range
    
    if (useAdvanced) {
      return { lexical: true, semantic: true, concept: true };
    } else {
      // Fast mode: semantic + concept (skip lexical for speed)
      return { lexical: false, semantic: true, concept: true };
    }
  };
  
  if (classification.type === 'unrelated') {
    logger.debug('handleLoccitaneQuery: unrelated query', {
      message: input.message.substring(0, 100),
      classifyDuration,
    });
    
    // Generate a witty, smart response that redirects to beauty/personal care
    // Create engaging responses that pivot to beauty products
    const wittyResponses = [
      "I appreciate your question, but I'm specialized in helping you discover beauty and personal care products! Think of me as your skincare and wellness guide.\n\nI can help you find products for specific needs—like a hand cream for dry hands, a shampoo for dandruff, or something with your favorite scent like lavender or shea butter. What would you like to explore?",
      "While I'd love to chat about that, I'm here to help you find the perfect beauty and personal care products from L'Occitane!\n\nWhether you're looking for something specific (like a serum, body lotion, or face cream), addressing a skin concern (dryness, sensitivity, aging), or exploring ingredients (shea butter, almond oil, immortelle), I'm here to help. What can I assist you with?",
      "That's interesting! I'm actually focused on helping you discover beauty and personal care products that suit your needs.\n\nI can help with:\n• Specific products (hand creams, shampoos, body oils, serums)\n• Skin or hair concerns (dryness, dandruff, sensitive skin)\n• Ingredient preferences (shea butter, lavender, almond oil)\n\nWhat would you like to explore today?",
    ];
    
    // Select a response based on message content for variety
    const messageLower = input.message.toLowerCase();
    let selectedResponse = wittyResponses[0]; // Default
    
    // Slightly customize based on message tone
    if (messageLower.includes('what') || messageLower.includes('how') || messageLower.includes('why')) {
      selectedResponse = wittyResponses[1];
    } else if (messageLower.length > 20) {
      selectedResponse = wittyResponses[2];
    }
    
    onProgress?.('handling_unrelated', STAGE_PROGRESS.handling_unrelated);
    await new Promise(resolve => setTimeout(resolve, 100));
    onProgress?.('complete', STAGE_PROGRESS.complete);
    
    return {
      replyText: selectedResponse,
      productCards: [],
      noExactMatch: true,
    };
  }
  
  // Step 5: Multi-view retrieval (SKIP for product-specific queries)
  let retrievalResult: Awaited<ReturnType<typeof multiViewRetrieval>>;
  let retrievalDuration = 0;
  
  if (isProductSpecificQuery && productContextProduct) {
    // For product-specific queries, skip retrieval and use empty results
    // We'll use only the product context product
    logger.debug('handleLoccitaneQuery: skipping retrieval for product-specific query', {
      productId: input.productContextId,
    });
    retrievalResult = {
      candidateIds: [productContextProduct.id],
      lexicalScores: new Map([[productContextProduct.id, 1.0]]),
      semanticScores: new Map([[productContextProduct.id, 1.0]]),
      conceptMatches: new Map(),
    };
    retrievalDuration = 0;
  } else {
    // Normal retrieval for discovery queries
    onProgress?.('retrieving', STAGE_PROGRESS.retrieving);
    const retrievalStart = Date.now();
    // Validate and use frontend-provided searchMethods, or default to fast mode if not provided
    // No auto-selection - purely user choice. Frontend should always send based on user's selection.
    let searchMethodsToUse: { lexical: boolean; semantic: boolean; concept: boolean };
    if (
      input.searchMethods !== undefined &&
      input.searchMethods !== null &&
      typeof input.searchMethods === 'object' &&
      typeof input.searchMethods.lexical === 'boolean' &&
      typeof input.searchMethods.semantic === 'boolean' &&
      typeof input.searchMethods.concept === 'boolean'
    ) {
      // Use frontend preference (user's choice) - validated
      searchMethodsToUse = input.searchMethods;
    } else {
      // Default to fast mode if not provided or invalid
      searchMethodsToUse = { lexical: false, semantic: true, concept: true };
      if (input.searchMethods !== undefined && input.searchMethods !== null) {
        logger.warn('handleLoccitaneQuery: invalid searchMethods received', {
          received: input.searchMethods,
          defaultingTo: searchMethodsToUse,
        });
      }
    }
    logger.debug('handleLoccitaneQuery: using searchMethods', {
      received: input.searchMethods,
      isValid: input.searchMethods !== undefined && input.searchMethods !== null && typeof input.searchMethods === 'object',
      isDefault: input.searchMethods === undefined || input.searchMethods === null,
      applied: searchMethodsToUse,
      lexical: searchMethodsToUse.lexical,
      semantic: searchMethodsToUse.semantic,
      concept: searchMethodsToUse.concept,
      queryLength: input.message.length,
      queryWords: input.message.trim().split(/\s+/).length,
      queryType: classification.type,
    });
    retrievalResult = await multiViewRetrieval(
      input.message,
      classification,
      input.merchantId,
      searchMethodsToUse
    );
    retrievalDuration = Date.now() - retrievalStart;
  }
  
  logger.debug('handleLoccitaneQuery: retrieval complete', {
    candidateCount: retrievalResult.candidateIds.length,
    lexicalCount: retrievalResult.lexicalScores.size,
    semanticCount: retrievalResult.semanticScores.size,
    retrievalDuration,
  });
  
  // Step 6: Load full product objects (filter for L'Occitane products with structured attributes)
  // Progress update is part of retrieving stage
  const loadStart = Date.now();
  let candidateProducts: ProductWithLoccitaneAttributes[];
  let filteredProducts: ProductWithLoccitaneAttributes[];
  
  if (isProductSpecificQuery && productContextProduct) {
    // For product-specific queries, use only the product context product
    candidateProducts = [productContextProduct];
    filteredProducts = [productContextProduct];
    logger.debug('handleLoccitaneQuery: using product context only (product-specific query)', {
      productId: productContextProduct.id,
    });
  } else {
    // Normal flow: load products from retrieval results
    // OPTIMIZATION: Only load top candidates to reduce database load time
    // We only need ~20 products for ranking (top 4 shown, top 20 stored for "show more"),
    // but load 35 to account for filtering (size, productType, etc.) and previously shown products
    // Reduced from 48 to 35 - parallel batch loading is faster, so we can load fewer products
    const MAX_PRODUCTS_TO_LOAD = 35;
    
    // If constraints are specified, prioritize concept search results that match ALL constraints (intersection)
    // This ensures we get products that match all criteria (e.g., lavender AND hand cream)
    const requestedProductTypes = classification.constraints.productTypes ?? [];
    const requestedIngredients = classification.constraints.mustHaveIngredients ?? [];
    const requestedCollections = classification.constraints.collections ?? [];
    const hasMultipleConstraints = (requestedProductTypes.length > 0 ? 1 : 0) + 
                                   (requestedIngredients.length > 0 ? 1 : 0) + 
                                   (requestedCollections.length > 0 ? 1 : 0) > 1;
    
    let candidateIdsToLoad: string[];
    
    if (retrievalResult.conceptMatches && retrievalResult.conceptMatches.size > 0) {
      // Collect constraint values we're looking for (normalized for comparison)
      const normalizedRequestedTypes = requestedProductTypes.map(normalizeProductType);
      const normalizedRequestedIngredients = requestedIngredients.map(normalizeIngredient);
      const normalizedRequestedCollections = requestedCollections.map(col => col.toLowerCase().trim());
      
      // Find products that match ALL specified constraints (intersection)
      // If we have multiple constraints, find intersection; otherwise use union
      // Group matches by constraint type to enable proper intersection logic
      const matchesByType: {
        productTypes: Set<string>[];
        ingredients: Set<string>[];
        collections: Set<string>[];
      } = {
        productTypes: [],
        ingredients: [],
        collections: [],
      };
      
      for (const [constraintValue, productIds] of retrievalResult.conceptMatches.entries()) {
        // Check productType matches
        if (normalizedRequestedTypes.length > 0) {
          const normalizedConstraintPT = normalizeProductType(constraintValue);
          if (normalizedRequestedTypes.some(reqType => 
            normalizedConstraintPT === reqType || 
            normalizedConstraintPT.includes(reqType) ||
            reqType.includes(normalizedConstraintPT)
          )) {
            matchesByType.productTypes.push(productIds);
          }
        }
        
        // Check ingredient matches (use normalizeIngredient to handle canonical forms like "lavender" -> "lavender_oil")
        if (normalizedRequestedIngredients.length > 0) {
          const normalizedConstraintIng = normalizeIngredient(constraintValue);
          if (normalizedRequestedIngredients.some(reqIng => 
            normalizedConstraintIng === reqIng || 
            normalizedConstraintIng.includes(reqIng) ||
            reqIng.includes(normalizedConstraintIng)
          )) {
            matchesByType.ingredients.push(productIds);
          }
        }
        
        // Check collection matches
        if (normalizedRequestedCollections.length > 0) {
          const normalizedConstraintCol = constraintValue.toLowerCase().trim();
          if (normalizedRequestedCollections.some(reqCol => 
            normalizedConstraintCol === reqCol || 
            normalizedConstraintCol.includes(reqCol) ||
            reqCol.includes(normalizedConstraintCol)
          )) {
            matchesByType.collections.push(productIds);
          }
        }
      }
      
      // Build intersection across constraint types (products must match ALL types)
      // Within each type, use union (product matches if it matches ANY value of that type)
      let conceptMatchedIds = new Set<string>();
      
      // Collect all sets that need to be intersected (one per constraint type)
      const setsToIntersect: Set<string>[] = [];
      
      // For each constraint type, union all matches (product matches if it matches any value of that type)
      if (matchesByType.productTypes.length > 0) {
        const productTypeUnion = new Set<string>();
        for (const matchSet of matchesByType.productTypes) {
          for (const productId of matchSet) {
            productTypeUnion.add(productId);
          }
        }
        setsToIntersect.push(productTypeUnion);
      }
      
      if (matchesByType.ingredients.length > 0) {
        const ingredientUnion = new Set<string>();
        for (const matchSet of matchesByType.ingredients) {
          for (const productId of matchSet) {
            ingredientUnion.add(productId);
          }
        }
        setsToIntersect.push(ingredientUnion);
      }
      
      if (matchesByType.collections.length > 0) {
        const collectionUnion = new Set<string>();
        for (const matchSet of matchesByType.collections) {
          for (const productId of matchSet) {
            collectionUnion.add(productId);
          }
        }
        setsToIntersect.push(collectionUnion);
      }
      
      // Intersection: products must appear in ALL sets (match all constraint types)
      if (setsToIntersect.length > 0) {
        if (setsToIntersect.length === 1) {
          // Only one constraint type, use union directly
          conceptMatchedIds = setsToIntersect[0];
        } else {
          // Multiple constraint types: find intersection (products in ALL sets)
          const firstSet = setsToIntersect[0];
          for (const productId of firstSet) {
            if (setsToIntersect.every(set => set.has(productId))) {
              conceptMatchedIds.add(productId);
            }
          }
        }
      }
      
      // If we found concept matches, prioritize those
      if (conceptMatchedIds.size > 0) {
        const conceptArray = Array.from(conceptMatchedIds).slice(0, MAX_PRODUCTS_TO_LOAD);
        // Fill remaining slots from merged results if needed
        const mergedIds = retrievalResult.candidateIds.filter(id => !conceptMatchedIds.has(id));
        candidateIdsToLoad = [...conceptArray, ...mergedIds].slice(0, MAX_PRODUCTS_TO_LOAD);
        logger.debug('handleLoccitaneQuery: prioritizing concept search results with intersection', {
          requestedProductTypes,
          requestedIngredients,
          requestedCollections,
          hasMultipleConstraints,
          setsToIntersectCount: setsToIntersect.length,
          conceptMatchedCount: conceptMatchedIds.size,
          conceptIdsLoaded: conceptArray.length,
          totalLoaded: candidateIdsToLoad.length,
        });
      } else {
        candidateIdsToLoad = retrievalResult.candidateIds.slice(0, MAX_PRODUCTS_TO_LOAD);
      }
    } else {
      candidateIdsToLoad = retrievalResult.candidateIds.slice(0, MAX_PRODUCTS_TO_LOAD);
    }
    
    logger.debug('handleLoccitaneQuery: loading limited products', {
      totalCandidates: retrievalResult.candidateIds.length,
      loadingCount: candidateIdsToLoad.length,
      hasProductTypeConstraint: requestedProductTypes.length > 0,
    });
    
    candidateProducts = await loadLoccitaneProducts(
      candidateIdsToLoad,
      input.merchantId
    );
    
    // Exclude previously shown products
    filteredProducts = candidateProducts;
    if (input.lastShownProductIds && input.lastShownProductIds.length > 0) {
      filteredProducts = candidateProducts.filter(
        p => !input.lastShownProductIds!.includes(p.id)
      );
    }
  }
  const loadDuration = Date.now() - loadStart;
  
  // Step 4.5: Apply productType filter when productType constraints are present
  // This ensures relevant results even for symptom_concern, gift_or_vague, etc. when user specifies a product type
  const { type, constraints } = classification;
  const requestedProductTypes = constraints.productTypes ?? [];
  const originalCount = filteredProducts.length;
  
  if (requestedProductTypes.length > 0) {
    const normalizedRequestedTypes = requestedProductTypes.map(normalizeProductType);
    
    // Collect debug info for products that don't match
    const nonMatchingProducts: Array<{ id: string; productType: string | null; normalizedType: string }> = [];
    
    filteredProducts = filteredProducts.filter(product => {
      const attrs = product.attributes?.loccitaneStructured;
      const rawType = attrs?.productType ?? null;
      if (!rawType) {
        nonMatchingProducts.push({ id: product.id, productType: null, normalizedType: 'null' });
        return false;
      }
      
      const normalizedProductType = normalizeProductType(rawType);
      
      // Match if normalized product type matches any requested type
      const matches = normalizedRequestedTypes.some(reqType => 
        normalizedProductType === reqType || 
        normalizedProductType.includes(reqType) ||
        reqType.includes(normalizedProductType)
      );
      
      if (!matches) {
        nonMatchingProducts.push({ id: product.id, productType: rawType, normalizedType: normalizedProductType });
      }
      
      return matches;
    });
    
    // Fallback: if we filtered out everything, try to use concept search results
    // (concept search already filtered by productType, so those products should match)
    if (filteredProducts.length === 0) {
      logger.warn('handleLoccitaneQuery: productType filter removed all products, trying concept search fallback', {
        requestedProductTypes,
        normalizedRequestedTypes,
        originalCount,
        sampleNonMatching: nonMatchingProducts.slice(0, 5),
        totalNonMatching: nonMatchingProducts.length,
      });
      
      // Try to find products from concept search results that match ALL constraints (intersection)
      // Concept search already filtered correctly, so prioritize those IDs
      // Use the same improved intersection logic as above
      const conceptMatchedIds = new Set<string>();
      if (retrievalResult.conceptMatches) {
        const normalizedRequestedIngredients = (classification.constraints.mustHaveIngredients ?? []).map(normalizeIngredient);
        const normalizedRequestedCollections = (classification.constraints.collections ?? []).map(col => col.toLowerCase().trim());
        
        // Group matches by constraint type
        const matchesByType: {
          productTypes: Set<string>[];
          ingredients: Set<string>[];
          collections: Set<string>[];
        } = {
          productTypes: [],
          ingredients: [],
          collections: [],
        };
        
        for (const [constraintValue, productIds] of retrievalResult.conceptMatches.entries()) {
          // Check productType matches
          if (normalizedRequestedTypes.length > 0) {
            const normalizedConstraintPT = normalizeProductType(constraintValue);
            if (normalizedRequestedTypes.some(reqType => 
              normalizedConstraintPT === reqType || 
              normalizedConstraintPT.includes(reqType) ||
              reqType.includes(normalizedConstraintPT)
            )) {
              matchesByType.productTypes.push(productIds);
            }
          }
          
          // Check ingredient matches
          if (normalizedRequestedIngredients.length > 0) {
            const normalizedConstraintIng = normalizeIngredient(constraintValue);
            if (normalizedRequestedIngredients.some(reqIng => 
              normalizedConstraintIng === reqIng || 
              normalizedConstraintIng.includes(reqIng) ||
              reqIng.includes(normalizedConstraintIng)
            )) {
              matchesByType.ingredients.push(productIds);
            }
          }
          
          // Check collection matches
          if (normalizedRequestedCollections.length > 0) {
            const normalizedConstraintCol = constraintValue.toLowerCase().trim();
            if (normalizedRequestedCollections.some(reqCol => 
              normalizedConstraintCol === reqCol || 
              normalizedConstraintCol.includes(reqCol) ||
              reqCol.includes(normalizedConstraintCol)
            )) {
              matchesByType.collections.push(productIds);
            }
          }
        }
        
        // Build intersection: union within each type, intersect across types
        const setsToIntersect: Set<string>[] = [];
        
        if (matchesByType.productTypes.length > 0) {
          const productTypeUnion = new Set<string>();
          for (const matchSet of matchesByType.productTypes) {
            for (const productId of matchSet) {
              productTypeUnion.add(productId);
            }
          }
          setsToIntersect.push(productTypeUnion);
        }
        
        if (matchesByType.ingredients.length > 0) {
          const ingredientUnion = new Set<string>();
          for (const matchSet of matchesByType.ingredients) {
            for (const productId of matchSet) {
              ingredientUnion.add(productId);
            }
          }
          setsToIntersect.push(ingredientUnion);
        }
        
        if (matchesByType.collections.length > 0) {
          const collectionUnion = new Set<string>();
          for (const matchSet of matchesByType.collections) {
            for (const productId of matchSet) {
              collectionUnion.add(productId);
            }
          }
          setsToIntersect.push(collectionUnion);
        }
        
        // Intersection across constraint types
        if (setsToIntersect.length > 0) {
          if (setsToIntersect.length === 1) {
            // Single constraint type: use union directly
            for (const productId of setsToIntersect[0]) {
              conceptMatchedIds.add(productId);
            }
          } else {
            // Multiple constraint types: find intersection (products in ALL sets)
            const firstSet = setsToIntersect[0];
            for (const productId of firstSet) {
              if (setsToIntersect.every(set => set.has(productId))) {
                conceptMatchedIds.add(productId);
              }
            }
          }
        }
      }
      
      // If we found concept matches, load those products instead
      if (conceptMatchedIds.size > 0) {
        const conceptMatchedArray = Array.from(conceptMatchedIds).slice(0, 24);
        const conceptProducts = await loadLoccitaneProducts(conceptMatchedArray, input.merchantId);
        filteredProducts = conceptProducts.filter(
          p => !input.lastShownProductIds?.includes(p.id)
        );
        logger.debug('handleLoccitaneQuery: using concept search fallback products', {
          conceptMatchedCount: conceptMatchedIds.size,
          loadedCount: conceptProducts.length,
          filteredCount: filteredProducts.length,
        });
      } else {
        // Last resort: keep original filtered products (preserve ranking order)
        filteredProducts = candidateProducts.filter(
          p => !input.lastShownProductIds?.includes(p.id)
        ).slice(0, Math.min(originalCount, 12)); // Limit to avoid irrelevant results
      }
    } else {
      logger.debug('handleLoccitaneQuery: productType filter applied', {
        queryType: classification.type,
        requestedProductTypes,
        normalizedRequestedTypes,
        originalCount,
        filteredCount: filteredProducts.length,
      });
    }
  }
  
  // Step 4.6: Apply size filter when size constraint is present (e.g., "travel")
  // This filters products by checking if title/description contains the size keyword
  // CRITICAL: If size filter removes all products, skip it entirely to avoid overly restrictive filtering
  if (sizeConstraint) {
    const sizeFilterStartCount = filteredProducts.length;
    const normalizedSize = sizeConstraint.toLowerCase().trim();
    
    // Keywords that indicate travel/small size products
    const travelSizeKeywords = ['travel', 'mini', 'miniature', 'trial', 'sample', 'small size', 'small'];
    const isTravelSize = travelSizeKeywords.some(keyword => normalizedSize.includes(keyword) || keyword.includes(normalizedSize));
    
    if (isTravelSize) {
      // Filter to products that mention travel/mini/small in title or description
      const filteredWithSize = filteredProducts.filter(product => {
        const title = (product.title || '').toLowerCase();
        const description = (product.description || '').toLowerCase();
        
        // Check if title or description contains travel/small size indicators
        const hasTravelKeyword = travelSizeKeywords.some(keyword => 
          title.includes(keyword) || description.includes(keyword)
        );
        
        return hasTravelKeyword;
      });
      
      // Only apply size filter if it doesn't remove all products
      // This prevents overly restrictive filtering that would eliminate valid results
      if (filteredWithSize.length > 0) {
        filteredProducts = filteredWithSize;
        logger.debug('handleLoccitaneQuery: size filter applied (travel/small)', {
          sizeConstraint,
          beforeCount: sizeFilterStartCount,
          afterCount: filteredProducts.length,
        });
      } else {
        // Size filter would remove all products - skip it to get more results
        logger.debug('handleLoccitaneQuery: size filter skipped (would remove all products)', {
          sizeConstraint,
          wouldRemoveCount: sizeFilterStartCount,
        });
      }
    } else {
      // Handle volume-based sizes (e.g., "2.1 fl oz")
      // Check if title or description contains the size value
      const filteredWithSize = filteredProducts.filter(product => {
        const title = (product.title || '').toLowerCase();
        const description = (product.description || '').toLowerCase();
        const searchText = `${title} ${description}`;
        
        // For volume-based sizes (e.g., "2.1 fl oz"), check for the numeric value and volume unit
        // Normalize the size constraint to handle variations like "2.1 fl oz", "2.1fl oz", "2.1floz"
        const normalizedSizePattern = normalizedSize.replace(/\s+/g, '\\s*'); // Replace spaces with optional whitespace regex
        const escapedPattern = normalizedSizePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special regex chars
        const regex = new RegExp(escapedPattern, 'i');
        
        return regex.test(searchText);
      });
      
      // Only apply size filter if it doesn't remove all products
      if (filteredWithSize.length > 0) {
        filteredProducts = filteredWithSize;
        logger.debug('handleLoccitaneQuery: size filter applied (volume/other)', {
          sizeConstraint,
          normalizedSize,
          beforeCount: sizeFilterStartCount,
          afterCount: filteredProducts.length,
        });
      } else {
        // Size filter would remove all products - skip it to get more results
        logger.debug('handleLoccitaneQuery: size filter skipped (would remove all products)', {
          sizeConstraint,
          normalizedSize,
          wouldRemoveCount: sizeFilterStartCount,
        });
      }
    }
  }
  
  // Step 4.7: Apply avoidIngredients filter
  const requestedAvoidIngredients = constraints.avoidIngredients ?? [];
  
  if (requestedAvoidIngredients.length > 0) {
    const normalizedAvoid = normalizeAvoidIngredients(requestedAvoidIngredients);
    const countBeforeAvoid = filteredProducts.length;
    
    filteredProducts = filteredProducts.filter(product => {
      const attrs = product.attributes?.loccitaneStructured ?? product.attributes;
      
      // Pull all relevant ingredient fields from structured attributes
      const allIngredientsRaw: string[] = [];
      
      // Add from structured attributes
      if (attrs?.allIngredients && Array.isArray(attrs.allIngredients)) {
        allIngredientsRaw.push(...attrs.allIngredients);
      }
      if (attrs?.featuredIngredients && Array.isArray(attrs.featuredIngredients)) {
        allIngredientsRaw.push(...attrs.featuredIngredients);
      }
      if (attrs?.canonicalIngredients && Array.isArray(attrs.canonicalIngredients)) {
        allIngredientsRaw.push(...attrs.canonicalIngredients);
      }
      
      // Also check top-level attributes.ingredients if structured attributes aren't available
      if (allIngredientsRaw.length === 0 && product.attributes && !attrs) {
        const topLevelAttrs = product.attributes as any;
        if (topLevelAttrs.ingredients && Array.isArray(topLevelAttrs.ingredients)) {
          allIngredientsRaw.push(...topLevelAttrs.ingredients);
        }
      }
      
      const normalizedProductIngredients = allIngredientsRaw.map(normalizeIngredient);
      
      // Exclude product if ANY avoid term appears in ANY ingredient string (substring match)
      const hasAvoided = normalizedAvoid.some(avoidTerm =>
        normalizedProductIngredients.some(ing => ing.includes(avoidTerm))
      );
      
      return !hasAvoided;
    });
    
    // Fallback: if we excluded everything, fall back to previous filtered list
    if (filteredProducts.length === 0) {
      logger.debug('handleLoccitaneQuery: avoidIngredients filter removed all products, using fallback', {
        requestedAvoidIngredients,
        countBeforeAvoid,
      });
      // Keep the products from before avoid filter (or productType filter if that was applied)
      filteredProducts = candidateProducts.filter(
        p => !input.lastShownProductIds?.includes(p.id)
      );
      
      // Re-apply productType filter if it was applied
      if (type === 'direct_product_search' && requestedProductTypes.length > 0) {
        const normalizedRequestedTypes = requestedProductTypes.map(normalizeProductType);
        filteredProducts = filteredProducts.filter(product => {
          const attrs = product.attributes?.loccitaneStructured;
          const rawType = attrs?.productType ?? null;
          if (!rawType) return false;
          const normalizedProductType = normalizeProductType(rawType);
          return normalizedRequestedTypes.some(reqType => 
            normalizedProductType === reqType || 
            normalizedProductType.includes(reqType) ||
            reqType.includes(normalizedProductType)
          );
        });
        // If still empty, keep original candidates
        if (filteredProducts.length === 0) {
          filteredProducts = candidateProducts.filter(
            p => !input.lastShownProductIds?.includes(p.id)
          );
        }
      }
    } else {
      logger.debug('handleLoccitaneQuery: avoidIngredients filter applied', {
        requestedAvoidIngredients,
        countBeforeAvoid,
        filteredCount: filteredProducts.length,
      });
    }
  }
  
  // Step 7: Ranking
  const rankingStart = Date.now();
  
  let topProducts: ProductWithLoccitaneAttributes[];
  
  if (isProductSpecificQuery && productContextProduct) {
    // For product-specific queries, skip ranking and use only the product context
    // Stay on analyzing stage (we're still processing the product information)
    topProducts = [productContextProduct];
    logger.debug('handleLoccitaneQuery: skipping ranking for product-specific query', {
      productId: productContextProduct.id,
    });
  } else {
    // Normal ranking flow for discovery queries
    onProgress?.('ranking', STAGE_PROGRESS.ranking);
    const rankedProducts = sortProductsByScore(
      input.message,
      classification,
      filteredProducts,
      {
        lexicalScores: retrievalResult.lexicalScores,
        semanticScores: retrievalResult.semanticScores,
      }
    );
    topProducts = rankedProducts.slice(0, 20);
  }
  
  const rankingDuration = Date.now() - rankingStart;
  
  logger.debug('handleLoccitaneQuery: ranking complete', {
    rankedCount: topProducts.length,
    rankingDuration,
  });
  
  // Store ranked product IDs for "show more" functionality (only for discovery queries)
  if (!isProductSpecificQuery && input.merchantId && input.sessionId && topProducts.length > 0) {
    try {
      const rankedProductIds = topProducts.map(p => p.id);
      await setLastRankedProducts(input.merchantId, input.sessionId, rankedProductIds);
      logger.debug('handleLoccitaneQuery: stored ranked products for show_more', {
        count: rankedProductIds.length,
      });
    } catch (error) {
      logger.warn('handleLoccitaneQuery: failed to store ranked products', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  // Step 8: RAG reply generation
  // For product-specific queries, use only the product context
  let displayProducts: ProductWithLoccitaneAttributes[];
  if (isProductSpecificQuery && productContextProduct) {
    // For product-specific queries, show only the product context
    displayProducts = [productContextProduct];
    // Use Q&A-specific progress stage for product-specific queries
    onProgress?.('answering', STAGE_PROGRESS.answering);
    logger.debug('handleLoccitaneQuery: product-specific query - using only product context', {
      productId: productContextProduct.id,
    });
  } else {
    // Normal flow: use top 4 products
    displayProducts = topProducts.slice(0, 4);
    // Use discovery progress stage for normal queries
    onProgress?.('generating_reply', STAGE_PROGRESS.generating_reply);
  }
  
  const replyStart = Date.now();
  const replyResult = await generateReplyWithRag(
    input.message,
    classification,
    displayProducts, // Pass only the 4 products that will be displayed
    input.merchantId,
    productContextProduct, // Pass product context for product-specific queries
    topProducts.length > displayProducts.length, // hasMoreProducts
    topProducts.length // totalRankedCount
  );
  const replyDuration = Date.now() - replyStart;
  
  // Step 8: Build product cards
  // For product-specific queries, return empty array (no cards - user is asking questions, not browsing)
  // For discovery queries, return product cards for browsing
  const productCards: ProductCard[] = isProductSpecificQuery && productContextProduct
    ? [] // No product cards for product-specific Q&A - user already selected the product
    : displayProducts.map((product) => {
    // Build reason using existing template-based function
    const reason = buildProductReason(
      product,
      input.message,
      {
        productType: classification.constraints.productTypes?.[0] || undefined,
        collection: classification.constraints.collections?.[0] || undefined,
        concern: classification.constraints.concerns?.[0] || undefined,
      },
    );
    
    // Extract key attributes from structured attributes
    const structured = product.attributes.loccitaneStructured;
    const keyAttributes: string[] = [];
    
    // Helper to replace underscores with spaces for display
    const normalizeForDisplay = (value: string): string => value.replace(/_/g, ' ');
    
    // Add concerns (top 2)
    if (structured.canonicalConcerns.length > 0) {
      keyAttributes.push(...structured.canonicalConcerns.slice(0, 2).map(normalizeForDisplay));
    }
    
    // Add featured ingredients (top 2)
    if (structured.canonicalIngredients.length > 0) {
      keyAttributes.push(...structured.canonicalIngredients.slice(0, 2).map(normalizeForDisplay));
    }
    
    // Add application areas (top 1)
    if (structured.applicationAreas.length > 0) {
      keyAttributes.push(normalizeForDisplay(structured.applicationAreas[0]));
    }
    
    // Limit to 5 attributes
    const finalAttributes = keyAttributes.slice(0, 5);
    
    return {
      id: product.id,
      title: product.title,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      priceCents: product.priceCents,
      salePriceCents: product.salePriceCents || null,
      currency: product.currency,
      reason,
      keyAttributes: finalAttributes,
      queryChips: [],
      stockStatus: product.stockStatus,
    };
  });
  
  const totalTime = Date.now() - startTime;
  logger.info('handleLoccitaneQuery complete', {
    totalTime,
    queryType: classification.type,
    replyLength: replyResult.replyText.length,
    productCount: productCards.length,
    rankedCount: topProducts.length,
    classifyDuration,
    retrievalDuration,
    loadDuration,
    rankingDuration,
    replyDuration,
  });
  
  // Step 9: Generate action proposals with labels
  let actions: ActionProposal[] = [];
  if (replyResult.actionSpecs && replyResult.actionSpecs.length > 0) {
    try {
      const labelMap = await getActionLabels(input.merchantId, replyResult.actionSpecs);
      
      actions = replyResult.actionSpecs.map((spec) => ({
        id: generateActionId(),
        type: spec.type,
        label: labelMap.get(spec.type) || 'More options',
        payload: spec.payload,
      }));

      // Save actions to conversation state
      if (input.merchantId && input.sessionId) {
        try {
          await setPendingActions(input.merchantId, input.sessionId, actions);
        } catch (stateError) {
          logger.warn('handleLoccitaneQuery: failed to save actions to state', {
            error: stateError instanceof Error ? stateError.message : String(stateError),
          });
        }
      }
    } catch (error) {
      logger.error('handleLoccitaneQuery: failed to generate action labels', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without actions
    }
  }
  
  onProgress?.('complete', STAGE_PROGRESS.complete);
  
  // Construct resolved constraints from merged classification constraints
  const resolvedConstraints: SearchConstraints = {
    query: input.message,
    inStockOnly: true,
  };
  
  if (classification.constraints.productTypes?.length) {
    resolvedConstraints.productTypes = classification.constraints.productTypes;
  }
  if (classification.constraints.concerns?.length) {
    // Map concerns to a compatible field - for now we'll store them in a custom way
    // Since SearchConstraints doesn't have concerns, we'll store in query
    resolvedConstraints.query = `${resolvedConstraints.query || ''} ${classification.constraints.concerns.join(' ')}`.trim();
  }
  // Note: SearchConstraints doesn't have ingredients field
  // Ingredients are handled at QueryClassification level and used during retrieval
  if (classification.constraints.priceMinCents) {
    resolvedConstraints.priceMinCents = classification.constraints.priceMinCents;
  }
  if (classification.constraints.priceMaxCents) {
    resolvedConstraints.priceMaxCents = classification.constraints.priceMaxCents;
  }
  if (classification.constraints.collections?.length) {
    resolvedConstraints.query = `${resolvedConstraints.query || ''} ${classification.constraints.collections.join(' ')}`.trim();
  }
  if (classification.constraints.genders?.length) {
    resolvedConstraints.genders = classification.constraints.genders;
  }
  if (classification.constraints.ageGroups?.length) {
    resolvedConstraints.ageGroups = classification.constraints.ageGroups;
  }
  
  // Include size constraint in resolved classification constraints for persistence
  // Note: size is not part of QueryClassification['constraints'], so we add it as an extension
  const resolvedClassificationConstraintsWithSize: QueryClassification['constraints'] & { size?: string } = {
    ...classification.constraints,
    ...(sizeConstraint ? { size: sizeConstraint } : {}),
  };
  
  const result: LoccitaneQueryResult = {
    replyText: replyResult.replyText,
    productCards,
    noExactMatch: topProducts.length === 0,
    followupText: replyResult.followupText,
    actions: actions.length > 0 ? actions : undefined,
    route: routerResult.route,
    actionType: routerResult.action?.type,
    resolvedConstraints,
    resolvedClassificationConstraints: resolvedClassificationConstraintsWithSize as any, // Store full classification constraints including size for merging
  };
  
  return result;
}
