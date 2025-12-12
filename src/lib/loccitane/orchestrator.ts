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
import { classifyQuery, type QueryClassification } from './classifier';
import { multiViewRetrieval } from './retrieval';
import { sortProductsByScore } from './ranking/ranker';
import type { ProductWithLoccitaneAttributes } from './ranking/ranker';
import { generateReplyWithRag } from './reply';
import { buildProductReason } from './reasons';
import type { StructuredLoccitaneAttributes } from './attributeParser';
import type { ProductAttributes } from '../search/types';
import { normalizeProductType, normalizeIngredient, normalizeAvoidIngredients } from './normalization';
import type { ProgressCallback } from '../llm/types';
import { STAGE_PROGRESS } from '../llm/types';

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
  productContextId?: string; // Product ID for product-specific queries
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
  
  // Step 2: Load product context if provided (for product-specific queries)
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
  
  // Step 3: Query classification
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
  
  logger.debug('handleLoccitaneQuery: classification complete', {
    query: input.message.substring(0, 100),
    type: classification.type,
    constraints: {
      concerns: classification.constraints.concerns,
      skinTypes: classification.constraints.skinTypes,
      applicationAreas: classification.constraints.applicationAreas,
      productTypes: classification.constraints.productTypes,
      ingredients: classification.constraints.mustHaveIngredients,
      madeWithout: classification.constraints.madeWithout,
      collections: classification.constraints.collections,
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
  
  // Step 4: Multi-view retrieval (SKIP for product-specific queries)
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
  
  // Step 5: Load full product objects (filter for L'Occitane products with structured attributes)
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
    candidateProducts = await loadLoccitaneProducts(
      retrievalResult.candidateIds,
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
  
  // Step 6: Ranking
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
  
  // Step 7: RAG reply generation
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
    productContextProduct // Pass product context for product-specific queries
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
  
  onProgress?.('complete', STAGE_PROGRESS.complete);
  
  const result: LoccitaneQueryResult = {
    replyText: replyResult.replyText,
    productCards,
    noExactMatch: topProducts.length === 0,
    followupText: replyResult.followupText,
  };
  
  return result;
}
