/**
 * AssistantService
 * 
 * Wraps the LoveShackFancy orchestrator with merchantId.
 * This ensures all assistant queries are scoped to a specific merchant.
 */

import { handleLoveshackfancyQuery } from '../loveshackfancy/orchestrator';
import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';
import type { ConversationContext, QueryStage, ProgressCallback } from '../llm/types';
import type { ProductCard } from '../llm/orchestrator/cards';
import type { QueryClassification } from '../loveshackfancy/classifier';
import {
  getState,
  updateState,
  appendShownProducts,
  setLastRankedProducts,
  advanceRankCursor,
  updateMemory,
  setPendingActions,
  type ConversationStateData,
} from '../chat/ConversationStateService';

export type AssistantQueryInput = {
  sessionId: string;
  pageType?: 'HOME' | 'PLP' | 'PDP'; // Optional for backward compatibility
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  productContextId?: string;
  conversationContext?: ConversationContext;
  onProgress?: ProgressCallback;
  searchMethods?: {
    lexical: boolean;
    semantic: boolean;
    concept: boolean;
  };
  actionId?: string; // Optional action ID for action-based queries
};

type ActionProposal = { id: string; type: string; label: string; payload?: any };

export type AssistantQueryResult = {
  replyText: string; // First part (before product cards)
  replyTextAfter?: string; // Second part (after product cards) - only when product cards are shown
  productCards: ProductCard[];
  noExactMatch: boolean;
  intent?: string;
  resolvedConstraints?: SearchConstraints;
  resolvedClassificationConstraints?: QueryClassification['constraints']; // Classification constraints for follow-up merging
  usedFollowUpContext?: boolean;
  followupText?: string;
  actions?: ActionProposal[];
  route?: string; // Dialogue route (for analytics)
  actionType?: string; // Action type if ACTION_REQUEST (for analytics)
};

/**
 * Handle assistant query for a merchant
 * 
 * This wraps the existing handleAssistantQuery function and ensures:
 * - Merchant exists and is valid
 * - DatasetContext is loaded from merchant
 * - All downstream calls are scoped to merchantId
 * 
 * @param merchantId - Merchant ID (required for multi-tenant isolation)
 * @param input - Assistant query input
 * @returns Assistant query result
 */
