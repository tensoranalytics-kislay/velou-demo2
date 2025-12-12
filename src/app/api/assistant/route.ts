import { NextRequest, NextResponse } from 'next/server';
import { handleAssistantQuery } from '@/lib/llm/orchestrator';
import type { ConversationContext } from '@/lib/llm/orchestrator';
import type { SearchConstraints } from '@/lib/search/types';
import { recordConversationEvent } from '@/lib/telemetry/metrics';
import { logger } from '@/lib/telemetry/logger';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import { prisma } from '@/lib/db';
import { rateLimitLlm } from '@/lib/rateLimit';
import { env } from '@/lib/config';
import { handleLoccitaneQuery } from '@/lib/loccitane/orchestrator';

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

    // Use optimized L'Occitane pipeline if enabled
    if (env.useLoccitaneOptimizedPipeline && !body.productContextId && body.pageType !== 'PDP') {
      // Get last conversation context from DB for follow-up detection
      const lastEvent = await prisma.conversationEvent.findFirst({
        where: { sessionId: body.sessionId },
        orderBy: { createdAt: 'desc' },
        select: {
          productIds: true,
          userQuery: true,
        },
      });
      
      // Extract last constraints from previous query (simplified)
      let lastConstraints: SearchConstraints | null = null;
      if (body.conversationContext?.lastConstraints) {
        lastConstraints = body.conversationContext.lastConstraints;
      }
      
      const loccitaneResult = await handleLoccitaneQuery({
        sessionId: body.sessionId,
        message: body.message,
        lastConstraints,
        lastShownProductIds: lastEvent?.productIds || body.conversationContext?.lastShownProductIds,
      });
      
      // Convert to expected format
      const result = {
        replyText: loccitaneResult.replyText,
        productCards: loccitaneResult.productCards,
        noExactMatch: loccitaneResult.noExactMatch,
        followupText: loccitaneResult.followupText,
        intent: 'discovery' as const,
        resolvedConstraints: lastConstraints,
        usedFollowUpContext: false,
      };
      
      logger.info('assistant_api_response', {
        sessionId: body.sessionId,
        replyLength: result.replyText.length,
        productCount: result.productCards.length,
        noExactMatch: result.noExactMatch,
        pipeline: 'loccitane_optimized',
      });
      
      // Get default merchant for now (TODO: get from session/auth)
      const defaultMerchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
      if (defaultMerchant) {
        await recordConversationEvent({
          merchantId: defaultMerchant.id,
          sessionId: body.sessionId,
          pageType: body.pageType,
          userQuery: body.message,
          assistantReply: result.replyText,
          productIds: result.productCards.map((card) => card.id),
          hadExactMatch: !result.noExactMatch,
        });
      }
      
      return NextResponse.json(result);
    }
    
    // Original pipeline (for PDP pages, product Q&A, or when flag is disabled)
    // Retrieve DatasetContext from Merchant if not provided in conversationContext
    const datasetContext = body.conversationContext?.datasetContext ?? (await getDatasetContext());
    
    // Merge DatasetContext into conversationContext
    const enrichedConversationContext: ConversationContext | undefined = body.conversationContext
      ? {
          ...body.conversationContext,
          datasetContext: datasetContext ?? body.conversationContext.datasetContext ?? null,
        }
      : datasetContext
        ? { datasetContext }
        : undefined;

    const result = await handleAssistantQuery({
      sessionId: body.sessionId,
      pageType: body.pageType,
      productContextId: body.productContextId,
      message: body.message,
      history: body.history,
      pendingSuggestion: body.pendingSuggestion,
      conversationContext: enrichedConversationContext,
    });

    logger.info('assistant_api_response', {
      sessionId: body.sessionId,
      replyLength: result.replyText.length,
      productCount: result.productCards.length,
      noExactMatch: result.noExactMatch,
      pipeline: 'original',
    });

    // Get default merchant for now (TODO: get from session/auth)
    const defaultMerchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (defaultMerchant) {
      await recordConversationEvent({
        merchantId: defaultMerchant.id,
        sessionId: body.sessionId,
        pageType: body.pageType,
        userQuery: body.message,
        assistantReply: result.replyText,
        productIds: result.productCards.map((card) => card.id),
        hadExactMatch: !result.noExactMatch,
      });
    }

    return NextResponse.json(result);
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

