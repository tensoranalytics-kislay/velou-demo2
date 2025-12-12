/**
 * POST /api/widget/{merchantId}/assistant/stream
 * 
 * Widget endpoint for sending messages to the assistant with SSE streaming.
 * Requires API key authentication.
 */

import { NextRequest } from 'next/server';
import { requireWidgetAuth, createWidgetAuthErrorResponse, WidgetAuthError } from '@/middleware/widgetAuth';
import { widgetCorsHeaders } from '@/middleware/widgetCors';
import { handleAssistantQuery } from '@/lib/services/AssistantService';
import { trackEvent } from '@/lib/services/AnalyticsService';
import { logger } from '@/lib/telemetry/logger';
import type { ConversationContext } from '@/lib/llm/types';
import type { ProgressCallback } from '@/lib/llm/types';
import type { SearchConstraints } from '@/lib/search/types';

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
 * Handle OPTIONS preflight request
 */
export async function OPTIONS(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    // For OPTIONS, we need to validate the API key to get allowed origins
    const { merchantId } = await params;
    const auth = await requireWidgetAuth(request, merchantId);
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth.apiKey.allowedOrigins);
    
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  } catch (error) {
    // If auth fails, still return CORS headers (browser will handle rejection)
    const origin = request.headers.get('Origin');
    return new Response(null, {
      status: 204,
      headers: widgetCorsHeaders(origin, []),
    });
  }
}

/**
 * POST handler - Stream assistant response via SSE
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  const startTime = Date.now();
  let auth: Awaited<ReturnType<typeof requireWidgetAuth>> | null = null;
  let merchantId: string | undefined;

  try {
    // Authenticate request
    const resolvedParams = await params;
    merchantId = resolvedParams.merchantId;
    auth = await requireWidgetAuth(request, merchantId);
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth.apiKey.allowedOrigins);

    // Parse request body
    const body = (await request.json()) as AssistantApiRequest;

    // Validate required fields
    if (!body.message || typeof body.message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Session ID is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    // Validate history if provided
    if (body.history && !Array.isArray(body.history)) {
      return new Response(
        JSON.stringify({ error: 'Invalid history payload' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }

    // Validate pendingSuggestion if provided
    if (body.pendingSuggestion) {
      if (
        !Array.isArray(body.pendingSuggestion.candidateIds) ||
        body.pendingSuggestion.candidateIds.some((id) => typeof id !== 'string')
      ) {
        return new Response(
          JSON.stringify({ error: 'Invalid pendingSuggestion payload' }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }
    }

    logger.info('widget_assistant_stream_request', {
      merchantId,
      sessionId: body.sessionId,
      pageType: body.pageType,
      messageLength: body.message.length,
      hasHistory: !!body.history,
      hasPendingSuggestion: !!body.pendingSuggestion,
    });

    // Create a readable stream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Helper to send SSE message
        const sendProgress = (stage: string, progress: number, queryType?: string) => {
          const data = JSON.stringify({ type: 'progress', stage, progress, queryType });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        // Create progress callback
        // Note: ProgressCallback only takes (stage, progress), but we track queryType separately
        const onProgress: ProgressCallback = (stage, progress) => {
          // QueryType is determined by the orchestrator, we'll include it in the response
          sendProgress(stage, progress);
        };

        try {
          // Call assistant service
          // merchantId is guaranteed to be defined here since we're inside the try block after auth
          const result = await handleAssistantQuery(merchantId!, {
            sessionId: body.sessionId,
            pageType: body.pageType,
            productContextId: body.productContextId,
            message: body.message,
            history: body.history,
            conversationContext: body.conversationContext,
            onProgress,
          });

    logger.info('widget_assistant_stream_response', {
      merchantId: merchantId!,
            sessionId: body.sessionId,
            replyLength: result.replyText.length,
            productCount: result.productCards.length,
            noExactMatch: result.noExactMatch,
          });

          // Track analytics event (fire and forget)
          trackEvent(merchantId!, {
            sessionId: body.sessionId,
            eventType: 'message_sent',
            payload: {
              pageType: body.pageType,
              messageLength: body.message.length,
              productCount: result.productCards.length,
              hadExactMatch: !result.noExactMatch,
            },
            userDevice: request.headers.get('User-Agent') || null,
            userPage: request.headers.get('Referer') || null,
            userReferer: request.headers.get('Referer') || null,
          }).catch((error) => {
            // Silently fail - analytics should never block responses
            logger.warn('widget_analytics_track_failed', {
              merchantId: merchantId!,
              error: error instanceof Error ? error.message : String(error),
            });
          });

          // Send final result
          const finalData = JSON.stringify({ type: 'response', response: result });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          controller.close();
        } catch (error) {
    logger.error('widget_assistant_stream_error', {
      merchantId,
            sessionId: body.sessionId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });

          // Send error response
          const errorData = JSON.stringify({
            type: 'error',
            error: {
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

    const duration = Date.now() - startTime;
    logger.info('widget_assistant_stream_complete', {
      merchantId: merchantId!,
      duration,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_assistant_stream_auth_failed', {
        merchantId: merchantId ?? 'unknown',
        status: error.status,
        duration,
      });
      return createWidgetAuthErrorResponse(error);
    }

    logger.error('widget_assistant_stream_setup_error', {
      merchantId: merchantId ?? 'unknown',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
    });

    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth?.apiKey.allowedOrigins || []);

    return new Response(
      JSON.stringify({
        error: 'Failed to process request',
        replyText: 'Our assistant is temporarily unavailable. Please try again or use the filters and search.',
        productCards: [],
        noExactMatch: true,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      }
    );
  }
}

