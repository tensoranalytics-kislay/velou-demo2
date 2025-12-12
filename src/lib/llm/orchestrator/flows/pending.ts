import { getCatalogOntology } from '../../../search/ontology';
import type { DatasetContext } from '../../../catalog/datasetInspector';
import type { SearchConstraints } from '../../../search/types';
import {
  buildCardReasonsBatch,
  buildProductCard,
  buildQueryChips,
  collectConstraintLabels,
  evaluateProductFit,
  fetchProductsByIds,
  inferImplicitPreferences,
  tokenize,
} from '../cards';
import { applyBrandVoiceToReply, maybeEnhanceReplyWithLlm } from '../brandVoice';
import { categoryExistsInCatalog, buildPostCardsFollowupText } from '../helpers';
import { MAX_RECOMMENDATIONS } from '../constants';
import type { AssistantQueryResult, PendingSuggestionInput } from '../index';

/**
 * Pending Suggestion Flow
 * 
 * Handles cases where the user confirms a pending suggestion (e.g., "yes", "show me").
 * Shows previously identified candidate products that match the user's constraints.
 * 
 * The flow:
 * 1. Fetches candidate products by IDs
 * 2. Evaluates product fit against constraints
 * 3. Ranks and shortlists products
 * 4. Generates product cards with reasons
 * 5. Builds conversational reply
 * 6. Generates follow-up questions
 * 
 * Used by: handleAssistantQuery when pendingSuggestion is confirmed
 * API: POST /api/assistant, POST /api/assistant/stream
 */

/**
 * Run pending suggestion flow
 * 
 * Shows candidate products from a pending suggestion when user confirms.
 * 
 * @param pending - Pending suggestion with constraints and candidate product IDs
 * @param userMessage - User's confirmation message
 * @param datasetContext - Catalog context (vertical, facets, etc.)
 * @returns Assistant query result with product cards and reply text
 */
export async function runPendingSuggestionFlow(
  pending: PendingSuggestionInput,
  userMessage: string,
  datasetContext?: DatasetContext | null,
): Promise<AssistantQueryResult> {
  const products = await fetchProductsByIds(pending.candidateIds);
  if (products.length === 0) {
    let reply =
      "Those saved picks aren't available anymore.\n\nI can search again. Just tell me what you're looking for.";
    reply = await applyBrandVoiceToReply(reply);
    return {
      replyText: reply,
      productCards: [],
      noExactMatch: true,
    };
  }

  // Get ontology to check if requested category exists
  const ontology = await getCatalogOntology();
  const requestedCategoryExists = categoryExistsInCatalog(pending.constraints.category, ontology);

  const implicitPrefs = inferImplicitPreferences(userMessage);
  const queryTokens = tokenize(userMessage);
  const queryChips = buildQueryChips(pending.constraints, implicitPrefs);
  const constraintLabels = collectConstraintLabels(pending.constraints);

  const evaluated = products
    .map((item) => evaluateProductFit(item, pending.constraints, implicitPrefs, queryTokens))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.priceCents - b.item.priceCents;
    })
    .slice(0, MAX_RECOMMENDATIONS);

  const shortlistedProducts = evaluated.map((entry) => entry.item);

  const reasonInputs = evaluated.map(({ item, facts }) => ({
    item,
    userMessage,
    constraintLabels,
    facts,
    implicitPrefs,
  }));

  const reasons = await buildCardReasonsBatch(reasonInputs, requestedCategoryExists, pending.constraints.category);

  const cards = evaluated.map(({ item }, index) =>
    buildProductCard(item, {
      reason: reasons[index],
      queryChips,
    }),
  );

  let baseReply =
    cards.length === 1
      ? "Here's what I found for you."
      : `I found a few options that should work.\n\nTap any card to view details.`;
  baseReply = await applyBrandVoiceToReply(baseReply);

  const enhancedReply = await maybeEnhanceReplyWithLlm({
    baseReply,
    userMessage,
    intent: 'discovery',
    constraints: pending.constraints,
    products: shortlistedProducts,
    wasRelaxed: false,
    datasetContext,
    ontology,
    requestedCategoryExists,
  });

  const productSummaries = cards.map((card) => {
    const reasonPart = card.reason ? ` — ${card.reason}` : '';
    const pricePart =
      typeof card.priceCents === 'number'
        ? ` (${card.currency ?? 'USD'} ${(card.priceCents / 100).toFixed(2)})`
        : '';
    return `${card.title}${reasonPart}${pricePart}`.trim();
  });

  const followupText = await buildPostCardsFollowupText(
    userMessage,
    pending.constraints,
    datasetContext,
    ontology,
    requestedCategoryExists,
    enhancedReply,
    productSummaries,
  );

  return {
    replyText: enhancedReply,
    productCards: cards,
    noExactMatch: false,
    followupText,
  };
}


