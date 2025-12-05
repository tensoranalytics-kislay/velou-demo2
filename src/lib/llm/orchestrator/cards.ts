import { prisma } from '../../db';
import { env } from '../../config';
import { callLLM, type LlmMessage } from '../provider';
import { buildCardReasonPrompt, buildCardReasonMultiPrompt } from '../prompts';
import { logger } from '../../telemetry/logger';
import type { ProductAttributes, SearchConstraints, SearchResultItem } from '../../search/types';
import { stripJsonFences } from './utils';

export type QueryChip = {
  label: string;
  why: string;
};

export type ProductCard = {
  id: string;
  title: string;
  priceCents: number;
  salePriceCents?: number | null;
  currency: string;
  keyAttributes: string[];
  reason: string;
  imageUrl: string;
  productUrl: string;
  stockStatus?: string;
  queryChips?: QueryChip[];
};

/**
 * Ensures a description is between 10-15 words by truncating or padding if needed
 */
function enforceWordCount(text: string, minWords = 10, maxWords = 15): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  
  if (words.length <= maxWords) {
    // If too short, return as-is (better to be slightly short than pad artificially)
    if (words.length < minWords) {
      return text;
    }
    return words.join(' ');
  }
  
  // Truncate to maxWords
  return words.slice(0, maxWords).join(' ');
}

export type ImplicitPreferences = {
  fabrics: string[];
  materials: string[];
  seasons: string[];
  fits: string[];
  useCases: string[];
  categories: string[];
  notes: QueryChip[];
};

export const formatMoney = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

export function inferImplicitPreferences(message: string): ImplicitPreferences {
  const normalized = message.toLowerCase();
  const implicit: ImplicitPreferences = {
    fabrics: [],
    materials: [],
    seasons: [],
    fits: [],
    useCases: [],
    categories: [],
    notes: [],
  };

  const addChip = (label: string, why: string) => {
    implicit.notes.push({ label, why });
  };

  const addArrayValues = (target: string[], values: string[]) => {
    for (const value of values) {
      if (!target.includes(value)) {
        target.push(value);
      }
    }
  };

  const containsAny = (keywords: string[]) => keywords.some((keyword) => normalized.includes(keyword));

  if (containsAny(['beach', 'tropical', 'resort', 'island', 'humid', 'vacation'])) {
    addArrayValues(implicit.fabrics, ['linen', 'cotton', 'rayon']);
    addArrayValues(implicit.materials, ['linen', 'cotton', 'rayon']);
    addArrayValues(implicit.seasons, ['summer']);
    addArrayValues(implicit.fits, ['relaxed', 'regular']);
    addArrayValues(implicit.useCases, ['casual weekend', 'beach wedding']);
    addChip('Beachy picks', 'You mentioned beachy vibes, so I leaned into breezy fabrics.');
  }

  if (containsAny(['winter', 'cold', 'snow', 'chilly', 'layer'])) {
    addArrayValues(implicit.fabrics, ['wool', 'fleece', 'knit']);
    addArrayValues(implicit.materials, ['wool', 'fleece', 'knit', 'down']);
    addArrayValues(implicit.seasons, ['winter']);
    addArrayValues(implicit.categories, ['Outerwear']);
    addChip('Winter cozy', 'You hinted at cold weather, so I boosted warm, layer-friendly pieces.');
  }

  if (containsAny(['india'])) {
    if (containsAny(['december', 'january', 'winter', 'cold'])) {
      addArrayValues(implicit.fabrics, ['wool', 'fleece']);
      addArrayValues(implicit.seasons, ['winter']);
      addChip('India winter', 'India in winter needs warmer layers, so I leaned into cozy fabrics.');
    } else if (containsAny(['summer', 'hot', 'humid'])) {
      addArrayValues(implicit.fabrics, ['cotton', 'linen']);
      addArrayValues(implicit.seasons, ['summer']);
      addChip('India heat', 'You mentioned India heat, so I looked for airy cotton and linen.');
    } else {
      addArrayValues(implicit.fabrics, ['cotton', 'linen']);
      addChip('India climate', 'Since you mentioned India, I added breathable styles for flexible weather.');
    }
  }

  if (containsAny(['office', 'work', 'meeting', 'formal', 'smart casual', 'tailored'])) {
    addArrayValues(implicit.fits, ['tailored', 'slim']);
    addArrayValues(implicit.useCases, ['office']);
    addArrayValues(implicit.categories, ['Tops', 'Pants', 'Outerwear']);
    addChip('Office polish', 'You asked for office-ready outfits, so I nudged tailored silhouettes.');
  }

  return implicit;
}

