/**
 * LoveShackFancy Query Orchestrator
 * 
 * Main query handler that orchestrates the complete fashion shopping pipeline:
 * 1. Safety check
 * 2. Query classification
 * 3. Multi-view retrieval
 * 4. Product loading & filtering
 * 5. Ranking
 * 6. Reply generation
 * 7. Product card creation
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';
import type { SearchResultItem } from '../search/types';
import type { ProductCard } from '../llm/orchestrator/cards';
import type { ProgressCallback } from '../llm/types';
import { STAGE_PROGRESS } from '../llm/types';
import { checkQuerySafety } from './safety';
import { classifyQuery, classifyQueryWithMetadata, type QueryClassification, type FashionConstraints, type ClassificationWithMetadata } from './classifier';
import { multiViewRetrieval, type MultiViewRetrievalResult } from './retrieval';
import { sortProductsByScore, type ProductWithFashionAttributes } from './ranking/ranker';
import { generateReply, type ReplyResult, type ReplyContext } from './reply';
import { buildProductReason } from './reasons';
import { routeTurn, type DialogueRouteResult } from './router';
import type { ConversationStateData } from '../chat/ConversationStateService';
import { categorizeQuery, type QueryCategorization } from './query-categorizer';
import { generateFollowUpQuestions, regenerateNextQuestion } from './followup-generator';
import { enhanceQuery, createEnhancedVectorQuery } from './query-enhancer';
import { shouldContinueAnyway } from './continue-detector';
import { updateState, updateMemory, setLastRankedProducts, getState, appendShownProducts, advanceRankCursor } from '../chat/ConversationStateService';
import { rankWithConstraints } from './ranking/constraint-ranker';
import { classifyQueryToCategoriesWithConfidence } from './category-classifier';
import { mergeFollowUpConstraints, isFollowUpRefinement } from './constraint-merger';
import { callLLM } from '../llm/provider';
import { buildProductQaPrompt } from '../llm/prompts';
import { matchAgeGroup } from './ranking/constraint-matcher';
import { handleIrrelevantQuery, generateIntelligentDenial } from './irrelevant-query-handler';
import { getAllCategories, findClosestCategory } from '../catalog/category-tree';
import { extractCategoryKeywords, validateAllProducts as validateAllProductsByCategory, filterProductsByCategoryValidation } from './validation/category-validator';
import { extractConstraintValues, extractConstraintIntent, type ConstraintWithIntent } from './constraint-utils';

export type LoveshackfancyQueryInput = {
  sessionId: string;
  message: string;
  lastConstraints?: SearchConstraints | null;
  lastClassificationConstraints?: FashionConstraints | null;
  lastShownProductIds?: string[];
  merchantId?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onProgress?: ProgressCallback;
  searchMethods?: {
    lexical: boolean;
    semantic: boolean;
    concept: boolean;
  };
  productContextId?: string;
  conversationState?: ConversationStateData;
  lastEnhancedQuery?: string; // CRITICAL: Pass the enhanced query from previous result directly (avoids stale database reads)
  actionId?: string; // Optional action ID for action-based queries (e.g., "show_more")
  merchantData?: {
    brandName?: string;
    voiceInstructions?: string;
    datasetContext?: any;
    faq?: Array<{ question: string; answer: string }> | null;
  };
};

export type LoveshackfancyQueryResult = {
  replyText: string; // First part (before product cards)
  replyTextAfter?: string; // Second part (after product cards) - only when product cards are shown
  productCards: ProductCard[];
  noExactMatch: boolean;
  followupText?: string;
  actions?: Array<{ id: string; type: string; label: string; payload?: any }>;
  route?: string;
  actionType?: string;
  resolvedConstraints?: SearchConstraints;
  resolvedClassificationConstraints?: FashionConstraints;
  constraintsPassedToRanking?: Partial<FashionConstraints>; // Constraints passed to ranking function
  enhancedQuery?: string; // The enhanced query text (for follow-up context building)
};

/**
 * Load products with fashion attributes
 */
async function loadFashionProducts(
  productIds: string[],
  merchantId?: string
): Promise<SearchResultItem[]> {
  const startTime = Date.now();
  
  if (productIds.length === 0) {
    return [];
  }

  logger.info('loadFashionProducts: starting', {
    productCount: productIds.length,
    merchantId,
  });

  // OPTIMIZATION: Load products in parallel batches for faster loading
  // PostgreSQL IN clauses with >100 items can be slow, but parallel batches are faster
  const BATCH_SIZE = 100;
  const batches: string[][] = [];
  
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    batches.push(productIds.slice(i, i + BATCH_SIZE));
  }
  
  // Load all batches in parallel for better performance
  const dbStartTime = Date.now();
  const batchPromises = batches.map(batch =>
    prisma.product.findMany({
      where: {
        id: { in: batch },
        ...(merchantId ? { merchantId } : {}),
        isActive: true,
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
      stockStatus: true,
      attributes: true,
      brand: true, // Added for brand-based boosting
      // Core indexed columns (for constraint matching)
      color: true,
      fabric: true,
      material: true,
      occasion: true, // CRITICAL: Single occasion column (comma-separated string) - was missing!
      season: true,
      fit: true,
      // Enriched columns
      length: true,
      sleeve: true, // Added for constraint matching
      formalityLevel: true,
      temperatureIntent: true,
      humidityFriendly: true,
      occasionContext: true, // Array of occasions
      problemSolutions: true,
      functionFeatures: true,
      colorShade: true,
      colorUndertone: true,
      multicolor: true,
      seasonalPalette: true,
      enrichedColor: true, // Added for color matching
      ageGroup: true, // Added for age group matching
      neckline: true,
    },
    })
  );
  
  const batchResults = await Promise.all(batchPromises);
  const products = batchResults.flat();
  const dbDuration = Date.now() - dbStartTime;
  
  logger.info('loadFashionProducts: database_query_complete', {
    productCount: products.length,
    requestedCount: productIds.length,
    batchCount: batches.length,
    dbDurationMs: dbDuration,
  });

  return products.map(product => ({
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
    attributes: (product.attributes ?? {}) as any,
    brand: product.brand ?? null, // Added for brand-based boosting
    // Core indexed columns (for constraint matching)
    color: product.color ?? null,
    fabric: product.fabric ?? null,
    material: product.material ?? null,
    occasion: product.occasion ?? null, // CRITICAL: Single occasion column (comma-separated string) - was missing!
    season: product.season ?? null,
    fit: product.fit ?? null,
    // Enriched columns
    length: product.length ?? null,
    sleeve: product.sleeve ?? null, // Added for constraint matching
    formalityLevel: product.formalityLevel ?? null,
    temperatureIntent: product.temperatureIntent ?? null,
    humidityFriendly: product.humidityFriendly ?? null,
    occasionContext: product.occasionContext ?? null, // Array of occasions
    problemSolutions: product.problemSolutions ?? null,
    functionFeatures: product.functionFeatures ?? null,
    colorShade: product.colorShade ?? null,
    colorUndertone: product.colorUndertone ?? null,
    multicolor: product.multicolor ?? null,
    seasonalPalette: product.seasonalPalette ?? null,
    enrichedColor: product.enrichedColor ?? null, // Added for color matching
    ageGroup: product.ageGroup ?? null, // Added for age group matching
    neckline: product.neckline ?? null,
  }));
}

/**
 * Build product card from search result item
 */
function buildProductCard(
  product: SearchResultItem,
  reason: string,
  emotionalKeywords?: string[] // Optional emotional keywords (2-3 keywords, 1-2 words each)
): ProductCard {
  // Use emotional keywords if provided, otherwise fallback to empty array
  // (The orchestrator will generate them before calling this function)
  const keyAttributes = emotionalKeywords && emotionalKeywords.length > 0
    ? emotionalKeywords.slice(0, 3) // Max 3 emotional keywords
    : [];

  return {
    id: product.id,
    title: product.title,
    priceCents: product.priceCents,
    salePriceCents: product.salePriceCents,
    currency: product.currency,
    keyAttributes, // Emotional keywords (2-3, 1-2 words each)
    reason,
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    stockStatus: product.stockStatus,
    brand: product.brand ?? null, // Added for brand display
  };
}

/**
 * Extract attribute value
 */
