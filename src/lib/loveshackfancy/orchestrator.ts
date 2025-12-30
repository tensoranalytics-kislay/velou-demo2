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
import { classifyQuery, type QueryClassification, type FashionConstraints } from './classifier';
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
import { updateState, setLastRankedProducts } from '../chat/ConversationStateService';
import { parseQuery } from './query-parser';
import { rankWithConstraints } from './ranking/constraint-ranker';
import { classifyQueryToCategories, classifyQueryToCategoriesWithConfidence } from './category-classifier';
import { mergeFollowUpConstraints, isFollowUpRefinement } from './constraint-merger';
import { callLLM } from '../llm/provider';
import { buildProductQaPrompt } from '../llm/prompts';
import { matchAgeGroup } from './ranking/constraint-matcher';
import { handleIrrelevantQuery, generateIntelligentDenial } from './irrelevant-query-handler';

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
};

/**
 * Load products with fashion attributes
 */
async function loadFashionProducts(
  productIds: string[],
  merchantId?: string
): Promise<SearchResultItem[]> {
  if (productIds.length === 0) {
    return [];
  }

  // Optimized query: All selected fields are used in:
  // - Reply generation: title, attributes (style, length, occasion, pattern, material)
  // - Constraint ranking: attributes (all constraint matching), priceCents
  // - Product cards: id, title, imageUrl, productUrl, priceCents, salePriceCents, attributes
  // - Ranking features: all fields
  // Note: Using findMany with IN clause is efficient for small batches (typically 40 products)
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
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
    },
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
        // Redirect: Try category classification first
        onProgress?.('classifying', STAGE_PROGRESS.classifying);
        const categoryResult = await classifyQueryToCategoriesWithConfidence(input.message, input.merchantId);

        if (categoryResult.confidence >= 0.5 && categoryResult.categories.length > 0) {
          // Category identified confidently - proceed with discovery
          // Store categories to use after categorization step
          safetyCheckCategories = categoryResult.categories;
          logger.info('unrelated_query_redirected_category_identified', {
            query: input.message,
            categories: safetyCheckCategories,
            confidence: categoryResult.confidence,
            note: 'Category classification succeeded, proceeding with product discovery',
          });
          // Continue with normal flow - we'll use safetyCheckCategories after categorization
          // to override the irrelevant check if needed
        } else {
          // Category unclear - generate intelligent redirect with segue
          const potentialCategories = decision.potentialCategories || categoryResult.categories || [];
          logger.info('unrelated_query_redirected_category_unclear', {
            query: input.message,
            potentialCategories,
            confidence: categoryResult.confidence,
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

  // Step 2: Check for pending follow-ups (after product context handling)
  // This ensures responses to follow-up questions are handled correctly even if they look "irrelevant"
  const conversationState = input.conversationState || {
    shownProductIds: [],
    lastQueryFingerprint: null,
    lastRankedProductIds: [],
    lastRankCursor: 0,
    pendingActions: [],
    memory: {},
  };

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
        // User answered a follow-up question
        const updatedResponses = [...pendingFollowups.responses, input.message];
        const updatedFollowups = {
          ...pendingFollowups,
          responses: updatedResponses,
        };

        // Check if we have enough responses (2-3 questions, 2-3 responses)
        if (updatedResponses.length >= pendingFollowups.questions.length) {
          // We have all responses - enhance and search
          onProgress?.('understanding', STAGE_PROGRESS.understanding + 5);
          const enhancedQuery = await enhanceQuery(
            pendingFollowups.originalQuery,
            updatedResponses,
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
              context: 'clear_pending_followups_enhanced'
            }));
          }

          // Use enhanced query for search - replace message for remaining flow
          // We'll use enhancedQuery.enhancedQueryText for classification and retrieval
          const originalMessage = input.message;
          input.message = enhancedQuery.enhancedQueryText;

          // Continue with normal flow using enhanced query
          logger.info('query_enhanced_and_proceeding', {
            originalQuery: pendingFollowups.originalQuery,
            enhancedQuery: enhancedQuery.enhancedQueryText,
            responseCount: updatedResponses.length,
          });
        } else {
          // Still waiting for more responses - regenerate next question based on accumulated responses
          const remainingQuestions = pendingFollowups.questions.slice(updatedResponses.length);
          
          // Regenerate the next question to be more contextual based on user's responses
          onProgress?.('generating', STAGE_PROGRESS.generating);
          const nextQuestion = await regenerateNextQuestion(
            pendingFollowups.originalQuery,
            updatedResponses,
            remainingQuestions,
            pendingFollowups.preliminaryProducts,
            input.merchantData?.datasetContext
          );

          // Update the questions list with the regenerated question
          const updatedQuestions = [
            ...pendingFollowups.questions.slice(0, updatedResponses.length),
            nextQuestion,
            ...remainingQuestions.slice(1), // Keep the rest as-is for now
          ];

          const updatedFollowupsWithQuestions = {
            ...updatedFollowups,
            questions: updatedQuestions,
          };

          // Update state with new response and regenerated questions (fire-and-forget - non-blocking)
          if (input.merchantId) {
            updateState(input.merchantId, input.sessionId, {
              memory: {
                ...conversationState.memory,
                pendingFollowups: updatedFollowupsWithQuestions,
              },
            }).catch(err => logger.warn('state_update_failed', { 
              error: err instanceof Error ? err.message : String(err),
              context: 'update_pending_followups'
            }));
          }

          logger.info('next_followup_question_regenerated', {
            originalQuery: pendingFollowups.originalQuery,
            responseCount: updatedResponses.length,
            nextQuestion: nextQuestion.substring(0, 100),
          });

          onProgress?.('complete', STAGE_PROGRESS.complete);
          return {
            replyText: nextQuestion, // Ask regenerated contextual question
            productCards: [],
            noExactMatch: true,
            route: 'CLARIFICATION_NEEDED',
          };
        }
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

  // CRITICAL: Use the last enhanced query (if available) as the base for merging
  // This allows cumulative context building: each follow-up merges with the previous enhanced query
  // Example: 
  // 1. "dresses in light colours" → enhanced: "light coloured dresses" (stored)
  // 2. "only in light colours" → merges with "light coloured dresses" → enhanced: "light coloured dresses" (stored)
  // 3. "find floral ones" → merges with "light coloured dresses" → enhanced: "light coloured floral dresses"
  if (input.conversationState?.memory?.lastEnhancedQuery) {
    previousEnhancedQuery = input.conversationState.memory.lastEnhancedQuery;
    logger.debug('using_previous_enhanced_query_for_merging', {
      previousEnhancedQuery: previousEnhancedQuery.substring(0, 100),
      currentMessage: input.message.substring(0, 100),
    });
  }

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
  
  // Early category change detection: If user is asking for a completely different product category,
  // treat it as a new search immediately, bypassing follow-up processing
  const categoryKeywords = {
    apparel: ['dress', 'dresses', 'top', 'tops', 'bottom', 'bottoms', 'skirt', 'skirts', 'swimsuit', 'swimsuits', 'bikini', 'bikinis', 'onesie', 'onesies', 'romper', 'rompers', 'pant', 'pants', 'short', 'shorts', 'jogger', 'joggers', 'sweater', 'sweaters', 'loungewear', 'activewear'],
    accessories: ['jewelry', 'accessories', 'bag', 'bags', 'tote', 'hair accessory', 'phone case'],
    personalCare: ['perfume', 'perfumes', 'fragrance', 'fragrances'],
    homeLiving: ['bedding', 'bed', 'towel', 'towels', 'decor', 'decoration', 'candle', 'candles', 'tabletop', 'interior', 'interiors', 'dish', 'dishes'],
  };
  
  const messageLower = input.message.toLowerCase();
  const currentCategoryGroups = Object.entries(categoryKeywords)
    .filter(([_, keywords]) => keywords.some(kw => messageLower.includes(kw)))
    .map(([group, _]) => group);
  
  let isCategoryChange = false;
  if (hasQueryToMergeWith && queryToMergeWith) {
    const previousQueryLower = queryToMergeWith.toLowerCase();
    const previousCategoryGroups = Object.entries(categoryKeywords)
      .filter(([_, keywords]) => keywords.some(kw => previousQueryLower.includes(kw)))
      .map(([group, _]) => group);
    
    // If current message mentions a different category group than previous query, it's a category change
    if (currentCategoryGroups.length > 0 && previousCategoryGroups.length > 0) {
      const hasSharedCategory = currentCategoryGroups.some(cg => previousCategoryGroups.includes(cg));
      if (!hasSharedCategory) {
        isCategoryChange = true;
        logger.info('category_change_detected_early', {
          currentMessage: input.message.substring(0, 100),
          previousQuery: queryToMergeWith.substring(0, 100),
          currentCategoryGroups,
          previousCategoryGroups,
          note: 'Different category groups detected - treating as new search',
        });
      }
    }
  }
  
  // If we have a query to merge with and the message is short, let the LLM decide (even if it doesn't match patterns)
  // This allows logical follow-ups like "Show me close matches, price can be higher" to be detected
  // Previous constraints are helpful but not required - LLM can infer constraints from previous query text
  // BUT: Skip follow-up processing if we detected a category change
  const shouldCheckWithLLM = hasQueryToMergeWith && (isShortMessage || matchesFollowUpPattern) && !isCategoryChange;

  // If category change detected, skip follow-up processing and treat as new search
  if (isCategoryChange) {
    isFollowUp = false;
    mergedConstraints = null;
    enhancedQueryText = input.message; // Use current message as-is
    
    logger.info('category_change_treated_as_new_search', {
      currentMessage: input.message.substring(0, 100),
      previousQuery: queryToMergeWith?.substring(0, 100),
      note: 'Category change detected - skipping follow-up processing',
    });
  } else if (shouldCheckWithLLM) {
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
      onProgress?.('understanding', STAGE_PROGRESS.understanding);
      const mergeResult = await mergeFollowUpConstraints(
        queryToMergeWith!,
        input.lastClassificationConstraints || null,
        input.message,
        input.history // Pass full conversation history to help trace back product type
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
        
        if (hasSimilarColoursRequest && mergedConstraints.colors && mergedConstraints.colors.length > 0) {
          try {
            const { expandColorsWithSimilarity } = await import('./color-similarity');
            const expandedColors = await expandColorsWithSimilarity(
              mergedConstraints.colors,
              0.8, // Higher threshold (0.8) to ensure only truly similar colors (e.g., red → burgundy, crimson, rose, NOT blue, purple, pink)
              5    // Limit to 5 similar colors max per original color
            );
            
            if (expandedColors.length > mergedConstraints.colors.length) {
              const originalColorsLength = mergedConstraints.colors.length;
              mergedConstraints.colors = expandedColors;
              logger.info('color_expansion_for_similar_colours_request', {
                originalMessage: input.message.substring(0, 100),
                originalColors: mergeResult.mergedConstraints.colors,
                expandedColors,
                expansionCount: expandedColors.length - originalColorsLength,
                note: 'User requested similar colours, expanded color list using embedding similarity',
              });
            }
          } catch (error) {
            logger.warn('color_expansion_for_similar_colours_failed', {
              error: error instanceof Error ? error.message : String(error),
              originalColors: mergedConstraints.colors,
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
          finalColorCount: mergedConstraints.colors?.length || 0,
        });

        // Update message to use enhanced query for remaining pipeline
        // This ensures the merged constraints go through categorization → dedupe → vector search → ranking
        input.message = enhancedQueryText;
        
        logger.debug('follow_up_enhanced_query_set', {
          originalMessage: input.message.substring(0, 100),
          willGoThroughFullPipeline: true,
        });
      } else if (mergeResult.mergeAction === 'new_search') {
        // LLM determined this is logically incompatible (e.g., bikinis + wedding)
        // Treat as a completely new search - reset all constraints
        isFollowUp = false;
        mergedConstraints = null; // Reset all constraints
        enhancedQueryText = mergeResult.enhancedQueryText; // Use the enhanced query (should be CURRENT_MESSAGE)
        
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

  // Step 3: Query Categorization
  // For merged follow-ups, we skip the indirect_search check since we know it's a follow-up refinement
  // and should proceed through the full pipeline (categorization → dedupe → vector search → ranking)
  onProgress?.('classifying', STAGE_PROGRESS.classifying);
  const categorization = await categorizeQuery(
    input.message,
    input.merchantData?.datasetContext,
    input.merchantId
  );

  // Declare topCategories early so it's accessible throughout (may be set for indirect_search or safety check)
  let topCategories: string[] = safetyCheckCategories || [];

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
      // Redirect: Try category classification first
      onProgress?.('classifying', STAGE_PROGRESS.classifying);
      const categoryResult = await classifyQueryToCategoriesWithConfidence(
        input.message,
        input.merchantId
      );

      if (categoryResult.confidence >= 0.5 && categoryResult.categories.length > 0) {
        // Category identified confidently - proceed with discovery
        topCategories = categoryResult.categories;
        logger.info('irrelevant_query_redirected_category_identified', {
          query: input.message,
          categories: topCategories,
          confidence: categoryResult.confidence,
          note: 'Category classification succeeded, proceeding with product discovery',
        });
        // Continue with normal flow
      } else {
        // Category unclear - generate intelligent redirect with segue
        const potentialCategories = decision.potentialCategories || categoryResult.categories || [];
        logger.info('irrelevant_query_redirected_category_unclear', {
          query: input.message,
          potentialCategories,
          confidence: categoryResult.confidence,
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
  }

  // Handle indirect/vague queries
  // CRITICAL: If this is a merged follow-up, skip the indirect_search check and proceed with search
  // The constraint merger has already determined this is a follow-up refinement, so we should proceed
  // even if the categorizer thinks it's vague (e.g., "wedding outfits" after "bikinis" - the merger
  // should have preserved the product type, but if it didn't, we still proceed since it's a follow-up)
  if (categorization.category === 'indirect_search' && !isFollowUp) {
    // NEW: Try category classification first before asking questions
    // If we can confidently identify categories, proceed with discovery immediately
    logger.info('indirect_search_attempting_category_classification', {
      query: input.message,
      hasPreliminaryProducts: !!categorization.preliminaryProducts?.length,
    });
    
    onProgress?.('classifying', STAGE_PROGRESS.classifying);
    // Use the function that returns confidence info to capture potential categories even if low confidence
    const categoryResult = await classifyQueryToCategoriesWithConfidence(input.message, input.merchantId);
    
    if (categoryResult.confidence >= 0.5 && categoryResult.categories.length > 0) {
      // Category identified confidently - proceed with discovery instead of asking questions
      topCategories = categoryResult.categories;
      logger.info('indirect_search_category_identified_proceeding_with_discovery', {
        query: input.message,
        categories: topCategories,
        categoryCount: topCategories.length,
        confidence: categoryResult.confidence,
        note: 'Category classification succeeded, proceeding with product discovery',
      });
      
      // Set topCategories so it's used in the search pipeline below
      // Continue to the classification and search pipeline (don't return early)
    } else {
      // Category unclear or low confidence - generate follow-up questions with potential categories
      const potentialCategories = categoryResult.categories.length > 0 ? categoryResult.categories : [];
      logger.info('indirect_search_category_unclear_generating_followup_questions', {
        query: input.message,
        potentialCategories,
        confidence: categoryResult.confidence,
        note: 'Category classification returned low confidence or empty, asking follow-up questions with potential categories',
      });
      
      onProgress?.('generating', STAGE_PROGRESS.generating);
      const followups = await generateFollowUpQuestions(
        input.message,
        categorization.preliminaryProducts,
        input.merchantData?.datasetContext,
        potentialCategories // Pass potential categories to include in questions
      );
      logger.info('followup_questions_received', {
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
              preliminaryProducts: categorization.preliminaryProducts,
            },
          },
        }).catch(err => logger.warn('state_update_failed', { 
          error: err instanceof Error ? err.message : String(err),
          context: 'store_pending_followups'
        }));
      }

      onProgress?.('complete', STAGE_PROGRESS.complete);
      // Show witty contextSummary (acknowledging the vague request) followed by first question only
      const firstQuestion = followups.questions.length > 0 
        ? `\n\n${followups.questions[0]}`
        : '';
      const replyText = `${followups.contextSummary}${firstQuestion}`;
      console.log('[ORCHESTRATOR] FINAL replyText being returned:', replyText);
      logger.info('indirect_search_reply_constructed', {
        query: input.message,
        contextSummaryLength: followups.contextSummary.length,
        questionsCount: followups.questions.length,
        replyTextPreview: replyText.substring(0, 200),
        totalReplyLength: replyText.length,
      });
      return {
        replyText,
        productCards: [],
        noExactMatch: true,
        route: 'CLARIFICATION_NEEDED',
      };
    }
  }

  // Step 4: Query classification (for direct_search or enhanced queries)
  // Step 3.5: Category Classification (for product discovery only) - run in parallel when both are needed
  // Optimize: Run classifyQuery and classifyQueryToCategories in parallel for direct_search queries
  // Also run category classification for indirect_search queries that are follow-ups, have clear category signals,
  // or have already been classified above (when category was identified for indirect_search)
  onProgress?.('understanding', STAGE_PROGRESS.understanding);
  let classification: QueryClassification;
  
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
        // Check for clear category signals in the query
        /\b(newborn|baby|infant|toddler|kids?|children|girls?|boys?|women|men|adult|home|decor|bedding|tabletop|bath|personal care|accessories?|juvenile|youth|adolescent|teen|teenage|teenager|young|pre-teen|tween)\b/i.test(input.message)
      ))
    )
  );
  
  // If this is a direct_search or an indirect_search with context, run both LLM calls in parallel for better performance
  if (shouldRunCategoryClassification) {
    logger.info('parallelizing_classification_and_category_classification', {
      query: input.message.substring(0, 100),
      categorizationCategory: categorization.category,
      isFollowUp,
      hasCategorySignals: /\b(newborn|baby|infant|toddler|kids?|children|girls?|boys?|women|men|adult|home|decor|bedding|tabletop|bath|personal care|accessories?|juvenile|youth|adolescent|teen|teenage|teenager|young|pre-teen|tween)\b/i.test(input.message),
    });
    
    onProgress?.('classifying', 20);
    
    // Run both classification calls in parallel
    const constraintsForClassification = isFollowUp && mergedConstraints
      ? mergedConstraints
      : null;
    
    const [classificationResult, categoryResult] = await Promise.all([
      // Query classification
      (async (): Promise<QueryClassification> => {
        try {
          const result = await classifyQuery(input.message, constraintsForClassification);
          // If we merged constraints, override classification constraints with merged ones
          if (isFollowUp && mergedConstraints) {
            result.constraints = mergedConstraints;
            logger.debug('classification_constraints_overridden_with_merged', {
              mergeAction: 'follow_up_merge',
              hasPrice: !!mergedConstraints.priceMaxCents || !!mergedConstraints.priceMinCents,
            });
          }
          return result;
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
              return result;
            } else {
              // Fallback 2: Use keyword-based classification
              const { inferClassificationFromKeywords } = await import('./classifier');
              const result = inferClassificationFromKeywords(input.message);
              logger.debug('handleLoveshackfancyQuery: using keyword fallback', {
                type: result.type,
                constraints: result.constraints,
              });
              return result;
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
            return result;
          }
        }
      })(),
      // Category classification
      // For direct_search queries, use classifyQueryToCategoriesWithConfidence to get confidence info
      (async (): Promise<{ categories: string[]; confidence: number } | string[]> => {
        try {
          console.log('[ORCHESTRATOR] Calling category classification', {
            query: input.message.substring(0, 100),
            merchantId: input.merchantId,
            categorizationCategory: categorization.category,
          });
          logger.info('category_classification_calling_function', {
            query: input.message.substring(0, 100),
            merchantId: input.merchantId,
            categorizationCategory: categorization.category,
          });
          
          // For direct_search queries, use the confidence version to check if category is clear
          if (categorization.category === 'direct_search') {
            const result = await classifyQueryToCategoriesWithConfidence(input.message, input.merchantId);
            
            console.log('[ORCHESTRATOR] Category classification result (with confidence)', {
              categories: result.categories,
              count: result.categories.length,
              confidence: result.confidence,
            });
            logger.info('category_classification_complete_with_confidence', {
              query: input.message.substring(0, 100),
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
            
            // Return both categories and confidence for direct_search
            return { categories: result.categories, confidence: result.confidence };
          } else {
            // For other query types, use the regular function
            const categories = await classifyQueryToCategories(input.message, input.merchantId);
            
            console.log('[ORCHESTRATOR] Category classification result', {
              categories: categories,
              count: categories.length,
            });
            logger.info('category_classification_complete', {
              query: input.message.substring(0, 100),
              categories: categories,
              categoryCount: categories.length,
            });
            
            if (categories.length > 0) {
              logger.info('category_filter_will_be_applied', {
                query: input.message.substring(0, 100),
                categories: categories,
                filterType: 'hard_sql_level',
                appliesTo: 'multi_view_retrieval',
              });
            }
            
            return categories;
          }
        } catch (error) {
          console.error('[ORCHESTRATOR] Category classification error', error);
          logger.warn('category_classification_failed_continuing', {
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            query: input.message.substring(0, 100),
          });
          // Continue without category filtering if classification fails
          // Return empty array or object with empty categories
          if (categorization.category === 'direct_search') {
            return { categories: [], confidence: 0 };
          }
          return [];
        }
      })(),
    ]);
    
    classification = classificationResult;
    
    // Handle category result - check confidence for direct_search queries
    if (categorization.category === 'direct_search' && typeof categoryResult === 'object' && 'confidence' in categoryResult) {
      const categoryResultWithConfidence = categoryResult as { categories: string[]; confidence: number };
      
      // Check if confidence is low or categories are empty
      if (categoryResultWithConfidence.confidence < 0.5 || categoryResultWithConfidence.categories.length === 0) {
        logger.info('direct_search_category_unclear_generating_followup', {
          query: input.message,
          categories: categoryResultWithConfidence.categories,
          confidence: categoryResultWithConfidence.confidence,
          note: 'Category classification returned low confidence or empty for direct_search, asking follow-up questions',
        });
        
        // Generate follow-up questions
        onProgress?.('generating', STAGE_PROGRESS.generating);
        const potentialCategories = categoryResultWithConfidence.categories.length > 0 ? categoryResultWithConfidence.categories : [];
        const followups = await generateFollowUpQuestions(
          input.message,
          undefined, // No preliminary products for unclear category
          input.merchantData?.datasetContext,
          potentialCategories
        );
        logger.info('direct_search_followup_questions_received', {
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
            context: 'store_pending_followups_direct_search_low_confidence'
          }));
        }

        onProgress?.('complete', STAGE_PROGRESS.complete);
        // Show contextSummary followed by first question only
        const firstQuestion = followups.questions.length > 0 
          ? `\n\n${followups.questions[0]}`
          : '';
        const replyText = `${followups.contextSummary}${firstQuestion}`;
        logger.info('direct_search_reply_constructed', {
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
      } else {
        // Confidence is high enough - proceed with product discovery
        topCategories = categoryResultWithConfidence.categories;
        logger.info('direct_search_category_confident_proceeding', {
          query: input.message,
          categories: topCategories,
          confidence: categoryResultWithConfidence.confidence,
          note: 'Category classification succeeded with high confidence, proceeding with product discovery',
        });
      }
    } else {
      // Not a direct_search or result is a simple array
      topCategories = Array.isArray(categoryResult) ? categoryResult : [];
    }
  } else {
    // Not a direct_search - only run query classification
    try {
      const constraintsForClassification = isFollowUp && mergedConstraints
        ? mergedConstraints
        : null;
      
      classification = await classifyQuery(input.message, constraintsForClassification);
      
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
      
      // Try category classification first (like vague queries)
      onProgress?.('classifying', STAGE_PROGRESS.classifying);
      const categoryResult = await classifyQueryToCategoriesWithConfidence(input.message, input.merchantId);
      
      if (categoryResult.confidence >= 0.5 && categoryResult.categories.length > 0) {
        // Category identified confidently - proceed with discovery
        topCategories = categoryResult.categories;
        logger.info('unrelated_query_from_classification_category_identified_proceeding', {
          query: input.message,
          categories: topCategories,
          confidence: categoryResult.confidence,
          note: 'Category classification succeeded, proceeding with product discovery',
        });
        
        // Override classification type to allow search to proceed
        classification.type = 'direct_product_search';
        // Continue with normal flow - topCategories is set, proceed to search pipeline
      } else {
        // Category unclear - generate witty follow-up questions to divert to product discovery
        const potentialCategories = categoryResult.categories.length > 0 ? categoryResult.categories : [];
        logger.info('unrelated_query_from_classification_category_unclear_generating_witty_followup', {
          query: input.message,
          potentialCategories,
          confidence: categoryResult.confidence,
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
  logger.info('query_parser_step_starting', {
    query: input.message.substring(0, 100),
    isFollowUp,
    hasMergedConstraints: !!mergedConstraints,
  });
  let queryParseResult: Awaited<ReturnType<typeof parseQuery>> | null = null;
  try {
    // CRITICAL: Only pass previous constraints if this is a follow-up
    // For new searches (isFollowUp=false), pass null to prevent carrying forward old constraints
    // This ensures queries like "show me loungewear" don't carry forward colors/styles/PRICE from previous queries
    // IMPORTANT: Price constraints (priceMinCents, priceMaxCents) are RESET for new searches - they are NOT carried forward
    // Only follow-up refinements can modify price constraints (e.g., "make it cheaper", "under $200")
    // IMPORTANT: Preserve null values (explicit removals) when passing to query parser
    // Convert null to a special marker that query parser can recognize, or pass as-is if type allows
    const constraintsForParser = isFollowUp && mergedConstraints
      ? {
          // Pass null values as-is - query parser will check for null to detect explicit removals
          colors: mergedConstraints.colors === null ? null : (mergedConstraints.colors ?? undefined),
          sizes: mergedConstraints.sizes === null ? null : (mergedConstraints.sizes ?? undefined),
          occasions: mergedConstraints.occasions === null ? null : (mergedConstraints.occasions ?? undefined),
          styles: mergedConstraints.styles === null ? null : (mergedConstraints.styles ?? undefined),
          patterns: mergedConstraints.patterns === null ? null : (mergedConstraints.patterns ?? undefined),
          seasons: mergedConstraints.seasons === null ? null : (mergedConstraints.seasons ?? undefined),
          materials: mergedConstraints.materials === null ? null : (mergedConstraints.materials ?? undefined),
          fits: mergedConstraints.fits === null ? null : (mergedConstraints.fits ?? undefined),
          collections: mergedConstraints.collections === null ? null : (mergedConstraints.collections ?? undefined),
          priceMinCents: mergedConstraints.priceMinCents === null ? null : (mergedConstraints.priceMinCents ?? undefined),
          priceMaxCents: mergedConstraints.priceMaxCents === null ? null : (mergedConstraints.priceMaxCents ?? undefined),
          embellishments: mergedConstraints.embellishments === null ? null : (mergedConstraints.embellishments ?? undefined),
          necklines: mergedConstraints.necklines === null ? null : (mergedConstraints.necklines ?? undefined),
          sleeveLengths: mergedConstraints.sleeveLengths === null ? null : (mergedConstraints.sleeveLengths ?? undefined),
          ageGroups: mergedConstraints.ageGroups === null ? null : (mergedConstraints.ageGroups ?? undefined),
        }
      : null; // For new searches, don't pass previous constraints
    onProgress?.('understanding', STAGE_PROGRESS.understanding + 5);
    queryParseResult = await parseQuery(input.message, constraintsForParser);
    const hasConstraints = Object.keys(queryParseResult.constraints).length > 0;
    logger.info('query_parse_result', {
      query: input.message.substring(0, 100),
      productTerms: queryParseResult.productTerms,
      hasConstraints,
      constraintCount: Object.keys(queryParseResult.constraints).length,
      constraints: queryParseResult.constraints,
      confidence: queryParseResult.confidence,
    });
  } catch (error) {
    logger.error('query_parsing_failed_continuing_with_classification', {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      query: input.message.substring(0, 100),
    });
    // Continue with classification-based approach if parsing fails
  }

  // Step 3.7: Merge parsed constraints into classification (especially price constraints)
  // This ensures price and other constraints from query parser are used in retrieval
  if (queryParseResult && queryParseResult.constraints) {
    // CRITICAL: Fix misclassified colors in patterns BEFORE merging
    // Move color terms that were incorrectly classified as patterns to colors
    const colorTerms = ['Cherry', 'Crimson', 'Scarlet', 'Burgundy', 'Maroon', 'Rose', 'Coral', 'Salmon', 'Rust', 'Terracotta'];
    if (queryParseResult.constraints.patterns && queryParseResult.constraints.patterns.length > 0) {
      const misclassifiedColors: string[] = [];
      const remainingPatterns: string[] = [];
      
      for (const pattern of queryParseResult.constraints.patterns) {
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
        queryParseResult.constraints.colors = Array.from(new Set([
          ...(queryParseResult.constraints.colors || []),
          ...misclassifiedColors
        ]));
        queryParseResult.constraints.patterns = remainingPatterns.length > 0 ? remainingPatterns : undefined;
        
        logger.debug('orchestrator_color_correction_from_patterns', {
          query: input.message.substring(0, 100),
          misclassifiedColors,
          correctedColors: queryParseResult.constraints.colors,
          correctedPatterns: queryParseResult.constraints.patterns,
          note: 'Moved color terms from patterns to colors in query parser result',
        });
      }
    }
    
    // Also check classification patterns for misclassified colors
    if (classification.constraints.patterns && classification.constraints.patterns.length > 0) {
      const misclassifiedColors: string[] = [];
      const remainingPatterns: string[] = [];
      
      for (const pattern of classification.constraints.patterns) {
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
        classification.constraints.colors = Array.from(new Set([
          ...(classification.constraints.colors || []),
          ...misclassifiedColors
        ]));
        classification.constraints.patterns = remainingPatterns.length > 0 ? remainingPatterns : null;
        
        logger.debug('orchestrator_color_correction_from_classification_patterns', {
          query: input.message.substring(0, 100),
          misclassifiedColors,
          correctedColors: classification.constraints.colors,
          correctedPatterns: classification.constraints.patterns,
          note: 'Moved color terms from patterns to colors in classification result',
        });
      }
    }
    
    // Merge parsed constraints into classification constraints
    // Priority: parsed constraints override classification constraints (more accurate)
    // Handle explicit removal (null) and independent min/max updates
    if (queryParseResult.constraints.priceMinCents === null) {
      // Explicitly removed
      classification.constraints.priceMinCents = undefined;
    } else if (queryParseResult.constraints.priceMinCents !== undefined) {
      // Update min (can be set independently of max)
      classification.constraints.priceMinCents = queryParseResult.constraints.priceMinCents;
    }
    // Note: If priceMinCents is undefined in parsed result, keep existing value from classification
    
    if (queryParseResult.constraints.priceMaxCents === null) {
      // Explicitly removed
      classification.constraints.priceMaxCents = undefined;
    } else if (queryParseResult.constraints.priceMaxCents !== undefined) {
      // Update max (can be set independently of min)
      classification.constraints.priceMaxCents = queryParseResult.constraints.priceMaxCents;
    }
    // Note: If priceMaxCents is undefined in parsed result, keep existing value from classification
    // Merge other constraints if they exist in parsed result
    // CRITICAL: For colors, merge (union) instead of replace to preserve all colors from both classification and parser
    if (queryParseResult.constraints.colors && queryParseResult.constraints.colors.length > 0) {
      // Merge colors: combine classification colors with parsed colors (union, no duplicates)
      const existingColors = classification.constraints.colors || [];
      const parsedColors = queryParseResult.constraints.colors;
      const mergedColors = Array.from(new Set([...existingColors, ...parsedColors]));
      classification.constraints.colors = mergedColors.length > 0 ? mergedColors : queryParseResult.constraints.colors;
      
      logger.debug('colors_merged_from_parser', {
        query: input.message.substring(0, 100),
        classificationColors: existingColors,
        parsedColors,
        mergedColors,
        note: 'Merged colors from classification and parser (union) to preserve all mentioned colors',
      });
    }
    if (queryParseResult.constraints.sizes && queryParseResult.constraints.sizes.length > 0) {
      classification.constraints.sizes = queryParseResult.constraints.sizes;
    }
    if (queryParseResult.constraints.occasions && queryParseResult.constraints.occasions.length > 0) {
      classification.constraints.occasions = queryParseResult.constraints.occasions;
    }
    if (queryParseResult.constraints.patterns && queryParseResult.constraints.patterns.length > 0) {
      classification.constraints.patterns = queryParseResult.constraints.patterns;
    }
    logger.debug('constraints_merged_from_parser', {
      query: input.message.substring(0, 100),
      priceMaxCents: classification.constraints.priceMaxCents,
      priceMinCents: classification.constraints.priceMinCents,
      hasOtherConstraints: Object.keys(queryParseResult.constraints).length > 2,
    });
  }

  // Step 4: Multi-view retrieval
  // Use parsed product terms for vector search if available, otherwise use full query
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
  
  let retrievalResult: MultiViewRetrievalResult;
  try {
    retrievalResult = await multiViewRetrieval(
      input.message,
      classification,
      queryParseResult?.productTerms, // Pass product terms for better vector search
      input.merchantId,
      input.searchMethods,
      topCategories.length > 0 ? topCategories : undefined // Pass top categories for HARD SQL-level filtering
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
    return {
      replyText: regretfulReply.replyText,
      productCards: [],
      noExactMatch: true,
    };
  }

  // Step 5: Load products - prioritize by vector similarity
  // Products are already deduplicated at SQL level (using parent_id, shopifyProductId, related_id)
  // So we only need to load enough for constraint-based ranking (typically 30-40 is sufficient)
  const MAX_PRODUCTS_TO_LOAD = 40; // Reduced from 100 - deduplication already done in SQL
  const candidateIdsToLoad = retrievalResult.candidateIds.slice(0, MAX_PRODUCTS_TO_LOAD);
  const candidateProducts = await loadFashionProducts(candidateIdsToLoad, input.merchantId);

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
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: regretfulReply.replyText,
      productCards: [],
      noExactMatch: true,
    };
  }

  // Step 6: Ranking with constraint-based scoring (NEW APPROACH)
  // Use parsed constraints for weighted ranking if available, otherwise fall back to vector similarity only
  onProgress?.('ranking', STAGE_PROGRESS.ranking);
  
  // Build final constraints - merge classification constraints with merged constraints
  // This ensures that constraints extracted by the classifier (like styles, materials, seasons)
  // are preserved even when using merged constraints from follow-ups
  // Merged constraints take priority for explicitly merged fields (colors, occasions, ageGroups, price)
  // Classification constraints are used as fallback for fields not in merged constraints (styles, materials, seasons)
  const finalConstraintsForRanking = isFollowUp && mergedConstraints 
    ? {
        // Merged constraints take priority for explicitly merged fields
        colors: mergedConstraints.colors ?? classification.constraints.colors,
        occasions: mergedConstraints.occasions ?? classification.constraints.occasions,
        ageGroups: mergedConstraints.ageGroups ?? classification.constraints.ageGroups,
        sizes: mergedConstraints.sizes ?? classification.constraints.sizes,
        priceMinCents: mergedConstraints.priceMinCents ?? classification.constraints.priceMinCents,
        priceMaxCents: mergedConstraints.priceMaxCents ?? classification.constraints.priceMaxCents,
        patterns: mergedConstraints.patterns ?? classification.constraints.patterns,
        // Classification constraints are used for fields not explicitly merged (styles, materials, seasons, fits, lengths)
        styles: mergedConstraints.styles ?? classification.constraints.styles,
        materials: mergedConstraints.materials ?? classification.constraints.materials,
        seasons: mergedConstraints.seasons ?? classification.constraints.seasons,
        fits: mergedConstraints.fits ?? classification.constraints.fits,
        lengths: mergedConstraints.lengths ?? classification.constraints.lengths,
        collections: mergedConstraints.collections ?? classification.constraints.collections,
        embellishments: mergedConstraints.embellishments ?? classification.constraints.embellishments,
        necklines: mergedConstraints.necklines ?? classification.constraints.necklines,
        sleeveLengths: mergedConstraints.sleeveLengths ?? classification.constraints.sleeveLengths,
      }
    : classification.constraints;
  
  // CRITICAL: If merged constraints have invalid colors (like "Dark"), prefer classification colors
  // The classifier is better at inferring colors from context (e.g., "dark colours" → ["Black", "Navy", etc.])
  // The constraint merger might extract generic terms like "Dark" which aren't in the ontology
  // CRITICAL: When we have merged constraints (from constraint merger), preserve them and merge with query parser colors (union)
  let finalColors = finalConstraintsForRanking.colors || queryParseResult?.constraints.colors;
  if (isFollowUp && mergedConstraints?.colors && queryParseResult?.constraints.colors) {
    // Merge merged constraints colors with query parser colors (union) to preserve non-ontology colors
    const mergedColors = Array.from(new Set([...mergedConstraints.colors, ...queryParseResult.constraints.colors]));
    finalColors = mergedColors;
    logger.debug('colors_merged_from_merged_constraints_and_parser', {
      query: input.message.substring(0, 100),
      mergedConstraintsColors: mergedConstraints.colors,
      parsedColors: queryParseResult.constraints.colors,
      finalColors,
      note: 'Merged colors from constraint merger and query parser (union) to preserve non-ontology colors',
    });
  }
  if (finalColors && finalColors.length > 0) {
    // Check if any colors are invalid (not in ontology)
    const { LOVESHACKFANCY_ONTOLOGY } = await import('./ontology');
    const validColors = new Set(LOVESHACKFANCY_ONTOLOGY.colors.map(c => c.toLowerCase()));
    const invalidColors = finalColors.filter(c => !validColors.has(c.toLowerCase()));
    
    if (invalidColors.length > 0) {
      // Keep invalid colors for ranking (fuzzy matching can handle them)
      // But also include valid colors from classification if available
      logger.debug('non_ontology_colors_detected_keeping_for_ranking', {
        nonOntologyColors: invalidColors,
        allColors: finalColors,
        note: 'Non-ontology colors (e.g., "Cherry") will be used for fuzzy matching in ranking',
      });
      
      // Merge with classification colors if they exist (union)
      if (classification.constraints.colors && classification.constraints.colors.length > 0) {
        const mergedColors = Array.from(new Set([...finalColors, ...classification.constraints.colors]));
        finalColors = mergedColors;
        logger.debug('merged_colors_with_classification', {
          originalColors: finalConstraintsForRanking.colors,
          classificationColors: classification.constraints.colors,
          mergedColors: finalColors,
        });
      }
      // Don't filter out invalid colors - keep them for fuzzy matching
    }
  }
  
  // Build constraints for ranking: use finalConstraints (which includes classification colors)
  // This ensures colors inferred by the classifier are used for ranking, even if query parser didn't extract them
  const constraintsForRanking = {
    colors: finalColors,
    patterns: queryParseResult?.constraints.patterns || finalConstraintsForRanking.patterns,
    occasions: queryParseResult?.constraints.occasions || finalConstraintsForRanking.occasions,
    materials: queryParseResult?.constraints.materials || finalConstraintsForRanking.materials,
    sizes: queryParseResult?.constraints.sizes || finalConstraintsForRanking.sizes,
    ageGroups: queryParseResult?.constraints.ageGroups || finalConstraintsForRanking.ageGroups,
    priceMinCents: queryParseResult?.constraints.priceMinCents ?? finalConstraintsForRanking.priceMinCents,
    priceMaxCents: queryParseResult?.constraints.priceMaxCents ?? finalConstraintsForRanking.priceMaxCents,
    seasons: finalConstraintsForRanking.seasons, // Add seasons from classification
    styles: finalConstraintsForRanking.styles, // Add styles from classification
    lengths: finalConstraintsForRanking.lengths, // Add lengths from classification
    fits: finalConstraintsForRanking.fits, // Add fits from classification
  };
  
  // Filter out "Mini Dress" category products and products with "Mini" length when modesty constraints require longer lengths (Maxi, Midi only)
  // This must happen BEFORE ranking to prevent mini dresses from getting high scores
  let filteredCandidateProducts = candidateProducts;
  if (constraintsForRanking.lengths && constraintsForRanking.lengths.length > 0) {
    const lengthsLower = constraintsForRanking.lengths.map(l => l.toLowerCase());
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
  
  // Extract query context for dynamic weight adjustment (needed for age group filtering)
  // Determine which attributes were explicitly mentioned in the query
  const explicitMentions: string[] = [];
  const queryLower = input.message.toLowerCase();
  
  // Check for explicit mentions - more comprehensive patterns
  if (constraintsForRanking.occasions) {
    // Check for "for [occasion]" pattern or direct occasion keywords
    const occasionPatterns = [
      /for\s+(wedding|beach|office|party|gym|home|date|formal|casual|vacation|holiday|christmas)/i,
      /\b(wedding|beach|office|party|gym|home|date|formal|casual|vacation|holiday|christmas)\b/,
    ];
    if (occasionPatterns.some(pattern => pattern.test(input.message))) {
      explicitMentions.push('occasions');
    }
  }
  if (constraintsForRanking.materials) {
    const materialKeywords = ['silk', 'cotton', 'linen', 'wool', 'cashmere', 'polyester', 'modal', 'spandex', 'elastane', 'fleece', 'satin', 'lace'];
    if (materialKeywords.some(keyword => queryLower.includes(keyword))) {
      explicitMentions.push('materials');
    }
  }
  if (constraintsForRanking.seasons) {
    const seasonKeywords = ['summer', 'winter', 'spring', 'fall', 'autumn'];
    if (seasonKeywords.some(keyword => queryLower.includes(keyword))) {
      explicitMentions.push('seasons');
    }
  }
  if (constraintsForRanking.fits) {
    const fitKeywords = ['fit', 'relaxed', 'fitted', 'loose', 'slim', 'comfortable', 'form-fitting'];
    if (fitKeywords.some(keyword => queryLower.includes(keyword))) {
      explicitMentions.push('fits');
    }
  }
  if (constraintsForRanking.lengths) {
    const lengthKeywords = ['mini', 'maxi', 'midi', 'long dress', 'short dress', 'knee-length'];
    if (lengthKeywords.some(keyword => queryLower.includes(keyword))) {
      explicitMentions.push('lengths');
    }
  }
  if (constraintsForRanking.colors) {
    const colorKeywords = ['white', 'black', 'red', 'blue', 'green', 'pink', 'yellow', 'purple', 'orange', 'brown', 'gray', 'grey', 'navy', 'beige', 'cream', 'ivory', 'blush', 'coral', 'mint', 'lavender'];
    if (colorKeywords.some(keyword => new RegExp(`\\b${keyword}\\b`).test(queryLower))) {
      explicitMentions.push('colors');
    }
  }
  if (constraintsForRanking.styles) {
    const styleKeywords = ['elegant', 'casual', 'formal', 'romantic', 'vintage', 'modern', 'classic', 'bohemian', 'minimalist', 'feminine', 'sophisticated', 'chic', 'edgy', 'sporty', 'relaxed', 'polished'];
    if (styleKeywords.some(keyword => new RegExp(`\\b${keyword}\\b`).test(queryLower))) {
      explicitMentions.push('styles');
    }
  }
  if (constraintsForRanking.ageGroups) {
    const ageGroupKeywords = ['kid', 'kids', 'children', 'child', 'toddler', 'baby', 'adult', 'adults', 'women', 'men', 'girl', 'girls', 'boy', 'boys', 'teen', 'teens', 'teenager', 'teenagers', 'teenage', 'juvenile', 'youth', 'adolescent', 'young', 'pre-teen', 'preteen', 'tween'];
    if (ageGroupKeywords.some(keyword => new RegExp(`\\b${keyword}\\b`).test(queryLower))) {
      explicitMentions.push('ageGroups');
    }
  }
  
  // Build query context (always available for age group filtering)
  const queryContext = {
    queryType: classification.type,
    explicitMentions,
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
    
    
    const rankedProducts = await rankWithConstraints(
      productsWithVectorScores,
      constraintsForRanking,
      0.6, // maxConstraintBoost
      queryContext // Pass query context for dynamic weight adjustment
    );
    
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
        colors: constraintsForRanking.colors,
        occasions: constraintsForRanking.occasions,
        ageGroups: constraintsForRanking.ageGroups,
        materials: constraintsForRanking.materials,
        seasons: constraintsForRanking.seasons,
        fits: constraintsForRanking.fits,
        lengths: constraintsForRanking.lengths,
        styles: constraintsForRanking.styles,
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
  // If age group is explicitly mentioned in the query, reject products that don't match
  // This ensures "baby" queries don't return "for Women" products
  const ageGroupsConstraint = constraintsForRanking.ageGroups;
  const ageGroupExplicitlyMentioned = queryContext.explicitMentions.includes('ageGroups');
  
  if (ageGroupsConstraint && ageGroupsConstraint.length > 0 && ageGroupExplicitlyMentioned) {
    const beforeFilterCount = productsWithScores.length;
    
    productsWithScores = productsWithScores.filter(({ product }) => {
      const ageGroupScore = matchAgeGroup(product, ageGroupsConstraint);
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
  const MIN_RELEVANCE_SCORE = 0.2; // Lowered from 0.3 to consider products with score >= 0.2 as relevant
  const HIGH_CONFIDENCE_THRESHOLD = 0.5; // Allow product type mismatch if confidence >= 0.5
  
  // Check if products are relevant (removed minimum product count requirement - show whatever is available)
  const topScore = productsWithScores[0]?.score || 0;
  
  // Check if top product matches query intent (e.g., "joggers" query shouldn't return "cardigans")
  let productTypeMatches = true;
  if (productsToShow.length > 0 && queryParseResult?.productTerms) {
    const productTermsLower = queryParseResult.productTerms.toLowerCase();
    const topProductTitle = (productsToShow[0].title || '').toLowerCase();
    const topProductCategory = (productsToShow[0].category || '').toLowerCase();
    
    // Check if product type is mentioned in query (e.g., "joggers", "dresses", "tops")
    const productTypeKeywords = ['jogger', 'dress', 'top', 'bottom', 'skirt', 'swimsuit', 'bikini', 'cardigan', 'sweater', 'pants', 'shorts'];
    const queryHasProductType = productTypeKeywords.some(keyword => productTermsLower.includes(keyword));
    
    if (queryHasProductType) {
      // Check if top product matches the product type mentioned in query
      const queryProductType = productTypeKeywords.find(keyword => productTermsLower.includes(keyword));
      if (queryProductType) {
        // Top product should contain the same product type keyword
        const strictProductTypeMatches = topProductTitle.includes(queryProductType) || topProductCategory.includes(queryProductType);
        
        // Allow product type mismatch if confidence is high enough (>= 0.5)
        productTypeMatches = strictProductTypeMatches || topScore >= HIGH_CONFIDENCE_THRESHOLD;
        
        if (!strictProductTypeMatches) {
          if (topScore >= HIGH_CONFIDENCE_THRESHOLD) {
            logger.info('product_type_mismatch_allowed_high_confidence', {
              query: input.message.substring(0, 100),
              queryProductType,
              topProductTitle: productsToShow[0].title,
              topProductCategory: productsToShow[0].category,
              topScore,
              note: 'Product type mismatch allowed due to high confidence (>= 0.5)',
            });
          } else {
            logger.warn('product_type_mismatch', {
              query: input.message.substring(0, 100),
              queryProductType,
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
  // Removed minimum product count requirement - show whatever is available (at least 1 product)
  // For new queries (isFollowUp=false), skip confidence threshold since initial queries can have low correlation
  // For follow-ups (isFollowUp=true), apply threshold since enhanced queries should be more correlated
  const shouldShowProducts = productsToShow.length > 0 && // At least 1 product
    topProductRelevant && 
    productTypeMatches &&
    (isFollowUp ? hasHighConfidence : true); // Only check confidence threshold for follow-ups
  
  if (!shouldShowProducts) {
    logger.warn('low_confidence_or_irrelevant_recommendation', {
      query: input.message.substring(0, 100),
      productCount: productsToShow.length,
      topScore,
      hasHighConfidence,
      topProductRelevant,
      productTypeMatches,
      isFollowUp,
      reason: productsToShow.length === 0 ? 'no_products' :
              (!isFollowUp && !hasHighConfidence) ? 'threshold_skipped_for_new_query' :
              (isFollowUp && !hasHighConfidence) ? 'low_top_score' :
              !topProductRelevant ? 'low_relevance_score' : 
              'product_type_mismatch',
    });

    // Generate an intelligent, context-aware regretful reply using LLM
    const { generateRegretfulReply } = await import('./reply');
    const regretfulReply = await generateRegretfulReply(
      input.message,
      productsToShow.length,
      topScore,
      input.merchantData?.brandName || 'LoveShackFancy',
      enhancedQueryText, // Enhanced query
      queryToMergeWith || undefined, // Previous query context
      constraintsForRanking, // Constraints to analyze
      input.history // Conversation history
    );

    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: regretfulReply.replyText,
      productCards: [], // No product cards for low confidence
      noExactMatch: true,
      route: 'NO_MATCH',
    };
  }

  // Step 7-9: Parallelize reply generation, product card building, and dialogue routing
  // Start reply generation as soon as we have top 4 products (don't wait for other operations)
  onProgress?.('generating_reply', STAGE_PROGRESS.generating_reply);
  
  // Build reply context for follow-ups AND new searches with previous context
  const replyContext: ReplyContext | undefined = (isFollowUp || queryToMergeWith) ? {
    isFollowUp: isFollowUp,
    currentQuery: originalUserMessage, // Most recent user query (original, before enhancement)
    previousQuery: queryToMergeWith || undefined, // Previous query (available for both follow-ups and new searches)
    enhancedQuery: enhancedQueryText || input.message, // Enhanced query used for search
  } : undefined;
  
  // Start all three operations in parallel for better performance
  const [replyResult, productCards, routerResult] = await Promise.all([
    // Reply generation (LLM call - can take 5+ seconds)
    (async (): Promise<ReplyResult> => {
      try {
        return await generateReply(
          input.message,
          classification.constraints,
          productsToShow.map(p => p as SearchResultItem),
          input.merchantData?.brandName || 'LoveShackFancy',
          replyContext, // Pass follow-up context
          topCategories.length > 0 ? topCategories : undefined // Pass top categories for category-aware attribute extraction
        );
      } catch (error) {
        logger.error('handleLoveshackfancyQuery: reply generation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          replyText: `I found ${productsToShow.length} piece${productsToShow.length !== 1 ? 's' : ''} that match your search. Here are some options:`,
        };
      }
    })(),
    // Build product cards with emotional keywords (LLM call for keywords)
    (async (): Promise<ProductCard[]> => {
      try {
        // Generate emotional keywords for all products in batch
        const { generateEmotionalKeywordsBatch } = await import('./reply');
        
        logger.info('emotional_keywords_generation_start', {
          productCount: productsToShow.length,
          enhancedQuery: (enhancedQueryText || input.message).substring(0, 100),
        });
        
        const emotionalKeywordsArray = await generateEmotionalKeywordsBatch(
          productsToShow.map(p => p as SearchResultItem),
          enhancedQueryText || input.message, // Use enhanced query for context
          input.merchantData?.brandName || 'LoveShackFancy'
        );
        
        logger.info('emotional_keywords_received', {
          keywordsArrayLength: emotionalKeywordsArray.length,
          expectedLength: productsToShow.length,
          sampleKeywords: emotionalKeywordsArray.slice(0, 2).map(kw => kw),
          allKeywords: emotionalKeywordsArray.map((kw, idx) => ({
            productIndex: idx,
            productTitle: productsToShow[idx]?.title?.substring(0, 50),
            keywords: kw,
          })),
        });
        
        // Build product cards with emotional keywords
        return productsToShow.map((product, index) => {
          const reason = buildProductReason(
            product as SearchResultItem,
            input.message,
            {
              style: classification.constraints.styles?.[0],
              occasion: classification.constraints.occasions?.[0],
              collection: classification.constraints.collections?.[0],
              pattern: classification.constraints.patterns?.[0],
              material: classification.constraints.materials?.[0],
              length: classification.constraints.lengths?.[0],
              embellishment: classification.constraints.embellishments?.[0],
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
        return productsToShow.map(product => {
          const reason = buildProductReason(
            product as SearchResultItem,
            input.message,
            {
              style: classification.constraints.styles?.[0],
              occasion: classification.constraints.occasions?.[0],
              collection: classification.constraints.collections?.[0],
              pattern: classification.constraints.patterns?.[0],
              material: classification.constraints.materials?.[0],
              length: classification.constraints.lengths?.[0],
              embellishment: classification.constraints.embellishments?.[0],
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
    productTerms: queryParseResult?.productTerms || 'none',
    hasProductTerms: !!queryParseResult?.productTerms && queryParseResult.productTerms !== 'item',
  });
  
  // Helper to convert null to undefined for array fields
  const nullToUndefined = <T>(value: T | null | undefined): T | undefined => 
    value === null ? undefined : value;
  
  // Map FashionConstraints to SearchConstraints (only include fields that exist in SearchConstraints)
  // Map scents to sensoryProfile: combine scents into a string description
  const sensoryProfileFromScents = finalConstraints.scents && finalConstraints.scents.length > 0
    ? finalConstraints.scents.join(', ') + ' scent'
    : undefined;
  
  // Merge sensoryProfile from scents with explicit sensoryProfile (prefer explicit if both exist)
  const mergedSensoryProfile = finalConstraints.sensoryProfile || sensoryProfileFromScents;
  
  const resolvedConstraints: SearchConstraints = {
    colors: nullToUndefined(finalConstraints.colors),
    sizes: nullToUndefined(finalConstraints.sizes),
    materials: nullToUndefined(finalConstraints.materials),
    occasions: nullToUndefined(finalConstraints.occasions),
    seasons: nullToUndefined(finalConstraints.seasons),
    lengths: nullToUndefined(finalConstraints.lengths),
    priceMinCents: finalConstraints.priceMinCents === null ? undefined : finalConstraints.priceMinCents,
    priceMaxCents: finalConstraints.priceMaxCents === null ? undefined : finalConstraints.priceMaxCents,
    ageGroups: nullToUndefined(queryParseResult?.constraints.ageGroups || finalConstraints.ageGroups),
    // Map fashion-specific fields to generic SearchConstraints fields where applicable
    // styles -> styleTags, patterns -> styleTags (both are style descriptors)
    styleTags: nullToUndefined([
      ...(finalConstraints.styles || []),
      ...(finalConstraints.patterns || []),
    ].filter(Boolean).length > 0 ? [
      ...(finalConstraints.styles || []),
      ...(finalConstraints.patterns || []),
    ] : undefined),
    // Map category-specific constraints
    // scents -> sensoryProfile (convert array to string description)
    sensoryProfile: mergedSensoryProfile || undefined,
    // rooms -> useCases (rooms are a type of useCase for home products)
    useCases: nullToUndefined([
      ...(finalConstraints.rooms || []),
      ...(finalConstraints.useCases || []),
    ].filter(Boolean).length > 0 ? [
      ...(finalConstraints.rooms || []),
      ...(finalConstraints.useCases || []),
    ] : undefined),
    // Direct mappings for generic constraints
    benefits: nullToUndefined(finalConstraints.benefits),
    claims: nullToUndefined(finalConstraints.claims),
    compatibility: nullToUndefined(finalConstraints.compatibility),
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
    },
  });

  onProgress?.('complete', STAGE_PROGRESS.complete);

  // Final pipeline summary log
  logger.info('orchestrator_pipeline_summary', {
    query: input.message.substring(0, 200),
    isFollowUp,
    enhancedQueryText: enhancedQueryText || input.message,
    productTerms: queryParseResult?.productTerms || 'none',
    classificationType: classification.type,
    topCategories: topCategories.slice(0, 5),
    candidateProductCount: candidateProducts.length,
    finalProductCount: productsToShow.length,
    constraintsFlow: {
      classificationConstraints: {
        colors: classification.constraints.colors,
        patterns: classification.constraints.patterns,
        occasions: classification.constraints.occasions,
        priceMinCents: classification.constraints.priceMinCents,
        priceMaxCents: classification.constraints.priceMaxCents,
      },
      parsedConstraints: {
        colors: queryParseResult?.constraints.colors,
        patterns: queryParseResult?.constraints.patterns,
        occasions: queryParseResult?.constraints.occasions,
        priceMinCents: queryParseResult?.constraints.priceMinCents,
        priceMaxCents: queryParseResult?.constraints.priceMaxCents,
      },
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
        ageGroups: constraintsForRanking.ageGroups,
      },
    },
    topProducts: productsToShow.slice(0, 4).map((p, idx) => ({
      rank: idx + 1,
      productId: p.id,
      productTitle: p.title?.substring(0, 80),
    })),
  });

  // CRITICAL: Always ensure replyTextAfter exists when we have products
  // This is a safety net to ensure the post-card text always appears
  let finalReplyTextAfter = replyResult.replyTextAfter;
  if (productsToShow.length > 0) {
    // If we have products but no replyTextAfter, use a fallback
    if (!finalReplyTextAfter || finalReplyTextAfter.trim().length === 0) {
      finalReplyTextAfter = `I hope you find something perfect here.`;
    }
  } else {
    // No products, no replyTextAfter
    finalReplyTextAfter = undefined;
  }

  const result: LoveshackfancyQueryResult = {
    replyText: replyResult.replyText,
    // Always include replyTextAfter when we have product cards to show
    replyTextAfter: finalReplyTextAfter,
    productCards,
    noExactMatch: productsToShow.length === 0,
    actions: actions.length > 0 ? actions : undefined,
    route: routerResult.route,
    actionType: routerResult.action?.type || undefined,
    resolvedConstraints,
    resolvedClassificationConstraints,
  };

  // Store the enhanced query in conversation memory for cumulative context building
  // This allows the next follow-up to merge with this enhanced query (not just the raw user message)
  // For new searches, store the current message as the enhanced query
  // For follow-ups, store the merged enhanced query
  const queryToStore = isFollowUp && enhancedQueryText ? enhancedQueryText : input.message;
  if (input.merchantId) {
    updateState(input.merchantId, input.sessionId, {
      memory: {
        ...conversationState.memory,
        lastEnhancedQuery: queryToStore,
      },
    }).catch(err => {
      logger.error('failed_to_store_enhanced_query', {
        error: err instanceof Error ? err.message : String(err),
        sessionId: input.sessionId,
      });
    });
  }

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

