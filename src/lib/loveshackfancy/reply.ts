/**
 * Reply Generator
 * 
 * Generates natural language replies for fashion queries.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import type { SearchResultItem } from '../search/types';
import type { FashionConstraints } from './classifier';
import { extractConstraintValues } from './constraint-utils';

export type ReplyResult = {
  replyText: string; // First 2 paragraphs (before product cards)
  replyTextAfter?: string; // Last 2 paragraphs (after product cards)
};

export type ReplyContext = {
  isFollowUp?: boolean;
  currentQuery?: string; // Most recent user query
  previousQuery?: string; // Previous query in the conversation
  enhancedQuery?: string; // Enhanced/merged query used for search
  classificationConstraints?: FashionConstraints; // Classification constraints for reference/fallback
  productTypeMismatch?: {
    queryProductType: string; // Product type mentioned in query (e.g., "hoodies")
    returnedProductTypes: string[]; // Product types actually returned (e.g., ["jackets", "cardigans"])
  };
  explicitMentions?: string[]; // Constraints explicitly mentioned by the user (e.g., ["colors", "occasions"])
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
    // Prioritize database columns over JSONB attributes
    const style = extractAttr(attrs, 'Style') || extractAttr(attrs, 'style') || 'N/A';
    
    // Occasion: Check database columns first (occasion or occasionContext), then JSONB fallback
    const occasion = product.occasion ?? 
                     (product.occasionContext && product.occasionContext.length > 0 ? product.occasionContext.join(', ') : null) ??
                     extractAttr(attrs, 'Occasion') ?? 
                     extractAttr(attrs, 'occasion') ?? 
                     'N/A';
    
    // Pattern: JSONB only (no database column)
    const pattern = extractAttr(attrs, 'Pattern') || extractAttr(attrs, 'pattern') || 'N/A';
    
    // Material: Check database columns first (material or fabric), then JSONB fallback
    const material = product.material ?? 
                     product.fabric ?? 
                     extractAttr(attrs, 'Material') ?? 
                     extractAttr(attrs, 'material') ?? 
                     'N/A';
    
    // Length: Already uses database column with JSONB fallback
    const length = product.length ?? extractAttr(attrs, 'Length') ?? extractAttr(attrs, 'length') ?? 'N/A';
    
    // Color: Check database columns first (enrichedColor or color), then JSONB fallback
    const color = product.enrichedColor ?? 
                  product.color ?? 
                  extractAttr(attrs, 'Color') ?? 
                  extractAttr(attrs, 'color') ?? 
                  'N/A';
    
    // Fit: Check database column first, then JSONB fallback
    const fit = product.fit ?? 
                extractAttr(attrs, 'Fit') ?? 
                extractAttr(attrs, 'fit') ?? 
                'N/A';
    
    // Season: Check database column first, then JSONB fallback
    const season = product.season ?? 
                   extractAttr(attrs, 'Season') ?? 
                   extractAttr(attrs, 'season') ?? 
                   'N/A';
    
    // Sleeve: Check database column first, then JSONB fallback
    const sleeve = product.sleeve ?? 
                   extractAttr(attrs, 'Sleeve') ?? 
                   extractAttr(attrs, 'sleeve') ?? 
                   extractAttr(attrs, 'SleeveLength') ?? 
                   extractAttr(attrs, 'sleeveLength') ?? 
                   'N/A';
    
    // Neckline: Check database column first, then JSONB fallback
    const neckline = product.neckline ?? 
                     extractAttr(attrs, 'Neckline') ?? 
                     extractAttr(attrs, 'neckline') ?? 
                     'N/A';
    
    if (style !== 'N/A') details.push(`Style: ${style}`);
    if (occasion !== 'N/A') details.push(`Occasion: ${occasion}`);
    if (material !== 'N/A') details.push(`Material: ${material}`);
    if (pattern !== 'N/A') details.push(`Pattern: ${pattern}`);
    if (length !== 'N/A') details.push(`Length: ${length}`);
    if (color !== 'N/A') details.push(`Color: ${color}`);
    if (fit !== 'N/A') details.push(`Fit: ${fit}`);
    if (season !== 'N/A') details.push(`Season: ${season}`);
    if (sleeve !== 'N/A') details.push(`Sleeve: ${sleeve}`);
    if (neckline !== 'N/A') details.push(`Neckline: ${neckline}`);
  }
  
  // Add enriched attributes (prioritize enriched columns over JSON attributes)
  if (product.formalityLevel) {
    details.push(`Formality Level: ${product.formalityLevel}`);
  } else {
    const formalityLevel = extractAttr(attrs, 'formalityLevel') || extractAttr(attrs, 'FormalityLevel');
    if (formalityLevel) details.push(`Formality Level: ${formalityLevel}`);
  }
  
  if (product.temperatureIntent) {
    details.push(`Temperature Intent: ${product.temperatureIntent}`);
  } else {
    const temperatureIntent = extractAttr(attrs, 'temperatureIntent') || extractAttr(attrs, 'TemperatureIntent');
    if (temperatureIntent) details.push(`Temperature Intent: ${temperatureIntent}`);
  }
  
  if (product.humidityFriendly !== null && product.humidityFriendly !== undefined) {
    details.push(`Humidity Friendly: ${product.humidityFriendly ? 'Yes' : 'No'}`);
  } else {
    const humidityFriendly = (attrs as any).humidityFriendly;
    if (typeof humidityFriendly === 'boolean') {
      details.push(`Humidity Friendly: ${humidityFriendly ? 'Yes' : 'No'}`);
    }
  }
  
  if (product.occasionContext && product.occasionContext.length > 0) {
    details.push(`Occasion Context: ${product.occasionContext.join(', ')}`);
  } else {
    const occasionContext = extractAttr(attrs, 'occasionContext') || extractAttr(attrs, 'OccasionContext');
    if (occasionContext) {
      const contextArray = Array.isArray(occasionContext) ? occasionContext : [occasionContext];
      if (contextArray.length > 0) {
        details.push(`Occasion Context: ${contextArray.join(', ')}`);
      }
    }
  }
  
  if (product.problemSolutions && product.problemSolutions.length > 0) {
    details.push(`Problem Solutions: ${product.problemSolutions.join(', ')}`);
  } else {
    const problemSolutions = extractAttr(attrs, 'problemSolutions') || extractAttr(attrs, 'ProblemSolutions');
    if (problemSolutions) {
      const solutionsArray = Array.isArray(problemSolutions) ? problemSolutions : [problemSolutions];
      if (solutionsArray.length > 0) {
        details.push(`Problem Solutions: ${solutionsArray.join(', ')}`);
      }
    }
  }
  
  if (product.functionFeatures && product.functionFeatures.length > 0) {
    details.push(`Function Features: ${product.functionFeatures.join(', ')}`);
  } else {
    const functionFeatures = extractAttr(attrs, 'functionFeatures') || extractAttr(attrs, 'FunctionFeatures');
    if (functionFeatures) {
      const featuresArray = Array.isArray(functionFeatures) ? functionFeatures : [functionFeatures];
      if (featuresArray.length > 0) {
        details.push(`Function Features: ${featuresArray.join(', ')}`);
      }
    }
  }
  
  if (product.colorShade) {
    details.push(`Color Shade: ${product.colorShade}`);
  } else {
    const colorShade = extractAttr(attrs, 'colorShade') || extractAttr(attrs, 'ColorShade');
    if (colorShade) details.push(`Color Shade: ${colorShade}`);
  }
  
  if (product.colorUndertone) {
    details.push(`Color Undertone: ${product.colorUndertone}`);
  } else {
    const colorUndertone = extractAttr(attrs, 'colorUndertone') || extractAttr(attrs, 'ColorUndertone');
    if (colorUndertone) details.push(`Color Undertone: ${colorUndertone}`);
  }
  
  if (product.multicolor !== null && product.multicolor !== undefined) {
    details.push(`Multicolor: ${product.multicolor ? 'Yes' : 'No'}`);
  } else {
    const multicolor = (attrs as any).multicolor;
    if (typeof multicolor === 'boolean') {
      details.push(`Multicolor: ${multicolor ? 'Yes' : 'No'}`);
    }
  }
  
  if (product.seasonalPalette) {
    details.push(`Seasonal Palette: ${product.seasonalPalette}`);
  } else {
    const seasonalPalette = extractAttr(attrs, 'seasonalPalette') || extractAttr(attrs, 'SeasonalPalette');
    if (seasonalPalette) details.push(`Seasonal Palette: ${seasonalPalette}`);
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

const REPLY_PROMPT = `Generate a reply in LoveShackFancy's brand voice: warm, elegant, and subtly romantic—conversational with a touch of poetic flair. Use natural, feminine language that feels intimate but polished. The tone should be warm, helpful, and celebratory—inviting them into beautiful pieces—while keeping elegance and subtle sophistication.

USER QUERY: "{QUERY}"
{FOLLOW_UP_CONTEXT}

[INTERNAL GUIDANCE - DO NOT EXPOSE TO USER:
The system has interpreted the user's query and identified relevant product attributes for matching. Use this information to understand what the user is looking for, but DO NOT directly reference these constraints in your reply. Instead, interpret the user's query naturally and explain your interpretation in a logical, broad sense.

INTERPRETED ATTRIBUTES: {CONSTRAINTS}

ENHANCED QUERY: {ENHANCED_QUERY}

PRODUCTS BEING RECOMMENDED:
{PRODUCT_DETAILS}

{PRODUCT_MISMATCH_GUIDANCE}
]

CRITICAL: QUERY INTERPRETATION REQUIREMENT
You MUST understand the user's query and interpret what they're looking for naturally. The query is the ONLY direct input from the user—everything else (colors, styles, occasions, materials, etc.) is your interpretation of what they need.

For the reply text BEFORE product cards:
- Focus ONLY on understanding what the user said in their query
- Interpret their query in a logical, broad sense (e.g., "looking for something elegant" not "formalityLevel: Formal")
- Explain your interpretation naturally: "I understand you're looking for something elegant and sophisticated" NOT "You mentioned formal occasions"
- Show you understand the meaning behind their query, not technical constraint names
- For follow-up queries: Prioritize the RECENT CHANGE in the enhanced query - focus on what's NEW or DIFFERENT from what they said before
- Reference what they said in previous queries naturally, not as extracted constraints
- Keep it conversational—write as if you're understanding their request, not processing technical data
- If the products don't match exactly what the enhanced query suggests, acknowledge this naturally in your opening (e.g., "I couldn't find exactly what you're looking for, but here are some options that might work")

For product-specific paragraphs AFTER cards:
- Reference actual product attributes from PRODUCT_DETAILS to explain why each product matches
- Connect product features to what the user is looking for in natural language
- Explain the connection conversationally (e.g., "This has the elegant style you're looking for" not "This matches formalityLevel: Formal")
- Be honest about how well each product matches their request

PRODUCTS TO SHOW (exactly {PRODUCT_COUNT}):
{PRODUCT_DETAILS}

Generate a well-organized reply with multiple short paragraphs, separated by EXACTLY TWO newlines (\\n\\n):

STRUCTURE:
- Paragraphs 1-2 (Before products): Write with warm, elegant confidence. Use natural, conversational language with subtle poetic touches. Acknowledge each constraint mentioned (colors, styles, occasions, sizes, materials, etc.) naturally. Show understanding of what each constraint means—for example, if they mentioned "lavender scents," show you understand they want fragrance. If there's previous context, weave it in naturally. Use ONE sentence per paragraph - warm and polished. Use shorter sentences (8-12 words). Be conversational and helpful. Avoid meta-references to "search", "query", etc.

{PRODUCT_TYPE_MISMATCH_HANDLING}

{EXPLICIT_VS_INFERRED}

CRITICAL: If PRODUCT_TYPE_MISMATCH is provided above, you MUST:
- **FIRST SENTENCE MUST ACKNOWLEDGE THE MISMATCH**: Start your reply by honestly saying you couldn't find what they asked for (e.g., "I couldn't find pink hoodies for curvy women" or "I don't have pink hoodies in the exact style you're looking for")
- **THEN EXPLAIN WHAT YOU'RE SHOWING INSTEAD**: Clearly state what product types you're actually showing (e.g., "but I found some pullovers and tees that might work for you")
- Reference the specific product type they asked for (e.g., "hoodies") prominently in your opening
- Look at the PRODUCT_DETAILS below to see exactly what products are being shown - use those product titles/types to accurately describe what you're actually showing
- Be understanding and honest - don't pretend the products match exactly what they asked for
- Keep it concise and human - less flowery language, more direct honesty
- Put MORE weight on what they just asked for (the latest update to the query) - acknowledge it first and prominently
- **NEVER say "I found some [queryProductType]" or "Here are some [queryProductType]" if PRODUCT_TYPE_MISMATCH is detected - that's a lie!**
- Paragraphs 3-{PRODUCT_COUNT_PLUS_2} (After products): Provide ONE separate paragraph for EACH of the {PRODUCT_COUNT} products. Focus on that specific product with natural, warm language. Highlight key features conversationally. Show how THIS product addresses their request by connecting product attributes to what they're looking for in natural language. Be honest about fit—if close but not perfect, acknowledge with restraint. If it's a great fit, express with warmth. Use ONE sentence per paragraph. Use shorter sentences (8-12 words). Keep it conversational and elegant.
- Final paragraph (After products): Short closing line that's warm, inviting, and elegant (one sentence)

CRITICAL FORMATTING:
- Use {TOTAL_PARAGRAPHS} paragraphs total (2 before products, {PRODUCT_COUNT} for individual products, 1 closing)
- Separate each paragraph with EXACTLY TWO newlines (\\n\\n)
- Before products: ONE sentence per paragraph (warm and polished - natural storytelling)
- After products: Each product gets its own paragraph (ONE sentence each - conversational, warm, elegant)
- Keep sentences SHORT and scannable - aim for 8-12 words per sentence
- Paragraphs 1-2 will appear BEFORE product cards
- Paragraphs 3-{PRODUCT_COUNT_PLUS_2} will appear AFTER product cards (one per product, in order)
- Final paragraph will appear AFTER product cards
- DO NOT use single newlines between paragraphs - use double newlines
- DO NOT use bullet points - write in flowing paragraphs
- DO NOT group multiple products in one paragraph - each product must have its own separate paragraph

STYLE GUIDELINES - LOVE SHACK FANCY BRAND VOICE:
- Warm, elegant confidence: Write with conversational elegance, always polished
- Natural, feminine language: Warm, intimate, celebratory - but never overly precious
- Conversational poetic touches: Use subtle imagery naturally, not forced
- Elegant restraint: Polished, curated, subtly sophisticated
- CRITICAL: Sound conversational and natural, NOT like a bot. Write as if continuing a friendly conversation.
- NEVER use phrases like "you searched for", "your query", "I found options matching your search", "based on your search", or any meta-reference to the search/query process
- Write naturally as if responding organically to what they said
- Avoid language that makes it feel like a system - no references to "search", "query", "results", "matching", etc.
- BEFORE PRODUCTS: Write with warm, elegant confidence - ONE sentence per paragraph. Use natural, conversational language with subtle poetic touches. Mention key details naturally. Use shorter sentences (8-12 words). Be warm, helpful, and polished. Keep it conversational.
- AFTER PRODUCTS: Warm, conversational voice - one paragraph per product with ONE sentence. Highlight how each product works with natural language. Be honest about fit with restraint. Use shorter sentences (8-12 words). Keep it elegant and helpful.

CRITICAL: CONCISE AND HUMAN LANGUAGE:
- Use FEWER adjectives - be more direct and honest
- Be more human and less flowery - sound like you're actually talking to someone
- Keep it concise - don't over-describe
- Put MORE weight on the latest update to the query - acknowledge what they just asked for prominently
- If there's a product type mismatch, be honest and understanding - don't pretend everything matches perfectly
- Reference specific details (colors, sizes, occasions, etc.) naturally - provide context conversationally
- ACKNOWLEDGMENT REQUIREMENT: In your before-products paragraphs, interpret the user's query naturally and explain your interpretation in a logical, broad sense. Show you understand the meaning behind their query, not technical constraint names. For follow-up queries, prioritize the RECENT CHANGE in the enhanced query - focus on what's NEW or DIFFERENT from what they said before. Show understanding naturally, don't just list. Make them feel understood.
- For each product paragraph after cards: Explain why that product matches, highlight key features naturally, connect product attributes to what they're looking for in natural language, and be honest about match quality with restraint. Use ONE sentence with shorter sentences (8-12 words) - warm, conversational, elegant.
- Reference actual product facts (materials, styles, occasions, colors, scents, room types, etc.) naturally - provide thoughtful context in both before-products (ONE sentence per paragraph) and after-products (ONE sentence per product)
- When mentioning product names, use the product name directly (e.g., "Mystara Satin Maxi Dress") - do NOT prefix with "The" (e.g., avoid "The Mystara Satin Maxi Dress")
- Be honest about matches with restraint - acknowledge if something is close but not perfect, or if it's a great match, say so with warmth. Be authentic and conversational.
- Don't invent discounts, promotions, or stock information
- Keep each paragraph focused and concise - show understanding naturally
- Sound conversational throughout - avoid robotic or overly formal language
- Show understanding of different contexts (occasions, seasons, cultural considerations, etc.) naturally, with restraint

{FOLLOW_UP_PRIORITY}

Example structure (in LoveShackFancy brand voice):
"I understand you're looking for [interpretation of their query in a logical, broad sense]. I found some beautiful pieces that capture what you need. They have [key detail 1] and [key detail 2] that will work wonderfully.

These are ideal for [interpretation of occasion/style/context] and will complement [previous context/current needs] beautifully.

[After products - Paragraph 3: Product 1 - Conversational, warm voice. Example: "Mystara Satin Maxi Dress has that elegant [occasion] feel you're looking for, with beautiful [color/material] that brings [desired quality] perfectly." - ONE sentence, shorter sentences (8-12 words), natural and warm, acknowledging which parts of their request it addresses]

[After products - Paragraph 4: Product 2 - Similar conversational approach - warm, elegant, helpful - ONE sentence, shorter sentences, acknowledging which parts of their request it addresses]

[After products - Paragraph 5: Product 3 - Similar conversational approach - warm, elegant, helpful - ONE sentence, shorter sentences, acknowledging which parts of their request it addresses]

[After products - Paragraph 6: Product 4 - Similar conversational approach - warm, elegant, helpful - ONE sentence, shorter sentences, acknowledging which parts of their request it addresses]

[Closing line - Paragraph 7: Short, warm, and inviting]."

Note: If there are fewer than 4 products, adjust the paragraph count accordingly - one paragraph per product after the first 2 introductory paragraphs."`;

const FOLLOW_UP_CONTEXT_TEMPLATE = `
FOLLOW-UP CONTEXT:
This is a follow-up to what they said before. They just said: "{CURRENT_QUERY}"
What they mentioned earlier: "{PREVIOUS_QUERY}"
Enhanced query (your interpretation of what they need): "{ENHANCED_QUERY}"

IMPORTANT: In your reply:
- The user's input is ONLY what they said: "{CURRENT_QUERY}" and "{PREVIOUS_QUERY}"
- The enhanced query ("{ENHANCED_QUERY}") is YOUR interpretation of what they need based on what they said
- CRITICAL: Prioritize the RECENT CHANGE in the enhanced query - focus on what's NEW or DIFFERENT from the previous query
- Give MORE weight and direct response to what they just said ("{CURRENT_QUERY}") FIRST
- Acknowledge the overall context, but lead with what they just said
- Reference what they said in previous queries naturally, not as extracted constraints
- Show you understand the meaning behind what they said—interpret their query in a logical, broad sense
- Write naturally like a human would respond, NOT like a system processing queries`;

const NEW_SEARCH_WITH_PREVIOUS_CONTEXT_TEMPLATE = `
PREVIOUS CONTEXT:
They were looking at: "{PREVIOUS_QUERY}"
What they're asking about now: "{CURRENT_QUERY}"

IMPORTANT: In your reply:
- The user's input is ONLY what they said: "{PREVIOUS_QUERY}" and "{CURRENT_QUERY}"
- Everything else (colors, styles, occasions, etc.) is YOUR interpretation of what they need
- This is a NEW topic (not a follow-up), but acknowledge what they said before naturally
- Show you understand they mentioned "{PREVIOUS_QUERY}" before
- Show you understand what they're asking about now—interpret their query in a logical, broad sense
- Reference what they said before naturally, not as extracted constraints
- Rationalize and justify the current recommendations in relation to what they were looking at before when relevant
- Keep the acknowledgment brief and natural - don't over-explain, just show awareness of the conversation flow
- What they're asking about now should be the primary focus, with what they were looking at before as supporting context
- Only acknowledge what they were looking at before if it's relevant to the current recommendations
- If what they were looking at before is completely unrelated, you can skip the acknowledgment
- Write naturally like a human would respond, NOT like a system processing searches`;

const ENHANCED_QUERY_PRIORITY_TEMPLATE = `
CRITICAL: ENHANCED QUERY PRIORITY FOR FOLLOW-UPS:
- The enhanced query ("{ENHANCED_QUERY}") represents your interpretation of what the user needs based on their most recent input
- Prioritize the RECENT CHANGE in the enhanced query - focus on what's NEW or DIFFERENT from the previous query ("{PREVIOUS_QUERY}")
- If this is a follow-up, the enhanced query includes the cumulative context from previous queries PLUS the new change
- In your reply, prioritize addressing the NEW change from the most recent follow-up
- Show you understand how the enhanced query builds on previous context, but focus on the recent addition
- Reference the enhanced query changes naturally: "I understand you're looking for {interpretation}" NOT "The enhanced query is..."
`;

export async function generateReply(
  query: string,
  constraints: FashionConstraints,
  products: SearchResultItem[],
  brandName: string = 'LoveShackFancy',
  context?: ReplyContext,
  categories?: string[] // Top categories for attribute extraction
): Promise<ReplyResult> {
  try {
    // Format constraints for prompt, handling both array format and ConstraintWithIntent format
    const constraintsText = Object.entries(constraints)
      .filter(([_, value]) => {
        if (value === null || value === undefined) return false;
        // Handle ConstraintWithIntent format (extracts .values if present)
        const extractedValues = extractConstraintValues(value as any);
        if (extractedValues !== null && extractedValues !== undefined) {
          return Array.isArray(extractedValues) ? extractedValues.length > 0 : true;
        }
        // Handle array format
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        // Handle boolean/number/string values (temperatureIntent, humidityFriendly, priceMinCents, etc.)
        // These are valid constraint values even if extractConstraintValues returns undefined
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
          return true;
        }
        return false;
      })
      .map(([key, value]) => {
        // Extract values from ConstraintWithIntent format if needed
        const extractedValues = extractConstraintValues(value as any);
        if (extractedValues !== null && extractedValues !== undefined) {
          if (Array.isArray(extractedValues)) {
            return `${key}: ${extractedValues.join(', ')}`;
          }
          return `${key}: ${extractedValues}`;
        }
        // Handle array format
        if (Array.isArray(value)) {
          return `${key}: ${value.join(', ')}`;
        }
        // Handle boolean/number/string values (temperatureIntent, humidityFriendly, priceMinCents, etc.)
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
          return `${key}: ${value}`;
        }
        // Fallback for other types
        return `${key}: ${String(value)}`;
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
    let enhancedQueryPriority = '';
    const enhancedQueryText = context?.enhancedQuery || query;
    
    if (context?.previousQuery) {
      if (context.isFollowUp) {
        // This is a follow-up - use the existing follow-up template
        followUpContext = FOLLOW_UP_CONTEXT_TEMPLATE
          .replace('{CURRENT_QUERY}', context.currentQuery || query)
          .replace('{PREVIOUS_QUERY}', context.previousQuery)
          .replace('{ENHANCED_QUERY}', enhancedQueryText);
        
        // Add enhanced query priority if enhanced query differs from current query
        if (enhancedQueryText !== (context.currentQuery || query)) {
          enhancedQueryPriority = ENHANCED_QUERY_PRIORITY_TEMPLATE
            .replace('{ENHANCED_QUERY}', enhancedQueryText)
            .replace('{PREVIOUS_QUERY}', context.previousQuery || '');
        }
        
        followUpPriority = `
PRIORITY FOR FOLLOW-UP REPLIES:
- The user's input is ONLY what they said: "${context.currentQuery || query}" and "${context.previousQuery}"
- Everything else is YOUR interpretation of what they need
- Prioritize the RECENT CHANGE in the enhanced query - focus on what's NEW or DIFFERENT from the previous query
- Give MORE weight and direct response to what they just said: "${context.currentQuery || query}"
- Address what they just said FIRST in your opening paragraphs
- Interpret what they just said in a logical, broad sense—show you understand the meaning behind their query, not technical attributes
- Reference what they said in previous queries naturally, not as extracted constraints
- What they just said should be the primary focus, with the overall context as supporting information
- Write naturally like a human would respond, NOT like a system processing queries`;
      } else {
        // This is a new search but we have previous query context - acknowledge it
        followUpContext = NEW_SEARCH_WITH_PREVIOUS_CONTEXT_TEMPLATE
          .replace('{CURRENT_QUERY}', context.currentQuery || query)
          .replace('{PREVIOUS_QUERY}', context.previousQuery);
        
        followUpPriority = `
PRIORITY FOR NEW SEARCH WITH PREVIOUS CONTEXT:
- The user's input is ONLY what they said: "${context.currentQuery || query}" and "${context.previousQuery}"
- Everything else is YOUR interpretation of what they need
- What they're asking about now ("${context.currentQuery || query}") is the PRIMARY focus
- Interpret what they're asking about now in a logical, broad sense—show you understand the meaning behind their query
- Acknowledge what they mentioned before ("${context.previousQuery}") briefly and naturally
- Reference what they said before naturally, not as extracted constraints
- Rationalize how the current recommendations relate to or complement what they were looking at before when relevant
- Keep the acknowledgment concise - one brief mention is enough
- Focus on why these products work well for what they need now
- Write naturally like a human would respond, NOT like a system processing searches`;
      }
    }

    // Extract actual product types from the products being shown
    const extractProductTypeFromTitle = (title: string, category?: string): string | null => {
      const titleLower = title.toLowerCase();
      const categoryLower = (category || '').toLowerCase();
      
      // Product type keywords in order of specificity
      const productTypeKeywords: Array<{ keywords: string[]; type: string }> = [
        { keywords: ['hoodie', 'hoodies'], type: 'hoodies' },
        { keywords: ['pullover', 'pullovers'], type: 'pullovers' },
        { keywords: ['crew neck', 'crewneck'], type: 'crew necks' },
        { keywords: ['tee', 'tees', 't-shirt', 't-shirts'], type: 'tees' },
        { keywords: ['puffer', 'puffers'], type: 'puffers' },
        { keywords: ['cardigan', 'cardigans'], type: 'cardigans' },
        { keywords: ['jacket', 'jackets'], type: 'jackets' },
        { keywords: ['sweater', 'sweaters'], type: 'sweaters' },
        { keywords: ['dress', 'dresses'], type: 'dresses' },
        { keywords: ['top', 'tops'], type: 'tops' },
        { keywords: ['bottom', 'bottoms'], type: 'bottoms' },
        { keywords: ['skirt', 'skirts'], type: 'skirts' },
      ];
      
      // Check title first (more specific)
      for (const { keywords, type } of productTypeKeywords) {
        for (const keyword of keywords) {
          if (titleLower.includes(keyword)) {
            return type;
          }
        }
      }
      
      // Fallback to category
      if (categoryLower.includes('hoodie')) return 'hoodies';
      if (categoryLower.includes('pullover')) return 'pullovers';
      if (categoryLower.includes('tee') || categoryLower.includes('t-shirt')) return 'tees';
      if (categoryLower.includes('puffer')) return 'puffers';
      if (categoryLower.includes('cardigan')) return 'cardigans';
      if (categoryLower.includes('jacket')) return 'jackets';
      if (categoryLower.includes('dress')) return 'dresses';
      if (categoryLower.includes('top')) return 'tops';
      
      return null;
    };
    
    // Extract actual product types from products being shown
    const actualProductTypes = new Set<string>();
    products.forEach(product => {
      const productType = extractProductTypeFromTitle(product.title || '', product.category || '');
      if (productType) {
        actualProductTypes.add(productType);
      }
    });
    const actualProductTypesList = Array.from(actualProductTypes);
    
    // Build product type mismatch handling section if mismatch detected
    let productTypeMismatchHandling = '';
    if (context?.productTypeMismatch) {
      const { queryProductType, returnedProductTypes } = context.productTypeMismatch;
      // Use actual product types extracted from titles if available, otherwise use returnedProductTypes
      const shownProductTypes = actualProductTypesList.length > 0 
        ? actualProductTypesList 
        : returnedProductTypes;
      
      productTypeMismatchHandling = `
PRODUCT_TYPE_MISMATCH DETECTED:
- User asked for: "${queryProductType}"
- Products actually being shown are: ${shownProductTypes.join(', ')} (extracted from product titles: ${products.slice(0, 3).map(p => `"${p.title}"`).join(', ')})
- This means we couldn't find exact matches for what they asked for

CRITICAL INSTRUCTIONS FOR PRODUCT_TYPE_MISMATCH - YOU MUST FOLLOW THESE EXACTLY:
- In your FIRST opening paragraph (before products), you MUST acknowledge honestly that you couldn't find exact matches
- Start your reply by acknowledging what they asked for: "I couldn't find ${queryProductType}..." or "I don't have ${queryProductType} in the exact style you're looking for..."
- Then explain what you're showing instead: "but I found some ${shownProductTypes.join(' and ')} that might work for you" or "but I'm showing you some ${shownProductTypes.join(' and ')} that have a similar feel"
- Be understanding and honest - don't pretend the products match exactly what they asked for
- Keep it concise and human - use less flowery language, be more direct and honest
- Put MORE weight on what they just asked for (the latest update to the query) - acknowledge "${queryProductType}" first and prominently
- DO NOT say "I found some ${queryProductType}" or "Here are some ${queryProductType}" - that's a lie! You're showing ${shownProductTypes.join(' and ')}, not ${queryProductType}
- Example opening: "I couldn't find ${queryProductType} in pink for curvy women, but I found some ${shownProductTypes.join(' and ')} that might work for you. These have a similar cozy feel and come in pink."
- Look at the PRODUCT_DETAILS below to see exactly what products are being shown - use those product titles/types to describe what you're actually showing
`;
    } else if (actualProductTypesList.length > 0) {
      // Even if no explicit mismatch was detected, if we can extract product types, include them for context
      // This helps the LLM understand what's actually being shown
      productTypeMismatchHandling = `
ACTUAL PRODUCTS BEING SHOWN:
- The products below are: ${actualProductTypesList.join(', ')} (extracted from product titles)
- Use this information to accurately describe what you're showing in your reply
`;
    }

    // Build product mismatch guidance for internal section
    let productMismatchGuidance = '';
    if (context?.productTypeMismatch || actualProductTypesList.length > 0) {
      if (context?.productTypeMismatch) {
        productMismatchGuidance = `\n\nProduct mismatch detected: The products shown may not exactly match the enhanced query. Use this information when generating the reply to acknowledge any mismatches naturally.`;
      } else {
        productMismatchGuidance = `\n\nProducts being shown: ${actualProductTypesList.join(', ')} (extracted from product titles). Use this information to accurately describe what you're showing.`;
      }
    }

    // Build explicit vs inferred constraints section
    const explicitMentions = context?.explicitMentions || [];
    let explicitVsInferredSection = '';
    if (explicitMentions.length > 0) {
      explicitVsInferredSection = `
CRITICAL: EXPLICITLY MENTIONED vs INFERRED CONSTRAINTS

The following constraints were EXPLICITLY MENTIONED by the user in their query:
${explicitMentions.map(m => `- ${m}`).join('\n')}

ALL OTHER constraints in the CONSTRAINTS EXTRACTED section above were INFERRED by the system based on context, not explicitly stated by the user.

CRITICAL RULES FOR ACKNOWLEDGING CONSTRAINTS:
1. **ONLY credit the user for EXPLICITLY MENTIONED constraints** - Use phrases like:
   - "You mentioned [constraint]" ONLY for explicitly mentioned constraints
   - "You're looking for [constraint]" ONLY if they explicitly said it
   - "You want [constraint]" ONLY if they explicitly said it

2. **For INFERRED constraints, frame them as YOUR interpretation** - Use phrases like:
   - "For a [occasion], I'm thinking [constraint] would work well"
   - "For [context], [constraint] seems perfect"
   - "I thought [constraint] might be what you're looking for"
   - "For [occasion], [constraint] is ideal"
   - "Since you're going to [occasion], I'm showing you [constraint]"
   - DO NOT say "you mentioned" or "you said" for inferred constraints
   - DO NOT say "you love" or "you're looking for" for inferred constraints

3. **Examples:**
   - If user said "Bahamas vacation" and system inferred "floral patterns":
     ❌ WRONG: "You mentioned loving florals" or "You're looking for florals"
     ✅ CORRECT: "For a Bahamas vacation, I'm thinking floral patterns would be perfect" or "I thought you might like pieces with floral details"
   
   - If user said "black dress" and system inferred "formal occasion":
     ❌ WRONG: "You mentioned wanting something formal"
     ✅ CORRECT: "For a black dress, I'm showing you some elegant options" or "I thought these formal styles might work well"
   
   - If user explicitly said "I want floral patterns":
     ✅ CORRECT: "You mentioned wanting floral patterns" or "You're looking for florals"

4. **Be honest and natural** - Don't pretend the user said things they didn't say. Frame inferred constraints as your thoughtful interpretation based on their context.
`;
    }

    const prompt = REPLY_PROMPT
      .replace('{QUERY}', query)
      .replace('{FOLLOW_UP_CONTEXT}', followUpContext)
      .replace('{ENHANCED_QUERY}', enhancedQueryText)
      .replace('{ENHANCED_QUERY_PRIORITY}', enhancedQueryPriority)
      .replace('{PRODUCT_MISMATCH_GUIDANCE}', productMismatchGuidance)
      .replace('{FOLLOW_UP_PRIORITY}', followUpPriority)
      .replace('{PRODUCT_TYPE_MISMATCH_HANDLING}', productTypeMismatchHandling)
      .replace('{EXPLICIT_VS_INFERRED}', explicitVsInferredSection)
      .replace('{CONSTRAINTS}', constraintsText)
      .replace('{PRODUCT_DETAILS}', productDetails)
      .replace(/{PRODUCT_COUNT}/g, String(productCount))
      .replace(/{PRODUCT_COUNT_PLUS_2}/g, String(productCountPlus2))
      .replace(/{TOTAL_PARAGRAPHS}/g, String(totalParagraphs));

    const systemPrompt = `You are a shopping assistant and style expert for ${brandName}, embodying the brand's warm, elegant voice. You're an expert across all categories - fashion, home decor, beauty, accessories, and more. You understand what users are looking for and can correlate their queries to specific products. You back up your recommendations with actual product facts (materials, styles, occasions, colors, scents, room types, use cases, etc.), communicated naturally and conversationally.

CRITICAL: QUERY INTERPRETATION
- The user's input is ONLY what they say in their query/enhanced query
- Everything else (colors, styles, occasions, materials, etc.) is YOUR interpretation of what they need
- Focus on understanding their query and interpreting what they're looking for in a logical, broad sense
- DO NOT expose technical constraint names or attribute names in your reply
- Show you understand the meaning behind their query conversationally, not as technical data
- For follow-up queries: Prioritize the RECENT CHANGE in the enhanced query - focus on what's NEW or DIFFERENT from previous queries
- For the reply text BEFORE product cards: Interpret their query naturally and explain your interpretation in a logical, broad sense
- For product paragraphs AFTER cards: Connect product attributes to what they're looking for using natural language
- If products don't match exactly what the enhanced query suggests, acknowledge this naturally and honestly

BRAND VOICE - LOVE SHACK FANCY:
- Warm, elegant confidence: Conversational and polished, with subtle romantic touches
- Natural, feminine language: Warm, intimate, celebratory - but never overly precious
- Conversational poetic touches: Use subtle imagery naturally, not forced
- Elegant restraint: Polished, curated, subtly sophisticated

STYLE:
- Write with warm, elegant confidence - conversational and polished
- Use natural, feminine language that feels intimate and celebratory - warm but not overly precious
- Be warm, helpful, and celebratory - inviting them into beautiful pieces
- Maintain elegant restraint: polished, curated, subtly sophisticated
- CRITICAL: Write as if you're having a friendly conversation, NOT a bot. Sound natural and conversational, not like you're processing a search query.
- NEVER use phrases like "you searched for", "your query", "I found options matching your search", "based on your search", or any meta-reference to the search/query process
- Write naturally as if responding organically to what they said
- Avoid any language that makes it feel like a system or platform - no references to "search", "query", "results", "matching", etc.
- Use SHORT, concise sentences - aim for 8-12 words per sentence
- Organize your reply with {TOTAL_PARAGRAPHS} paragraphs total (2 before products, {PRODUCT_COUNT} for individual products, 1 closing)
- Before products: ONE sentence per paragraph (warm and polished - natural storytelling)
- After products: Each product gets its own paragraph with ONE sentence (conversational, warm, elegant, helpful)
- Before products: Write with warm, elegant confidence - ONE sentence per paragraph. Use natural, conversational language with subtle poetic touches. Acknowledge EACH part of their request—show you understand the meaning behind every color, style, occasion, size, material, and constraint. Do this naturally, not by listing. Mention key details conversationally. Use shorter sentences (8-12 words). Be warm, helpful, and polished. Keep it conversational.
- After products: Warm, conversational voice - one paragraph per product with ONE sentence. Explain how each product works naturally. Show how each product addresses the specific parts of their request. Be honest about fit with restraint. Use shorter sentences (8-12 words). Keep it elegant and helpful.
- Don't use bullet points - write in flowing paragraphs
- Be honest about fits in both sections with restraint - acknowledge close-but-not-perfect fits naturally, express great fits with warmth
- Show understanding of different contexts (occasions, seasons, cultural considerations, etc.) naturally, with restraint

FORMATTING:
- Always separate paragraphs with double newlines (\\n\\n)
- Use {TOTAL_PARAGRAPHS} paragraphs total (2 before products, {PRODUCT_COUNT} for individual products after cards, 1 closing)
- First 2 paragraphs go before products (warm and polished - ONE sentence each, natural storytelling, conversational, elegant, shorter sentences 8-12 words)
- Next {PRODUCT_COUNT} paragraphs go after products (one per product, ONE sentence each, conversational, warm, elegant, helpful, shorter sentences 8-12 words)
- Final paragraph goes after products (closing line, warm, inviting, and elegant - one sentence)`
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
        replyTextAfter = `I hope you find something perfect here.`;
      } else {
      replyTextAfter = undefined;
      }
    }
    
    // CRITICAL: Always ensure replyTextAfter exists when we have products
    // This is a safety net to ensure the post-card text always appears
    if (products.length > 0 && (!replyTextAfter || replyTextAfter.trim().length === 0)) {
      replyTextAfter = `I hope you find something perfect here.`;
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
 * Generate an intelligent, context-aware regretful reply when no products are found
 * Analyzes constraints and suggests alternatives in LSF brand voice
 */
