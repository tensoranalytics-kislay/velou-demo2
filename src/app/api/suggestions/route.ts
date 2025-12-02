import { NextRequest, NextResponse } from 'next/server';
import { getCatalogOntology } from '@/lib/search/ontology';
import { prisma } from '@/lib/db';
import { callLLM } from '@/lib/llm/provider';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';

/**
 * GET /api/suggestions?lastMessage=...
 * Returns catalog-based suggested search prompts
 * If lastMessage is provided, generates follow-up prompts using the lightweight OpenAI helper model
 * Otherwise, returns random initial suggestions
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lastMessage = searchParams.get('lastMessage');
  try {
    const [ontology, datasetContext] = await Promise.all([
      getCatalogOntology(),
      getDatasetContext(),
    ]);
    
    // Debug logging to check DatasetContext
    console.log('[suggestions] DatasetContext loaded:', {
      hasContext: !!datasetContext,
      vertical: datasetContext?.vertical,
      hasRecommendedExamples: !!datasetContext?.recommendedSearchExamples?.length,
      recommendedExamples: datasetContext?.recommendedSearchExamples,
      hasSampleCategories: !!datasetContext?.sampleCategories?.length,
      sampleCategories: datasetContext?.sampleCategories,
      hasPrimaryFacets: !!datasetContext?.primaryFacets?.length,
      primaryFacets: datasetContext?.primaryFacets,
    });

    const recommendedExamples = datasetContext?.recommendedSearchExamples ?? [];

    // If this is an initial request (no lastMessage) and we have
    // high-quality recommended examples from DatasetContext, prefer
    // returning those directly. This keeps the chat pills aligned
    // with the Dataset Profile card in the admin UI.
    if (!lastMessage && recommendedExamples.length > 0) {
      const cleaned = recommendedExamples.map(stripFillerPhrases).filter(p => p.length > 0);
      const unique = Array.from(new Set(cleaned)).slice(0, 5);
      
      // Debug logging
      console.log('[suggestions] Cleaning recommended examples:', {
        original: recommendedExamples.slice(0, 3),
        cleaned: unique.slice(0, 3),
      });
      
      return NextResponse.json({ suggestions: unique });
    }
    
    // Get price ranges from catalog
    const priceStats = await prisma.product.aggregate({
      where: {
        stockStatus: { in: ['in_stock', 'low_stock'] },
      },
      _min: { priceCents: true },
      _max: { priceCents: true },
      _avg: { priceCents: true },
    });

    const minPrice = priceStats._min.priceCents ?? 0;
    const maxPrice = priceStats._max.priceCents ?? 0;
    const avgPrice = priceStats._avg.priceCents ?? 0;

    // Calculate price tiers
    const priceTiers = [
      { label: 'under $50', max: 5000 },
      { label: 'under $100', max: 10000 },
      { label: 'under $200', max: 20000 },
    ].filter(tier => tier.max <= maxPrice);

    // Get popular categories (most common in catalog)
    // Note: groupBy doesn't support filtering nulls directly, so we'll filter after
    const allCategoryCounts = await prisma.product.groupBy({
      by: ['category'],
      where: {
        stockStatus: { in: ['in_stock', 'low_stock'] },
      },
      _count: { category: true },
    });

    // Filter out null categories and sort by count descending
    const categoryCounts = allCategoryCounts
      .filter(c => c.category !== null)
      .sort((a, b) => (b._count.category ?? 0) - (a._count.category ?? 0))
      .slice(0, 10);

    const popularCategories = categoryCounts
      .map(c => c.category)
      .filter((cat): cat is string => Boolean(cat))
      .slice(0, 6);

    // Get popular colors
    const popularColors = ontology.colors.slice(0, 8);

    // Get popular genders
    const genders = ontology.genders.filter(g => 
      ['mens', 'womens', 'male', 'female', 'unisex'].includes(g.toLowerCase())
    );

    const vertical = datasetContext?.vertical;
    // Only treat as apparel if explicitly set to apparel/fashion
    // If vertical is null/undefined, we don't know, so use generic logic
    const isApparel = vertical === 'apparel' || vertical === 'fashion';
    const isKnownVertical = Boolean(vertical);
    
    // Only extract fit/occasion if vertical is apparel/fashion
    const popularFits = new Set<string>();
    const popularOccasions = new Set<string>();
    
    if (isApparel) {
      // Get fit/styles from product attributes (apparel-specific)
      const fitSamples = await prisma.product.findMany({
        where: {
          stockStatus: { in: ['in_stock', 'low_stock'] },
        },
        select: { attributes: true },
        take: 200,
      });

      fitSamples.forEach(p => {
        const attrs = p.attributes as any;
        if (attrs?.fit) {
          const fit = String(attrs.fit).toLowerCase();
          // Include common fit terms
          if (['skinny', 'slim', 'straight', 'relaxed', 'wide', 'flare', 'flared', 'bootcut', 'boyfriend', 'mom', 'high rise', 'mid rise', 'low rise'].some(term => fit.includes(term))) {
            popularFits.add(fit);
          }
        }
      });

      // Get occasions from product attributes (apparel-specific)
      const occasionSamples = await prisma.product.findMany({
        where: {
          stockStatus: { in: ['in_stock', 'low_stock'] },
        },
        select: { attributes: true },
        take: 200,
      });

      occasionSamples.forEach(p => {
        const attrs = p.attributes as any;
        if (attrs?.occasion) {
          const occasion = String(attrs.occasion).toLowerCase();
          popularOccasions.add(occasion);
        }
      });
    } else {
      // For non-apparel, extract usage_contexts or style_tags if available
      const contextSamples = await prisma.product.findMany({
        where: {
          stockStatus: { in: ['in_stock', 'low_stock'] },
        },
        select: { attributes: true },
        take: 200,
      });

      contextSamples.forEach(p => {
        const attrs = p.attributes as any;
        // Extract usage_contexts (for skincare, home, etc.)
        if (Array.isArray(attrs?.usage_contexts)) {
          attrs.usage_contexts.forEach((ctx: string) => {
            if (typeof ctx === 'string' && ctx.trim()) {
              popularOccasions.add(ctx.toLowerCase().trim());
            }
          });
        }
        // Extract style_tags
        if (Array.isArray(attrs?.style_tags)) {
          attrs.style_tags.forEach((tag: string) => {
            if (typeof tag === 'string' && tag.trim()) {
              popularOccasions.add(tag.toLowerCase().trim());
            }
          });
        }
      });
    }

    const primaryFacets = datasetContext?.primaryFacets || [];
    
    // Only use apparel-specific logic if vertical is apparel/fashion
    let fitArray: string[] = [];
    let occasionArray: string[] = [];
    
    if (isApparel) {
      // Common occasions if not in DB (apparel-specific)
      const commonOccasions = ['date night', 'office', 'beach wedding', 'casual', 'formal', 'party', 'vacation', 'work'];
      commonOccasions.forEach(occ => popularOccasions.add(occ));

      // Common fit terms (apparel-specific)
      const commonFits = ['flare', 'skinny', 'straight', 'wide leg', 'bootcut', 'relaxed', 'slim'];
      commonFits.forEach(fit => popularFits.add(fit));

      fitArray = Array.from(popularFits).slice(0, 10);
      occasionArray = Array.from(popularOccasions).slice(0, 10);
    } else {
      // For non-apparel, use usage_contexts or style_tags from attributes if available
      // This would require querying products, but for now we'll skip fit/occasion logic
    }

    // Generate suggestions based on actual catalog data and dataset context
    const suggestions: string[] = [];
    
    // First, check if we have recommendedSearchExamples from DatasetContext
    // These are LLM-generated examples based on the actual catalog
    if (datasetContext?.recommendedSearchExamples?.length) {
      // Use the recommended examples as primary suggestions, stripping filler phrases
      suggestions.push(
        ...datasetContext.recommendedSearchExamples
          .map(stripFillerPhrases)
          .filter(p => p.length > 0)
          .slice(0, 3)
      );
    }

    // If we don't have enough suggestions yet, generate from catalog data
    if (suggestions.length < 3) {
      if (isApparel) {
      // Apparel-specific suggestions
      // Style + Category + Gender + Price (e.g., "flare jeans under $50")
      if (fitArray.length > 0 && popularCategories.length > 0 && genders.length > 0 && priceTiers.length > 0) {
        const fit = fitArray[0];
        const category = popularCategories.find(cat => 
          ['jeans', 'pants', 'dress', 'dresses'].some(term => cat.toLowerCase().includes(term))
        ) || popularCategories[0];
        const priceTier = priceTiers[0];
        suggestions.push(`${fit} ${category} ${priceTier.label}`);
      }

      // Category + Occasion + Price (e.g., "dresses date night under $200")
      const occasionCategories = popularCategories.filter(cat => 
        ['dress', 'dresses', 'blazer', 'blazers', 'jacket', 'jackets', 'top', 'tops'].some(term => 
          cat.toLowerCase().includes(term)
        )
      );
      if (occasionCategories.length > 0 && occasionArray.length > 0 && priceTiers.length > 0) {
        const category = occasionCategories[0];
        const occasion = occasionArray[0];
        const priceTier = priceTiers[priceTiers.length - 1];
        suggestions.push(`${category} ${occasion} ${priceTier.label}`);
      }

      // Style + Category + Gender (e.g., "skinny jeans women")
      if (fitArray.length > 1 && popularCategories.length > 1 && genders.length > 0) {
        const fit = fitArray[1];
        const category = popularCategories.find(cat => 
          ['jeans', 'pants'].some(term => cat.toLowerCase().includes(term))
        ) || popularCategories[1];
        const gender = genders.length > 1 && (genders[1] === 'mens' || genders[1] === 'male') ? 'men' : 'women';
        suggestions.push(`${fit} ${category} ${gender}`);
      }

      // Category + Color + Occasion (e.g., "dresses navy office")
      if (popularCategories.length > 0 && popularColors.length > 0 && occasionArray.length > 1) {
        const category = popularCategories[0];
        const color = popularColors[0];
        const occasion = occasionArray[1];
        suggestions.push(`${category} ${color} ${occasion}`);
      }

      // Style + Category + Price (e.g., "straight leg jeans under $100")
      if (fitArray.length > 2 && popularCategories.length > 0 && priceTiers.length > 1) {
        const fit = fitArray[2];
        const category = popularCategories.find(cat => 
          ['jeans', 'pants'].some(term => cat.toLowerCase().includes(term))
        ) || popularCategories[0];
        const priceTier = priceTiers[1];
        suggestions.push(`${fit} ${category} ${priceTier.label}`);
      }

      // Category + Gender + Occasion (e.g., "tops women office")
      if (popularCategories.length > 1 && genders.length > 0 && occasionArray.length > 2) {
        const category = popularCategories[1];
        const gender = genders[0] === 'mens' || genders[0] === 'male' ? 'men' : 'women';
        const occasion = occasionArray[2];
        suggestions.push(`${category} ${gender} ${occasion}`);
      }

      // Style + Category + Occasion (e.g., "wide leg pants casual")
      if (fitArray.length > 0 && popularCategories.length > 2 && occasionArray.length > 0) {
        const fit = fitArray[0];
        const category = popularCategories[2];
        const occasion = occasionArray[0];
        suggestions.push(`${fit} ${category} ${occasion}`);
      }
      }
    } else {
      // Non-apparel or unknown vertical - generate suggestions from actual catalog data
      // Use sampleCategories from DatasetContext if available, otherwise use popularCategories
      const categoriesToUse = datasetContext?.sampleCategories?.length 
        ? datasetContext.sampleCategories.slice(0, 6)
        : popularCategories;
      
      // Use primaryFacets from DatasetContext
      const facetsToUse = datasetContext?.primaryFacets || [];
      
      // Query products to get actual attribute values from the catalog
      const attributeSamples = await prisma.product.findMany({
        where: {
          stockStatus: { in: ['in_stock', 'low_stock'] },
        },
        select: { attributes: true },
        take: 100,
      });
      
      // Extract actual attribute values from products
      const actualAttributes: Record<string, Set<string>> = {};
      attributeSamples.forEach(p => {
        const attrs = p.attributes as any;
        if (attrs) {
          // Extract usage_contexts, style_tags, benefits, compatibility, etc.
          if (Array.isArray(attrs.usage_contexts)) {
            if (!actualAttributes['usage_contexts']) actualAttributes['usage_contexts'] = new Set();
            attrs.usage_contexts.forEach((ctx: string) => {
              if (typeof ctx === 'string' && ctx.trim()) {
                actualAttributes['usage_contexts'].add(ctx.toLowerCase().trim());
              }
            });
          }
          if (Array.isArray(attrs.style_tags)) {
            if (!actualAttributes['style_tags']) actualAttributes['style_tags'] = new Set();
            attrs.style_tags.forEach((tag: string) => {
              if (typeof tag === 'string' && tag.trim()) {
                actualAttributes['style_tags'].add(tag.toLowerCase().trim());
              }
            });
          }
          if (Array.isArray(attrs.benefits)) {
            if (!actualAttributes['benefits']) actualAttributes['benefits'] = new Set();
            attrs.benefits.forEach((benefit: string) => {
              if (typeof benefit === 'string' && benefit.trim()) {
                actualAttributes['benefits'].add(benefit.toLowerCase().trim());
              }
            });
          }
          if (attrs.compatibility && Array.isArray(attrs.compatibility)) {
            if (!actualAttributes['compatibility']) actualAttributes['compatibility'] = new Set();
            attrs.compatibility.forEach((comp: string) => {
              if (typeof comp === 'string' && comp.trim()) {
                actualAttributes['compatibility'].add(comp.toLowerCase().trim());
              }
            });
          }
        }
      });
      
      // Generate suggestions using actual catalog data
      // Category + Attribute + Price
      if (categoriesToUse.length > 0 && priceTiers.length > 0) {
        const category = categoriesToUse[0];
        const priceTier = priceTiers[0];
        
        // Try to add a relevant attribute if available
        if (facetsToUse.length > 0 && actualAttributes[facetsToUse[0]]?.size > 0) {
          const attributeValue = Array.from(actualAttributes[facetsToUse[0]])[0];
          suggestions.push(`${category} ${attributeValue} ${priceTier.label}`);
        } else if (actualAttributes['usage_contexts']?.size > 0) {
          const usageContext = Array.from(actualAttributes['usage_contexts'])[0];
          suggestions.push(`${category} for ${usageContext} ${priceTier.label}`);
        } else {
          suggestions.push(`${category} ${priceTier.label}`);
        }
      }
      
      // Category + Primary Facet (from DatasetContext)
      if (categoriesToUse.length > 0 && facetsToUse.length > 0) {
        const category = categoriesToUse[0];
        const facet = facetsToUse[0].toLowerCase();
        if (actualAttributes[facet]?.size > 0) {
          const facetValue = Array.from(actualAttributes[facet])[0];
          suggestions.push(`${category} ${facetValue}`);
        } else {
          suggestions.push(`${category} ${facet}`);
        }
      }
      
      // Category + Color + Price (if colors available)
      if (categoriesToUse.length > 0 && popularColors.length > 0 && priceTiers.length > 0) {
        const category = categoriesToUse.length > 1 ? categoriesToUse[1] : categoriesToUse[0];
        const color = popularColors[0];
        const priceTier = priceTiers[0];
        suggestions.push(`${category} ${color} ${priceTier.label}`);
      }
      
      // Category + Benefit/Compatibility (for skincare, etc.)
      if (categoriesToUse.length > 0) {
        const category = categoriesToUse.length > 2 ? categoriesToUse[2] : categoriesToUse[0];
        if (actualAttributes['benefits']?.size > 0) {
          const benefit = Array.from(actualAttributes['benefits'])[0];
          suggestions.push(`${category} for ${benefit}`);
        } else if (actualAttributes['compatibility']?.size > 0) {
          const compatibility = Array.from(actualAttributes['compatibility'])[0];
          suggestions.push(`${category} for ${compatibility}`);
        } else if (actualAttributes['usage_contexts']?.size > 0) {
          const usageContext = Array.from(actualAttributes['usage_contexts'])[0];
          suggestions.push(`${category} for ${usageContext}`);
        }
      }
    }

    // Generate dataset-aware default suggestions
    const defaultSuggestions = getDefaultSuggestions(datasetContext, popularCategories, priceTiers);

    // If lastMessage is provided, generate follow-up prompts via the lightweight OpenAI helper
    if (lastMessage && lastMessage.trim()) {
      try {
        const followUpPrompts = await generateFollowUpPrompts(lastMessage, ontology, popularCategories, popularColors, fitArray, occasionArray, genders, priceTiers, datasetContext);
        if (followUpPrompts.length >= 3) {
          return NextResponse.json({ suggestions: followUpPrompts.slice(0, 3) });
        }
        // Fall through to catalog-based suggestions if LLM fails
      } catch (error) {
        console.error('Error generating follow-up prompts:', error);
        // Fall through to catalog-based suggestions
      }
    }

    // Combine suggestions and defaults, prioritizing dataset-specific suggestions
    // If we have recommendedSearchExamples, they're already in suggestions
    // Otherwise, use catalog-generated suggestions + defaults as fallback
    let finalSuggestions = suggestions;
    
    // If we have catalog-generated suggestions, use them (even if vertical is unknown)
    // Only use generic defaults if we have NO suggestions from catalog data
    if (finalSuggestions.length === 0) {
      // No suggestions from catalog - use dataset-aware defaults
      if (defaultSuggestions.length > 0) {
        finalSuggestions = defaultSuggestions;
      } else {
        // Last resort: try to generate from actual categories if available
        if (popularCategories.length > 0 && priceTiers.length > 0) {
          finalSuggestions = [
            `${popularCategories[0]} ${priceTiers[0].label}`,
            popularCategories.length > 1 ? `${popularCategories[1]} ${priceTiers[0].label}` : 'popular items',
            popularCategories.length > 2 ? `${popularCategories[2]} ${priceTiers[0].label}` : 'best sellers',
          ].filter(Boolean).slice(0, 3);
        } else {
          // Absolute last resort: generic fallback
          finalSuggestions = ['popular items', 'best sellers', 'featured products'];
        }
      }
    } else if (finalSuggestions.length < 3) {
      // We have some suggestions but need more - add defaults
      if (defaultSuggestions.length > 0) {
        finalSuggestions = [...finalSuggestions, ...defaultSuggestions].slice(0, 3);
      }
    }
    
    // Filter out any apparel-specific suggestions if vertical is known and NOT apparel
    if (isKnownVertical && !isApparel && finalSuggestions.length > 0) {
      const apparelTerms = ['jeans', 'pants', 'dress', 'dresses', 'flare', 'skinny', 'straight leg', 'wide leg', 'bootcut', 'date night', 'tops', 'shirts'];
      const hasApparelTerms = finalSuggestions.some(s => {
        const sLower = s.toLowerCase();
        return apparelTerms.some(term => sLower.includes(term));
      });
      
      if (hasApparelTerms) {
        // Remove apparel-specific suggestions and fill with defaults
        finalSuggestions = finalSuggestions.filter(s => {
          const sLower = s.toLowerCase();
          return !apparelTerms.some(term => sLower.includes(term));
        });
        
        // Fill remaining slots with defaults
        if (finalSuggestions.length < 3 && defaultSuggestions.length > 0) {
          finalSuggestions = [...finalSuggestions, ...defaultSuggestions].slice(0, 3);
        }
      }
    }
    
    // Strip filler phrases, format for proper capitalization and grammar
    const cleaned = finalSuggestions.map(stripFillerPhrases).filter(p => p.length > 0);
    const formatted = cleaned.map(formatPrompt);
    const uniqueSuggestions = Array.from(new Set(formatted)).slice(0, 3);

    return NextResponse.json({ suggestions: uniqueSuggestions });
  } catch (error) {
    console.error('Error generating suggestions:', error);
    // Return dataset-aware default suggestions on error
    const datasetContext = await getDatasetContext().catch(() => null);
    const defaultSuggestions = getDefaultSuggestions(datasetContext, [], []);
    return NextResponse.json({
      suggestions: defaultSuggestions.slice(0, 3),
    });
  }
}

/**
 * Generate dataset-aware default suggestions based on vertical and available facets
 */