function extractAttr(attrs: Record<string, unknown>, key: string): string | null {
  const val = attrs[key];
  if (Array.isArray(val) && val.length > 0) {
    return String(val[0]);
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  // Check extensible attributes
  const extensible = attrs.extensible as Record<string, unknown> | undefined;
  if (extensible) {
    const extVal = extensible[key];
    if (extVal) {
      if (Array.isArray(extVal) && extVal.length > 0) {
        return String(extVal[0]);
      }
      if (typeof extVal === 'string') {
        return extVal;
      }
    }
  }
  return null;
}

/**
 * Main query handler for LoveShackFancy fashion queries
 */
export async function handleLoveshackfancyQuery(
  input: LoveshackfancyQueryInput
): Promise<LoveshackfancyQueryResult> {
  const queryStartTime = Date.now();
  
  logger.info('handleLoveshackfancyQuery: starting', {
    query: input.message.substring(0, 100),
    sessionId: input.sessionId,
    isFollowUp: !!input.lastConstraints,
    merchantId: input.merchantId,
  });
  // Store category confidence for dynamic threshold calculation (set later in the flow)
  let categoryConfidenceForThreshold: number | undefined = undefined;
  const { onProgress } = input;

  // Store original user message before any modifications
  const originalUserMessage = input.message;

  logger.debug('handleLoveshackfancyQuery start', {
    message: input.message,
    sessionId: input.sessionId,
    merchantId: input.merchantId,
    productContextId: input.productContextId,
  });

  console.log('[ORCHESTRATOR] START - input.conversationState:', {
    hasConversationState: !!input.conversationState,
    hasMemory: !!input.conversationState?.memory,
    hasPendingFollowups: !!input.conversationState?.memory?.pendingFollowups,
    memoryKeys: input.conversationState?.memory ? Object.keys(input.conversationState.memory) : [],
  });

  // Step 1: Safety gate
  onProgress?.('safety_check', STAGE_PROGRESS.safety_check);
  const safetyCheck = checkQuerySafety(input.message);
  
  // Store categories found from safety check for unrelated queries (to use after categorization)
  let safetyCheckCategories: string[] | null = null;
  
  // Declare topCategories early so it's accessible throughout (including follow-up handling)
  let topCategories: string[] = [];
  
  if (!safetyCheck.safe) {
    logger.info('handleLoveshackfancyQuery: unsafe or non-shopping query', {
      reason: 'reason' in safetyCheck ? safetyCheck.reason : 'unknown',
      message: input.message.substring(0, 100),
    });

    // Handle self-harm/crisis queries with compassionate response
    if ('reason' in safetyCheck && safetyCheck.reason === 'self_harm') {
      onProgress?.('handling_unrelated', STAGE_PROGRESS.complete);
      await new Promise(resolve => setTimeout(resolve, 100));
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "I hear that you're going through a difficult time, and I want you to know that your feelings are valid and you're not alone. While I'm here to help with fashion shopping, I'm not equipped to provide the support you might need right now.\n\nPlease reach out to someone you trust—a friend, family member, or mental health professional. If you're in immediate crisis, please contact your local emergency services or a crisis hotline like the National Suicide Prevention Lifeline at 988 (in the US) or your local crisis hotline.\n\nYou deserve support, and there are people who can help.",
        productCards: [],
        noExactMatch: true,
        route: 'SAFETY_BLOCK',
      };
    }

    // Handle unrelated queries - intelligently decide redirect vs deny
    if ('reason' in safetyCheck && safetyCheck.reason === 'unrelated') {
      logger.info('unrelated_query_intelligent_handling', {
        query: input.message,
        note: 'Analyzing unrelated query to determine if redirect or deny',
      });

      // Get product context from conversation history
      const currentState = input.conversationState || {
        shownProductIds: [],
        lastQueryFingerprint: null,
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions: [],
        memory: {},
      };
      const productContext = currentState.shownProductIds?.length > 0
        ? await prisma.product.findMany({
            where: {
              id: { in: currentState.shownProductIds.slice(-5) },
              merchantId: input.merchantId,
            },
            select: { id: true, title: true },
          }).then(products => products.map(p => ({ productId: p.id, title: p.title || '' })))
        : undefined;

      // Intelligently decide: redirect or deny
      const decision = await handleIrrelevantQuery(
        input.message,
        input.merchantData?.datasetContext,
        undefined, // Will fetch from ontology
        productContext
      );

      if (decision.action === 'deny') {
        // Generate intelligent denial reply
        onProgress?.('generating', STAGE_PROGRESS.generating);
        const denialReply = await generateIntelligentDenial(
          input.message,
          decision.reason,
          input.merchantData?.brandName || 'LoveShackFancy',
          input.history
        );

        onProgress?.('complete', STAGE_PROGRESS.complete);
        return {
          replyText: denialReply,
          productCards: [],
          noExactMatch: true,
          route: 'DENIED',
        };
      } else {
        // Redirect: Will use main category classification after gender extraction
        // Category classification now happens after gender extraction with gender-filtered categories
        const potentialCategories = decision.potentialCategories || [];
        logger.info('unrelated_query_redirected_category_unclear', {
          query: input.message,
          potentialCategories,
          note: 'Generating intelligent redirect with segue to product discovery',
        });

        onProgress?.('generating', STAGE_PROGRESS.generating);
        const followups = await generateFollowUpQuestions(
          input.message,
          undefined, // No preliminary products for unrelated queries
          input.merchantData?.datasetContext,
          potentialCategories,
          true // Mark as unrelated query for intelligent redirect
        );
        logger.info('unrelated_query_followup_questions_received', {
          query: input.message,
          contextSummary: followups.contextSummary.substring(0, 150),
          questionCount: followups.questions.length,
        });

        // Store in conversation state
        if (input.merchantId) {
          updateState(input.merchantId, input.sessionId, {
            memory: {
              ...currentState.memory,
              pendingFollowups: {
                originalQuery: input.message,
                questions: followups.questions,
                responses: [],
                preliminaryProducts: undefined,
              },
            },
          }).catch(err => logger.warn('state_update_failed', {
            error: err instanceof Error ? err.message : String(err),
            context: 'store_pending_followups_unrelated_redirect',
          }));
        }

        onProgress?.('complete', STAGE_PROGRESS.complete);
        const firstQuestion = followups.questions.length > 0
          ? `\n\n${followups.questions[0]}`
          : '';
        const replyText = `${followups.contextSummary}${firstQuestion}`;
        
        return {
          replyText,
          productCards: [],
          noExactMatch: true,
          route: 'CLARIFICATION_NEEDED',
        };
      }
    }

    // Generic safety response (only if unrelated query didn't find categories)
    if (!('reason' in safetyCheck && safetyCheck.reason === 'unrelated' && safetyCheckCategories)) {
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "I'm here to help you find beautiful LoveShackFancy fashion pieces. What are you looking for today?",
        productCards: [],
        noExactMatch: true,
        route: 'SAFETY_BLOCK',
      };
    }
  }

  // Step 1.5: Handle product context questions (PDP suitability) FIRST
  // This takes priority over pending follow-ups - product-specific questions should be answered directly
  if (input.productContextId) {
    logger.info('product_context_question_detected', {
      productContextId: input.productContextId,
      message: input.message.substring(0, 100),
    });

    try {
      // Load the product
      const product = await prisma.product.findUnique({
        where: { id: input.productContextId },
        select: {
          id: true,
          title: true,
          description: true,
          priceCents: true,
          salePriceCents: true,
          currency: true,
          category: true,
          subcategory: true,
          attributes: true,
        },
      });

      if (!product) {
        logger.warn('product_context_not_found', {
          productContextId: input.productContextId,
        });
        onProgress?.('complete', STAGE_PROGRESS.complete);
        return {
          replyText: "I couldn't find that product. Could you try selecting it again?",
          productCards: [],
          noExactMatch: true,
          route: 'PRODUCT_NOT_FOUND',
        };
      }

      // Product loaded successfully
      onProgress?.('loading_product', STAGE_PROGRESS.loading_product);

      // Build product context for the prompt
      const productContext = {
        title: product.title,
        description: product.description || '',
        price: product.priceCents ? `$${(product.priceCents / 100).toFixed(2)}` : 'Price not available',
        salePrice: product.salePriceCents ? `$${(product.salePriceCents / 100).toFixed(2)}` : null,
        currency: product.currency || 'USD',
        category: product.category || '',
        subcategory: product.subcategory || '',
        attributes: product.attributes || {},
      };

      // Build the prompt
      const prompt = buildProductQaPrompt(input.merchantData?.datasetContext);
      const fullPrompt = `${prompt}

PRODUCT INFORMATION:
${JSON.stringify(productContext, null, 2)}

USER QUESTION: ${input.message}

Answer the user's question about this product:`;

      // Analyze product information
      onProgress?.('analyzing', STAGE_PROGRESS.analyzing);
      
      // Call LLM to answer the question
      onProgress?.('answering', STAGE_PROGRESS.answering);
      const result = await callLLM({
        messages: [
          {
            role: 'system',
            content: 'You are a friendly, witty fashion shopping assistant for LoveShackFancy. You have great style, a sense of humor, and you genuinely love helping people understand products. You\'re answering questions about a specific product the user has selected. Be honest, understanding, witty, and helpful—match the same conversational tone as your chat replies.',
          },
          {
            role: 'user',
            content: fullPrompt,
          },
        ],
        purpose: 'final_reply',
        expectJson: false,
      });

      logger.info('product_qa_answer_generated', {
        productContextId: input.productContextId,
        answerLength: result.rawText.length,
      });

      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: result.rawText.trim(),
        productCards: [],
        noExactMatch: false,
        route: 'PDP_SUITABILITY',
      };
    } catch (error) {
      logger.error('product_qa_failed', {
        error: error instanceof Error ? error.message : String(error),
        productContextId: input.productContextId,
      });
      // Fall through to normal flow if product Q&A fails
    }
  }

  // Step 2: Handle "show more" action - return next batch from cached ranked products
  // This must happen before follow-up handling to avoid re-running the query
  // Load the latest conversation state from database to get current cursor and shown products
  let conversationState: ConversationStateData;
  if (input.merchantId && input.sessionId) {
    try {
      conversationState = await getState(input.merchantId, input.sessionId);
    } catch (error) {
      logger.warn('handleLoveshackfancyQuery: failed to load conversation state, using input state', {
        error: error instanceof Error ? error.message : String(error),
      });
      conversationState = input.conversationState || {
        shownProductIds: [],
        lastQueryFingerprint: null,
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions: [],
        memory: {},
      };
    }
  } else {
    conversationState = input.conversationState || {
      shownProductIds: [],
      lastQueryFingerprint: null,
      lastRankedProductIds: [],
      lastRankCursor: 0,
      pendingActions: [],
      memory: {},
    };
  }

  // Check if this is a "show more" request
  // Handle both explicit "show more" messages and action-based requests
  const messageLower = input.message.toLowerCase().trim();
  const isShowMore = messageLower === 'show more' || 
                     messageLower === 'more' || 
                     messageLower === 'next' ||
                     messageLower.includes('show more') ||
                     messageLower.includes('more options') ||
                     messageLower.includes('more products') ||
                     // Also check if this is triggered by a "show more" action button
                     (input.actionId && input.actionId.includes('show_more'));

  if (isShowMore && conversationState.lastRankedProductIds && conversationState.lastRankedProductIds.length > 0) {
    logger.info('handleLoveshackfancyQuery: handling show_more action', {
      sessionId: input.sessionId,
      lastRankedProductIdsCount: conversationState.lastRankedProductIds.length,
      lastRankCursor: conversationState.lastRankCursor,
      shownProductIdsCount: conversationState.shownProductIds.length,
    });

    // Get next batch of products, excluding already shown ones
    const candidateIds = conversationState.lastRankedProductIds.slice(conversationState.lastRankCursor);
    const shownProductIdsSet = new Set(conversationState.shownProductIds || []);
    const nextBatchIds = candidateIds.filter(id => !shownProductIdsSet.has(id)).slice(0, 4);

    if (nextBatchIds.length === 0) {
      logger.info('handleLoveshackfancyQuery: no more products to show', {
        sessionId: input.sessionId,
        totalRanked: conversationState.lastRankedProductIds.length,
        shownCount: conversationState.shownProductIds.length,
        cursorPosition: conversationState.lastRankCursor,
      });
      
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "You've seen all available options! Would you like to refine your search?",
        productCards: [],
        noExactMatch: false,
        route: 'SHOW_MORE',
      };
    }

    // Load products
    onProgress?.('loading_product', STAGE_PROGRESS.loading_product);
    const products = await loadFashionProducts(nextBatchIds, input.merchantId);

    if (products.length === 0) {
      logger.warn('handleLoveshackfancyQuery: failed to load products for show_more', {
        productIds: nextBatchIds,
      });
      // Fall through to normal flow
    } else {
      // Build product cards
      const productCards: ProductCard[] = products.map(product => {
        const attrs = product.attributes || {};
        const keyAttributes: string[] = [];
        
        const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
        const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length');
        const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
        const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern');
        const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material');
        const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color');
        
        if (style) keyAttributes.push(style);
        if (length) keyAttributes.push(length);
        if (occasion) keyAttributes.push(occasion);
        if (pattern) keyAttributes.push(pattern);
        if (material) keyAttributes.push(material);
        if (color) keyAttributes.push(color);

        return {
          id: product.id,
          title: product.title,
          priceCents: product.priceCents,
          salePriceCents: product.salePriceCents || null,
          currency: product.currency,
          keyAttributes: keyAttributes.slice(0, 5),
          reason: `Chosen because it matches your search criteria.`,
          imageUrl: product.imageUrl,
          productUrl: product.productUrl,
          stockStatus: product.stockStatus,
        };
      });

      // Update state: mark products as shown and advance cursor
      if (input.merchantId && input.sessionId) {
        await appendShownProducts(input.merchantId, input.sessionId, nextBatchIds);
        await advanceRankCursor(input.merchantId, input.sessionId, nextBatchIds.length);
      }

      // Reload state to get updated cursor for hasMore check
      let updatedState = conversationState;
      if (input.merchantId && input.sessionId) {
        try {
          updatedState = await getState(input.merchantId, input.sessionId);
        } catch (error) {
          logger.warn('handleLoveshackfancyQuery: failed to reload state for hasMore check', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Check if there are more products available
      const remainingAfterCursor = conversationState.lastRankedProductIds
        .slice(updatedState.lastRankCursor)
        .filter(id => !shownProductIdsSet.has(id));
      const hasMore = remainingAfterCursor.length > 0;

      // Generate actions
      const actions: Array<{ id: string; type: string; label: string; payload?: any }> = [];
      if (hasMore) {
        actions.push({
          id: `show_more_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'show_more',
          label: 'Show more',
        });
      }

      logger.info('handleLoveshackfancyQuery: show_more completed', {
        sessionId: input.sessionId,
        productsReturned: productCards.length,
        hasMore,
        newCursor: updatedState.lastRankCursor,
        remainingProducts: remainingAfterCursor.length,
      });

      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: `Here are ${productCards.length} more option${productCards.length > 1 ? 's' : ''} for you!`,
        productCards,
        noExactMatch: false,
        route: 'SHOW_MORE',
        actions: actions.length > 0 ? actions : undefined,
      };
    }
  }

  // Step 3: Check for pending follow-ups (after product context and show more handling)
  // This ensures responses to follow-up questions are handled correctly even if they look "irrelevant"

  const pendingFollowups = conversationState.memory?.pendingFollowups;

  console.log('[ORCHESTRATOR] Checking for pendingFollowups:', {
    hasInputConversationState: !!input.conversationState,
    hasMemory: !!conversationState.memory,
    hasPendingFollowups: !!pendingFollowups,
    pendingFollowupsData: pendingFollowups ? {
      originalQuery: pendingFollowups.originalQuery,
      questionsCount: pendingFollowups.questions?.length,
      responsesCount: pendingFollowups.responses?.length,
    } : null,
    message: input.message.substring(0, 50),
    fullMemory: JSON.stringify(conversationState.memory).substring(0, 200),
  });

  if (pendingFollowups) {
      console.log('[ORCHESTRATOR] Found pending follow-ups! Handling response...');
      // User is responding to follow-up questions
      // Check if they want to continue anyway
      onProgress?.('understanding', STAGE_PROGRESS.understanding);
      const continueDetection = await shouldContinueAnyway(input.message);

      if (continueDetection.shouldContinue && continueDetection.confidence > 0.6) {
        // User wants to proceed - enhance query and search
        onProgress?.('understanding', STAGE_PROGRESS.understanding + 5);
        const enhancedQuery = await enhanceQuery(
          pendingFollowups.originalQuery,
          [...pendingFollowups.responses, input.message],
          pendingFollowups.preliminaryProducts,
          input.merchantData?.datasetContext
        );

        // Note: We'll use enhancedQuery.enhancedQueryText for the search
        // The embedding will be created during retrieval
        // Clear pending followups (fire-and-forget - non-blocking)
        if (input.merchantId) {
          updateState(input.merchantId, input.sessionId, {
            memory: {
              ...conversationState.memory,
              pendingFollowups: undefined,
            },
          }).catch(err => logger.warn('state_update_failed', { 
            error: err instanceof Error ? err.message : String(err),
            context: 'clear_pending_followups_continue_anyway'
          }));
        }

        // Use enhanced query for search - replace message for remaining flow
        input.message = enhancedQuery.enhancedQueryText;
        
        // Continue with normal flow using enhanced query (break out of if block)
        logger.info('query_enhanced_and_proceeding_continue_anyway', {
          originalQuery: pendingFollowups.originalQuery,
          enhancedQuery: enhancedQuery.enhancedQueryText,
          responseCount: [...pendingFollowups.responses, input.message].length,
        });
      } else {
        // User answered the clarification question (only ONE question now)
        const updatedResponses = [...pendingFollowups.responses, input.message];

        // Enhance query with the response
          onProgress?.('understanding', STAGE_PROGRESS.understanding + 5);
          const enhancedQuery = await enhanceQuery(
            pendingFollowups.originalQuery,
            updatedResponses,
            pendingFollowups.preliminaryProducts,
            input.merchantData?.datasetContext
          );

        // Category classification will happen after gender extraction with gender-filtered categories
        // No need to classify here - main classification handles it

          // Clear pending followups (fire-and-forget - non-blocking)
          if (input.merchantId) {
            updateState(input.merchantId, input.sessionId, {
              memory: {
                ...conversationState.memory,
                pendingFollowups: undefined,
              },
            }).catch(err => logger.warn('state_update_failed', { 
              error: err instanceof Error ? err.message : String(err),
            context: 'clear_pending_followups_after_response'
            }));
          }

          // Use enhanced query for search - replace message for remaining flow
          input.message = enhancedQuery.enhancedQueryText;

        // Category classification will happen in main flow after gender/ageGroup extraction
        // No need to classify here - main classification handles it with gender-filtered categories
        logger.info('query_enhanced_proceeding_to_main_classification', {
          originalQuery: pendingFollowups.originalQuery,
          enhancedQuery: enhancedQuery.enhancedQueryText,
          note: 'Category classification will happen in main flow with gender-filtered categories',
        });

        // Continue with normal flow using enhanced query
        // Note: We only ask ONE clarification question, so after one response we always proceed
        logger.info('query_enhanced_and_proceeding_after_clarification', {
            originalQuery: pendingFollowups.originalQuery,
          enhancedQuery: enhancedQuery.enhancedQueryText,
            responseCount: updatedResponses.length,
        });
      }
  }

  // Step 2.5: Check for follow-up refinements (BEFORE categorization)
  // This allows follow-ups to go through the full pipeline like indirect query follow-ups
  // We use permissive detection and let the LLM make the final decision
  let isFollowUp = false;
  let mergedConstraints: FashionConstraints | null = null;
  let enhancedQueryText: string = input.message;
  let lastUserQuery: string | null = null;
  let previousEnhancedQuery: string | null = null; // The cumulative enhanced query from previous merges
  // NOTE: We'll read this RIGHT BEFORE we use it (not here) to ensure we get the latest value

  // Extract last user query from history (exclude current message) - used as fallback if no enhanced query
  // Get the last user message that is NOT the current message
  if (input.history && input.history.length > 0) {
    const userMessages = input.history.filter(h => h.role === 'user');
    // If the last user message is the current message, get the one before it
    // Otherwise, get the last one
    if (userMessages.length > 0) {
      const lastUserMsg = userMessages[userMessages.length - 1];
      // If the last user message matches current message, get the previous one
      if (lastUserMsg.content === input.message && userMessages.length > 1) {
        lastUserQuery = userMessages[userMessages.length - 2].content;
      } else if (lastUserMsg.content !== input.message) {
        // Last message is different from current, use it
        lastUserQuery = lastUserMsg.content;
      }
      // If they match and there's only one, lastUserQuery stays null (no previous query)
    }
  }

  // CRITICAL: Priority order for getting the enhanced query:
  // 1. Direct input (from previous result) - MOST RELIABLE (no database read needed)
  // 2. From conversationState.memory (passed-in state)
  // 3. From database (fallback if above are not available)
  // This ensures we use the enhanced query from the previous step, not stale database data
  if (input.lastEnhancedQuery) {
    previousEnhancedQuery = input.lastEnhancedQuery;
    logger.debug('using_previous_enhanced_query_from_direct_input', {
      previousEnhancedQuery: previousEnhancedQuery.substring(0, 100),
      currentMessage: input.message.substring(0, 100),
      source: 'direct_input',
    });
  } else if (input.conversationState?.memory?.lastEnhancedQuery) {
    previousEnhancedQuery = input.conversationState.memory.lastEnhancedQuery;
    logger.debug('using_previous_enhanced_query_from_passed_state', {
      previousEnhancedQuery: previousEnhancedQuery.substring(0, 100),
      currentMessage: input.message.substring(0, 100),
      source: 'conversationState',
    });
  } else if (input.merchantId && input.sessionId) {
    // Fallback: read from database (may be stale, but better than nothing)
    try {
      const latestState = await getState(input.merchantId, input.sessionId);
      if (latestState.memory?.lastEnhancedQuery) {
        previousEnhancedQuery = latestState.memory.lastEnhancedQuery;
        logger.debug('using_previous_enhanced_query_from_database', {
          previousEnhancedQuery: previousEnhancedQuery.substring(0, 100),
          currentMessage: input.message.substring(0, 100),
          source: 'database',
          warning: 'may_be_stale',
        });
      }
    } catch (err) {
      logger.warn('failed_to_read_enhanced_query_from_database', {
        error: err instanceof Error ? err.message : String(err),
        sessionId: input.sessionId,
      });
    }
  }

  // Use previous enhanced query if available, otherwise fall back to raw last user query
  const queryToMergeWith = previousEnhancedQuery || lastUserQuery;

  // Very permissive check: if we have last query, let the LLM decide
  // This allows the LLM to handle logical follow-ups even if they don't match specific patterns
  // We check if:
  // 1. We have a query to merge with (enhanced query or raw last user query) - REQUIRED
  // 2. Previous constraints are helpful but not required - LLM can infer from previous query text
  // 3. The message is reasonably short (< 25 words) - long messages are likely new searches
  // 4. Either it matches follow-up patterns OR it's short enough that it could logically be a follow-up
  const hasQueryToMergeWith = !!queryToMergeWith;
  const hasPreviousConstraints = !!input.lastClassificationConstraints;
  const messageWords = input.message.trim().split(/\s+/).length;
  const isShortMessage = messageWords < 25;
  const matchesFollowUpPattern = isFollowUpRefinement(input.message, true);
  
  // NOTE: Early category change detection has been removed.
  // The constraint merger now handles category switches intelligently with intent-aware constraint preservation.
  // The LLM will decide whether to preserve or remove constraints based on category similarity and explicit user intent.
  
  // If we have a query to merge with and the message is short, let the LLM decide (even if it doesn't match patterns)
  // This allows logical follow-ups like "Show me close matches, price can be higher" to be detected
  // Previous constraints are helpful but not required - LLM can infer constraints from previous query text
  // The LLM will intelligently handle category switches with intent-aware constraint preservation
  const shouldCheckWithLLM = hasQueryToMergeWith && (isShortMessage || matchesFollowUpPattern);

  // Get previous categories from conversation state
  const previousCategories = conversationState.memory?.lastCategories || undefined;

  // Categories will be classified after gender extraction - no need to classify early for merger
  // Merger can work without category similarity check (it's optional)
  let currentCategories: string[] | undefined = undefined;

  if (shouldCheckWithLLM) {
    logger.info('checking_if_followup_with_llm', {
      currentMessage: input.message.substring(0, 100),
      queryToMergeWith: queryToMergeWith?.substring(0, 100),
      usingEnhancedQuery: !!previousEnhancedQuery,
      hasPreviousConstraints: hasPreviousConstraints,
      messageLength: messageWords,
      matchesPattern: matchesFollowUpPattern,
      willCheckWithLLM: true,
    });

    try {
      // Intelligently merge constraints using LLM - the LLM will decide if it's truly a follow-up
      // and how to merge/replace/remove constraints
      // CRITICAL: Use the previous enhanced query (if available) as the base for merging
      // This allows cumulative context building where each follow-up merges with the previous enhanced query
      // If previous constraints are missing, pass null - LLM can infer from previous query text
      // Pass category information for intent-aware constraint preservation
      onProgress?.('understanding', STAGE_PROGRESS.understanding);
      const mergeResult = await mergeFollowUpConstraints(
        queryToMergeWith!,
        input.lastClassificationConstraints || null,
        input.message,
        input.history, // Pass full conversation history to help trace back product type
        previousCategories, // Pass previous categories for similarity check
        currentCategories // Pass current categories for similarity check
      );

      // If LLM determined it's a merge/replace/remove action, treat as follow-up
      // The LLM's mergeAction indicates it understood this as a follow-up
      if (mergeResult.mergeAction === 'merge' || mergeResult.mergeAction === 'replace' || mergeResult.mergeAction === 'remove') {
        isFollowUp = true;
        mergedConstraints = mergeResult.mergedConstraints;
        enhancedQueryText = mergeResult.enhancedQueryText;

        // Check if user requested "similar colours" - if so, expand the color list using embedding similarity
        const similarColoursPattern = /\b(similar\s+colou?rs?|similar\s+shades?|close\s+color\s+matches?|or\s+similar\s+colou?rs?)\b/i;
        const hasSimilarColoursRequest = similarColoursPattern.test(input.message);
        
        // Extract color values from mergedConstraints.colors (handles both array and ConstraintWithIntent formats)
        const mergedColorsValues = extractConstraintValues(mergedConstraints.colors);
        if (hasSimilarColoursRequest && mergedColorsValues && mergedColorsValues.length > 0) {
          try {
            const { expandColorsWithSimilarity } = await import('./color-similarity');
            const expandedColors = await expandColorsWithSimilarity(
              mergedColorsValues,
              0.8, // Higher threshold (0.8) to ensure only truly similar colors (e.g., red → burgundy, crimson, rose, NOT blue, purple, pink)
              5    // Limit to 5 similar colors max per original color
            );
            
            if (expandedColors.length > mergedColorsValues.length) {
              const originalColorsLength = mergedColorsValues.length;
              // Update mergedConstraints.colors with expanded colors (preserve intent if it's a ConstraintWithIntent object)
              if (mergedConstraints.colors && typeof mergedConstraints.colors === 'object' && !Array.isArray(mergedConstraints.colors) && 'intent' in mergedConstraints.colors) {
                // Preserve the intent structure
                const constraintWithIntent = mergedConstraints.colors as { values: string[]; intent: string; similarValues?: string[] };
                mergedConstraints.colors = { ...constraintWithIntent, values: expandedColors } as any;
              } else {
                // Old format - just set as array
                mergedConstraints.colors = expandedColors as any;
              }
              logger.info('color_expansion_for_similar_colours_request', {
                originalMessage: input.message.substring(0, 100),
                originalColors: mergedColorsValues,
                expandedColors,
                expansionCount: expandedColors.length - originalColorsLength,
                note: 'User requested similar colours, expanded color list using embedding similarity',
              });
            }
          } catch (error) {
            logger.warn('color_expansion_for_similar_colours_failed', {
              error: error instanceof Error ? error.message : String(error),
              originalColors: mergedColorsValues,
            });
            // Continue with original colors if expansion fails
          }
        }

        logger.info('constraints_merged_for_followup', {
          mergeAction: mergeResult.mergeAction,
          reason: mergeResult.reason,
          enhancedQuery: enhancedQueryText.substring(0, 100),
          hasPrice: !!mergedConstraints.priceMaxCents || !!mergedConstraints.priceMinCents,
          previousPrice: input.lastClassificationConstraints?.priceMaxCents,
          mergedPrice: mergedConstraints.priceMaxCents,
          hasSimilarColoursRequest,
          finalColorCount: mergedColorsValues?.length || 0,
        });

        // Update message to use enhanced query for remaining pipeline
        // This ensures the merged constraints go through categorization → dedupe → vector search → ranking
        input.message = enhancedQueryText;
        
        logger.debug('follow_up_enhanced_query_set', {
          originalMessage: input.message.substring(0, 100),
          willGoThroughFullPipeline: true,
        });
      } else if (mergeResult.mergeAction === 'new_search') {
        // LLM determined this is a new search - could be due to incompatibility OR age group switch
        // Check if mergedConstraints has preserved constraints (colors, occasions, etc.) - if so, it's age group switch
        mergedConstraints = mergeResult.mergedConstraints;
        const hasPreservedConstraints = mergedConstraints !== null && (
          mergedConstraints.colors !== undefined ||
          mergedConstraints.occasions !== undefined ||
          mergedConstraints.seasons !== undefined ||
          mergedConstraints.formalityLevel !== undefined ||
          mergedConstraints.priceMinCents !== undefined ||
          mergedConstraints.priceMaxCents !== undefined
        );
        
        if (hasPreservedConstraints) {
          // This is a new_search due to age group switch - preserve portable constraints
          // Age groups will be null in mergedConstraints (use classifier's age groups instead)
          // Treat as new search but keep preserved constraints
          isFollowUp = false; // Still a new search (not a follow-up)
          // Keep mergedConstraints as-is (it has preserved portable constraints with ageGroups: null)
          enhancedQueryText = mergeResult.enhancedQueryText; // Use the enhanced query (should be CURRENT_MESSAGE)
          
          logger.info('new_search_due_to_age_group_switch', {
            currentMessage: input.message.substring(0, 100),
            previousQuery: queryToMergeWith?.substring(0, 100),
            reason: mergeResult.reason,
            preservedConstraints: {
              colors: mergedConstraints?.colors,
              occasions: mergedConstraints?.occasions,
              seasons: mergedConstraints?.seasons,
              formalityLevel: mergedConstraints?.formalityLevel,
              price: mergedConstraints?.priceMinCents || mergedConstraints?.priceMaxCents ? 'preserved' : null,
            },
            note: 'Complete age group switch - treating as new search while preserving portable constraints',
          });
        } else {
          // Standard new_search - logically incompatible (e.g., bikinis + wedding)
          // Treat as a completely new search - reset all constraints
          isFollowUp = false;
          mergedConstraints = null; // Reset all constraints
          enhancedQueryText = mergeResult.enhancedQueryText; // Use the enhanced query (should be CURRENT_MESSAGE)
          
          logger.info('llm_determined_new_search_due_to_incompatibility', {
            currentMessage: input.message.substring(0, 100),
            previousQuery: queryToMergeWith?.substring(0, 100),
            reason: mergeResult.reason,
            note: 'Product type and occasion/context are logically incompatible - treating as new search',
          });
        }
        
        // Update message to use the enhanced query (which should be the current message as-is)
        input.message = enhancedQueryText;
        
        // Clear the previous enhanced query since this is a new search
        // The new enhanced query will be stored at the end of the function
        if (input.merchantId) {
          updateState(input.merchantId, input.sessionId, {
            memory: {
              ...conversationState.memory,
              lastEnhancedQuery: undefined, // Clear previous enhanced query for new search
            },
          }).catch(err => {
            logger.error('failed_to_clear_enhanced_query', {
              error: err instanceof Error ? err.message : String(err),
              sessionId: input.sessionId,
            });
          });
        }
        
        logger.info('llm_determined_new_search_due_to_incompatibility', {
          currentMessage: input.message.substring(0, 100),
          previousQuery: queryToMergeWith?.substring(0, 100),
          reason: mergeResult.reason,
          note: 'Product type and occasion/context are logically incompatible - treating as new search',
        });
      } else {
        // LLM determined this is not a follow-up - treat as new search
        isFollowUp = false;
        mergedConstraints = null;
        enhancedQueryText = input.message; // Use current message as-is
        
        // Clear the previous enhanced query since this is a new search
        if (input.merchantId) {
          updateState(input.merchantId, input.sessionId, {
            memory: {
              ...conversationState.memory,
              lastEnhancedQuery: undefined, // Clear previous enhanced query for new search
            },
          }).catch(err => {
            logger.error('failed_to_clear_enhanced_query', {
              error: err instanceof Error ? err.message : String(err),
              sessionId: input.sessionId,
            });
          });
        }
        
        logger.debug('llm_determined_not_followup', {
          currentMessage: input.message.substring(0, 100),
          previousQuery: queryToMergeWith?.substring(0, 100),
          mergeAction: mergeResult.mergeAction,
          reason: mergeResult.reason,
        });
      }
    } catch (error) {
      logger.warn('follow_up_merge_failed_falling_back', {
        error: error instanceof Error ? error.message : String(error),
        currentMessage: input.message.substring(0, 100),
      });
      // Fallback: continue as normal query
    }
  } else {
    logger.debug('not_checking_followup', {
      currentMessage: input.message.substring(0, 100),
      hasQueryToMergeWith,
      hasPreviousConstraints,
      isShortMessage,
      matchesFollowUpPattern,
      messageLength: messageWords,
    });
  }

  // ============================================================================
  // STEP 2.6: Extract Gender and AgeGroup FIRST (before category classification)
  // Priority: explicit query > lastConstraints > defaults
  // ============================================================================
  const { detectGenderFromQuery } = await import('./gender-detector');
  const { normalizeAgeGroups, isCanonicalAgeGroup } = await import('./age-group-normalizer');
  
  // Extract gender: priority = explicit query > product type inference > mergedConstraints > lastConstraints > null
  let resolvedGender: 'male' | 'female' | null = null;
  const queryGender = detectGenderFromQuery(input.message);
  if (queryGender) {
    resolvedGender = queryGender;
  } else {
    // Infer gender from product type if query mentions specific product types
    const queryLowerForGender = input.message.toLowerCase();
    const femaleProductTypes = ['dress', 'dresses', 'blouse', 'blouses', 'skirt', 'skirts', 'maxi', 'mini', 'midi'];
    const maleProductTypes = ['shirt', 'shirts', 'polo', 'polos'];
    
    // Female style indicators (especially for jeans/pants)
    const femaleStyleIndicators = ['high-rise', 'high rise', 'skinny', 'skinny fit', 'jegging', 'jeggings', 'mom jeans', 'wide leg', 'wide-leg', 'flared', 'bootcut'];
    // Male style indicators
    const maleStyleIndicators = ['relaxed fit', 'straight leg', 'straight-leg', 'loose fit', 'baggy'];
    
    const hasFemaleProductType = femaleProductTypes.some(type => queryLowerForGender.includes(type));
    const hasMaleProductType = maleProductTypes.some(type => queryLowerForGender.includes(type));
    const hasFemaleStyle = femaleStyleIndicators.some(style => queryLowerForGender.includes(style));
    const hasMaleStyle = maleStyleIndicators.some(style => queryLowerForGender.includes(style));
    
    // Check if query mentions jeans/pants with female style indicators
    const hasJeansOrPants = queryLowerForGender.includes('jean') || queryLowerForGender.includes('pant');
    const isFemaleJeans = hasJeansOrPants && hasFemaleStyle && !hasMaleStyle;
    
    if (hasFemaleProductType && !hasMaleProductType) {
      resolvedGender = 'female';
    } else if (hasMaleProductType && !hasFemaleProductType) {
      resolvedGender = 'male';
    } else if (isFemaleJeans) {
      // High-rise skinny jeans, mom jeans, etc. are typically women's
      resolvedGender = 'female';
    } else if (mergedConstraints?.gender && mergedConstraints.gender !== 'unisex') {
      resolvedGender = mergedConstraints.gender as 'male' | 'female';
    } else if (input.lastClassificationConstraints?.gender && input.lastClassificationConstraints.gender !== 'unisex') {
      resolvedGender = input.lastClassificationConstraints.gender as 'male' | 'female';
    }
  }
  
  // Extract ageGroup: priority = explicit query > mergedConstraints > lastConstraints > 'Adult'
  let resolvedAgeGroup: string | null = 'Adult'; // Default to Adult
  
  // First, try to extract ageGroup directly from query text
  const queryLower = input.message.toLowerCase();
  const ageGroupKeywords: Record<string, string> = {
    'baby': 'Baby',
    'babies': 'Baby',
    'infant': 'Baby',
    'infants': 'Baby',
    'for baby': 'Baby',
    'for babies': 'Baby',
    'for my baby': 'Baby',
    'kids': 'Kids',
    'kid': 'Kids',
    'children': 'Kids',
    'child': 'Kids',
    'for kids': 'Kids',
    'for children': 'Kids',
    'for my 5 year old': 'Kids',
    'for my 6 year old': 'Kids',
    'for my 7 year old': 'Kids',
    'for my 8 year old': 'Kids',
    'for my 9 year old': 'Kids',
    'toddler': 'Toddler',
    'toddlers': 'Toddler',
    'for toddler': 'Toddler',
    'teen': 'Teen',
    'teens': 'Teen',
    'teenager': 'Teen',
    'teenagers': 'Teen',
    'tween': 'Tween',
    'tweens': 'Tween',
    'pre-teen': 'Tween',
    'preteen': 'Tween',
  };
  
  let queryAgeGroup: string | null = null;
  // Sort keywords by length (longest first) to match longer phrases first
  const sortedKeywords = Object.entries(ageGroupKeywords).sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, ageGroup] of sortedKeywords) {
    if (new RegExp(`\\b${keyword}\\b`).test(queryLower)) {
      queryAgeGroup = ageGroup;
      break;
    }
  }
  
  // If found in query, use it; otherwise check constraints
  let queryAgeGroups: string[] | null = null;
  if (queryAgeGroup) {
    resolvedAgeGroup = queryAgeGroup;
  } else {
    queryAgeGroups = mergedConstraints?.ageGroups 
      ? (extractConstraintValues(mergedConstraints.ageGroups) ?? null)
      : (input.lastClassificationConstraints?.ageGroups 
          ? (extractConstraintValues(input.lastClassificationConstraints.ageGroups) ?? null)
          : null);
    
    if (queryAgeGroups && queryAgeGroups.length > 0) {
      const normalized = normalizeAgeGroups(queryAgeGroups);
      resolvedAgeGroup = normalized.length > 0 ? normalized[0] : 'Adult';
    }
  }
  
  logger.info('gender_and_agegroup_extracted_early', {
    query: input.message.substring(0, 100),
    resolvedGender,
    resolvedAgeGroup,
    genderSource: queryGender ? 'query' : (mergedConstraints?.gender ? 'merged' : (input.lastClassificationConstraints?.gender ? 'lastConstraints' : 'none')),
    ageGroupSource: queryAgeGroup ? 'query' : (queryAgeGroups ? (mergedConstraints?.ageGroups ? 'merged' : 'lastConstraints') : 'default'),
  });

  // Step 3: Query Categorization
  // For merged follow-ups, we skip the indirect_search check since we know it's a follow-up refinement
  // and should proceed through the full pipeline (categorization → dedupe → vector search → ranking)
  onProgress?.('classifying', STAGE_PROGRESS.classifying);
  const categorization = await categorizeQuery(
    input.message,
    input.merchantData?.datasetContext,
    input.merchantId
  );

  logger.info('query_categorization_result', {
    query: input.message,
    category: categorization.category,
    confidence: categorization.confidence,
    note: 'Query categorizer classification result',
  });

  // topCategories is already declared earlier - update it with safety check categories if available
  if (safetyCheckCategories) {
    topCategories = safetyCheckCategories;
  }

  // Handle irrelevant queries - intelligently decide redirect vs deny
  // Skip this check if we already found categories from safety check
  if (categorization.category === 'irrelevant' && !safetyCheckCategories) {
    logger.info('irrelevant_query_intelligent_handling', {
      query: input.message,
      note: 'Analyzing irrelevant query to determine if redirect or deny',
    });

    // Get product context from conversation history
    const productContext = conversationState.shownProductIds?.length > 0
      ? await prisma.product.findMany({
          where: {
            id: { in: conversationState.shownProductIds.slice(-5) },
            merchantId: input.merchantId,
          },
          select: { id: true, title: true },
        }).then(products => products.map(p => ({ productId: p.id, title: p.title || '' })))
      : undefined;

    // Intelligently decide: redirect or deny
    const decision = await handleIrrelevantQuery(
      input.message,
      input.merchantData?.datasetContext,
      undefined, // Will fetch from ontology
      productContext
    );

    if (decision.action === 'deny') {
      // Generate intelligent denial reply
      onProgress?.('generating', STAGE_PROGRESS.generating);
      const denialReply = await generateIntelligentDenial(
        input.message,
        decision.reason,
        input.merchantData?.brandName || 'LoveShackFancy',
        input.history
      );

      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: denialReply,
        productCards: [],
        noExactMatch: true,
        route: 'DENIED',
      };
    } else {
      // Redirect: Will use main category classification after gender extraction
      // Category classification now happens after gender extraction with gender-filtered categories
      const potentialCategories = decision.potentialCategories || [];
      logger.info('irrelevant_query_redirected_category_unclear', {
        query: input.message,
        potentialCategories,
        note: 'Generating intelligent redirect with segue to product discovery',
      });

      onProgress?.('generating', STAGE_PROGRESS.generating);
      const followups = await generateFollowUpQuestions(
        input.message,
        categorization.preliminaryProducts,
        input.merchantData?.datasetContext,
        potentialCategories,
        true // Mark as unrelated query for intelligent redirect
      );

      // Store in conversation state
      if (input.merchantId) {
        updateState(input.merchantId, input.sessionId, {
          memory: {
            ...conversationState.memory,
            pendingFollowups: {
              originalQuery: input.message,
              questions: followups.questions,
              responses: [],
              preliminaryProducts: categorization.preliminaryProducts,
            },
          },
        }).catch(err => logger.warn('state_update_failed', {
          error: err instanceof Error ? err.message : String(err),
          context: 'store_pending_followups_irrelevant_redirect',
        }));
      }

      onProgress?.('complete', STAGE_PROGRESS.complete);
      const firstQuestion = followups.questions.length > 0
        ? `\n\n${followups.questions[0]}`
        : '';
      const replyText = `${followups.contextSummary}${firstQuestion}`;
      
      return {
        replyText,
        productCards: [],
        noExactMatch: true,
        route: 'CLARIFICATION_NEEDED',
      };
    }
  }

  // Category classification now happens AFTER gender/ageGroup extraction (see below)
  // This ensures gender-filtered categories are used

  // Step 4: Query classification (for direct_search or enhanced queries)
  // Step 3.5: Category Classification (for product discovery only) - run in parallel when both are needed
  // Optimize: Run classifyQuery and classifyQueryToCategories in parallel for direct_search queries
  // Also run category classification for indirect_search queries that are follow-ups, have clear category signals,
  // or have already been classified above (when category was identified for indirect_search)
  onProgress?.('understanding', STAGE_PROGRESS.understanding);
  let classification: QueryClassification;
  let classificationMetadata = {
    usedStrictMajorityMode: false,
    genderContext: null as 'male' | 'female' | null,
  };
  
  // Determine if we should run category classification
  // ALWAYS run category classification for follow-ups to re-judge category
  // For new queries, only run if we don't already have categories
  // Note: If we already ran category classification above for indirect_search and got results, topCategories is already set
  // and we should skip running it again (unless it's a follow-up)
  const alreadyHasCategories = topCategories.length > 0;
  const shouldRunCategoryClassification = isFollowUp || (
    !alreadyHasCategories && (
      categorization.category === 'direct_search' 
      || (categorization.category === 'indirect_search' && (
        // Check for clear category signals OR product types in the query
        /\b(newborn|baby|infant|toddler|kids?|children|girls?|boys?|women|men|adult|home|decor|bedding|tabletop|bath|personal care|accessories?|juvenile|youth|adolescent|teen|teenage|teenager|young|pre-teen|tween|dress|dresses|top|tops|bottom|bottoms|skirt|skirts|swimsuit|swimwear|bikini|shoes|jewelry|perfume|candle|towel|towels|pajama|robe|sweater|cardigan|loungewear|activewear)\b/i.test(input.message)
      ))
    )
  );
  
  // If this is a direct_search or an indirect_search with context, run category classification FIRST,
  // then constraint extraction with category-specific dictionaries
  if (shouldRunCategoryClassification) {
    logger.info('sequential_classification_category_first_then_constraints', {
      query: input.message.substring(0, 100),
      categorizationCategory: categorization.category,
      isFollowUp,
      hasCategorySignals: /\b(newborn|baby|infant|toddler|kids?|children|girls?|boys?|women|men|adult|home|decor|bedding|tabletop|bath|personal care|accessories?|juvenile|youth|adolescent|teen|teenage|teenager|young|pre-teen|tween|dress|dresses|top|tops|bottom|bottoms|skirt|skirts|swimsuit|swimwear|bikini|shoes|jewelry|perfume|candle|towel|towels|pajama|robe|sweater|cardigan|loungewear|activewear)\b/i.test(input.message),
    });
    
    onProgress?.('classifying', 20);
    
    // ============================================================================
    // STEP 2.7: Filter allowed categories by gender BEFORE classification
    // ============================================================================
    // Detect if product type is explicitly mentioned (for gender-agnostic category matching)
    const queryLower = input.message.toLowerCase();
    const productTypeKeywords = [
      'top', 'tops', 'dress', 'dresses', 'jeans', 'pants', 'shirt', 'shirts', 'blouse', 'blouses',
      'skirt', 'skirts', 'shorts', 'swimsuit', 'swimwear', 'bikini', 'loungewear', 'pajama', 'robe',
      'sweater', 'sweaters', 'cardigan', 'cardigans', 'jacket', 'jackets', 'coat', 'activewear',
      'jewelry', 'accessories', 'bag', 'bags', 'tote', 'wallet', 'belt', 'scarf',
      'perfume', 'perfumes', 'fragrance', 'scents',
      'bedding', 'bed sheets', 'towels', 'candle', 'candles', 'decor', 'decoration', 'tabletop',
      'kitchenware', 'dishware', 'bottoms', 'hoodie', 'hoodies', 'pullover', 'pullovers'
    ];
    const hasExplicitProductType = productTypeKeywords.some(keyword => queryLower.includes(keyword));
    
    const { buildAllowedCategoriesForClassifier } = await import('./classifier');
    const { categoriesForPrompt } = buildAllowedCategoriesForClassifier(resolvedGender, hasExplicitProductType);
    
    logger.info('categories_filtered_before_classification', {
      query: input.message.substring(0, 100),
      resolvedGender,
      hasExplicitProductType,
      totalCategories: categoriesForPrompt.length,
      sampleCategories: categoriesForPrompt.slice(0, 10),
    });
    
    // ============================================================================
    // STEP 1: Category Classification (runs FIRST)
    // ============================================================================
    const classificationStartTime = Date.now();
    let categoryResult: { categories: string[]; confidence: number };
    
    try {
      const queryForCategoryClassification = isFollowUp && enhancedQueryText ? enhancedQueryText : input.message;
      
      console.log('[ORCHESTRATOR] Calling category classification (sequential - step 1)', {
        query: queryForCategoryClassification.substring(0, 100),
        originalMessage: input.message.substring(0, 100),
        isFollowUp,
        usingEnhancedQuery: isFollowUp && enhancedQueryText,
        merchantId: input.merchantId,
        categorizationCategory: categorization.category,
      });
      logger.info('category_classification_calling_function_sequential', {
        query: queryForCategoryClassification.substring(0, 100),
        originalMessage: input.message.substring(0, 100),
        isFollowUp,
        usingEnhancedQuery: isFollowUp && enhancedQueryText,
        merchantId: input.merchantId,
        categorizationCategory: categorization.category,
      });
      
      const result = await classifyQueryToCategoriesWithConfidence(
        queryForCategoryClassification, 
        input.merchantId,
        categoriesForPrompt.length > 0 ? categoriesForPrompt : undefined
      );
      
      console.log('[ORCHESTRATOR] Category classification result (with confidence)', {
        query: queryForCategoryClassification.substring(0, 100),
        originalMessage: input.message.substring(0, 100),
        isFollowUp,
        categories: result.categories,
        count: result.categories.length,
        confidence: result.confidence,
        categorizationCategory: categorization.category,
      });
      logger.info('category_classification_complete_with_confidence_sequential', {
        query: queryForCategoryClassification.substring(0, 100),
        originalMessage: input.message.substring(0, 100),
        isFollowUp,
        usingEnhancedQuery: isFollowUp && enhancedQueryText,
        categorizationCategory: categorization.category,
        categories: result.categories,
        categoryCount: result.categories.length,
        confidence: result.confidence,
      });
      
      if (result.categories.length > 0) {
        logger.info('category_filter_will_be_applied', {
          query: input.message.substring(0, 100),
          categories: result.categories,
          filterType: 'hard_sql_level',
          appliesTo: 'multi_view_retrieval',
        });
      }
      
      categoryResult = { categories: result.categories, confidence: result.confidence };
    } catch (error) {
      console.error('[ORCHESTRATOR] Category classification error', error);
      logger.warn('category_classification_failed_continuing', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        query: input.message.substring(0, 100),
      });
      categoryResult = { categories: [], confidence: 0 };
    }
    
    // ============================================================================
    // STEP 2: Constraint Classification (runs AFTER category classification with category-specific dictionaries)
    // ============================================================================
    let classificationResult: ClassificationWithMetadata;
    const constraintsForClassifier = isFollowUp && mergedConstraints
      ? mergedConstraints
      : null;
    
    try {
      logger.info('constraint_classification_calling_sequential_after_categories', {
        query: input.message.substring(0, 100),
        classifiedCategories: categoryResult.categories,
        categoryCount: categoryResult.categories.length,
        willUseCategorySpecificDictionaries: categoryResult.categories.length > 0,
      });
      
      const result = await classifyQueryWithMetadata(
        input.message, 
        constraintsForClassifier, 
        enhancedQueryText,
        categoryResult.categories.length > 0 ? categoryResult.categories : undefined // Pass classified categories for category-specific dictionaries
      );
      classificationResult = result;
    } catch (error) {
      logger.error('handleLoveshackfancyQuery: classification failed', {
        error: error instanceof Error ? error.message : String(error),
        message: input.message.substring(0, 100),
      });
      
      // Fallback 1: Try semantic matching via embeddings
      try {
        const { extractConstraintsViaEmbeddings } = await import('./classifier-semantic');
        const result = await extractConstraintsViaEmbeddings(input.message);
        
        if (result.confidence > 0.3) {
          logger.debug('handleLoveshackfancyQuery: using semantic fallback', {
            type: result.type,
            constraints: result.constraints,
            confidence: result.confidence,
          });
          classificationResult = {
            classification: result,
            usedStrictMajorityMode: false,
            genderContext: null,
          };
        } else {
          // Fallback 2: Use keyword-based classification
          const { inferClassificationFromKeywords } = await import('./classifier');
          const result = inferClassificationFromKeywords(input.message);
          logger.debug('handleLoveshackfancyQuery: using keyword fallback', {
            type: result.type,
            constraints: result.constraints,
          });
          classificationResult = {
            classification: result,
            usedStrictMajorityMode: false,
            genderContext: null,
          };
        }
      } catch (fallbackError) {
        // Final fallback: keyword-based classification
        logger.warn('handleLoveshackfancyQuery: semantic fallback failed', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        const { inferClassificationFromKeywords } = await import('./classifier');
        const result = inferClassificationFromKeywords(input.message);
        logger.debug('handleLoveshackfancyQuery: using keyword fallback', {
          type: result.type,
          constraints: result.constraints,
        });
        classificationResult = {
          classification: result,
          usedStrictMajorityMode: false,
          genderContext: null,
        };
      }
    }
    
    // Extract classification and metadata
    classification = classificationResult.classification;
    classificationMetadata = {
      usedStrictMajorityMode: classificationResult.usedStrictMajorityMode,
      genderContext: classificationResult.genderContext,
    };
    
    logger.info('classification_metadata_extracted', {
      query: input.message.substring(0, 100),
      usedStrictMajorityMode: classificationMetadata.usedStrictMajorityMode,
      genderContext: classificationMetadata.genderContext,
      classificationConfidence: classification.confidence,
      classifiedGender: classification.constraints.gender,
    });
    
    // Store category confidence for later use in dynamic threshold calculation
    categoryConfidenceForThreshold = categoryResult.confidence;
    
    // CRITICAL: For follow-ups, ALWAYS update topCategories with the enhanced query's categories
    // The enhanced query may have a different product type (e.g., "hoodies" vs "dresses")
    // For new queries, only set if topCategories is empty (wasn't set earlier)
    if (isFollowUp) {
      // Always update categories for follow-ups based on the enhanced query
      if (categoryResult.categories.length > 0) {
        topCategories = categoryResult.categories;
        logger.info('category_categories_updated_for_followup_from_enhanced_query', {
          query: input.message.substring(0, 100),
          enhancedQuery: enhancedQueryText.substring(0, 100),
          categories: topCategories,
          confidence: categoryResult.confidence,
          note: 'Categories re-classified based on enhanced query for follow-up',
        });
      }
    } else if (topCategories.length === 0 && categoryResult.categories.length > 0) {
      // For new queries, only set if topCategories wasn't set earlier
      topCategories = categoryResult.categories;
      logger.info('category_categories_set_from_sequential_classification', {
        query: input.message.substring(0, 100),
        categories: topCategories,
        confidence: categoryResult.confidence,
      });
    }

  } else {
    // Not a direct_search - only run query classification
    try {
      const constraintsForClassification = isFollowUp && mergedConstraints
        ? mergedConstraints
        : null;
      
      const classificationWithMetadata = await classifyQueryWithMetadata(input.message, constraintsForClassification, enhancedQueryText);
      classification = classificationWithMetadata.classification;
      classificationMetadata = {
        usedStrictMajorityMode: classificationWithMetadata.usedStrictMajorityMode,
        genderContext: classificationWithMetadata.genderContext,
      };
      
      logger.info('classification_metadata_extracted_else_branch', {
        query: input.message.substring(0, 100),
        usedStrictMajorityMode: classificationMetadata.usedStrictMajorityMode,
        genderContext: classificationMetadata.genderContext,
        classificationConfidence: classification.confidence,
        classifiedGender: classification.constraints.gender,
      });
      
      // If we merged constraints, override classification constraints with merged ones
      if (isFollowUp && mergedConstraints) {
        classification.constraints = mergedConstraints;
        logger.debug('classification_constraints_overridden_with_merged', {
          mergeAction: 'follow_up_merge',
          hasPrice: !!mergedConstraints.priceMaxCents || !!mergedConstraints.priceMinCents,
        });
      }
    } catch (error) {
      logger.error('handleLoveshackfancyQuery: classification failed', {
        error: error instanceof Error ? error.message : String(error),
        message: input.message.substring(0, 100),
      });
      
      // Fallback 1: Try semantic matching via embeddings
      try {
        const { extractConstraintsViaEmbeddings } = await import('./classifier-semantic');
        classification = await extractConstraintsViaEmbeddings(input.message);
        
        if (classification.confidence > 0.3) {
          logger.debug('handleLoveshackfancyQuery: using semantic fallback', {
            type: classification.type,
            constraints: classification.constraints,
            confidence: classification.confidence,
          });
        } else {
          // Fallback 2: Use keyword-based classification
          const { inferClassificationFromKeywords } = await import('./classifier');
          classification = inferClassificationFromKeywords(input.message);
          logger.debug('handleLoveshackfancyQuery: using keyword fallback', {
            type: classification.type,
            constraints: classification.constraints,
          });
        }
      } catch (fallbackError) {
        // Final fallback: keyword-based classification
        logger.warn('handleLoveshackfancyQuery: semantic fallback failed', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        const { inferClassificationFromKeywords } = await import('./classifier');
        classification = inferClassificationFromKeywords(input.message);
        logger.debug('handleLoveshackfancyQuery: using keyword fallback', {
          type: classification.type,
          constraints: classification.constraints,
        });
      }
    }
    
    logger.debug('category_classification_skipped', {
      query: input.message.substring(0, 100),
      categorizationCategory: categorization.category,
      isFollowUp,
      reason: 'indirect_search_without_followup_or_category_signals',
    });
  }

  // ============================================================================
  // STEP 2.8: Filter categories AFTER classification by resolved gender
  // Always run this after category classification (regardless of which branch was taken)
  // ============================================================================
  if (topCategories.length > 0 && resolvedGender) {
    const { getCategoryGender } = await import('../catalog/category-gender-map');
    
    const genderFilteredCategories = topCategories.filter((cat) => {
      const categoryGender = getCategoryGender(cat);
      // If category has no gender mapping, keep it (unknown/unisex)
      if (!categoryGender) return true;
      // Keep categories that match resolved gender or are unisex
      return categoryGender === resolvedGender || categoryGender === 'unisex';
    });
    
    logger.info('categories_filtered_by_gender_after_classification', {
      query: input.message.substring(0, 100),
      resolvedGender,
      originalCategories: topCategories,
      filteredCategories: genderFilteredCategories,
      removedCount: topCategories.length - genderFilteredCategories.length,
    });
    
    if (genderFilteredCategories.length > 0) {
      topCategories = genderFilteredCategories;
    } else {
      // If all categories are incompatible with the resolved gender, drop category filter entirely.
      // Gender will still be enforced as a hard SQL filter, preventing cross-gender results.
      logger.warn('category_gender_filter_removed_all_categories', {
        query: input.message.substring(0, 100),
        originalCategories: topCategories,
        resolvedGender,
        note: 'All category candidates were incompatible with gender; proceeding with gender-only filtering.',
      });
      topCategories = [];
    }
  }

  // Handle unrelated queries from classification (backup check)
  // Only mark as unrelated if it truly doesn't match any category
  // Home decor queries (bedding, tabletop, decor items, etc.) are valid and should proceed
  if (classification.type === 'unrelated') {
    // Double-check: if query categorizer said it's direct_search or indirect_search,
    // then it's shopping-related and we should proceed (fashion classifier might be wrong)
    if (categorization.category === 'direct_search' || categorization.category === 'indirect_search') {
      logger.warn('fashion_classifier_marked_unrelated_but_categorizer_says_shopping', {
        query: input.message.substring(0, 100),
        fashionType: classification.type,
        categorizationCategory: categorization.category,
        action: 'proceeding_with_search',
      });
      // Override: proceed with search since categorizer says it's shopping-related
      // Change type to direct_product_search to allow search to proceed
      classification.type = 'direct_product_search';
    } else {
      // Both agree it's unrelated - treat as potential indirect product search
      logger.info('unrelated_query_from_classification_attempting_category_classification', {
        query: input.message,
        note: 'Both classifier and categorizer agree it\'s unrelated, but treating as potential indirect product search',
      });
      
      // Category classification already happened in main flow (after gender extraction)
      // If topCategories is set, use it; otherwise generate follow-up questions
      if (topCategories.length > 0) {
        // Category was identified in main classification - proceed with discovery
        logger.info('unrelated_query_from_classification_category_identified_proceeding', {
          query: input.message,
          categories: topCategories,
          note: 'Category classification succeeded in main flow, proceeding with product discovery',
        });
        
        // Override classification type to allow search to proceed
        classification.type = 'direct_product_search';
        // Continue with normal flow - topCategories is set, proceed to search pipeline
      } else {
        // Category unclear - generate witty follow-up questions to divert to product discovery
        const potentialCategories: string[] = [];
        // categoryResult is only in scope if shouldRunCategoryClassification was true
        // Since topCategories.length === 0, category classification either didn't run or found no categories
        // Use 0 as default confidence
        logger.info('unrelated_query_from_classification_category_unclear_generating_witty_followup', {
          query: input.message,
          potentialCategories,
          confidence: 0,
          note: 'Category classification unclear, generating witty follow-up questions to divert to product discovery',
        });
        
        onProgress?.('generating', STAGE_PROGRESS.generating);
        const followups = await generateFollowUpQuestions(
          input.message,
          undefined, // No preliminary products for unrelated queries
          input.merchantData?.datasetContext,
          potentialCategories,
          true // Mark as unrelated query for wittier diversion
        );
        logger.info('unrelated_query_from_classification_followup_questions_received', {
          query: input.message,
          contextSummary: followups.contextSummary.substring(0, 150),
          questionCount: followups.questions.length,
        });

        // Store in conversation state for next turn (fire-and-forget - non-blocking)
        if (input.merchantId) {
          updateState(input.merchantId, input.sessionId, {
            memory: {
              ...conversationState.memory,
              pendingFollowups: {
                originalQuery: input.message,
                questions: followups.questions,
                responses: [],
                preliminaryProducts: undefined,
              },
            },
          }).catch(err => logger.warn('state_update_failed', { 
            error: err instanceof Error ? err.message : String(err),
            context: 'store_pending_followups_unrelated_from_classification'
          }));
        }

        onProgress?.('complete', STAGE_PROGRESS.complete);
        // Show witty contextSummary (diverting to product discovery) followed by first question only
        const firstQuestion = followups.questions.length > 0 
          ? `\n\n${followups.questions[0]}`
          : '';
        const replyText = `${followups.contextSummary}${firstQuestion}`;
        logger.info('unrelated_query_from_classification_reply_constructed', {
          query: input.message,
          contextSummaryLength: followups.contextSummary.length,
          questionsCount: followups.questions.length,
          replyTextPreview: replyText.substring(0, 200),
        });
        return {
          replyText,
          productCards: [],
          noExactMatch: true,
          route: 'CLARIFICATION_NEEDED',
        };
      }
    }
  }

  // Step 3.6: Parse query to separate product terms from constraints (NEW)
  // This provides better vector search (using clean product terms) and constraint-based ranking
  // Step 3.7: Fix misclassified colors in patterns (if any)
  // Move color terms that were incorrectly classified as patterns to colors
  const colorTerms = ['Cherry', 'Crimson', 'Scarlet', 'Burgundy', 'Maroon', 'Rose', 'Coral', 'Salmon', 'Rust', 'Terracotta'];
  const patternValues = extractConstraintValues(classification.constraints.patterns) || (Array.isArray(classification.constraints.patterns) ? classification.constraints.patterns : []);
  if (patternValues.length > 0) {
    const misclassifiedColors: string[] = [];
    const remainingPatterns: string[] = [];
    
    for (const pattern of patternValues) {
      const patternLower = pattern.toLowerCase();
      const isColorTerm = colorTerms.some(color => color.toLowerCase() === patternLower);
      
      if (isColorTerm) {
        misclassifiedColors.push(pattern);
      } else {
        remainingPatterns.push(pattern);
      }
    }
    
    if (misclassifiedColors.length > 0) {
      // Move misclassified colors from patterns to colors
      const currentColors = extractConstraintValues(classification.constraints.colors) || (Array.isArray(classification.constraints.colors) ? classification.constraints.colors : []);
      const colorIntent = extractConstraintIntent(classification.constraints.colors);
      const updatedColors = Array.from(new Set([...currentColors, ...misclassifiedColors]));
      // Preserve intent format if it existed
      classification.constraints.colors = colorIntent ? { values: updatedColors, intent: colorIntent } : updatedColors;
      
      const patternIntent = extractConstraintIntent(classification.constraints.patterns);
      // Preserve intent format if it existed
      classification.constraints.patterns = remainingPatterns.length > 0 
        ? (patternIntent ? { values: remainingPatterns, intent: patternIntent } : remainingPatterns)
        : null;
      
      logger.debug('orchestrator_color_correction_from_classification_patterns', {
        query: input.message.substring(0, 100),
        misclassifiedColors,
        correctedColors: classification.constraints.colors,
        correctedPatterns: classification.constraints.patterns,
        note: 'Moved color terms from patterns to colors in classification result',
      });
    }
  }

  // Step 3.8: Pattern matching is now handled by LLM using dictionaries
  // No hardcoded synonym expansion - LLM finds closest matches from database dictionaries

  // Update classification constraints with resolved gender (if available)
  // Gender was already extracted early, so just add it to classification constraints
  if (resolvedGender) {
    classification.constraints.gender = resolvedGender;
    logger.info('gender_added_to_classification_constraints', {
      gender: resolvedGender,
      isFollowUp,
      note: 'Gender extracted early and added to classification constraints',
    });
  }


  // ============================================================================
  // CLARIFICATION TRIGGERS: Check for unclear constraints and request clarification
  // ============================================================================
  // If no categories were identified, ask for clarification
  const needsClarification = topCategories.length === 0;
  
  // Log trigger evaluation for debugging
  logger.debug('clarification_triggers_evaluation', {
    query: input.message.substring(0, 100),
    topCategoriesCount: topCategories.length,
    classificationType: classification.type,
    hasProductTerms: !!classification.productTerms,
    productTerms: classification.productTerms,
    classificationConfidence: classification.confidence,
    needsClarification,
  });

  if (needsClarification) {
    // Determine clarification reason for logging
    const clarificationReasons: string[] = ['no_categories'];

    logger.info('clarification_triggered', {
      query: input.message.substring(0, 100),
      reasons: clarificationReasons,
      topCategoriesCount: topCategories.length,
      classificationType: classification.type,
      hasProductTerms: !!classification.productTerms,
      classificationConfidence: classification.confidence,
      note: 'Constraints are unclear - requesting clarification before retrieval',
    });

    onProgress?.('generating', STAGE_PROGRESS.generating);
    
    // Generate gender-neutral clarification questions (isUnrelated=false)
    const followups = await generateFollowUpQuestions(
      input.message,
      undefined, // No preliminary products for constraint clarification
      input.merchantData?.datasetContext,
      topCategories.length > 0 ? topCategories : undefined,
      false // Mark as related query for gender-neutral clarification voice
    );

    logger.info('clarification_followup_questions_received', {
      query: input.message.substring(0, 100),
      contextSummary: followups.contextSummary.substring(0, 150),
      questionCount: followups.questions.length,
      reasons: clarificationReasons,
    });

    // Store in conversation state for next turn (fire-and-forget - non-blocking)
    if (input.merchantId) {
      updateState(input.merchantId, input.sessionId, {
        memory: {
          ...conversationState.memory,
          pendingFollowups: {
            originalQuery: input.message,
            questions: followups.questions,
            responses: [],
            preliminaryProducts: undefined,
          },
        },
      }).catch(err => logger.warn('state_update_failed', { 
        error: err instanceof Error ? err.message : String(err),
        context: 'store_pending_followups_constraint_clarification'
      }));
    }

    onProgress?.('complete', STAGE_PROGRESS.complete);
    // Show contextSummary followed by first question only
    const firstQuestion = followups.questions.length > 0 
      ? `\n\n${followups.questions[0]}`
      : '';
    const replyText = `${followups.contextSummary}${firstQuestion}`;
    
    logger.info('clarification_reply_constructed', {
      query: input.message.substring(0, 100),
      contextSummaryLength: followups.contextSummary.length,
      questionsCount: followups.questions.length,
      replyTextPreview: replyText.substring(0, 200),
      reasons: clarificationReasons,
    });

    return {
      replyText,
      productCards: [],
      noExactMatch: true,
      route: 'CLARIFICATION_NEEDED',
    };
  }
  
  // Classification constraints are already sufficient - use them directly for retrieval

  // Step 4: Multi-view retrieval
  // Use product terms from classification for vector search
  // Pass top categories for hard SQL-level filtering (applied BEFORE retrieval)
  // Category filter hard filters the catalog at SQL level before vector/lexical search
  onProgress?.('retrieving', STAGE_PROGRESS.retrieving);
  
  if (topCategories.length > 0) {
    logger.info('category_filter_applied_to_retrieval', {
      query: input.message.substring(0, 100),
      categories: topCategories,
      filterType: 'hard_sql_level',
      note: 'Catalog will be filtered to these categories before multi-view retrieval',
    });
  }
  
  const retrievalStartTime = Date.now();
  logger.info('handleLoveshackfancyQuery: starting_retrieval', {
    query: input.message.substring(0, 100),
    productTerms: classification.productTerms,
    classificationType: classification.type,
    categoryCount: topCategories.length,
  });
  
  let retrievalResult: MultiViewRetrievalResult;
  try {
    retrievalResult = await multiViewRetrieval(
      input.message,
      classification,
      classification.productTerms, // Pass product terms for better vector search
      input.merchantId,
      input.searchMethods,
      topCategories.length > 0 ? topCategories : undefined, // Pass top categories for HARD SQL-level filtering
      categoryConfidenceForThreshold, // Pass category confidence for post-filtering
      resolvedGender, // Pass as HARD SQL filter (never relaxed)
      resolvedAgeGroup // Pass as HARD SQL filter (never relaxed)
    );
  } catch (error) {
    logger.error('handleLoveshackfancyQuery: retrieval failed', {
      error: error instanceof Error ? error.message : String(error),
      message: input.message.substring(0, 100),
    });
    // Generate intelligent reply using LLM
    // Note: constraintsForRanking not yet available at this point, use mergedConstraints or undefined
    const { generateRegretfulReply } = await import('./reply');
    const regretfulReply = await generateRegretfulReply(
      input.message,
      0, // productCount
      0, // topScore
      input.merchantData?.brandName || 'LoveShackFancy',
      enhancedQueryText, // Enhanced query
      queryToMergeWith || undefined, // Previous query context
      mergedConstraints || undefined, // Use mergedConstraints if available, otherwise undefined
      input.history // Conversation history
    );
    
    // Build minimal constraints from classification for early return
    // classification should be set before retrieval, but check if it exists
    if (!classification) {
      // Fallback: try to get classification if it wasn't set
      try {
        const classificationWithMetadata = await classifyQueryWithMetadata(input.message, mergedConstraints || null, enhancedQueryText);
        classification = classificationWithMetadata.classification;
      } catch (e) {
        logger.warn('handleLoveshackfancyQuery: failed to get classification for early return', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const earlyReturnConstraints = classification?.constraints || {};
    // Use extractConstraintValues from constraint-utils (already imported)
    // Convert null to undefined for SearchConstraints type
    const resolvedConstraints: SearchConstraints = {
      colors: extractConstraintValues(earlyReturnConstraints.colors) || undefined,
      sizes: extractConstraintValues(earlyReturnConstraints.sizes) || undefined,
      materials: extractConstraintValues(earlyReturnConstraints.materials) || undefined,
      occasions: extractConstraintValues(earlyReturnConstraints.occasions) || undefined,
      seasons: extractConstraintValues(earlyReturnConstraints.seasons) || undefined,
      lengths: extractConstraintValues(earlyReturnConstraints.lengths) || undefined,
      priceMinCents: earlyReturnConstraints.priceMinCents === null ? undefined : earlyReturnConstraints.priceMinCents,
      priceMaxCents: earlyReturnConstraints.priceMaxCents === null ? undefined : earlyReturnConstraints.priceMaxCents,
      ageGroups: extractConstraintValues(earlyReturnConstraints.ageGroups) || undefined,
      styleTags: (() => {
        const styleValues = extractConstraintValues(earlyReturnConstraints.styles) || [];
        const patternValues = extractConstraintValues(earlyReturnConstraints.patterns) || [];
        const combined = [...styleValues, ...patternValues];
        return combined.length > 0 ? combined : undefined;
      })(),
      sleeves: extractConstraintValues(earlyReturnConstraints.sleeveLengths) || undefined,
      necklines: extractConstraintValues(earlyReturnConstraints.necklines) || undefined,
      formalityLevel: extractConstraintValues(earlyReturnConstraints.formalityLevel) || undefined,
    };
    
    return {
      replyText: regretfulReply.replyText,
      productCards: [],
      noExactMatch: true,
      resolvedConstraints,
      resolvedClassificationConstraints: earlyReturnConstraints,
      constraintsPassedToRanking: {
        colors: earlyReturnConstraints.colors,
        patterns: earlyReturnConstraints.patterns,
        occasions: earlyReturnConstraints.occasions,
        priceMinCents: earlyReturnConstraints.priceMinCents,
        priceMaxCents: earlyReturnConstraints.priceMaxCents,
        seasons: earlyReturnConstraints.seasons,
        styles: earlyReturnConstraints.styles,
        materials: earlyReturnConstraints.materials,
        fits: earlyReturnConstraints.fits,
        lengths: earlyReturnConstraints.lengths,
        sleeveLengths: earlyReturnConstraints.sleeveLengths,
        necklines: earlyReturnConstraints.necklines,
        ageGroups: earlyReturnConstraints.ageGroups,
      },
    };
  }

  // Step 5: Load products - prioritize by vector similarity
  // Products are already deduplicated at SQL level (using parent_id, shopifyProductId, related_id)
  // So we only need to load enough for constraint-based ranking (typically 30-40 is sufficient)
  const retrievalDuration = Date.now() - retrievalStartTime;
  logger.info('handleLoveshackfancyQuery: retrieval_complete', {
    query: input.message.substring(0, 100),
    candidateCount: retrievalResult.candidateIds.length,
    retrievalDurationMs: retrievalDuration,
    retrievalDurationSeconds: (retrievalDuration / 1000).toFixed(2),
  });
  
  // Step 5: Load products - prioritize by vector similarity
  // Products are already deduplicated at SQL level (using parent_id, shopifyProductId, related_id)
  // So we only need to load enough for constraint-based ranking (typically 30-35 is sufficient)
  // Reduced from 40 to 35 - parallel batch loading is faster, so we can load fewer products
  const MAX_PRODUCTS_TO_LOAD = 35;
  const candidateIdsToLoad = retrievalResult.candidateIds.slice(0, MAX_PRODUCTS_TO_LOAD);
  
  const productLoadingStartTime = Date.now();
  const candidateProducts = await loadFashionProducts(candidateIdsToLoad, input.merchantId);
  const productLoadingDuration = Date.now() - productLoadingStartTime;
  logger.info('handleLoveshackfancyQuery: product_loading_complete', {
    query: input.message.substring(0, 100),
    loadedCount: candidateProducts.length,
    requestedCount: candidateIdsToLoad.length,
    productLoadingDurationMs: productLoadingDuration,
    productLoadingDurationSeconds: (productLoadingDuration / 1000).toFixed(2),
  });

  if (candidateProducts.length === 0) {
    // Generate intelligent reply using LLM
    // Note: constraintsForRanking not yet available at this point, use mergedConstraints or undefined
    const { generateRegretfulReply } = await import('./reply');
    const regretfulReply = await generateRegretfulReply(
      input.message,
      0, // productCount
      0, // topScore
      input.merchantData?.brandName || 'LoveShackFancy',
      enhancedQueryText, // Enhanced query
      queryToMergeWith || undefined, // Previous query context
      mergedConstraints || undefined, // Use mergedConstraints if available, otherwise undefined
      input.history // Conversation history
    );
    
    // Build minimal constraints from classification for early return
    const earlyReturnConstraints = classification?.constraints || {};
    // Use extractConstraintValues from constraint-utils (already imported)
    // Convert null to undefined for SearchConstraints type
    const resolvedConstraints: SearchConstraints = {
      colors: extractConstraintValues(earlyReturnConstraints.colors) || undefined,
      sizes: extractConstraintValues(earlyReturnConstraints.sizes) || undefined,
      materials: extractConstraintValues(earlyReturnConstraints.materials) || undefined,
      occasions: extractConstraintValues(earlyReturnConstraints.occasions) || undefined,
      seasons: extractConstraintValues(earlyReturnConstraints.seasons) || undefined,
      lengths: extractConstraintValues(earlyReturnConstraints.lengths) || undefined,
      priceMinCents: earlyReturnConstraints.priceMinCents === null ? undefined : earlyReturnConstraints.priceMinCents,
      priceMaxCents: earlyReturnConstraints.priceMaxCents === null ? undefined : earlyReturnConstraints.priceMaxCents,
      ageGroups: extractConstraintValues(earlyReturnConstraints.ageGroups) || undefined,
      styleTags: (() => {
        const styleValues = extractConstraintValues(earlyReturnConstraints.styles) || [];
        const patternValues = extractConstraintValues(earlyReturnConstraints.patterns) || [];
        const combined = [...styleValues, ...patternValues];
        return combined.length > 0 ? combined : undefined;
      })(),
      sleeves: extractConstraintValues(earlyReturnConstraints.sleeveLengths) || undefined,
      necklines: extractConstraintValues(earlyReturnConstraints.necklines) || undefined,
      formalityLevel: extractConstraintValues(earlyReturnConstraints.formalityLevel) || undefined,
    };
    
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: regretfulReply.replyText,
      productCards: [],
      noExactMatch: true,
      resolvedConstraints,
      resolvedClassificationConstraints: earlyReturnConstraints,
      constraintsPassedToRanking: {
        colors: earlyReturnConstraints.colors,
        patterns: earlyReturnConstraints.patterns,
        occasions: earlyReturnConstraints.occasions,
        priceMinCents: earlyReturnConstraints.priceMinCents,
        priceMaxCents: earlyReturnConstraints.priceMaxCents,
        seasons: earlyReturnConstraints.seasons,
        styles: earlyReturnConstraints.styles,
        materials: earlyReturnConstraints.materials,
        fits: earlyReturnConstraints.fits,
        lengths: earlyReturnConstraints.lengths,
        sleeveLengths: earlyReturnConstraints.sleeveLengths,
        necklines: earlyReturnConstraints.necklines,
        ageGroups: earlyReturnConstraints.ageGroups,
      },
    };
  }

  // Step 6: Ranking with constraint-based scoring (NEW APPROACH)
  // Use parsed constraints for weighted ranking if available, otherwise fall back to vector similarity only
  onProgress?.('ranking', STAGE_PROGRESS.ranking);
  
  // Helper to merge constraints: respect null (explicitly removed) vs undefined (not set)
  // When mergedConstraints sets a field to null, it means EXPLICITLY REMOVED - do NOT fall back
  // Only fall back to classification when the field is undefined (not set at all)
  const getMergedConstraint = <T>(
    mergedValue: T | null | undefined,
    classificationValue: T | null | undefined
  ): T | null | undefined => {
    // If mergedConstraints explicitly sets a field (including null = removed), use it
    // Only fall back to classification if the field is undefined (not set at all)
    if (mergedValue !== undefined) {
      return mergedValue; // Includes null (explicitly removed)
    }
    return classificationValue;
  };
  
  // Build final constraints - merge classification constraints with merged constraints
  // This ensures that constraints extracted by the classifier (like styles, materials, seasons)
  // are preserved even when using merged constraints from follow-ups
  // CRITICAL: When mergedConstraints sets a constraint to null (explicitly removed), 
  // we must NOT fall back to classification - respect the explicit removal
  // Merged constraints take priority for explicitly merged fields (colors, occasions, ageGroups, price)
  // Classification constraints are used as fallback for fields not in merged constraints (styles, materials, seasons)
  // SPECIAL CASE: When mergedConstraints exists but ageGroups is null (new_search due to age group switch),
  // use classifier's age groups (it already has the correct new age group)
  // CRITICAL FIX: For new searches, check if mergedConstraints is a complete reset (all fields null)
  // vs an age group switch (only ageGroups null, but portable constraints exist)
  // If it's a complete reset, use classification.constraints directly to preserve inferred constraints
  const isCompleteReset = mergedConstraints && !isFollowUp && (
    (mergedConstraints.colors === null || mergedConstraints.colors === undefined) &&
    (mergedConstraints.occasions === null || mergedConstraints.occasions === undefined) &&
    (mergedConstraints.seasons === null || mergedConstraints.seasons === undefined) &&
    (mergedConstraints.formalityLevel === null || mergedConstraints.formalityLevel === undefined) &&
    (mergedConstraints.priceMinCents === null || mergedConstraints.priceMinCents === undefined) &&
    (mergedConstraints.priceMaxCents === null || mergedConstraints.priceMaxCents === undefined) &&
    mergedConstraints.ageGroups === null
  );
  const finalConstraintsForRanking = (isFollowUp && mergedConstraints) || (!isFollowUp && mergedConstraints && mergedConstraints.ageGroups === null && !isCompleteReset)
    ? {
        // Merged constraints take priority for explicitly merged fields
        // CRITICAL: Use getMergedConstraint to respect null (explicitly removed) vs undefined (not set)
        colors: getMergedConstraint(mergedConstraints.colors, classification.constraints.colors),
        occasions: getMergedConstraint(mergedConstraints.occasions, classification.constraints.occasions),
        // CRITICAL: Age group handling for new_search due to age group switch
        // When mergedConstraints.ageGroups is null (new_search with preserved constraints), use classifier's age groups
        // When mergedConstraints.ageGroups is explicitly set (follow-up), use it
        // Otherwise, use classification's age groups
        ageGroups: mergedConstraints.ageGroups === null 
          ? classification.constraints.ageGroups // New search due to age group switch - use classifier's age groups
          : (mergedConstraints.ageGroups !== undefined 
              ? mergedConstraints.ageGroups // Follow-up with explicit age groups
              : classification.constraints.ageGroups), // Fall back to classification
        sizes: getMergedConstraint(mergedConstraints.sizes, classification.constraints.sizes),
        priceMinCents: getMergedConstraint(mergedConstraints.priceMinCents, classification.constraints.priceMinCents),
        priceMaxCents: getMergedConstraint(mergedConstraints.priceMaxCents, classification.constraints.priceMaxCents),
        patterns: getMergedConstraint(mergedConstraints.patterns, classification.constraints.patterns),
        // Classification constraints are used for fields not explicitly merged (styles, materials, seasons, fits, lengths)
        styles: getMergedConstraint(mergedConstraints.styles, classification.constraints.styles),
        materials: getMergedConstraint(mergedConstraints.materials, classification.constraints.materials),
        seasons: getMergedConstraint(mergedConstraints.seasons, classification.constraints.seasons),
        fits: getMergedConstraint(mergedConstraints.fits, classification.constraints.fits),
        lengths: getMergedConstraint(mergedConstraints.lengths, classification.constraints.lengths),
        collections: getMergedConstraint(mergedConstraints.collections, classification.constraints.collections),
        embellishments: getMergedConstraint(mergedConstraints.embellishments, classification.constraints.embellishments),
        necklines: getMergedConstraint(mergedConstraints.necklines, classification.constraints.necklines),
        sleeveLengths: getMergedConstraint(mergedConstraints.sleeveLengths, classification.constraints.sleeveLengths),
        // Enriched fashion facets - use classification constraints as fallback
        formalityLevel: getMergedConstraint(mergedConstraints.formalityLevel, classification.constraints.formalityLevel),
        temperatureIntent: getMergedConstraint(mergedConstraints.temperatureIntent, classification.constraints.temperatureIntent),
        humidityFriendly: getMergedConstraint(mergedConstraints.humidityFriendly, classification.constraints.humidityFriendly),
        occasionContext: getMergedConstraint(mergedConstraints.occasionContext, classification.constraints.occasionContext),
        problemSolutions: getMergedConstraint(mergedConstraints.problemSolutions, classification.constraints.problemSolutions),
        functionFeatures: getMergedConstraint(mergedConstraints.functionFeatures, classification.constraints.functionFeatures),
        colorShade: getMergedConstraint(mergedConstraints.colorShade, classification.constraints.colorShade),
        colorUndertone: getMergedConstraint(mergedConstraints.colorUndertone, classification.constraints.colorUndertone),
        multicolor: getMergedConstraint(mergedConstraints.multicolor, classification.constraints.multicolor),
        seasonalPalette: getMergedConstraint(mergedConstraints.seasonalPalette, classification.constraints.seasonalPalette),
        // Additional enriched attributes
        careRequirements: getMergedConstraint(mergedConstraints.careRequirements, classification.constraints.careRequirements),
        rainWind: getMergedConstraint(mergedConstraints.rainWind, classification.constraints.rainWind),
        travelFeatures: getMergedConstraint(mergedConstraints.travelFeatures, classification.constraints.travelFeatures),
        pockets: getMergedConstraint(mergedConstraints.pockets, classification.constraints.pockets),
        liningType: getMergedConstraint(mergedConstraints.liningType, classification.constraints.liningType),
        braSolution: getMergedConstraint(mergedConstraints.braSolution, classification.constraints.braSolution),
        ecoMaterials: getMergedConstraint(mergedConstraints.ecoMaterials, classification.constraints.ecoMaterials),
        certifications: getMergedConstraint(mergedConstraints.certifications, classification.constraints.certifications),
        origin: getMergedConstraint(mergedConstraints.origin, classification.constraints.origin),
        adaptiveFeatures: getMergedConstraint(mergedConstraints.adaptiveFeatures, classification.constraints.adaptiveFeatures),
        sensoryFriendly: getMergedConstraint(mergedConstraints.sensoryFriendly, classification.constraints.sensoryFriendly),
        finish: getMergedConstraint(mergedConstraints.finish, classification.constraints.finish),
        modestyCues: getMergedConstraint(mergedConstraints.modestyCues, classification.constraints.modestyCues),
        layeringIntent: getMergedConstraint(mergedConstraints.layeringIntent, classification.constraints.layeringIntent),
        pairingIntent: getMergedConstraint(mergedConstraints.pairingIntent, classification.constraints.pairingIntent),
        // Category-specific constraints
        scents: getMergedConstraint(mergedConstraints.scents, classification.constraints.scents),
        rooms: getMergedConstraint(mergedConstraints.rooms, classification.constraints.rooms),
        useCases: getMergedConstraint(mergedConstraints.useCases, classification.constraints.useCases),
        benefits: getMergedConstraint(mergedConstraints.benefits, classification.constraints.benefits),
        claims: getMergedConstraint(mergedConstraints.claims, classification.constraints.claims),
        sensoryProfile: getMergedConstraint(mergedConstraints.sensoryProfile, classification.constraints.sensoryProfile),
        compatibility: getMergedConstraint(mergedConstraints.compatibility, classification.constraints.compatibility),
      }
    : classification.constraints;
  
  // CRITICAL: Color handling must respect null (explicitly removed) vs undefined (not set)
  // PHASE 2: Preserve intent format when building constraintsForRanking
  // If finalConstraintsForRanking.colors has intent format, preserve it
  let finalColors: string[] | ConstraintWithIntent | null | undefined;
  if (finalConstraintsForRanking.colors === null) {
    // Colors were explicitly removed - respect the removal, do NOT fall back to classification
    finalColors = null;
  } else if (finalConstraintsForRanking.colors !== undefined) {
    // Colors from merged constraints - preserve intent format if it exists
    // Check if it's in intent format (has 'intent' property)
    if (typeof finalConstraintsForRanking.colors === 'object' && !Array.isArray(finalConstraintsForRanking.colors) && 'intent' in finalConstraintsForRanking.colors) {
      // Preserve intent format
      finalColors = finalConstraintsForRanking.colors as ConstraintWithIntent;
    } else {
      // Old format (array) - keep as is for backward compatibility
      finalColors = finalConstraintsForRanking.colors as string[];
    }
  } else {
    // Colors not set in merged constraints, fall back to classification
    finalColors = classification.constraints.colors;
  }
  
  // CRITICAL: Only merge with classification colors if:
  // 1. This is a follow-up
  // 2. mergedConstraints.colors exists and is NOT null (explicitly removed)
  // 3. classification.colors exists
  // 4. finalColors is NOT in excluded intent format (don't merge excluded colors)
  // This preserves non-ontology colors while respecting explicit removals and excluded intent
  const classificationColorValues = extractConstraintValues(classification.constraints.colors) || (Array.isArray(classification.constraints.colors) ? classification.constraints.colors : []);
  if (isFollowUp && mergedConstraints?.colors !== null && mergedConstraints?.colors !== undefined && classificationColorValues.length > 0) {
    // Check if finalColors has excluded intent - if so, don't merge
    const colorIntent = extractConstraintIntent(finalColors);
    if (colorIntent !== 'excluded') {
    // Merge merged constraints colors with classification colors (union) to preserve non-ontology colors
    // Extract values from mergedConstraints.colors (handles both array and ConstraintWithIntent formats)
    const mergedColorsValues = extractConstraintValues(mergedConstraints.colors) || [];
      const baseColors = extractConstraintValues(finalColors) || (Array.isArray(finalColors) ? finalColors : []);
      const mergedColors = Array.from(new Set([...mergedColorsValues, ...classificationColorValues]));
      
      // Preserve intent format if original had it
      if (finalColors != null && typeof finalColors === 'object' && !Array.isArray(finalColors) && 'intent' in finalColors) {
        finalColors = {
          values: mergedColors,
          intent: (finalColors as ConstraintWithIntent).intent,
          similarValues: (finalColors as ConstraintWithIntent).similarValues,
        };
      } else {
    finalColors = mergedColors;
      }
      
    logger.debug('colors_merged_from_merged_constraints_and_classification', {
      query: input.message.substring(0, 100),
      mergedConstraintsColors: mergedColorsValues,
      classificationColors: classification.constraints.colors,
        finalColors: extractConstraintValues(finalColors) || finalColors,
      note: 'Merged colors from constraint merger and classification (union) to preserve non-ontology colors',
    });
    }
  }
  
  // Validate colors if they're in array format (not intent format with excluded)
  const colorValues = extractConstraintValues(finalColors);
  if (colorValues && colorValues.length > 0) {
    // Check if any colors are invalid (not in ontology)
    const { LOVESHACKFANCY_ONTOLOGY } = await import('./ontology');
    const validColors = new Set(LOVESHACKFANCY_ONTOLOGY.colors.map(c => c.toLowerCase()));
    const invalidColors = colorValues.filter(c => !validColors.has(c.toLowerCase()));
    
    if (invalidColors.length > 0) {
      // Keep invalid colors for ranking (fuzzy matching can handle them)
      // But also include valid colors from classification if available
      // CRITICAL: Only merge if colors weren't explicitly removed (finalColors is not null) and not excluded
      const colorIntent = extractConstraintIntent(finalColors);
      if (colorIntent !== 'excluded') {
      logger.debug('non_ontology_colors_detected_keeping_for_ranking', {
        nonOntologyColors: invalidColors,
          allColors: colorValues,
        note: 'Non-ontology colors (e.g., "Cherry") will be used for fuzzy matching in ranking',
      });
      
      // Merge with classification colors if they exist (union) and colors weren't explicitly removed
        if (finalColors != null && classificationColorValues.length > 0) {
          const mergedColors = Array.from(new Set([...colorValues, ...classificationColorValues]));
          
          // Preserve intent format if original had it
          if (typeof finalColors === 'object' && !Array.isArray(finalColors) && 'intent' in finalColors) {
            finalColors = {
              values: mergedColors,
              intent: (finalColors as ConstraintWithIntent).intent,
              similarValues: (finalColors as ConstraintWithIntent).similarValues,
            };
          } else {
        finalColors = mergedColors;
          }
          
        logger.debug('merged_colors_with_classification', {
          originalColors: finalConstraintsForRanking.colors,
          classificationColors: classification.constraints.colors,
            mergedColors: extractConstraintValues(finalColors) || finalColors,
        });
        }
      }
      // Don't filter out invalid colors - keep them for fuzzy matching
    }
  }
  
  // Build constraints for ranking: CRITICAL - respect null (explicitly removed) vs undefined (not set)
  // PHASE 2: Preserve intent format for ALL constraints (not just colors)
  // When finalConstraintsForRanking has null (from mergedConstraints), do NOT fall back to classification
  // Only use classification when finalConstraintsForRanking is undefined (not set)
  // Include ALL constraints to ensure dynamic weight system can access them for multi-constraint analysis
  // Note: FashionConstraints type accepts string[] but runtime supports ConstraintWithIntent format
  const constraintsForRanking: FashionConstraints = {
    // Preserve intent format - don't extract just values (runtime supports both formats)
    colors: finalColors as any, // Type assertion needed - runtime supports ConstraintWithIntent
    // CRITICAL: Check finalConstraintsForRanking first (respecting null = explicitly removed)
    // PHASE 2: Preserve intent format for all constraints - use directly, don't extract values
    // Only fall back to classification when finalConstraintsForRanking is undefined (not set)
    patterns: finalConstraintsForRanking.patterns !== undefined ? finalConstraintsForRanking.patterns : classification.constraints.patterns,
    occasions: finalConstraintsForRanking.occasions !== undefined ? finalConstraintsForRanking.occasions : classification.constraints.occasions,
    materials: finalConstraintsForRanking.materials !== undefined ? finalConstraintsForRanking.materials : classification.constraints.materials,
    sizes: finalConstraintsForRanking.sizes !== undefined ? finalConstraintsForRanking.sizes : classification.constraints.sizes,
    // CRITICAL: Age groups must be normalized to dictionary values (e.g., "Curvy Women" → "Adult")
    // Normalize and validate age groups before ranking to prevent invalid values from filtering out all products
    ageGroups: (() => {
      const rawAgeGroups = finalConstraintsForRanking.ageGroups !== undefined 
        ? finalConstraintsForRanking.ageGroups 
        : classification.constraints.ageGroups;
      
      if (!rawAgeGroups) return undefined; // If explicitly null or undefined, keep it
      
      // Extract values (handles both array and ConstraintWithIntent formats)
      const ageGroupValues = extractConstraintValues(rawAgeGroups) || (Array.isArray(rawAgeGroups) ? rawAgeGroups : []);
      
      // If no age groups provided, default to "Adult" (as per requirement: default to Adult unless explicitly mentioned)
      if (ageGroupValues.length === 0) {
        const intent = extractConstraintIntent(rawAgeGroups);
        if (intent && typeof rawAgeGroups === 'object' && rawAgeGroups !== null && 'intent' in rawAgeGroups) {
          return { ...rawAgeGroups, values: ['Adult'] } as any;
        }
        return ['Adult'];
      }
      
      // Normalize to dictionary values, then validate against canonical values
      const normalized = normalizeAgeGroups(ageGroupValues);
      const validated = normalized.filter(ag => isCanonicalAgeGroup(ag));
      
      // Use validated values if available, otherwise use normalized (should handle common cases)
      // If normalized is empty, default to 'Adult'
      const finalValues = validated.length > 0 ? validated : (normalized.length > 0 ? normalized : ['Adult']);
      
      // Preserve intent format if present
      const intent = extractConstraintIntent(rawAgeGroups);
      if (intent && typeof rawAgeGroups === 'object' && rawAgeGroups !== null && 'intent' in rawAgeGroups) {
        return { ...rawAgeGroups, values: finalValues } as any;
      }
      
      return finalValues;
    })(),
    priceMinCents: finalConstraintsForRanking.priceMinCents !== undefined ? finalConstraintsForRanking.priceMinCents : classification.constraints.priceMinCents,
    priceMaxCents: finalConstraintsForRanking.priceMaxCents !== undefined ? finalConstraintsForRanking.priceMaxCents : classification.constraints.priceMaxCents,
    seasons: finalConstraintsForRanking.seasons !== undefined ? finalConstraintsForRanking.seasons : classification.constraints.seasons,
    styles: finalConstraintsForRanking.styles !== undefined ? finalConstraintsForRanking.styles : classification.constraints.styles,
    lengths: finalConstraintsForRanking.lengths !== undefined ? finalConstraintsForRanking.lengths : classification.constraints.lengths,
    fits: finalConstraintsForRanking.fits !== undefined ? finalConstraintsForRanking.fits : classification.constraints.fits,
    necklines: finalConstraintsForRanking.necklines !== undefined ? finalConstraintsForRanking.necklines : classification.constraints.necklines,
    sleeveLengths: finalConstraintsForRanking.sleeveLengths !== undefined ? finalConstraintsForRanking.sleeveLengths : classification.constraints.sleeveLengths,
    collections: finalConstraintsForRanking.collections !== undefined ? finalConstraintsForRanking.collections : classification.constraints.collections,
    embellishments: finalConstraintsForRanking.embellishments !== undefined ? finalConstraintsForRanking.embellishments : classification.constraints.embellishments,
    // Enriched fashion facets
    formalityLevel: finalConstraintsForRanking.formalityLevel !== undefined ? finalConstraintsForRanking.formalityLevel : classification.constraints.formalityLevel,
    temperatureIntent: finalConstraintsForRanking.temperatureIntent !== undefined ? finalConstraintsForRanking.temperatureIntent : classification.constraints.temperatureIntent,
    humidityFriendly: finalConstraintsForRanking.humidityFriendly !== undefined ? finalConstraintsForRanking.humidityFriendly : classification.constraints.humidityFriendly,
    occasionContext: finalConstraintsForRanking.occasionContext !== undefined ? finalConstraintsForRanking.occasionContext : classification.constraints.occasionContext,
    problemSolutions: finalConstraintsForRanking.problemSolutions !== undefined ? finalConstraintsForRanking.problemSolutions : classification.constraints.problemSolutions,
    functionFeatures: finalConstraintsForRanking.functionFeatures !== undefined ? finalConstraintsForRanking.functionFeatures : classification.constraints.functionFeatures,
    colorShade: finalConstraintsForRanking.colorShade !== undefined ? finalConstraintsForRanking.colorShade : classification.constraints.colorShade,
    colorUndertone: finalConstraintsForRanking.colorUndertone !== undefined ? finalConstraintsForRanking.colorUndertone : classification.constraints.colorUndertone,
    multicolor: finalConstraintsForRanking.multicolor !== undefined ? finalConstraintsForRanking.multicolor : classification.constraints.multicolor,
    seasonalPalette: finalConstraintsForRanking.seasonalPalette !== undefined ? finalConstraintsForRanking.seasonalPalette : classification.constraints.seasonalPalette,
    // Additional enriched attributes
    careRequirements: finalConstraintsForRanking.careRequirements !== undefined ? finalConstraintsForRanking.careRequirements : classification.constraints.careRequirements,
    rainWind: finalConstraintsForRanking.rainWind !== undefined ? finalConstraintsForRanking.rainWind : classification.constraints.rainWind,
    travelFeatures: finalConstraintsForRanking.travelFeatures !== undefined ? finalConstraintsForRanking.travelFeatures : classification.constraints.travelFeatures,
    pockets: finalConstraintsForRanking.pockets !== undefined ? finalConstraintsForRanking.pockets : classification.constraints.pockets,
    liningType: finalConstraintsForRanking.liningType !== undefined ? finalConstraintsForRanking.liningType : classification.constraints.liningType,
    braSolution: finalConstraintsForRanking.braSolution !== undefined ? finalConstraintsForRanking.braSolution : classification.constraints.braSolution,
    ecoMaterials: finalConstraintsForRanking.ecoMaterials !== undefined ? finalConstraintsForRanking.ecoMaterials : classification.constraints.ecoMaterials,
    certifications: finalConstraintsForRanking.certifications !== undefined ? finalConstraintsForRanking.certifications : classification.constraints.certifications,
    origin: finalConstraintsForRanking.origin !== undefined ? finalConstraintsForRanking.origin : classification.constraints.origin,
    adaptiveFeatures: finalConstraintsForRanking.adaptiveFeatures !== undefined ? finalConstraintsForRanking.adaptiveFeatures : classification.constraints.adaptiveFeatures,
    sensoryFriendly: finalConstraintsForRanking.sensoryFriendly !== undefined ? finalConstraintsForRanking.sensoryFriendly : classification.constraints.sensoryFriendly,
    finish: finalConstraintsForRanking.finish !== undefined ? finalConstraintsForRanking.finish : classification.constraints.finish,
    modestyCues: finalConstraintsForRanking.modestyCues !== undefined ? finalConstraintsForRanking.modestyCues : classification.constraints.modestyCues,
    layeringIntent: finalConstraintsForRanking.layeringIntent !== undefined ? finalConstraintsForRanking.layeringIntent : classification.constraints.layeringIntent,
    pairingIntent: finalConstraintsForRanking.pairingIntent !== undefined ? finalConstraintsForRanking.pairingIntent : classification.constraints.pairingIntent,
    // Category-specific constraints
    scents: finalConstraintsForRanking.scents !== undefined ? finalConstraintsForRanking.scents : classification.constraints.scents,
    rooms: finalConstraintsForRanking.rooms !== undefined ? finalConstraintsForRanking.rooms : classification.constraints.rooms,
    useCases: finalConstraintsForRanking.useCases !== undefined ? finalConstraintsForRanking.useCases : classification.constraints.useCases,
    benefits: finalConstraintsForRanking.benefits !== undefined ? finalConstraintsForRanking.benefits : classification.constraints.benefits,
    claims: finalConstraintsForRanking.claims !== undefined ? finalConstraintsForRanking.claims : classification.constraints.claims,
    sensoryProfile: finalConstraintsForRanking.sensoryProfile !== undefined ? finalConstraintsForRanking.sensoryProfile : classification.constraints.sensoryProfile,
    compatibility: finalConstraintsForRanking.compatibility !== undefined ? finalConstraintsForRanking.compatibility : classification.constraints.compatibility,
  };
  
  // Log explicitly removed constraints for debugging
  if (isFollowUp && mergedConstraints) {
    const removedConstraints = Object.keys(mergedConstraints).filter(
      key => mergedConstraints[key as keyof typeof mergedConstraints] === null
    );
    if (removedConstraints.length > 0) {
      logger.debug('constraints_explicitly_removed', {
        removedConstraints,
        query: input.message.substring(0, 100),
        note: 'These constraints were explicitly removed by user and should NOT be restored from classification',
      });
    }
  }
  
  // Filter out "Mini Dress" category products and products with "Mini" length when modesty constraints require longer lengths (Maxi, Midi only)
  // This must happen BEFORE ranking to prevent mini dresses from getting high scores
  let filteredCandidateProducts = candidateProducts;
  const lengthValues = extractConstraintValues(constraintsForRanking.lengths) || (Array.isArray(constraintsForRanking.lengths) ? constraintsForRanking.lengths : []);
  if (lengthValues.length > 0) {
    const lengthsLower = lengthValues.map(l => l.toLowerCase());
    const hasMaxi = lengthsLower.includes('maxi');
    const hasMidi = lengthsLower.includes('midi');
    const hasMini = lengthsLower.includes('mini');
    
    // If only longer lengths are specified (Maxi/Midi) and Mini is NOT included,
    // exclude "Mini Dress" category products and products with "Mini" length
    if ((hasMaxi || hasMidi) && !hasMini) {
      const beforeCount = filteredCandidateProducts.length;
      filteredCandidateProducts = filteredCandidateProducts.filter(p => {
        const categoryLower = (p.category || '').toLowerCase();
        // Exclude products in "Mini Dress" category when modesty requires longer lengths
        if (categoryLower.includes('mini dress')) {
          return false;
        }
        
        // Also exclude products with "Mini" length attribute
        const productLength = (p.attributes?.length || p.attributes?.Length || '').toString().toLowerCase();
        if (productLength.includes('mini')) {
          return false;
        }
        
        return true;
      });
      
      if (filteredCandidateProducts.length < beforeCount) {
        logger.info('filtered_mini_dress_for_modesty_before_ranking', {
          query: input.message.substring(0, 100),
          lengthsConstraint: constraintsForRanking.lengths,
          beforeCount,
          afterCount: filteredCandidateProducts.length,
          excludedCount: beforeCount - filteredCandidateProducts.length,
        });
      }
    }
  }
  
  // Check if we have any constraints to use for ranking
  const hasConstraintsForRanking = Object.values(constraintsForRanking).some(v => 
    v !== null && v !== undefined && (Array.isArray(v) ? v.length > 0 : true)
  );
  
  // Build query context
  // Note: explicitMentions removed - LLM classification already handles constraint extraction
  // Age group filtering now uses resolvedAgeGroup directly instead of explicitMentions check
  const queryContext = {
    queryType: classification.type,
    explicitMentions: [], // Deprecated - kept for compatibility but not used
    originalQuery: input.message,
  };
  
  let productsWithScores: Array<{ product: SearchResultItem; score: number }>;
  
  if (hasConstraintsForRanking) {
    // NEW: Use constraint-based ranking (no hard filtering, just weighted scoring)
    logger.info('orchestrator_constraint_ranking_start', {
      query: input.message.substring(0, 200),
      candidateProductCount: filteredCandidateProducts.length,
      originalCandidateCount: candidateProducts.length,
      constraintsForRanking,
      topVectorScores: filteredCandidateProducts.slice(0, 5).map(p => ({
        productId: p.id,
        productTitle: p.title?.substring(0, 80),
        vectorScore: retrievalResult.semanticScores.get(p.id) || 0,
      })),
    });
    
    const productsWithVectorScores = filteredCandidateProducts.map(product => ({
      product,
      vectorScore: retrievalResult.semanticScores.get(product.id) || 0,
    }));
    
    // Constraints were already refined BEFORE retrieval, so use them directly
    const finalConstraintsForRanking = constraintsForRanking;
    
    // CRITICAL: Log all constraints being passed to ranking to verify none are missing
    const constraintsForRankingKeys = Object.keys(finalConstraintsForRanking).filter(
      k => finalConstraintsForRanking[k as keyof typeof finalConstraintsForRanking] !== null && 
           finalConstraintsForRanking[k as keyof typeof finalConstraintsForRanking] !== undefined
    );
    const constraintsForRankingSummary: Record<string, any> = {};
    constraintsForRankingKeys.forEach(key => {
      const value = finalConstraintsForRanking[key as keyof typeof finalConstraintsForRanking];
      if (value !== null && value !== undefined) {
        const values = extractConstraintValues(value as any) || (Array.isArray(value) ? value : []);
        const intent = extractConstraintIntent(value as any);
        constraintsForRankingSummary[key] = {
          values: values.length > 0 ? values : 'empty',
          intent: intent || 'none',
          hasValues: values.length > 0,
        };
      }
    });
    
    const rankingStartTime = Date.now();
    logger.info('handleLoveshackfancyQuery: starting_ranking', {
      query: input.message.substring(0, 100),
      productCount: productsWithVectorScores.length,
      constraintCount: constraintsForRankingKeys.length,
      constraintKeys: constraintsForRankingKeys,
      constraintsSummary: constraintsForRankingSummary,
      note: 'All constraints passed to ranking (including SQL-filtered constraints for scoring)',
    });
    
    const rankedProducts = await rankWithConstraints(
      productsWithVectorScores,
      finalConstraintsForRanking,
      0.6, // maxConstraintBoost
      queryContext // Pass query context for dynamic weight adjustment
    );
    
    const rankingDuration = Date.now() - rankingStartTime;
    logger.info('handleLoveshackfancyQuery: ranking_complete', {
      query: input.message.substring(0, 100),
      productCount: rankedProducts.length,
      rankingDurationMs: rankingDuration,
      rankingDurationSeconds: (rankingDuration / 1000).toFixed(2),
      topScore: rankedProducts.length > 0 ? rankedProducts[0].finalScore : 0,
    });
    
    // Convert to format expected by rest of pipeline
    productsWithScores = rankedProducts.map(rp => ({
      product: rp.product,
      score: rp.finalScore,
    }));
    
    logger.info('constraint_based_ranking_applied', {
      query: input.message.substring(0, 100),
      productCount: productsWithScores.length,
      avgConstraintScore: rankedProducts.reduce((sum, p) => sum + p.constraintScore, 0) / rankedProducts.length,
      avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.score, 0) / productsWithScores.length,
      queryContext: {
        queryType: queryContext.queryType,
        explicitMentions: queryContext.explicitMentions,
        originalQuery: queryContext.originalQuery?.substring(0, 100),
      },
      constraintsForRanking: {
        colors: finalConstraintsForRanking.colors,
        occasions: finalConstraintsForRanking.occasions,
        ageGroups: finalConstraintsForRanking.ageGroups,
        materials: finalConstraintsForRanking.materials,
        seasons: finalConstraintsForRanking.seasons,
        fits: finalConstraintsForRanking.fits,
        lengths: finalConstraintsForRanking.lengths,
        styles: finalConstraintsForRanking.styles,
      },
    });
  } else {
    // FALLBACK: Use vector similarity only (original approach)
    productsWithScores = filteredCandidateProducts.map(product => {
    const vectorScore = retrievalResult.semanticScores.get(product.id) || 0;
    return {
      product,
      score: vectorScore, // Use vector similarity directly as the score
    };
  });
  
    // Sort by vector similarity (descending)
  productsWithScores.sort((a, b) => b.score - a.score);
  }

  // Apply diversity penalty to recently shown products
  // This allows new products to surface even if they have slightly lower scores
  const shownProductIds = conversationState.shownProductIds || [];
  if (shownProductIds.length > 0) {
    const DIVERSITY_PENALTY = 0.15; // 15% penalty for recently shown products
    productsWithScores = productsWithScores.map(({ product, score }) => {
      const isRecentlyShown = shownProductIds.includes(product.id);
      const diversityAdjustedScore = isRecentlyShown 
        ? score * (1 - DIVERSITY_PENALTY) 
        : score;
      return { product, score: diversityAdjustedScore };
    });
    
    // Re-sort after diversity adjustment
    productsWithScores.sort((a, b) => b.score - a.score);
    
    logger.debug('diversity_penalty_applied', {
      shownProductCount: shownProductIds.length,
      penalizedCount: productsWithScores.filter(p => shownProductIds.includes(p.product.id)).length,
      penalty: DIVERSITY_PENALTY,
    });
  }

  logger.info('fashion_ranking_complete', {
    query: input.message.substring(0, 100),
    productCount: productsWithScores.length,
    topScore: productsWithScores[0]?.score || 0,
    avgScore: productsWithScores.reduce((sum, p) => sum + p.score, 0) / productsWithScores.length || 0,
    scoreRange: productsWithScores.length > 0 
      ? `${productsWithScores[productsWithScores.length - 1]?.score.toFixed(3)} - ${productsWithScores[0]?.score.toFixed(3)}`
      : 'N/A',
  });

  // CRITICAL: Hard filter for age group constraints
  // If age group was resolved (extracted early), reject products that don't match
  // This ensures "baby" queries don't return "for Women" products
  const ageGroupsConstraint = constraintsForRanking.ageGroups;
  const ageGroupValues = extractConstraintValues(ageGroupsConstraint) || (Array.isArray(ageGroupsConstraint) ? ageGroupsConstraint : []);
  
  // Use resolvedAgeGroup (extracted early) instead of explicitMentions check
  if (ageGroupValues.length > 0 && resolvedAgeGroup) {
    const beforeFilterCount = productsWithScores.length;
    
    productsWithScores = productsWithScores.filter(({ product }) => {
      const ageGroupScore = matchAgeGroup(product, ageGroupValues);
      // Reject products with age group score of 0 (no match)
      return ageGroupScore > 0;
    });
    
    const afterFilterCount = productsWithScores.length;
    
    if (beforeFilterCount !== afterFilterCount) {
      logger.info('age_group_hard_filter_applied', {
        query: input.message.substring(0, 100),
        ageGroups: ageGroupsConstraint,
        beforeFilterCount,
        afterFilterCount,
        rejectedCount: beforeFilterCount - afterFilterCount,
        note: 'Products with age group score of 0 were rejected',
      });
    }
  }

  // Take top products - no need to deduplicate since it's already done at SQL level
  // Products returned from vector search are already deduplicated using parent_id, shopifyProductId, related_id
  // Mini dress filtering already happened before ranking, so we can just take the top products
  const productsToShow = productsWithScores
    .slice(0, 4) // Take top 4 products (already deduplicated and filtered)
    .map(p => p.product);

  // CRITICAL: Check if results are relevant to the query
  // If the top product doesn't match the query intent (e.g., cardigan for "joggers"), generate a regretful reply
  const MIN_PRODUCTS_FOR_RECOMMENDATION = 4;
  const MIN_TOP_SCORE_FOR_CONFIDENT_REPLY = 0.25; // Lowered from 0.4 to show more products
  const HIGH_CONFIDENCE_THRESHOLD = 0.5; // Allow product type mismatch if confidence >= 0.5
  
  /**
   * Calculate dynamic relevance threshold based on query type, category confidence, and product type match
   */
  function calculateDynamicRelevanceThreshold(
    isFollowUp: boolean,
    categoryConfidence: number | undefined,
    productTypeMatches: boolean
  ): number {
    // Follow-up queries: more lenient (0.30) since enhanced queries should be more correlated
    if (isFollowUp) {
      return 0.30;
    }
    
    // High confidence + product type match: more lenient (0.25)
    if (categoryConfidence !== undefined && categoryConfidence >= 0.7 && productTypeMatches) {
      return 0.25;
    }
    
    // Medium confidence: moderate threshold (0.30)
    if (categoryConfidence !== undefined && categoryConfidence >= 0.5) {
      return 0.30;
    }
    
    // Low confidence or no confidence: stricter threshold (0.35)
    // This prevents showing irrelevant products when we're not confident about the category
    return 0.35;
  }
  
  // Calculate dynamic relevance threshold (will be updated after product type matching check)
  // Note: categoryConfidenceForThreshold is set earlier in the flow
  let MIN_RELEVANCE_SCORE = calculateDynamicRelevanceThreshold(
    isFollowUp,
    categoryConfidenceForThreshold,
    true // Will be updated after product type matching check
  );
  
  logger.debug('dynamic_threshold_calculation', {
    query: input.message.substring(0, 100),
    isFollowUp,
    categoryConfidence: categoryConfidenceForThreshold,
    calculatedThreshold: MIN_RELEVANCE_SCORE,
    note: 'Dynamic relevance threshold calculated based on query type and category confidence',
  });
  
  // Check if products are relevant (removed minimum product count requirement - show whatever is available)
  const topScore = productsWithScores[0]?.score || 0;
  
  // Check if products match query intent using category tree (e.g., "joggers" query shouldn't return "cardigans")
  // Use category tree to extract keywords from all 48+ categories instead of hardcoded list
  let productTypeMatches = true;
  if (productsToShow.length > 0 && classification.productTerms) {
    const productTermsLower = classification.productTerms.toLowerCase();
    const topProductTitle = (productsToShow[0].title || '').toLowerCase();
    const topProductCategory = (productsToShow[0].category || '').toLowerCase();
    
    // Get all categories and extract keywords from them
    const allCategories = getAllCategories();
    const allCategoryKeywords = new Set<string>();
    allCategories.forEach(category => {
      const keywords = extractCategoryKeywords(category);
      keywords.forEach(kw => allCategoryKeywords.add(kw));
    });
    
    // Check if product type is mentioned in query using category keywords
    const queryHasProductType = Array.from(allCategoryKeywords).some(keyword => 
      productTermsLower.includes(keyword)
    );
    
    if (queryHasProductType) {
      // Find the matching category keyword from query
      const matchingKeyword = Array.from(allCategoryKeywords).find(keyword => 
        productTermsLower.includes(keyword)
      );
      
      if (matchingKeyword) {
        // Check if top product matches the product type mentioned in query
        // Match against product title, category, or subcategory
        const strictProductTypeMatches = 
          topProductTitle.includes(matchingKeyword) || 
          topProductCategory.includes(matchingKeyword) ||
          (productsToShow[0].subcategory || '').toLowerCase().includes(matchingKeyword);
        
        // Also try to find closest category match using category tree
        const closestCategory = findClosestCategory(productTermsLower);
        const categoryMatch = closestCategory && (
          topProductCategory.includes(closestCategory.toLowerCase()) ||
          closestCategory.toLowerCase().includes(topProductCategory)
        );
        
        const finalMatch = strictProductTypeMatches || categoryMatch;
        
        // Allow product type mismatch if confidence is high enough (>= 0.5)
        productTypeMatches = finalMatch || topScore >= HIGH_CONFIDENCE_THRESHOLD;
        
        if (!finalMatch) {
          if (topScore >= HIGH_CONFIDENCE_THRESHOLD) {
            logger.info('product_type_mismatch_allowed_high_confidence', {
              query: input.message.substring(0, 100),
              queryProductType: matchingKeyword,
              closestCategory,
              topProductTitle: productsToShow[0].title,
              topProductCategory: productsToShow[0].category,
              topScore,
              note: 'Product type mismatch allowed due to high confidence (>= 0.5)',
            });
          } else {
            logger.warn('product_type_mismatch', {
              query: input.message.substring(0, 100),
              queryProductType: matchingKeyword,
              closestCategory,
              topProductTitle: productsToShow[0].title,
              topProductCategory: productsToShow[0].category,
              topScore,
              note: 'Product type mismatch and confidence below 0.5 threshold',
            });
          }
        }
      }
    }
  }
  
  // Recalculate dynamic threshold now that we know productTypeMatches
  MIN_RELEVANCE_SCORE = calculateDynamicRelevanceThreshold(
    isFollowUp,
    categoryConfidenceForThreshold,
    productTypeMatches
  );
  
  logger.debug('dynamic_threshold_recalculated_after_product_type_check', {
    query: input.message.substring(0, 100),
    isFollowUp,
    categoryConfidence: categoryConfidenceForThreshold,
    productTypeMatches,
    recalculatedThreshold: MIN_RELEVANCE_SCORE,
    note: 'Dynamic relevance threshold recalculated after product type matching check',
  });
  
  // CRITICAL: Validate ALL products, not just top product
  // This prevents irrelevant products from being shown in positions 2-4
  let validatedProducts = productsToShow;
  if (topCategories && topCategories.length > 0 && categoryConfidenceForThreshold !== undefined) {
    // Validate all products by category
    const categoryValidations = validateAllProductsByCategory(
      productsToShow,
      topCategories,
      categoryConfidenceForThreshold
    );
    
    // Filter products that fail category validation
    validatedProducts = filterProductsByCategoryValidation(categoryValidations);
    
    logger.info('category_validation_all_products', {
      query: input.message.substring(0, 100),
      totalProducts: productsToShow.length,
      validatedProducts: validatedProducts.length,
      filteredCount: productsToShow.length - validatedProducts.length,
      categories: topCategories,
      categoryConfidence: categoryConfidenceForThreshold,
      note: 'All products validated by category to prevent cross-category contamination',
    });
  }
  
  // Also filter by relevance score for all products
  const relevanceValidatedProducts = validatedProducts.filter((product, index) => {
    const productScore = productsWithScores[index]?.score || 0;
    const isRelevant = productScore >= MIN_RELEVANCE_SCORE;
    
    if (!isRelevant) {
      logger.debug('product_filtered_by_relevance_score', {
        query: input.message.substring(0, 100),
        productId: product.id,
        productTitle: product.title,
        productCategory: product.category,
        productScore,
        minRelevanceScore: MIN_RELEVANCE_SCORE,
        note: 'Product filtered out due to low relevance score',
      });
    }
    
    return isRelevant;
  });
  
  if (relevanceValidatedProducts.length < validatedProducts.length) {
    logger.info('products_filtered_by_relevance_score', {
      query: input.message.substring(0, 100),
      beforeFilterCount: validatedProducts.length,
      afterFilterCount: relevanceValidatedProducts.length,
      filteredCount: validatedProducts.length - relevanceValidatedProducts.length,
      minRelevanceScore: MIN_RELEVANCE_SCORE,
      note: 'Products filtered by relevance score threshold',
    });
  }
  
  // Update productsToShow with validated products
  validatedProducts = relevanceValidatedProducts;
  
  const topProductRelevant = topScore >= MIN_RELEVANCE_SCORE;
  
  // If product type matches, be more lenient with confidence threshold
  // This allows relevant products (e.g., dresses for "dresses" query) to show even with slightly lower scores
  // Use a lower threshold (0.2) when product type matches and product is relevant
  const effectiveConfidenceThreshold = (productTypeMatches && topProductRelevant) 
    ? 0.2 // Be more lenient when product type matches AND product is relevant (lowered from 0.35)
    : MIN_TOP_SCORE_FOR_CONFIDENT_REPLY;
  
  const hasHighConfidence = topScore >= effectiveConfidenceThreshold;
  
  logger.debug('confidence_threshold_calculation', {
    query: input.message.substring(0, 100),
    topScore,
    productTypeMatches,
    topProductRelevant,
    effectiveConfidenceThreshold,
    hasHighConfidence,
    isFollowUp,
    minTopScore: MIN_TOP_SCORE_FOR_CONFIDENT_REPLY,
    thresholdApplied: isFollowUp, // Only applied for follow-ups
  });
  
  // Show products if they're relevant, type matches (or high confidence), and meet confidence threshold
  // Use validatedProducts instead of productsToShow (validated products have passed category and relevance checks)
  // Removed minimum product count requirement - show whatever is available (at least 1 product)
  // For new queries (isFollowUp=false), skip confidence threshold since initial queries can have low correlation
  // For follow-ups (isFollowUp=true), apply threshold since enhanced queries should be more correlated
  const shouldShowProducts = validatedProducts.length > 0 && // At least 1 validated product
    topProductRelevant && 
    productTypeMatches &&
    (isFollowUp ? hasHighConfidence : true); // Only check confidence threshold for follow-ups
  
  if (!shouldShowProducts) {
    logger.warn('low_confidence_or_irrelevant_recommendation', {
      query: input.message.substring(0, 100),
      productCount: validatedProducts.length,
      topScore,
      hasHighConfidence,
      topProductRelevant,
      productTypeMatches,
      isFollowUp,
      reason: validatedProducts.length === 0 ? 'no_products' :
              (!isFollowUp && !hasHighConfidence) ? 'threshold_skipped_for_new_query' :
              (isFollowUp && !hasHighConfidence) ? 'low_top_score' :
              !topProductRelevant ? 'low_relevance_score' : 
              'product_type_mismatch',
    });

    // Generate an intelligent, context-aware regretful reply using LLM
    const { generateRegretfulReply } = await import('./reply');
    const regretfulReply = await generateRegretfulReply(
      input.message,
      validatedProducts.length,
      topScore,
      input.merchantData?.brandName || 'LoveShackFancy',
      enhancedQueryText, // Enhanced query
      queryToMergeWith || undefined, // Previous query context
      constraintsForRanking, // Constraints to analyze
      input.history // Conversation history
    );

    // Build resolved constraints from constraintsForRanking for return
    const finalConstraints = constraintsForRanking || {};
    const resolvedConstraints: SearchConstraints = {
      colors: extractConstraintValues(finalConstraints.colors) || undefined,
      sizes: extractConstraintValues(finalConstraints.sizes) || undefined,
      materials: extractConstraintValues(finalConstraints.materials) || undefined,
      occasions: extractConstraintValues(finalConstraints.occasions) || undefined,
      seasons: extractConstraintValues(finalConstraints.seasons) || undefined,
      lengths: extractConstraintValues(finalConstraints.lengths) || undefined,
      priceMinCents: finalConstraints.priceMinCents === null ? undefined : finalConstraints.priceMinCents,
      priceMaxCents: finalConstraints.priceMaxCents === null ? undefined : finalConstraints.priceMaxCents,
      ageGroups: extractConstraintValues(finalConstraints.ageGroups) || undefined,
      styleTags: (() => {
        const styleValues = extractConstraintValues(finalConstraints.styles) || [];
        const patternValues = extractConstraintValues(finalConstraints.patterns) || [];
        const combined = [...styleValues, ...patternValues];
        return combined.length > 0 ? combined : undefined;
      })(),
      sleeves: extractConstraintValues(finalConstraints.sleeveLengths) || undefined,
      necklines: extractConstraintValues(finalConstraints.necklines) || undefined,
      formalityLevel: extractConstraintValues(finalConstraints.formalityLevel) || undefined,
    };
    
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: regretfulReply.replyText,
      productCards: [], // No product cards for low confidence
      noExactMatch: true,
      route: 'NO_MATCH',
      resolvedConstraints,
      resolvedClassificationConstraints: finalConstraints,
      constraintsPassedToRanking: {
        colors: finalConstraints.colors,
        patterns: finalConstraints.patterns,
        occasions: finalConstraints.occasions,
        priceMinCents: finalConstraints.priceMinCents,
        priceMaxCents: finalConstraints.priceMaxCents,
        seasons: finalConstraints.seasons,
        styles: finalConstraints.styles,
        materials: finalConstraints.materials,
        fits: finalConstraints.fits,
        lengths: finalConstraints.lengths,
        sleeveLengths: finalConstraints.sleeveLengths,
        necklines: finalConstraints.necklines,
        ageGroups: finalConstraints.ageGroups,
      },
    };
  }

  // Step 7-9: Parallelize reply generation, product card building, and dialogue routing
  // Start reply generation as soon as we have top 4 products (don't wait for other operations)
  onProgress?.('generating_reply', STAGE_PROGRESS.generating_reply);
  
  // Detect product type mismatch for reply generation
  let productTypeMismatch: { queryProductType: string; returnedProductTypes: string[] } | undefined = undefined;
  if (classification.productTerms && validatedProducts.length > 0) {
    const productTermsLower = classification.productTerms.toLowerCase();
    const allCategories = getAllCategories();
    const allCategoryKeywords = new Set<string>();
    allCategories.forEach(category => {
      const keywords = extractCategoryKeywords(category);
      keywords.forEach(kw => allCategoryKeywords.add(kw));
    });
    
    // Find the product type mentioned in query
    const queryProductType = Array.from(allCategoryKeywords).find(keyword => 
      productTermsLower.includes(keyword)
    );
    
    if (queryProductType) {
      // Extract product types from returned products
      const returnedProductTypesSet = new Set<string>();
      validatedProducts.forEach(product => {
        const title = (product.title || '').toLowerCase();
        const category = (product.category || '').toLowerCase();
        const subcategory = (product.subcategory || '').toLowerCase();
        
        // Check if any category keyword matches the product
        Array.from(allCategoryKeywords).forEach(keyword => {
          if (title.includes(keyword) || category.includes(keyword) || subcategory.includes(keyword)) {
            returnedProductTypesSet.add(keyword);
          }
        });
      });
      
      const returnedProductTypes = Array.from(returnedProductTypesSet);
      
      // Check if query product type is in returned products
      const hasExactMatch = validatedProducts.some(product => {
        const productTitle = (product.title || '').toLowerCase();
        const productCategory = (product.category || '').toLowerCase();
        const productSubcategory = (product.subcategory || '').toLowerCase();
        const queryProductTypeLower = queryProductType.toLowerCase();
        
        return productTitle.includes(queryProductTypeLower) || 
               productCategory.includes(queryProductTypeLower) ||
               productSubcategory.includes(queryProductTypeLower) ||
               returnedProductTypes.some(type => type.toLowerCase() === queryProductTypeLower);
      });
      
      if (!hasExactMatch && returnedProductTypes.length > 0) {
        // Product type mismatch detected
        productTypeMismatch = {
          queryProductType: queryProductType,
          returnedProductTypes: returnedProductTypes,
        };
        logger.info('product_type_mismatch_for_reply', {
          query: input.message.substring(0, 100),
          queryProductType,
          returnedProductTypes,
          note: 'Product type mismatch detected - will be acknowledged in reply',
        });
      }
    }
  }
  
  // Build reply context for follow-ups AND new searches with previous context
  // Note: explicitMentions removed - LLM classification already extracts constraints
  const replyContext: ReplyContext | undefined = (isFollowUp || queryToMergeWith || productTypeMismatch) ? {
    isFollowUp: isFollowUp,
    currentQuery: originalUserMessage, // Most recent user query (original, before enhancement)
    previousQuery: queryToMergeWith || undefined, // Previous query (available for both follow-ups and new searches)
    enhancedQuery: enhancedQueryText || input.message, // Enhanced query used for search
    classificationConstraints: classification.constraints, // Classification constraints for reference/fallback
    productTypeMismatch: productTypeMismatch, // Product type mismatch information
    explicitMentions: [], // Deprecated - LLM classification handles constraint extraction
  } : undefined;
  
  // Start all three operations in parallel for better performance
  const replyGenerationStartTime = Date.now();
  logger.info('handleLoveshackfancyQuery: starting_reply_generation', {
    query: input.message.substring(0, 100),
    productCount: productsToShow.length,
  });
  
  const [replyResult, productCards, routerResult] = await Promise.all([
    // Reply generation (LLM call - can take 5+ seconds)
    (async (): Promise<ReplyResult> => {
      const replyStartTime = Date.now();
      try {
        // CRITICAL: Pass constraintsForRanking (merged constraints) instead of classification.constraints
        // This ensures follow-up merged constraints (seasons, sleeves, necklines, etc.) are available to reply generation
        const result = await generateReply(
          input.message,
          constraintsForRanking, // Use merged constraints (includes follow-up merged constraints)
          productsToShow.map(p => p as SearchResultItem),
          input.merchantData?.brandName || 'LoveShackFancy',
          replyContext, // Pass follow-up context (includes classificationConstraints for reference)
          topCategories.length > 0 ? topCategories : undefined // Pass top categories for category-aware attribute extraction
        );
        const replyDuration = Date.now() - replyStartTime;
        logger.info('handleLoveshackfancyQuery: reply_generation_complete', {
          query: input.message.substring(0, 100),
          replyDurationMs: replyDuration,
          replyDurationSeconds: (replyDuration / 1000).toFixed(2),
          replyTextLength: result.replyText.length,
          hasReplyTextAfter: !!result.replyTextAfter,
        });
        return result;
      } catch (error) {
        const replyDuration = Date.now() - replyStartTime;
        logger.error('handleLoveshackfancyQuery: reply generation failed', {
          error: error instanceof Error ? error.message : String(error),
          replyDurationMs: replyDuration,
          replyDurationSeconds: (replyDuration / 1000).toFixed(2),
        });
        return {
          replyText: `I found ${validatedProducts.length} piece${validatedProducts.length !== 1 ? 's' : ''} that match your search. Here are some options:`,
        };
      }
    })(),
    // Build product cards with emotional keywords (LLM call for keywords)
    (async (): Promise<ProductCard[]> => {
      try {
        // Generate emotional keywords for all products in batch
        const { generateEmotionalKeywordsBatch } = await import('./reply');
        
        logger.info('emotional_keywords_generation_start', {
          productCount: validatedProducts.length,
          enhancedQuery: (enhancedQueryText || input.message).substring(0, 100),
        });
        
        const emotionalKeywordsArray = await generateEmotionalKeywordsBatch(
          productsToShow.map(p => p as SearchResultItem),
          enhancedQueryText || input.message, // Use enhanced query for context
          input.merchantData?.brandName || 'LoveShackFancy'
        );
        
        logger.info('emotional_keywords_received', {
          keywordsArrayLength: emotionalKeywordsArray.length,
          expectedLength: validatedProducts.length,
          sampleKeywords: emotionalKeywordsArray.slice(0, 2).map(kw => kw),
          allKeywords: emotionalKeywordsArray.map((kw, idx) => ({
            productIndex: idx,
            productTitle: validatedProducts[idx]?.title?.substring(0, 50),
            keywords: kw,
          })),
        });
        
        // Build product cards with emotional keywords
        return validatedProducts.map((product, index) => {
          const reason = buildProductReason(
            product as SearchResultItem,
            input.message,
            {
              style: (extractConstraintValues(classification.constraints.styles) || [])[0],
              occasion: (extractConstraintValues(classification.constraints.occasions) || [])[0],
              collection: (extractConstraintValues(classification.constraints.collections) || [])[0],
              pattern: (extractConstraintValues(classification.constraints.patterns) || [])[0],
              material: (extractConstraintValues(classification.constraints.materials) || [])[0],
              length: (extractConstraintValues(classification.constraints.lengths) || [])[0],
              embellishment: (extractConstraintValues(classification.constraints.embellishments) || [])[0],
            }
          );
          const emotionalKeywords = emotionalKeywordsArray[index] || [];
          
          logger.info('emotional_keywords_product_card', {
            productIndex: index,
            productTitle: product.title?.substring(0, 50),
            keywords: emotionalKeywords,
            keywordsCount: emotionalKeywords.length,
          });
          
          return buildProductCard(product as SearchResultItem, reason, emotionalKeywords);
        });
      } catch (error) {
        logger.error('handleLoveshackfancyQuery: emotional keywords generation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback: build product cards without emotional keywords
        return validatedProducts.map(product => {
          const reason = buildProductReason(
            product as SearchResultItem,
            input.message,
            {
              style: (extractConstraintValues(classification.constraints.styles) || [])[0],
              occasion: (extractConstraintValues(classification.constraints.occasions) || [])[0],
              collection: (extractConstraintValues(classification.constraints.collections) || [])[0],
              pattern: (extractConstraintValues(classification.constraints.patterns) || [])[0],
              material: (extractConstraintValues(classification.constraints.materials) || [])[0],
              length: (extractConstraintValues(classification.constraints.lengths) || [])[0],
              embellishment: (extractConstraintValues(classification.constraints.embellishments) || [])[0],
            }
          );
          return buildProductCard(product as SearchResultItem, reason);
        });
      }
    })(),
    // Dialogue routing (LLM call - independent of products)
    routeTurn(
      input.message,
      input.lastConstraints,
      input.lastShownProductIds
    ),
  ]);

  // Step 10: Generate actions (if needed)
  const actions: Array<{ id: string; type: string; label: string; payload?: any }> = [];
  
  // Add "show more" action for product discovery queries when there are more products available
  // Only show for product discovery (when we have product cards and it's not clarification/product-specific Q&A)
  const hasMoreProducts = productsWithScores.length > 4; // We show 4, so check if there are more
  const nonDiscoveryRoutes = ['CLARIFICATION_NEEDED', 'PDP_SUITABILITY', 'PRODUCT_NOT_FOUND', 'NO_MATCH'];
  const isProductDiscovery = productCards.length > 0 && 
                             routerResult.route && 
                             !nonDiscoveryRoutes.includes(routerResult.route);
  
  if (isProductDiscovery && hasMoreProducts) {
    // Generate unique action ID
    const actionId = `show_more_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    actions.push({
      id: actionId,
      type: 'show_more',
      label: 'Show more',
      payload: {
        currentProductCount: productCards.length,
        totalAvailableProducts: productsWithScores.length,
      },
    });
    
    logger.info('show_more_action_added', {
      query: input.message.substring(0, 100),
      currentProductCount: productCards.length,
      totalAvailableProducts: productsWithScores.length,
      route: routerResult.route,
    });
  }
  
  // Add other actions from router if available (but don't duplicate show_more)
  if (routerResult.action && routerResult.action.type !== 'show_more') {
    actions.push({
      id: `action_${Date.now()}`,
      type: routerResult.action.type || 'show_more',
      label: routerResult.action.label || 'Show more',
    });
  }

  // Build resolved constraints - use merged constraints if available, otherwise from classification
  // Merged constraints take priority as they represent the complete merged state
  const finalConstraints = isFollowUp && mergedConstraints 
    ? mergedConstraints 
    : classification.constraints;
  
  // Log final constraints before conversion
  const finalConstraintsSummary: Record<string, any> = {};
  if (finalConstraints.colors) finalConstraintsSummary.colors = finalConstraints.colors;
  if (finalConstraints.sizes) finalConstraintsSummary.sizes = finalConstraints.sizes;
  if (finalConstraints.occasions) finalConstraintsSummary.occasions = finalConstraints.occasions;
  if (finalConstraints.styles) finalConstraintsSummary.styles = finalConstraints.styles;
  if (finalConstraints.patterns) finalConstraintsSummary.patterns = finalConstraints.patterns;
  if (finalConstraints.materials) finalConstraintsSummary.materials = finalConstraints.materials;
  if (finalConstraints.seasons) finalConstraintsSummary.seasons = finalConstraints.seasons;
  if (finalConstraints.fits) finalConstraintsSummary.fits = finalConstraints.fits;
  if (finalConstraints.collections) finalConstraintsSummary.collections = finalConstraints.collections;
  if (finalConstraints.embellishments) finalConstraintsSummary.embellishments = finalConstraints.embellishments;
  if (finalConstraints.necklines) finalConstraintsSummary.necklines = finalConstraints.necklines;
  if (finalConstraints.sleeveLengths) finalConstraintsSummary.sleeveLengths = finalConstraints.sleeveLengths;
  if (finalConstraints.ageGroups) finalConstraintsSummary.ageGroups = finalConstraints.ageGroups;
  if (finalConstraints.priceMinCents !== undefined && finalConstraints.priceMinCents !== null) finalConstraintsSummary.priceMinCents = finalConstraints.priceMinCents;
  if (finalConstraints.priceMaxCents !== undefined && finalConstraints.priceMaxCents !== null) finalConstraintsSummary.priceMaxCents = finalConstraints.priceMaxCents;
  
  logger.info('orchestrator_final_constraints', {
    query: input.message.substring(0, 200),
    isFollowUp,
    hasMergedConstraints: !!mergedConstraints,
    finalConstraintsSource: isFollowUp && mergedConstraints ? 'merged' : 'classification',
    finalConstraintsCount: Object.keys(finalConstraintsSummary).length,
    allFinalConstraints: finalConstraintsSummary,
    productTerms: classification.productTerms || 'none',
    hasProductTerms: !!classification.productTerms && classification.productTerms !== 'item',
  });
  
  // Helper to convert null to undefined for array fields
  const nullToUndefined = <T>(value: T | null | undefined): T | undefined => 
    value === null ? undefined : value;
  
  // Helper to extract values from intent format for SearchConstraints
  const extractValuesForSearch = (constraint: string[] | ConstraintWithIntent | null | undefined): string[] | undefined => {
    if (constraint === null || constraint === undefined) return undefined;
    const values = extractConstraintValues(constraint) || (Array.isArray(constraint) ? constraint : []);
    return values.length > 0 ? values : undefined;
  };
  
  // Map FashionConstraints to SearchConstraints (only include fields that exist in SearchConstraints)
  // Map scents to sensoryProfile: combine scents into a string description
  const scentValues = extractValuesForSearch(finalConstraints.scents) || (Array.isArray(finalConstraints.scents) ? finalConstraints.scents : []);
  const sensoryProfileFromScents = scentValues.length > 0
    ? scentValues.join(', ') + ' scent'
    : undefined;
  
  // Merge sensoryProfile from scents with explicit sensoryProfile (prefer explicit if both exist)
  const mergedSensoryProfile = finalConstraints.sensoryProfile || sensoryProfileFromScents;
  
  const resolvedConstraints: SearchConstraints = {
    colors: extractValuesForSearch(finalConstraints.colors),
    sizes: extractValuesForSearch(finalConstraints.sizes),
    materials: extractValuesForSearch(finalConstraints.materials),
    occasions: extractValuesForSearch(finalConstraints.occasions),
    seasons: extractValuesForSearch(finalConstraints.seasons),
    lengths: extractValuesForSearch(finalConstraints.lengths),
    priceMinCents: finalConstraints.priceMinCents === null ? undefined : finalConstraints.priceMinCents,
    priceMaxCents: finalConstraints.priceMaxCents === null ? undefined : finalConstraints.priceMaxCents,
    ageGroups: extractValuesForSearch(finalConstraints.ageGroups),
    // Map fashion-specific fields to generic SearchConstraints fields where applicable
    // styles -> styleTags, patterns -> styleTags (both are style descriptors)
    styleTags: (() => {
      const styleValues = extractValuesForSearch(finalConstraints.styles) || [];
      const patternValues = extractValuesForSearch(finalConstraints.patterns) || [];
      const combined = [...styleValues, ...patternValues];
      return combined.length > 0 ? combined : undefined;
    })(),
    // Map category-specific constraints
    // scents -> sensoryProfile (convert array to string description)
    sensoryProfile: mergedSensoryProfile || undefined,
    // rooms -> useCases (rooms are a type of useCase for home products)
    useCases: (() => {
      const roomValues = extractValuesForSearch(finalConstraints.rooms) || [];
      const useCaseValues = extractValuesForSearch(finalConstraints.useCases) || [];
      const combined = [...roomValues, ...useCaseValues];
      return combined.length > 0 ? combined : undefined;
    })(),
    // Direct mappings for generic constraints
    benefits: extractValuesForSearch(finalConstraints.benefits),
    claims: extractValuesForSearch(finalConstraints.claims),
    compatibility: extractValuesForSearch(finalConstraints.compatibility),
    // Enriched fashion facets
    formalityLevel: extractValuesForSearch(finalConstraints.formalityLevel),
    temperatureIntent: finalConstraints.temperatureIntent === null ? undefined : finalConstraints.temperatureIntent,
    humidityFriendly: finalConstraints.humidityFriendly === null ? undefined : finalConstraints.humidityFriendly,
    occasionContext: extractValuesForSearch(finalConstraints.occasionContext),
    problemSolutions: extractValuesForSearch(finalConstraints.problemSolutions),
    functionFeatures: extractValuesForSearch(finalConstraints.functionFeatures),
    colorShade: extractValuesForSearch(finalConstraints.colorShade),
    colorUndertone: extractValuesForSearch(finalConstraints.colorUndertone),
    multicolor: finalConstraints.multicolor === null ? undefined : finalConstraints.multicolor,
    seasonalPalette: extractValuesForSearch(finalConstraints.seasonalPalette),
  };
  
  const resolvedClassificationConstraints: FashionConstraints = finalConstraints;
  
  logger.info('orchestrator_resolved_constraints', {
    query: input.message.substring(0, 200),
    resolvedConstraints: {
      colors: resolvedConstraints.colors,
      sizes: resolvedConstraints.sizes,
      materials: resolvedConstraints.materials,
      occasions: resolvedConstraints.occasions,
      seasons: resolvedConstraints.seasons,
      priceMinCents: resolvedConstraints.priceMinCents,
      priceMaxCents: resolvedConstraints.priceMaxCents,
      ageGroups: resolvedConstraints.ageGroups,
      styleTags: resolvedConstraints.styleTags,
    },
    constraintsPassedToRanking: {
      colors: constraintsForRanking.colors,
      patterns: constraintsForRanking.patterns,
      occasions: constraintsForRanking.occasions,
      materials: constraintsForRanking.materials,
      sizes: constraintsForRanking.sizes,
      ageGroups: constraintsForRanking.ageGroups,
      priceMinCents: constraintsForRanking.priceMinCents,
      priceMaxCents: constraintsForRanking.priceMaxCents,
      seasons: constraintsForRanking.seasons,
      styles: constraintsForRanking.styles,
      fits: constraintsForRanking.fits,
      lengths: constraintsForRanking.lengths,
      necklines: constraintsForRanking.necklines,
      sleeveLengths: constraintsForRanking.sleeveLengths,
      collections: constraintsForRanking.collections,
      embellishments: constraintsForRanking.embellishments,
    },
  });

  onProgress?.('complete', STAGE_PROGRESS.complete);

  // Final pipeline summary log
  logger.info('orchestrator_pipeline_summary', {
    query: input.message.substring(0, 200),
    isFollowUp,
    enhancedQueryText: enhancedQueryText || input.message,
    productTerms: classification.productTerms || 'none',
    classificationType: classification.type,
    topCategories: topCategories.slice(0, 5),
    candidateProductCount: candidateProducts.length,
    finalProductCount: validatedProducts.length,
    constraintsFlow: {
      classificationConstraints: {
        colors: classification.constraints.colors,
        patterns: classification.constraints.patterns,
        occasions: classification.constraints.occasions,
        priceMinCents: classification.constraints.priceMinCents,
        priceMaxCents: classification.constraints.priceMaxCents,
      },
      parsedConstraints: null, // Parser removed - all constraints come from classifier
      mergedConstraints: mergedConstraints ? {
        colors: mergedConstraints.colors,
        patterns: mergedConstraints.patterns,
        occasions: mergedConstraints.occasions,
        priceMinCents: mergedConstraints.priceMinCents,
        priceMaxCents: mergedConstraints.priceMaxCents,
      } : null,
      finalConstraints: {
        colors: finalConstraints.colors,
        patterns: finalConstraints.patterns,
        occasions: finalConstraints.occasions,
        priceMinCents: finalConstraints.priceMinCents,
        priceMaxCents: finalConstraints.priceMaxCents,
      },
      constraintsPassedToRanking: {
        colors: constraintsForRanking.colors,
        patterns: constraintsForRanking.patterns,
        occasions: constraintsForRanking.occasions,
        priceMinCents: constraintsForRanking.priceMinCents,
        priceMaxCents: constraintsForRanking.priceMaxCents,
        seasons: constraintsForRanking.seasons,
        styles: constraintsForRanking.styles,
        materials: constraintsForRanking.materials,
        fits: constraintsForRanking.fits,
        lengths: constraintsForRanking.lengths,
        sleeveLengths: constraintsForRanking.sleeveLengths,
        necklines: constraintsForRanking.necklines,
        ageGroups: constraintsForRanking.ageGroups,
      },
    },
    topProducts: validatedProducts.slice(0, 4).map((p, idx) => ({
      rank: idx + 1,
      productId: p.id,
      productTitle: p.title?.substring(0, 80),
    })),
  });

  // CRITICAL: Always ensure replyTextAfter exists when we have products
  // This is a safety net to ensure the post-card text always appears
  let finalReplyTextAfter = replyResult.replyTextAfter;
  if (validatedProducts.length > 0) {
    // If we have products but no replyTextAfter, use a fallback
    if (!finalReplyTextAfter || finalReplyTextAfter.trim().length === 0) {
      finalReplyTextAfter = `I hope you find something perfect here.`;
    }
  } else {
    // No products, no replyTextAfter
    finalReplyTextAfter = undefined;
  }

  // Store the enhanced query in conversation memory for cumulative context building
  // This allows the next follow-up to merge with this enhanced query (not just the raw user message)
  // For new searches, store the current message as the enhanced query
  // For follow-ups, store the merged enhanced query
  const queryToStore = isFollowUp && enhancedQueryText ? enhancedQueryText : input.message;
  
  // CRITICAL: Await the state update to ensure it's persisted before returning
  // This ensures the next follow-up query can read the enhanced query from the database
  // Use updateMemory which properly merges with existing memory instead of replacing it
  if (input.merchantId) {
    try {
      const memoryUpdate = {
        lastEnhancedQuery: queryToStore,
        lastCategories: topCategories && topCategories.length > 0 ? topCategories : undefined,
        // NEW: Store classification constraints for age group switch detection
        lastClassificationConstraints: {
          ageGroups: classification.constraints.ageGroups ?? undefined,
          colors: classification.constraints.colors ?? undefined,
          occasions: classification.constraints.occasions ?? undefined,
          seasons: classification.constraints.seasons ?? undefined,
          formalityLevel: classification.constraints.formalityLevel ?? undefined,
          priceMinCents: classification.constraints.priceMinCents ?? undefined,
          priceMaxCents: classification.constraints.priceMaxCents ?? undefined,
        },
      };
      
      logger.debug('storing_enhanced_query', {
        sessionId: input.sessionId,
        enhancedQuery: queryToStore.substring(0, 100),
        isFollowUp,
        memoryUpdate: JSON.stringify(memoryUpdate).substring(0, 200),
      });
      
      const updatedMemory = await updateMemory(input.merchantId, input.sessionId, memoryUpdate);
      
      logger.debug('enhanced_query_stored_successfully', {
        sessionId: input.sessionId,
        enhancedQuery: queryToStore.substring(0, 100),
        isFollowUp,
        storedLastEnhancedQuery: updatedMemory.lastEnhancedQuery?.substring(0, 100),
        verification: updatedMemory.lastEnhancedQuery === queryToStore ? 'MATCH' : 'MISMATCH',
      });
    } catch (err) {
      logger.error('failed_to_store_enhanced_query', {
        error: err instanceof Error ? err.message : String(err),
        sessionId: input.sessionId,
      });
    }
  }

  const result: LoveshackfancyQueryResult = {
    replyText: replyResult.replyText,
    // Always include replyTextAfter when we have product cards to show
    replyTextAfter: finalReplyTextAfter,
    productCards,
    noExactMatch: validatedProducts.length === 0,
    actions: actions.length > 0 ? actions : undefined,
    route: routerResult.route,
    actionType: routerResult.action?.type || undefined,
    resolvedConstraints,
    resolvedClassificationConstraints,
    constraintsPassedToRanking: {
      colors: constraintsForRanking.colors,
      patterns: constraintsForRanking.patterns,
      occasions: constraintsForRanking.occasions,
      priceMinCents: constraintsForRanking.priceMinCents,
      priceMaxCents: constraintsForRanking.priceMaxCents,
      seasons: constraintsForRanking.seasons,
      styles: constraintsForRanking.styles,
      materials: constraintsForRanking.materials,
      fits: constraintsForRanking.fits,
      lengths: constraintsForRanking.lengths,
      sleeveLengths: constraintsForRanking.sleeveLengths,
      necklines: constraintsForRanking.necklines,
      ageGroups: constraintsForRanking.ageGroups,
    },
    enhancedQuery: queryToStore, // Return the enhanced query so callers can use it for next follow-up
  };

  // Store ranked product IDs for "show more" functionality (only for product discovery queries)
  // This allows the next "show more" click to retrieve the next 4 products from the ranked list
  if (isProductDiscovery && input.merchantId && input.sessionId && productsWithScores.length > 0) {
    try {
      const rankedProductIds = productsWithScores.map(p => p.product.id);
      await setLastRankedProducts(input.merchantId, input.sessionId, rankedProductIds);
      logger.debug('stored_ranked_products_for_show_more', {
        query: input.message.substring(0, 100),
        rankedProductCount: rankedProductIds.length,
        sessionId: input.sessionId,
      });
    } catch (error) {
      logger.warn('failed_to_store_ranked_products', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: input.sessionId,
      });
    }
  }

  logger.info('handleLoveshackfancyQuery complete', {
    sessionId: input.sessionId,
    message: input.message.substring(0, 100),
    enhancedQuery: queryToStore.substring(0, 100),
    isFollowUp,
    productCount: productCards.length,
    route: routerResult.route,
  });

  return result;
}