export async function generateRegretfulReply(
  userQuery: string,
  productCount: number,
  topScore: number,
  brandName: string,
  enhancedQuery?: string,
  previousQuery?: string,
  constraints?: FashionConstraints,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<ReplyResult> {
  try {
    // Build context summary
    const contextParts: string[] = [];
    if (previousQuery) {
      contextParts.push(`Previous conversation context: "${previousQuery}"`);
    }
    if (enhancedQuery && enhancedQuery !== userQuery) {
      contextParts.push(`Enhanced query: "${enhancedQuery}"`);
    }
    
    // Analyze constraints to suggest what might be too restrictive
    // Extract values from intent format if needed
    const activeConstraints: string[] = [];
    if (constraints?.colors) {
      const colorValues = extractConstraintValues(constraints.colors) || (Array.isArray(constraints.colors) ? constraints.colors : []);
      if (colorValues.length > 0) {
        activeConstraints.push(`colors: ${colorValues.join(', ')}`);
      }
    }
    if (constraints?.occasions) {
      const occasionValues = extractConstraintValues(constraints.occasions) || (Array.isArray(constraints.occasions) ? constraints.occasions : []);
      if (occasionValues.length > 0) {
        activeConstraints.push(`occasions: ${occasionValues.join(', ')}`);
      }
    }
    if (constraints?.materials) {
      const materialValues = extractConstraintValues(constraints.materials) || (Array.isArray(constraints.materials) ? constraints.materials : []);
      if (materialValues.length > 0) {
        activeConstraints.push(`materials: ${materialValues.join(', ')}`);
      }
    }
    if (constraints?.seasons) {
      const seasonValues = extractConstraintValues(constraints.seasons) || (Array.isArray(constraints.seasons) ? constraints.seasons : []);
      if (seasonValues.length > 0) {
        activeConstraints.push(`seasons: ${seasonValues.join(', ')}`);
      }
    }
    if (constraints?.styles) {
      const styleValues = extractConstraintValues(constraints.styles) || (Array.isArray(constraints.styles) ? constraints.styles : []);
      if (styleValues.length > 0) {
        activeConstraints.push(`styles: ${styleValues.join(', ')}`);
      }
    }
    if (constraints?.patterns) {
      const patternValues = extractConstraintValues(constraints.patterns) || (Array.isArray(constraints.patterns) ? constraints.patterns : []);
      if (patternValues.length > 0) {
        activeConstraints.push(`patterns: ${patternValues.join(', ')}`);
      }
    }
    if (constraints?.lengths) {
      const lengthValues = extractConstraintValues(constraints.lengths) || (Array.isArray(constraints.lengths) ? constraints.lengths : []);
      if (lengthValues.length > 0) {
        activeConstraints.push(`lengths: ${lengthValues.join(', ')}`);
      }
    }
    if (constraints?.fits) {
      const fitValues = extractConstraintValues(constraints.fits) || (Array.isArray(constraints.fits) ? constraints.fits : []);
      if (fitValues.length > 0) {
        activeConstraints.push(`fits: ${fitValues.join(', ')}`);
      }
    }
    if (constraints?.ageGroups) {
      const ageGroupValues = extractConstraintValues(constraints.ageGroups) || (Array.isArray(constraints.ageGroups) ? constraints.ageGroups : []);
      if (ageGroupValues.length > 0) {
        activeConstraints.push(`age groups: ${ageGroupValues.join(', ')}`);
      }
    }
    if (constraints?.sizes) {
      const sizeValues = extractConstraintValues(constraints.sizes) || (Array.isArray(constraints.sizes) ? constraints.sizes : []);
      if (sizeValues.length > 0) {
        activeConstraints.push(`sizes: ${sizeValues.join(', ')}`);
      }
    }
    if (constraints?.priceMinCents || constraints?.priceMaxCents) {
      const priceRange = [];
      if (constraints.priceMinCents) priceRange.push(`min: $${(constraints.priceMinCents / 100).toFixed(2)}`);
      if (constraints.priceMaxCents) priceRange.push(`max: $${(constraints.priceMaxCents / 100).toFixed(2)}`);
      activeConstraints.push(`price range: ${priceRange.join(', ')}`);
    }

    const constraintsText = activeConstraints.length > 0 
      ? `Active constraints: ${activeConstraints.join('; ')}`
      : 'No specific constraints applied';

    const prompt = `The user asked: "${userQuery}"
${contextParts.length > 0 ? contextParts.join('\n') + '\n' : ''}
${constraintsText}

We found ${productCount} products matching these criteria. This means the combination of constraints might be too restrictive, or we don't have products that match this specific combination.

Your task: Generate a concise, warm, and helpful reply in ${brandName}'s brand voice that:
1. Acknowledges their request briefly and shows you understand what they're looking for
2. Expresses gentle regret (with elegant restraint) that we couldn't find perfect matches
3. Suggests one or two specific alternatives:
   - If there are many constraints, suggest dropping one constraint (mention which one is most flexible)
   - Suggest one related product type or style that might work
   - Briefly invite them to explore with slightly different criteria
4. Maintains the warm, elegant, conversational tone with subtle romantic touches
5. Keep it CONCISE: 2-3 paragraphs maximum, with 1-2 SHORT sentences per paragraph (8-15 words per sentence)
6. Be specific and helpful - don't be vague. Show you understand their needs and offer one concrete alternative.

BRAND VOICE - LOVE SHACK FANCY:
- Warm, elegant confidence: Conversational and polished, with subtle romantic touches
- Natural, feminine language: Warm, intimate, celebratory - but never overly precious
- Conversational poetic touches: Use subtle imagery naturally, not forced
- Elegant restraint: Polished, curated, subtly sophisticated

Write naturally as if having a friendly conversation. Be warm, helpful, and elegant. Keep it brief and easy to read.

CRITICAL FORMATTING RULES:
- Write 2-3 paragraphs maximum
- Each paragraph should contain 1-2 SHORT sentences (8-15 words per sentence)
- Keep sentences concise and easy to read - avoid long, complex sentences
- Break thoughts into separate sentences rather than combining them
- The total reply should be brief (around 50-80 words total)
- Use line breaks (newlines) to separate paragraphs

EXAMPLE FORMAT:
"I understand you're looking for [item] in [color], but we don't have that exact combination right now.

If you're open to [alternative color] or [similar style], I'd love to show you some options. Or we could explore [related category] which might work beautifully.

Would you like me to show you those alternatives?"`;

    const systemPrompt = `You are a shopping assistant for ${brandName}, embodying the brand's warm, elegant voice. Your task is to generate an intelligent, context-aware reply when no products are found. 

You must:
- Analyze the constraints and understand which ones might be too restrictive
- Suggest ONE specific alternative (e.g., "try dropping the color constraint" or "explore similar styles")
- Show you understand their needs based on the conversation context
- Write with warm, elegant confidence—conversational with subtle romantic touches
- Use natural, feminine language that feels intimate but polished
- Be warm, helpful, and celebratory—inviting them to explore—while keeping elegant restraint
- Be specific and actionable, but keep it BRIEF
- Keep it to 2-3 paragraphs maximum, with 1-2 SHORT sentences per paragraph (8-15 words per sentence)
- Each sentence should be concise and easy to read - avoid long, complex sentences
- The total reply should be brief (around 50-80 words total)
- NEVER use phrases like "you searched for", "your query", "I found options matching your search" - write naturally as if responding organically
- CRITICAL: Keep it concise and readable. Break thoughts into short, clear sentences. Use 1-2 sentences per paragraph, maximum 3 paragraphs total.`;

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
      maxTokens: 150, // Keep it concise - aim for 50-80 words total
    });

    const fullReply = result.rawText.trim();
    
    logger.info('regretful_reply_llm_response', {
      query: userQuery.substring(0, 100),
      fullReplyLength: fullReply.length,
      fullReplyPreview: fullReply.substring(0, 200),
    });
    
    const paragraphs = fullReply.split(/\n\n+/).filter(p => p.trim().length > 0);
    
    // If we got a very short response or no paragraphs, use the full reply
    let replyText: string;
    if (paragraphs.length === 0) {
      // No paragraphs found - use the full reply as-is
      replyText = fullReply || `I couldn't find perfect matches for "${userQuery}" in our collection right now. Our collection is always evolving, so feel free to explore different options or browse our curated categories. How else can I help you find something you'll love?`;
    } else if (paragraphs.length === 1) {
      // Only one paragraph - use it
      replyText = paragraphs[0].trim();
    } else {
      // Multiple paragraphs - take first 2
      replyText = paragraphs.slice(0, 2).join('\n\n').trim();
    }
    
    // Ensure minimum length - if reply is too short, it might be an error
    if (replyText.length < 50) {
      logger.warn('regretful_reply_too_short', {
        query: userQuery.substring(0, 100),
        replyLength: replyText.length,
        replyText,
        fullReplyLength: fullReply.length,
        paragraphCount: paragraphs.length,
      });
      // Use fallback if reply is suspiciously short
      replyText = `I couldn't find perfect matches for "${userQuery}" in our collection right now. Our collection is always evolving, so feel free to explore different options or browse our curated categories. How else can I help you find something you'll love?`;
    }

    logger.info('regretful_reply_final', {
      query: userQuery.substring(0, 100),
      replyLength: replyText.length,
      paragraphCount: paragraphs.length,
      replyPreview: replyText.substring(0, 150),
    });

    return {
      replyText,
      replyTextAfter: paragraphs.length > 2 ? paragraphs.slice(2).join('\n\n').trim() : undefined, // Remaining paragraphs
    };
  } catch (error) {
    logger.error('regretful_reply_generation_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: userQuery.substring(0, 100),
    });

    // Fallback reply (in LoveShackFancy brand voice)
    return {
      replyText: `I couldn't find perfect matches for "${userQuery}" in our collection right now. Our collection is always evolving, so feel free to explore different options or browse our curated categories. How else can I help you find something you'll love?`,
      replyTextAfter: undefined,
    };
  }
}
