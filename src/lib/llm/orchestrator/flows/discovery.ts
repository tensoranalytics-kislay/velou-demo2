import { searchProductsRelaxed } from '../../../search';
import type { SearchConstraints, SearchResultItem } from '../../../search/types';
import { getCatalogOntology } from '../../../search/ontology';
import { logger } from '../../../telemetry/logger';
import type { DatasetContext } from '../../../catalog/datasetInspector';
import {
  buildCardReasonsBatch,
  buildDiscoveryReply,
  buildPendingSummary,
  buildProductCard,
  buildQueryChips,
  collectConstraintLabels,
  deduplicateProductCards,
  evaluateProductFit,
  inferImplicitPreferences,
  tokenize,
} from '../cards';
import { applyBrandVoiceToReply, maybeEnhanceReplyWithLlm } from '../brandVoice';
import {
  buildClarifyingReply,
  buildNoRelevantProductsReply,
  buildPostCardsFollowupText,
  categoryExistsInCatalog,
} from '../helpers';
import { extractHardTextFilterKeywords } from '../utils';
import { callLLM, type LlmMessage } from '../../provider';
import {
  CLOSEST_MATCH_RESCUE_PLAN_PROMPT,
  CLOSEST_MATCH_RESCUE_PLAN_JSON_SCHEMA,
  NO_RESULTS_REPLY_PROMPT_V2,
  buildOutOfScopeReplyPrompt,
} from '../../prompts';
import { expandKeywordsForSearch } from '../../../search/canonicalize';
import { stripJsonFences } from '../utils';
import type { ProgressCallback } from '../progress';
import { STAGE_PROGRESS } from '../progress';
import { PRODUCT_REQUEST_KEYWORDS } from '../constants';
import type { AssistantIntent } from '../intent';
import type { AssistantQueryResult, ConversationContext, PendingSuggestionResult } from '../index';

/**
 * Discovery Flow
 * 
 * Handles product discovery queries where users are searching for products.
 * This is the main flow for queries like:
 * - "Show me blue dresses under $100"
 * - "I need a moisturizer for dry skin"
 * - "Find me running shoes"
 * 
 * The flow:
 * 1. Validates category exists in catalog
 * 2. Searches products with constraints (with relaxation fallback)
 * 3. Evaluates product relevance
 * 4. Generates product cards with reasons
 * 5. Builds conversational reply
 * 6. Generates follow-up questions
 * 
 * Used by: handleAssistantQuery when intent is 'discovery' and no productContextId
 * API: POST /api/assistant, POST /api/assistant/stream
 */

/**
 * Helper function for flow decision
 * Determines if product cards should be shown based on message and constraints
 */
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

