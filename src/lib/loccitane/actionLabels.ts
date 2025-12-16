/**
 * ActionLabelService
 * 
 * Generates labels for action proposals.
 * Uses merchant config (uiCopy) if available, otherwise generates via LLM micro-copy.
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import { callLLM } from '../llm/provider';
import type { ActionType, ActionSpec } from './actions';

type UiCopyConfig = {
  actions?: {
    [key in ActionType]?: string; // Label template or literal label
  };
};

const ACTION_LABEL_PROMPT = `Generate a short, concise label (max 3 words) for a shopping assistant action button.

Action types and example labels:
- show_more: "Show more" or "Load more"
- refine_price: "Filter price" or "Adjust price"
- refine_ingredient: "Change ingredients"
- refine_concern: "Different concerns"
- refine_product_type: "Other types"
- compare: "Compare"
- switch_category: "Browse categories"
- ask_preferences: "Tell preferences" or "Your preferences"

Requirements:
- Maximum 3 words
- Action-oriented and clear
- Natural and conversational
- Suitable for button/chip UI

Return ONLY a single string label, no JSON, no arrays, no explanation. Just the label text.`;

/**
 * Get action label from merchant config or generate via LLM
 */
export async function getActionLabel(
  merchantId: string | undefined,
  actionSpec: ActionSpec
): Promise<string> {
  // Try merchant config first
  if (merchantId) {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { datasetContext: true, uiCopy: true },
      });

      // Check for uiCopy in the new uiCopy field first, then fall back to datasetContext
      const uiCopyFromField = (merchant?.uiCopy as unknown as UiCopyConfig | undefined)?.actions?.[actionSpec.type];
      const uiCopyFromContext = (merchant?.datasetContext as unknown as UiCopyConfig | undefined)?.actions?.[actionSpec.type];
      const uiCopy = uiCopyFromField || uiCopyFromContext;
      
      if (uiCopy) {
        // Ensure uiCopy is a string, not an object or array
        let label: string;
        if (typeof uiCopy === 'string') {
          label = uiCopy;
        } else if (typeof uiCopy === 'object' && uiCopy !== null) {
          // Handle case where config might be {"labels": [...]}
          if ('labels' in uiCopy && Array.isArray((uiCopy as any).labels) && (uiCopy as any).labels.length > 0) {
            label = String((uiCopy as any).labels[0]);
          } else {
            // Fallback: stringify and clean up
            label = JSON.stringify(uiCopy).replace(/[{}[\]]/g, '').replace(/"/g, '').trim();
          }
        } else {
          label = String(uiCopy);
        }
        
        logger.debug('ActionLabelService: using merchant config label', {
          merchantId,
          actionType: actionSpec.type,
          label,
        });
        return label.trim();
      }
    } catch (error) {
      logger.warn('ActionLabelService: failed to load merchant config', {
        merchantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Generate via LLM micro-copy
  try {
    const result = await callLLM({
      messages: [
        {
          role: 'system',
          content: ACTION_LABEL_PROMPT,
        },
        {
          role: 'user',
          content: `Generate a label for action type: ${actionSpec.type}`,
        },
      ],
      purpose: 'intent', // Use lightweight model
      expectJson: false, // We want plain text, not JSON
      maxTokens: 20, // Very short responses (just a label)
    });

    const cleaned = result.rawText.trim();
    
    // Try to parse as JSON (in case LLM returns JSON despite prompt)
    try {
      const parsed = JSON.parse(cleaned);
      // Handle different JSON formats
      if (typeof parsed === 'string') {
        return parsed.trim();
      } else if (Array.isArray(parsed) && parsed.length > 0) {
        return String(parsed[0]).trim();
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Handle {"labels": [...]} format
        if ('labels' in parsed && Array.isArray(parsed.labels) && parsed.labels.length > 0) {
          return String(parsed.labels[0]).trim();
        } else if ('label' in parsed && typeof parsed.label === 'string') {
          return parsed.label.trim();
        }
      }
    } catch {
      // Not JSON, use as-is
    }
    
    // Clean up the text: remove quotes, brackets, and JSON artifacts
    const cleanedLabel = cleaned
      .replace(/^["'`]/g, '') // Remove leading quotes
      .replace(/["'`]$/g, '') // Remove trailing quotes
      .replace(/^\[/, '') // Remove leading bracket
      .replace(/\]$/, '') // Remove trailing bracket
      .replace(/\{[^}]*"labels"\s*:\s*\[([^\]]+)\][^}]*\}/, '$1') // Extract from {"labels": [...]}
      .replace(/["'`]/g, '') // Remove all quotes
      .replace(/^\[|\]$/g, '') // Remove any remaining brackets
      .trim();
    
    // If we still have something that looks like JSON, try one more parse
    if (cleanedLabel.includes('[') || cleanedLabel.includes('{')) {
      try {
        const reparsed = JSON.parse(cleanedLabel);
        if (Array.isArray(reparsed) && reparsed.length > 0) {
          return String(reparsed[0]).trim();
        }
        if (typeof reparsed === 'string') {
          return reparsed.trim();
        }
      } catch {
        // Give up and return cleaned version
      }
    }
    
    return cleanedLabel || getDefaultActionLabel(actionSpec.type);
  } catch (error) {
    logger.error('ActionLabelService: LLM generation failed', {
      actionType: actionSpec.type,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback to default labels
    return getDefaultActionLabel(actionSpec.type);
  }
}

/**
 * Get default label for action type (fallback)
 */
function getDefaultActionLabel(actionType: ActionType): string {
  const defaults: Record<ActionType, string> = {
    show_more: 'Show more',
    refine_price: 'Filter by price',
    refine_ingredient: 'Change ingredients',
    refine_concern: 'Different concerns',
    refine_product_type: 'Other types',
    compare: 'Compare',
    switch_category: 'Browse categories',
    ask_preferences: 'Tell preferences',
  };

  return defaults[actionType] || 'More options';
}

/**
 * Generate labels for multiple action specs in parallel
 */
export async function getActionLabels(
  merchantId: string | undefined,
  actionSpecs: ActionSpec[]
): Promise<Map<string, string>> {
  const labelMap = new Map<string, string>();

  // Generate labels in parallel
  const labelPromises = actionSpecs.map(async (spec) => {
    const label = await getActionLabel(merchantId, spec);
    return { type: spec.type, label };
  });

  const labels = await Promise.all(labelPromises);
  labels.forEach(({ type, label }) => {
    labelMap.set(type, label);
  });

  return labelMap;
}

