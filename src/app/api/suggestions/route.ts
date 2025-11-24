import { NextRequest, NextResponse } from 'next/server';
import { getCatalogOntology } from '@/lib/search/ontology';
import { prisma } from '@/lib/db';
import { callLLM } from '@/lib/llm/provider';

/**
 * GET /api/suggestions?lastMessage=...
 * Returns catalog-based suggested search prompts
 * If lastMessage is provided, generates follow-up prompts using Perplexity
 * Otherwise, returns random initial suggestions
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lastMessage = searchParams.get('lastMessage');
  try {
    const ontology = await getCatalogOntology();
    
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

    // Get fit/styles from product attributes
    // Query products and filter in memory since Prisma JSON path queries can be complex
    const fitSamples = await prisma.product.findMany({
      where: {
        stockStatus: { in: ['in_stock', 'low_stock'] },
      },
      select: { attributes: true },
      take: 200,
    });

    const popularFits = new Set<string>();
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

    // Get occasions from product attributes
    const occasionSamples = await prisma.product.findMany({
      where: {
        stockStatus: { in: ['in_stock', 'low_stock'] },
      },
      select: { attributes: true },
      take: 200,
    });

    const popularOccasions = new Set<string>();
    occasionSamples.forEach(p => {
      const attrs = p.attributes as any;
      if (attrs?.occasion) {
        const occasion = String(attrs.occasion).toLowerCase();
        popularOccasions.add(occasion);
      }
    });

    // Common occasions if not in DB
    const commonOccasions = ['date night', 'office', 'beach wedding', 'casual', 'formal', 'party', 'vacation', 'work'];
    commonOccasions.forEach(occ => popularOccasions.add(occ));

    // Common fit terms
    const commonFits = ['flare', 'skinny', 'straight', 'wide leg', 'bootcut', 'relaxed', 'slim'];
    commonFits.forEach(fit => popularFits.add(fit));

    const fitArray = Array.from(popularFits).slice(0, 10);
    const occasionArray = Array.from(popularOccasions).slice(0, 10);

    // Generate specific suggestions with style, gender, occasion, and price
    const suggestions: string[] = [];

    // Style + Category + Gender + Price (e.g., "flare jeans under $50")
    if (fitArray.length > 0 && popularCategories.length > 0 && genders.length > 0 && priceTiers.length > 0) {
      const fit = fitArray[0];
      const category = popularCategories.find(cat => 
        ['jeans', 'pants', 'dress', 'dresses'].some(term => cat.toLowerCase().includes(term))
      ) || popularCategories[0];
      const priceTier = priceTiers[0]; // Lowest tier for more specific
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
      const priceTier = priceTiers[priceTiers.length - 1]; // Highest tier
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
      const priceTier = priceTiers[1]; // Middle tier
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

    // Fallback to default suggestions if we don't have enough catalog data (specific with occasion/style/gender/price)
    const defaultSuggestions = [
      'flare jeans under $50',
      'dresses date night under $200',
      'skinny jeans under $100',
      'tops navy office',
    ];

    // If lastMessage is provided, generate follow-up prompts using Perplexity
    if (lastMessage && lastMessage.trim()) {
      try {
        const followUpPrompts = await generateFollowUpPrompts(lastMessage, ontology, popularCategories, popularColors, fitArray, occasionArray, genders, priceTiers);
        if (followUpPrompts.length >= 3) {
          return NextResponse.json({ suggestions: followUpPrompts.slice(0, 3) });
        }
        // Fall through to catalog-based suggestions if LLM fails
      } catch (error) {
        console.error('Error generating follow-up prompts:', error);
        // Fall through to catalog-based suggestions
      }
    }

    // Combine catalog-based and default, remove duplicates, limit to 3
    // Format all suggestions for proper capitalization and grammar
    const allSuggestions = [...suggestions, ...defaultSuggestions]
      .map(formatPrompt);
    const uniqueSuggestions = Array.from(new Set(allSuggestions)).slice(0, 3);

    return NextResponse.json({ suggestions: uniqueSuggestions });
  } catch (error) {
    console.error('Error generating suggestions:', error);
    // Return default suggestions on error (specific with occasion/style/gender/price)
    return NextResponse.json({
      suggestions: [
        'flare jeans under $50',
        'dresses date night under $200',
        'skinny jeans under $100',
      ],
    });
  }
}

/**
 * Capitalizes the first letter of a string
 */
function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
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
 * Generates follow-up prompts based on the last user message using Perplexity
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

  const prompt = `You are a shopping assistant helping users find fashion items. Based on the user's last message, generate 3 relevant follow-up search prompts that would help them refine or explore related items.

User's last message: "${lastMessage}"

${catalogContext}

Generate 3 follow-up prompts that are:
1. Relevant to what the user just asked about
2. VERY CONCISE (3-5 words maximum, no filler words)
3. Properly capitalized with correct grammar (first word capitalized, proper nouns capitalized)
4. Specific with style, gender, occasion, or price when appropriate
5. Different from each other (vary the angle: refine, explore alternatives, add constraints)

CRITICAL: Keep prompts SHORT - maximum 5 words. Remove unnecessary words like "show me", "find", "looking for" when possible. Examples:
- "flare jeans under $50"
- "black straight leg jeans"
- "wide leg pants casual"

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

