/**
 * Reply Generator
 * 
 * Generates natural language replies for fashion queries.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import type { SearchResultItem } from '../search/types';
import type { FashionConstraints } from './classifier';

export type ReplyResult = {
  replyText: string; // First 2 paragraphs (before product cards)
  replyTextAfter?: string; // Last 2 paragraphs (after product cards)
};

function extractAttr(attrs: Record<string, unknown>, key: string): string | null {
  const val = attrs[key];
  if (Array.isArray(val) && val.length > 0) {
    return String(val[0]);
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return null;
}

const REPLY_PROMPT = `Generate a witty, funny, helpful, and honest reply for a fashion shopping assistant.

USER QUERY: "{QUERY}"

CONSTRAINTS EXTRACTED:
{CONSTRAINTS}

PRODUCTS TO SHOW (exactly 4):
{PRODUCT_DETAILS}

Generate EXACTLY 4 short paragraphs (1-2 lines each), separated by EXACTLY TWO newlines (\\n\\n):

PARAGRAPH 1 (Before products): Show you understand the user's query with a witty or funny acknowledgment
PARAGRAPH 2 (Before products): Explain WHY these 4 products were chosen - back it up with specific product attributes (materials, styles, occasions, colors, etc.) from PRODUCTS TO SHOW
PARAGRAPH 3 (After products): Provide more specific product details or honest observations about the matches with humor
PARAGRAPH 4 (After products): Closing line that's helpful and inviting

CRITICAL FORMATTING - YOU MUST FOLLOW THIS EXACTLY:
- Use EXACTLY 4 paragraphs - NO MORE, NO LESS
- Separate each paragraph with EXACTLY TWO newlines (\\n\\n) - this is critical for parsing
- Each paragraph should be 1-2 lines max
- Paragraphs 1-2 will appear BEFORE product cards
- Paragraphs 3-4 will appear AFTER product cards
- DO NOT use single newlines between paragraphs - use double newlines
- DO NOT add extra blank lines or spacing

STYLE GUIDELINES:
- Be witty and show personality, but stay helpful
- Reference actual product facts (materials, styles, occasions, colors from the product details)
- Show you understand what the user is looking for
- Be honest about matches - if something is close but not perfect, acknowledge it with humor
- Don't invent discounts, promotions, or stock information
- Keep paragraphs short and scannable

Example structure:
"Oh, I see what you're going for! [witty observation about their query].

I've picked these 4 because [specific reason with product facts like sizes, materials, styles].

[More specific product details or honest observations with humor].

[Closing line that's helpful and inviting]."`;

export async function generateReply(
  query: string,
  constraints: FashionConstraints,
  products: SearchResultItem[],
  brandName: string = 'LoveShackFancy'
): Promise<ReplyResult> {
  try {
    const constraintsText = Object.entries(constraints)
      .filter(([_, value]) => value !== null && value !== undefined && (Array.isArray(value) ? value.length > 0 : true))
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: ${value.join(', ')}`;
        }
        return `${key}: ${value}`;
      })
      .join('\n') || 'None specified';

    // Format product details for the LLM
    const productDetails = products.map((product, index) => {
      const attrs = product.attributes || {};
      const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style') || 'N/A';
      const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion') || 'N/A';
      const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern') || 'N/A';
      const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material') || 'N/A';
      const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length') || 'N/A';
      const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color') || 'N/A';
      const price = product.salePriceCents 
        ? `$${(product.salePriceCents / 100).toFixed(2)} (was $${(product.priceCents / 100).toFixed(2)})`
        : `$${(product.priceCents / 100).toFixed(2)}`;
      
      return `Product ${index + 1}: "${product.title}"
- Style: ${style}
- Occasion: ${occasion}
- Material: ${material}
- Pattern: ${pattern}
- Length: ${length}
- Color: ${color}
- Price: ${price}
- Category: ${product.category}`;
    }).join('\n\n');

    const prompt = REPLY_PROMPT
      .replace('{QUERY}', query)
      .replace('{CONSTRAINTS}', constraintsText)
      .replace('{PRODUCT_DETAILS}', productDetails);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: `You are a witty, funny, helpful, and honest fashion shopping assistant for ${brandName}. You understand what users are looking for and can correlate their queries to specific products. You back up your recommendations with actual product facts (materials, styles, occasions, colors, etc.). You're concise, use short paragraphs (1-2 lines), and show personality while being genuinely helpful. You're honest about matches - if something doesn't perfectly match, you acknowledge it with humor. CRITICAL: Always generate exactly 4 paragraphs separated by double newlines (\\n\\n).`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'final_reply',
      expectJson: false,
    });

    const fullReply = result.rawText.trim();
    
    // Split into paragraphs (try double newlines first, then single newlines as fallback)
    let paragraphs = fullReply.split(/\n\n+/).filter(p => p.trim().length > 0);
    
    // If we don't have enough paragraphs with double newlines, try splitting by single newlines
    // and grouping into logical paragraphs (2+ sentences per paragraph)
    if (paragraphs.length < 4) {
      const singleNewlineSplit = fullReply.split(/\n/).filter(p => p.trim().length > 0);
      // Group consecutive lines into paragraphs (each paragraph should be 1-2 lines)
      paragraphs = [];
      let currentParagraph = '';
      for (const line of singleNewlineSplit) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // If current paragraph is empty or short, add this line
        if (!currentParagraph || currentParagraph.split(/[.!?]/).length < 2) {
          currentParagraph = currentParagraph ? `${currentParagraph} ${trimmedLine}` : trimmedLine;
        } else {
          // Current paragraph is complete, start a new one
          paragraphs.push(currentParagraph);
          currentParagraph = trimmedLine;
        }
      }
      if (currentParagraph) {
        paragraphs.push(currentParagraph);
      }
    }
    
    // First 2 paragraphs go before products, last 2 go after
    // If we have fewer than 4 paragraphs, try to split what we have intelligently
    let replyTextBefore: string;
    let replyTextAfter: string | undefined;
    
    if (paragraphs.length >= 4) {
      // Ideal case: exactly 4 paragraphs
      replyTextBefore = paragraphs.slice(0, 2).join('\n\n').trim();
      replyTextAfter = paragraphs.slice(2, 4).join('\n\n').trim();
    } else if (paragraphs.length === 3) {
      // 3 paragraphs: first 2 before, last 1 after
      replyTextBefore = paragraphs.slice(0, 2).join('\n\n').trim();
      replyTextAfter = paragraphs[2].trim();
    } else if (paragraphs.length === 2) {
      // 2 paragraphs: first before, second after (better than nothing)
      replyTextBefore = paragraphs[0].trim();
      replyTextAfter = paragraphs[1].trim();
    } else {
      // Only 1 paragraph or none: put all before products
      replyTextBefore = fullReply;
      replyTextAfter = undefined;
    }
    
    // Log for debugging
    logger.debug('reply_split_result', {
      totalParagraphs: paragraphs.length,
      replyTextBeforeLength: replyTextBefore.length,
      replyTextAfterLength: replyTextAfter?.length || 0,
      hasReplyTextAfter: !!replyTextAfter && replyTextAfter.trim().length > 0,
    });
    
    return {
      replyText: replyTextBefore,
      replyTextAfter: replyTextAfter && replyTextAfter.trim().length > 0 ? replyTextAfter : undefined,
    };
  } catch (error) {
    logger.error('reply_generation_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 100),
    });

    // Fallback reply
    return {
      replyText: `I found ${products.length} piece${products.length !== 1 ? 's' : ''} that match your search. Here are some options:`,
      replyTextAfter: undefined,
    };
  }
}

/**
 * Generate a regretful, witty reply when no products are found or confidence is too low
 */