type PrismaProductRecord = NonNullable<Awaited<ReturnType<typeof prisma.product.findUnique>>>;

export const productToResultItem = (product: PrismaProductRecord): SearchResultItem => ({
  id: product.id,
  title: product.title,
  description: product.description,
  imageUrl: product.imageUrl,
  productUrl: product.productUrl,
  priceCents: product.priceCents,
  salePriceCents: product.salePriceCents,
  currency: product.currency,
  category: product.category,
  stockStatus: product.stockStatus,
  attributes: (product.attributes ?? {}) as ProductAttributes,
});

export const fetchProductsByIds = async (ids: string[]): Promise<SearchResultItem[]> => {
  if (!ids.length) return [];
  const products = await prisma.product.findMany({
    where: {
      id: {
        in: ids,
      },
    },
  });
  const map = new Map(
    products.map((product: PrismaProductRecord) => [product.id, productToResultItem(product)]),
  );
  return ids.map((id) => map.get(id)).filter((item): item is SearchResultItem => Boolean(item));
};

export const describeConstraints = (constraints: SearchConstraints) => {
  const pieces: string[] = [];
  if (constraints.category) {
    const categoryStr = Array.isArray(constraints.category)
      ? constraints.category.join(', ')
      : constraints.category;
    pieces.push(categoryStr.toLowerCase());
  }
  if (constraints.priceMaxCents) pieces.push(`under ${formatMoney(constraints.priceMaxCents)}`);
  if (constraints.colors?.length) pieces.push(`in ${constraints.colors.join(', ')}`);
  if (constraints.materials?.length) pieces.push(`${constraints.materials[0]} fabric`);
  if (constraints.occasions?.length) pieces.push(`for ${constraints.occasions[0]}`);
  if (constraints.seasons?.length) pieces.push(`for ${constraints.seasons[0]} weather`);
  if (constraints.sizes?.length) pieces.push(`size ${constraints.sizes.join('/')}`);
  if (constraints.genders?.length) pieces.push(`${constraints.genders[0]} styles`);
  if (constraints.fit) pieces.push(`${constraints.fit} fit`);
  return pieces.join(', ');
};

export function buildDiscoveryReply(constraints: SearchConstraints, products: SearchResultItem[]) {
  return `I found some great pieces that match your style.\n\nHere are a few options that should work perfectly.`;
}

export function buildProductCard(
  item: SearchResultItem,
  options?: { reason?: string; queryChips?: QueryChip[] },
): ProductCard {
  const attributes = item.attributes ?? {};
  const attributeOrder = ['fabric', 'fit', 'length', 'season', 'occasion', 'color'] as const;
  const keyAttributes = attributeOrder
    .map((key) => attributes[key] && `${key}: ${attributes[key]}`)
    .filter(Boolean)
    .slice(0, 5) as string[];

  const reason =
    options?.reason ??
    `Chosen because the ${attributes.fabric ?? 'fabric'} ${attributes.fit ? `and ${attributes.fit} fit ` : ''}${
      attributes.occasion ? `feel right for ${attributes.occasion}` : 'align with your request'
    }.`;

  return {
    id: item.id,
    title: item.title,
    priceCents: item.priceCents,
    salePriceCents: item.salePriceCents,
    currency: item.currency,
    keyAttributes,
    reason,
    imageUrl: item.imageUrl,
    productUrl: item.productUrl ?? `/products/${item.id}`,
    stockStatus: item.stockStatus,
    queryChips: options?.queryChips,
  };
}

/**
 * F) Remove duplicates by title (case-insensitive) and avoid near-duplicates
 * Near-duplicates = same title + same color + same price
 */
