/**
 * AssistantService
 * 
 * Wraps the fast path (L'Occitane orchestrator) with merchantId.
 * This ensures all assistant queries are scoped to a specific merchant.
 */

import { handleLoccitaneQuery } from '../loccitane/orchestrator';
import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';
import type { ConversationContext, QueryStage, ProgressCallback } from '../llm/types';
import type { ProductCard } from '../llm/orchestrator/cards';

export type AssistantQueryInput = {
  sessionId: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
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
};

export type AssistantQueryResult = {
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  intent?: string;
  resolvedConstraints?: SearchConstraints;
  usedFollowUpContext?: boolean;
  followupText?: string;
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
    // Verify merchant exists
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        datasetContext: true,
      },
    });

    if (!merchant) {
      logger.warn('assistant_merchant_not_found', { merchantId });
      throw new Error('Merchant not found');
    }

    // Get last conversation context from DB for follow-up detection
    const lastEvent = await prisma.conversationEvent.findFirst({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: 'desc' },
      select: {
        productIds: true,
        userQuery: true,
      },
    });
    
    // Extract last constraints from previous query
    let lastConstraints: SearchConstraints | null = null;
    if (input.conversationContext?.lastConstraints) {
      lastConstraints = input.conversationContext.lastConstraints;
    }

    // Call the fast path orchestrator
    const result = await handleLoccitaneQuery({
      sessionId: input.sessionId,
      message: input.message,
      lastConstraints,
      lastShownProductIds: lastEvent?.productIds || input.conversationContext?.lastShownProductIds,
      merchantId,
      history: input.history,
      onProgress: input.onProgress,
      searchMethods: input.searchMethods, // Pass through searchMethods
    });
    
    logger.debug('assistant_query_complete', {
      merchantId,
      sessionId: input.sessionId,
      productCount: result.productCards.length,
    });

    return {
      replyText: result.replyText,
      productCards: result.productCards,
      noExactMatch: result.noExactMatch,
      followupText: result.followupText,
      resolvedConstraints: lastConstraints ?? undefined,
      usedFollowUpContext: false,
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

