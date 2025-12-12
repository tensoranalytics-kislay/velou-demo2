/**
 * GET /api/widget/{merchantId}/suggestions?lastMessage=...
 * 
 * Returns context-aware suggested prompts for the chat widget.
 * Requires API key authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWidgetAuth, createWidgetAuthErrorResponse, WidgetAuthError } from '@/middleware/widgetAuth';
import { widgetCorsHeaders } from '@/middleware/widgetCors';
import { getCatalogOntology } from '@/lib/search/ontology';
import { prisma } from '@/lib/db';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import { logger } from '@/lib/telemetry/logger';

// Import helper functions from the main suggestions route
// (These would ideally be extracted to a shared utility, but for now we'll duplicate the logic)

function stripFillerPhrases(prompt: string): string {
  if (!prompt) return prompt;
  
  let cleaned = prompt.trim();
  cleaned = cleaned.replace(/[.,;!?]+$/, '').trim();
  
  const fillerPatterns = [
    /^show\s+me\s+/i,
    /^what\s+are\s+(the\s+)?(best|top|good|available|recommended)\s+/i,
    /^which\s+(are\s+)?(the\s+)?(best|top|good|available|recommended)\s+/i,
    /^ask\s+for\s+(a\s+)?/i,
    /^search\s+for\s+/i,
    /^look\s+for\s+/i,
    /^looking\s+for\s+/i,
    /^find\s+(me\s+)?(a\s+)?/i,
    /^get\s+me\s+(a\s+)?/i,
    /^give\s+me\s+(a\s+)?/i,
    /^i\s+want\s+(a\s+)?/i,
    /^i\s+need\s+(a\s+)?/i,
    /^i'm\s+looking\s+for\s+(a\s+)?/i,
    /^i\s+am\s+looking\s+for\s+(a\s+)?/i,
    /^can\s+you\s+(find|show|get|give)\s+(me\s+)?(a\s+)?/i,
    /^help\s+me\s+find\s+(a\s+)?/i,
    /^list\s+(me\s+)?(all\s+)?/i,
    /^tell\s+me\s+(about\s+)?/i,
    /^what\s+(do\s+you\s+have\s+)?(for\s+)?/i,
    /^which\s+(ones?\s+)?(do\s+you\s+have\s+)?(for\s+)?/i,
    /^(all\s+)?(the\s+)?/i,
  ];
  
  let maxIterations = 10;
  let changed = true;
  while (changed && maxIterations > 0) {
    const beforeLength = cleaned.length;
    for (const pattern of fillerPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    changed = cleaned.length < beforeLength;
    maxIterations--;
  }
  
  cleaned = cleaned.replace(/\s+(please|thanks|thank\s+you|or\s+refine)$/i, '').trim();
  cleaned = cleaned.replace(/^(the|a|an)\s+/i, '').trim();
  
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

function formatPrompt(prompt: string): string {
  let formatted = prompt.trim();
  formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
  formatted = formatted.replace(/\bi\b/g, 'I');
  return formatted;
}

/**
 * Handle OPTIONS preflight request
 */
export async function OPTIONS(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
  try {
    const { merchantId } = await params;
    const auth = await requireWidgetAuth(request, merchantId);
    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth.apiKey.allowedOrigins);
    
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  } catch (error) {
    const origin = request.headers.get('Origin');
    return new Response(null, {
      status: 204,
      headers: widgetCorsHeaders(origin, []),
    });
  }
}

/**
 * GET handler
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ merchantId: string }> }) {
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

    const searchParams = request.nextUrl.searchParams;
    const lastMessage = searchParams.get('lastMessage');

    // Get dataset context for this merchant
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId! },
      select: {
        datasetContext: true,
      },
    });

    const datasetContext = (merchant?.datasetContext || await getDatasetContext()) as any;
    const recommendedExamples = datasetContext?.recommendedSearchExamples ?? [];

    // If no lastMessage and we have recommended examples, return those
    if (!lastMessage && recommendedExamples.length > 0) {
      const cleaned = recommendedExamples.map(stripFillerPhrases).filter((p: string) => p.length > 0);
      const unique = Array.from(new Set(cleaned)).slice(0, 5);
      
      const duration = Date.now() - startTime;
      logger.info('widget_suggestions_success', {
        merchantId: merchantId!,
        duration,
        count: unique.length,
        source: 'recommended_examples',
      });

      return NextResponse.json(
        { suggestions: unique },
        {
          headers: corsHeaders,
        }
      );
    }

    // For follow-up suggestions (with lastMessage), use simplified logic
    // In a full implementation, this would call the LLM like the main route does
    // For now, return dataset-aware defaults
    const suggestions: string[] = [];

    if (recommendedExamples.length > 0) {
      suggestions.push(
        ...recommendedExamples
          .map(stripFillerPhrases)
          .filter((p: string) => p.length > 0)
          .slice(0, 3)
      );
    }

    // Fallback to generic suggestions
    if (suggestions.length === 0) {
      suggestions.push('popular items', 'best sellers', 'featured products');
    }

    const cleaned = suggestions.map(stripFillerPhrases).filter(p => p.length > 0);
    const formatted = cleaned.map(formatPrompt);
    const uniqueSuggestions = Array.from(new Set(formatted)).slice(0, 3);

    const duration = Date.now() - startTime;
    logger.info('widget_suggestions_success', {
      merchantId: merchantId!,
      duration,
      count: uniqueSuggestions.length,
      hasLastMessage: !!lastMessage,
    });

    return NextResponse.json(
      { suggestions: uniqueSuggestions },
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_suggestions_auth_failed', {
        merchantId: merchantId!,
        status: error.status,
        duration,
      });
      return createWidgetAuthErrorResponse(error);
    }

    logger.error('widget_suggestions_error', {
      merchantId: merchantId!,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth?.apiKey.allowedOrigins || []);

    return NextResponse.json(
      { suggestions: ['popular items', 'best sellers', 'featured products'] },
      {
        headers: corsHeaders,
      }
    );
  }
}

