/**
 * ConversationStateService
 * 
 * Manages persistent conversation state per (merchantId, sessionId).
 * Supports:
 * - Remembering shown product IDs (avoid duplicates)
 * - Remembering last ranked list + cursor for "show more"
 * - Remembering pending follow-up actions (so yes/no works)
 * - Remembering lightweight "preferences memory" (concerns, ingredients, price intent)
 */

import { prisma } from '../db';
import { logger } from '../telemetry/logger';
import type { SearchConstraints } from '../search/types';
import type { Prisma } from '@prisma/client';

export type PendingAction = {
  id: string;
  type: string;
  label: string;
  payload?: Record<string, unknown>;
};

export type PendingFollowups = {
  originalQuery: string;
  questions: string[];
  responses: string[];
  preliminaryProducts?: Array<{ productId: string; title: string; similarity: number }>;
};

export type ConversationMemory = {
  concerns?: string[];
  ingredients?: string[];
  priceHint?: {
    min?: number;
    max?: number;
  };
  productTypes?: string[];
  lastIntent?: string;
  pendingFollowups?: PendingFollowups;
  lastEnhancedQuery?: string; // Store the last enhanced query from constraint merging for cumulative context
  lastCategories?: string[]; // Store the last categories for intent-aware constraint preservation
  // NEW: Store last classification constraints for age group switch detection
  lastClassificationConstraints?: {
    ageGroups?: string[];
    colors?: string[];
    occasions?: string[];
    seasons?: string[];
    formalityLevel?: string;
    priceMinCents?: number;
    priceMaxCents?: number;
  };
};

export type ConversationStateData = {
  shownProductIds: string[];
  lastQueryFingerprint?: string | null;
  lastRankedProductIds: string[];
  lastRankCursor: number;
  pendingActions: PendingAction[];
  memory: ConversationMemory;
};

/**
 * Get conversation state for a merchant/session
 * Returns default state if not found
 */
