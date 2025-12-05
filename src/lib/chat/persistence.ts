import type { PendingSuggestionResult, ProductCard, ConversationContext } from '@/lib/llm/orchestrator';

export type StoredChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  productCards?: ProductCard[];
  followupText?: string;
  noExactMatch?: boolean;
  ts: number;
};

export type StoredSessionData = {
  sessionId: string;
  conversationContext: ConversationContext;
  timestamp: number;
};

const safeJsonParse = (value: string | null): StoredChatMessage[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as StoredChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) => entry && typeof entry.role === 'string' && typeof entry.text === 'string',
    );
  } catch {
    return [];
  }
};

export const loadChatHistory = (storageKey: string): StoredChatMessage[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    return safeJsonParse(raw);
  } catch {
    return [];
  }
};

export const saveChatHistory = (storageKey: string, messages: StoredChatMessage[]) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(messages));
  } catch {
    // Ignore write errors (quota/private mode)
  }
};

export const clearChatHistory = (storageKey: string) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore removal errors
  }
};

const pendingKeyFor = (storageKey: string) => `${storageKey}__pending`;

export const loadPendingSuggestionCache = (storageKey: string): PendingSuggestionResult | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(pendingKeyFor(storageKey));
    return raw ? (JSON.parse(raw) as PendingSuggestionResult) : null;
  } catch {
    return null;
  }
};

export const savePendingSuggestionCache = (
  storageKey: string,
  pending: PendingSuggestionResult | null,
) => {
  if (typeof window === 'undefined') return;
  try {
    if (!pending) {
      window.localStorage.removeItem(pendingKeyFor(storageKey));
      return;
    }
    window.localStorage.setItem(pendingKeyFor(storageKey), JSON.stringify(pending));
  } catch {
    // Ignore write errors
  }
};

export const clearPendingSuggestionCache = (storageKey: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(pendingKeyFor(storageKey));
  } catch {
    // Ignore removal errors
  }
};

const sessionKeyFor = (storageKey: string) => `${storageKey}__session`;

export const loadSessionData = (storageKey: string): StoredSessionData | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sessionKeyFor(storageKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSessionData;
    // Validate structure
    if (parsed && typeof parsed.sessionId === 'string' && parsed.conversationContext) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

export const saveSessionData = (storageKey: string, sessionData: StoredSessionData) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(sessionKeyFor(storageKey), JSON.stringify({
      ...sessionData,
      timestamp: Date.now(),
    }));
  } catch {
    // Ignore write errors (quota/private mode)
  }
};

export const clearSessionData = (storageKey: string) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(sessionKeyFor(storageKey));
  } catch {
    // Ignore removal errors
  }
};

