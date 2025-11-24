import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callContextGatekeeper } from '../src/lib/llm/orchestrator/intent';
import type { SearchConstraints } from '../src/lib/search/types';

// Mock the LLM provider
vi.mock('../src/lib/llm/provider', () => ({
  callLLM: vi.fn(),
}));

// Mock config
vi.mock('../src/lib/config', () => ({
  env: {
    llmProvider: 'mock',
  },
}));

describe('callContextGatekeeper - pairing and sticky constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect "white shirts to pair with it" as follow-up', async () => {
    const previousConstraints: SearchConstraints = {
      category: 'coats',
      genders: ['mens'],
      inStockOnly: true,
    };

    const result = await callContextGatekeeper({
      currentMessage: 'white shirts to pair with it',
      previousUserMessages: ['show me coats for men'],
      previousConstraints,
      pageType: 'HOME',
    });

    // In mock mode, pairing patterns should be detected
    expect(result.threadType).toBe('follow_up');
    expect(result.shouldUsePreviousContext).toBe(true);
    // Reason should mention pairing or follow-up
    expect(result.reasonBrief).toMatch(/pairing|follow.up/i);
  });

  it('should carry sticky gender even on new_search', async () => {
    const previousConstraints: SearchConstraints = {
      category: 'coats',
      genders: ['mens'],
      inStockOnly: true,
    };

    const result = await callContextGatekeeper({
      currentMessage: 'find me white shirts',
      previousUserMessages: ['show me coats for men'],
      previousConstraints,
      pageType: 'HOME',
    });

    // Should be new_search but with sticky carry (if no explicit gender override)
    expect(result.threadType).toBe('new_search');
    // In mock mode, sticky carry should work if no explicit override
    const hasExplicitGender = /women|womens|female|men|mens|male/i.test('find me white shirts');
    if (!hasExplicitGender) {
      expect(result.shouldUsePreviousContext).toBe(true);
      expect(result.reasonBrief).toMatch(/sticky/i);
    }
  });

  it('should not carry sticky gender if explicit override', async () => {
    const previousConstraints: SearchConstraints = {
      category: 'coats',
      genders: ['mens'],
      inStockOnly: true,
    };

    const result = await callContextGatekeeper({
      currentMessage: 'find me white shirts for women',
      previousUserMessages: ['show me coats for men'],
      previousConstraints,
      pageType: 'HOME',
    });

    // Should be new_search without sticky carry (explicit override)
    expect(result.threadType).toBe('new_search');
    // Should not carry because explicit gender override
    expect(result.shouldUsePreviousContext).toBe(false);
  });

  it('should detect "pair with that" as follow-up', async () => {
    const previousConstraints: SearchConstraints = {
      category: 'blazers',
      genders: ['mens'],
      inStockOnly: true,
    };

    const result = await callContextGatekeeper({
      currentMessage: 'pants to pair with that',
      previousUserMessages: ['show me blazers'],
      previousConstraints,
      pageType: 'HOME',
    });

    expect(result.threadType).toBe('follow_up');
    expect(result.shouldUsePreviousContext).toBe(true);
    expect(result.reasonBrief).toMatch(/pairing|follow.up/i);
  });

  it('should detect "go with it" as follow-up', async () => {
    const previousConstraints: SearchConstraints = {
      category: 'shirts',
      genders: ['mens'],
      inStockOnly: true,
    };

    const result = await callContextGatekeeper({
      currentMessage: 'shoes to go with it',
      previousUserMessages: ['show me shirts'],
      previousConstraints,
      pageType: 'HOME',
    });

    expect(result.threadType).toBe('follow_up');
    expect(result.shouldUsePreviousContext).toBe(true);
    expect(result.reasonBrief).toMatch(/pairing|follow.up/i);
  });
});

