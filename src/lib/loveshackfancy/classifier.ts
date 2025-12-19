/**
 * Query Classifier
 * 
 * LLM-based query classification and constraint extraction for LoveShackFancy queries.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import { LOVESHACKFANCY_QUERY_CLASSIFIER_PROMPT, LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA } from './prompts';
import { stripJsonFences } from '../llm/orchestrator/utils';

export type FashionConstraints = {
  styles?: string[] | null;
  lengths?: string[] | null;
  occasions?: string[] | null;
  seasons?: string[] | null;
  materials?: string[] | null;
  patterns?: string[] | null;
  colors?: string[] | null;
  sizes?: string[] | null;
  fits?: string[] | null;
  collections?: string[] | null;
  priceMinCents?: number | null;
  priceMaxCents?: number | null;
  embellishments?: string[] | null;
  necklines?: string[] | null;
  sleeveLengths?: string[] | null;
  ageGroups?: string[] | null;
};

export type QueryClassification = {
  type:
    | 'direct_product_search'
    | 'occasion_based'
    | 'style_exploration'
    | 'fit_and_size'
    | 'gift_or_vague'
    | 'unrelated';
  constraints: FashionConstraints;
  confidence: number;
};

/**
 * Classify query and extract constraints using LLM
 */
export async function classifyQuery(
  message: string,
  lastConstraints?: FashionConstraints | null
): Promise<QueryClassification> {
  try {
    const lastConstraintsText = lastConstraints 
      ? JSON.stringify(lastConstraints, null, 2)
      : 'null';
    
    const prompt = LOVESHACKFANCY_QUERY_CLASSIFIER_PROMPT
      .replace('{QUERY}', message)
      .replace('{LAST_CONSTRAINTS}', lastConstraintsText);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a shopping assistant for LoveShackFancy. Classify queries and extract constraints accurately.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'intent',
      expectJson: true,
      schema: LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA,
      maxTokens: 1000,
    });

    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as QueryClassification;

    logger.debug('fashion_query_classified', {
      query: message.substring(0, 100),
      type: parsed.type,
      constraintsCount: Object.keys(parsed.constraints).length,
    });

    return parsed;
  } catch (error) {
    logger.error('classifyQuery: failed', {
      error: error instanceof Error ? error.message : String(error),
      query: message.substring(0, 100),
    });

    // Fallback: return empty classification
    return {
      type: 'gift_or_vague',
      constraints: {},
      confidence: 0.0,
    };
  }
}

/**
 * Infer classification from keywords (fallback)
 * 
 * Simple keyword-based classification when LLM fails.
 * This is a last-resort fallback that uses pattern matching.
 * 
 * @param message - User query message
 * @returns QueryClassification with inferred constraints
 */
export function inferClassificationFromKeywords(
  message: string
): QueryClassification {
  const messageLower = message.toLowerCase();
  const constraints: FashionConstraints = {};

  // Extract basic constraints from keywords
  const colorKeywords: Record<string, string> = {
    'white': 'White',
    'black': 'Black',
    'red': 'Red',
    'blue': 'Blue',
    'green': 'Green',
    'pink': 'Pink',
    'yellow': 'Yellow',
    'purple': 'Purple',
    'orange': 'Orange',
    'brown': 'Brown',
    'gray': 'Gray',
    'grey': 'Gray',
    'navy': 'Navy',
    'beige': 'Beige',
    'cream': 'Cream',
    'ivory': 'Ivory',
  };

  const sizeKeywords = ['xs', 'small', 's', 'medium', 'm', 'large', 'l', 'xl', 'xxl', '0', '2', '4', '6', '8', '10', '12', '14', '16', '18', '20'];
  const occasionKeywords: Record<string, string> = {
    'wedding': 'Wedding',
    'beach': 'Beach',
    'office': 'Office',
    'casual': 'Casual',
    'formal': 'Formal',
    'party': 'Party',
    'cocktail': 'Cocktail',
    'evening': 'Evening',
    'vacation': 'Vacation',
  };

  const styleKeywords: Record<string, string> = {
    'mini': 'Mini',
    'maxi': 'Maxi',
    'midi': 'Midi',
    'a-line': 'A-Line',
    'fitted': 'Fitted',
    'loose': 'Loose',
    'wrap': 'Wrap',
  };

  // Extract colors
  const foundColors: string[] = [];
  for (const [keyword, color] of Object.entries(colorKeywords)) {
    if (messageLower.includes(keyword)) {
      foundColors.push(color);
    }
  }
  if (foundColors.length > 0) {
    constraints.colors = foundColors;
  }

  // Extract sizes
  const foundSizes: string[] = [];
  for (const size of sizeKeywords) {
    if (messageLower.includes(`size ${size}`) || messageLower.includes(` ${size} `) || messageLower.endsWith(` ${size}`)) {
      foundSizes.push(size.toUpperCase());
    }
  }
  if (foundSizes.length > 0) {
    constraints.sizes = foundSizes;
  }

  // Extract occasions
  const foundOccasions: string[] = [];
  for (const [keyword, occasion] of Object.entries(occasionKeywords)) {
    if (messageLower.includes(keyword)) {
      foundOccasions.push(occasion);
    }
  }
  if (foundOccasions.length > 0) {
    constraints.occasions = foundOccasions;
  }

  // Extract styles/lengths
  const foundLengths: string[] = [];
  for (const [keyword, style] of Object.entries(styleKeywords)) {
    if (messageLower.includes(keyword)) {
      if (['mini', 'maxi', 'midi'].includes(keyword)) {
        foundLengths.push(style);
      }
    }
  }
  if (foundLengths.length > 0) {
    constraints.lengths = foundLengths;
  }

  // Extract price
  const priceMatch = messageLower.match(/(?:under|below|less than|up to)\s*\$?(\d+)/);
  if (priceMatch) {
    const price = parseInt(priceMatch[1], 10);
    constraints.priceMaxCents = price * 100;
  }

  const overPriceMatch = messageLower.match(/(?:over|above|more than|at least)\s*\$?(\d+)/);
  if (overPriceMatch) {
    const price = parseInt(overPriceMatch[1], 10);
    constraints.priceMinCents = price * 100;
  }

  // Determine query type
  let type: QueryClassification['type'] = 'gift_or_vague';
  if (messageLower.includes('dress') || messageLower.includes('top') || messageLower.includes('bottom') || messageLower.includes('skirt')) {
    type = 'direct_product_search';
  } else if (constraints.occasions && constraints.occasions.length > 0) {
    type = 'occasion_based';
  } else if (constraints.lengths && constraints.lengths.length > 0) {
    type = 'style_exploration';
  } else if (constraints.sizes && constraints.sizes.length > 0) {
    type = 'fit_and_size';
  }

  logger.debug('inferClassificationFromKeywords: complete', {
    message: message.substring(0, 100),
    type,
    constraintsCount: Object.keys(constraints).length,
  });

  return {
    type,
    constraints,
    confidence: 0.3, // Low confidence for keyword-based inference
  };
}
