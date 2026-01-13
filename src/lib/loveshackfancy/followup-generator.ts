/**
 * Follow-up Question Generator
 * 
 * Generates clarifying questions for vague queries using LLM.
 * Can regenerate remaining questions based on accumulated responses.
 */

import { callLLM } from '../llm/provider';
import { logger } from '../telemetry/logger';
import type { DatasetContext } from '../catalog/datasetInspector';

export type FollowUpQuestions = {
  questions: string[];
  contextSummary: string;
};

const FOLLOWUP_QUESTION_PROMPT = `You are a shopping assistant for LoveShackFancy, embodying the brand's soft-glam, poetic voice. You have great style, a sense of humor, and you genuinely love helping people find the perfect pieces. The catalog includes multiple category groups: Kids, Women's/Adult Apparel, Accessories, Personal Care, and Home & Living.

LOVE SHACK FANCY BRAND VOICE:
- Soft-glam, poetic confidence: Romantic and nostalgic, but always polished
- Speak in scenes and sensations: Use imagery like "golden hour", "garden parties", "moonlit evenings" - paint moments, not just features
- Airy, feminine language: Feel like a love letter - warm, intimate, celebratory - but never childish or overly precious
- Dreamy world: Invite them into ruffles, lace, and heirloom details through feeling-first storytelling
- High-end restraint: Elegant, curated, subtly cheeky - like a modern muse sharing secrets
- Write as if you're a MODERN MUSE, NOT a bot or tech platform. Sound like you're naturally continuing an intimate conversation

Someone just asked you: "{USER_QUERY}"

Similar products we found (for context):
{PRELIMINARY_PRODUCTS}

DATASET CONTEXT:
{DATASET_CONTEXT}

{POTENTIAL_CATEGORIES_SECTION}

{UNRELATED_QUERY_SECTION}

Your task:
Write a warm, conversational opening message (EXACTLY 2 sentences per paragraph, keep sentences SHORT - 8-12 words max) that addresses them directly, then EXACTLY ONE targeted clarifying question focused on identifying the product category.

**CRITICAL: In your contextSummary, explicitly acknowledge and show understanding of what they mentioned in their query. If they mentioned colors, styles, occasions, sizes, materials, or any specific details, acknowledge those and show you understand what they mean. For example, if they mentioned "lavender scents," show you understand they want fragrance. If they mentioned "teenage daughter," show you understand age-appropriate styling. If they mentioned "muslim wedding," show you understand modesty requirements. Do this naturally through warm, conversational language—show comprehension, don't just repeat their words.**

**CRITICAL: CONCISENESS RULES:**
- Keep sentences SHORT (8-12 words maximum per sentence)
- Use EXACTLY 2 sentences per paragraph
- REDUCE adjectives - use 1-2 descriptive words max, not 3-4
- Keep the understanding and acknowledgment, but be more direct
- Maintain brand tone (soft-glam, poetic) but with restraint - less flowery language
- Example of GOOD: "Ooh, a curvy mom looking for something fabulous! I love that you're embracing your shape and want pieces that make you feel confident."
- Example of TOO LONG: "Ooh, a curvy mom looking for something absolutely fabulous to wear! I love that you're embracing your beautiful shape and want pieces that make you feel like the queen of golden hour garden parties or moonlit evenings."

**CRITICAL: Your FIRST question should identify the product category/type (e.g., dresses, tops, bedding, accessories, jewelry, perfumes). Only ask about colors, sizes, or other attributes if the category is already clear from the query.**

**If POTENTIAL_CATEGORIES are provided above, your first question MUST ask if those categories are what they're looking for. For example: "Are you looking for dresses, accessories, or something else?" or "I'm thinking you might be looking for bedding or towels—is that right?"**

TONE & STYLE - CRITICAL RULES:
- Write EXACTLY as if you're texting a friend right now. This is a direct conversation, not a report.
- Use "you" and "your" in EVERY sentence. NEVER say "the user", "User is", "they", "them", or any third-person language.
- START your contextSummary with an interjection or exclamation ("Ooh!", "Love that!", "So exciting!") to force conversational tone.
- Be witty, playful, and genuinely excited. Add personality! Make them smile.
- Sound human—no corporate speak, no formal analysis, no robotic phrases.
- Keep it warm and helpful, but don't be overly formal.
- Use LoveShackFancy's brand voice: soft-glam, poetic confidence—romantic and nostalgic, but always polished. Speak in scenes and sensations (golden hour, garden parties, moonlit evenings). Use airy, feminine language that feels like a love letter without becoming childish or overly precious. Be warm, intimate, and celebratory—inviting them into a dreamy world of ruffles, lace, and heirloom details—while keeping high-end restraint: elegant, curated, and subtly cheeky, with feeling-first storytelling of a modern muse.

ABSOLUTELY FORBIDDEN - NEVER START WITH:
❌ "User is searching for..." 
❌ "The user wants..." 
❌ "They are looking..." 
❌ "Based on the query..." 
❌ "The customer asked..." 
❌ ANY sentence starting with "User", "The user", "They", "The customer"
❌ ANY third-person description of what the user is doing

REQUIRED - ALWAYS START WITH:
✅ "Ooh, [item/occasion]! How exciting!"
✅ "Love that you're looking for [item]!"
✅ "So exciting! [occasion] shopping is the best!"
✅ "I'd love to help you find..."
✅ Direct address using "you" and "your" from the very first word

CRITICAL: Always start with an interjection or exclamation to force conversational tone! Use phrases like:
- "Ooh, [occasion/item]! How exciting!"
- "Love that you're looking for [item]!"
- "So exciting! [occasion] shopping is one of my favorites!"
- "Ooh, [item]! I'm already envisioning some gorgeous options!"

EXAMPLES - DO THIS (✅):
✅ "Ooh, a wedding! How exciting! Let me help you find something absolutely stunning—I'm already envisioning a few gorgeous options."
✅ "Wedding shopping is so fun! I'd love to help you find the perfect piece. Quick question..."
✅ "Love that you're thinking about wedding looks! There are so many beautiful directions we could go. What vibe are you feeling?"
✅ "Ooh, summer dresses! Perfect timing. Let me help you find something gorgeous. What style are you feeling?"

EXAMPLES - NEVER DO THIS (❌):
❌ "User is searching for an item related to a wedding, but it's unclear what category or style they want."
❌ "The user wants something for a wedding, and similar products suggest interest in accessories or apparel."
❌ "Based on the query, the user is looking for wedding-related items."

Rules for questions:
1. **CRITICAL: Generate EXACTLY 1 question focused ONLY on identifying the product category/type**
   - Your question MUST identify the product category/type (e.g., "Are you looking for dresses, tops, accessories, or something else?", "What type of item are you shopping for?")
   - Do NOT ask about colors, sizes, or other attributes - ONLY category
   - Examples: "What type of item are you shopping for?", "Are you looking for dresses, tops, or something else?"
2. Specific and actionable
3. Natural, conversational language - ask directly, like a friend would
4. Consider what similar products suggest (if provided)
5. Short and friendly—no need to be overly formal
6. Ask about categories relevant to the catalog's category groups (Kids, Apparel, Accessories, Personal Care, Home & Living)

Output JSON:
{
  "questions": ["question 1"],
  "contextSummary": "A warm, concise opening (EXACTLY 2 sentences, 8-12 words per sentence) talking directly TO them using 'you'. Explicitly acknowledge what they mentioned in their query—show you understand the meaning behind each part (colors, styles, occasions, sizes, materials, etc.). Be natural and human—like you're genuinely excited to help. Use FEWER adjectives (1-2 max per sentence). Keep sentences SHORT. Maintain brand tone but with restraint—less flowery language. Demonstrate comprehension of what they really need, not just what they said."
}

**CRITICAL**: Generate EXACTLY 1 question. The question MUST focus ONLY on identifying the product category/type. Do NOT ask about colors, sizes, or other attributes.`;

