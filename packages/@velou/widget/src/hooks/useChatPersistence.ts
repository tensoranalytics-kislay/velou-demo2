/**
 * useChatPersistence Hook
 * 
 * React hook for persisting chat messages to localStorage
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, StoredChatMessage } from '../types/message';

export interface UseChatPersistenceResult {
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  isLoading: boolean;
}

export interface UseChatPersistenceConfig {
  merchantId: string;
  storageKey?: string;
  debounceMs?: number;
  maxMessages?: number;
}

/**
 * Hook for persisting chat messages
 * 
 * @param config - Configuration object
 * @returns Hook result with messages and persistence functions
 * 
 * @example
 * ```tsx
 * const { messages, addMessage, clearMessages } = useChatPersistence({
 *   merchantId: 'acme-corp',
 * });
 * ```
 */
export function useChatPersistence(config: UseChatPersistenceConfig): UseChatPersistenceResult {
  const storageKey = config.storageKey || `velou_${config.merchantId}_messages`;
  const debounceMs = config.debounceMs ?? 300;
  const maxMessages = config.maxMessages ?? 1000;

  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === 'undefined') return [];
    
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return [];
      
      const parsed = JSON.parse(stored) as StoredChatMessage[];
      if (!Array.isArray(parsed)) return [];
      
      return parsed
        .filter((entry) => entry && typeof entry.role === 'string' && typeof entry.text === 'string')
        .slice(-maxMessages) // Keep only recent messages
        .map((entry, index) => ({
          id: `stored-${entry.ts ?? index}-${index}`,
          role: entry.role,
          content: entry.text,
          productCards: entry.productCards,
          followupText: entry.followupText,
          noExactMatch: entry.noExactMatch,
        }));
    } catch {
      return [];
    }
  });

  const [isLoading, setIsLoading] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Mark as loaded after initial hydration
  useEffect(() => {
    setIsLoading(false);
  }, []);

  // Save messages to localStorage with debouncing
  const saveMessages = useCallback((msgs: Message[]) => {
    if (typeof window === 'undefined') return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const toStore: StoredChatMessage[] = msgs
          .slice(-maxMessages) // Keep only recent messages
          .map((msg) => ({
            role: msg.role,
            text: msg.content,
            productCards: msg.productCards,
            followupText: msg.followupText,
            noExactMatch: msg.noExactMatch,
            ts: Date.now(),
          }));

        localStorage.setItem(storageKey, JSON.stringify(toStore));
      } catch (error) {
        // Ignore storage errors (quota, private mode, etc.)
        console.warn('[Velou Widget] Failed to save messages:', error);
      }
    }, debounceMs);
  }, [storageKey, debounceMs, maxMessages]);

  // Save whenever messages change
  useEffect(() => {
    if (!isLoading) {
      saveMessages(messages);
    }
  }, [messages, isLoading, saveMessages]);

  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Ignore removal errors
      }
    }
  }, [storageKey]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    messages,
    addMessage,
    clearMessages,
    isLoading,
  };
}


