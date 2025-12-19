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
import { generateReply, type ReplyResult } from './reply';
import { buildProductReason } from './reasons';
import { routeTurn, type DialogueRouteResult } from './router';
import type { ConversationStateData } from '../chat/ConversationStateService';
import { categorizeQuery, type QueryCategorization } from './query-categorizer';
import { generateFollowUpQuestions, regenerateNextQuestion } from './followup-generator';
import { enhanceQuery, createEnhancedVectorQuery } from './query-enhancer';
import { shouldContinueAnyway } from './continue-detector';
import { updateState } from '../chat/ConversationStateService';
import { parseQuery } from './query-parser';
import { rankWithConstraints } from './ranking/constraint-ranker';
import { classifyQueryToCategories } from './category-classifier';
import { mergeFollowUpConstraints, isFollowUpRefinement } from './constraint-merger';
import { callLLM } from '../llm/provider';
import { buildProductQaPrompt } from '../llm/prompts';

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
  reason: string
): ProductCard {
  const attrs = product.attributes || {};
  
  // Extract key attributes for display
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
    salePriceCents: product.salePriceCents,
    currency: product.currency,
    keyAttributes: keyAttributes.slice(0, 5), // Top 5 attributes
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

    // Handle unrelated queries
    if ('reason' in safetyCheck && safetyCheck.reason === 'unrelated') {
      onProgress?.('handling_unrelated', STAGE_PROGRESS.complete);
      await new Promise(resolve => setTimeout(resolve, 100));
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "I'm here to help you find the perfect LoveShackFancy pieces! What style, occasion, or look are you shopping for today?",
        productCards: [],
        noExactMatch: true,
        route: 'UNRELATED',
      };
    }

    // Generic safety response
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: "I'm here to help you find beautiful LoveShackFancy fashion pieces. What are you looking for today?",
      productCards: [],
      noExactMatch: true,
      route: 'SAFETY_BLOCK',
    };
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
            content: 'You are a helpful product expert answering questions about a specific fashion product.',
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

  // Extract last user query from history (exclude current message)
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

  // Very permissive check: if we have last query, let the LLM decide
  // This allows the LLM to handle logical follow-ups even if they don't match specific patterns
  // We check if:
  // 1. We have a last user query (indicating conversation history) - REQUIRED
  // 2. Previous constraints are helpful but not required - LLM can infer from previous query text
  // 3. The message is reasonably short (< 25 words) - long messages are likely new searches
  // 4. Either it matches follow-up patterns OR it's short enough that it could logically be a follow-up
  const hasLastQuery = !!lastUserQuery;
  const hasPreviousConstraints = !!input.lastClassificationConstraints;
  const messageWords = input.message.trim().split(/\s+/).length;
  const isShortMessage = messageWords < 25;
  const matchesFollowUpPattern = isFollowUpRefinement(input.message, true);
  
  // If we have last query and the message is short, let the LLM decide (even if it doesn't match patterns)
  // This allows logical follow-ups like "Show me close matches, price can be higher" to be detected
  // Previous constraints are helpful but not required - LLM can infer constraints from previous query text
  const shouldCheckWithLLM = hasLastQuery && (isShortMessage || matchesFollowUpPattern);

  if (shouldCheckWithLLM) {
    logger.info('checking_if_followup_with_llm', {
      currentMessage: input.message.substring(0, 100),
      lastQuery: lastUserQuery?.substring(0, 100),
      hasPreviousConstraints: hasPreviousConstraints,
      messageLength: messageWords,
      matchesPattern: matchesFollowUpPattern,
      willCheckWithLLM: true,
    });

    try {
      // Intelligently merge constraints using LLM - the LLM will decide if it's truly a follow-up
      // and how to merge/replace/remove constraints
      // If previous constraints are missing, pass null - LLM can infer from previous query text
      onProgress?.('understanding', STAGE_PROGRESS.understanding);
      const mergeResult = await mergeFollowUpConstraints(
        lastUserQuery!,
        input.lastClassificationConstraints || null,
        input.message
      );

      // If LLM determined it's a merge/replace/remove action, treat as follow-up
      // The LLM's mergeAction indicates it understood this as a follow-up
      if (mergeResult.mergeAction === 'merge' || mergeResult.mergeAction === 'replace' || mergeResult.mergeAction === 'remove') {
        isFollowUp = true;
        mergedConstraints = mergeResult.mergedConstraints;
        enhancedQueryText = mergeResult.enhancedQueryText;

        logger.info('constraints_merged_for_followup', {
          mergeAction: mergeResult.mergeAction,
          reason: mergeResult.reason,
          enhancedQuery: enhancedQueryText.substring(0, 100),
          hasPrice: !!mergedConstraints.priceMaxCents || !!mergedConstraints.priceMinCents,
          previousPrice: input.lastClassificationConstraints?.priceMaxCents,
          mergedPrice: mergedConstraints.priceMaxCents,
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
        
        logger.info('llm_determined_new_search_due_to_incompatibility', {
          currentMessage: input.message.substring(0, 100),
          previousQuery: lastUserQuery?.substring(0, 100),
          reason: mergeResult.reason,
          note: 'Product type and occasion/context are logically incompatible - treating as new search',
        });
      } else {
        logger.debug('llm_determined_not_followup', {
          currentMessage: input.message.substring(0, 100),
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
      hasLastQuery,
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

  // Handle irrelevant queries
  if (categorization.category === 'irrelevant') {
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: "I'm here to help you find the perfect LoveShackFancy pieces! What style, occasion, or look are you shopping for today?",
      productCards: [],
      noExactMatch: true,
      route: 'UNRELATED',
    };
  }

  // Handle indirect/vague queries
  // CRITICAL: If this is a merged follow-up, skip the indirect_search check and proceed with search
  // The constraint merger has already determined this is a follow-up refinement, so we should proceed
  // even if the categorizer thinks it's vague (e.g., "wedding outfits" after "bikinis" - the merger
  // should have preserved the product type, but if it didn't, we still proceed since it's a follow-up)
  if (categorization.category === 'indirect_search' && !isFollowUp) {
    // New vague query - generate follow-up questions
    logger.info('generating_followup_questions', {
      query: input.message,
      hasPreliminaryProducts: !!categorization.preliminaryProducts?.length,
    });
      onProgress?.('generating', STAGE_PROGRESS.generating);
      const followups = await generateFollowUpQuestions(
        input.message,
        categorization.preliminaryProducts,
        input.merchantData?.datasetContext
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

  // Step 4: Query classification (for direct_search or enhanced queries)
  // Step 3.5: Category Classification (for product discovery only) - run in parallel when both are needed
  // Optimize: Run classifyQuery and classifyQueryToCategories in parallel for direct_search queries
  // Also run category classification for indirect_search queries that are follow-ups or have clear category signals
  onProgress?.('understanding', STAGE_PROGRESS.understanding);
  let classification: QueryClassification;
  let topCategories: string[] = [];
  
  // Determine if we should run category classification
  // Run it for: direct_search OR (indirect_search that is a follow-up OR has clear category signals)
  const shouldRunCategoryClassification = categorization.category === 'direct_search' 
    || (categorization.category === 'indirect_search' && (
      isFollowUp || 
      // Check for clear category signals in the query
      /\b(newborn|baby|infant|toddler|kids?|children|girls?|boys?|women|men|adult|home|decor|bedding|tabletop|bath|personal care|accessories?)\b/i.test(input.message)
    ));
  
  // If this is a direct_search or an indirect_search with context, run both LLM calls in parallel for better performance
  if (shouldRunCategoryClassification) {
    logger.info('parallelizing_classification_and_category_classification', {
      query: input.message.substring(0, 100),
      categorizationCategory: categorization.category,
      isFollowUp,
      hasCategorySignals: /\b(newborn|baby|infant|toddler|kids?|children|girls?|boys?|women|men|adult|home|decor|bedding|tabletop|bath|personal care|accessories?)\b/i.test(input.message),
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
      (async (): Promise<string[]> => {
        try {
          console.log('[ORCHESTRATOR] Calling classifyQueryToCategories', {
            query: input.message.substring(0, 100),
            merchantId: input.merchantId,
          });
          logger.info('category_classification_calling_function', {
            query: input.message.substring(0, 100),
            merchantId: input.merchantId,
          });
          
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
        } catch (error) {
          console.error('[ORCHESTRATOR] Category classification error', error);
          logger.warn('category_classification_failed_continuing', {
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            query: input.message.substring(0, 100),
          });
          // Continue without category filtering if classification fails
          return [];
        }
      })(),
    ]);
    
    classification = classificationResult;
    topCategories = categoryResult;
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
      // Both agree it's unrelated - return early
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: "I'm here to help you find the perfect LoveShackFancy pieces! What style, occasion, or look are you shopping for today?",
        productCards: [],
        noExactMatch: true,
        route: 'UNRELATED',
      };
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
    if (queryParseResult.constraints.colors && queryParseResult.constraints.colors.length > 0) {
      classification.constraints.colors = queryParseResult.constraints.colors;
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
    // Return empty result
    return {
      replyText: "I couldn't find any products matching your search. Try adjusting your filters or search terms.",
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
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: "I couldn't find any products matching your search. Try adjusting your filters or search terms.",
      productCards: [],
      noExactMatch: true,
    };
  }

  // Step 6: Ranking with constraint-based scoring (NEW APPROACH)
  // Use parsed constraints for weighted ranking if available, otherwise fall back to vector similarity only
  onProgress?.('ranking', STAGE_PROGRESS.ranking);
  
  let productsWithScores: Array<{ product: SearchResultItem; score: number }>;
  
  if (queryParseResult && Object.values(queryParseResult.constraints).some(v => v !== null && (Array.isArray(v) ? v.length > 0 : true))) {
    // NEW: Use constraint-based ranking (no hard filtering, just weighted scoring)
    const productsWithVectorScores = candidateProducts.map(product => ({
      product,
      vectorScore: retrievalResult.semanticScores.get(product.id) || 0,
    }));
    
    const rankedProducts = await rankWithConstraints(
      productsWithVectorScores,
      queryParseResult.constraints
    );
    
    // Convert to format expected by rest of pipeline
    productsWithScores = rankedProducts.map(rp => ({
      product: rp.product,
      score: rp.finalScore,
    }));
    
    logger.debug('constraint_based_ranking_applied', {
      productCount: productsWithScores.length,
      avgConstraintScore: rankedProducts.reduce((sum, p) => sum + p.constraintScore, 0) / rankedProducts.length,
      avgFinalScore: productsWithScores.reduce((sum, p) => sum + p.score, 0) / productsWithScores.length,
    });
  } else {
    // FALLBACK: Use vector similarity only (original approach)
    productsWithScores = candidateProducts.map(product => {
    const vectorScore = retrievalResult.semanticScores.get(product.id) || 0;
    return {
      product,
      score: vectorScore, // Use vector similarity directly as the score
    };
  });
  
    // Sort by vector similarity (descending)
  productsWithScores.sort((a, b) => b.score - a.score);
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

  // Take top products - no need to deduplicate since it's already done at SQL level
  // Products returned from vector search are already deduplicated using parent_id, shopifyProductId, related_id
  const productsToShow = productsWithScores
    .slice(0, 4) // Take top 4 products (already deduplicated)
    .map(p => p.product);

  // Step 7-9: Parallelize reply generation, product card building, and dialogue routing
  // Start reply generation as soon as we have top 4 products (don't wait for other operations)
  onProgress?.('generating_reply', STAGE_PROGRESS.generating_reply);
  
  // Start all three operations in parallel for better performance
  const [replyResult, productCards, routerResult] = await Promise.all([
    // Reply generation (LLM call - can take 5+ seconds)
    (async (): Promise<ReplyResult> => {
      try {
        return await generateReply(
          input.message,
          classification.constraints,
          productsToShow.map(p => p as SearchResultItem),
          input.merchantData?.brandName || 'LoveShackFancy'
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
    // Build product cards (synchronous, fast)
    Promise.resolve(productsToShow.map(product => {
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
    })),
    // Dialogue routing (LLM call - independent of products)
    routeTurn(
      input.message,
      input.lastConstraints,
      input.lastShownProductIds
    ),
  ]);

  // Step 10: Generate actions (if needed)
  const actions: Array<{ id: string; type: string; label: string; payload?: any }> = [];
  if (routerResult.action) {
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
  
  // Helper to convert null to undefined for array fields
  const nullToUndefined = <T>(value: T | null | undefined): T | undefined => 
    value === null ? undefined : value;
  
  // Map FashionConstraints to SearchConstraints (only include fields that exist in SearchConstraints)
  const resolvedConstraints: SearchConstraints = {
    colors: nullToUndefined(finalConstraints.colors),
    sizes: nullToUndefined(finalConstraints.sizes),
    materials: nullToUndefined(finalConstraints.materials),
    occasions: nullToUndefined(finalConstraints.occasions),
    seasons: nullToUndefined(finalConstraints.seasons),
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
  };
  
  const resolvedClassificationConstraints: FashionConstraints = finalConstraints;

  onProgress?.('complete', STAGE_PROGRESS.complete);

  const result: LoveshackfancyQueryResult = {
    replyText: replyResult.replyText,
    // Only include replyTextAfter when we have product cards to show
    replyTextAfter: productsToShow.length > 0 ? replyResult.replyTextAfter : undefined,
    productCards,
    noExactMatch: productsToShow.length === 0,
    actions: actions.length > 0 ? actions : undefined,
    route: routerResult.route,
    actionType: routerResult.action?.type || undefined,
    resolvedConstraints,
    resolvedClassificationConstraints,
  };

  logger.info('handleLoveshackfancyQuery complete', {
    sessionId: input.sessionId,
    message: input.message.substring(0, 100),
    productCount: productCards.length,
    route: routerResult.route,
  });

  return result;
}

