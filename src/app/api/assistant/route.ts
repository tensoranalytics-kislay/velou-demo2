import { NextRequest, NextResponse } from 'next/server';
import type { ConversationContext } from '@/lib/llm/types';
import type { SearchConstraints } from '@/lib/search/types';
import { recordConversationEvent } from '@/lib/telemetry/metrics';
import { logger } from '@/lib/telemetry/logger';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import { prisma } from '@/lib/db';
import { rateLimitLlm } from '@/lib/rateLimit';
import { env } from '@/lib/config';
import { handleAssistantQuery } from '@/lib/services/AssistantService';
// Pre-warm concept index cache on server startup
import '@/lib/search/concept/init';

type AssistantApiRequest = {
  sessionId: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pendingSuggestion?: {
    constraints: SearchConstraints;
    candidateIds: string[];
  };
  conversationContext?: ConversationContext;
  actionId?: string; // Optional action ID for action-based queries
};

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Rate limiting for LLM endpoints
    const rateLimitResult = await rateLimitLlm(request);
    if (!rateLimitResult.success) {
      return rateLimitResult.response!;
    }
    
    const body = (await request.json()) as AssistantApiRequest;

    if (body.history && !Array.isArray(body.history)) {
      return NextResponse.json({ error: 'Invalid history payload' }, { status: 400 });
    }

    if (body.pendingSuggestion) {
      if (
        !Array.isArray(body.pendingSuggestion.candidateIds) ||
        body.pendingSuggestion.candidateIds.some((id) => typeof id !== 'string')
      ) {
        return NextResponse.json({ error: 'Invalid pendingSuggestion payload' }, { status: 400 });
      }
    }

    logger.info('assistant_api_request', {
      sessionId: body.sessionId,
      pageType: body.pageType,
      message: body.message,
      productContextId: body.productContextId,
      hasPendingSuggestion: !!body.pendingSuggestion,
    });

    // Get default merchant for now (TODO: get from session/auth)
    const defaultMerchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!defaultMerchant) {
      return NextResponse.json(
        {
          replyText: 'Merchant not found. Please configure a default merchant.',
          productCards: [],
          noExactMatch: true,
        },
        { status: 500 }
      );
    }

    // Use AssistantService which wraps the LoveShackFancy orchestrator
    const result = await handleAssistantQuery(defaultMerchant.id, {
      sessionId: body.sessionId,
      pageType: body.pageType,
      message: body.message,
      history: body.history,
      productContextId: body.productContextId,
      conversationContext: body.conversationContext,
      actionId: body.actionId,
    });

    logger.info('assistant_api_response', {
      sessionId: body.sessionId,
      replyLength: result.replyText.length,
      productCount: result.productCards.length,
      noExactMatch: result.noExactMatch,
      pipeline: 'loveshackfancy',
    });

    // Record conversation event (fire-and-forget - non-blocking)
    recordConversationEvent({
      merchantId: defaultMerchant.id,
      sessionId: body.sessionId,
      pageType: body.pageType,
      userQuery: body.message,
      assistantReply: result.replyText,
      productIds: result.productCards.map((card) => card.id),
      hadExactMatch: !result.noExactMatch,
    }).catch(err => {
      // Log but don't fail the request if metrics recording fails
      logger.warn('assistant_api_metrics_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json({
      replyText: result.replyText,
      productCards: result.productCards,
      noExactMatch: result.noExactMatch,
      followupText: result.followupText,
      actions: result.actions,
      intent: 'discovery' as const,
      resolvedConstraints: result.resolvedConstraints,
      usedFollowUpContext: result.usedFollowUpContext || false,
    });
  } catch (error) {
    logger.error('assistant_api_error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        replyText:
          'Our assistant is temporarily unavailable. Please try again or use the filters and search.',
        productCards: [],
        noExactMatch: true,
      },
      { status: 500 },
    );
  }
}

