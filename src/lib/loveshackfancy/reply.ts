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

export type ReplyContext = {
  isFollowUp?: boolean;
  currentQuery?: string; // Most recent user query
  previousQuery?: string; // Previous query in the conversation
  enhancedQuery?: string; // Enhanced/merged query used for search
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

/**
 * Extract product details for reply generation based on category
 * Dynamically extracts relevant attributes for different product categories
 */
function extractProductDetailsForReply(
  product: SearchResultItem,
  category: string,
  constraints: FashionConstraints,
  index: number
): string {
  const attrs = product.attributes || {};
  const price = product.salePriceCents 
    ? `$${(product.salePriceCents / 100).toFixed(2)} (was $${(product.priceCents / 100).toFixed(2)})`
    : `$${(product.priceCents / 100).toFixed(2)}`;
  
  const categoryLower = category?.toLowerCase() || '';
  const details: string[] = [];
  
  // Always include title, category, and price
  details.push(`Product ${index + 1}: "${product.title}"`);
  details.push(`Category: ${product.category}`);
  details.push(`Price: ${price}`);
  
  // Category-specific attribute extraction
  if (categoryLower.includes('perfume') || categoryLower.includes('fragrance') || categoryLower === 'candle') {
    // Perfumes and Candles: Extract scent notes, occasion
    const scent = extractAttr(attrs, 'scent') || extractAttr(attrs, 'Scent') || 
                  extractAttr(attrs, 'scent_notes') || extractAttr(attrs, 'notes') ||
                  extractAttr(attrs, 'sensory_profile') || 'N/A';
    const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion') || 
                     extractAttr(attrs, 'usage_contexts') || 'N/A';
    const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color') || 'N/A';
    
    details.push(`Scent: ${scent}`);
    details.push(`Occasion: ${occasion}`);
    if (color !== 'N/A') details.push(`Color: ${color}`);
  } else if (categoryLower.includes('interior') || categoryLower.includes('bedding') || 
             categoryLower.includes('bathroom') || categoryLower.includes('tabletop') ||
             categoryLower.includes('kitchen') || categoryLower.includes('decorative')) {
    // Home Decor: Extract room type, size, style, color, material
    const roomType = extractAttr(attrs, 'room_type') || extractAttr(attrs, 'Room Type') ||
                     extractAttr(attrs, 'usage_contexts') || 'N/A';
    const size = extractAttr(attrs, 'Size') || extractAttr(attrs, 'size') ||
                 extractAttr(attrs, 'dimensions') || 'N/A';
    const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style') ||
                  extractAttr(attrs, 'style_tags') || 'N/A';
    const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color') || 'N/A';
    const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material') || 'N/A';
    
    if (roomType !== 'N/A') details.push(`Room Type: ${roomType}`);
    if (size !== 'N/A') details.push(`Size: ${size}`);
    if (style !== 'N/A') details.push(`Style: ${style}`);
    if (color !== 'N/A') details.push(`Color: ${color}`);
    if (material !== 'N/A') details.push(`Material: ${material}`);
  } else if (categoryLower.includes('accessor') || categoryLower.includes('jewelry') ||
             categoryLower.includes('hair') || categoryLower.includes('tote') ||
             categoryLower.includes('phone') || categoryLower.includes('soap') ||
             categoryLower.includes('makeup')) {
    // Accessories: Extract use cases, materials, occasion, style
    const useCases = extractAttr(attrs, 'usage_contexts') || extractAttr(attrs, 'Use Cases') || 'N/A';
    const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material') || 'N/A';
    const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion') || 'N/A';
    const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style') ||
                  extractAttr(attrs, 'style_tags') || 'N/A';
    const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color') || 'N/A';
    
    if (useCases !== 'N/A') details.push(`Use Cases: ${useCases}`);
    if (material !== 'N/A') details.push(`Material: ${material}`);
    if (occasion !== 'N/A') details.push(`Occasion: ${occasion}`);
    if (style !== 'N/A') details.push(`Style: ${style}`);
    if (color !== 'N/A') details.push(`Color: ${color}`);
  } else if (categoryLower.includes('towel') || categoryLower.includes('stationary') ||
             categoryLower.includes('pet')) {
    // Towels, Stationary, Pets: Extract size, material, use cases
    const size = extractAttr(attrs, 'Size') || extractAttr(attrs, 'size') ||
                 extractAttr(attrs, 'dimensions') || 'N/A';
    const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material') || 'N/A';
    const useCases = extractAttr(attrs, 'usage_contexts') || extractAttr(attrs, 'Use Cases') || 'N/A';
    const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color') || 'N/A';
    
    if (size !== 'N/A') details.push(`Size: ${size}`);
    if (material !== 'N/A') details.push(`Material: ${material}`);
    if (useCases !== 'N/A') details.push(`Use Cases: ${useCases}`);
    if (color !== 'N/A') details.push(`Color: ${color}`);
  } else {
    // Apparel (default): Extract fashion-specific attributes
    const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style') || 'N/A';
    const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion') || 'N/A';
    const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern') || 'N/A';
    const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material') || 'N/A';
    const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length') || 'N/A';
    const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color') || 'N/A';
    const fit = extractAttr(attrs, 'Fit') || extractAttr(attrs, 'fit') || 'N/A';
    const season = extractAttr(attrs, 'Season') || extractAttr(attrs, 'season') || 'N/A';
    
    if (style !== 'N/A') details.push(`Style: ${style}`);
    if (occasion !== 'N/A') details.push(`Occasion: ${occasion}`);
    if (material !== 'N/A') details.push(`Material: ${material}`);
    if (pattern !== 'N/A') details.push(`Pattern: ${pattern}`);
    if (length !== 'N/A') details.push(`Length: ${length}`);
    if (color !== 'N/A') details.push(`Color: ${color}`);
    if (fit !== 'N/A') details.push(`Fit: ${fit}`);
    if (season !== 'N/A') details.push(`Season: ${season}`);
  }
  
  // Fallback: If no category-specific attributes found, try unified attributes
  if (details.length === 3) { // Only title, category, price
    const styleTags = extractAttr(attrs, 'style_tags') || extractAttr(attrs, 'Style Tags') || null;
    const usageContexts = extractAttr(attrs, 'usage_contexts') || extractAttr(attrs, 'Usage Contexts') || null;
    const benefits = extractAttr(attrs, 'benefits') || extractAttr(attrs, 'Benefits') || null;
    const sensoryProfile = extractAttr(attrs, 'sensory_profile') || extractAttr(attrs, 'Sensory Profile') || null;
    
    if (styleTags) details.push(`Style Tags: ${styleTags}`);
    if (usageContexts) details.push(`Use Cases: ${usageContexts}`);
    if (benefits) details.push(`Benefits: ${benefits}`);
    if (sensoryProfile) details.push(`Sensory Profile: ${sensoryProfile}`);
  }
  
  // If still no attributes, add description snippet
  if (details.length === 3 && product.description) {
    const descSnippet = product.description.substring(0, 150).trim();
    if (descSnippet) {
      details.push(`Description: ${descSnippet}${product.description.length > 150 ? '...' : ''}`);
    }
  }
  
  return details.join('\n');
}

const REPLY_PROMPT = `Generate a reply in LoveShackFancy's brand voice: soft-glam, poetic confidence—romantic and nostalgic, but always polished. Speak in scenes and sensations (golden hour, garden parties, moonlit evenings) rather than hard selling. Use airy, feminine language that feels like a love letter without becoming childish or overly precious. The tone should be warm, intimate, and celebratory—inviting them into a dreamy world of ruffles, lace, and heirloom details—while keeping high-end restraint: elegant, curated, and subtly cheeky, with feeling-first storytelling of a modern muse.

USER QUERY: "{QUERY}"
{FOLLOW_UP_CONTEXT}

CONSTRAINTS EXTRACTED:
{CONSTRAINTS}

PRODUCTS TO SHOW (exactly {PRODUCT_COUNT}):
{PRODUCT_DETAILS}

Generate a well-organized reply with multiple short paragraphs, separated by EXACTLY TWO newlines (\\n\\n):

STRUCTURE:
- Paragraphs 1-2 (Before products): Write with soft-glam, poetic confidence. Paint scenes and sensations—think golden hour moments, garden party elegance, moonlit evenings. Use airy, feminine language that feels intimate and celebratory. CRITICAL: Explicitly acknowledge each constraint mentioned in the query (colors, styles, occasions, sizes, materials, etc.) through poetic language. Show understanding of what each constraint means for the user—for example, if they mentioned "lavender scents," show you understand they want fragrance, not color. If they mentioned "teenage daughter," show you understand age-appropriate styling. If they mentioned "muslim wedding," show you understand modesty requirements. Weave these acknowledgments naturally into the feeling-first storytelling—don't list them mechanically, but show comprehension through scenes and sensations. Mention key details through feeling-first storytelling. If there's previous context, weave it in naturally like a muse sharing a dream. Aim for 2 sentences per paragraph - poetic but polished, never childish or overly precious. Use shorter sentences (8-12 words). Be warm, intimate, elegant, and subtly cheeky. Write as if you're a modern muse naturally responding, NOT a bot or system - avoid any meta-references to "search", "query", "you searched for", etc.
- Paragraphs 3-{PRODUCT_COUNT_PLUS_2} (After products): Provide ONE separate paragraph for EACH of the {PRODUCT_COUNT} products - each paragraph should embody the soft-glam, poetic voice. Focus on that specific product through feeling-first storytelling. Paint how it works for them in scenes and sensations. Highlight key features through romantic, nostalgic language. CRITICAL: Show how THIS specific product addresses the parts of their request—acknowledge which constraints it matches and why it works for what they need. Be honest about how well it fits - if it's close but not perfect, acknowledge that with elegant restraint. If it's a great fit, express that with celebratory warmth. Aim for 2 sentences per paragraph - airy and feminine, but polished. Use shorter sentences (8-12 words). Show the dreamy world of ruffles, lace, and heirloom details. Write like a modern muse, not like a system.
- Final paragraph (After products): Short closing line that's warm, inviting, elegant, and subtly cheeky - like a love letter's closing

CRITICAL FORMATTING:
- Use {TOTAL_PARAGRAPHS} paragraphs total (2 before products, {PRODUCT_COUNT} for individual products, 1 closing)
- Separate each paragraph with EXACTLY TWO newlines (\\n\\n)
- Before products: 2 sentences per paragraph (poetic but polished - feeling-first storytelling)
- After products: Each product gets its own paragraph (2 sentences each - soft-glam, romantic, nostalgic)
- Keep sentences SHORT and scannable - aim for 8-12 words per sentence
- Paragraphs 1-2 will appear BEFORE product cards
- Paragraphs 3-{PRODUCT_COUNT_PLUS_2} will appear AFTER product cards (one per product, in order)
- Final paragraph will appear AFTER product cards
- DO NOT use single newlines between paragraphs - use double newlines
- DO NOT use bullet points - write in flowing paragraphs
- DO NOT group multiple products in one paragraph - each product must have its own separate paragraph

STYLE GUIDELINES - LOVE SHACK FANCY BRAND VOICE:
- Soft-glam, poetic confidence: Write with romantic and nostalgic elegance, but always polished
- Speak in scenes and sensations: Use imagery like "golden hour", "garden parties", "moonlit evenings" - paint moments, not just features
- Airy, feminine language: Feel like a love letter - warm, intimate, celebratory - but never childish or overly precious
- Dreamy world: Invite them into ruffles, lace, and heirloom details through feeling-first storytelling
- High-end restraint: Elegant, curated, subtly cheeky - like a modern muse sharing secrets
- CRITICAL: Sound like a modern muse, NOT a bot or tech platform. Write as if you're naturally continuing an intimate conversation, not processing a search query.
- NEVER use phrases like "you searched for", "your query", "I found options matching your search", "based on your search", or any meta-reference to the search/query process
- Write naturally as if responding organically to what they said - like a muse would respond in person
- Avoid any language that makes it feel like a system or platform - no references to "search", "query", "results", "matching", etc.
- BEFORE PRODUCTS: Write with soft-glam, poetic confidence - 2 sentences per paragraph. Paint scenes and sensations. Use airy, feminine language that feels intimate and celebratory. Mention key details through feeling-first storytelling. Use shorter sentences (8-12 words). Be warm, intimate, elegant, and subtly cheeky. Write as if you're a modern muse naturally responding, not a system.
- AFTER PRODUCTS: Soft-glam, poetic voice - one paragraph per product with 2 sentences. Paint how each product works through scenes and sensations. Use romantic, nostalgic language. Be honest about fit with elegant restraint. Use shorter sentences (8-12 words). Show the dreamy world of ruffles, lace, and heirloom details. Write like a modern muse, not like a system.
- Respond through feeling-first storytelling in both before-products and after-products sections - mention key details (colors, sizes, occasions, etc.) through scenes and sensations
- Reference specific details (colors, sizes, occasions, etc.) through poetic, romantic language - provide context through feeling-first storytelling
- ACKNOWLEDGMENT REQUIREMENT: In your before-products paragraphs, explicitly acknowledge each part of their request—every color mentioned (and what it means for them), every style detail (and why it matters), every occasion (and what it requires), every size/material/constraint (and what it implies). Do this through poetic, feeling-first language—show understanding, don't just list. Make them believe you truly understand what they need by demonstrating comprehension of the meaning behind each aspect.
- Show that you understand what they need by painting moments and sensations - be detailed but balanced in both sections, like a muse would
- For each product paragraph after cards: Paint why that product matches through scenes and sensations, highlight key features through romantic language, show understanding through feeling-first storytelling, acknowledge which specific parts of their request this product addresses and why it works for those needs, and be honest about the match quality with elegant restraint. Use 2 sentences with shorter sentences (8-12 words) - soft-glam, poetic, warm, intimate. Show the dreamy world.
- Reference actual product facts (materials, styles, occasions, colors, scents, room types, etc.) through feeling-first storytelling - provide thoughtful context in both before-products (2 sentences per paragraph) and after-products (2 sentences per product)
- When mentioning product names, use the product name directly (e.g., "Mystara Satin Maxi Dress") - do NOT prefix with "The" (e.g., avoid "The Mystara Satin Maxi Dress")
- Be honest about matches with elegant restraint - acknowledge if something is close but not perfect, or if it's a great match, say so with celebratory warmth. Be honest in both before-products and after-products sections. Don't oversell or undersell - be authentic but poetic.
- Don't invent discounts, promotions, or stock information
- Keep each paragraph focused on one idea - both before-products and after-products should be detailed enough to show understanding through feeling-first storytelling
- Sound like a modern muse throughout - avoid robotic or overly formal language, but maintain high-end restraint
- Show understanding of different contexts (occasions, seasons, cultural considerations, etc.) through scenes and sensations, acknowledge them with elegant restraint

{FOLLOW_UP_PRIORITY}

Example structure (in LoveShackFancy brand voice):
"Picture yourself in golden hour light, wrapped in these [occasion/style/color/etc.] pieces. They're perfect for [scene/sensation] moments, with [key detail 1] and [key detail 2] that feel like a dream. [Acknowledge the meaning behind each constraint they mentioned—show you understand what they really need through poetic language.]

I've curated these for [occasion/style/color/etc.] - they're ideal for [scene/sensation] and will complement [previous context/current needs] like a love letter to your style. [Continue acknowledging each aspect of their request through poetic language.]

[After products - Paragraph 3: Product 1 - Soft-glam, poetic voice. Example: "Mystara Satin Maxi Dress captures that garden party elegance perfectly. The [color/material] dances in golden hour light, and while it's not exactly [specific detail if close match], it brings that [desired quality] you're dreaming of." - 2 sentences, shorter sentences (8-12 words), feeling-first storytelling, warm and intimate, acknowledging which parts of their request it addresses]

[After products - Paragraph 4: Product 2 - Similar soft-glam, poetic approach - romantic, nostalgic, elegant, subtly cheeky - 2 sentences, shorter sentences, acknowledging which parts of their request it addresses]

[After products - Paragraph 5: Product 3 - Similar soft-glam, poetic approach - romantic, nostalgic, elegant, subtly cheeky - 2 sentences, shorter sentences, acknowledging which parts of their request it addresses]

[After products - Paragraph 6: Product 4 - Similar soft-glam, poetic approach - romantic, nostalgic, elegant, subtly cheeky - 2 sentences, shorter sentences, acknowledging which parts of their request it addresses]

[Closing line - Paragraph 7: Short, warm, inviting, elegant, and subtly cheeky - like a love letter's closing].

Note: If there are fewer than 4 products, adjust the paragraph count accordingly - one paragraph per product after the first 2 introductory paragraphs."`;

const FOLLOW_UP_CONTEXT_TEMPLATE = `
FOLLOW-UP CONTEXT:
This is a follow-up to what they said before. They just said: "{CURRENT_QUERY}"
What they mentioned earlier: "{PREVIOUS_QUERY}"
Overall context: "{ENHANCED_QUERY}"

IMPORTANT: In your reply:
- Prioritize addressing what they just said ("{CURRENT_QUERY}") FIRST - give it more weight and direct response
- Acknowledge the overall context, but lead with what they just said
- Show you understand the MEANING behind each part of what they just said—acknowledge every aspect of their recent request through poetic language. Demonstrate comprehension of what they really need from their most recent message, not just what they said.
- Show you understand both what they just said and the overall conversation
- What they just said should be addressed more prominently in your opening paragraphs
- Still reference the overall context, but make what they just said the primary focus
- Write naturally like a human would respond, NOT like a system processing queries`;

const NEW_SEARCH_WITH_PREVIOUS_CONTEXT_TEMPLATE = `
PREVIOUS CONTEXT:
They were looking at: "{PREVIOUS_QUERY}"
What they're asking about now: "{CURRENT_QUERY}"

IMPORTANT: In your reply:
- This is a NEW topic (not a follow-up), but acknowledge what they were looking at before naturally
- Show you understand they were previously interested in "{PREVIOUS_QUERY}"
- Show you understand the MEANING behind each part of what they're asking about now—acknowledge every aspect of their current request through poetic language. Demonstrate comprehension of what they really need, not just what they said.
- Rationalize and justify the current recommendations in relation to what they were looking at before when relevant
- For example, if they were looking at dresses and now want tote bags, acknowledge that these tote bags would complement the dresses they were considering
- Keep the acknowledgment brief and natural - don't over-explain, just show awareness of the conversation flow
- What they're asking about now should be the primary focus, with what they were looking at before as supporting context
- Only acknowledge what they were looking at before if it's relevant to the current recommendations (e.g., complementary items, styling together)
- If what they were looking at before is completely unrelated, you can skip the acknowledgment
- Write naturally like a human would respond, NOT like a system processing searches`;

export async function generateReply(
  query: string,
  constraints: FashionConstraints,
  products: SearchResultItem[],
  brandName: string = 'LoveShackFancy',
  context?: ReplyContext,
  categories?: string[] // Top categories for attribute extraction
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

    // Format product details for the LLM using category-aware extraction
    const primaryCategory = categories && categories.length > 0 ? categories[0] : products[0]?.category || '';
    const productDetails = products.map((product, index) => {
      // Use the product's category if available, otherwise use primary category from classification
      const categoryForExtraction = product.category || primaryCategory;
      return extractProductDetailsForReply(product, categoryForExtraction, constraints, index);
    }).join('\n\n');

    // Calculate dynamic values for paragraph count
    const productCount = products.length;
    const totalParagraphs = 2 + productCount + 1; // 2 before + product count + 1 closing
    const productCountPlus2 = productCount + 2; // For "Paragraphs 3-X" notation

    // Build follow-up context if this is a follow-up OR if we have previous query context (for new searches)
    let followUpContext = '';
    let followUpPriority = '';
    
    if (context?.previousQuery) {
      if (context.isFollowUp) {
        // This is a follow-up - use the existing follow-up template
        const enhancedQueryText = context.enhancedQuery || query;
        followUpContext = FOLLOW_UP_CONTEXT_TEMPLATE
          .replace('{CURRENT_QUERY}', context.currentQuery || query)
          .replace('{PREVIOUS_QUERY}', context.previousQuery)
          .replace('{ENHANCED_QUERY}', enhancedQueryText);
        
        followUpPriority = `
PRIORITY FOR FOLLOW-UP REPLIES:
- Give MORE weight and direct response to what they just said: "${context.currentQuery || query}"
- Address what they just said FIRST in your opening paragraphs
- Acknowledge and show understanding of EACH part of what they just said—every color, style, occasion, size, material, and constraint they mentioned in their most recent message. Demonstrate comprehension of the MEANING behind each aspect—show you understand what they really need, not just what they said.
- Acknowledge the overall context, but lead with their most recent request
- Show you understand both what they just said and the overall conversation
- What they just said should be the primary focus, with the overall context as supporting information
- Write naturally like a human would respond, NOT like a system processing queries`;
      } else {
        // This is a new search but we have previous query context - acknowledge it
        followUpContext = NEW_SEARCH_WITH_PREVIOUS_CONTEXT_TEMPLATE
          .replace('{CURRENT_QUERY}', context.currentQuery || query)
          .replace('{PREVIOUS_QUERY}', context.previousQuery);
        
        followUpPriority = `
PRIORITY FOR NEW SEARCH WITH PREVIOUS CONTEXT:
- What they're asking about now ("${context.currentQuery || query}") is the PRIMARY focus
- Acknowledge and show understanding of EACH part of what they're asking about now—every color, style, occasion, size, material, and constraint they mentioned. Demonstrate comprehension of the MEANING behind each aspect—show you understand what they really need, not just what they said.
- Acknowledge what they were looking at before ("${context.previousQuery}") briefly and naturally
- Rationalize how the current recommendations relate to or complement what they were looking at before when relevant
- Keep the acknowledgment concise - one brief mention is enough
- Focus on why these products work well for what they need now
- Write naturally like a human would respond, NOT like a system processing searches`;
      }
    }

    const prompt = REPLY_PROMPT
      .replace('{QUERY}', query)
      .replace('{FOLLOW_UP_CONTEXT}', followUpContext)
      .replace('{FOLLOW_UP_PRIORITY}', followUpPriority)
      .replace('{CONSTRAINTS}', constraintsText)
      .replace('{PRODUCT_DETAILS}', productDetails)
      .replace(/{PRODUCT_COUNT}/g, String(productCount))
      .replace(/{PRODUCT_COUNT_PLUS_2}/g, String(productCountPlus2))
      .replace(/{TOTAL_PARAGRAPHS}/g, String(totalParagraphs));

    const systemPrompt = `You are a shopping assistant and style expert for ${brandName}, embodying the brand's soft-glam, poetic voice. You're an expert across all categories - fashion, home decor, beauty, accessories, and more. You understand what users are looking for and can correlate their queries to specific products through feeling-first storytelling. You back up your recommendations with actual product facts (materials, styles, occasions, colors, scents, room types, use cases, etc.), but always through scenes and sensations rather than hard selling.

ACKNOWLEDGMENT REQUIREMENT: You must acknowledge and show understanding of EACH part of the user's request. Demonstrate that you understand the MEANING behind every aspect—every color mentioned (and what it means for them), every style detail (and why it matters), every occasion (and what it requires), every constraint (and what it implies). Show comprehension through poetic, feeling-first language—don't just list constraints, but acknowledge them naturally through scenes and sensations. Make them believe you truly understand what they need.

BRAND VOICE - LOVE SHACK FANCY:
- Soft-glam, poetic confidence: Romantic and nostalgic, but always polished
- Speak in scenes and sensations: Use imagery like "golden hour", "garden parties", "moonlit evenings" - paint moments, not just features
- Airy, feminine language: Feel like a love letter - warm, intimate, celebratory - but never childish or overly precious
- Dreamy world: Invite them into ruffles, lace, and heirloom details through feeling-first storytelling
- High-end restraint: Elegant, curated, subtly cheeky - like a modern muse sharing secrets

STYLE:
- Write with soft-glam, poetic confidence - romantic and nostalgic, but always polished
- Paint scenes and sensations rather than hard selling - think golden hour moments, garden party elegance, moonlit evenings
- Use airy, feminine language that feels intimate and celebratory - like a love letter without being childish or overly precious
- Be warm, intimate, and celebratory - inviting them into a dreamy world of ruffles, lace, and heirloom details
- Maintain high-end restraint: elegant, curated, and subtly cheeky, with feeling-first storytelling of a modern muse
- CRITICAL: Write as if you're a MODERN MUSE, NOT a bot or tech platform. Sound like you're naturally continuing an intimate conversation, not processing a search query.
- NEVER use phrases like "you searched for", "your query", "I found options matching your search", "based on your search", or any meta-reference to the search/query process
- Write naturally as if responding organically to what they said - like a muse would respond in person
- Avoid any language that makes it feel like a system or platform - no references to "search", "query", "results", "matching", etc.
- Use SHORT, concise sentences - aim for 8-12 words per sentence
- Organize your reply with {TOTAL_PARAGRAPHS} paragraphs total (2 before products, {PRODUCT_COUNT} for individual products, 1 closing)
- Before products: 2 sentences per paragraph (poetic but polished - feeling-first storytelling through scenes and sensations)
- After products: Each product gets its own paragraph with 2 sentences (soft-glam, romantic, nostalgic, warm, intimate, elegant, subtly cheeky)
- Show the dreamy world through feeling-first storytelling, but maintain high-end restraint
- Before products: Write with soft-glam, poetic confidence - 2 sentences per paragraph. Paint scenes and sensations. Use airy, feminine language that feels intimate and celebratory. Acknowledge EACH part of their request—show you understand the meaning behind every color, style, occasion, size, material, and constraint they mentioned. Do this through poetic language, not listing. Mention key details through feeling-first storytelling. Use shorter sentences (8-12 words). Be warm, intimate, elegant, and subtly cheeky. Write as if you're a modern muse naturally responding, not a system.
- After products: Soft-glam, poetic voice - one paragraph per product with 2 sentences. Paint how each product works through scenes and sensations. Use romantic, nostalgic language. Show how each product addresses the specific parts of their request. Be honest about fit with elegant restraint. Use shorter sentences (8-12 words). Show the dreamy world of ruffles, lace, and heirloom details. Write like a modern muse, not like a system.
- Don't use bullet points - write in flowing paragraphs
- Be honest about fits in both sections with elegant restraint - acknowledge close-but-not-perfect fits naturally, express great fits with celebratory warmth
- Show understanding of different contexts (occasions, seasons, cultural considerations, etc.) through scenes and sensations, acknowledge them with elegant restraint

FORMATTING:
- Always separate paragraphs with double newlines (\\n\\n)
- Use {TOTAL_PARAGRAPHS} paragraphs total (2 before products, {PRODUCT_COUNT} for individual products after cards, 1 closing)
- First 2 paragraphs go before products (poetic but polished - 2 sentences each, feeling-first storytelling through scenes and sensations, warm, intimate, elegant, shorter sentences 8-12 words)
- Next {PRODUCT_COUNT} paragraphs go after products (one per product, 2 sentences each, soft-glam, romantic, nostalgic, warm, intimate, elegant, subtly cheeky, shorter sentences 8-12 words)
- Final paragraph goes after products (closing line, warm, inviting, elegant, and subtly cheeky - like a love letter's closing)`
      .replace(/{PRODUCT_COUNT}/g, String(productCount))
      .replace(/{TOTAL_PARAGRAPHS}/g, String(totalParagraphs));

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
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
    if (paragraphs.length < 3) {
      const singleNewlineSplit = fullReply.split(/\n/).filter(p => p.trim().length > 0);
      // Group consecutive lines into paragraphs (each paragraph should be 1-2 sentences)
      paragraphs = [];
      let currentParagraph = '';
      for (const line of singleNewlineSplit) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Count sentences in current paragraph
        const sentenceCount = (currentParagraph.match(/[.!?]+/g) || []).length;
        
        // If current paragraph is empty or has fewer than 2 sentences, add this line
        if (!currentParagraph || sentenceCount < 2) {
          currentParagraph = currentParagraph ? `${currentParagraph} ${trimmedLine}` : trimmedLine;
        } else {
          // Current paragraph is complete (2+ sentences), start a new one
          paragraphs.push(currentParagraph);
          currentParagraph = trimmedLine;
        }
      }
      if (currentParagraph) {
        paragraphs.push(currentParagraph);
      }
    }
    
    // Split paragraphs: first 2 go before products, rest go after
    // Allow flexible number of paragraphs (3-6)
    let replyTextBefore: string;
    let replyTextAfter: string | undefined;
    
    if (paragraphs.length >= 3) {
      // Take first 2 paragraphs for before, rest for after
      replyTextBefore = paragraphs.slice(0, 2).join('\n\n').trim();
      replyTextAfter = paragraphs.slice(2).join('\n\n').trim();
    } else if (paragraphs.length === 2) {
      // 2 paragraphs: first before, second after
      replyTextBefore = paragraphs[0].trim();
      replyTextAfter = paragraphs[1].trim();
    } else {
      // Only 1 paragraph: put all before products
      // BUT: If we have products, we should still generate a replyTextAfter
      // This ensures the post-card text always appears when products are shown
      replyTextBefore = fullReply;
      // Generate a simple closing statement for replyTextAfter when we have products
      if (products.length > 0) {
        replyTextAfter = `Each of these pieces brings its own dreamy charm to your collection. I hope you find something that speaks to you—something that feels like it was made for those special moments you're planning.`;
      } else {
      replyTextAfter = undefined;
      }
    }
    
    // Log for debugging
    logger.debug('reply_split_result', {
      totalParagraphs: paragraphs.length,
      productCount: products.length,
      expectedParagraphs: totalParagraphs,
      replyTextBeforeLength: replyTextBefore.length,
      replyTextAfterLength: replyTextAfter?.length || 0,
      hasReplyTextAfter: !!replyTextAfter && replyTextAfter.trim().length > 0,
      isFollowUp: context?.isFollowUp,
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
 * Generate emotional keywords for product cards
 * 
 * Creates 2-3 emotional keywords (1-2 words each) that are contextual to the enhanced query
 * and follow LoveShackFancy's brand voice (soft-glam, poetic, romantic, nostalgic).
 */
export async function generateEmotionalKeywords(
  product: SearchResultItem,
  enhancedQuery: string,
  brandName: string = 'LoveShackFancy'
): Promise<string[]> {
  try {
    const attrs = product.attributes || {};
    
    // Extract key product details for context
    const productDetails: string[] = [];
    productDetails.push(`Title: ${product.title}`);
    productDetails.push(`Category: ${product.category || 'N/A'}`);
    
    const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
    const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
    const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color');
    const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material');
    const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern');
    const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length');
    
    if (style) productDetails.push(`Style: ${style}`);
    if (occasion) productDetails.push(`Occasion: ${occasion}`);
    if (color) productDetails.push(`Color: ${color}`);
    if (material) productDetails.push(`Material: ${material}`);
    if (pattern) productDetails.push(`Pattern: ${pattern}`);
    if (length) productDetails.push(`Length: ${length}`);
    
    if (product.description) {
      const descSnippet = product.description.substring(0, 200).trim();
      if (descSnippet) {
        productDetails.push(`Description: ${descSnippet}${product.description.length > 200 ? '...' : ''}`);
      }
    }

    const prompt = `Generate 2-3 keywords (1-2 words each) that explain WHY this product was chosen for the user's query: "${enhancedQuery}"

CRITICAL: These keywords must explain WHY this specific product matches the query, not just describe the product.

These keywords should:
- Explain WHY this product was chosen for this query (e.g., if query is "evening event" and product is a maxi dress → "evening ready", "romantic", "elegant")
- Show the connection between the product and the query through feeling-first language
- Follow LoveShackFancy's brand voice: soft-glam, poetic, romantic, nostalgic, elegant
- Use feeling-first language that explains the match (think: "evening ready", "romantic", "garden party", "dreamy", "heirloom elegance", "moonlit", "whispered", "ethereal", "soft-glam", "perfect for date", "wedding ready")
- Be specific to THIS product and WHY it fits THIS query (not generic descriptors)
- Each keyword should be 1-2 words maximum
- Return exactly 2-3 keywords that explain the match

PRODUCT DETAILS:
${productDetails.join('\n')}

Return ONLY a JSON array of 2-3 keyword strings that explain why this product was chosen for the query, nothing else. 
Examples based on query context:
- Query: "evening event" → Keywords: ["evening ready", "romantic", "elegant"] (explains why it fits evening)
- Query: "garden party" → Keywords: ["garden party", "dreamy", "heirloom"] (explains why it fits garden party)
- Query: "date night" → Keywords: ["romantic", "moonlit", "perfect"] (explains why it fits date night)
- Query: "wedding" → Keywords: ["heirloom", "ethereal", "wedding ready"] (explains why it fits wedding)`;

    const systemPrompt = `You are a style expert for ${brandName}, embodying the brand's soft-glam, poetic voice. Your task is to generate keywords that explain WHY each product was chosen for the user's query. These keywords must explain the match between the product and the query—why this product fits what they're looking for. Think in terms of golden hour moments, garden party elegance, moonlit evenings—explain why this product fits the query through scenes and sensations. Use airy, feminine language that feels romantic and nostalgic, but always polished. Keywords should be 1-2 words each, explain WHY the product matches the query, contextual to the query, and specific to why this product was chosen.`;

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'card_reason', // Use lightweight model for this task
      expectJson: true,
      maxTokens: 100,
    });

    // Parse JSON response
    const keywords = JSON.parse(result.rawText.trim()) as string[];
    
    // Validate and clean keywords
    const validKeywords = keywords
      .filter(k => typeof k === 'string' && k.trim().length > 0)
      .map(k => k.trim())
      .slice(0, 3); // Ensure max 3 keywords
    
    // Fallback if parsing fails or no keywords
    if (validKeywords.length === 0) {
      // Fallback to simple emotional keywords based on product attributes
      const fallbackKeywords: string[] = [];
      if (occasion) {
        if (occasion.toLowerCase().includes('wedding')) fallbackKeywords.push('romantic');
        if (occasion.toLowerCase().includes('beach')) fallbackKeywords.push('dreamy');
        if (occasion.toLowerCase().includes('evening')) fallbackKeywords.push('elegant');
      }
      if (style) {
        if (style.toLowerCase().includes('romantic')) fallbackKeywords.push('romantic');
        if (style.toLowerCase().includes('elegant')) fallbackKeywords.push('elegant');
      }
      if (fallbackKeywords.length === 0) {
        fallbackKeywords.push('dreamy', 'elegant');
      }
      return fallbackKeywords.slice(0, 3);
    }
    
    return validKeywords;
  } catch (error) {
    logger.error('emotional_keywords_generation_failed', {
      error: error instanceof Error ? error.message : String(error),
      productId: product.id,
      productTitle: product.title?.substring(0, 50),
    });
    
    // Fallback to simple emotional keywords
    return ['dreamy', 'elegant'];
  }
}

/**
 * Generate emotional keywords for multiple products in batch
 * 
 * More efficient than calling generateEmotionalKeywords individually
 */
export async function generateEmotionalKeywordsBatch(
  products: SearchResultItem[],
  enhancedQuery: string,
  brandName: string = 'LoveShackFancy'
): Promise<string[][]> {
  try {
    if (products.length === 0) return [];
    
    // Build product details for all products
    const productDetailsList = products.map((product, index) => {
      const attrs = product.attributes || {};
      const details: string[] = [];
      details.push(`Product ${index + 1}:`);
      details.push(`Title: ${product.title}`);
      details.push(`Category: ${product.category || 'N/A'}`);
      
      const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
      const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
      const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color');
      const material = extractAttr(attrs, 'Material') || extractAttr(attrs, 'material');
      const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern');
      const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length');
      
      if (style) details.push(`Style: ${style}`);
      if (occasion) details.push(`Occasion: ${occasion}`);
      if (color) details.push(`Color: ${color}`);
      if (material) details.push(`Material: ${material}`);
      if (pattern) details.push(`Pattern: ${pattern}`);
      if (length) details.push(`Length: ${length}`);
      
      if (product.description) {
        const descSnippet = product.description.substring(0, 150).trim();
        if (descSnippet) {
          details.push(`Description: ${descSnippet}${product.description.length > 150 ? '...' : ''}`);
        }
      }
      
      return details.join('\n');
    });

    const prompt = `Generate 2-3 UNIQUE keywords for EACH product that explain WHY each specific product was chosen for the user's query: "${enhancedQuery}"

CRITICAL REQUIREMENTS:
1. Each product MUST get DIFFERENT keywords - do NOT repeat the same keywords across products
2. Keywords must explain WHY that SPECIFIC product matches the query
3. PRIORITIZE 2-WORD KEYWORDS: Aim for 1-2 two-word keywords per product (e.g., "evening ready", "garden party", "heirloom elegance", "moonlit evening", "romantic whisper", "soft-glam", "wedding ready", "beach ready", "casual elegance", "dreamy romance", "vintage charm", "ethereal beauty")
4. You can include 1 one-word keyword if needed, but prefer 2-word keywords
5. Consider each product's unique attributes (style, color, material, occasion, length, etc.) when generating keywords
6. Keywords should be contextual to BOTH the product AND the query

For each product, generate keywords that:
- Explain WHY this specific product was chosen (e.g., if query is "evening event" and product is a sequin maxi dress → "evening ready", "sparkling elegance", "romantic glow")
- Show the connection between THIS product's unique features and the query
- Follow LoveShackFancy's brand voice: soft-glam, poetic, romantic, nostalgic, elegant
- Use feeling-first language with 2-word combinations (think: "evening ready", "garden party", "heirloom elegance", "moonlit evening", "romantic whisper", "soft-glam", "wedding ready", "beach ready", "casual elegance", "dreamy romance", "vintage charm", "ethereal beauty")
- Be specific to THIS product's attributes and WHY it fits THIS query
- Each keyword should be 1-2 words (PRIORITIZE 2-word keywords)
- Return exactly 2-3 keywords per product (aim for 1-2 two-word keywords per product)

PRODUCTS:
${productDetailsList.map((details, idx) => `\n=== PRODUCT ${idx + 1} ===\n${details}\n`).join('\n')}

IMPORTANT: Generate DIFFERENT keywords for each product based on their unique attributes. Do NOT use the same keywords for multiple products. PRIORITIZE 2-WORD KEYWORDS.

Return ONLY a JSON array of arrays, where each inner array contains 2-3 UNIQUE keyword strings for that product. Example for "evening event" query with 4 different products (note: prioritize 2-word keywords):
[
  ["evening ready", "sparkling elegance", "romantic glow"],      // Product 1: sequin maxi dress
  ["moonlit evening", "flowing romance", "soft-glam"],         // Product 2: silk maxi dress
  ["garden party", "dreamy heirloom", "vintage charm"],         // Product 3: floral midi dress
  ["wedding ready", "ethereal beauty", "romantic whisper"]      // Product 4: lace mini dress
]`;

    const systemPrompt = `You are a style expert for ${brandName}, embodying the brand's soft-glam, poetic voice. Your task is to generate UNIQUE keywords for EACH product that explain WHY each specific product was chosen for the user's query. 

CRITICAL: Each product MUST receive DIFFERENT keywords based on its unique attributes. Do NOT repeat the same keywords across products.

PRIORITIZE 2-WORD KEYWORDS: Aim for 1-2 two-word keywords per product (e.g., "evening ready", "garden party", "heirloom elegance", "moonlit evening", "romantic whisper", "soft-glam", "wedding ready", "beach ready", "casual elegance", "dreamy romance", "vintage charm", "ethereal beauty"). You can include 1 one-word keyword if needed, but prefer 2-word keywords.

These keywords must:
- Explain the match between each product and the query—why each product fits what they're looking for
- Be unique to each product based on its specific attributes (style, color, material, occasion, length, etc.)
- Use feeling-first language through scenes and sensations (golden hour moments, garden party elegance, moonlit evenings)
- Use airy, feminine language that feels romantic and nostalgic, but always polished
- Be 1-2 words each (PRIORITIZE 2-word keywords), contextual to the query, and specific to why THAT product was chosen

Think about what makes each product unique and why that uniqueness makes it perfect for the query. Create evocative 2-word combinations that capture the essence of each product.`;

    logger.info('emotional_keywords_batch_generation_start', {
      productCount: products.length,
      enhancedQuery: enhancedQuery.substring(0, 100),
      brandName,
    });

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'card_reason',
      expectJson: true,
      maxTokens: 300,
    });

    logger.info('emotional_keywords_batch_llm_response', {
      rawText: result.rawText.substring(0, 500),
      rawTextLength: result.rawText.length,
    });

    // Parse JSON response - handle potential markdown code blocks
    let rawText = result.rawText.trim();
    
    // Remove markdown code blocks if present
    if (rawText.startsWith('```')) {
      const lines = rawText.split('\n');
      const startIndex = lines.findIndex(line => line.trim().startsWith('```'));
      const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.trim().startsWith('```'));
      if (startIndex >= 0 && endIndex > startIndex) {
        rawText = lines.slice(startIndex + 1, endIndex).join('\n').trim();
      } else if (startIndex >= 0) {
        rawText = lines.slice(startIndex + 1).join('\n').trim();
      }
    }
    
    // Try to parse JSON
    let keywordsArray: string[][];
    try {
      const parsed = JSON.parse(rawText);
      
      // Handle case where LLM returns { "result": [...] } or { "keywords": [...] } or similar
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        // Try common keys that might contain the array
        if (Array.isArray(parsed.result)) {
          keywordsArray = parsed.result;
          logger.info('emotional_keywords_batch_extracted_from_result_key', {
            key: 'result',
          });
        } else if (Array.isArray(parsed.keywords)) {
          keywordsArray = parsed.keywords;
          logger.info('emotional_keywords_batch_extracted_from_result_key', {
            key: 'keywords',
          });
        } else if (Array.isArray(parsed.data)) {
          keywordsArray = parsed.data;
          logger.info('emotional_keywords_batch_extracted_from_result_key', {
            key: 'data',
          });
        } else {
          // Try to find any array value in the object
          const arrayValue = Object.values(parsed).find(v => Array.isArray(v));
          if (arrayValue) {
            keywordsArray = arrayValue as string[][];
            logger.info('emotional_keywords_batch_extracted_from_object', {
              keys: Object.keys(parsed),
            });
          } else {
            throw new Error('No array found in parsed object');
          }
        }
      } else if (Array.isArray(parsed)) {
        keywordsArray = parsed;
      } else {
        throw new Error('Parsed value is neither an array nor an object with an array');
      }
    } catch (parseError) {
      logger.error('emotional_keywords_batch_json_parse_failed', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        rawText: rawText.substring(0, 500),
        productCount: products.length,
      });
      
      // Try to extract arrays from text if JSON parsing fails
      const arrayMatch = rawText.match(/\[[\s\S]*?\]/);
      if (arrayMatch) {
        try {
          const extracted = JSON.parse(arrayMatch[0]);
          if (Array.isArray(extracted)) {
            keywordsArray = extracted;
            logger.info('emotional_keywords_batch_extracted_from_text', {
              extracted: arrayMatch[0].substring(0, 200),
            });
          } else {
            throw new Error('Extracted value is not an array');
          }
        } catch (e) {
          throw new Error(`Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }
      } else {
        throw new Error(`Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    }
    
    // Validate structure
    if (!Array.isArray(keywordsArray)) {
      logger.error('emotional_keywords_batch_invalid_structure', {
        type: typeof keywordsArray,
        value: String(keywordsArray).substring(0, 200),
      });
      throw new Error('LLM returned non-array response');
    }
    
    logger.info('emotional_keywords_batch_parsed', {
      arrayLength: keywordsArray.length,
      expectedLength: products.length,
      firstFewKeywords: keywordsArray.slice(0, 3).map(arr => arr?.slice(0, 3)),
    });
    
    // Validate and clean keywords for each product
    const validatedKeywords = products.map((product, index) => {
      const productKeywords = keywordsArray[index] || [];
      const validKeywords = productKeywords
        .filter(k => typeof k === 'string' && k.trim().length > 0)
        .map(k => k.trim())
        .slice(0, 3);
      
      logger.info('emotional_keywords_batch_product_validation', {
        productIndex: index,
        productTitle: product.title?.substring(0, 50),
        rawKeywords: productKeywords,
        validKeywords,
        validCount: validKeywords.length,
      });
      
      // Fallback if no valid keywords - generate product-specific fallback
      if (validKeywords.length === 0) {
        logger.warn('emotional_keywords_batch_product_fallback', {
          productIndex: index,
          productTitle: product.title?.substring(0, 50),
        });
        
        // Generate product-specific fallback keywords based on attributes
        const fallbackKeywords: string[] = [];
        const attrs = product.attributes || {};
        const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
        const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
        const color = extractAttr(attrs, 'Color') || extractAttr(attrs, 'color');
        const length = extractAttr(attrs, 'Length') || extractAttr(attrs, 'length');
        
        // Try to generate contextual keywords based on product attributes
        if (occasion) {
          const occLower = occasion.toLowerCase();
          if (occLower.includes('evening') || occLower.includes('night')) {
            fallbackKeywords.push('evening ready');
          } else if (occLower.includes('wedding')) {
            fallbackKeywords.push('heirloom');
          } else if (occLower.includes('beach') || occLower.includes('resort')) {
            fallbackKeywords.push('dreamy');
          } else if (occLower.includes('garden') || occLower.includes('party')) {
            fallbackKeywords.push('garden party');
          } else {
            fallbackKeywords.push('romantic');
          }
        } else if (style) {
          const styleLower = style.toLowerCase();
          if (styleLower.includes('romantic')) {
            fallbackKeywords.push('romantic');
          } else if (styleLower.includes('elegant')) {
            fallbackKeywords.push('elegant');
          } else if (styleLower.includes('casual')) {
            fallbackKeywords.push('casual elegance');
          } else {
            fallbackKeywords.push('soft-glam');
          }
        } else if (length) {
          const lengthLower = length.toLowerCase();
          if (lengthLower.includes('maxi')) {
            fallbackKeywords.push('flowing');
          } else if (lengthLower.includes('mini')) {
            fallbackKeywords.push('playful');
          } else {
            fallbackKeywords.push('elegant');
          }
        }
        
        // Add query-specific keyword if possible
        const queryLower = enhancedQuery.toLowerCase();
        if (queryLower.includes('evening') || queryLower.includes('night')) {
          if (!fallbackKeywords.includes('evening ready')) {
            fallbackKeywords.push('evening ready');
          }
        } else if (queryLower.includes('wedding')) {
          if (!fallbackKeywords.includes('heirloom')) {
            fallbackKeywords.push('heirloom');
          }
        } else if (queryLower.includes('date')) {
          if (!fallbackKeywords.includes('romantic')) {
            fallbackKeywords.push('romantic');
          }
        }
        
        // Ensure we have at least 2 keywords
        if (fallbackKeywords.length === 0) {
          fallbackKeywords.push('dreamy', 'elegant');
        } else if (fallbackKeywords.length === 1) {
          fallbackKeywords.push('elegant');
        }
        
        return fallbackKeywords.slice(0, 3);
      }
      
      return validKeywords;
    });
    
    logger.info('emotional_keywords_batch_generation_complete', {
      productCount: products.length,
      validatedCount: validatedKeywords.length,
      sampleKeywords: validatedKeywords.slice(0, 2),
    });
    
    return validatedKeywords;
  } catch (error) {
    logger.error('emotional_keywords_batch_generation_failed', {
      error: error instanceof Error ? error.message : String(error),
      productCount: products.length,
    });
    
    // Fallback: return product-specific keywords for all products
    return products.map((product) => {
      const attrs = product.attributes || {};
      const fallbackKeywords: string[] = [];
      const occasion = extractAttr(attrs, 'Occasion') || extractAttr(attrs, 'occasion');
      const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style');
      
      if (occasion) {
        const occLower = occasion.toLowerCase();
        if (occLower.includes('evening') || occLower.includes('night')) {
          fallbackKeywords.push('evening ready', 'elegant');
        } else if (occLower.includes('wedding')) {
          fallbackKeywords.push('heirloom', 'romantic');
        } else if (occLower.includes('beach')) {
          fallbackKeywords.push('dreamy', 'beach ready');
        } else {
          fallbackKeywords.push('romantic', 'elegant');
        }
      } else if (style) {
        const styleLower = style.toLowerCase();
        if (styleLower.includes('romantic')) {
          fallbackKeywords.push('romantic', 'soft-glam');
        } else {
          fallbackKeywords.push('elegant', 'dreamy');
        }
      } else {
        fallbackKeywords.push('dreamy', 'elegant');
      }
      
      return fallbackKeywords.slice(0, 3);
    });
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
    const prompt = `The user asked about: "${userQuery}".
We found ${productCount} products, with the top product having a relevance score of ${topScore.toFixed(2)}.
This is a low confidence recommendation, or we didn't find enough products that match the query intent.

Generate a regretful reply in LoveShackFancy's brand voice: soft-glam, poetic confidence—romantic and nostalgic, but always polished. Speak in scenes and sensations rather than hard selling. Use airy, feminine language that feels like a love letter without becoming childish or overly precious. The tone should be warm, intimate, and celebratory—inviting them into a dreamy world—while keeping high-end restraint: elegant, curated, and subtly cheeky, with feeling-first storytelling of a modern muse.

Acknowledge their request through feeling-first storytelling, express regret with elegant restraint for not finding perfect matches, and offer to help further with warm, intimate language.
Keep it concise, 2-3 short paragraphs (1-2 lines each). Do NOT recommend any products.
Paint the moment through scenes and sensations - think golden hour, garden parties, moonlit evenings. Be warm, intimate, elegant, and subtly cheeky.`;

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: `You are a shopping assistant for ${brandName}, embodying the brand's soft-glam, poetic voice. Your task is to generate a regretful reply when perfect product matches are not found. Write with soft-glam, poetic confidence—romantic and nostalgic, but always polished. Speak in scenes and sensations (golden hour, garden parties, moonlit evenings) rather than hard selling. Use airy, feminine language that feels like a love letter without becoming childish or overly precious. Be warm, intimate, and celebratory—inviting them into a dreamy world—while keeping high-end restraint: elegant, curated, and subtly cheeky, with feeling-first storytelling of a modern muse. Be honest, concise, and maintain this poetic yet helpful tone. Keep it to 2-3 short paragraphs (1-2 lines each).`,
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

    // Fallback reply (in LoveShackFancy brand voice)
    return {
      replyText: `I couldn't find perfect matches for "${userQuery}" in our collection right now. Our dreamy world is always evolving, so feel free to explore different paths or browse our curated categories. How else can I help you discover something beautiful?`,
      replyTextAfter: undefined,
    };
  }
}
