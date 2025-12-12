'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ConversationContext, PendingSuggestionResult } from '@/lib/llm/types';
import type { ProductCard } from '@/lib/llm/orchestrator/cards';
import type { SearchConstraints } from '@/lib/search/types';
import MessageInput from './MessageInput';
import MessageList, { type ChatMessage } from './MessageList';
import SuggestedPrompts from './SuggestedPrompts';
import QueryProgressBar from './QueryProgressBar';
import {
  clearChatHistory,
  clearPendingSuggestionCache,
  clearSessionData,
  loadChatHistory,
  loadPendingSuggestionCache,
  loadSessionData,
  saveChatHistory,
  savePendingSuggestionCache,
  saveSessionData,
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
  // Initialize with stored messages if available, otherwise use default
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return [defaultInitialMessage];
    const stored = loadChatHistory(STORAGE_KEY);
    if (stored.length) {
      return stored.map((entry, index) => ({
        id: `stored-${entry.ts ?? index}-${index}`,
        role: entry.role,
        content: entry.text,
        productCards: entry.productCards || [],
        followupText: entry.followupText,
        noExactMatch: entry.noExactMatch,
      }));
    }
    return [defaultInitialMessage];
  });
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
  
  // Load or create sessionId from localStorage for persistence across reloads/tabs
  const [sessionId, setSessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return createId();
    const stored = loadSessionData(STORAGE_KEY);
    if (stored?.sessionId) {
      return stored.sessionId;
    }
    const newId = createId();
    // Save immediately
    saveSessionData(STORAGE_KEY, {
      sessionId: newId,
      conversationContext: {
        lastIntent: null,
        lastConstraints: null,
        lastShownProductIds: [],
        lastUserQuery: null,
      },
      timestamp: Date.now(),
    });
    return newId;
  });
  
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const productContextCardHeightRef = useRef<number>(0);
  const [inputContainerHeight, setInputContainerHeight] = useState<number>(240);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      // Use multiple attempts to ensure we scroll to absolute bottom
      const attemptScroll = () => {
        const container = scrollContainerRef.current;
        const inputContainer = inputContainerRef.current;
        const messagesEnd = messagesEndRef.current;

        if (!container) return;

        // Scroll to absolute bottom, even if part of the latest message sits behind overlays.
        // This favors showing the newest content over preserving previous messages in view.
        const buffer = 16; // tiny nudge to ensure we hit the end
        const targetScroll = Math.max(0, container.scrollHeight - container.clientHeight + buffer);

        container.scrollTo({
          top: targetScroll,
          behavior,
        });
      };
      
      // Immediate attempt
      attemptScroll();
      
      // Retry after a short delay to account for DOM updates
      setTimeout(attemptScroll, 50);
      // Retry for slow renders (e.g., product cards, progress bar, recommendation pills)
      setTimeout(attemptScroll, 150);
      // One more retry for very slow renders (e.g., when product context card appears)
      setTimeout(attemptScroll, 300);
      // Final retry for all elements to be fully rendered (progress bar, pills, product card)
      setTimeout(attemptScroll, 500);
      // Extra retry for very slow dynamic content (especially when product card appears)
      setTimeout(attemptScroll, 700);
      // One more retry for product context card specifically
      if (productContext) {
        setTimeout(attemptScroll, 900);
      }
    },
    [productContext],
  );

  // Track the dynamic height of the input container (pills, input, product card)
  useEffect(() => {
    const element = inputContainerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        setInputContainerHeight((prev) => {
          if (Math.abs(prev - height) < 1) return prev;
          return height;
        });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Re-scroll when the input container height changes to keep latest message visible
  useEffect(() => {
    scrollToBottom('smooth');
  }, [inputContainerHeight, scrollToBottom]);

  const bottomPadding = useMemo(() => {
    // Add buffer so the last message clears overlays (input, pills, product card)
    return Math.max(0, inputContainerHeight + 48 - 50);
  }, [inputContainerHeight]);

  // Handle product context card height changes for scroll calculations
  const handleProductContextHeightChange = useCallback((height: number) => {
    const previousHeight = productContextCardHeightRef.current;
    productContextCardHeightRef.current = height;
    
    // If height changed (card appeared or disappeared), scroll to adjust
    // Multiple attempts with longer delays to ensure all elements have rendered
    if (previousHeight !== height) {
      // Card appeared - need extra time for full render
      if (height > 0) {
        setTimeout(() => scrollToBottom('smooth'), 100);
        setTimeout(() => scrollToBottom('smooth'), 300);
        setTimeout(() => scrollToBottom('smooth'), 600);
      } else {
        // Card disappeared
        setTimeout(() => scrollToBottom('smooth'), 50);
        setTimeout(() => scrollToBottom('smooth'), 200);
      }
    }
  }, [scrollToBottom]);
  
  // Auto-scroll when product context changes (product selected/deselected)
  useEffect(() => {
    // Multiple attempts with increasing delays to ensure all DOM updates are complete
    // This accounts for product context card, progress bar, and recommendation pills rendering
    if (productContext) {
      // Product selected - scroll immediately and then retry with longer delays to account for card rendering
      // The card height is measured by ResizeObserver in MessageInput, which triggers handleProductContextHeightChange
      // But we also want to scroll here to ensure proper positioning
      scrollToBottom('smooth');
      setTimeout(() => scrollToBottom('smooth'), 100);
      setTimeout(() => scrollToBottom('smooth'), 250);
      setTimeout(() => scrollToBottom('smooth'), 400);
      setTimeout(() => scrollToBottom('smooth'), 600);
      setTimeout(() => scrollToBottom('smooth'), 800);
      setTimeout(() => scrollToBottom('smooth'), 1000);
    } else {
      // Product context cleared - scroll to adjust (card removed, need less space)
      setTimeout(() => scrollToBottom('smooth'), 50);
      setTimeout(() => scrollToBottom('smooth'), 200);
    }
  }, [productContext, scrollToBottom]);

  // Load session data (conversationContext) on mount
  useEffect(() => {
    const storedSession = loadSessionData(STORAGE_KEY);
    if (storedSession?.conversationContext) {
      // Restore conversationContext but exclude datasetContext (loaded from server)
      setConversationContext({
        ...storedSession.conversationContext,
        datasetContext: null, // Will be loaded from server when needed
      });
    }
  }, []);

  // Cross-tab synchronization: listen for storage events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      // Only handle our storage keys
      if (e.key === STORAGE_KEY || e.key === `${STORAGE_KEY}__session` || e.key === `${STORAGE_KEY}__pending`) {
        if (e.key === `${STORAGE_KEY}__session` && e.newValue) {
          try {
            const newSession = JSON.parse(e.newValue) as { sessionId: string; conversationContext: ConversationContext; timestamp: number };
            // Update sessionId if it changed (shouldn't normally, but handle edge cases)
            if (newSession.sessionId && newSession.sessionId !== sessionId) {
              setSessionId(newSession.sessionId);
            }
            if (newSession.conversationContext) {
              setConversationContext(newSession.conversationContext);
            }
          } catch {
            // Ignore parse errors
          }
        } else if (e.key === STORAGE_KEY && e.newValue) {
          // Reload chat history from other tab
          const stored = loadChatHistory(STORAGE_KEY);
          if (stored.length) {
            const messages: ChatMessage[] = stored.map((entry, index) => ({
              id: `stored-${entry.ts ?? index}-${index}`,
              role: entry.role,
              content: entry.text,
              productCards: entry.productCards || [],
              followupText: entry.followupText,
              noExactMatch: entry.noExactMatch,
            }));
            setMessages(messages);
          }
        } else if (e.key === `${STORAGE_KEY}__pending` && e.newValue) {
          try {
            const pending = JSON.parse(e.newValue) as PendingSuggestionResult;
            setPendingSuggestion(pending);
          } catch {
            setPendingSuggestion(null);
          }
        } else if (e.newValue === null) {
          // Key was deleted (clear chat)
          if (e.key === STORAGE_KEY) {
            // Reload greeting
            fetch('/api/chat/greeting')
              .then((res) => res.json())
              .then((data) => {
                if (data.greeting) {
                  setMessages([{
                    id: 'welcome',
                    role: 'assistant',
                    content: data.greeting,
                    productCards: [],
                  }]);
                }
              })
              .catch(() => {
                setMessages([defaultInitialMessage]);
              });
          } else if (e.key === `${STORAGE_KEY}__session`) {
            // Session cleared, reset conversation context
            setConversationContext({
              lastIntent: null,
              lastConstraints: null,
              lastShownProductIds: [],
              lastUserQuery: null,
            });
          } else if (e.key === `${STORAGE_KEY}__pending`) {
            setPendingSuggestion(null);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [sessionId]);

  useEffect(() => {
    // Always fetch fresh greeting to ensure it's dataset-aware
    // Only update the first message if it's a greeting
    fetch('/api/chat/greeting')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Greeting API returned ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.greeting) {
          setMessages((currentMessages) => {
            // Only update if first message is a greeting
            const firstMessage = currentMessages[0];
            const oldGreetingPatterns = [
              "Tell me the vibe, fabric, or budget",
            ];
            const isOldGreeting = firstMessage?.role === 'assistant' && 
              (firstMessage.id === 'welcome' ||
               oldGreetingPatterns.some(pattern => firstMessage.content.includes(pattern)));
            
            // Update first message if it's a greeting
            if (firstMessage.id === 'welcome' || isOldGreeting || firstMessage.content !== data.greeting) {
              const updatedMessages = [...currentMessages];
              updatedMessages[0] = {
                id: 'welcome',
                role: 'assistant',
                content: data.greeting,
                productCards: [],
              };
              
              // Persist the updated messages
              const timestampBase = Date.now();
              const serializable: StoredChatMessage[] = updatedMessages.map((message, index) => ({
                role: message.role,
                text: message.content,
                productCards: message.productCards,
                followupText: message.followupText,
                noExactMatch: message.noExactMatch,
                ts: timestampBase + index,
              }));
              saveChatHistory(STORAGE_KEY, serializable);
              
              return updatedMessages;
            }
            
            return currentMessages;
          });
        }
      })
      .catch((error) => {
        console.error('Failed to load greeting:', error);
        // On error, only update if first message is an old greeting
        setMessages((currentMessages) => {
          const firstMessage = currentMessages[0];
          const oldGreetingPatterns = [
            "Tell me the vibe, fabric, or budget",
          ];
          const isOldGreeting = firstMessage?.role === 'assistant' && 
            oldGreetingPatterns.some(pattern => firstMessage.content.includes(pattern));
          
          if (isOldGreeting) {
            const updatedMessages = [...currentMessages];
            updatedMessages[0] = {
              ...defaultInitialMessage,
              productCards: defaultInitialMessage.productCards || [],
            };
            
            const timestampBase = Date.now();
            const serializable: StoredChatMessage[] = updatedMessages.map((message, index) => ({
              role: message.role,
              text: message.content,
              productCards: message.productCards,
              followupText: message.followupText,
              noExactMatch: message.noExactMatch,
              ts: timestampBase + index,
            }));
            saveChatHistory(STORAGE_KEY, serializable);
            
            return updatedMessages;
          }
          
          return currentMessages;
        });
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
        followupText: message.followupText,
        noExactMatch: message.noExactMatch,
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

  // Persist conversationContext whenever it changes
  useEffect(() => {
    if (!hasHydrated) return;
    const storedSession = loadSessionData(STORAGE_KEY);
    if (storedSession) {
      saveSessionData(STORAGE_KEY, {
        ...storedSession,
        conversationContext,
      });
    } else {
      saveSessionData(STORAGE_KEY, {
        sessionId,
        conversationContext,
        timestamp: Date.now(),
      });
    }
  }, [conversationContext, hasHydrated, sessionId]);

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
    clearSessionData(STORAGE_KEY);
    // Generate new sessionId after clearing
    const newSessionId = createId();
    setSessionId(newSessionId);
    saveSessionData(STORAGE_KEY, {
      sessionId: newSessionId,
      conversationContext: {
        lastIntent: null,
        lastConstraints: null,
        lastShownProductIds: [],
        lastUserQuery: null,
      },
      timestamp: Date.now(),
    });
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
    
    // Scroll immediately and again after DOM updates to ensure messages are visible above the product card
    setTimeout(() => scrollToBottom('smooth'), 50);
    setTimeout(() => scrollToBottom('smooth'), 200);
    setTimeout(() => scrollToBottom('smooth'), 400);
  };

  const handleSendMessage = async (message: string, overrideProductContextId?: string, searchMethods?: { lexical: boolean; semantic: boolean; concept: boolean }) => {
    console.log('[ChatPanel] handleSendMessage called with searchMethods:', searchMethods);
    const userMessage: ChatMessage = {
      id: createId(),
      role: 'user',
      content: message,
    };

    setMessages((prev) => [...prev, userMessage]);
    // Scroll to bottom immediately after user message is added
    // Multiple attempts to account for progress bar and recommendation pills appearing
    setTimeout(() => scrollToBottom('smooth'), 50);
    setTimeout(() => scrollToBottom('smooth'), 150);
    setIsLoading(true);
    setQueryProgress(null);
    // Scroll again after loading state changes (progress bar may appear)
    setTimeout(() => scrollToBottom('smooth'), 200);
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
          // Always include searchMethods - use user's choice, or default to fast mode
          searchMethods: searchMethods || { lexical: false, semantic: true, concept: true },
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
      // Multiple attempts to account for progress bar, recommendation pills, and product context card
      setTimeout(() => scrollToBottom('smooth'), 100);
      setTimeout(() => scrollToBottom('smooth'), 300);
      setTimeout(() => scrollToBottom('smooth'), 500);

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
      // Multiple attempts to account for progress bar, recommendation pills, and product context card
      setTimeout(() => scrollToBottom('smooth'), 100);
      setTimeout(() => scrollToBottom('smooth'), 300);
    } finally {
      setIsLoading(false);
      setQueryProgress(null);
    }
  };

  const isEmpty = messages.length === 1 && messages[0].role === 'assistant';

  // Memoize lastUserMessage to ensure SuggestedPrompts component properly reacts to changes
  const lastUserMessage = useMemo(() => {
    const userMessages = messages.filter((m) => m.role === 'user');
    return userMessages.length > 0 ? userMessages[userMessages.length - 1]?.content || null : null;
  }, [messages]);

  // Check if user has sent any messages (excluding initial welcome)
  const hasUserMessages = useMemo(() => {
    return messages.some((m) => m.role === 'user');
  }, [messages]);

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
        className="chat-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pt-6 sm:px-4 sm:pt-8 md:px-6 md:pt-10"
        style={{ paddingBottom: bottomPadding }}
      >
        <MessageList messages={messages} onProductClick={handleProductClick} onProductAsk={handleProductAsk} />
        <div ref={messagesEndRef} />
      </div>
      {/* Fixed suggestions above input - overlays at bottom */}
      <div 
        ref={inputContainerRef}
        className="absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-b from-transparent via-white to-white px-3 pt-3 pb-3 sm:px-4 sm:pt-4 sm:pb-4 md:px-6 md:pb-6 overflow-visible"
      >
        {/* Query progress bar - shown only when loading */}
        <QueryProgressBar 
          isLoading={isLoading} 
          currentStage={queryProgress?.stage as any}
          currentProgress={queryProgress?.progress ?? null}
          queryType={queryType}
        />
        <SuggestedPrompts
          key={`${sessionId}-${productContext?.id || 'none'}-${hasUserMessages ? 'hasMessages' : 'noMessages'}-${lastUserMessage || 'initial'}`}
          onSelect={(prompt) => {
            handleSendMessage(prompt);
          }}
          lastUserMessage={lastUserMessage}
          productContext={productContext}
          hasUserMessages={hasUserMessages}
        />
        <div className="mt-3">
          <MessageInput 
            onSend={(message, searchMethods) => handleSendMessage(message, undefined, searchMethods)} 
            disabled={isLoading}
            productContext={productContext}
            onClearProductContext={() => {
              setProductContextId(undefined);
              setProductContext(undefined);
            }}
            onProductContextHeightChange={handleProductContextHeightChange}
          />
        </div>
      </div>
    </div>
  );
}

