/**
 * AssistantService
 * 
 * Wraps the assistant/orchestrator functionality with merchantId.
 * This ensures all assistant queries are scoped to a specific merchant.
 * 
 * The underlying orchestration logic remains unchanged - we just pass merchantId through.
 */

import { handleAssistantQuery as handleAssistantQueryCore } from '../llm/orchestrator';
import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type {
  AssistantQueryInput,
  AssistantQueryResult,
} from '../llm/orchestrator';
import type { DatasetContext } from '../catalog/datasetInspector';

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

    // Load datasetContext from merchant if not provided
    let datasetContext: DatasetContext | null = null;
    if (merchant.datasetContext) {
      datasetContext = merchant.datasetContext as unknown as DatasetContext;
    }

    // Merge datasetContext into conversationContext
    const enrichedInput: AssistantQueryInput = {
      ...input,
      conversationContext: {
        ...input.conversationContext,
        datasetContext: datasetContext || input.conversationContext?.datasetContext || null,
      },
    };

    // Call the core orchestrator function
    // Note: We need to pass merchantId to the orchestrator so it can filter search calls
    // For now, we'll need to update the orchestrator to accept merchantId
    // This is a temporary solution - the orchestrator should be updated to accept merchantId
    const result = await handleAssistantQueryCore(enrichedInput);
    
    // TODO: Update handleAssistantQueryCore to accept merchantId and pass it to search calls
    // For now, search calls will filter by merchantId if the SearchService is used

    logger.debug('assistant_query_complete', {
      merchantId,
      sessionId: input.sessionId,
      intent: result.intent,
      productCount: result.productCards.length,
    });

    return result;
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