/**
 * Normalizes title for deduplication: lowercase, trim, collapse whitespace, strip punctuation variations
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ') // Collapse multiple spaces to single space
    .replace(/[^\w\s-]/g, '') // Remove punctuation except hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/\s*-\s*/g, '-') // Normalize space-hyphen-space to hyphen
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .trim();
}

/**
 * Normalizes image URL for deduplication
 * Removes query params, trailing slashes, and normalizes case
 * Handles both absolute and relative URLs
 */
function normalizeImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  
  // Normalize the string: lowercase, trim, remove query params and fragments
  let normalized = url.trim().toLowerCase();
  
  // Remove query params (?size=M, ?color=blue, etc.)
  normalized = normalized.split('?')[0];
  
  // Remove fragments (#reviews, #specs, etc.)
  normalized = normalized.split('#')[0];
  
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '');
  
  // If it's a relative URL starting with /, keep it as-is
  // If it's an absolute URL, extract just the pathname
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    try {
      const urlObj = new URL(normalized);
      normalized = urlObj.pathname;
      // Remove trailing slash again after extracting pathname
      normalized = normalized.replace(/\/$/, '');
    } catch {
      // If URL parsing fails, use the string as-is (already normalized)
    }
  }
  
  return normalized || undefined;
}

export function deduplicateProductCards(
  cards: ProductCard[],
  limit?: number,
): ProductCard[] {
  const seenImageUrls = new Set<string>();
  const deduplicated: ProductCard[] = [];

  for (const card of cards) {
    // Deduplicate by imageUrl (image link) only
    const normalizedImageUrl = normalizeImageUrl(card.imageUrl);
    
    if (normalizedImageUrl) {
      // If we've already seen this image URL, skip (same product image)
      if (seenImageUrls.has(normalizedImageUrl)) {
        continue;
      }
      seenImageUrls.add(normalizedImageUrl);
    }
    // If no image URL, keep the card (don't deduplicate)
    
    // Keep the card (first occurrence = highest ranked)
    deduplicated.push(card);
    
    // Stop if we've reached the limit
    if (limit && deduplicated.length >= limit) {
      break;
    }
  }

  return deduplicated;
}

export const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s,.'"]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && !['the', 'and', 'for', 'you', 'with', 'that', 'this'].includes(part));

export const buildPendingSummary = (constraints: SearchConstraints, productCount: number) => {
  const countLabel = productCount === 1 ? 'one piece' : `${productCount} pieces`;
  const filterSummary = describeConstraints(constraints);
  if (filterSummary.length) {
    return `${countLabel} filtered for ${filterSummary}`;
  }
  return `${countLabel} that match your note`;
};

export const buildPendingReminderReply = (summary: string) =>
  `I'm still holding onto ${summary}. Say "show me" when you're ready or tell me what to adjust.`;

export function collectConstraintLabels(constraints: SearchConstraints): string[] {
  const labels: string[] = [];
  if (constraints.priceMaxCents) {
    labels.push(`your under ${formatMoney(constraints.priceMaxCents)}`);
  }
  if (constraints.colors?.length) {
    labels.push(`the ${constraints.colors.slice(0, 2).join(', ')} palette you mentioned`);
  }
  if (constraints.materials?.length || constraints.fabrics?.length) {
    labels.push('your fabric preference');
  }
  if (constraints.occasions?.length) {
    labels.push(`the ${constraints.occasions[0]} setting`);
  }
  if (constraints.seasons?.length) {
    labels.push(`that ${constraints.seasons[0]} weather note`);
  }
  return labels;
}

export const getDisplayName = (title: string) => title.split(' - ')[0].trim();

export const extractDescriptionSnippet = (description?: string): string | undefined => {
  if (!description) return undefined;
  return description
    .split('.')
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length > 25 && sentence.length < 160);
};

export const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

