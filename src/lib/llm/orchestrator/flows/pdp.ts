import { prisma } from '../../../db';
import { searchProducts } from '../../../search';
import type { SearchConstraints, SearchResultItem } from '../../../search/types';
import { getCatalogOntology } from '../../../search/ontology';
import type { DatasetContext } from '../../../catalog/datasetInspector';
import {
  buildCardReasonsBatch,
  buildProductCard,
  buildQueryChips,
  buildSuitabilityReply,
  collectConstraintLabels,
  inferImplicitPreferences,
  productToResultItem,
} from '../cards';
import { applyBrandVoiceToReply, maybeEnhanceReplyWithLlm } from '../brandVoice';
import { categoryExistsInCatalog, buildPostCardsFollowupText } from '../helpers';
import type { AssistantQueryResult } from '../index';
import { runDiscoveryFlow } from './discovery';

/**
 * PDP (Product Detail Page) Flow
 * 
 * Handles queries about a specific product when user is viewing a product page.
 * Shows the product being viewed plus related products.
 * 
 * The flow:
 * 1. Loads the product being viewed
 * 2. Searches for related products (same category, excludes current product)
 * 3. Generates product cards (current product + related)
 * 4. Builds suitability reply explaining why the product fits
 * 5. Generates follow-up questions
 * 
 * Used by: handleAssistantQuery when productContextId is set
 * API: POST /api/assistant, POST /api/assistant/stream
 */

/**
 * Run PDP flow
 * 
 * Shows the product being viewed with related products and explains why it fits the user's needs.
 * 
 * @param productContextId - ID of the product being viewed
 * @param constraints - Search constraints (for related product search)
 * @param userMessage - Original user message
 * @param datasetContext - Catalog context (vertical, facets, etc.)
 * @returns Assistant query result with product cards and reply text
 */
export async function runPdpFlow(
  productContextId: string,
  constraints: SearchConstraints,
  userMessage: string,
  datasetContext?: DatasetContext | null,
): Promise<AssistantQueryResult> {
  const productRecord = await prisma.product.findUnique({ where: { id: productContextId } });
  if (!productRecord) {
    // Fallback to discovery flow if product not found
    return runDiscoveryFlow(constraints, userMessage, 'discovery', datasetContext, undefined, undefined);
  }

  // Get ontology to check if requested category exists
  const ontology = await getCatalogOntology();
  const requestedCategoryExists = categoryExistsInCatalog(constraints.category, ontology);

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

  const baseFacts = ["it is the specific piece you're currently viewing"];
  const relatedInputs = related.map((item: SearchResultItem) => ({
    item,
    userMessage,
    constraintLabels,
    facts: [
      `it shares the ${(item.attributes as any)?.fabric ?? 'fabric'} finish you liked`,
      `it keeps the same ${item.category.toLowerCase()} vibe`,
    ],
    implicitPrefs,
  }));

  const allReasonInputs = [
    {
      item: baseProduct,
      userMessage,
      constraintLabels,
      facts: baseFacts,
      implicitPrefs,
    },
    ...relatedInputs,
  ];

  const allReasons = await buildCardReasonsBatch(allReasonInputs, requestedCategoryExists, constraints.category);
  const [baseReason, ...relatedReasons] = allReasons;

  const relatedCards = related.map((item: SearchResultItem, index: number) =>
    buildProductCard(item, {
      reason: relatedReasons[index],
      queryChips,
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
    ontology,
    requestedCategoryExists,
  });

  const productSummaries = productCards.map((card) => {
    const reasonPart = card.reason ? ` — ${card.reason}` : '';
    const pricePart =
      typeof card.priceCents === 'number'
        ? ` (${card.currency ?? 'USD'} ${(card.priceCents / 100).toFixed(2)})`
        : '';
    return `${card.title}${reasonPart}${pricePart}`.trim();
  });

  const followupText = await buildPostCardsFollowupText(
    userMessage,
    constraints,
    datasetContext,
    ontology,
    requestedCategoryExists,
    enhancedReply,
    productSummaries,
  );

  return {
    replyText: enhancedReply,
    productCards,
    noExactMatch: wasRelaxed,
    followupText,
  };
}


