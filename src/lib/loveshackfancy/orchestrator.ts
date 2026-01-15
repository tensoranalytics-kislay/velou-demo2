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
import { updateState, setLastRankedProducts } from '../chat/ConversationStateService';
import { rankWithConstraints } from './ranking/constraint-ranker';
import { classifyQueryToCategories, classifyQueryToCategoriesWithConfidence } from './category-classifier';
import { mergeFollowUpConstraints, isFollowUpRefinement } from './constraint-merger';
import { callLLM } from '../llm/provider';
import { buildProductQaPrompt } from '../llm/prompts';
import { matchAgeGroup } from './ranking/constraint-matcher';
import { handleIrrelevantQuery, generateIntelligentDenial } from './irrelevant-query-handler';
import { getAllCategories, findClosestCategory } from '../catalog/category-tree';
import { extractCategoryKeywords, validateAllProducts as validateAllProductsByCategory, filterProductsByCategoryValidation } from './validation/category-validator';
import { extractConstraintValues, extractConstraintIntent, type ConstraintWithIntent } from './constraint-utils';
import { refineConstraintsWithDictionaries, mergeRefinedConstraints } from './constraint-refiner';

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
  const startTime = Date.now();
  
  if (productIds.length === 0) {
    return [];
  }

  logger.info('loadFashionProducts: starting', {
    productCount: productIds.length,
    merchantId,
  });

  // Optimized query: All selected fields are used in:
  // - Reply generation: title, attributes (style, length, occasion, pattern, material), enriched columns
  // - Constraint ranking: attributes (all constraint matching), priceCents, enriched columns
  // - Product cards: id, title, imageUrl, productUrl, priceCents, salePriceCents, attributes
  // - Ranking features: all fields including enriched columns
  // Note: Using findMany with IN clause is efficient for small batches (typically 40 products)
  const dbStartTime = Date.now();
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

        // Check category confidence again with the enhanced query
        onProgress?.('classifying', STAGE_PROGRESS.classifying);
        const categoryResult = await classifyQueryToCategoriesWithConfidence(
          enhancedQuery.enhancedQueryText,
          input.merchantId
        );

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

        // Extract product type from enhanced query to validate category classification
        const enhancedQueryLower = enhancedQuery.enhancedQueryText.toLowerCase();
        const productTypeKeywords = ['hoodie', 'hoodies', 'dress', 'dresses', 'top', 'tops', 'skirt', 'skirts', 'swimsuit', 'swimsuits', 'bikini', 'bikinis', 'jogger', 'joggers', 'pant', 'pants', 'short', 'shorts', 'sweater', 'sweaters', 'cardigan', 'cardigans', 'jacket', 'jackets', 'coat', 'coats', 'blazer', 'blazers', 'loungewear', 'activewear'];
        const detectedProductType = productTypeKeywords.find(kw => enhancedQueryLower.includes(kw));
        
        // Set topCategories if category is now clear, otherwise proceed anyway
        if (categoryResult.confidence >= 0.5 && categoryResult.categories.length > 0) {
          topCategories = categoryResult.categories;
          categoryConfidenceForThreshold = categoryResult.confidence;
          
          // Validate that categories match the detected product type
          if (detectedProductType) {
            const categoryMatchesProductType = topCategories.some(cat => {
              const catLower = cat.toLowerCase();
              // Check if category contains the product type or is a parent category
              return catLower.includes(detectedProductType) || 
                     (detectedProductType.includes('hoodie') && (catLower.includes('top') || catLower.includes('sweater'))) ||
                     (detectedProductType.includes('dress') && catLower.includes('dress')) ||
                     (detectedProductType.includes('top') && catLower.includes('top')) ||
                     (detectedProductType.includes('skirt') && catLower.includes('skirt')) ||
                     (detectedProductType.includes('swimsuit') && (catLower.includes('swim') || catLower.includes('bikini')));
            });
            
            if (!categoryMatchesProductType) {
              logger.warn('category_mismatch_with_product_type', {
            originalQuery: pendingFollowups.originalQuery,
            enhancedQuery: enhancedQuery.enhancedQueryText,
                detectedProductType,
                categories: topCategories,
                note: 'Category classification does not match detected product type - may need re-classification'
          });
        } else {
              logger.info('category_matches_product_type', {
                enhancedQuery: enhancedQuery.enhancedQueryText,
                detectedProductType,
                categories: topCategories,
                note: 'Category classification matches detected product type'
              });
            }
          }
          
          logger.info('category_clear_after_clarification_proceeding', {
            originalQuery: pendingFollowups.originalQuery,
            enhancedQuery: enhancedQuery.enhancedQueryText,
            categories: topCategories,
            confidence: categoryResult.confidence,
            detectedProductType: detectedProductType || null,
            note: 'Category is now clear after clarification, proceeding with product discovery',
          });
        } else {
          // Category still unclear, but proceed anyway (only one clarification question allowed)
          logger.info('category_still_unclear_proceeding_anyway', {
            originalQuery: pendingFollowups.originalQuery,
            enhancedQuery: enhancedQuery.enhancedQueryText,
            categoryConfidence: categoryResult.confidence,
            categories: categoryResult.categories,
            note: 'Category still unclear after one clarification, proceeding with product discovery anyway',
          });
        }

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

  // For follow-ups, classify current categories early so we can pass them to the merger
  let currentCategories: string[] | undefined = undefined;
  if (shouldCheckWithLLM) {
    try {
      // Run quick category classification for current message
      currentCategories = await classifyQueryToCategories(input.message, input.merchantId);
      logger.debug('category_classification_for_merger', {
        query: input.message.substring(0, 100),
        categories: currentCategories,
        note: 'Classified categories early for intent-aware constraint preservation',
      });
    } catch (error) {
      logger.warn('category_classification_for_merger_failed', {
        error: error instanceof Error ? error.message : String(error),
        query: input.message.substring(0, 100),
        note: 'Continuing without current categories - merger will work without category similarity check',
      });
      // Continue without current categories - merger can still work
    }
  }

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

  // CRITICAL: Check category confidence for ALL query types before proceeding to product discovery
  // Category confidence must be validated regardless of categorization.category
  // Skip this check for follow-ups (they already went through clarification)
  if (!isFollowUp) {
    // NEW: Try category classification first before asking questions
    // Check category confidence for ALL query types before proceeding to product discovery
    logger.info('category_confidence_check_for_all_query_types', {
      query: input.message,
      categorizationCategory: categorization.category,
      hasPreliminaryProducts: !!categorization.preliminaryProducts?.length,
    });
    
    onProgress?.('classifying', STAGE_PROGRESS.classifying);
    // Use the function that returns confidence info to capture potential categories even if low confidence
    const categoryResult = await classifyQueryToCategoriesWithConfidence(input.message, input.merchantId);
    
    if (categoryResult.confidence >= 0.5 && categoryResult.categories.length > 0) {
      // Category identified confidently - proceed with discovery
      topCategories = categoryResult.categories;
      categoryConfidenceForThreshold = categoryResult.confidence;
      logger.info('category_identified_confidently_proceeding_with_discovery', {
        query: input.message,
        categorizationCategory: categorization.category,
        categories: topCategories,
        categoryCount: topCategories.length,
        confidence: categoryResult.confidence,
        note: 'Category classification succeeded, proceeding with product discovery',
      });
      
      // Set topCategories so it's used in the search pipeline below
      // Continue to the classification and search pipeline (don't return early)
    } else {
      // Category unclear or low confidence - generate ONE category-focused clarification question
      const potentialCategories = categoryResult.categories.length > 0 ? categoryResult.categories : [];
      logger.info('category_unclear_requiring_clarification', {
        query: input.message,
        categorizationCategory: categorization.category,
        potentialCategories,
        confidence: categoryResult.confidence,
        note: 'Category confidence too low or empty - requiring clarification before search',
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
      logger.info('category_clarification_reply_constructed', {
        query: input.message,
        categorizationCategory: categorization.category,
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
    const constraintsForClassifier = isFollowUp && mergedConstraints
      ? mergedConstraints
      : null;
    
    const classificationStartTime = Date.now();
    const [classificationResult, categoryResult] = await Promise.all([
      // Query classification (with gender metadata)
      (async (): Promise<ClassificationWithMetadata> => {
        try {
          const result = await classifyQueryWithMetadata(input.message, constraintsForClassifier, enhancedQueryText);
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
              return {
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
              return {
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
            return {
              classification: result,
              usedStrictMajorityMode: false,
              genderContext: null,
            };
          }
        }
      })(),
      // Category classification
      // For direct_search queries, use classifyQueryToCategoriesWithConfidence to get confidence info
      (async (): Promise<{ categories: string[]; confidence: number } | string[]> => {
        try {
          // ALWAYS use confidence version for ALL query types
          // Category confidence must be checked before product discovery
          // CRITICAL: For follow-ups, use enhancedQueryText (the merged query) instead of input.message
          // This ensures categories are classified based on the properly merged query (e.g., "black hoodies" not "in black")
          const queryForCategoryClassification = isFollowUp && enhancedQueryText ? enhancedQueryText : input.message;
          
          console.log('[ORCHESTRATOR] Calling category classification', {
            query: queryForCategoryClassification.substring(0, 100),
            originalMessage: input.message.substring(0, 100),
            isFollowUp,
            usingEnhancedQuery: isFollowUp && enhancedQueryText,
            merchantId: input.merchantId,
            categorizationCategory: categorization.category,
          });
          logger.info('category_classification_calling_function', {
            query: queryForCategoryClassification.substring(0, 100),
            originalMessage: input.message.substring(0, 100),
            isFollowUp,
            usingEnhancedQuery: isFollowUp && enhancedQueryText,
            merchantId: input.merchantId,
            categorizationCategory: categorization.category,
          });
          
          const result = await classifyQueryToCategoriesWithConfidence(queryForCategoryClassification, input.merchantId);
            
            console.log('[ORCHESTRATOR] Category classification result (with confidence)', {
            query: queryForCategoryClassification.substring(0, 100),
            originalMessage: input.message.substring(0, 100),
            isFollowUp,
              categories: result.categories,
              count: result.categories.length,
              confidence: result.confidence,
            categorizationCategory: categorization.category,
            });
            logger.info('category_classification_complete_with_confidence', {
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
            
          // Return both categories and confidence for all query types
            return { categories: result.categories, confidence: result.confidence };
        } catch (error) {
          console.error('[ORCHESTRATOR] Category classification error', error);
          logger.warn('category_classification_failed_continuing', {
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            query: input.message.substring(0, 100),
          });
          // Continue without category filtering if classification fails
          // Return empty categories with 0 confidence for all query types
            return { categories: [], confidence: 0 };
        }
      })(),
    ]);
    
    // Extract classification and metadata
    classification = classificationResult.classification;
    const classificationMetadata = {
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
    // Category confidence check already happened earlier for all query types
    // If we reach here, category was either confident (topCategories set) or we're in a follow-up
    if (typeof categoryResult === 'object' && 'confidence' in categoryResult) {
      const categoryResultWithConfidence = categoryResult as { categories: string[]; confidence: number };
      categoryConfidenceForThreshold = categoryResultWithConfidence.confidence;
      
      // CRITICAL: For follow-ups, ALWAYS update topCategories with the enhanced query's categories
      // The enhanced query may have a different product type (e.g., "hoodies" vs "dresses")
      // For new queries, only set if topCategories is empty (wasn't set earlier)
      if (isFollowUp) {
        // Always update categories for follow-ups based on the enhanced query
        if (categoryResultWithConfidence.categories.length > 0) {
          topCategories = categoryResultWithConfidence.categories;
          logger.info('category_categories_updated_for_followup_from_enhanced_query', {
            query: input.message.substring(0, 100),
            enhancedQuery: enhancedQueryText.substring(0, 100),
            categories: topCategories,
          confidence: categoryResultWithConfidence.confidence,
            note: 'Categories re-classified based on enhanced query for follow-up',
        });
        }
      } else if (topCategories.length === 0 && categoryResultWithConfidence.categories.length > 0) {
        // For new queries, only set if topCategories wasn't set earlier
        topCategories = categoryResultWithConfidence.categories;
        logger.info('category_categories_set_from_parallel_classification', {
          query: input.message.substring(0, 100),
          categories: topCategories,
          confidence: categoryResultWithConfidence.confidence,
        });
      }
    } else {
      // Fallback: result is a simple array (shouldn't happen with new logic, but keep for safety)
      if (topCategories.length === 0) {
      topCategories = Array.isArray(categoryResult) ? categoryResult : [];
      }
    }

    // Gender-aware category filtering for SQL-level constraints
    // If we have a resolved gender, drop categories that are incompatible with that gender.
    // Example: for "jeans for men", female-only categories like "Bottoms" are removed
    // from the category filter so they don't block male jeans under male categories.
    if (topCategories.length > 0) {
      const resolvedGenderForCategories =
        (classification.constraints.gender && classification.constraints.gender !== 'unisex'
          ? classification.constraints.gender
          : classificationMetadata.genderContext) || null;

      if (resolvedGenderForCategories === 'male' || resolvedGenderForCategories === 'female') {
        const { getCategoryGender } = await import('../catalog/category-gender-map');

        const genderFilteredCategories = topCategories.filter((cat) => {
          const categoryGender = getCategoryGender(cat);
          // If category has no explicit gender mapping, treat it as usable for any gender.
          if (!categoryGender) return true;
          return categoryGender === resolvedGenderForCategories || categoryGender === 'unisex';
        });

        logger.info('category_gender_filter_applied', {
          query: input.message.substring(0, 100),
          originalCategories: topCategories,
          genderFilteredCategories,
          resolvedGenderForCategories,
        });

        if (genderFilteredCategories.length > 0) {
          topCategories = genderFilteredCategories;
        } else {
          // If all categories are incompatible with the resolved gender, drop category filter entirely.
          // Gender will still be enforced as a hard SQL filter, preventing cross-gender results.
          logger.warn('category_gender_filter_removed_all_categories', {
            query: input.message.substring(0, 100),
            originalCategories: topCategories,
            resolvedGenderForCategories,
            note: 'All category candidates were incompatible with gender; proceeding with gender-only filtering.',
          });
          topCategories = [];
        }
      }
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

  // Step 3.9: Gender Clarification Check (NEW - Multi-gender support)
  // Always run for every query (including follow-ups) so explicit gender
  // mentions like "for men" or "for women" can update the active gender.
  const { shouldClarifyGender, resolveGender } = await import('./gender-detector');
  const { getCategoryGender } = await import('../catalog/category-gender-map');
  
  const resolvedGender = resolveGender(
    input.message,
    topCategories,
    classification.constraints.gender
  );
  
  // CONFIDENCE-AWARE CLARIFICATION LOGIC (NEW)
  // When gender is ambiguous and we used strict majority mode,
  // only trust the classification if confidence >= 0.8
  let needsGenderClarification = false;
  
  if (!resolvedGender && classificationMetadata.usedStrictMajorityMode) {
    // Gender was ambiguous during classification
    if (classification.confidence < 0.8) {
      // Low confidence with ambiguous gender - ask for clarification
      needsGenderClarification = true;
      logger.info('gender_clarification_low_confidence_ambiguous', {
        query: input.message.substring(0, 100),
        classificationConfidence: classification.confidence,
        threshold: 0.8,
        usedStrictMajorityMode: true,
        note: 'Gender ambiguous and classification confidence < 0.8, asking for clarification',
      });
    } else {
      // High confidence - try to infer gender from top category
      if (topCategories.length > 0) {
        const categoryGender = getCategoryGender(topCategories[0]);
        if (categoryGender && categoryGender !== 'unisex') {
          classification.constraints.gender = categoryGender;
          logger.info('gender_inferred_from_high_confidence_category', {
            query: input.message.substring(0, 100),
            topCategory: topCategories[0],
            inferredGender: categoryGender,
            classificationConfidence: classification.confidence,
            note: 'High confidence (>= 0.8) with strict majority mode - inferred gender from category',
          });
        } else {
          // Category is unisex or unknown - fall back to normal clarification logic
          needsGenderClarification = shouldClarifyGender(
            input.message,
            topCategories,
            classification.constraints.gender
          );
        }
      } else {
        // No categories - fall back to normal clarification logic
        needsGenderClarification = shouldClarifyGender(
          input.message,
          topCategories,
          classification.constraints.gender
        );
      }
    }
  } else {
    // Gender was already resolved, or we didn't use strict majority mode
    // Use standard clarification logic
    needsGenderClarification = shouldClarifyGender(
      input.message,
      topCategories,
      classification.constraints.gender
    );
  }
  
  logger.info('gender_clarification_check', {
    query: input.message.substring(0, 100),
    classifiedGender: classification.constraints.gender,
    resolvedGender,
    needsClarification: needsGenderClarification,
    topCategories,
    isFollowUp,
    usedStrictMajorityMode: classificationMetadata.usedStrictMajorityMode,
    classificationConfidence: classification.confidence,
  });
  
  if (needsGenderClarification) {
    // Return gender clarification response with action buttons
    logger.info('gender_clarification_needed', {
      query: input.message,
      topCategories,
      note: 'Categories span multiple genders or low confidence with ambiguous gender, asking for clarification',
      isFollowUp,
      usedStrictMajorityMode: classificationMetadata.usedStrictMajorityMode,
      classificationConfidence: classification.confidence,
    });
    
    onProgress?.('complete', STAGE_PROGRESS.complete);
    return {
      replyText: `I found items matching your search. Are you looking for men's or women's options?`,
      productCards: [],
      noExactMatch: true,
      actions: [
        {
          id: 'gender_male',
          type: 'refine_gender',
          label: "Men's",
          payload: { gender: 'male' }
        },
        {
          id: 'gender_female',
          type: 'refine_gender',
          label: "Women's",
          payload: { gender: 'female' }
        }
      ],
      route: 'GENDER_CLARIFICATION',
    };
  }
  
  // If gender is resolved (not null), add it to classification constraints
  // This includes both pre-resolved gender and gender inferred from high-confidence category
  const finalResolvedGender = classification.constraints.gender || resolveGender(
    input.message,
    topCategories,
    classification.constraints.gender
  );
  
  if (finalResolvedGender) {
    const source =
      classification.constraints.gender && classification.constraints.gender === finalResolvedGender
        ? 'classifier_or_category_inference'
        : 'detection_or_categories';
    classification.constraints.gender = finalResolvedGender;
    logger.info('gender_resolved_adding_to_constraints', {
      gender: finalResolvedGender,
      source,
      isFollowUp,
      usedStrictMajorityMode: classificationMetadata.usedStrictMajorityMode,
      classificationConfidence: classification.confidence,
    });
  }

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
      categoryConfidenceForThreshold // Pass category confidence for post-filtering
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
  const retrievalDuration = Date.now() - retrievalStartTime;
  logger.info('handleLoveshackfancyQuery: retrieval_complete', {
    query: input.message.substring(0, 100),
    candidateCount: retrievalResult.candidateIds.length,
    retrievalDurationMs: retrievalDuration,
    retrievalDurationSeconds: (retrievalDuration / 1000).toFixed(2),
  });
  
  // Step 5: Load products - prioritize by vector similarity
  // Products are already deduplicated at SQL level (using parent_id, shopifyProductId, related_id)
  // So we only need to load enough for constraint-based ranking (typically 30-40 is sufficient)
  const MAX_PRODUCTS_TO_LOAD = 40; // Reduced from 100 - deduplication already done in SQL
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
    ageGroups: finalConstraintsForRanking.ageGroups !== undefined ? finalConstraintsForRanking.ageGroups : classification.constraints.ageGroups,
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
  if (constraintsForRanking.patterns) {
    const patternKeywords = ['floral', 'polka dot', 'polka', 'striped', 'stripes', 'plaid', 'checkered', 'paisley', 'geometric', 'abstract', 'print', 'printed', 'pattern', 'patterns', 'dots', 'dot'];
    if (patternKeywords.some(keyword => new RegExp(`\\b${keyword}\\b`).test(queryLower))) {
      explicitMentions.push('patterns');
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
    
    // DICTIONARY-BASED CONSTRAINT REFINEMENT
    // Run LLM refinement for discovery queries with products
    // This maps user intent onto static dictionaries for ranking-only constraints
    let finalConstraintsForRanking = constraintsForRanking;
    
    if (productsWithVectorScores.length > 0 && (classification as QueryClassification).type !== 'unrelated') {
      try {
        const refinementStartTime = Date.now();
        
        // Extract context for refinement
        const refinementGender = classification.constraints.gender || null;
        const refinementAgeGroup = extractConstraintValues(constraintsForRanking.ageGroups)?.[0] || null;
        
        // Build conversation history snippet (last 2 turns)
        const historySnippet = input.history?.slice(-2) || [];
        
        logger.debug('dictionary_refinement_starting', {
          query: input.message.substring(0, 100),
          gender: refinementGender,
          categories: topCategories,
          ageGroup: refinementAgeGroup,
          candidateCount: productsWithVectorScores.length,
        });
        
        const refinementResult = await refineConstraintsWithDictionaries({
          query: input.message,
          gender: refinementGender,
          categories: topCategories.length > 0 ? topCategories : undefined,
          ageGroup: refinementAgeGroup,
          candidateCount: productsWithVectorScores.length,
          conversationHistory: historySnippet,
        });
        
        const refinementDuration = Date.now() - refinementStartTime;
        logger.info('dictionary_refinement_complete', {
          query: input.message.substring(0, 100),
          durationMs: refinementDuration,
          durationSeconds: (refinementDuration / 1000).toFixed(2),
          refinedConstraintTypes: Object.keys(refinementResult.validatedConstraints).filter(k => refinementResult.validatedConstraints[k as keyof typeof refinementResult.validatedConstraints] !== null).length,
          validationStats: refinementResult.validationStats,
        });
        
        // Merge refined constraints with existing constraints
        // Refined constraints take precedence for ranking
        if (Object.keys(refinementResult.validatedConstraints).length > 0) {
          finalConstraintsForRanking = mergeRefinedConstraints(
            constraintsForRanking as any,
            refinementResult.validatedConstraints
          ) as FashionConstraints;
          
          logger.info('constraints_merged_with_refinement', {
            query: input.message.substring(0, 100),
            originalConstraintCount: Object.keys(constraintsForRanking).filter(k => constraintsForRanking[k as keyof typeof constraintsForRanking] !== null && constraintsForRanking[k as keyof typeof constraintsForRanking] !== undefined).length,
            refinedConstraintCount: Object.keys(refinementResult.validatedConstraints).filter(k => refinementResult.validatedConstraints[k as keyof typeof refinementResult.validatedConstraints] !== null).length,
            finalConstraintCount: Object.keys(finalConstraintsForRanking).filter(k => finalConstraintsForRanking[k as keyof typeof finalConstraintsForRanking] !== null && finalConstraintsForRanking[k as keyof typeof finalConstraintsForRanking] !== undefined).length,
          });
        }
      } catch (error) {
        logger.error('dictionary_refinement_failed_continuing_with_original', {
          error: error instanceof Error ? error.message : String(error),
          query: input.message.substring(0, 100),
        });
        // Continue with original constraints if refinement fails
      }
    }
    
    const rankingStartTime = Date.now();
    logger.info('handleLoveshackfancyQuery: starting_ranking', {
      query: input.message.substring(0, 100),
      productCount: productsWithVectorScores.length,
      constraintCount: Object.keys(finalConstraintsForRanking).filter(k => finalConstraintsForRanking[k as keyof typeof finalConstraintsForRanking] !== null && finalConstraintsForRanking[k as keyof typeof finalConstraintsForRanking] !== undefined).length,
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
  // If age group is explicitly mentioned in the query, reject products that don't match
  // This ensures "baby" queries don't return "for Women" products
  const ageGroupsConstraint = constraintsForRanking.ageGroups;
  const ageGroupExplicitlyMentioned = queryContext.explicitMentions.includes('ageGroups');
  const ageGroupValues = extractConstraintValues(ageGroupsConstraint) || (Array.isArray(ageGroupsConstraint) ? ageGroupsConstraint : []);
  
  if (ageGroupValues.length > 0 && ageGroupExplicitlyMentioned) {
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
  // Always include explicitMentions so reply can distinguish between explicitly mentioned and inferred constraints
  const replyContext: ReplyContext | undefined = (isFollowUp || queryToMergeWith || productTypeMismatch || explicitMentions.length > 0) ? {
    isFollowUp: isFollowUp,
    currentQuery: originalUserMessage, // Most recent user query (original, before enhancement)
    previousQuery: queryToMergeWith || undefined, // Previous query (available for both follow-ups and new searches)
    enhancedQuery: enhancedQueryText || input.message, // Enhanced query used for search
    classificationConstraints: classification.constraints, // Classification constraints for reference/fallback
    productTypeMismatch: productTypeMismatch, // Product type mismatch information
    explicitMentions: explicitMentions, // Constraints explicitly mentioned by the user
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
  const scentValues = extractConstraintValues(finalConstraints.scents) || (Array.isArray(finalConstraints.scents) ? finalConstraints.scents : []);
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