export function buildDeterministicReason(
  item: SearchResultItem,
  facts: string[],
  constraintLabels: string[],
): string {
  const displayName = getDisplayName(item.title);
  const uniqueFacts = Array.from(new Set(facts)).filter(Boolean);
  const descriptionSnippet = extractDescriptionSnippet(item.description);
  const preferredFact =
    uniqueFacts.find((fact) => /made|uses|shade|color|mentions|fabric|material|cozy|airy/.test(fact.toLowerCase())) ||
    uniqueFacts[0];
  const detail =
    descriptionSnippet ||
    preferredFact ||
    `it mixes ${((item.attributes?.fabric as string) ?? 'soft fabrics').toLowerCase()} with an easy fit`;
  const friendlyDetail = detail.replace(/^it\s+/i, '');
  const openerTemplates = [
    `The ${displayName} felt right because`,
    `I pulled the ${displayName} since`,
    `Give the ${displayName} a look—`,
    `The ${displayName} stands out because`,
  ];
  const closingOptions = constraintLabels.length
    ? [
        `It still keeps ${constraintLabels[0]} in mind.`,
        `It respects ${constraintLabels.slice(0, 2).join(' and ')}.`,
        `It follows the filters you mentioned.`,
      ]
    : ['Hope it matches the vibe you described.', 'It just fits what you asked for.'];
  const hash = hashString(item.id);
  const opener = openerTemplates[hash % openerTemplates.length];
  const closing = closingOptions[hash % closingOptions.length];
  return `${opener} ${friendlyDetail}. ${closing}`;
}

export async function buildCardReason({
  item,
  userMessage,
  constraintLabels,
  facts,
  implicitPrefs,
  requestedCategoryExists,
  requestedCategory,
}: {
  item: SearchResultItem;
  userMessage: string;
  constraintLabels: string[];
  facts: string[];
  implicitPrefs: ImplicitPreferences;
  requestedCategoryExists?: boolean;
  requestedCategory?: string | string[] | null;
}): Promise<string> {
  const deterministic = buildDeterministicReason(item, facts, constraintLabels);

  if (env.llmProvider === 'mock') {
    return enforceWordCount(deterministic);
  }

  try {
    const summary = {
      title: getDisplayName(item.title),
      description: item.description?.slice(0, 400) ?? '',
      attributes: item.attributes,
    };
    const intentNotes = [
      ...constraintLabels,
      ...implicitPrefs.notes.map((chip) => chip.label),
    ].slice(0, 4);

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: buildCardReasonPrompt(requestedCategoryExists, requestedCategory),
      },
      {
        role: 'user',
        content: `Shopper query: "${userMessage}"

Intent notes: ${intentNotes.length ? intentNotes.join(', ') : 'general style guidance'}
Product summary: ${JSON.stringify(summary)}
Grounded facts: ${facts.slice(0, 4).join(' | ') || 'N/A'}

Write one short reason.`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'card_reason',
      expectJson: false,
    });
    const cleaned = stripJsonFences(result.rawText).replace(/^["']|["']$/g, '').trim();
    if (cleaned.length) {
      return enforceWordCount(cleaned);
    }
  } catch (error) {
    logger.error('llm_card_reason_failed', {
      error: error instanceof Error ? error.message : String(error),
      productId: item.id,
    });
  }

  return enforceWordCount(deterministic);
}

type CardReasonInput = {
  item: SearchResultItem;
  userMessage: string;
  constraintLabels: string[];
  facts: string[];
  implicitPrefs: ImplicitPreferences;
};

/**
 * Batched card reason generator.
 * Issues a SINGLE LLM call for a list of products, and then
 * splits the response on a delimiter so each card gets a reason
 * in the same order.
 */
