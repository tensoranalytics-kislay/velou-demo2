/**
 * Dialogue Router
 * 
 * Determines dialogue actions (e.g., "show more", "refine search").
 */

import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';

export type DialogueRouteResult = {
  action?: {
    type: string;
    label: string;
  };
  route?: string;
};

/**
 * Route dialogue turn to determine next action
 */
export async function routeTurn(
  message: string,
  lastConstraints?: SearchConstraints | null,
  lastShownProductIds?: string[]
): Promise<DialogueRouteResult> {
  // Simple routing logic - can be enhanced with LLM if needed
  const messageLower = message.toLowerCase();

  // Check for "show more" patterns
  if (
    messageLower.includes('show more') ||
    messageLower.includes('more options') ||
    messageLower.includes('more products') ||
    messageLower.includes('next') ||
    messageLower.includes('more')
  ) {
    return {
      action: {
        type: 'show_more',
        label: 'Show more products',
      },
      route: 'SHOW_MORE',
    };
  }

  // Check for refinement patterns
  if (
    messageLower.includes('make it') ||
    messageLower.includes('change to') ||
    messageLower.includes('instead') ||
    messageLower.includes('more') ||
    messageLower.includes('less')
  ) {
    return {
      route: 'REFINE',
    };
  }

  // Default: new search or follow-up
  return {
    route: lastConstraints ? 'FOLLOWUP' : 'DISCOVERY',
  };
}
