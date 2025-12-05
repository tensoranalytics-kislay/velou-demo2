'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  ConversationContext,
  PendingSuggestionResult,
  ProductCard,
} from '@/lib/llm/orchestrator';
import type { SearchConstraints } from '@/lib/search/types';
import MessageInput from './MessageInput';
import MessageList, { type ChatMessage } from './MessageList';
import SuggestedPrompts from './SuggestedPrompts';
import QueryProgressBar from './QueryProgressBar';
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

// Fallback initial message (will be replaced by dataset-aware greeting)
const defaultInitialMessage: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hey there—I'm your shopping assistant. Tell me what you're looking for and I'll help you find the perfect products from our catalog.",
  productCards: [],
};

type AssistantApiResponse = {
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  pendingSuggestion?: PendingSuggestionResult | null;
  intent?: 'discovery' | 'pdp_suitability' | 'other';
  resolvedConstraints?: SearchConstraints;
  usedFollowUpContext?: boolean;
   followupText?: string;
};

export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([defaultInitialMessage]);
  const [isLoading, setIsLoading] = useState(false);
  const [pageType, setPageType] = useState<'HOME' | 'PLP' | 'PDP'>('HOME');
  const [productContextId, setProductContextId] = useState<string | undefined>();
  const [productContext, setProductContext] = useState<{ id: string; title: string; imageUrl: string } | undefined>();
  const [pendingSuggestion, setPendingSuggestion] = useState<PendingSuggestionResult | null>(null);
  const [conversationContext, setConversationContext] = useState<ConversationContext>({
    lastIntent: null,
    lastConstraints: null,
    lastShownProductIds: [],
    lastUserQuery: null,
  });
  const [hasHydrated, setHasHydrated] = useState(false);
  const [queryProgress, setQueryProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [queryType, setQueryType] = useState<'discovery' | 'product_qa' | 'non_contextual'>('discovery');
  const sessionId = useMemo(() => createId(), []);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      // Use multiple attempts to ensure we scroll to absolute bottom
      const attemptScroll = () => {
        const container = scrollContainerRef.current;
        const inputContainer = inputContainerRef.current;
        const messagesEnd = messagesEndRef.current;
        
        if (!container) return;
        
        // Measure the actual height of the input container (pills + input box)
        const inputContainerHeight = inputContainer?.offsetHeight ?? 0;
        
        // Calculate scroll position so the last message appears right above the input container
        // We want messagesEnd to be positioned at: container height - input container height
        if (messagesEnd && inputContainer) {
          const containerRect = container.getBoundingClientRect();
          const messagesEndRect = messagesEnd.getBoundingClientRect();
          
          // Calculate the desired position for messagesEnd relative to container top
          const targetMessagesEndTop = containerRect.height - inputContainerHeight - 10; // 10px buffer above input
          
          // Current position of messagesEnd relative to container top (accounting for scroll)
          const currentMessagesEndTop = messagesEndRect.top - containerRect.top + container.scrollTop;
          
          // Calculate how much we need to scroll
          const scrollOffset = currentMessagesEndTop - targetMessagesEndTop;
          const newScrollTop = container.scrollTop + scrollOffset;
          
          container.scrollTo({
            top: Math.max(0, newScrollTop),
            behavior,
          });
        } else {
          // Fallback: scroll to bottom minus input container height
          const maxScroll = container.scrollHeight - container.clientHeight;
          const targetScroll = inputContainerHeight > 0 
            ? Math.max(0, maxScroll - inputContainerHeight + 20)
            : maxScroll;
          
          container.scrollTo({
            top: targetScroll,
            behavior,
          });
        }
      };
      
      // Immediate attempt
      attemptScroll();
      
      // Retry after a short delay to account for DOM updates
      setTimeout(attemptScroll, 50);
      // One more retry for slow renders (e.g., product cards)
      setTimeout(attemptScroll, 200);
    },
    [],
  );

  useEffect(() => {
    // Always fetch fresh greeting to ensure it's dataset-aware
    fetch('/api/chat/greeting')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Greeting API returned ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.greeting) {
          const greetingMessage: ChatMessage = {
            id: 'welcome',
            role: 'assistant',
            content: data.greeting,
            productCards: [],
          };
          
          const stored = loadChatHistory(STORAGE_KEY);
          if (stored.length) {
            // If there's stored history, check if first message is the old greeting and replace it
            const messages: ChatMessage[] = stored.map((entry, index) => ({
              id: `stored-${entry.ts ?? index}-${index}`,
              role: entry.role,
              content: entry.text,
              productCards: entry.productCards || [],
            }));
            
            // Check if first message is an old greeting (contains old greeting patterns)
            const firstMessage = messages[0];
            const oldGreetingPatterns = [
              "Tell me the vibe, fabric, or budget",
            ];
            const isOldGreeting = firstMessage?.role === 'assistant' && 
              (firstMessage.id === 'welcome' ||
               oldGreetingPatterns.some(pattern => firstMessage.content.includes(pattern)));
            
            // Always update the first message if it's a greeting (id === 'welcome' or matches greeting pattern)
            // This ensures the greeting stays fresh and dataset-aware
            if (firstMessage.id === 'welcome' || isOldGreeting || firstMessage.content !== data.greeting) {
              // Replace greeting with new one
              messages[0] = {
                ...greetingMessage,
                productCards: greetingMessage.productCards || [],
              };
              // Also update localStorage to persist the new greeting
              const timestampBase = Date.now();
              const serializable: StoredChatMessage[] = messages.map((message, index) => ({
                role: message.role,
                text: message.content,
                productCards: message.productCards,
                ts: timestampBase + index,
              }));
              saveChatHistory(STORAGE_KEY, serializable);
            }
            
            setMessages(messages);
          } else {
            // No stored history, use the dataset-aware greeting
            setMessages([greetingMessage]);
          }
        }
      })
      .catch((error) => {
        console.error('Failed to load greeting:', error);
        // Fall back to default
        const stored = loadChatHistory(STORAGE_KEY);
        if (stored.length) {
          const messages: ChatMessage[] = stored.map((entry, index) => ({
            id: `stored-${entry.ts ?? index}-${index}`,
            role: entry.role,
            content: entry.text,
            productCards: entry.productCards || [],
          }));
          
          // Still check and replace old greeting even if API failed
          const firstMessage = messages[0];
          const oldGreetingPatterns = [
            "Tell me the vibe, fabric, or budget",
          ];
          const isOldGreeting = firstMessage?.role === 'assistant' && 
            oldGreetingPatterns.some(pattern => firstMessage.content.includes(pattern));
          
          if (isOldGreeting) {
            // Use default generic greeting
            messages[0] = {
              ...defaultInitialMessage,
              productCards: defaultInitialMessage.productCards || [],
            };
            const timestampBase = Date.now();
            const serializable: StoredChatMessage[] = messages.map((message, index) => ({
              role: message.role,
              text: message.content,
              productCards: message.productCards,
              ts: timestampBase + index,
            }));
            saveChatHistory(STORAGE_KEY, serializable);
          }
          
          setMessages(messages);
        } else {
          setMessages([defaultInitialMessage]);
        }
      });
    
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

  // Auto-scroll to bottom when messages change (with delay to ensure DOM update)
  useEffect(() => {
    if (!hasHydrated) return;
    const timeout = setTimeout(() => {
      scrollToBottom('smooth');
    }, 50);
    return () => clearTimeout(timeout);
  }, [messages, isLoading, hasHydrated, scrollToBottom]);

  // If a floating suggestion pill stored an external prompt before the chat opened,
  // pick it up once after hydration and send it as the first user message.
  useEffect(() => {
    if (!hasHydrated) return;
    if (typeof window === 'undefined') return;

    try {
      const external = window.localStorage.getItem('velou_external_prompt');
      if (external && external.trim()) {
        window.localStorage.removeItem('velou_external_prompt');
        void handleSendMessage(external);
      }
    } catch {
      // ignore storage errors
    }
    // run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated]);

  const resetConversation = async () => {
    // Fetch fresh greeting when resetting
    try {
      const response = await fetch('/api/chat/greeting');
      const data = await response.json();
      const greetingMessage: ChatMessage = {
        id: 'welcome',
        role: 'assistant',
        content: data.greeting || defaultInitialMessage.content,
        productCards: [],
      };
      setMessages([greetingMessage]);
    } catch {
      setMessages([defaultInitialMessage]);
    }
    setPageType('HOME');
    setProductContextId(undefined);
    setProductContext(undefined);
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

  const handleProductAsk = async (productId: string, productTitle: string, productImageUrl: string) => {
    // Set product context for this query
    setProductContextId(productId);
    setProductContext({ id: productId, title: productTitle, imageUrl: productImageUrl });
    
    // Don't auto-send - let user ask their own question
    // Just show the product context above input
  };

  const handleSendMessage = async (message: string, overrideProductContextId?: string) => {
    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: message,
    };

    setMessages((prev) => [...prev, userMessage]);
    // Scroll to bottom immediately after user message is added
    setTimeout(() => scrollToBottom('smooth'), 50);
    setIsLoading(true);
    setQueryProgress(null);
    // Determine initial query type based on whether productContextId is set
    // Will be updated based on actual intent from API response
    setQueryType(overrideProductContextId ?? productContextId ? 'product_qa' : 'discovery');

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

      // Use streaming endpoint for real-time progress
      const response = await fetch('/api/assistant/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pageType,
          productContextId: overrideProductContextId ?? productContextId,
          message,
          history: historyPayload,
          pendingSuggestion: pendingPayload,
          conversationContext: contextPayload,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('No response body');
      }

      let finalData: AssistantApiResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.type === 'progress') {
                setQueryProgress({ stage: json.stage, progress: json.progress });
              } else if (json.type === 'result') {
                finalData = json.data;
              } else if (json.type === 'error') {
                finalData = json.data;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }

      if (!finalData) {
        throw new Error('No final data received');
      }

      // Update query type based on actual intent from API response
      if (finalData.intent && finalData.intent !== 'discovery' && finalData.intent !== 'pdp_suitability') {
        setQueryType('non_contextual');
      } else if (overrideProductContextId ?? productContextId) {
        setQueryType('product_qa');
      } else {
        setQueryType('discovery');
      }

      setPendingSuggestion(finalData.pendingSuggestion ?? null);
      const shouldShowCards = finalData.productCards.length > 0 && !finalData.pendingSuggestion;
      const assistantMessage: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: finalData.replyText,
        productCards: shouldShowCards ? finalData.productCards : [],
        noExactMatch: finalData.noExactMatch,
        followupText:
          shouldShowCards && finalData.followupText && finalData.followupText.trim().length
            ? finalData.followupText
            : undefined,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      // Scroll to bottom after bot response is added
      setTimeout(() => scrollToBottom('smooth'), 100);

      setConversationContext({
        lastIntent: finalData.intent ?? conversationContext.lastIntent ?? null,
        lastConstraints: finalData.resolvedConstraints ?? conversationContext.lastConstraints ?? null,
        lastShownProductIds: shouldShowCards ? finalData.productCards.map((card) => card.id) : [],
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
      // Scroll to bottom after error message is added
      setTimeout(() => scrollToBottom('smooth'), 100);
    } finally {
      setIsLoading(false);
      setQueryProgress(null);
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
        className="chat-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pt-6 pb-[190px] sm:px-4 sm:pt-8 sm:pb-[210px] md:px-6 md:pt-10 md:pb-[240px]"
      >
        <MessageList messages={messages} onProductClick={handleProductClick} onProductAsk={handleProductAsk} />
        <div ref={messagesEndRef} />
      </div>
      {/* Fixed suggestions above input - overlays at bottom */}
      <div 
        ref={inputContainerRef}
        className="absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-b from-transparent via-white to-white px-3 pt-3 pb-3 sm:px-4 sm:pt-4 sm:pb-4 md:px-6 md:pb-6"
      >
        {/* Query progress bar - shown only when loading */}
        <QueryProgressBar 
          isLoading={isLoading} 
          currentStage={queryProgress?.stage as any}
          currentProgress={queryProgress?.progress ?? null}
          queryType={queryType}
        />
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
          <MessageInput 
            onSend={handleSendMessage} 
            disabled={isLoading}
            productContext={productContext}
            onClearProductContext={() => {
              setProductContextId(undefined);
              setProductContext(undefined);
            }}
          />
        </div>
      </div>
    </div>
  );
}