export async function buildCardReasonsBatch(
  inputs: CardReasonInput[],
  requestedCategoryExists?: boolean,
  requestedCategory?: string | string[] | null,
): Promise<string[]> {
  if (inputs.length === 0) {
    return [];
  }

  const deterministicReasons = inputs.map((input) =>
    enforceWordCount(buildDeterministicReason(input.item, input.facts, input.constraintLabels)),
  );

  if (env.llmProvider === 'mock') {
    return deterministicReasons;
  }

  try {
    const shopperQuery = inputs[0]?.userMessage ?? '';

    const productSummaries = inputs.map((input, index) => {
      const intentNotes = [
        ...input.constraintLabels,
        ...input.implicitPrefs.notes.map((chip) => chip.label),
      ].slice(0, 4);

      return {
        index: index + 1,
        title: getDisplayName(input.item.title),
        description: input.item.description?.slice(0, 400) ?? '',
        attributes: input.item.attributes,
        intentNotes,
        facts: input.facts.slice(0, 4),
      };
    });

    const productsBlock = productSummaries
      .map(
        (p) =>
          `[${p.index}] Title: ${p.title}
Description: ${p.description}
Intent notes: ${p.intentNotes.length ? p.intentNotes.join(', ') : 'general style guidance'}
Grounded facts: ${p.facts.length ? p.facts.join(' | ') : 'N/A'}`,
      )
      .join('\n\n');

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: buildCardReasonMultiPrompt(requestedCategoryExists, requestedCategory),
      },
      {
        role: 'user',
        content: `Shopper query: "${shopperQuery}"

Products:
${productsBlock}

Write one short reason per product in order, using the required delimiter.`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'card_reason',
      expectJson: false,
    });

    const cleaned = stripJsonFences(result.rawText).trim();
    if (!cleaned) {
      return deterministicReasons;
    }

    const rawParts = cleaned
      .split(/<<<END_REASON>>>/i)
      .map((part) => part.replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);

    const reasons: string[] = deterministicReasons.slice();
    for (let i = 0; i < Math.min(rawParts.length, inputs.length); i++) {
      if (rawParts[i]) {
        reasons[i] = enforceWordCount(rawParts[i]);
      }
    }

    return reasons;
  } catch (error) {
    logger.error('llm_card_reason_failed_batch', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicReasons;
  }
}