function getDefaultSuggestions(
  datasetContext: Awaited<ReturnType<typeof getDatasetContext>>,
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
 * Generates follow-up prompts based on the last user message using OpenAI
 */
async function generateFollowUpPrompts(
  lastMessage: string,
  ontology: Awaited<ReturnType<typeof getCatalogOntology>>,
  popularCategories: string[],
  popularColors: string[],
  popularFits: string[],
  popularOccasions: string[],
  genders: string[],
  priceTiers: Array<{ label: string; max: number }>,
  datasetContext: Awaited<ReturnType<typeof getDatasetContext>>,
): Promise<string[]> {
  // Build context about available catalog items
  const catalogContext = `
Available categories: ${popularCategories.slice(0, 10).join(', ')}
Available colors: ${popularColors.slice(0, 10).join(', ')}
Available fits/styles: ${popularFits.slice(0, 10).join(', ')}
Available occasions: ${popularOccasions.slice(0, 10).join(', ')}
Available genders: ${genders.slice(0, 5).join(', ')}
Price ranges: ${priceTiers.map(t => t.label).join(', ')}
`.trim();

  // Build vertical-specific context
  const vertical = datasetContext?.vertical;
  const verticalContext = vertical
    ? `This catalog focuses on ${vertical} products.`
    : 'This catalog contains products across multiple categories.';
  
  const primaryFacets = datasetContext?.primaryFacets || [];
  const facetsContext = primaryFacets.length > 0
    ? `Key attributes customers care about: ${primaryFacets.slice(0, 5).join(', ')}.`
    : '';

  // Build industry-agnostic assistant description
  let assistantDescription = 'a shopping assistant helping users find products';
  if (vertical === 'skincare' || vertical === 'beauty') {
    assistantDescription = 'a beauty assistant helping users find skincare and beauty products';
  } else if (vertical === 'home' || vertical === 'home decor') {
    assistantDescription = 'a home assistant helping users find home decor and furnishings';
  } else if (vertical === 'apparel' || vertical === 'fashion') {
    assistantDescription = 'a shopping assistant helping users find fashion items';
  }

  const prompt = `You are ${assistantDescription}. Based on the user's last message, generate 3 relevant follow-up search prompts that would help them refine or explore related items.

${verticalContext}
${facetsContext}

User's last message: "${lastMessage}"

${catalogContext}

User's last message: "${lastMessage}"

${catalogContext}

Generate 3 follow-up prompts that are:
1. Relevant to what the user just asked about
2. VERY CONCISE (3-5 words maximum, no filler words)
3. Properly capitalized with correct grammar (first word capitalized, proper nouns capitalized)
4. Specific with style, gender, occasion, or price when appropriate
5. Different from each other (vary the angle: refine, explore alternatives, add constraints)

CRITICAL: Keep prompts SHORT - maximum 5 words. NEVER include filler phrases like "show me", "find", "looking for", "search for", "I want", "get me". Start directly with the product/category. Use language appropriate for ${vertical || 'the catalog'}. Examples:
${vertical === 'skincare' || vertical === 'beauty' 
  ? '- "moisturizer for dry skin"\n- "night routine serum"\n- "sensitive skin cleanser"'
  : vertical === 'home' || vertical === 'home decor'
  ? '- "bathroom towels under $50"\n- "minimalist bedroom decor"\n- "spa-like essentials"'
  : '- "flare jeans under $50"\n- "black straight leg jeans"\n- "wide leg pants casual"'
}

Format: Return ONLY a JSON array of exactly 3 strings, no other text.
Example: ["flare jeans under $50", "black straight leg jeans", "wide leg pants casual"]

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