export async function handleAssistantQuery(
  merchantId: string,
  input: AssistantQueryInput
): Promise<AssistantQueryResult> {
  try {
    // Verify merchant exists and load needed fields
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        brandName: true,
        voiceInstructions: true,
        datasetContext: true,
        uiCopy: true,
        faq: true,
      },
    });

    if (!merchant) {
      logger.warn('assistant_merchant_not_found', { merchantId });
      throw new Error('Merchant not found');
    }

    // Load conversation state
    const conversationState = await getState(merchantId, input.sessionId);
    
    // Handle actionId: if provided, check for special handlers or map to message
    let messageToProcess = input.message;
    let actionHandlerResult: { replyText: string; actions?: any[] } | null = null;
    let inferredActionType: string | undefined = undefined;
    const inputWithAction = input as AssistantQueryInput & { actionId?: string };
    
    // Check for action handlers - either via actionId or by recognizing common action label patterns
    const messageLower = input.message.toLowerCase().trim();
    const isAdjustPrice = messageLower.includes('adjust') && messageLower.includes('price');
    const isSetPreferences = messageLower.includes('set') && messageLower.includes('preferences');
    const isShowMore = messageLower.includes('show more') || messageLower.includes('more') || messageLower.includes('next');
    
    // Try to find action from pendingActions if actionId is provided
    let action = inputWithAction.actionId && conversationState.pendingActions.length > 0
      ? conversationState.pendingActions.find(a => a.id === inputWithAction.actionId)
      : null;
    
    // If no action found but we recognize the pattern, infer the action type
    if (!action) {
      if (isAdjustPrice) {
        action = { id: 'refine_price_inferred', type: 'refine_price', label: 'Adjust Price' } as any;
        inferredActionType = 'refine_price';
      } else if (isSetPreferences) {
        action = { id: 'ask_preferences_inferred', type: 'ask_preferences', label: 'Set Preferences' } as any;
        inferredActionType = 'ask_preferences';
      } else if (isShowMore && inputWithAction.actionId) {
        action = { id: inputWithAction.actionId, type: 'show_more', label: 'Show more' } as any;
        inferredActionType = 'show_more';
      }
    } else {
      inferredActionType = action.type;
    }
    
    // Handle actions that need conversational responses
    if (action && (action.type === 'refine_price' || action.type === 'ask_preferences')) {
      const { handleRefinePriceAction, handleAskPreferencesAction } = await import('../loccitane/actionHandlers');
      
      if (action.type === 'refine_price') {
        // If payload has priceMaxCents, use it for discovery
        if (action.payload?.priceMaxCents) {
          messageToProcess = `options under $${(action.payload.priceMaxCents as number) / 100}`;
        } else {
          // No price specified - use handler to ask question
          const result = handleRefinePriceAction(
            conversationState,
            input.conversationContext?.lastConstraints || null
          );
          actionHandlerResult = {
            replyText: result.replyText,
            actions: result.actions,
          };
        }
      } else if (action.type === 'ask_preferences') {
        // Always use handler to ask guided questions
        const prefResult = handleAskPreferencesAction(
          conversationState,
          action.payload?.preferenceType as string | undefined,
          input.conversationContext?.lastConstraints || null
        );
        actionHandlerResult = {
          replyText: prefResult.replyText,
          actions: prefResult.actions,
        };
      }
    } else if (action && action.type === 'show_more') {
      // Show more is handled in orchestrator's handleActionRequest
      messageToProcess = 'show more';
    } else if (inputWithAction.actionId && conversationState.pendingActions.length > 0) {
      // Fallback: try to handle via actionId if we have pendingActions
      const foundAction = conversationState.pendingActions.find(a => a.id === inputWithAction.actionId);
      if (foundAction) {
        const { handleActionClick } = await import('../loccitane/actionHandlers');
        // Cast PendingAction to ActionProposal (they're compatible, PendingAction just has less strict type)
        const handlerResult = handleActionClick(
          foundAction as any,
          conversationState,
          input.conversationContext?.lastConstraints || null
        );
        
        if (handlerResult && !handlerResult.shouldContinueToDiscovery) {
          actionHandlerResult = {
            replyText: handlerResult.replyText,
            actions: handlerResult.actions,
          };
        } else if (handlerResult?.shouldContinueToDiscovery && handlerResult.discoveryMessage) {
          messageToProcess = handlerResult.discoveryMessage;
        }
      }
    } else if (
      (input.message.toLowerCase().trim() === 'yes' || 
       input.message.toLowerCase().trim() === 'ok' ||
       input.message.toLowerCase().trim() === 'sure') &&
      conversationState.pendingActions.length > 0
    ) {
      // Map yes/ok/sure to first pending action
      const firstAction = conversationState.pendingActions[0];
      if (firstAction) {
        switch (firstAction.type) {
          case 'show_more':
            messageToProcess = 'show more';
            break;
          default:
            messageToProcess = firstAction.label;
        }
      }
    }
    
    // If action handler provided a conversational response, return it directly
    if (actionHandlerResult) {
      // Save the new actions to conversation state
      if (actionHandlerResult.actions && actionHandlerResult.actions.length > 0) {
        await setPendingActions(merchantId, input.sessionId, actionHandlerResult.actions);
      }
      
      return {
        replyText: actionHandlerResult.replyText,
        productCards: [],
        noExactMatch: true,
        actions: actionHandlerResult.actions,
        route: 'ACTION_REQUEST',
        actionType: inferredActionType || (inputWithAction.actionId 
          ? conversationState.pendingActions.find(a => a.id === inputWithAction.actionId)?.type 
          : undefined),
      };
    }
    
    // Extract last constraints from state or conversation context
    // Priority: conversationContext (frontend) > conversationState.memory (if we stored it there)
    let lastConstraints: SearchConstraints | null = null;
    let lastClassificationConstraints: QueryClassification['constraints'] | null = null;
    if (input.conversationContext?.lastConstraints) {
      lastConstraints = input.conversationContext.lastConstraints;
    } else if (conversationState.memory && typeof conversationState.memory === 'object' && 'lastConstraints' in conversationState.memory) {
      // Fallback: try to get from conversationState.memory if stored
      lastConstraints = (conversationState.memory as any).lastConstraints as SearchConstraints | null;
    }
    
    // Extract last classification constraints from conversation context if available
    if (input.conversationContext && 'lastClassificationConstraints' in input.conversationContext) {
      lastClassificationConstraints = (input.conversationContext as any).lastClassificationConstraints || null;
    }

    // Prepare merchant data for orchestrator
    const merchantData = {
      brandName: merchant.brandName,
      voiceInstructions: merchant.voiceInstructions,
      datasetContext: merchant.datasetContext,
      faq: (merchant.faq as Array<{ question: string; answer: string }> | null) || null,
    };
    
    // Call the LoveShackFancy orchestrator
    const result = await handleLoveshackfancyQuery({
      sessionId: input.sessionId,
      message: messageToProcess,
      lastConstraints,
      lastClassificationConstraints,
      lastShownProductIds: conversationState.shownProductIds.length > 0 
        ? conversationState.shownProductIds 
        : input.conversationContext?.lastShownProductIds,
      merchantId,
      history: input.history,
      onProgress: input.onProgress,
      productContextId: input.productContextId,
      searchMethods: input.searchMethods,
      conversationState,
      merchantData,
    });
    
    // Update conversation state with results
    try {
      const shownProductIds = result.productCards.map(card => card.id);
      if (shownProductIds.length > 0) {
        await appendShownProducts(merchantId, input.sessionId, shownProductIds);
      }
      
      // Store ranked products if we have them (for "show more" functionality)
      // Note: This assumes the orchestrator returns all ranked products
      // For now, we'll store the shown products as the ranked list
      // In the future, the orchestrator could return a full ranked list
      
      logger.debug('assistant_query_complete', {
        merchantId,
        sessionId: input.sessionId,
        productCount: result.productCards.length,
        shownProductCount: conversationState.shownProductIds.length + shownProductIds.length,
      });
    } catch (stateError) {
      // Log but don't fail the request if state update fails
      logger.warn('assistant_query_state_update_failed', {
        merchantId,
        sessionId: input.sessionId,
        error: stateError instanceof Error ? stateError.message : String(stateError),
      });
    }

    return {
      replyText: result.replyText,
      replyTextAfter: result.replyTextAfter, // Second part (after product cards)
      productCards: result.productCards,
      noExactMatch: result.noExactMatch,
      followupText: result.followupText,
      actions: result.actions,
      resolvedConstraints: result.resolvedConstraints ?? lastConstraints ?? undefined,
      resolvedClassificationConstraints: result.resolvedClassificationConstraints,
      usedFollowUpContext: !!lastConstraints && (result.route === 'REFINE' || result.route === 'FOLLOWUP_REFINE'),
      route: result.route,
      actionType: result.actionType,
    };
  } catch (error) {
    logger.error('assistant_query_failed', {
      merchantId,
      sessionId: input.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Example usage in API route:
 * 
 * ```typescript
 * import { handleAssistantQuery } from '@/lib/services/AssistantService';
 * import { requireAuth } from '@/middleware/auth';
 * 
 * export async function POST(request: Request) {
 *   try {
 *     const session = await requireAuth(request);
 *     const body = await request.json();
 *     
 *     const result = await handleAssistantQuery(session.merchantId, {
 *       sessionId: body.sessionId,
 *       pageType: body.pageType || 'HOME',
 *       message: body.message,
 *       history: body.history,
 *       productContextId: body.productContextId,
 *       conversationContext: body.conversationContext,
 *     });
 *     
 *     return NextResponse.json(result);
 *   } catch (error) {
 *     return NextResponse.json({ error: 'Failed to process query' }, { status: 500 });
 *   }
 * }
 * ```
 */