export function evaluateProductFit(
  item: SearchResultItem,
  constraints: SearchConstraints,
  implicit: ImplicitPreferences,
  queryTokens: string[],
): { item: SearchResultItem; score: number; facts: string[] } {
  let score = 0;
  const facts: string[] = [];
  const attrs = item.attributes ?? {};

  if (constraints.category) {
    const categoryStr = Array.isArray(constraints.category)
      ? constraints.category.join(', ')
      : constraints.category;
    const matchesCategory = Array.isArray(constraints.category)
      ? constraints.category.includes(item.category)
      : item.category === constraints.category;
    if (matchesCategory) {
      score += 3;
      facts.push(`it matches your ${categoryStr.toLowerCase()} category`);
    }
  }

  if (constraints.priceMaxCents) {
    if (item.priceCents <= constraints.priceMaxCents) {
      score += 2;
      facts.push(`it stays within your ${formatMoney(constraints.priceMaxCents, item.currency)} budget`);
    } else {
      score -= 2;
    }
  }

  const checkArrayMatch = (wanted?: string[], actual?: string | string[], label?: string) => {
    if (!wanted?.length || !actual) return;
    const actualArray = Array.isArray(actual) ? actual : [actual];
    if (wanted.some((value) => actualArray.map((entry) => String(entry).toLowerCase()).includes(value.toLowerCase()))) {
      score += 1.5;
      if (label) facts.push(label);
    }
  };

  // Helper to count array overlaps and add proportional score bonus
  const checkArrayOverlap = (
    wanted?: string[],
    actual?: string[],
    scorePerMatch = 1.5,
    maxMatches = 3,
    factTemplate?: (matches: string[]) => string,
  ) => {
    if (!wanted?.length || !actual?.length) return;
    const wantedLower = wanted.map((v) => v.toLowerCase());
    const actualLower = actual.map((v) => String(v).toLowerCase());
    const matches = wantedLower.filter((w) => actualLower.includes(w));
    if (matches.length > 0) {
      const matchCount = Math.min(matches.length, maxMatches);
      score += matchCount * scorePerMatch;
      if (factTemplate) {
        const matchedValues = matches.slice(0, maxMatches).map((m) => {
          // Find original case from actual array
          return actual.find((a) => a.toLowerCase() === m) || m;
        });
        facts.push(factTemplate(matchedValues));
      }
    }
  };

  checkArrayMatch(constraints.colors, attrs.color as string | undefined, `it's available in that ${attrs.color?.toString().toLowerCase()} shade you asked about`);
  checkArrayMatch(constraints.fabrics, attrs.fabric as string | undefined, `it's done in ${attrs.fabric?.toString().toLowerCase()} like you mentioned`);
  checkArrayMatch(constraints.materials, attrs.material as string | undefined, `it leans on ${attrs.material?.toString().toLowerCase()} materials you prefer`);
  checkArrayMatch(constraints.seasons, attrs.season as string | undefined, `it's comfortable for ${attrs.season?.toString().toLowerCase()} days`);
  checkArrayMatch(constraints.occasions, attrs.occasion as string | undefined, `it's made for ${attrs.occasion?.toString().toLowerCase()} moments`);
  checkArrayMatch(constraints.sizes, attrs.size as string | undefined, `it's available in the sizes you called out`);

  // Generic facet scoring: benefits
  checkArrayOverlap(
    constraints.benefits,
    attrs.benefits as string[] | undefined,
    1.5,
    3,
    (matches) => `it offers ${matches.length > 1 ? matches.join(', ') : matches[0]} like you wanted`,
  );

  // Generic facet scoring: styleTags
  checkArrayOverlap(
    constraints.styleTags,
    attrs.styleTags as string[] | undefined,
    1.5,
    3,
    (matches) => `it has that ${matches.length > 1 ? matches.join(', ') : matches[0]} style you mentioned`,
  );

  // Generic facet scoring: compatibility
  checkArrayOverlap(
    constraints.compatibility,
    attrs.compatibility as string[] | undefined,
    1.5,
    3,
    (matches) => `it works with ${matches.length > 1 ? matches.join(', ') : matches[0]} as you need`,
  );

  // Generic facet scoring: useCases (enhanced with overlap counting)
  if (constraints.useCases?.length && attrs.useCases) {
    checkArrayOverlap(
      constraints.useCases,
      attrs.useCases as string[],
      1.5,
      3,
      (matches) => `it's perfect for ${matches.length > 1 ? matches.join(', ') : matches[0]}`,
    );
  }

  // Generic facet scoring: sensoryProfile (substring match)
  if (constraints.sensoryProfile && attrs.sensoryProfile) {
    const constraintLower = constraints.sensoryProfile.toLowerCase();
    const attributeLower = String(attrs.sensoryProfile).toLowerCase();
    if (attributeLower.includes(constraintLower)) {
      score += 1.5;
      facts.push(`it has that ${constraints.sensoryProfile} quality you're looking for`);
    }
  }

  checkArrayMatch(implicit.fabrics, attrs.fabric as string | undefined, `its ${attrs.fabric?.toString().toLowerCase()} fabric keeps things comfy for your climate`);
  checkArrayMatch(
    implicit.materials,
    attrs.material as string | undefined,
    `the material choice helps with the weather you described`,
  );
  checkArrayMatch(implicit.seasons, attrs.season as string | undefined, `it's built with ${attrs.season?.toString().toLowerCase()} in mind`);
  checkArrayMatch(
    implicit.fits,
    attrs.fit as string | undefined,
    `the ${attrs.fit?.toString().toLowerCase()} fit lines up with your style preference`,
  );
  // Enhanced useCases overlap for implicit preferences
  if (implicit.useCases?.length && attrs.useCases) {
    checkArrayOverlap(
      implicit.useCases,
      attrs.useCases as string[],
      1.5,
      3,
      (matches) => `it's meant for ${matches.length > 1 ? matches.join(', ') : matches[0]} like you mentioned`,
    );
  }
  checkArrayMatch(implicit.categories, [item.category], `it keeps the focus on ${item.category.toLowerCase()} outfits`);

  if (constraints.fit && attrs.fit && String(attrs.fit).toLowerCase() === constraints.fit.toLowerCase()) {
    score += 1.5;
    facts.push(`it has that ${attrs.fit.toString().toLowerCase()} fit you wanted`);
  }

  const searchableText = `${item.title} ${item.description}`.toLowerCase();
  const keywordMatches = queryTokens.filter((token) => searchableText.includes(token));
  if (keywordMatches.length) {
    score += Math.min(keywordMatches.length, 4) * 0.75;
    facts.push(`it even mentions ${keywordMatches.slice(0, 2).join(' & ')} in the description`);
  }

  if (attrs.fabric && !facts.some((fact) => fact.includes(String(attrs.fabric)))) {
    facts.push(`it's made from ${String(attrs.fabric).toLowerCase()} so it stays comfy`);
  } else if (attrs.material && !facts.some((fact) => fact.includes(String(attrs.material)))) {
    facts.push(`it uses ${String(attrs.material).toLowerCase()} to match the feel you mentioned`);
  } else if (attrs.productType) {
    facts.push(`it's a ${String(attrs.productType).toLowerCase()} that keeps your outfit on-theme`);
  }

  if (!facts.length && item.description) {
    const snippet = item.description.split('.').find((sentence) => sentence.trim().length > 20);
    if (snippet) {
      facts.push(snippet.trim());
    }
  }

  return { item, score, facts };
}

