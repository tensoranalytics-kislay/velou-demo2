import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';

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
 * Lightweight, dataset-aware greeting generator used only by this route.
 * This intentionally avoids additional LLM calls to keep the first paint fast
 * and relies on DatasetContext + BrandConfig to shape the message.
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
    return `Hey there, I'm ${safeBrand}'s stylist. Share the occasion, ${facetHint}, or price point and I'll curate looks from our catalog.`;
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
 * GET /api/chat/greeting
 * Returns a dataset-aware initial greeting for the chat assistant.
 * This greeting is recomputed on every request and is driven by DatasetContext.
 */
export async function GET() {
  try {
    const [brandConfig, datasetContext] = await Promise.all([
      prisma.brandConfig.findUnique({ where: { id: 1 } }),
      getDatasetContext(),
    ]);

    const brandName = brandConfig?.brandName || 'our store';

    const greeting = buildGreetingFromContext({
      brandName,
      vertical: datasetContext?.vertical,
      primaryFacets: datasetContext?.primaryFacets ?? null,
      sampleCategories: datasetContext?.sampleCategories ?? null,
      recommendedSearchExamples: datasetContext?.recommendedSearchExamples ?? null,
    });

    return NextResponse.json({ greeting });
  } catch (error) {
    console.error('Error generating greeting:', error);
    return NextResponse.json({
      greeting:
        "Hey there, I'm your shopping assistant. Tell me what you're looking for and I'll help you find the perfect products from our catalog.",
    });
  }
}

