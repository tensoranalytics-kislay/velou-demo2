import { NextRequest } from 'next/server';
import type { ConversationContext } from '@/lib/llm/types';
import type { SearchConstraints } from '@/lib/search/types';
import { recordConversationEvent } from '@/lib/telemetry/metrics';
import { logger } from '@/lib/telemetry/logger';
import type { ProgressCallback } from '@/lib/llm/types';
import { prisma } from '@/lib/db';
import { rateLimitLlm } from '@/lib/rateLimit';
import { handleAssistantQuery } from '@/lib/services/AssistantService';

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
  actionId?: string; // Optional action ID for action-based queries
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

    // Validate and normalize searchMethods
    let validatedSearchMethods: { lexical: boolean; semantic: boolean; concept: boolean } | undefined;
    if (body.searchMethods) {
      if (
        typeof body.searchMethods === 'object' &&
        typeof body.searchMethods.lexical === 'boolean' &&
        typeof body.searchMethods.semantic === 'boolean' &&
        typeof body.searchMethods.concept === 'boolean'
      ) {
        validatedSearchMethods = body.searchMethods;
      } else {
        logger.warn('assistant_api_stream_invalid_searchMethods', {
          received: body.searchMethods,
          defaultingTo: 'fast',
        });
        validatedSearchMethods = { lexical: false, semantic: true, concept: true }; // Default to fast
      }
    } else {
      // No searchMethods provided, default to fast mode
      validatedSearchMethods = { lexical: false, semantic: true, concept: true };
    }

    logger.info('assistant_api_stream_request', {
      sessionId: body.sessionId,
      pageType: body.pageType,
      message: body.message,
      productContextId: body.productContextId,
      hasProductContext: !!body.productContextId,
      hasPendingSuggestion: !!body.pendingSuggestion,
      searchMethodsReceived: body.searchMethods,
      searchMethodsValidated: validatedSearchMethods,
      searchMethodsLexical: validatedSearchMethods.lexical,
      searchMethodsSemantic: validatedSearchMethods.semantic,
      searchMethodsConcept: validatedSearchMethods.concept,
    });

    // Use LoveShackFancy pipeline for all queries
    {
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
      
      // Extract last classification constraints from previous query
      let lastClassificationConstraints: {
        concerns?: string[];
        skinTypes?: string[];
        hairTypes?: string[];
        applicationAreas?: string[];
        productTypes?: string[];
        collections?: string[];
        priceMinCents?: number;
        priceMaxCents?: number;
        mustHaveIngredients?: string[];
        avoidIngredients?: string[];
        madeWithout?: string[];
        ageGroups?: string[];
        genders?: string[];
      } | null = null;
      if (body.conversationContext?.lastClassificationConstraints) {
        lastClassificationConstraints = body.conversationContext.lastClassificationConstraints;
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
            
            // Get default merchant for product queries and metrics
            // Handle database errors gracefully - don't fail the whole request if merchant lookup fails
            let defaultMerchant = null;
            let merchantId: string | undefined = undefined;
            try {
              defaultMerchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
              merchantId = defaultMerchant?.id;
            } catch (dbError) {
              logger.warn('assistant_api_stream_merchant_lookup_failed', {
                error: dbError instanceof Error ? dbError.message : String(dbError),
              });
              // Continue without merchantId - some queries may still work
            }
            
            if (!merchantId) {
              throw new Error('Merchant not found');
            }
            
            // Detect if this is an action click or typed yes/no
            const hadActionClick = !!body.actionId;
            const messageLower = (body.message || '').toLowerCase().trim();
            const hadTypedYesNo = messageLower === 'yes' || messageLower === 'no' || messageLower === 'ok' || messageLower === 'sure';
            
            const assistantResult = await handleAssistantQuery(merchantId, {
              sessionId: body.sessionId,
              message: body.message || '',
              conversationContext: {
                lastConstraints,
                lastClassificationConstraints,
                lastShownProductIds: lastEvent?.productIds || body.conversationContext?.lastShownProductIds,
              },
              history: body.history,
              onProgress,
              searchMethods: validatedSearchMethods,
              productContextId: body.productContextId,
              actionId: body.actionId, // Pass actionId for action-based queries
            });
            
            // Convert to expected format
            const result = {
              replyText: assistantResult.replyText,
              replyTextAfter: assistantResult.replyTextAfter, // Second part (after product cards)
              productCards: assistantResult.productCards,
              noExactMatch: assistantResult.noExactMatch,
              followupText: assistantResult.followupText,
              actions: assistantResult.actions,
              intent: body.productContextId ? 'pdp_suitability' as const : 'discovery' as const, // Set intent based on product context
              resolvedConstraints: assistantResult.resolvedConstraints ?? lastConstraints ?? undefined,
              resolvedClassificationConstraints: assistantResult.resolvedClassificationConstraints,
              usedFollowUpContext: false,
            };
            
            // Extract route/actionType from result (if available from orchestrator)
            const route = assistantResult.route;
            const actionType = assistantResult.actionType;

            logger.info('assistant_api_stream_response', {
              sessionId: body.sessionId,
              replyLength: result.replyText.length,
              productCount: result.productCards.length,
              noExactMatch: result.noExactMatch,
              pipeline: 'loveshackfancy',
              hasProductContext: !!body.productContextId,
              intent: result.intent,
            });
            
            // Record conversation event (fire-and-forget - non-blocking)
            if (defaultMerchant) {
              recordConversationEvent({
                merchantId: defaultMerchant.id,
                sessionId: body.sessionId,
                pageType: body.pageType,
                userQuery: body.message,
                assistantReply: result.replyText,
                productIds: result.productCards.map((card) => card.id),
                hadExactMatch: !result.noExactMatch,
                route: route,
                actionType: actionType,
                hadActionClick,
                hadTypedYesNo,
              }).catch(err => logger.warn('assistant_api_stream_metrics_failed', {
                error: err instanceof Error ? err.message : String(err),
              }));
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