/**
 * Extracts a single word from a label for display in keyword tags
 */
function extractSingleWord(label: string): string {
  // Remove common prefixes like "Color:", "Under", etc.
  let cleaned = label.replace(/^(Color|Under|Over|At)\s*:?\s*/i, '').trim();
  
  // If it's a price, extract just the currency amount (e.g., "$50" from "Under $50")
  const priceMatch = cleaned.match(/\$[\d,]+/);
  if (priceMatch) {
    return priceMatch[0];
  }
  
  // Split by common separators and take the first meaningful word
  const words = cleaned.split(/[\s,]+/).filter(Boolean);
  
  // Skip common words like "fabric", "material", etc. and get the first meaningful word
  const skipWords = ['fabric', 'material', 'color', 'colors'];
  for (const word of words) {
    const lowerWord = word.toLowerCase();
    if (!skipWords.includes(lowerWord) && word.length > 0) {
      return word;
    }
  }
  
  // Fallback: return first word if no meaningful word found
  return words[0] || label;
}

export function buildQueryChips(
  constraints: SearchConstraints,
  implicit: ImplicitPreferences,
): QueryChip[] {
  const chips: QueryChip[] = [];

  if (constraints.priceMaxCents) {
    const priceLabel = formatMoney(constraints.priceMaxCents);
    chips.push({
      label: extractSingleWord(`Under ${priceLabel}`),
      why: `You said you'd like to stay under ${formatMoney(constraints.priceMaxCents)}, so I kept things in that range.`,
    });
  }

  if (constraints.colors?.length) {
    // Extract first color word from the first color
    const firstColor = constraints.colors[0].split(/[\s,]+/)[0];
    chips.push({
      label: firstColor,
      why: 'You mentioned those shades, so I looked for pieces in that palette.',
    });
  }

  if (constraints.materials?.length) {
    const material = constraints.materials[0].split(/[\s,]+/)[0];
    chips.push({
      label: material,
      why: `${constraints.materials[0]} came up in your note, so I favored it.`,
    });
  } else if (constraints.fabrics?.length) {
    const fabric = constraints.fabrics[0].split(/[\s,]+/)[0];
    chips.push({
      label: fabric,
      why: `${constraints.fabrics[0]} felt important to you, so I highlighted it.`,
    });
  }

  if (constraints.occasions?.length) {
    const occasion = constraints.occasions[0].split(/[\s,]+/)[0];
    chips.push({
      label: occasion,
      why: `You mentioned ${constraints.occasions[0]}, so I leaned into pieces for that setting.`,
    });
  }

  for (const note of implicit.notes) {
    chips.push({
      label: extractSingleWord(note.label),
      why: note.why,
    });
  }

  return chips.slice(0, 5);
}

export function buildSuitabilityReply(
  product: SearchResultItem,
  constraints: SearchConstraints,
): string {
  const attrs = product.attributes ?? {};
  const matchesSeason =
    !constraints.seasons?.length || (attrs.season && constraints.seasons.includes(attrs.season));
  const matchesOccasion =
    !constraints.occasions?.length || (attrs.occasion && constraints.occasions.includes(attrs.occasion));

  if (matchesSeason && matchesOccasion) {
    return 'This piece should work perfectly for what you described.\n\nI\'ve also suggested a few alternate pieces below.';
  }
  
  return "This piece should work, though it's not a perfect match.\n\nI've suggested a few alternate pieces that might be closer to what you're looking for.";
}

