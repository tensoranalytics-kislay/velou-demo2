/**
 * Action Handlers
 * 
 * Handles action clicks that require conversational follow-up questions
 * instead of directly triggering searches.
 */

import { logger } from '../telemetry/logger';
import type { ActionProposal } from './actions';
import { generateActionId } from './actions';
import type { ConversationStateData } from '../chat/ConversationStateService';
import type { SearchConstraints } from '../search/types';

export type ActionHandlerResult = {
  replyText: string;
  actions?: ActionProposal[];
  shouldContinueToDiscovery?: boolean; // If true, continues to normal discovery flow with modified message
  discoveryMessage?: string; // Message to use for discovery if shouldContinueToDiscovery is true
};

/**
 * Handle refine_price action - asks user about their price preference
 * Uses conversation context to make replies relevant to what user was looking for
 */
export function handleRefinePriceAction(
  conversationState: ConversationStateData,
  lastConstraints?: SearchConstraints | null
): ActionHandlerResult {
  const currentPrice = lastConstraints?.priceMaxCents 
    ? `$${(lastConstraints.priceMaxCents / 100).toFixed(0)}`
    : null;

  let replyText: string;
  const actions: ActionProposal[] = [];

  // Build context-aware reply that references what the user was looking for
  const productTypeContext = lastConstraints?.productTypes?.[0] 
    ? ` for ${lastConstraints.productTypes[0]}`
    : '';
  // Note: concerns are not in SearchConstraints, they're in QueryClassification constraints
  const contextSuffix = productTypeContext ? ` (${productTypeContext})` : '';

  if (currentPrice) {
    replyText = `I see you're looking for options under ${currentPrice}${contextSuffix}. What's your preferred price range?`;
  } else {
    replyText = `What price range are you looking for${contextSuffix}? You can tell me a specific amount like "$50" or "under $100".`;
  }

  // Offer quick price range options
  actions.push(
    {
      id: generateActionId('refine_price'),
      type: 'refine_price',
      label: 'Under $30',
      payload: { priceMaxCents: 3000 },
    },
    {
      id: generateActionId('refine_price'),
      type: 'refine_price',
      label: 'Under $50',
      payload: { priceMaxCents: 5000 },
    },
    {
      id: generateActionId('refine_price'),
      type: 'refine_price',
      label: 'Under $100',
      payload: { priceMaxCents: 10000 },
    }
  );

  return {
    replyText,
    actions,
  };
}

/**
 * Handle ask_preferences action - asks guided questions about preferences
 * Uses conversation context to make replies relevant to what user was looking for
 */
export function handleAskPreferencesAction(
  conversationState: ConversationStateData,
  preferenceType?: string,
  lastConstraints?: SearchConstraints | null
): ActionHandlerResult {
  let replyText: string;
  const actions: ActionProposal[] = [];

  // Build context from previous search to make reply relevant
  const hasContext = lastConstraints && (
    lastConstraints.productTypes?.length ||
    lastConstraints.priceMaxCents ||
    lastConstraints.priceMinCents ||
    lastConstraints.query
  );

  // Build context reference
  let contextReference = '';
  if (hasContext && lastConstraints) {
    const parts: string[] = [];
    if (lastConstraints.productTypes?.[0]) {
      parts.push(lastConstraints.productTypes[0]);
    }
    if (lastConstraints.query && lastConstraints.query.length < 50) {
      // Only use short queries for context
      parts.push(`for "${lastConstraints.query}"`);
    }
    if (parts.length > 0) {
      contextReference = ` related to ${parts.join(' ')}`;
    }
  }

  switch (preferenceType) {
    case 'ingredient':
      replyText = `What ingredients are you interested in${contextReference}? For example, you might look for products with shea butter, almond oil, or niacinamide.`;
      // Could add ingredient chips here if we had a list
      break;
    case 'concern':
      replyText = `What skin or hair concerns would you like to address${contextReference}? For example: dryness, sensitive skin, aging, or specific hair needs.`;
      break;
    case 'productType':
      replyText = `What type of product are you looking for${contextReference}? For example: face moisturizer, hand cream, body care, or fragrance.`;
      break;
    default:
      // General preferences - reference context if available
      if (contextReference) {
        replyText = `I'd love to help you refine your search${contextReference}! What else are you looking for? You can tell me about:\n\n• Specific ingredients you're interested in\n• Additional skin or hair concerns\n• Price range preferences\n• Product format or size preferences`;
      } else {
        replyText = `I'd love to help you find the perfect products! What are you looking for? You can tell me about:\n\n• Skin or hair concerns you want to address\n• Specific ingredients you're interested in\n• Product types (face care, body care, fragrances, etc.)\n• Price range\n• Gift ideas`;
      }
      break;
  }

  return {
    replyText,
    actions: actions.length > 0 ? actions : undefined,
  };
}

/**
 * Handle action click - routes to appropriate handler
 */
export function handleActionClick(
  action: ActionProposal,
  conversationState: ConversationStateData,
  lastConstraints?: SearchConstraints | null
): ActionHandlerResult | null {
  switch (action.type) {
    case 'refine_price':
      return handleRefinePriceAction(conversationState, lastConstraints);
    
    case 'ask_preferences':
      return handleAskPreferencesAction(
        conversationState,
        action.payload?.preferenceType as string | undefined,
        lastConstraints
      );
    
    default:
      // For other actions (show_more, etc.), return null to use default handling
      return null;
  }
}