export async function generateRegretfulReply(
  userQuery: string,
  productCount: number,
  topScore: number,
  brandName: string
): Promise<ReplyResult> {
  try {
    const prompt = `The user searched for: "${userQuery}".
We found ${productCount} products, with the top product having a relevance score of ${topScore.toFixed(2)}.
This is a low confidence recommendation, or we didn't find enough products that match the query intent.

Generate a witty, smart, and regretful reply in the tone of a helpful shopping assistant for ${brandName}.
Acknowledge the user's request, express regret for not finding perfect matches, and offer to help further.
Keep it concise, 2-3 short paragraphs (1-2 lines each). Do NOT recommend any products.
Example tone: "Oh dear, it seems we're having a bit of a treasure hunt today! While I couldn't unearth a perfect trove of ${userQuery} just yet, don't you fret. Our collection is always growing, and I'm here to help you explore other fabulous finds or refine your quest. What else can I assist you with?"`;

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: `You are a witty, smart, and helpful shopping assistant for ${brandName}. Your task is to generate a regretful reply when perfect product matches are not found. Be honest, concise, and maintain a playful yet helpful tone. Keep it to 2-3 short paragraphs (1-2 lines each).`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'final_reply',
      maxTokens: 200,
    });

    const fullReply = result.rawText.trim();
    const paragraphs = fullReply.split(/\n\n+/).filter(p => p.trim().length > 0);
    const replyText = paragraphs.slice(0, 2).join('\n\n').trim(); // Take first 2 paragraphs

    return {
      replyText,
      replyTextAfter: paragraphs.slice(2).join('\n\n').trim() || undefined, // Remaining paragraphs
    };
  } catch (error) {
    logger.error('regretful_reply_generation_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: userQuery.substring(0, 100),
    });

    // Fallback reply
    return {
      replyText: `I couldn't find perfect matches for "${userQuery}" in our collection right now. Our inventory is always changing, so feel free to try different search terms or browse our categories. How else can I help you?`,
      replyTextAfter: undefined,
    };
  }
}
