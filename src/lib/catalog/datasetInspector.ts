/**
 * Dataset Inspector - LLM-powered catalog context inference
 * Analyzes sample rows to infer vertical, facets, and quality notes
 */

import { callLLM, LLMError } from '../llm/provider';
import { safeParseLlmJson } from '../llm/orchestrator/utils';
import { logger } from '../telemetry/logger';
import type { DatasetCoreStats, UnifiedVendorCatalogRow } from './types';

export interface DatasetContext {
  vertical?: string; // e.g. apparel, footwear, skincare, furniture, electronics, etc.
  dominantPriceCurrency?: string;
  hasPriceData: boolean;
  hasImages: boolean;
  sampleCategories: string[];
  primaryFacets: string[]; // e.g. size, color, material, occasion, room, skin_type
  recommendedSearchExamples: string[]; // 3-6 natural language queries
  qualityNotes: string[]; // warnings like "most rows missing price", "very sparse descriptions"
}

const MAX_SAMPLE_ROWS = 50;
const DESCRIPTION_TRUNCATE_LENGTH = 200;

/**
 * Build a compact JSON view of sample rows for LLM analysis
 */
function buildSampleView(
  sampleRows: UnifiedVendorCatalogRow[],
  stats: DatasetCoreStats
): string {
  const samples = sampleRows.slice(0, MAX_SAMPLE_ROWS).map((row) => {
    const sample: Record<string, unknown> = {};
    
    // Identity
    if (row.product_id) sample.product_id = row.product_id;
    if (row.title) {
      sample.title = row.title.length > 100 ? row.title.slice(0, 100) + '...' : row.title;
    }
    if (row.short_title) sample.short_title = row.short_title;
    
    // Classification
    if (row.vertical) sample.vertical = row.vertical;
    if (row.category) sample.category = row.category;
    if (row.subcategory) sample.subcategory = row.subcategory;
    if (row.usage_contexts && row.usage_contexts.length > 0) {
      sample.usage_contexts = row.usage_contexts;
    }
    if (row.style_tags && row.style_tags.length > 0) {
      sample.style_tags = row.style_tags;
    }
    
    // Commercial
    if (row.price) sample.price = row.price;
    if (row.currency) sample.currency = row.currency;
    if (row.inventory_status) sample.inventory_status = row.inventory_status;
    
    // Copy (truncate long descriptions)
    if (row.description) {
      sample.description = row.description.length > DESCRIPTION_TRUNCATE_LENGTH
        ? row.description.slice(0, DESCRIPTION_TRUNCATE_LENGTH) + '...'
        : row.description;
    }
    if (row.bullet_highlights && row.bullet_highlights.length > 0) {
      sample.bullet_highlights = row.bullet_highlights.slice(0, 5); // Limit to 5
    }
    if (row.product_highlights) {
      sample.product_highlights = row.product_highlights.length > DESCRIPTION_TRUNCATE_LENGTH
        ? row.product_highlights.slice(0, DESCRIPTION_TRUNCATE_LENGTH) + '...'
        : row.product_highlights;
    }
    
    // Experience
    if (row.benefits && row.benefits.length > 0) {
      sample.benefits = row.benefits.slice(0, 5); // Limit to 5
    }
    if (row.claims && row.claims.length > 0) {
      sample.claims = row.claims.slice(0, 3); // Limit to 3
    }
    
    // Extensible
    if (row.attribute_blob) {
      // Include a snippet of attribute_blob (first 300 chars)
      sample.attribute_blob_snippet = row.attribute_blob.slice(0, 300);
    }
    
    return sample;
  });

  return JSON.stringify({
    sampleCount: samples.length,
    totalRowsInDataset: stats.totalRows,
    stats: {
      rowsWithPrice: stats.rowsWithPrice,
      rowsWithCurrency: stats.rowsWithCurrency,
      rowsWithImage: stats.rowsWithImage,
      rowsWithDescription: stats.rowsWithDescription,
      rowsWithCategory: stats.rowsWithCategory,
      rowsWithBrand: stats.rowsWithBrand,
    },
    samples,
  }, null, 2);
}

/**
 * Infer dataset context from sample rows using LLM
 */
