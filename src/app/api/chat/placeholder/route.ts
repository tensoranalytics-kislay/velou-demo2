import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';
import { callLLM, type LlmMessage } from '@/lib/llm/provider';
import { logger } from '@/lib/telemetry/logger';

/**
 * GET /api/chat/placeholder
 * Returns an LLM-generated placeholder text for the chat input box.
 * The placeholder is dataset-aware and adapts to the current catalog.
 */
export async function GET() {
  try {
    const [merchant, datasetContext] = await Promise.all([
      prisma.merchant.findUnique({ where: { slug: 'default' } }),
      getDatasetContext(),
    ]);

    const brandName = merchant?.brandName || 'our store';
    const vertical = datasetContext?.vertical ?? 'products';
    const primaryFacets = datasetContext?.primaryFacets ?? [];
    const sampleCategories = datasetContext?.sampleCategories ?? [];
    const recommendedExamples = datasetContext?.recommendedSearchExamples ?? [];

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
        return NextResponse.json({ placeholder: text });
      }
    } catch (error) {
      logger.warn('placeholder_llm_failed', {
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

    return NextResponse.json({ placeholder });
  } catch (error) {
    logger.error('failed_to_generate_placeholder', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      placeholder: 'Ask for products...',
    });
  }
}