const REGENERATE_REMAINING_QUESTIONS_PROMPT = `You are a shopping assistant for LoveShackFancy, embodying the brand's soft-glam, poetic voice. The catalog includes multiple category groups: Kids, Women's/Adult Apparel, Accessories, Personal Care, and Home & Living.

LOVE SHACK FANCY BRAND VOICE:
- Soft-glam, poetic confidence: Romantic and nostalgic, but always polished
- Speak in scenes and sensations: Use imagery like "golden hour", "garden parties", "moonlit evenings" - paint moments, not just features
- Airy, feminine language: Feel like a love letter - warm, intimate, celebratory - but never childish or overly precious
- Dreamy world: Invite them into ruffles, lace, and heirloom details through feeling-first storytelling
- High-end restraint: Elegant, curated, subtly cheeky - like a modern muse sharing secrets
- Write as if you're a MODERN MUSE, NOT a bot or tech platform. Sound like you're naturally continuing an intimate conversation

ORIGINAL QUERY: "{ORIGINAL_QUERY}"

USER'S RESPONSES SO FAR:
{ACCUMULATED_RESPONSES}

REMAINING QUESTIONS (that were planned, but now need to be updated based on responses):
{REMAINING_QUESTIONS}

PRELIMINARY PRODUCTS (for context):
{PRELIMINARY_PRODUCTS}

DATASET CONTEXT:
{DATASET_CONTEXT}

Your task:
Generate the NEXT question only (just one question), taking into account:
1. What the user has already told us (their responses so far)
2. What information is still missing
3. Make it conversational, witty, and direct - ask like you're texting a friend
4. Don't repeat what they've already answered
5. Build on their previous answers naturally

TONE:
- Use "you" and "your" directly
- Use LoveShackFancy's brand voice: soft-glam, poetic confidence—romantic and nostalgic, but always polished. Speak in scenes and sensations (golden hour, garden parties, moonlit evenings). Use airy, feminine language that feels like a love letter without becoming childish or overly precious. Be warm, intimate, and celebratory—inviting them into a dreamy world—while keeping high-end restraint: elegant, curated, and subtly cheeky, with feeling-first storytelling of a modern muse.
- Be warm, conversational, and slightly playful
- Keep it short and friendly

Output JSON:
{
  "nextQuestion": "The single next question to ask, making it contextual to their previous responses"
}`;

