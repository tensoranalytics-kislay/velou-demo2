import { handleAssistantQuery } from '@/lib/llm/orchestrator';
import type { ConversationContext } from '@/lib/llm/orchestrator';
import type { SearchConstraints } from '@/lib/search/types';
import { recordConversationEvent } from '@/lib/telemetry/metrics';
import { logger } from '@/lib/telemetry/logger';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import type { ProgressCallback } from '@/lib/llm/orchestrator/progress';

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

/**
 * POST /api/assistant/stream
 * 
 * Streams progress updates via Server-Sent Events (SSE) and returns final result
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AssistantApiRequest;

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
    });

    // Retrieve DatasetContext from BrandConfig if not provided in conversationContext
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

          await recordConversationEvent({
            sessionId: body.sessionId,
            pageType: body.pageType,
            userQuery: body.message,
            assistantReply: result.replyText,
            productIds: result.productCards.map((card) => card.id),
            hadExactMatch: !result.noExactMatch,
          });

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
    logger.error('assistant_api_stream_setup_error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({
        error: 'Failed to setup stream',
        replyText: 'Our assistant is temporarily unavailable. Please try again or use the filters and search.',
        productCards: [],
        noExactMatch: true,
      }),
      { status: 500 },
    );
  }
}

