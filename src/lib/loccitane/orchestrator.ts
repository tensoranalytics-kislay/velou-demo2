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
import type { ProductCard } from '../llm/orchestrator/cards';
import { productToResultItem, fetchProductsByIds } from '../llm/orchestrator/cards';
import { prisma } from '../db';
import { checkQuerySafety } from './safety';
import { classifyQuery } from './classifier';
import { multiViewRetrieval } from './retrieval';
import { sortProductsByScore } from './ranking/ranker';
import type { ProductWithLoccitaneAttributes } from './ranking/ranker';
import { generateReplyWithRag } from './reply';
import { buildProductReason } from './reasons';
import type { StructuredLoccitaneAttributes } from './attributeParser';
import type { ProductAttributes } from '../search/types';
import { normalizeProductType, normalizeIngredient, normalizeAvoidIngredients } from './normalization';
import type { ProgressCallback } from '../llm/orchestrator/progress';
import { STAGE_PROGRESS } from '../llm/orchestrator/progress';

export type LoccitaneQueryResult = {
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  followupText?: string;
};

type LoccitaneQueryInput = {
  sessionId: string;
  message: string;
  lastConstraints?: SearchConstraints | null;
  lastShownProductIds?: string[];
  merchantId?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onProgress?: ProgressCallback;
  searchMethods?: {
    lexical: boolean;
    semantic: boolean;
    concept: boolean;
  };
};

/**
 * Load products with L'Occitane structured attributes
 */
async function loadLoccitaneProducts(
  productIds: string[],
  merchantId?: string
): Promise<ProductWithLoccitaneAttributes[]> {
  if (productIds.length === 0) return [];
  
  // Load products from database
  // Note: Prisma's JSON filtering can be complex, so we load and filter in code
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
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
  });
  
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
      };
    }
  }
  
  // Step 2: Query classification
  onProgress?.('classifying', STAGE_PROGRESS.classifying);
  const classifyStart = Date.now();
  const classification = await classifyQuery(input.message, input.history);
  const classifyDuration = Date.now() - classifyStart;
  
  if (classification.type === 'unrelated') {
    logger.debug('handleLoccitaneQuery: unrelated query', {
      message: input.message.substring(0, 100),
      classifyDuration,
    });
    
    // Generate a witty, smart response that redirects to beauty/personal care
    // Check if safety check already identified it as non-shopping (for consistency)
    const isNonShopping = !safetyCheck.safe && 'reason' in safetyCheck && safetyCheck.reason === 'non_shopping';
    
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
  
  // Step 3: Multi-view retrieval
  onProgress?.('retrieving', STAGE_PROGRESS.retrieving);
  const retrievalStart = Date.now();
  const retrievalResult = await multiViewRetrieval(
    input.message,
    classification,
    input.merchantId,
    input.searchMethods || { lexical: true, semantic: true, concept: true }
  );
  const retrievalDuration = Date.now() - retrievalStart;
  
  logger.debug('handleLoccitaneQuery: retrieval complete', {
    candidateCount: retrievalResult.candidateIds.length,
    lexicalCount: retrievalResult.lexicalScores.size,
    semanticCount: retrievalResult.semanticScores.size,
    retrievalDuration,
  });
  
  // Step 4: Load full product objects (filter for L'Occitane products with structured attributes)
  // Progress update is part of retrieving stage
  const loadStart = Date.now();
  const candidateProducts = await loadLoccitaneProducts(
    retrievalResult.candidateIds,
    input.merchantId
  );
  const loadDuration = Date.now() - loadStart;
  
  // Exclude previously shown products
  let filteredProducts = candidateProducts;
  if (input.lastShownProductIds && input.lastShownProductIds.length > 0) {
    filteredProducts = candidateProducts.filter(
      p => !input.lastShownProductIds!.includes(p.id)
    );
  }
  
  // Step 4.5: Apply productType filter for direct_product_search
  const { type, constraints } = classification;
  const requestedProductTypes = constraints.productTypes ?? [];
  const originalCount = filteredProducts.length;
  
  if (type === 'direct_product_search' && requestedProductTypes.length > 0) {
    const normalizedRequestedTypes = requestedProductTypes.map(normalizeProductType);
    
    filteredProducts = filteredProducts.filter(product => {
      const attrs = product.attributes?.loccitaneStructured;
      const rawType = attrs?.productType ?? null;
      if (!rawType) return false;
      
      const normalizedProductType = normalizeProductType(rawType);
      
      // Match if normalized product type matches any requested type
      return normalizedRequestedTypes.some(reqType => 
        normalizedProductType === reqType || 
        normalizedProductType.includes(reqType) ||
        reqType.includes(normalizedProductType)
      );
    });
    
    // Fallback: if we filtered out everything, fall back to original list
    if (filteredProducts.length === 0) {
      logger.debug('handleLoccitaneQuery: productType filter removed all products, using fallback', {
        requestedProductTypes,
        originalCount,
      });
      filteredProducts = candidateProducts.filter(
        p => !input.lastShownProductIds?.includes(p.id)
      );
    } else {
      logger.debug('handleLoccitaneQuery: productType filter applied', {
        queryType: classification.type,
        requestedProductTypes,
        originalCount,
        filteredCount: filteredProducts.length,
      });
    }
  }
  
  // Step 4.6: Apply avoidIngredients filter
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
  
  // Step 5: Ranking
  onProgress?.('ranking', STAGE_PROGRESS.ranking);
  const rankingStart = Date.now();
  const rankedProducts = sortProductsByScore(
    input.message,
    classification,
    filteredProducts,
    {
      lexicalScores: retrievalResult.lexicalScores,
      semanticScores: retrievalResult.semanticScores,
    }
  );
  const rankingDuration = Date.now() - rankingStart;
  
  const topProducts = rankedProducts.slice(0, 20);
  
  logger.debug('handleLoccitaneQuery: ranking complete', {
    rankedCount: topProducts.length,
    rankingDuration,
  });
  
  // Step 6: RAG reply generation
  // Use only top 4 products for reply context to match what will be displayed
  // This ensures the LLM response is focused on the products the user will see
  const displayProducts = topProducts.slice(0, 4);
  
  onProgress?.('generating_reply', STAGE_PROGRESS.generating_reply);
  const replyStart = Date.now();
  const replyResult = await generateReplyWithRag(
    input.message,
    classification,
    displayProducts, // Pass only the 4 products that will be displayed
    input.merchantId
  );
  const replyDuration = Date.now() - replyStart;
  
  // Step 7: Build product cards (using the same 4 products used for reply context)
  const productCards: ProductCard[] = displayProducts.map((product) => {
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
    // Latency breakdown
    classifyDuration,
    retrievalDuration,
    loadDuration,
    rankingDuration,
    replyDuration,
  });
  
  // Step 7: Complete
  onProgress?.('complete', STAGE_PROGRESS.complete);
  
  return {
    replyText: replyResult.replyText,
    productCards,
    noExactMatch: topProducts.length === 0,
    followupText: replyResult.followupText,
  };
}
