'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConversationContext,
  PendingSuggestionResult,
  ProductCard,
} from '@/lib/llm/orchestrator';
import type { SearchConstraints } from '@/lib/search/types';
import MessageInput from './MessageInput';
import MessageList, { type ChatMessage } from './MessageList';
import SuggestedPrompts from './SuggestedPrompts';
import {
  clearChatHistory,
  clearPendingSuggestionCache,
  loadChatHistory,
  loadPendingSuggestionCache,
  saveChatHistory,
  savePendingSuggestionCache,
  type StoredChatMessage,
} from '@/lib/chat/persistence';

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const STORAGE_KEY = 'velou_chat_v1_default';

const defaultInitialMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hey there—I'm the Lucky Brand stylist. Tell me the vibe, fabric, or budget you're shopping for and I'll pull pieces straight from our catalog.",
  productCards: [],
};

type AssistantApiResponse = {
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  pendingSuggestion?: PendingSuggestionResult | null;
  intent?: 'discovery' | 'pdp_suitability';
  resolvedConstraints?: SearchConstraints;
  usedFollowUpContext?: boolean;
};

export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([defaultInitialMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [pageType, setPageType] = useState<'HOME' | 'PLP' | 'PDP'>('HOME');
  const [productContextId, setProductContextId] = useState<string | undefined>();
  const [pendingSuggestion, setPendingSuggestion] = useState<PendingSuggestionResult | null>(null);
  const [conversationContext, setConversationContext] = useState<ConversationContext>({
    lastIntent: null,
    lastConstraints: null,
    lastShownProductIds: [],
    lastUserQuery: null,
  });
  const [hasHydrated, setHasHydrated] = useState(false);
  const sessionId = useMemo(() => createId(), []);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = loadChatHistory(STORAGE_KEY);
    if (stored.length) {
      setMessages(
        stored.map((entry, index) => ({
          id: `stored-${entry.ts ?? index}-${index}`,
          role: entry.role,
          content: entry.text,
          productCards: entry.productCards,
        })),
      );
    }
    const storedPending = loadPendingSuggestionCache(STORAGE_KEY);
    if (storedPending) {
      setPendingSuggestion(storedPending);
    }
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      const timestampBase = Date.now();
      const serializable: StoredChatMessage[] = messages.map((message, index) => ({
        role: message.role,
        text: message.content,
        productCards: message.productCards,
        ts: timestampBase + index,
      }));
      saveChatHistory(STORAGE_KEY, serializable);
    }, 300);

    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
    };
  }, [messages, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated) return;
    savePendingSuggestionCache(STORAGE_KEY, pendingSuggestion);
  }, [pendingSuggestion, hasHydrated]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isLoading]);

  const resetConversation = () => {
    setMessages([defaultInitialMessage]);
    setPageType('HOME');
    setProductContextId(undefined);
    setPendingSuggestion(null);
    setConversationContext({
      lastIntent: null,
      lastConstraints: null,
      lastShownProductIds: [],
      lastUserQuery: null,
    });
  };

  const handleClearChat = () => {
    const shouldClear = window.confirm('Clear chat history?');
    if (!shouldClear) return;
    resetConversation();
    clearChatHistory(STORAGE_KEY);
    clearPendingSuggestionCache(STORAGE_KEY);
  };

  const handleProductClick = async (productId: string) => {
    await fetch('/api/metrics/product-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, productId }),
    });
  };

  const handleSendMessage = async (message: string) => {
    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: message,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const latestMessages = [...messages, userMessage];
      const historyPayload = latestMessages.slice(-5).map((entry) => ({
        role: entry.role,
        content: entry.content,
      }));
      const pendingPayload = pendingSuggestion
        ? {
            constraints: pendingSuggestion.constraints,
            candidateIds: pendingSuggestion.candidateIds,
          }
        : undefined;
      const contextPayload =
        conversationContext.lastIntent ||
        conversationContext.lastConstraints ||
        conversationContext.lastShownProductIds?.length ||
        conversationContext.lastUserQuery
          ? conversationContext
          : undefined;

      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pageType,
          productContextId,
          message,
          history: historyPayload,
          pendingSuggestion: pendingPayload,
          conversationContext: contextPayload,
        }),
      });

      const data = (await response.json()) as AssistantApiResponse;
      setPendingSuggestion(data.pendingSuggestion ?? null);
      // Show cards whenever productCards.length > 0, even if noExactMatch=true
      // Only hide cards if there are no cards OR if there's a pending suggestion (user needs to confirm)
      const shouldShowCards = data.productCards.length > 0 && !data.pendingSuggestion;
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: data.replyText,
        productCards: shouldShowCards ? data.productCards : [],
        noExactMatch: data.noExactMatch, // Pass through for UI to show "Relaxed results" banner
      };

      setMessages((prev) => [...prev, assistantMessage]);

      setConversationContext({
        lastIntent: data.intent ?? conversationContext.lastIntent ?? null,
        lastConstraints: data.resolvedConstraints ?? conversationContext.lastConstraints ?? null,
        lastShownProductIds: shouldShowCards ? data.productCards.map((card) => card.id) : [],
        lastUserQuery: message,
      });
    } catch {
      const fallbackMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content:
          'Our assistant is temporarily unavailable. Please try again soon or browse with the standard filters.',
      };
      setMessages((prev) => [...prev, fallbackMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const isEmpty = messages.length === 1 && messages[0].role === 'assistant';

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-x-hidden">
      {/* Clear chat button - positioned absolutely in top right */}
      <button
        type="button"
        onClick={handleClearChat}
        className="absolute top-2 right-2 sm:top-4 sm:right-4 z-50 rounded-full border border-rose-100 bg-white px-2 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-semibold text-rose-500 shadow-sm transition hover:border-rose-200 hover:bg-rose-50"
      >
        Clear chat
      </button>
      {/* Scrollable chat area - extends to bottom */}
      <div
        ref={scrollContainerRef}
        className="chat-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pt-3 pb-[180px] sm:px-4 sm:pt-4 sm:pb-[200px] md:px-6 md:pt-6 md:pb-[220px]"
      >
        <MessageList messages={messages} onProductClick={handleProductClick} />
        {isLoading && (
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <div className="flex gap-1 text-rose-500">
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-500 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-rose-300" />
            </div>
            <span>The Lucky Brand stylist is thinking…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      {/* Fixed suggestions above input - overlays at bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-b from-transparent via-white to-white px-3 pt-3 pb-3 sm:px-4 sm:pt-4 sm:pb-4 md:px-6 md:pb-6">
        <SuggestedPrompts
          onSelect={(prompt) => {
            handleSendMessage(prompt);
          }}
          lastUserMessage={
            messages.length > 0
              ? messages
                  .filter((m) => m.role === 'user')
                  .slice(-1)[0]?.content || null
              : null
          }
        />
        <div className="mt-3">
          <MessageInput onSend={handleSendMessage} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}

