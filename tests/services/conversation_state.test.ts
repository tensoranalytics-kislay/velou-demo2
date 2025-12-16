/**
 * Tests for ConversationStateService
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getState,
  updateState,
  appendShownProducts,
  setPendingActions,
  clearPendingActions,
  updateMemory,
  setLastRankedProducts,
  advanceRankCursor,
  type PendingAction,
} from '../../src/lib/chat/ConversationStateService';
import { prisma } from '../../src/lib/db';
import type { Prisma } from '@prisma/client';

describe('ConversationStateService', () => {
  const testMerchantId = 'test-merchant-123';
  const testSessionId = 'test-session-456';

  beforeEach(async () => {
    // Clean up test data
    await prisma.conversationState.deleteMany({
      where: {
        merchantId: testMerchantId,
        sessionId: testSessionId,
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.conversationState.deleteMany({
      where: {
        merchantId: testMerchantId,
        sessionId: testSessionId,
      },
    });
  });

  describe('getState', () => {
    it('should return default state when not found', async () => {
      const state = await getState(testMerchantId, testSessionId);

      expect(state.shownProductIds).toEqual([]);
      expect(state.lastQueryFingerprint).toBeNull();
      expect(state.lastRankedProductIds).toEqual([]);
      expect(state.lastRankCursor).toBe(0);
      expect(state.pendingActions).toEqual([]);
      expect(state.memory).toEqual({});
    });

    it('should return existing state when found', async () => {
      // Create state first
      await prisma.conversationState.create({
        data: {
          merchantId: testMerchantId,
          sessionId: testSessionId,
          shownProductIds: ['prod-1', 'prod-2'],
          lastRankedProductIds: ['prod-1', 'prod-2', 'prod-3'],
          lastRankCursor: 2,
          pendingActions: [{ id: 'action-1', type: 'confirm', label: 'Confirm purchase' }] as unknown as Prisma.JsonValue,
          memory: { concerns: ['dryness'] } as unknown as Prisma.JsonValue,
        },
      });

      const state = await getState(testMerchantId, testSessionId);

      expect(state.shownProductIds).toEqual(['prod-1', 'prod-2']);
      expect(state.lastRankedProductIds).toEqual(['prod-1', 'prod-2', 'prod-3']);
      expect(state.lastRankCursor).toBe(2);
      expect(state.pendingActions).toHaveLength(1);
      expect(state.pendingActions[0].id).toBe('action-1');
      expect(state.memory.concerns).toEqual(['dryness']);
    });
  });

  describe('updateState', () => {
    it('should create new state when not exists', async () => {
      const state = await updateState(testMerchantId, testSessionId, {
        shownProductIds: ['prod-1'],
        lastRankCursor: 4,
      });

      expect(state.shownProductIds).toEqual(['prod-1']);
      expect(state.lastRankCursor).toBe(4);

      // Verify in DB
      const dbState = await prisma.conversationState.findUnique({
        where: {
          merchantId_sessionId: {
            merchantId: testMerchantId,
            sessionId: testSessionId,
          },
        },
      });
      expect(dbState).toBeTruthy();
      expect(dbState?.shownProductIds).toEqual(['prod-1']);
    });

    it('should update existing state', async () => {
      // Create initial state
      await updateState(testMerchantId, testSessionId, {
        shownProductIds: ['prod-1'],
        lastRankCursor: 2,
      });

      // Update it
      const updated = await updateState(testMerchantId, testSessionId, {
        shownProductIds: ['prod-1', 'prod-2'],
        lastRankCursor: 4,
      });

      expect(updated.shownProductIds).toEqual(['prod-1', 'prod-2']);
      expect(updated.lastRankCursor).toBe(4);
    });

    it('should handle partial updates', async () => {
      await updateState(testMerchantId, testSessionId, {
        shownProductIds: ['prod-1'],
        lastRankCursor: 2,
        memory: { concerns: ['dryness'] },
      });

      const updated = await updateState(testMerchantId, testSessionId, {
        lastRankCursor: 4,
      });

      expect(updated.shownProductIds).toEqual(['prod-1']); // Unchanged
      expect(updated.lastRankCursor).toBe(4); // Updated
      expect(updated.memory.concerns).toEqual(['dryness']); // Unchanged
    });
  });

  describe('appendShownProducts', () => {
    it('should append new product IDs', async () => {
      await updateState(testMerchantId, testSessionId, {
        shownProductIds: ['prod-1'],
      });

      const updated = await appendShownProducts(testMerchantId, testSessionId, ['prod-2', 'prod-3']);

      expect(updated).toEqual(['prod-1', 'prod-2', 'prod-3']);
    });

    it('should de-duplicate product IDs', async () => {
      await updateState(testMerchantId, testSessionId, {
        shownProductIds: ['prod-1', 'prod-2'],
      });

      const updated = await appendShownProducts(testMerchantId, testSessionId, ['prod-2', 'prod-3']);

      expect(updated).toEqual(['prod-1', 'prod-2', 'prod-3']);
    });

    it('should handle empty array', async () => {
      await updateState(testMerchantId, testSessionId, {
        shownProductIds: ['prod-1'],
      });

      const updated = await appendShownProducts(testMerchantId, testSessionId, []);

      expect(updated).toEqual(['prod-1']);
    });

    it('should work with empty initial state', async () => {
      const updated = await appendShownProducts(testMerchantId, testSessionId, ['prod-1', 'prod-2']);

      expect(updated).toEqual(['prod-1', 'prod-2']);
    });
  });

  describe('setPendingActions', () => {
    it('should set pending actions', async () => {
      const actions: PendingAction[] = [
        { id: 'action-1', type: 'confirm', label: 'Confirm purchase' },
        { id: 'action-2', type: 'cancel', label: 'Cancel order' },
      ];

      await setPendingActions(testMerchantId, testSessionId, actions);

      const state = await getState(testMerchantId, testSessionId);
      expect(state.pendingActions).toHaveLength(2);
      expect(state.pendingActions[0].id).toBe('action-1');
      expect(state.pendingActions[1].id).toBe('action-2');
    });

    it('should replace existing actions', async () => {
      await setPendingActions(testMerchantId, testSessionId, [
        { id: 'action-1', type: 'confirm', label: 'Confirm' },
      ]);

      await setPendingActions(testMerchantId, testSessionId, [
        { id: 'action-2', type: 'cancel', label: 'Cancel' },
      ]);

      const state = await getState(testMerchantId, testSessionId);
      expect(state.pendingActions).toHaveLength(1);
      expect(state.pendingActions[0].id).toBe('action-2');
    });

    it('should handle empty array', async () => {
      await setPendingActions(testMerchantId, testSessionId, [
        { id: 'action-1', type: 'confirm', label: 'Confirm' },
      ]);

      await setPendingActions(testMerchantId, testSessionId, []);

      const state = await getState(testMerchantId, testSessionId);
      expect(state.pendingActions).toEqual([]);
    });
  });

  describe('clearPendingActions', () => {
    it('should clear pending actions', async () => {
      await setPendingActions(testMerchantId, testSessionId, [
        { id: 'action-1', type: 'confirm', label: 'Confirm' },
      ]);

      await clearPendingActions(testMerchantId, testSessionId);

      const state = await getState(testMerchantId, testSessionId);
      expect(state.pendingActions).toEqual([]);
    });
  });

  describe('updateMemory', () => {
    it('should update memory', async () => {
      await updateMemory(testMerchantId, testSessionId, {
        concerns: ['dryness'],
        ingredients: ['shea_butter'],
      });

      const state = await getState(testMerchantId, testSessionId);
      expect(state.memory.concerns).toEqual(['dryness']);
      expect(state.memory.ingredients).toEqual(['shea_butter']);
    });

    it('should merge with existing memory', async () => {
      await updateMemory(testMerchantId, testSessionId, {
        concerns: ['dryness'],
      });

      await updateMemory(testMerchantId, testSessionId, {
        ingredients: ['shea_butter'],
      });

      const state = await getState(testMerchantId, testSessionId);
      expect(state.memory.concerns).toEqual(['dryness']);
      expect(state.memory.ingredients).toEqual(['shea_butter']);
    });

    it('should handle price hint', async () => {
      await updateMemory(testMerchantId, testSessionId, {
        priceHint: {
          max: 50,
          min: 10,
        },
      });

      const state = await getState(testMerchantId, testSessionId);
      expect(state.memory.priceHint?.max).toBe(50);
      expect(state.memory.priceHint?.min).toBe(10);
    });
  });

  describe('setLastRankedProducts', () => {
    it('should set last ranked products and reset cursor', async () => {
      await updateState(testMerchantId, testSessionId, {
        lastRankedProductIds: ['old-1'],
        lastRankCursor: 10,
      });

      await setLastRankedProducts(testMerchantId, testSessionId, ['new-1', 'new-2', 'new-3']);

      const state = await getState(testMerchantId, testSessionId);
      expect(state.lastRankedProductIds).toEqual(['new-1', 'new-2', 'new-3']);
      expect(state.lastRankCursor).toBe(0);
    });
  });

  describe('advanceRankCursor', () => {
    it('should advance cursor by default increment', async () => {
      await updateState(testMerchantId, testSessionId, {
        lastRankCursor: 0,
      });

      const newCursor = await advanceRankCursor(testMerchantId, testSessionId);

      expect(newCursor).toBe(4); // Default increment is 4
    });

    it('should advance cursor by custom increment', async () => {
      await updateState(testMerchantId, testSessionId, {
        lastRankCursor: 0,
      });

      const newCursor = await advanceRankCursor(testMerchantId, testSessionId, 6);

      expect(newCursor).toBe(6);
    });

    it('should advance from existing cursor', async () => {
      await updateState(testMerchantId, testSessionId, {
        lastRankCursor: 4,
      });

      const newCursor = await advanceRankCursor(testMerchantId, testSessionId, 4);

      expect(newCursor).toBe(8);
    });
  });

  describe('multi-tenant isolation', () => {
    it('should isolate state by merchantId', async () => {
      const merchant1 = 'merchant-1';
      const merchant2 = 'merchant-2';
      const sessionId = 'shared-session';

      await updateState(merchant1, sessionId, {
        shownProductIds: ['prod-1'],
      });

      await updateState(merchant2, sessionId, {
        shownProductIds: ['prod-2'],
      });

      const state1 = await getState(merchant1, sessionId);
      const state2 = await getState(merchant2, sessionId);

      expect(state1.shownProductIds).toEqual(['prod-1']);
      expect(state2.shownProductIds).toEqual(['prod-2']);

      // Cleanup
      await prisma.conversationState.deleteMany({
        where: { merchantId: merchant1 },
      });
      await prisma.conversationState.deleteMany({
        where: { merchantId: merchant2 },
      });
    });
  });
});

