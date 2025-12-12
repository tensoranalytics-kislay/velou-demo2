import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { callLLM } from '@/lib/llm/provider';

/**
 * Lightweight, product-backed follow-up suggestions.
 * Runs in parallel with retrieval/product load and only suggests queries
 * guaranteed to match products we already have in hand.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lastMessage = (searchParams.get('lastMessage') || '').trim();
  const productId = searchParams.get('productId')?.trim();

  try {
    console.log('[suggestions] incoming params', { lastMessage, productId });

    // Product-specific Q&A suggestions
    if (productId) {
      const selectedProduct = await prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          title: true,
          category: true,
          subcategory: true,
          brand: true,
          priceCents: true,
          attributes: true,
        },
      });

      if (!selectedProduct) {
        return NextResponse.json({ suggestions: ['Ask about this product', 'Similar items?', 'Any other scents?'] });
      }

      const similarProducts = await prisma.product.findMany({
        where: {
          id: { not: productId },
          stockStatus: { in: ['in_stock', 'low_stock'] },
          OR: [
            { category: selectedProduct.category || undefined },
            { subcategory: selectedProduct.subcategory || undefined },
            { brand: selectedProduct.brand || undefined },
          ].filter(Boolean) as any[],
        },
        select: {
          id: true,
          title: true,
          category: true,
          subcategory: true,
          brand: true,
          priceCents: true,
          attributes: true,
        },
        take: 20,
      });

      const systemPrompt = `
You are a shopping assistant that suggests follow-up QUESTION prompts
about a single selected product.

You will be given:
- userQuery: the shopper’s last message.
- selectedProduct: the product the shopper clicked on.
- similarProducts: up to 20 other catalog products that are related
  (same category / productType / brand or similar attributes).

Each product may contain:
id, title, category, subcategory, productTypes, brand, priceCents,
and attributes such as ingredients, concerns, skinTypes, scents,
applicationAreas, formats, SPF, size, etc.

YOUR GOAL
Generate 3 short question-style prompts the shopper might click to learn
more about this product or close alternatives.

These prompts must:
- be directly related to the selectedProduct,
- help clarify fit, usage, benefits, variants, or alternatives,
- be answerable using the catalog data for selectedProduct and/or similarProducts.

EXAMPLES OF GOOD ANGLES
(Only use angles actually supported by the data you see.)

- FIT & SUITABILITY
  - skinTypes, concerns, applicationAreas, ingredients
- USAGE & ROUTINE
  - frequency, layering, daytime vs nighttime
- VARIANTS & ALTERNATIVES
  - different SPF, scent, size, format, concern, price band
- BENEFITS & RESULTS
  - hydration, anti-aging, brightening, oil control, etc.

RULES
1. Dataset-driven only; use only values present in selectedProduct or similarProducts.
2. Product-focused and non-redundant; avoid shipping/returns/account/order topics.
3. Style: natural-language QUESTION, 6–14 words, no numbering/labels.
4. Output ONLY:
{
  "prompts": ["...", "...", "..."]
}
If you cannot create 3 distinct data-backed prompts, return 2 or 1.
Return the JSON object only (this message includes the word JSON).`;

      const payload = {
        userQuery: lastMessage,
        selectedProduct,
        similarProducts,
      };

      const result = await callLLM({
        messages: [
          { role: 'system', content: systemPrompt.trim() },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        purpose: 'followup_prompts_product',
        expectJson: true,
      });

      const parsed =
        typeof result.rawText === 'string' ? safeParse(result.rawText) : null;

      const prompts = Array.isArray(parsed?.prompts)
        ? parsed.prompts
            .map((p) => (p || '').trim())
            .filter(Boolean)
            .map((p) => truncateWords(p, 14))
            .slice(0, 3)
        : [];

      if (prompts.length > 0) {
        return NextResponse.json({ suggestions: prompts });
      }

      const fallback = buildProductFallback(selectedProduct, similarProducts);
      return NextResponse.json({ suggestions: fallback });
    }

    // Pull a small, real product set the LLM can rely on.
    // topProducts: newest 8 in-stock
    // candidateProducts: next 40 in-stock
    const [topProducts, candidateProducts] = await Promise.all([
      prisma.product.findMany({
        where: { stockStatus: { in: ['in_stock', 'low_stock'] } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          category: true,
          subcategory: true,
          brand: true,
          priceCents: true,
          attributes: true,
        },
        take: 8,
      }),
      prisma.product.findMany({
        where: { stockStatus: { in: ['in_stock', 'low_stock'] } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          category: true,
          subcategory: true,
          brand: true,
          priceCents: true,
          attributes: true,
        },
        skip: 8,
        take: 40,
      }),
    ]);

    const payload = {
      userQuery: lastMessage,
      topProducts,
      candidateProducts,
    };

    const systemPrompt = `
You are a shopping assistant that suggests follow-up search queries.

You will be given:
- userQuery: the shopper’s last message.
- topProducts: up to 8 products currently shown in the product card.
- candidateProducts: up to 40 additional relevant products from the catalog.

Each product may contain:
id, title, category, subcategory, productTypes, brand, priceCents,
and attributes such as ingredients, concerns, skinTypes, scents,
applicationAreas, formats, SPF, etc.

YOUR GOAL
Suggest 3 short follow-up search queries that:
- are GUARANTEED to match at least one product in (topProducts ∪ candidateProducts),
- stay in broadly the same category / productTypes as the products already shown,
- surface something NEW compared to the current top 8 products (different filters, facets, or angles).

RULES
1) Dataset-driven only: build suggestions only from values present in the provided products.
2) Similar family, not duplicates; introduce a new facet/angle present in candidates.
3) Style: concise 4–6 words, natural-language search phrases, no trailing punctuation.
4) Output ONLY JSON:
{
  "prompts": ["...", "...", "..."]
}
If you cannot find 3 distinct valid suggestions without guessing, return 2 or 1.
`;

    const result = await callLLM({
      messages: [
        { role: 'system', content: systemPrompt.trim() },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
      purpose: 'followup_prompts',
      expectJson: true,
    });

    const parsed =
      typeof result.rawText === 'string'
        ? safeParse(result.rawText)
        : null;

    const prompts = Array.isArray(parsed?.prompts)
      ? parsed!.prompts
          .map((p) => (p || '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];

    if (prompts.length > 0) {
      const concise = prompts.map((p) => truncateWords(p, 12));
      return NextResponse.json({ suggestions: concise });
    }

    // Fallback: derive quick, deterministic prompts from products (no LLM assumptions).
    const fallback = buildFallback(topProducts, candidateProducts).slice(0, 3);
    return NextResponse.json({ suggestions: fallback });
  } catch (error) {
    console.error('[suggestions] error:', error);
    return NextResponse.json({ suggestions: ['popular picks', 'top rated', 'new arrivals'] });
  }
}

function truncateWords(str: string, maxWords: number): string {
  const words = str.split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

function safeParse(text: string): { prompts?: string[] } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildFallback(
  top: Array<{ title: string | null; category: string | null; subcategory: string | null; attributes: any }>,
  candidates: Array<{ title: string | null; category: string | null; subcategory: string | null; attributes: any }>,
): string[] {
  const products = [...top, ...candidates];
  const categories = new Set<string>();
  const facets = new Set<string>();

  products.forEach((p) => {
    if (p.category) categories.add(p.category);
    if (p.subcategory) categories.add(p.subcategory);
    const attrs = p.attributes as Record<string, any> | null;
    if (attrs) {
      ['ingredients', 'concerns', 'skinTypes', 'scents', 'applicationAreas', 'formats', 'SPF'].forEach((key) => {
        const val = (attrs as any)[key];
        if (Array.isArray(val)) val.forEach((v) => typeof v === 'string' && facets.add(v));
        else if (typeof val === 'string') facets.add(val);
      });
    }
  });

  const cat = Array.from(categories).filter(Boolean).slice(0, 3);
  const facet = Array.from(facets).filter(Boolean).slice(0, 3);

  const suggestions: string[] = [];
  if (cat[0] && facet[0]) suggestions.push(`${cat[0]} with ${facet[0]}`);
  if (cat[1] && facet[1]) suggestions.push(`${cat[1]} for ${facet[1]}`);
  if (cat[0]) suggestions.push(`${cat[0]} under $100`);

  return suggestions
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildProductFallback(
  selected: { title: string | null; category: string | null; subcategory: string | null; attributes: any },
  similar: Array<{ title: string | null; category: string | null; subcategory: string | null; attributes: any }>,
): string[] {
  const category = selected.category || selected.subcategory || 'this product';
  const attrs = selected.attributes as Record<string, any> | null;

  const skinType =
    (attrs?.skinTypes && Array.isArray(attrs.skinTypes) && attrs.skinTypes[0]) ||
    (attrs?.skinType as string | undefined);
  const concern =
    (attrs?.concerns && Array.isArray(attrs.concerns) && attrs.concerns[0]) ||
    (attrs?.concern as string | undefined);
  const scent =
    (attrs?.scents && Array.isArray(attrs.scents) && attrs.scents[0]) ||
    (attrs?.scent as string | undefined);
  const spf =
    (attrs?.SPF && (Array.isArray(attrs.SPF) ? attrs.SPF[0] : attrs.SPF)) as string | number | undefined;
  const format =
    (attrs?.formats && Array.isArray(attrs.formats) && attrs.formats[0]) ||
    (attrs?.format as string | undefined);
  const size =
    (attrs?.size as string | undefined) ||
    ((attrs?.sizes && Array.isArray(attrs.sizes) && attrs.sizes[0]) as string | undefined);

  const similarHas = (key: string, value: string) =>
    similar.some((p) => {
      const pa = p.attributes as any;
      if (!pa) return false;
      const v = pa[key];
      if (Array.isArray(v)) return v.some((x) => typeof x === 'string' && x.toLowerCase() === value.toLowerCase());
      if (typeof v === 'string') return v.toLowerCase() === value.toLowerCase();
      return false;
    });

  const prompts: string[] = [];
  if (skinType) {
    prompts.push(`Is this good for ${skinType}?`);
  } else if (concern) {
    prompts.push(`Does this help with ${concern}?`);
  }

  if (format && similarHas('formats', format as string)) {
    prompts.push(`Is there a ${format} version?`);
  } else if (scent && similarHas('scents', scent as string)) {
    prompts.push(`Other scents like ${scent}?`);
  }

  if (spf) {
    prompts.push(`Do you have this with SPF ${spf}?`);
  } else if (size) {
    prompts.push(`Is there a travel-size option?`);
  } else {
    prompts.push(`Any similar ${category} under $50?`);
  }

  return prompts
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Generate dataset-aware default suggestions based on vertical and available facets
 */