export async function runDiscoveryFlow(
  constraints: SearchConstraints,
  userMessage: string,
  intent: AssistantIntent,
  datasetContext?: DatasetContext | null,
  onProgress?: ProgressCallback,
  conversationContext?: ConversationContext,
): Promise<AssistantQueryResult> {
  logger.debug('runDiscoveryFlow start', {
    constraints: {
      category: constraints.category,
      priceMaxCents: constraints.priceMaxCents,
      limit: 4, // Always 4 products
    },
  });

  // Get ontology to check if requested category exists
  const ontology = await getCatalogOntology();
  const requestedCategoryExists = categoryExistsInCatalog(constraints.category, ontology);

  // Guard: if no category and no overlap with catalog terms, short-circuit with an out-of-catalog reply
  if (!constraints.category) {
    const keywords =
      (constraints as any).expandedKeywords && (constraints as any).expandedKeywords.length
        ? ((constraints as any).expandedKeywords as string[])
        : tokenize(userMessage);

    const catalogTerms = new Set(
      [
        ...(ontology.categories || []),
        ...(ontology.productTypes || []),
        ...(ontology.brands || []),
        ...(datasetContext?.sampleCategories || []),
      ]
        .filter(Boolean)
        .map((t) => t.toLowerCase()),
    );

    const hasCatalogMatch = keywords.some((k) => {
      const kw = k.toLowerCase();
      return Array.from(catalogTerms).some((ct) => kw.includes(ct) || ct.includes(kw));
    });

    if (!hasCatalogMatch) {
      onProgress?.('generating', STAGE_PROGRESS.generating);
      try {
        const prompt = buildOutOfScopeReplyPrompt(datasetContext);
        const messages: LlmMessage[] = [
          { role: 'system', content: prompt },
          { role: 'user', content: `userMessage: "${userMessage}"` },
        ];

        const result = await callLLM({
          messages,
          purpose: 'final_reply',
          expectJson: false,
        });

        const text = result.rawText.trim();
        const reply = text.length
          ? await applyBrandVoiceToReply(text)
          : "I don't have that in this catalog. Tell me a category, need, or budget here and I'll search for you.";

        onProgress?.('complete', STAGE_PROGRESS.complete);
        return {
          replyText: reply,
          productCards: [],
          noExactMatch: true,
        };
      } catch (error) {
        logger.error('out_of_catalog_reply_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        const fallback = await applyBrandVoiceToReply(
          "I don't have that in this catalog. Tell me a category, need, or budget and I'll search what's available here.",
        );
        onProgress?.('complete', STAGE_PROGRESS.complete);
        return {
          replyText: fallback,
          productCards: [],
          noExactMatch: true,
        };
      }
    }
  }

  // Stage 1: Understanding complete (handled in handleAssistantQuery)
  // Stage 2: Searching products
  onProgress?.('searching', STAGE_PROGRESS.searching);

  if (!shouldShowCards(userMessage, constraints)) {
    onProgress?.('generating', STAGE_PROGRESS.generating);
    const clarifyingReply = await buildClarifyingReply(userMessage, datasetContext);
    onProgress?.('complete', STAGE_PROGRESS.complete);
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

  // Exclude previously shown products in follow-up refinements
  // This ensures users see different products when they refine their search
  // Only exclude when:
  // 1. There are previously shown products
  // 2. This is a follow-up (has previous constraints)
  // 3. Category hasn't changed (not a SWITCH)
  const lastShownProductIds = conversationContext?.lastShownProductIds;
  const previousConstraints = conversationContext?.lastConstraints;
  const previousCategory = previousConstraints?.category
    ? Array.isArray(previousConstraints.category)
      ? previousConstraints.category[0]
      : previousConstraints.category
    : null;
  const currentCategory = constraints.category
    ? Array.isArray(constraints.category)
      ? constraints.category[0]
      : constraints.category
    : null;
  const categoryChanged = previousCategory && currentCategory && previousCategory !== currentCategory;

  const shouldExcludePrevious =
    lastShownProductIds &&
    lastShownProductIds.length > 0 &&
    previousConstraints &&
    !categoryChanged; // Don't exclude on category switches

  const excludeProductIds = shouldExcludePrevious
    ? [...(constraints.excludeProductIds || []), ...lastShownProductIds]
    : constraints.excludeProductIds;

  if (shouldExcludePrevious && excludeProductIds?.length) {
    logger.debug('runDiscoveryFlow excluding previous products', {
      excludedCount: excludeProductIds.length,
      lastShownProductIds: lastShownProductIds.length,
      previousCategory,
      currentCategory,
      categoryChanged,
    });
  }

  // Add hardTextFilters and excludeProductIds to constraints for searchProducts
  const constraintsWithHardFilters = {
    ...constraints,
    excludeProductIds: excludeProductIds?.length ? Array.from(new Set(excludeProductIds)) : undefined, // Deduplicate
    ...(hardTextFilters && hardTextFilters.length > 0 ? { hardTextFilters } : {}),
  } as SearchConstraints & { hardTextFilters?: string[] };

  logger.debug('runDiscoveryFlow hardTextFilters', {
    category: constraints.category,
    normalizedCategory: constraints.category,
    hardTextFiltersEnabled: !!hardTextFilters && hardTextFilters.length > 0,
    hardTextFilters: hardTextFilters,
  });

  // Always use 4 products to reduce choice confusion
  const strictLimit = 4;
  const { candidates, relaxedConstraints, wasRelaxed } = await searchProductsRelaxed(
    { ...constraintsWithHardFilters, limit: strictLimit },
    strictLimit,
    userMessage, // Pass userMessage for canonicalization
  );

  // Stage 3: Evaluating matches
  onProgress?.('evaluating', STAGE_PROGRESS.evaluating);

  if (candidates.length === 0) {
    logger.warn('runDiscoveryFlow no products found, starting rescue stage', {
      constraints: {
        category: constraints.category,
        priceMaxCents: constraints.priceMaxCents,
      },
    });

    // C) No-results rescue stage
    try {
      // Step 1: Call rescue plan prompt
      const expandedKeywords = constraints.query ? expandKeywordsForSearch([constraints.query]) : [];

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
          rescueConstraints.query = [rescueSearch.queryText, ...rescueSearch.categoryHints]
            .filter(Boolean)
            .join(' ');
        }

        const rescueResult = await searchProductsRelaxed(rescueConstraints, 20, userMessage);
        if (rescueResult.candidates.length > 0) {
          closestCandidates.push(...rescueResult.candidates.slice(0, 10));
        }
      }

      if (closestCandidates.length === 0) {
        const verticalNote = datasetContext?.vertical
          ? `This catalog focuses on ${datasetContext.vertical}.`
          : 'This catalog is limited to the products currently uploaded.';
        const fallback = await applyBrandVoiceToReply(
          `I don't have items like "${userMessage}" in this catalog. ${verticalNote} Tell me a category, need, or budget within this catalog and I'll search for you.`,
        );
        onProgress?.('complete', STAGE_PROGRESS.complete);
        return {
          replyText: fallback,
          productCards: [],
          noExactMatch: true,
        };
      }

      // Step 3: Get top 5 closest candidates
      const topClosest = closestCandidates.slice(0, 5).map((item) => ({
        title: item.title,
        price: item.priceCents,
        color: (item.attributes?.color as string) || 'unknown',
        category: item.category,
      }));

      // Step 4: Call NO_RESULTS_REPLY_PROMPT_V2
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

      onProgress?.('complete', STAGE_PROGRESS.complete);
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

      onProgress?.('complete', STAGE_PROGRESS.complete);
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

  // Relevance check: Verify that top products actually match the user's intent
  // Check if products match the core intent keywords from expandedKeywords
  const expandedKeywords = (constraints as any).expandedKeywords || [];
  const coreIntentKeywords =
    expandedKeywords.length > 0
      ? expandedKeywords.slice(0, 5) // Use top 5 keywords as core intent
      : queryTokens.filter((t) => t.length > 3); // Fallback to meaningful query tokens

  if (coreIntentKeywords.length > 0 && evaluated.length > 0) {
    const topProducts = evaluated.slice(0, Math.min(4, evaluated.length));
    const relevantProducts = topProducts.filter(({ item }) => {
      const searchableText = `${item.title} ${item.description} ${item.category}`.toLowerCase();
      const attrs = (item.attributes ?? {}) as any;
      const attrText = [
        attrs.benefits?.join(' ') || '',
        attrs.claims?.join(' ') || '',
        attrs.useCases?.join(' ') || '',
        attrs.compatibility?.join(' ') || '',
        attrs.sensoryProfile || '',
        attrs.productHighlights || '',
        attrs.bulletHighlights?.join(' ') || '',
      ].join(' ').toLowerCase();

      const fullText = `${searchableText} ${attrText}`;

      // Check if at least one core intent keyword appears in the product
      return coreIntentKeywords.some((keyword: string) => {
        const kw = keyword.toLowerCase();
        // Match whole words or phrases, not just substrings
        return (
          fullText.includes(kw) ||
          fullText.split(/\s+/).some((word) => word.includes(kw) || kw.includes(word))
        );
      });
    });

    // If less than 50% of top products are relevant, consider them irrelevant
    if (relevantProducts.length < Math.ceil(topProducts.length * 0.5)) {
      logger.info('runDiscoveryFlow products_not_relevant', {
        userMessage,
        topProductsCount: topProducts.length,
        relevantProductsCount: relevantProducts.length,
        coreIntentKeywords: coreIntentKeywords.slice(0, 5),
        topProductTitles: topProducts.map(({ item }) => item.title).slice(0, 3),
      });

      // Return a response indicating no relevant products found
      onProgress?.('generating', STAGE_PROGRESS.generating);
      const noRelevantReply = await buildNoRelevantProductsReply(
        userMessage,
        constraints,
        datasetContext,
        ontology,
      );
      onProgress?.('complete', STAGE_PROGRESS.complete);
      return {
        replyText: noRelevantReply,
        productCards: [],
        noExactMatch: true,
      };
    }
  }

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
  const maxLen = Math.max(...Array.from(groupedByCategory.values()).map((g) => g.length));
  for (let i = 0; i < maxLen && interleaved.length < strictLimit * 2; i++) {
    for (const group of groupedByCategory.values()) {
      if (group[i]) interleaved.push(group[i]);
    }
  }

  // Take top N from interleaved (or fallback to ranked if not enough)
  const diverseEvaluated =
    interleaved.length >= strictLimit
      ? interleaved.slice(0, strictLimit)
      : uniqueEvaluated.slice(0, strictLimit);

  const topEvaluations = diverseEvaluated;
  const shortlistedItems = topEvaluations.map((entry) => entry.item);
  const constraintLabels = collectConstraintLabels(constraints);
  const queryChips = buildQueryChips(constraints, implicitPrefs);

  const strictReasonInputs = topEvaluations.map(({ item, facts }) => ({
    item,
    userMessage,
    constraintLabels,
    facts,
    implicitPrefs,
  }));

  const strictReasons = await buildCardReasonsBatch(
    strictReasonInputs,
    requestedCategoryExists,
    constraints.category,
  );

  const strictCards = topEvaluations.map(({ item }, index) =>
    buildProductCard(item, {
      reason: strictReasons[index],
      queryChips,
    }),
  );

  // Fix D: Final deduplication by productUrl/canonicalSku (already done by ID, but ensure uniqueness)
  const deduplicatedCards = deduplicateProductCards(strictCards, strictLimit);

  logger.debug('deduplicateProductCards', {
    before: strictCards.length,
    after: deduplicatedCards.length,
    removed: strictCards.length - deduplicatedCards.length,
    requestedLimit: strictLimit,
    uniqueIds: new Set(deduplicatedCards.map((c) => c.id)).size,
    uniqueImageUrls: new Set(deduplicatedCards.map((c) => c.imageUrl).filter(Boolean)).size,
    duplicateImageUrls:
      strictCards.length - new Set(strictCards.map((c) => c.imageUrl).filter(Boolean)).size,
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
      ontology,
      requestedCategoryExists,
    });

    const productSummaries = deduplicatedCards.map((card) => {
      const reasonPart = card.reason ? ` — ${card.reason}` : '';
      const pricePart =
        typeof card.priceCents === 'number'
          ? ` (${card.currency ?? 'USD'} ${(card.priceCents / 100).toFixed(2)})`
          : '';
      return `${card.title}${reasonPart}${pricePart}`.trim();
    });

    const followupText = await buildPostCardsFollowupText(
      userMessage,
      wasRelaxed ? relaxedConstraints : constraints,
      datasetContext,
      ontology,
      requestedCategoryExists,
      enhancedReply,
      productSummaries,
    );

    // Stage 5: Complete
    onProgress?.('complete', STAGE_PROGRESS.complete);

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

  onProgress?.('complete', STAGE_PROGRESS.complete);

  return {
    replyText: enhancedReply,
    productCards: [],
    noExactMatch: true,
    pendingSuggestion,
  };
}