export async function getState(
  merchantId: string,
  sessionId: string
): Promise<ConversationStateData> {
  try {
    const state = await prisma.conversationState.findUnique({
      where: {
        merchantId_sessionId: {
          merchantId,
          sessionId,
        },
      },
    });

    if (!state) {
      // Return default state
      return {
        shownProductIds: [],
        lastQueryFingerprint: null,
        lastRankedProductIds: [],
        lastRankCursor: 0,
        pendingActions: [],
        memory: {},
      };
    }

    return {
      shownProductIds: state.shownProductIds || [],
      lastQueryFingerprint: state.lastQueryFingerprint,
      lastRankedProductIds: state.lastRankedProductIds || [],
      lastRankCursor: state.lastRankCursor || 0,
      pendingActions: (state.pendingActions as unknown as PendingAction[]) || [],
      memory: (state.memory as unknown as ConversationMemory) || {},
    };
  } catch (error) {
    logger.error('ConversationStateService.getState failed', {
      merchantId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return default state on error
    return {
      shownProductIds: [],
      lastQueryFingerprint: null,
      lastRankedProductIds: [],
      lastRankCursor: 0,
      pendingActions: [],
      memory: {},
    };
  }
}

/**
 * Update conversation state with a partial patch
 * Uses upsert to create or update
 */
export async function updateState(
  merchantId: string,
  sessionId: string,
  patch: Partial<ConversationStateData>
): Promise<ConversationStateData> {
  try {
    const state = await prisma.conversationState.upsert({
      where: {
        merchantId_sessionId: {
          merchantId,
          sessionId,
        },
      },
      create: {
        merchantId,
        sessionId,
        shownProductIds: patch.shownProductIds || [],
        lastQueryFingerprint: patch.lastQueryFingerprint || null,
        lastRankedProductIds: patch.lastRankedProductIds || [],
        lastRankCursor: patch.lastRankCursor ?? 0,
        pendingActions: (patch.pendingActions || []) as Prisma.InputJsonValue,
        memory: (patch.memory || {}) as Prisma.InputJsonValue,
      },
      update: {
        ...(patch.shownProductIds !== undefined && { shownProductIds: patch.shownProductIds }),
        ...(patch.lastQueryFingerprint !== undefined && { lastQueryFingerprint: patch.lastQueryFingerprint }),
        ...(patch.lastRankedProductIds !== undefined && { lastRankedProductIds: patch.lastRankedProductIds }),
        ...(patch.lastRankCursor !== undefined && { lastRankCursor: patch.lastRankCursor }),
        ...(patch.pendingActions !== undefined && { pendingActions: patch.pendingActions as Prisma.InputJsonValue }),
        ...(patch.memory !== undefined && { memory: patch.memory as Prisma.InputJsonValue }),
        updatedAt: new Date(),
      },
    });

    return {
      shownProductIds: state.shownProductIds || [],
      lastQueryFingerprint: state.lastQueryFingerprint,
      lastRankedProductIds: state.lastRankedProductIds || [],
      lastRankCursor: state.lastRankCursor || 0,
      pendingActions: (state.pendingActions as unknown as PendingAction[]) || [],
      memory: (state.memory as unknown as ConversationMemory) || {},
    };
  } catch (error) {
    logger.error('ConversationStateService.updateState failed', {
      merchantId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Append product IDs to shownProductIds, de-duplicating
 */
export async function appendShownProducts(
  merchantId: string,
  sessionId: string,
  productIds: string[]
): Promise<string[]> {
  try {
    const currentState = await getState(merchantId, sessionId);
    const existingIds = new Set(currentState.shownProductIds);
    const newIds = productIds.filter(id => !existingIds.has(id));
    
    if (newIds.length === 0) {
      // No new IDs to add
      return currentState.shownProductIds;
    }

    const updatedIds = [...currentState.shownProductIds, ...newIds];
    await updateState(merchantId, sessionId, { shownProductIds: updatedIds });
    
    return updatedIds;
  } catch (error) {
    logger.error('ConversationStateService.appendShownProducts failed', {
      merchantId,
      sessionId,
      productIds,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Set pending actions (replaces existing)
 */
export async function setPendingActions(
  merchantId: string,
  sessionId: string,
  actions: PendingAction[]
): Promise<void> {
  try {
    await updateState(merchantId, sessionId, { pendingActions: actions });
  } catch (error) {
    logger.error('ConversationStateService.setPendingActions failed', {
      merchantId,
      sessionId,
      actionCount: actions.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Clear pending actions
 */
export async function clearPendingActions(
  merchantId: string,
  sessionId: string
): Promise<void> {
  await setPendingActions(merchantId, sessionId, []);
}

/**
 * Update memory with new preferences/intent
 */
export async function updateMemory(
  merchantId: string,
  sessionId: string,
  memoryUpdate: Partial<ConversationMemory>
): Promise<ConversationMemory> {
  try {
    const currentState = await getState(merchantId, sessionId);
    const updatedMemory: ConversationMemory = {
      ...currentState.memory,
      ...memoryUpdate,
    };
    
    await updateState(merchantId, sessionId, { memory: updatedMemory });
    return updatedMemory;
  } catch (error) {
    logger.error('ConversationStateService.updateMemory failed', {
      merchantId,
      sessionId,
      memoryUpdate,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Set last ranked products and reset cursor
 */
export async function setLastRankedProducts(
  merchantId: string,
  sessionId: string,
  productIds: string[]
): Promise<void> {
  try {
    await updateState(merchantId, sessionId, {
      lastRankedProductIds: productIds,
      lastRankCursor: 0,
    });
  } catch (error) {
    logger.error('ConversationStateService.setLastRankedProducts failed', {
      merchantId,
      sessionId,
      productCount: productIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Advance cursor for "show more" pagination
 */
export async function advanceRankCursor(
  merchantId: string,
  sessionId: string,
  increment: number = 4
): Promise<number> {
  try {
    const currentState = await getState(merchantId, sessionId);
    const newCursor = currentState.lastRankCursor + increment;
    await updateState(merchantId, sessionId, { lastRankCursor: newCursor });
    return newCursor;
  } catch (error) {
    logger.error('ConversationStateService.advanceRankCursor failed', {
      merchantId,
      sessionId,
      increment,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