function getDefaultSuggestions(
  datasetContext: { vertical?: string | null } | null,
  popularCategories: string[],
  priceTiers: Array<{ label: string; max: number }>,
): string[] {
  const vertical = datasetContext?.vertical;
  const priceLabel = priceTiers.length > 0 ? priceTiers[0].label : 'under $50';
  
  // Filter out apparel-specific categories when vertical is unknown
  const apparelCategoryTerms = ['jeans', 'pants', 'dress', 'dresses', 'tops', 'shirts', 'blazer', 'jacket'];
  const nonApparelCategories = popularCategories.filter(cat => 
    !apparelCategoryTerms.some(term => cat.toLowerCase().includes(term))
  );
  const topCategory = (vertical ? popularCategories[0] : nonApparelCategories[0]) || 'products';

  if (vertical === 'skincare' || vertical === 'beauty') {
    return [
      `moisturizer ${priceLabel}`,
      'serum for dry skin',
      'night routine products',
    ];
  } else if (vertical === 'home' || vertical === 'home decor' || vertical === 'furniture') {
    return [
      `${topCategory} ${priceLabel}`,
      'bathroom essentials',
      'bedroom decor',
    ];
  } else if (vertical === 'apparel' || vertical === 'fashion') {
    return [
      'flare jeans under $50',
      'dresses date night under $200',
      'skinny jeans under $100',
    ];
  } else {
    // Generic fallback - avoid using apparel categories when vertical is unknown
    if (vertical) {
      // Vertical is known but not one of the above - use top category
      return [
        `${topCategory} ${priceLabel}`,
        'popular items',
        'best sellers',
      ];
    } else {
      // Vertical is unknown - use completely generic suggestions
      return [
        'popular items',
        'best sellers',
        'featured products',
      ];
    }
  }
}