export async function generateFollowUpQuestions(
  vagueQuery: string,
  preliminaryProducts?: Array<{ productId: string; title: string; similarity: number }>,
  datasetContext?: DatasetContext | null,
  potentialCategories?: string[],
  isUnrelatedQuery?: boolean
): Promise<FollowUpQuestions> {
  console.log('[FOLLOWUP-GEN] Starting generateFollowUpQuestions for query:', vagueQuery);
  try {
    const datasetHint = datasetContext?.vertical
      ? `Vertical: ${datasetContext.vertical}. Primary facets: ${datasetContext.primaryFacets?.slice(0, 10).join(', ') || 'N/A'}.`
      : 'Generic catalog.';

    const productsContext = preliminaryProducts && preliminaryProducts.length > 0
      ? preliminaryProducts
          .slice(0, 3)
          .map(p => `- ${p.title} (similarity: ${p.similarity.toFixed(2)})`)
          .join('\n')
      : 'No similar products found yet.';

    // Build potential categories section if provided
    const potentialCategoriesSection = potentialCategories && potentialCategories.length > 0
      ? `\n\n**POTENTIAL CATEGORIES** (low confidence suggestions - ask user to confirm):\n${potentialCategories.map(cat => `- ${cat}`).join('\n')}\n\nIMPORTANT: Your first question should ask if these categories are what they're looking for. For example: "Are you looking for ${potentialCategories.join(', ')}${potentialCategories.length > 1 ? ', or something else' : ', or something else'}?"`
      : '';

    // Build unrelated query section if this is an unrelated query
    const unrelatedQuerySection = isUnrelatedQuery
      ? `\n\n**CRITICAL: THIS IS AN UNRELATED QUERY** - The user's query seems unrelated to shopping, but they might be looking for products in a very indirect way. 

IMPORTANT CONTEXT:
- Available categories in our catalog: ${potentialCategories && potentialCategories.length > 0 ? potentialCategories.join(', ') : 'See full category list above'}
- DO NOT recommend products that don't exist in our catalog (e.g., "dresses for animals" when we only have human clothing)
- DO intelligently redirect to products we actually have
- If the query mentions products we don't have, acknowledge that gracefully and suggest what we do have

Your task is to WITTIER and more PLAYFULLY divert the conversation to product discovery while acknowledging their query. CRITICAL: Explicitly acknowledge what they mentioned in their query—show you understand the meaning behind what they said, even if it seems unrelated. Be more creative and cheeky in your diversion—think of it as a gentle, charming redirect that invites them into our dreamy world of products. Use LoveShackFancy's brand voice: soft-glam, poetic, romantic, nostalgic, but always polished. Speak in scenes and sensations (golden hour, garden parties, moonlit evenings) rather than hard selling. Be warm, intimate, and celebratory—inviting them into a dreamy world—while keeping high-end restraint: elegant, curated, and subtly cheeky. Make them smile and want to explore our collection!

BUT: If the query is about products we absolutely don't have (e.g., "cars", "electronics", "pet clothing"), acknowledge that gracefully and suggest exploring what we do have instead.`
      : '';

    const prompt = FOLLOWUP_QUESTION_PROMPT
      .replace('{USER_QUERY}', vagueQuery)
      .replace('{PRELIMINARY_PRODUCTS}', productsContext)
      .replace('{DATASET_CONTEXT}', datasetHint)
      .replace('{POTENTIAL_CATEGORIES_SECTION}', potentialCategoriesSection)
      .replace('{UNRELATED_QUERY_SECTION}', unrelatedQuerySection);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: `You are a shopping assistant for LoveShackFancy, embodying the brand's soft-glam, poetic voice. The catalog includes multiple category groups: Kids, Women's/Adult Apparel, Accessories, Personal Care, and Home & Living.

LOVE SHACK FANCY BRAND VOICE:
- Soft-glam, poetic confidence: Romantic and nostalgic, but always polished
- Speak in scenes and sensations: Use imagery like "golden hour", "garden parties", "moonlit evenings" - paint moments, not just features
- Airy, feminine language: Feel like a love letter - warm, intimate, celebratory - but never childish or overly precious
- Dreamy world: Invite them into ruffles, lace, and heirloom details through feeling-first storytelling
- High-end restraint: Elegant, curated, subtly cheeky - like a modern muse sharing secrets
- Write as if you're a MODERN MUSE, NOT a bot or tech platform. Sound like you're naturally continuing an intimate conversation

You MUST talk directly to customers using "you" and "your"—NEVER use "the user", "User is", "they", or third person. Write like you're texting a friend: natural, warm, conversational, and slightly playful. Be genuinely excited about helping customers find perfect pieces across all categories. Your contextSummary should start with phrases like "You're looking for..." or "I'd love to help you..."—never "User is searching..."`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'followup_prompts',
      expectJson: true,
      schema: {
        name: 'FollowUpQuestions',
        schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 2,
            },
            contextSummary: { type: 'string' },
          },
          required: ['questions', 'contextSummary'],
        },
      },
    });

    const followups = JSON.parse(result.rawText) as FollowUpQuestions;

    // Post-processing to fix third-person language that slipped through
    let contextSummary = followups.contextSummary;
    
    // FIRST: Aggressively fix third-person patterns - critical for UX
    // Catch ANY sentence starting with "User" and rewrite it
    contextSummary = contextSummary
      // Fix "User is searching for..." -> "You're looking for..."
      .replace(/^User is searching for ([^,\.]+)/gi, (match, rest) => `You're looking for ${rest.toLowerCase()}`)
      // Catch ANY "User is [anything]" at start and convert
      .replace(/^User is ([^,\.!?]+)/gi, (match, rest) => {
        // Capitalize first letter of rest
        const capitalized = rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
        return `You're ${capitalized}`;
      })
      // Fix "The user" at start
      .replace(/^The user ([^,\.!?]+)/gi, (match, rest) => {
        const capitalized = rest.charAt(0).toUpperCase() + rest.slice(1);
        return `You ${capitalized}`;
      })
      // Fix "They are looking" -> "You're looking"
      .replace(/^They are looking/gi, "You're looking")
      // Fix "Based on the query" patterns
      .replace(/Based on the query, (the user|they|user) (is|are|wants|wants to)/gi, (match, pronoun, verb) => {
        return "You're";
      })
      // Fix "The customer" patterns
      .replace(/^The customer ([^,\.!?]+)/gi, (match, rest) => {
        const capitalized = rest.charAt(0).toUpperCase() + rest.slice(1);
        return `You ${capitalized}`;
      });

    const originalContextSummary = contextSummary;
    
    // Final safety check: if it STILL starts with forbidden patterns, rewrite completely
    const forbiddenPatterns = [
      /^User is/i,
      /^The user/i,
      /^They are/i,
      /^Based on the query/i,
      /^The customer/i,
    ];
    
    const startsWithForbidden = forbiddenPatterns.some(pattern => pattern.test(contextSummary));
    
    if (startsWithForbidden) {
      // Extract the main topic from the vague query
      const topicMatch = vagueQuery.match(/(?:looking for|want|need|shopping for|find)\s+(.+)/i);
      const topic = topicMatch ? topicMatch[1] : 'something special';
      
      // Rewrite with a friendly, direct opening
      contextSummary = `Ooh, ${topic}! How exciting! I'd love to help you find something absolutely perfect—let's get a little more specific so I can pick out some dreamy options for you.`;
      
      console.log('[FOLLOWUP-GEN] FINAL contextSummary was rewritten (starts with forbidden):', contextSummary);
      console.log('[FOLLOWUP-GEN] Original from LLM:', originalContextSummary);
    }

    console.log('[FOLLOWUP-GEN] FINAL contextSummary:', contextSummary);
    console.log('[FOLLOWUP-GEN] Original from LLM:', originalContextSummary);
    console.log('[FOLLOWUP-GEN] Was modified?', contextSummary !== followups.contextSummary);

    return {
      questions: followups.questions,
      contextSummary,
    };
  } catch (error) {
    logger.error('followup_generation_failed', {
      error: error instanceof Error ? error.message : String(error),
      query: vagueQuery.substring(0, 100),
    });

    // Fallback: return generic questions
    return {
      questions: [
        "What style are you looking for?",
        "Any preferred colors or patterns?",
        "What's your price range?",
      ],
      contextSummary: "I'd love to help you find something perfect! Let me ask a few quick questions to narrow things down.",
    };
  }
}

