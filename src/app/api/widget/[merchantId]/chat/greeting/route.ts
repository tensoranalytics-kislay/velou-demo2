/**
 * GET /api/widget/{merchantId}/chat/greeting
 * 
 * Returns dataset-aware greeting text for the chat widget.
 * Requires API key authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWidgetAuth, createWidgetAuthErrorResponse, WidgetAuthError } from '@/middleware/widgetAuth';
import { widgetCorsHeaders } from '@/middleware/widgetCors';
import { prisma } from '@/lib/db';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import { logger } from '@/lib/telemetry/logger';

function formatExampleList(examples: string[]): string {
  const cleaned = examples
    .map((example) => example.replace(/[.;!]+$/g, '').trim())
    .filter(Boolean);

  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} or ${cleaned[1]}`;

  const allButLast = cleaned.slice(0, -1).join(', ');
  return `${allButLast}, or ${cleaned[cleaned.length - 1]}`;
}

/**
 * Build greeting from dataset context
 */
function buildGreetingFromContext(options: {
  brandName: string;
  vertical?: string | null;
  primaryFacets?: string[] | null;
  sampleCategories?: string[] | null;
  recommendedSearchExamples?: string[] | null;
}): string {
  const { brandName, vertical, primaryFacets, sampleCategories, recommendedSearchExamples } = options;
  const safeBrand = brandName || 'our store';
  const v = vertical?.toLowerCase().trim();
  const facets = primaryFacets?.map((f) => f.trim()).filter(Boolean) ?? [];
  const samples = sampleCategories?.map((c) => c.trim()).filter(Boolean) ?? [];
  const examples = recommendedSearchExamples?.map((e) => e.trim()).filter(Boolean) ?? [];

  const topFacets = facets.slice(0, 3).join(', ');
  const hasFacets = facets.length > 0;
  const hasExamples = examples.length > 0;
  const exampleSnippet = hasExamples ? formatExampleList(examples.slice(0, 2)) : null;

  if (v === 'skincare' || v === 'beauty') {
    if (hasExamples) {
      return `Hey there, I'm ${safeBrand}'s beauty assistant. Tell me your skin type, concern, or budget. For example: ${exampleSnippet} and I'll surface the best fits from our catalog.`;
    }
    return `Hey there, I'm ${safeBrand}'s beauty assistant. Tell me your skin type, concerns, or budget and I'll help you find the right products.`;
  }

  if (v === 'home' || v?.includes('decor') || v === 'furniture') {
    const roomHint = samples.slice(0, 2).join(' or ') || 'living room or bedroom';
    return `Hey there, I'm ${safeBrand}'s home assistant. Tell me the room, such as ${roomHint}, plus the style or budget and I'll pull pieces that match.`;
  }

  if (v === 'apparel' || v === 'fashion') {
    const facetHint = hasFacets ? topFacets : 'fit, style, or budget';
    return `Hey there, I'm ${safeBrand}'s Product Advisor. Share the occasion, ${facetHint}, or price point and I'll curate looks from our catalog.`;
  }

  if (hasExamples) {
    return `Hey there, I'm ${safeBrand}'s shopping assistant. Tell me what you're looking for. For example: ${exampleSnippet} and I'll help you find strong options.`;
  }

  if (hasFacets) {
    return `Hey there, I'm ${safeBrand}'s shopping assistant. Tell me what you're looking for using facets like ${topFacets}, and I'll surface the best matches from our catalog.`;
  }

  return `Hey there, I'm ${safeBrand}'s shopping assistant. Tell me what you're looking for and I'll help you find the perfect products from our catalog.`;
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

    // Get merchant and dataset context
    const [merchant, datasetContext] = await Promise.all([
      prisma.merchant.findUnique({
        where: { id: merchantId },
        select: {
          brandName: true,
          datasetContext: true,
        },
      }),
      getDatasetContext(),
    ]);

    if (!merchant) {
      logger.warn('widget_greeting_merchant_not_found', {
        merchantId: merchantId!,
      });
      return NextResponse.json(
        { error: 'Merchant not found' },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    const brandName = merchant.brandName || 'our store';
    const datasetCtx = (merchant.datasetContext || datasetContext) as any;

    const greeting = buildGreetingFromContext({
      brandName,
      vertical: datasetCtx?.vertical,
      primaryFacets: datasetCtx?.primaryFacets ?? null,
      sampleCategories: datasetCtx?.sampleCategories ?? null,
      recommendedSearchExamples: datasetCtx?.recommendedSearchExamples ?? null,
    });

    const duration = Date.now() - startTime;
    logger.info('widget_greeting_success', {
      merchantId: merchantId!,
      duration,
    });

    return NextResponse.json(
      { greeting },
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_greeting_auth_failed', {
        merchantId: merchantId ?? 'unknown',
        status: error.status,
        duration,
      });
      return createWidgetAuthErrorResponse(error);
    }

    logger.error('widget_greeting_error', {
      merchantId: merchantId ?? 'unknown',
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth?.apiKey.allowedOrigins || []);

    return NextResponse.json(
      {
        greeting:
          "Hey there, I'm your shopping assistant. Tell me what you're looking for and I'll help you find the perfect products from our catalog.",
      },
      {
        headers: corsHeaders,
      }
    );
  }
}