/**
 * Strips filler phrases from search prompts
 * Removes common phrases like "search for", "look for", "I want", "show me", "what are the best", etc.
 * Returns only the key product/category/attribute content.
 */
function stripFillerPhrases(prompt: string): string {
  if (!prompt) return prompt;
  
  let cleaned = prompt.trim();
  
  // Remove trailing periods, question marks, and other punctuation first
  cleaned = cleaned.replace(/[.,;!?]+$/, '').trim();
  
  // Comprehensive list of filler patterns to remove from the start
  // Order matters - more specific patterns first, then general ones
  const fillerPatterns = [
    // Very specific patterns first
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
    // General patterns
    /^(all\s+)?(the\s+)?/i, // Remove "all" or "all the" at the start
  ];
  
  // Keep removing patterns until no more matches (handles overlapping patterns)
  let maxIterations = 10; // Safety limit
  let changed = true;
  while (changed && maxIterations > 0) {
    const beforeLength = cleaned.length;
    for (const pattern of fillerPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    changed = cleaned.length < beforeLength;
    maxIterations--;
  }
  
  // Remove trailing filler phrases
  cleaned = cleaned.replace(/\s+(please|thanks|thank\s+you|or\s+refine)$/i, '').trim();
  
  // Remove leading "the" or "a" if it's the first word (after removing other fillers)
  cleaned = cleaned.replace(/^(the|a|an)\s+/i, '').trim();
  
  // Capitalize first letter for consistency
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

/**
 * Capitalizes the first letter of a string
 */
function capitalizeFirst(str: string): string {
  if (!str) return str;
  // Only change the very first character; preserve the rest so we
  // don't break brand names (e.g., "L'Occitane") or curated casing
  // coming from DatasetContext.recommendedSearchExamples.
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Formats a prompt to have proper capitalization and grammar
 */
function formatPrompt(prompt: string): string {
  // Trim whitespace
  let formatted = prompt.trim();
  
  // Capitalize first letter
  formatted = capitalizeFirst(formatted);
  
  // Ensure proper capitalization for common words
  // Fix common lowercase issues
  formatted = formatted.replace(/\bi\b/g, 'I');
  formatted = formatted.replace(/\b(under|for|in|with|from|made)\s+\$(\d+)/gi, (match, word, num) => {
    return `${word} $${num}`;
  });
  
  // Ensure proper capitalization after periods/exclamation/question marks
  formatted = formatted.replace(/([.!?])\s*([a-z])/g, (match, punct, letter) => {
    return `${punct} ${letter.toUpperCase()}`;
  });
  
  return formatted;
}

/**
 * Generates dataset-aware prompts based on the last user message when LLM fails
 * Extracts relevant categories, attributes, and constraints from the message
 * and combines them with catalog data to create relevant prompts
 */
async function generateMessageBasedPrompts(
  lastMessage: string,
  ontology: { categories?: string[] },
  popularCategories: string[],
  popularColors: string[],
  popularFits: string[],
  popularOccasions: string[],
  genders: string[],
  priceTiers: Array<{ label: string; max: number }>,
  datasetContext: { vertical?: string | null; sampleCategories?: string[]; primaryFacets?: string[] } | null,
  existingSuggestions: string[],
): Promise<string[]> {
  const prompts: string[] = [];
  const messageLower = lastMessage.toLowerCase();
  
  // Extract price constraints from message
  const priceMatch = lastMessage.match(/\$(\d+)|under\s+\$(\d+)|below\s+\$(\d+)/i);
  const priceConstraint = priceMatch ? priceMatch[1] || priceMatch[2] || priceMatch[3] : null;
  const priceTier = priceConstraint && priceTiers.length > 0
    ? priceTiers.find(t => parseInt(priceConstraint) <= t.max) || priceTiers[0]
    : priceTiers.length > 0 ? priceTiers[0] : null;
  
  // Find matching categories from the message
  const allCategories = [
    ...popularCategories,
    ...(datasetContext?.sampleCategories || []),
    ...(ontology.categories || []),
  ];
  const matchingCategories = allCategories.filter(cat => {
    const catLower = cat.toLowerCase();
    const messageWords = messageLower.split(/\s+/);
    return messageWords.some(word => catLower.includes(word) || word.includes(catLower)) ||
           catLower.includes(messageLower.split(/\s+/)[0]);
  });
  const categoriesToUse = matchingCategories.length > 0 
    ? Array.from(new Set(matchingCategories)).slice(0, 3)
    : (datasetContext?.sampleCategories?.slice(0, 3) || popularCategories.slice(0, 3));
  
  // Find matching colors
  const matchingColors = popularColors.filter(color => 
    messageLower.includes(color.toLowerCase())
  );
  
  // Query products to get actual attribute values
  const attributeSamples = await prisma.product.findMany({
    where: {
      stockStatus: { in: ['in_stock', 'low_stock'] },
      ...(categoriesToUse.length > 0 ? {
        category: { in: categoriesToUse },
      } : {}),
    },
    select: { attributes: true },
    take: 50,
  });
  
  // Extract actual attribute values from products
  const actualAttributes: Record<string, Set<string>> = {};
  attributeSamples.forEach(p => {
    const attrs = p.attributes as any;
    if (attrs) {
      ['usage_contexts', 'benefits', 'compatibility', 'style_tags'].forEach(attrKey => {
        if (Array.isArray(attrs[attrKey])) {
          if (!actualAttributes[attrKey]) actualAttributes[attrKey] = new Set();
          attrs[attrKey].forEach((val: string) => {
            if (typeof val === 'string' && val.trim()) {
              actualAttributes[attrKey].add(val.toLowerCase().trim());
            }
          });
        }
      });
    }
  });
  
  // Extract attributes/benefits from message
  const primaryFacets = datasetContext?.primaryFacets || [];
  const extractedAttributes: string[] = [];
  
  // Check message against actual catalog attributes
  Object.values(actualAttributes).forEach(attrSet => {
    attrSet.forEach(attr => {
      if (messageLower.includes(attr) || attr.includes(messageLower.split(/\s+/)[0])) {
        extractedAttributes.push(attr);
      }
    });
  });
  
  // Also check for common attribute keywords
  const attributeKeywords = [
    'dry', 'oily', 'sensitive', 'normal', 'combination',
    'moisturizing', 'hydrating', 'anti-aging', 'brightening',
    'fragrance-free', 'vegan', 'organic', 'natural',
    'casual', 'formal', 'office', 'beach', 'winter', 'summer',
  ];
  
  attributeKeywords.forEach(keyword => {
    if (messageLower.includes(keyword) && !extractedAttributes.includes(keyword)) {
      extractedAttributes.push(keyword);
    }
  });
  
  // Generate prompts based on extracted information
  if (categoriesToUse.length > 0) {
    const category = categoriesToUse[0];
    
    // Category + Price
    if (priceTier) {
      prompts.push(`${category} ${priceTier.label}`);
    }
    
    // Category + Attribute + Price
    if (extractedAttributes.length > 0 && priceTier) {
      const attr = extractedAttributes[0];
      prompts.push(`${category} for ${attr}${priceTier ? ` ${priceTier.label}` : ''}`);
    }
    
    // Category + Color (if color mentioned)
    if (matchingColors.length > 0) {
      prompts.push(`${category} ${matchingColors[0]}${priceTier ? ` ${priceTier.label}` : ''}`);
    }
    
    // Category + Primary Facet from dataset
    if (primaryFacets.length > 0 && extractedAttributes.length === 0) {
      const facetValue = actualAttributes[primaryFacets[0].toLowerCase()] 
        ? Array.from(actualAttributes[primaryFacets[0].toLowerCase()])[0]
        : primaryFacets[0];
      prompts.push(`${category} for ${facetValue}${priceTier ? ` ${priceTier.label}` : ''}`);
    }
    
    // Second category variation
    if (categoriesToUse.length > 1) {
      const secondCategory = categoriesToUse[1];
      if (priceTier) {
        prompts.push(`${secondCategory} ${priceTier.label}`);
      } else if (extractedAttributes.length > 0) {
        prompts.push(`${secondCategory} for ${extractedAttributes[0]}`);
      }
    }
  }
  
  // If we still don't have enough prompts, use dataset-aware defaults
  if (prompts.length < 3) {
    const defaultSuggestions = getDefaultSuggestions(datasetContext, popularCategories, priceTiers);
    prompts.push(...defaultSuggestions.filter(s => !prompts.includes(s)).slice(0, 3 - prompts.length));
  }
  
  // Remove duplicates, format, and return
  return Array.from(new Set(prompts))
    .map(formatPrompt)
    .slice(0, 3);
}

/**
 * Generates follow-up prompts based on the last user message using OpenAI
 */
async function generateFollowUpPrompts(
  lastMessage: string,
  ontology: { categories?: string[] },
  popularCategories: string[],
  popularColors: string[],
  popularFits: string[],
  popularOccasions: string[],
  genders: string[],
  priceTiers: Array<{ label: string; max: number }>,
  datasetContext: { vertical?: string | null; sampleCategories?: string[]; primaryFacets?: string[]; recommendedSearchExamples?: string[] } | null,
): Promise<string[]> {
  // Build comprehensive catalog context
  const catalogContext = `
Available categories: ${popularCategories.slice(0, 15).join(', ')}
Available colors: ${popularColors.slice(0, 15).join(', ')}
${popularFits.length > 0 ? `Available fits/styles: ${popularFits.slice(0, 10).join(', ')}` : ''}
${popularOccasions.length > 0 ? `Available occasions: ${popularOccasions.slice(0, 10).join(', ')}` : ''}
${genders.length > 0 ? `Available genders: ${genders.slice(0, 5).join(', ')}` : ''}
Price ranges: ${priceTiers.map(t => t.label).join(', ')}
`.trim();

  // Build vertical-specific context with dataset information
  const vertical = datasetContext?.vertical;
  const verticalContext = vertical
    ? `This catalog focuses on ${vertical} products.`
    : 'This catalog contains products across multiple categories.';
  
  const primaryFacets = datasetContext?.primaryFacets || [];
  const facetsContext = primaryFacets.length > 0
    ? `Key attributes customers care about: ${primaryFacets.slice(0, 8).join(', ')}.`
    : '';

  const sampleCategories = datasetContext?.sampleCategories || [];
  const sampleCategoriesContext = sampleCategories.length > 0
    ? `Sample categories in this catalog: ${sampleCategories.slice(0, 10).join(', ')}.`
    : '';

  const recommendedExamples = datasetContext?.recommendedSearchExamples || [];
  const examplesContext = recommendedExamples.length > 0
    ? `Example search queries that work well: ${recommendedExamples.slice(0, 5).map(ex => `"${ex}"`).join(', ')}.`
    : '';

  // Build industry-agnostic assistant description
  let assistantDescription = 'a shopping assistant helping users find products';
  if (vertical === 'skincare' || vertical === 'beauty' || vertical === 'health & beauty') {
    assistantDescription = 'a beauty assistant helping users find skincare and beauty products';
  } else if (vertical === 'home' || vertical === 'home decor') {
    assistantDescription = 'a home assistant helping users find home decor and furnishings';
  } else if (vertical === 'apparel' || vertical === 'fashion') {
    assistantDescription = 'a shopping assistant helping users find fashion items';
  }

  const prompt = `You are ${assistantDescription}. Based on the user's last message, generate 3 detailed and specific follow-up search prompts that would help them refine or explore related items.

${verticalContext}
${facetsContext}
${sampleCategoriesContext}
${examplesContext}

User's last message: "${lastMessage}"

${catalogContext}

Generate 3 follow-up prompts that are:
1. Highly relevant to what the user just asked about (build on their query)
2. DETAILED and SPECIFIC (6-12 words, include relevant attributes, benefits, use cases, or constraints)
3. Properly capitalized with correct grammar (first word capitalized, proper nouns capitalized)
4. Include specific attributes when appropriate (e.g., "for dry skin", "under $50", "citrus-scented", "vegan", "sensitive skin")
5. Different from each other (vary the angle: refine with different attributes, explore alternatives, add price/style constraints)
6. Use language and terminology appropriate for ${vertical || 'this catalog'}

CRITICAL RULES:
- NEVER include filler phrases like "show me", "find", "looking for", "search for", "I want", "get me", "help me find"
- Start directly with the product/category/attribute
- Make prompts DETAILED and SPECIFIC - include relevant attributes, benefits, use cases, price constraints, or style details
- Use actual categories, attributes, and terms from the catalog context above
- Each prompt should be distinct and offer a different exploration path

${examplesContext ? `Use these example patterns as inspiration: ${recommendedExamples.slice(0, 3).map(ex => `"${ex}"`).join(', ')}` : ''}

${vertical === 'skincare' || vertical === 'beauty' || vertical === 'health & beauty'
  ? 'Examples: "moisturizer for dry skin under $40", "night routine serum with hyaluronic acid", "sensitive skin cleanser fragrance-free"'
  : vertical === 'home' || vertical === 'home decor'
  ? 'Examples: "bathroom towels under $50 soft and absorbent", "minimalist bedroom decor neutral colors", "spa-like essentials for relaxation"'
  : vertical === 'apparel' || vertical === 'fashion'
  ? 'Examples: "flare jeans under $50 high-waisted", "black straight leg jeans for casual wear", "wide leg pants in neutral colors"'
  : popularCategories.length > 0
  ? `Examples: "${popularCategories[0]} ${primaryFacets.length > 0 ? `for ${primaryFacets[0]}` : ''} ${priceTiers.length > 0 ? priceTiers[0].label : ''}", "${popularCategories.length > 1 ? popularCategories[1] : popularCategories[0]} ${primaryFacets.length > 1 ? `with ${primaryFacets[1]}` : ''}", "${popularCategories[0]} ${popularColors.length > 0 ? popularColors[0] : ''} ${priceTiers.length > 0 ? priceTiers[0].label : ''}"`
  : 'Examples: "popular items with great reviews", "best sellers under $100", "featured products for daily use"'
}

Format: Return ONLY a JSON array of exactly 3 strings, no other text.
${vertical === 'skincare' || vertical === 'beauty' || vertical === 'health & beauty'
  ? 'Example: ["moisturizer for dry skin under $40", "night routine serum with hyaluronic acid", "sensitive skin cleanser fragrance-free"]'
  : vertical === 'home' || vertical === 'home decor'
  ? 'Example: ["bathroom towels under $50 soft and absorbent", "minimalist bedroom decor neutral colors", "spa-like essentials for relaxation"]'
  : vertical === 'apparel' || vertical === 'fashion'
  ? 'Example: ["flare jeans under $50 high-waisted", "black straight leg jeans for casual wear", "wide leg pants in neutral colors"]'
  : popularCategories.length > 0
  ? `Example: ["${popularCategories[0]} ${primaryFacets.length > 0 ? `for ${primaryFacets[0]}` : ''} ${priceTiers.length > 0 ? priceTiers[0].label : ''}", "${popularCategories.length > 1 ? popularCategories[1] : popularCategories[0]} ${primaryFacets.length > 1 ? `with ${primaryFacets[1]}` : ''}", "${popularCategories[0]} ${popularColors.length > 0 ? popularColors[0] : ''} ${priceTiers.length > 0 ? priceTiers[0].label : ''}"]`
  : 'Example: ["popular items with great reviews", "best sellers under $100", "featured products for daily use"]'
}

Return the JSON array:`;

  try {
    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are a helpful shopping assistant that generates relevant follow-up search prompts.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'final_reply',
      expectJson: false,
    });

    // Parse the response - try to extract JSON array
    const text = result.rawText.trim();
    
    // Try to find JSON array in the response
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          // Format each prompt for proper capitalization and grammar
          return parsed
            .slice(0, 3)
            .filter((p): p is string => typeof p === 'string' && p.length > 0)
            .map(formatPrompt);
        }
      } catch {
        // Fall through to line-by-line parsing
      }
    }

    // Fallback: try to parse line-by-line if it's a list
    const lines = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.match(/^[0-9]+\./))
      .slice(0, 3);
    
    if (lines.length >= 3) {
      // Format each prompt for proper capitalization and grammar
      return lines.map(formatPrompt);
    }

    // Last resort: return empty to fall back to catalog suggestions
    return [];
  } catch (error) {
    console.error('Error calling LLM for follow-up prompts:', error);
    return [];
  }
}

