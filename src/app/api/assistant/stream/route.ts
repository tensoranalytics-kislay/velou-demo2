import { NextRequest } from 'next/server';
import { handleAssistantQuery } from '@/lib/llm/orchestrator';
import type { ConversationContext } from '@/lib/llm/orchestrator';
import type { SearchConstraints } from '@/lib/search/types';
import { recordConversationEvent } from '@/lib/telemetry/metrics';
import { logger } from '@/lib/telemetry/logger';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import type { ProgressCallback } from '@/lib/llm/orchestrator/progress';
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
  searchMethods?: {
    lexical: boolean;
    semantic: boolean;
    concept: boolean;
  };
};

/**
 * POST /api/assistant/stream
 * 
 * Streams progress updates via Server-Sent Events (SSE) and returns final result
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Rate limiting for LLM endpoints
    const rateLimitResult = await rateLimitLlm(request);
    if (!rateLimitResult.success) {
      return rateLimitResult.response!;
    }
    
    let body: AssistantApiRequest;
    try {
      body = (await request.json()) as AssistantApiRequest;
    } catch (jsonError) {
      logger.error('assistant_api_stream_json_parse_error', {
        error: jsonError instanceof Error ? jsonError.message : String(jsonError),
      });
      return new Response(
        JSON.stringify({
          error: 'Invalid JSON in request body',
          replyText: 'Our assistant is temporarily unavailable. Please try again.',
          productCards: [],
          noExactMatch: true,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (body.history && !Array.isArray(body.history)) {
      return new Response(JSON.stringify({ error: 'Invalid history payload' }), { status: 400 });
    }

    if (body.pendingSuggestion) {
      if (
        !Array.isArray(body.pendingSuggestion.candidateIds) ||
        body.pendingSuggestion.candidateIds.some((id) => typeof id !== 'string')
      ) {
        return new Response(JSON.stringify({ error: 'Invalid pendingSuggestion payload' }), { status: 400 });
      }
    }

    logger.info('assistant_api_stream_request', {
      sessionId: body.sessionId,
      pageType: body.pageType,
      message: body.message,
      productContextId: body.productContextId,
      hasPendingSuggestion: !!body.pendingSuggestion,
      searchMethods: body.searchMethods,
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

      // Create a readable stream for SSE
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          // Helper to send SSE message
          const sendProgress = (stage: string, progress: number) => {
            const data = JSON.stringify({ type: 'progress', stage, progress });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          };

          try {
            // Create progress callback for L'Occitane pipeline
            const onProgress: ProgressCallback = (stage, progress) => {
              sendProgress(stage, progress);
            };
            
            const loccitaneResult = await handleLoccitaneQuery({
              sessionId: body.sessionId,
              message: body.message,
              lastConstraints,
              lastShownProductIds: lastEvent?.productIds || body.conversationContext?.lastShownProductIds,
              onProgress,
              searchMethods: body.searchMethods || { lexical: true, semantic: true, concept: true },
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

            logger.info('assistant_api_stream_response', {
              sessionId: body.sessionId,
              replyLength: result.replyText.length,
              productCount: result.productCards.length,
              noExactMatch: result.noExactMatch,
              pipeline: 'loccitane_optimized',
            });
            
            // Get default merchant for now
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

            // Send final result
            const finalData = JSON.stringify({ type: 'result', data: result });
            controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
            controller.close();
          } catch (error) {
            logger.error('assistant_api_stream_error', {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });

            const errorData = JSON.stringify({
              type: 'error',
              data: {
                replyText: 'Our assistant is temporarily unavailable. Please try again or use the filters and search.',
                productCards: [],
                noExactMatch: true,
              },
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
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

    // Create a readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Helper to send SSE message
        const sendProgress = (stage: string, progress: number) => {
          const data = JSON.stringify({ type: 'progress', stage, progress });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        // Create progress callback
        const onProgress: ProgressCallback = (stage, progress) => {
          sendProgress(stage, progress);
        };

        try {
          const result = await handleAssistantQuery({
            sessionId: body.sessionId,
            pageType: body.pageType,
            productContextId: body.productContextId,
            message: body.message,
            history: body.history,
            pendingSuggestion: body.pendingSuggestion,
            conversationContext: enrichedConversationContext,
            onProgress,
          });

          logger.info('assistant_api_stream_response', {
            sessionId: body.sessionId,
            replyLength: result.replyText.length,
            productCount: result.productCards.length,
            noExactMatch: result.noExactMatch,
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

          // Send final result
          const finalData = JSON.stringify({ type: 'result', data: result });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          controller.close();
        } catch (error) {
          logger.error('assistant_api_stream_error', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });

          const errorData = JSON.stringify({
            type: 'error',
            data: {
              replyText: 'Our assistant is temporarily unavailable. Please try again or use the filters and search.',
              productCards: [],
              noExactMatch: true,
            },
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error('assistant_api_stream_setup_error', {
      error: errorMessage,
      stack: errorStack,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
    
    // Return a proper error response
    return new Response(
      JSON.stringify({
        error: 'Failed to setup stream',
        message: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        replyText: 'Our assistant is temporarily unavailable. Please try again or use the filters and search.',
        productCards: [],
        noExactMatch: true,
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      },
    );
  }
}