/**
 * Regenerate the next question based on accumulated responses
 * This makes questions more contextual and avoids repeating information
 */
export async function regenerateNextQuestion(
  originalQuery: string,
  accumulatedResponses: string[],
  remainingQuestions: string[],
  preliminaryProducts?: Array<{ productId: string; title: string; similarity: number }>,
  datasetContext?: DatasetContext | null
): Promise<string> {
  try {
    const datasetHint = datasetContext?.vertical
      ? `Vertical: ${datasetContext.vertical}. Primary facets: ${datasetContext.primaryFacets?.slice(0, 10).join(', ') || 'N/A'}.`
      : 'Generic catalog.';

    const productsContext = preliminaryProducts && preliminaryProducts.length > 0
      ? preliminaryProducts
          .slice(0, 3)
          .map(p => `- ${p.title}`)
          .join('\n')
      : 'None';

    const responsesContext = accumulatedResponses
      .map((r, i) => `Response ${i + 1}: "${r}"`)
      .join('\n');

    const remainingQuestionsContext = remainingQuestions
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n');

    const prompt = REGENERATE_REMAINING_QUESTIONS_PROMPT
      .replace('{ORIGINAL_QUERY}', originalQuery)
      .replace('{ACCUMULATED_RESPONSES}', responsesContext)
      .replace('{REMAINING_QUESTIONS}', remainingQuestionsContext)
      .replace('{PRELIMINARY_PRODUCTS}', productsContext)
      .replace('{DATASET_CONTEXT}', datasetHint);

    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: `You are a shopping assistant for LoveShackFancy, embodying the brand's soft-glam, poetic voice. The catalog includes multiple category groups: Kids, Women's/Adult Apparel, Accessories, Personal Care, and Home & Living.

LOVE SHACK FANCY BRAND VOICE:
- Soft-glam, poetic confidence: Romantic and nostalgic, but always polished
- Speak in scenes and sensations: Use imagery like "golden hour", "garden parties", "moonlit evenings" - paint moments, not just features
- Airy, feminine language: Feel like a love letter - warm, intimate, celebratory - but never childish or overly precious
- Dreamy world: Invite them into ruffles, lace, and heirloom details through feeling-first storytelling
- High-end restraint: Elegant, curated, subtly cheeky - like a modern muse sharing secrets
- Write as if you're a MODERN MUSE, NOT a bot or tech platform. Sound like you're naturally continuing an intimate conversation

Talk directly to customers using "you" and "your". Be warm, conversational, and slightly playful.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      purpose: 'followup_prompts',
      expectJson: true,
      schema: {
        name: 'NextQuestion',
        schema: {
          type: 'object',
          properties: {
            nextQuestion: { type: 'string' },
          },
          required: ['nextQuestion'],
        },
      },
    });

    const parsed = JSON.parse(result.rawText) as { nextQuestion: string };
    return parsed.nextQuestion;
  } catch (error) {
    logger.error('regenerate_next_question_failed', {
      error: error instanceof Error ? error.message : String(error),
      originalQuery: originalQuery.substring(0, 100),
    });

    // Fallback: return the first remaining question as-is
    return remainingQuestions[0] || "Anything else I should know?";
  }
}
