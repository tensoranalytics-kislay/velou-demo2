/**
 * GET /api/widget/{merchantId}/chat/placeholder
 * 
 * Returns dataset-aware placeholder text for the chat input field.
 * Requires API key authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireWidgetAuth, createWidgetAuthErrorResponse, WidgetAuthError } from '@/middleware/widgetAuth';
import { widgetCorsHeaders } from '@/middleware/widgetCors';
import { prisma } from '@/lib/db';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import { callLLM, type LlmMessage } from '@/lib/llm/provider';
import { logger } from '@/lib/telemetry/logger';

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
      logger.warn('widget_placeholder_merchant_not_found', {
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
    const vertical = datasetCtx?.vertical ?? 'products';
    const primaryFacets = datasetCtx?.primaryFacets ?? [];
    const sampleCategories = datasetCtx?.sampleCategories ?? [];
    const recommendedExamples = datasetCtx?.recommendedSearchExamples ?? [];

    // Try LLM generation first
    try {
      const contextLines: string[] = [
        `Brand name: ${brandName}`,
        `Vertical: ${vertical}`,
      ];

      if (primaryFacets.length) {
        contextLines.push(`Primary facets: ${primaryFacets.join(', ')}`);
      }
      if (sampleCategories.length) {
        contextLines.push(`Sample categories: ${sampleCategories.slice(0, 5).join(', ')}`);
      }
      if (recommendedExamples.length) {
        contextLines.push(`Example searches: ${recommendedExamples.slice(0, 3).join(' | ')}`);
      }

      const systemPrompt = [
        'You are a helpful shopping assistant. Generate a SHORT placeholder text for a chat input box.',
        'The placeholder should:',
        '- Suggest what users can ask for, using real examples from the catalog',
        '- Reference actual categories, facets, or example searches when available',
        '- Be concise (max 60 characters)',
        '- Use natural language (e.g., "Ask for..." or "Search for...")',
        '- Avoid markdown, bullets, or special characters',
        '- Be industry-agnostic and dataset-driven',
        '',
        'Examples:',
        '- "Ask for vegan body scrub under $40 or citrus shampoo..."',
        '- "Search for hand cream, face serum, or gift sets..."',
        '- "Find products by category, price, or benefits..."',
      ].join('\n');

      const userContent = [
        'Here is context about the catalog:',
        contextLines.join('\n'),
        '',
        'Generate a short, helpful placeholder text for the chat input box.',
      ].join('\n');

      const messages: LlmMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

      const result = await callLLM({
        messages,
        purpose: 'greeting',
        expectJson: false,
      });

      const text = result.rawText.trim();
      if (text.length && text.length <= 80) {
        const duration = Date.now() - startTime;
        logger.info('widget_placeholder_success', {
          merchantId: merchantId!,
          duration,
          source: 'llm',
        });

        return NextResponse.json(
          { placeholder: text },
          {
            headers: corsHeaders,
          }
        );
      }
    } catch (error) {
      logger.warn('widget_placeholder_llm_failed', {
        merchantId: merchantId!,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to deterministic placeholder
    }

    // Deterministic fallback based on dataset context
    const facets = primaryFacets.slice(0, 3).join(', ');
    const examples = recommendedExamples.slice(0, 2).join(' or ');

    let placeholder = 'Ask for products...';

    if (examples) {
      placeholder = `Ask for ${examples}...`;
    } else if (sampleCategories.length) {
      const cats = sampleCategories.slice(0, 2).join(' or ');
      placeholder = `Search for ${cats}...`;
    } else if (facets) {
      placeholder = `Find products by ${facets}...`;
    } else if (vertical) {
      placeholder = `Search for ${vertical} products...`;
    }

    const duration = Date.now() - startTime;
    logger.info('widget_placeholder_success', {
          merchantId: merchantId!,
      duration,
      source: 'fallback',
    });

    return NextResponse.json(
      { placeholder },
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof WidgetAuthError) {
      logger.warn('widget_placeholder_auth_failed', {
        merchantId: merchantId!,
        status: error.status,
        duration,
      });
      return createWidgetAuthErrorResponse(error);
    }

    logger.error('widget_placeholder_error', {
          merchantId: merchantId!,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    const origin = request.headers.get('Origin');
    const corsHeaders = widgetCorsHeaders(origin, auth?.apiKey.allowedOrigins || []);

    return NextResponse.json(
      { placeholder: 'Ask for products...' },
      {
        headers: corsHeaders,
      }
    );
  }
}

