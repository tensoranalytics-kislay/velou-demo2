/**
 * LLM-First Turn Router
 * 
 * Routes user turns using context-aware LLM classification without keyword enumeration.
 * Uses gpt-4.1-mini with strict JSON schema for fast, deterministic routing.
 */

import { logger } from '../telemetry/logger';
import { callLLM } from '../llm/provider';
import { stripJsonFences } from '../llm/orchestrator/utils';
import { ROUTER_PROMPT_LITE, ROUTER_JSON_SCHEMA } from './prompts';
import type { TurnRouterInput, TurnRouterResult } from './router';
import { buildTurnContext } from './router';

// Simple in-memory cache for router results (keyed by message hash + state timestamp)
const routerCache = new Map<string, { result: TurnRouterResult; timestamp: number }>();
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Generate cache key from input
 */
function getCacheKey(input: TurnRouterInput, stateUpdatedAt?: number): string {
  const messageHash = input.message.trim().toLowerCase().substring(0, 100);
  const stateKey = `${input.state.pendingActions.length}-${input.state.shownProductIds.length}-${stateUpdatedAt || 0}`;
  return `${messageHash}:${stateKey}`;
}

/**
 * LLM-First Turn Router (no keyword enumeration)
 * 
 * Routes user turns using context-aware LLM classification.
 * Uses conversation state (pendingActions, memory, shown products) to make routing decisions.
 */
export async function routeTurnLLMFirst(
  input: TurnRouterInput,
  stateUpdatedAt?: number
): Promise<TurnRouterResult> {
  // Check cache first
  const cacheKey = getCacheKey(input, stateUpdatedAt);
  const cached = routerCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.debug('turnRouter: cache hit', { cacheKey: cacheKey.substring(0, 50) });
    return cached.result;
  }

  // Build compact context
  const contextJson = buildTurnContext(input);

  // Build prompt with context
  const userContent = `Context: ${contextJson}\n\nUser message: "${input.message}"\n\nRoute this turn using the decision rules.`;

  try {
    const result = await callLLM({
      messages: [
        { role: 'system', content: ROUTER_PROMPT_LITE },
        { role: 'user', content: userContent },
      ],
      purpose: 'intent', // Uses lightweight model (gpt-4.1-mini) with default temperature (0.1) for deterministic routing
      expectJson: true,
      schema: ROUTER_JSON_SCHEMA,
      maxTokens: 220, // Small token budget for router
    });

    const cleaned = stripJsonFences(result.rawText);
    const parsed = JSON.parse(cleaned) as TurnRouterResult;

    // Validate route
    const validRoutes: TurnRouterResult['route'][] = [
      'ACTION',
      'YES_NO',
      'REFINE',
      'DISCOVERY',
      'PDP_QA',
      'BRAND_INFO',
      'UNRELATED',
      'SAFETY_BLOCK',
      'AMBIGUOUS',
    ];

    if (!validRoutes.includes(parsed.route)) {
      logger.warn('turnRouter: invalid route from LLM', {
        route: parsed.route,
        message: input.message.substring(0, 100),
      });
      parsed.route = 'DISCOVERY'; // Safe fallback
      parsed.confidence = 0.5;
    }

    // Validate confidence is in range
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      parsed.confidence = 0.7;
    }

    // Cache result
    routerCache.set(cacheKey, { result: parsed, timestamp: Date.now() });

    // Clean old cache entries (keep last 100)
    if (routerCache.size > 100) {
      const entries = Array.from(routerCache.entries());
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      routerCache.clear();
      entries.slice(0, 100).forEach(([key, value]) => routerCache.set(key, value));
    }

    logger.debug('turnRouter: LLM routing complete', {
      route: parsed.route,
      confidence: parsed.confidence,
      message: input.message.substring(0, 100),
    });

    return parsed;
  } catch (error) {
    logger.error('turnRouter: LLM routing failed', {
      error: error instanceof Error ? error.message : String(error),
      message: input.message.substring(0, 100),
    });

    // Safe fallback: assume discovery
    const fallback: TurnRouterResult = {
      route: 'DISCOVERY',
      confidence: 0.3,
      action: null,
      yesNo: null,
      refinePatch: null,
      clarification: null,
    };

    return fallback;
  }
}

