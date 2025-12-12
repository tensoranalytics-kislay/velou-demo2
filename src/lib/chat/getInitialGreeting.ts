/**
 * Generate dataset-aware initial greeting for the chat assistant.
 *
 * Behavior:
 * - Uses DatasetContext + brand config to build a short prompt.
 * - Calls the LLM to generate a fresh greeting every time.
 * - Falls back to a deterministic, dataset-aware greeting if the LLM fails.
 */

import { prisma } from '../db';
import { getDatasetContext } from '../catalog/getDatasetContext';
import { logger } from '../telemetry/logger';
import { callLLM, type LlmMessage, LLMError } from '../llm/provider';

type DatasetContextType = Awaited<ReturnType<typeof getDatasetContext>>;

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function buildDeterministicGreetingOptions(
  brandName: string,
  datasetContext: DatasetContextType,
): string[] {
  const vertical = datasetContext?.vertical?.toLowerCase().trim();
  const facets = datasetContext?.primaryFacets?.map((f) => f.trim()).filter(Boolean) ?? [];
  const sampleCategories = datasetContext?.sampleCategories?.map((c) => c.trim()).filter(Boolean) ?? [];
  const recommended = datasetContext?.recommendedSearchExamples?.map((r) => r.trim()).filter(Boolean) ?? [];
  const topFacetSnippet = facets.length > 0 ? facets.slice(0, 3).join(', ') : null;
  const sampleCategorySnippet = sampleCategories.length > 0 ? sampleCategories.slice(0, 2).join(' or ') : null;
  const exampleSnippet = recommended.length > 0 ? recommended.slice(0, 2).join(' • ') : null;

  // Vertical-specific templates
  if (vertical === 'skincare' || vertical === 'beauty') {
    return [
      `Hi! I'm ${brandName}'s beauty assistant. Tell me your skin type, concerns, or budget and I'll surface the best fits from our catalog.`,
      `Welcome to ${brandName}! Share the concern, texture, or price point you're after and I'll curate skincare you'll love.`,
      `You're chatting with ${brandName}'s skincare guide. Whether it's ${topFacetSnippet ?? 'skin concerns'} or ${exampleSnippet ?? 'texture preferences'}, I can zero in on the right formulas.`,
    ];
  }

  if (vertical === 'home' || vertical?.includes('decor') || vertical === 'furniture') {
    return [
      `Hey there—I'm ${brandName}'s home assistant. Tell me the room, style, or budget and I'll pull items that match.`,
      `Welcome! I'm here to help you outfit your space. Just share the vibe—${topFacetSnippet ?? 'color, material, size'}—and I'll suggest standouts.`,
      `Looking for fresh pieces? I'm ${brandName}'s decor guide. Let me know if it's for ${sampleCategorySnippet ?? 'living or bedroom'} and the style you have in mind.`,
    ];
  }

  if (vertical === 'apparel' || vertical === 'fashion') {
    return [
      `Hi! I'm ${brandName}'s Product Advisor. Tell me the vibe, fit, or budget you're shopping for and I'll pull pieces straight from our catalog.`,
      `You're chatting with ${brandName}'s Product Advisor—share the occasion, fabric, or price point and I'll do the rest.`,
      `Need something new? Give me hints like ${topFacetSnippet ?? 'style, fit, fabric'} or even a favorite category and I'll curate picks.`,
    ];
  }

  // Generic multi-vertical templates
  const genericTemplates = [
    `Hey there—I'm ${brandName}'s shopping assistant. Tell me what you're looking for and I'll surface the best matches from our catalog.`,
    `Welcome! Share a goal, category, or budget and I'll help you zero in on the right products.`,
    `Hi! Whether you're browsing by ${topFacetSnippet ?? 'category, brand, or price'}, I can guide you to the standouts.`,
  ];

  if (topFacetSnippet) {
    genericTemplates.push(
      `Hey there—I'm ${brandName}'s assistant. Mention facets like ${topFacetSnippet} or an example such as ${
        sampleCategorySnippet ?? exampleSnippet ?? 'your preferred style'
      } and I'll curate suggestions.`,
    );
  }

  return genericTemplates;
}

function buildDeterministicGreeting(brandName: string, datasetContext: DatasetContextType): string {
  const options = buildDeterministicGreetingOptions(brandName, datasetContext);
  return pick(options);
}

export async function getInitialGreeting(): Promise<string> {
  try {
    const [merchant, datasetContext] = await Promise.all([
      prisma.merchant.findUnique({ where: { slug: 'default' } }),
      getDatasetContext(),
    ]);

    const brandName = merchant?.brandName || 'our store';

    // 1) Try to generate the greeting via LLM for freshness + dataset-awareness
    try {
      const vertical = datasetContext?.vertical ?? 'products';
      const primaryFacets = datasetContext?.primaryFacets ?? [];
      const sampleCategories = datasetContext?.sampleCategories ?? [];
      const recommendedExamples = datasetContext?.recommendedSearchExamples ?? [];

      const contextLines: string[] = [
        `Brand name: ${brandName}`,
        `Vertical: ${vertical}`,
      ];

      if (primaryFacets.length) {
        contextLines.push(`Primary facets: ${primaryFacets.join(', ')}`);
      }
      if (sampleCategories.length) {
        contextLines.push(`Sample categories: ${sampleCategories.join(', ')}`);
      }
      if (recommendedExamples.length) {
        contextLines.push(`Example searches: ${recommendedExamples.slice(0, 4).join(' | ')}`);
      }

      const variationSeed = Math.random().toString(36).slice(2);

      const systemPrompt = [
        'You are a helpful shopping assistant for this merchant.',
        'Generate a SHORT, friendly greeting as the very first message in a chat.',
        'It should:',
        '- Mention the brand (if provided) or say "our store" generically.',
        '- Reference the catalog vertical and facets only when relevant.',
        '- Hint that you can help find products based on preferences (e.g. skin concern, room, fit, budget, use-case).',
        '- Be 1–2 sentences max.',
        '- Avoid markdown, bullet points, or emojis.',
        '- Avoid promises about shipping, returns, or discounts.',
        '- Each greeting should feel fresh—do not reuse the exact same phrasing if the variation seed changes.',
      ].join('\n');

      const userContent = [
        'Here is context about the catalog:',
        contextLines.join('\n'),
        '',
        `Variation seed: ${variationSeed}`,
        '',
        'Write the greeting now.',
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
      if (text.length) {
        // Guardrail: avoid getting stuck on a single stale pattern
        // that mentions "(like subcategory, brand, price)" even when
        // dataset context evolves.
        if (text.includes('like subcategory, brand, price')) {
          return buildDeterministicGreeting(brandName, datasetContext);
        }
        return text;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLlmError = error instanceof LLMError;
      logger.warn('initial_greeting_llm_failed', {
        error: message,
        isLlmError,
      });
      // Fall through to deterministic greeting
    }

    // 2) Deterministic, dataset-aware fallback (no LLM)
    return buildDeterministicGreeting(brandName, datasetContext);
  } catch (error) {
    logger.warn('failed_to_generate_initial_greeting', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback to generic greeting
    return "Hey there—I'm your shopping assistant. Tell me what you're looking for and I'll help you find the perfect products from our catalog.";
  }
}
