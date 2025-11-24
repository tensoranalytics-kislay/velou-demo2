import type { PendingSuggestionResult, ProductCard } from '@/lib/llm/orchestrator';

export type StoredChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  productCards?: ProductCard[];
  ts: number;
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