export async function inferDatasetContextFromRows(args: {
  sampleRows: UnifiedVendorCatalogRow[];
  stats: DatasetCoreStats;
  adminHints?: { vertical?: string; currency?: string };
}): Promise<DatasetContext> {
  const { sampleRows, stats, adminHints } = args;

  if (sampleRows.length === 0) {
    return {
      hasPriceData: stats.rowsWithPrice > 0,
      hasImages: stats.rowsWithImage > 0,
      sampleCategories: [],
      primaryFacets: [],
      recommendedSearchExamples: [],
      qualityNotes: [],
    };
  }

  const sampleView = buildSampleView(sampleRows, stats);
  
  const systemPrompt = `You are helping configure an AI shopping assistant. Given a sample of structured product rows in a unified catalog schema, infer the catalog's vertical (e.g., apparel, skincare, furniture, home decor, consumer electronics, groceries, etc.), the key facets customers care about when choosing products, whether price and image data are reliably present, and create 3–6 example natural language queries that a shopper might ask for this catalog.

CRITICAL for recommendedSearchExamples:
- Keep queries CONCISE and direct (3-8 words maximum)
- Remove filler phrases like "search for", "look for", "I want", "find", "show me", "list", "get me", "need", "looking for"
- Start directly with the product/category/attribute (e.g., "hand creams for dry skin" NOT "search for hand creams for dry skin")
- Examples should be: "vegan shampoos under $50", "moisturizer for sensitive skin", "flare jeans under $100"
- Avoid: "Search for vegan shampoos", "I want moisturizer", "Find flare jeans"

Respond STRICTLY as JSON matching this schema:
{
  "vertical": "string (optional, e.g. 'apparel', 'skincare', 'furniture')",
  "dominantPriceCurrency": "string (optional, ISO code like 'USD', 'EUR')",
  "hasPriceData": "boolean",
  "hasImages": "boolean",
  "sampleCategories": ["string array of unique category names found"],
  "primaryFacets": ["string array of key attributes like 'size', 'color', 'material', 'occasion', 'room', 'skin_type', 'fit', 'season', etc."],
  "recommendedSearchExamples": ["3-6 natural language query examples - MUST be concise, no filler phrases"],
  "qualityNotes": ["string array of warnings or observations about data quality"]
}`;

  const userPrompt = `Analyze this product catalog sample:

${sampleView}

${adminHints?.vertical ? `Admin hint: vertical is likely "${adminHints.vertical}"` : ''}
${adminHints?.currency ? `Admin hint: currency is likely "${adminHints.currency}"` : ''}

Provide your analysis as JSON.`;

  try {
    // Import env to check model configuration
    const { env } = await import('../config');
    
    logger.debug('Starting dataset context inference', {
      sampleRowsCount: sampleRows.length,
      sampleViewLength: sampleView.length,
      model: env.primaryLlmModel,
      hasApiKey: !!env.openaiApiKey,
    });

    const result = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      purpose: 'intent', // Use primary model
      expectJson: true,
      schema: {
        name: 'DatasetContext',
        schema: {
          type: 'object',
          properties: {
            vertical: { type: 'string' },
            dominantPriceCurrency: { type: 'string' },
            hasPriceData: { type: 'boolean' },
            hasImages: { type: 'boolean' },
            sampleCategories: { type: 'array', items: { type: 'string' } },
            primaryFacets: { type: 'array', items: { type: 'string' } },
            recommendedSearchExamples: { type: 'array', items: { type: 'string' } },
            qualityNotes: { type: 'array', items: { type: 'string' } },
          },
          required: ['hasPriceData', 'hasImages', 'sampleCategories', 'primaryFacets', 'recommendedSearchExamples', 'qualityNotes'],
        },
      },
    });

    const parseResult = safeParseLlmJson<DatasetContext>(result.rawText, {
      hasPriceData: stats.rowsWithPrice > 0,
      hasImages: stats.rowsWithImage > 0,
      sampleCategories: [],
      primaryFacets: [],
      recommendedSearchExamples: [],
      qualityNotes: [],
    });

    if (!parseResult.success || !parseResult.data) {
      logger.warn('Failed to parse dataset context from LLM', {
        error: parseResult.error,
      });
      // Return fallback
      return {
        hasPriceData: stats.rowsWithPrice > 0,
        hasImages: stats.rowsWithImage > 0,
        sampleCategories: Array.from(
          new Set(sampleRows.map((r) => r.category).filter(Boolean) as string[])
        ).slice(0, 10),
        primaryFacets: [],
        recommendedSearchExamples: [],
        qualityNotes: ['LLM context inference failed'],
      };
    }

    const context = parseResult.data;

    // Ensure required fields are present
    // Admin hints take precedence over LLM values
    return {
      vertical: adminHints?.vertical || context.vertical,
      dominantPriceCurrency: adminHints?.currency || context.dominantPriceCurrency,
      hasPriceData: context.hasPriceData ?? stats.rowsWithPrice > 0,
      hasImages: context.hasImages ?? stats.rowsWithImage > 0,
      sampleCategories: context.sampleCategories || [],
      primaryFacets: context.primaryFacets || [],
      recommendedSearchExamples: context.recommendedSearchExamples || [],
      qualityNotes: context.qualityNotes || [],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = error instanceof Error && 'cause' in error ? String(error.cause) : undefined;
    
    logger.error('Dataset context inference failed', {
      error: errorMessage,
      errorDetails,
      sampleRowsCount: sampleRows.length,
      stats: {
        totalRows: stats.totalRows,
        rowsWithPrice: stats.rowsWithPrice,
        rowsWithImage: stats.rowsWithImage,
        rowsWithDescription: stats.rowsWithDescription,
      },
    });

    // Return fallback context
    const categories = Array.from(
      new Set(sampleRows.map((r) => r.category).filter(Boolean) as string[])
    ).slice(0, 10);

    // Build a more informative error message for quality notes
    let inferenceErrorNote = 'LLM inference unavailable';
    if (errorMessage.includes('OPENAI_API_KEY')) {
      inferenceErrorNote = 'LLM inference unavailable: OpenAI API key missing or invalid';
    } else if (errorMessage.includes('API error')) {
      inferenceErrorNote = `LLM inference unavailable: ${errorMessage}`;
    } else if (errorMessage.includes('model')) {
      inferenceErrorNote = `LLM inference unavailable: Model configuration error - ${errorMessage}`;
    }

    return {
      vertical: adminHints?.vertical,
      dominantPriceCurrency: adminHints?.currency,
      hasPriceData: stats.rowsWithPrice > 0,
      hasImages: stats.rowsWithImage > 0,
      sampleCategories: categories,
      primaryFacets: [],
      recommendedSearchExamples: [],
      qualityNotes: [
        inferenceErrorNote,
        stats.rowsWithPrice === 0 ? 'No price data found' : '',
        stats.rowsWithImage === 0 ? 'No image data found' : '',
        stats.rowsWithDescription === 0 ? 'No descriptions found' : '',
      ].filter(Boolean),
    };
  }
}

