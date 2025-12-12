import { prisma } from '../../db';
import { env } from '../../config';
import { callLLM, type LlmMessage } from '../provider';
import { FINAL_RESPONSE_PROMPT, buildFinalResponsePrompt } from '../prompts';
import { logger } from '../../telemetry/logger';
import type { SearchConstraints, SearchResultItem } from '../../search/types';
import type { AssistantIntent } from './intent';
import { formatMoney } from './cards';
import type { DatasetContext } from '../../catalog/datasetInspector';
import type { CatalogOntology } from '../../search/ontology';

async function getBrandVoiceContext(): Promise<string> {
  try {
    const merchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!merchant) {
      logger.debug('brand_voice_not_configured', { message: 'No Merchant found, using default voice' });
      return '';
    }

    const formality = merchant.toneFormal > 7 ? 'formal' : merchant.toneFormal < 3 ? 'casual' : 'balanced';
    const playfulness = merchant.tonePlayful > 7 ? 'playful' : merchant.tonePlayful < 3 ? 'serious' : 'balanced';

    const context = `You are the shopping assistant for ${merchant.brandName}. ${merchant.voiceInstructions} Your communication style should be ${formality} in formality and ${playfulness} in playfulness. Always incorporate the brand name "${merchant.brandName}" naturally when appropriate.`;

    logger.debug('brand_voice_loaded', {
      brandName: merchant.brandName,
      formality: merchant.toneFormal,
      playfulness: merchant.tonePlayful,
      hasVoiceInstructions: !!merchant.voiceInstructions,
    });

    return context;
  } catch (error) {
    logger.error('failed_to_load_brand_voice', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

export async function applyBrandVoiceToReply(baseReply: string): Promise<string> {
  try {
    const merchant = await prisma.merchant.findUnique({ where: { slug: 'default' } });
    if (!merchant) {
      logger.debug('brand_voice_apply_skipped', { reason: 'No Merchant found' });
      return baseReply;
    }

    // For rule-based replies, we can't use LLM, but we can still personalize with brand name
    // Replace generic phrases with brand-specific ones
    let personalizedReply = baseReply;

    // If the reply doesn't mention the brand and it's a greeting/intro, add it
    if (!personalizedReply.toLowerCase().includes(merchant.brandName.toLowerCase())) {
      // Only add brand name if it's a natural place (beginning of reply)
      if (personalizedReply.startsWith('Hi') || personalizedReply.startsWith('I can') || personalizedReply.startsWith('We don')) {
        personalizedReply = personalizedReply.replace(/^Hi/, `Hi! I'm ${merchant.brandName}'s assistant`);
        personalizedReply = personalizedReply.replace(/^I can/, `I'm ${merchant.brandName}'s assistant and I can`);
        personalizedReply = personalizedReply.replace(/^We don't/, `At ${merchant.brandName}, we don't`);
      }
    }

    logger.debug('brand_voice_applied_to_reply', {
      brandName: merchant.brandName,
      originalLength: baseReply.length,
      personalizedLength: personalizedReply.length,
    });

    return personalizedReply;
  } catch (error) {
    logger.error('failed_to_apply_brand_voice', {
      error: error instanceof Error ? error.message : String(error),
    });
    return baseReply;
  }
}

export async function maybeEnhanceReplyWithLlm(params: {
  baseReply: string;
  userMessage: string;
  intent: AssistantIntent;
  constraints: SearchConstraints;
  products: SearchResultItem[];
  wasRelaxed?: boolean;
  datasetContext?: DatasetContext | null;
  ontology?: CatalogOntology;
  requestedCategoryExists?: boolean;
}): Promise<string> {
  if (env.llmProvider === 'mock') {
    return params.baseReply;
  }

  try {
    const brandContext = await getBrandVoiceContext();
    
    // Create general summary instead of specific product titles
    const categories = new Set<string>();
    const styles = new Set<string>();
    const priceRange = { min: Infinity, max: 0 };
    
    params.products.slice(0, 5).forEach((p) => {
      if (p.category) categories.add(p.category);
      const attrs = p.attributes ?? {};
      if (attrs.fit) styles.add(String(attrs.fit));
      if (p.priceCents < priceRange.min) priceRange.min = p.priceCents;
      if (p.priceCents > priceRange.max) priceRange.max = p.priceCents;
    });
    
    const categoryList = Array.from(categories).slice(0, 3).join(', ') || 'various categories';
    const styleList = Array.from(styles).slice(0, 3).join(', ') || 'various styles';
    const priceInfo = priceRange.min !== Infinity && priceRange.max > 0
      ? `Price range: ${formatMoney(priceRange.min, 'USD')} - ${formatMoney(priceRange.max, 'USD')}`
      : '';
    
    const generalSummary = `Found ${params.products.length} items in ${categoryList}. Styles include ${styleList}.${priceInfo ? ` ${priceInfo}.` : ''}`;

    const requestedCategory = params.constraints.category
      ? (Array.isArray(params.constraints.category) ? params.constraints.category : [params.constraints.category])
      : null;
    const availableCategories = params.ontology
      ? [...params.ontology.categories, ...params.ontology.productTypes]
      : undefined;
    const basePrompt = buildFinalResponsePrompt(
      params.datasetContext,
      params.requestedCategoryExists,
      requestedCategory,
      availableCategories,
    );
    const systemPrompt = brandContext ? `${basePrompt}\n\n${brandContext}` : basePrompt;

    // If the requested category doesn't exist, add a note to the prompt
    let categoryNote = '';
    if (params.requestedCategoryExists === false && params.constraints.category) {
      const requestedCategory = Array.isArray(params.constraints.category)
        ? params.constraints.category.join(', ')
        : params.constraints.category;
      const availableCategories = params.ontology
        ? [...params.ontology.categories, ...params.ontology.productTypes].slice(0, 10).join(', ')
        : 'other products';
      
      categoryNote = `\n\nCRITICAL: The user asked for "${requestedCategory}", but this category does NOT exist in the catalog. The products shown are from different categories (${categoryList}). You MUST acknowledge this in a witty, friendly way. Be honest that we don't have ${requestedCategory}, but show enthusiasm about what we do have. Do NOT pretend we have ${requestedCategory}, and do NOT imply these products protect or replace ${requestedCategory}. Mention what categories are actually available (${availableCategories}).`;
    }

    const relaxedNote = params.wasRelaxed
      ? '\n\nNote: These are the closest matches available, as no products matched all the requested attributes exactly.'
      : '';

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content: systemPrompt + categoryNote,
      },
      {
        role: 'user',
        content: `User query: "${params.userMessage}"\n\nConstraints applied: ${JSON.stringify(params.constraints)}${relaxedNote}\n\nGeneral summary: ${generalSummary}\n\nWrite a natural replyText.`,
      },
    ];

    const result = await callLLM({
      messages,
      purpose: 'final_reply',
      expectJson: false,
    });

    return result.rawText.trim();
  } catch (error) {
    logger.error('llm_reply_enhancement_failed', {
      error: error instanceof Error ? error.message : String(error),
      provider: env.llmProvider,
    });
    return params.baseReply;
  }
}

