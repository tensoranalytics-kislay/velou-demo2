'use client';

import { useEffect, useState, useRef } from 'react';

// Hardcoded initial suggestions shown before any user interaction
const INITIAL_HARDCODED_SUGGESTIONS = [
  'top sellers',
  'best rated',
  'new arrivals',
  'featured products',
];

// Generic default suggestions (fallback)
const DEFAULT_SUGGESTIONS = [
  'popular items',
  'best sellers',
  'featured products',
];

type SuggestedPromptsProps = {
  onSelect: (prompt: string) => void;
  lastUserMessage?: string | null;
  productContext?: { id: string; title: string; imageUrl: string } | undefined;
  hasUserMessages?: boolean; // Whether user has sent any messages
  orientation?: 'row' | 'column';
  className?: string;
};

export default function SuggestedPrompts({
  onSelect,
  lastUserMessage,
  productContext,
  hasUserMessages = false,
  orientation = 'row',
  className,
}: SuggestedPromptsProps) {
  // Track previous product context to detect when it's cleared
  const prevProductContextRef = useRef<string | undefined>(productContext?.id);
  const wasProductContextClearedRef = useRef(false);
  const lastMessageWhenClearedRef = useRef<string | null>(null);
  
  // Always start with hardcoded prompts - effect will immediately update if needed
  // This ensures hardcoded prompts show immediately on mount/remount (e.g., after clearing chat)
  const [suggestions, setSuggestions] = useState<string[]>(INITIAL_HARDCODED_SUGGESTIONS);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // STEP 1: Detect when product context is cleared (goes from defined to undefined)
    // This must happen FIRST, before any other logic
    const hadProductContext = prevProductContextRef.current !== undefined;
    const hasProductContext = productContext?.id !== undefined;
    const productContextId = productContext?.id;
    
    if (hadProductContext && !hasProductContext) {
      // Product context was just cleared - mark for hardcoded reset
      // Store the last message at the time of clearing so we can detect when a NEW message is sent
      wasProductContextClearedRef.current = true;
      lastMessageWhenClearedRef.current = lastUserMessage || null;
    }
    
    // Update ref for next render
    prevProductContextRef.current = productContextId;
    
    // STEP 2: Check if product context was cleared and user has sent a NEW message
    // If so, reset the flag to allow dynamic prompts for the new query
    // This must happen BEFORE determining shouldUseHardcoded
    const hasValidLastMsg = lastUserMessage && typeof lastUserMessage === 'string' && lastUserMessage.trim().length > 0;
    
    // If flag is set and we have a valid message, check if it's a new message (different from when cleared)
    if (wasProductContextClearedRef.current && hasValidLastMsg && !hasProductContext) {
      const isNewMessage = lastUserMessage !== lastMessageWhenClearedRef.current;
      if (isNewMessage) {
        console.log('[SuggestedPrompts] New message after clearing product context - resetting flag for dynamic prompts', {
          oldMessage: lastMessageWhenClearedRef.current,
          newMessage: lastUserMessage,
        });
        wasProductContextClearedRef.current = false;
        lastMessageWhenClearedRef.current = null;
      }
    }
    
    // STEP 3: Determine if we should use hardcoded prompts
    // Use hardcoded when: 
    // 1. No user messages AND no product context AND no last user message (initial state)
    // 2. OR product context was just cleared (flag is true) - this means we haven't sent a new query yet
    //    (if a new query was sent, the flag would have been reset above)
    const shouldUseHardcoded = (!hasUserMessages && !productContext && !hasValidLastMsg) || wasProductContextClearedRef.current;
    
    console.log('[SuggestedPrompts] Effect triggered with values:', {
      hadProductContext,
      hasProductContext,
      productContextId,
      lastUserMessage,
      hasValidLastMessage: hasValidLastMsg,
      shouldUseHardcoded,
      wasProductContextCleared: wasProductContextClearedRef.current,
      lastMessageWhenCleared: lastMessageWhenClearedRef.current,
    });

    // STEP 4: If we should use hardcoded, do it immediately and exit (NO API CALL)
    if (shouldUseHardcoded) {
      console.log('[SuggestedPrompts] shouldUseHardcoded=true - using hardcoded prompts (NO API CALL)', {
        hasUserMessages,
        productContext: productContextId,
        lastUserMessage,
        shouldUseHardcoded,
        wasProductContextCleared: wasProductContextClearedRef.current,
        lastMessageWhenCleared: lastMessageWhenClearedRef.current,
      });
      setSuggestions(INITIAL_HARDCODED_SUGGESTIONS);
      setIsLoading(false);
      return;
    }

    // STEP 5: Verify we have meaningful parameters before proceeding
    // This is an additional safety net
    const hasLastMessage = lastUserMessage && typeof lastUserMessage === 'string' && lastUserMessage.trim().length > 0;
    const hasValidProductContext = productContext?.id && typeof productContext.id === 'string';
    
    // If no meaningful parameters, use hardcoded prompts and NEVER call API
    if (!hasLastMessage && !hasValidProductContext) {
      console.log('[SuggestedPrompts] No meaningful parameters - using hardcoded prompts (NO API CALL)', {
        hasUserMessages,
        productContext: productContextId,
        lastUserMessage,
        hasLastMessage,
        hasValidProductContext,
      });
      setSuggestions(INITIAL_HARDCODED_SUGGESTIONS);
      setIsLoading(false);
      return;
    }
    
    // Reset state immediately on context change so UI shows loading for new scope
    setIsLoading(true);
    setSuggestions(DEFAULT_SUGGESTIONS);

    // Build URL with parameters (we already verified these exist above)
    const params = new URLSearchParams();
    if (hasLastMessage && lastUserMessage) {
      params.set('lastMessage', lastUserMessage.trim());
    }
    if (hasValidProductContext && productContext?.id) {
      params.set('productId', productContext.id);
    }
    const url = `/api/suggestions${params.toString() ? `?${params.toString()}` : ''}`;

    // FINAL SAFETY CHECK: If URL has no query parameters, don't call API
    if (!params.toString() || params.toString().length === 0) {
      console.error('[SuggestedPrompts] ERROR: Reached fetch with no parameters - using hardcoded instead', {
        hasUserMessages,
        lastUserMessage,
        productContext: productContext?.id,
        shouldUseHardcoded,
        hasLastMessage,
        hasValidProductContext,
        url,
      });
      setSuggestions(INITIAL_HARDCODED_SUGGESTIONS);
      setIsLoading(false);
      return;
    }

    console.log('[SuggestedPrompts] Fetching dynamic suggestions (has meaningful parameters):', {
      hasUserMessages,
      lastUserMessage,
      productContextId: productContext?.id,
      shouldUseHardcoded,
      hasLastMessage,
      hasValidProductContext,
      url,
    });
    
    let cancelled = false;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        // Don't update if we should now use hardcoded (e.g., user cleared chat during fetch)
        // The cleanup function will set cancelled=true if dependencies change
        if (cancelled) {
          console.log('[SuggestedPrompts] Fetch cancelled - dependencies changed');
          return;
        }
        
        console.log('[SuggestedPrompts] Received suggestions:', { 
          count: data.suggestions?.length || 0, 
          suggestions: data.suggestions 
        });
        // If API returns empty array for irrelevant queries, keep existing suggestions
        // If API returns suggestions, update them
        if (data.suggestions && Array.isArray(data.suggestions)) {
          if (data.suggestions.length > 0) {
            console.log('[SuggestedPrompts] Updating suggestions with new prompts');
            setSuggestions(data.suggestions);
          } else {
            console.log('[SuggestedPrompts] Empty suggestions array - keeping existing suggestions');
          }
          // If empty array and we have lastUserMessage, it means query was irrelevant
          // Keep existing suggestions (don't update)
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[SuggestedPrompts] Failed to load suggestions:', error);
        // Keep existing suggestions on error
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    
    // Cleanup: cancel fetch if dependencies change
    return () => {
      cancelled = true;
    };
  }, [lastUserMessage, productContext?.id, hasUserMessages]);

  // Compute shouldUseHardcoded for render logic (used for loading state)
  // This is a lightweight check that matches the logic in the effect
  const hasValidLastMessage = lastUserMessage && typeof lastUserMessage === 'string' && lastUserMessage.trim().length > 0;
  const shouldUseHardcoded = (!hasUserMessages && !productContext && !hasValidLastMessage) || wasProductContextClearedRef.current;

  const layoutClass =
    orientation === 'column'
      ? 'flex flex-col items-end gap-2'
      : 'flex flex-wrap gap-1.5';
  const buttonBase =
    orientation === 'column'
      ? 'px-3 py-1.5 text-xs'
      : 'px-2.5 py-1 text-[10px]';

  if (isLoading && !shouldUseHardcoded) {
    return (
      <div className={`mb-2 ${className ?? ''}`}>
        <div className={layoutClass}>
          {DEFAULT_SUGGESTIONS.slice(0, 3).map((prompt, idx) => (
            <div
              key={idx}
              className={`h-7 min-w-[10rem] animate-pulse rounded-full border border-rose-100/50 bg-rose-50/50`}
            />
          ))}
        </div>
      </div>
    );
  }

  // Remove duplicates and ensure unique keys (normalize whitespace first)
  const normalizedSuggestions = suggestions.map(s => s.trim()).filter(Boolean);
  const uniqueSuggestions = Array.from(new Set(normalizedSuggestions));

  return (
    <div className={`mb-2 ${className ?? ''}`}>
      <div className={layoutClass}>
        {uniqueSuggestions.map((prompt, index) => (
          <button
            key={`prompt-${index}-${prompt.slice(0, 20)}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(prompt);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(prompt);
            }}
            style={{
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              pointerEvents: 'auto',
              zIndex: 9999,
            }}
            className={`group inline-flex rounded-full border border-rose-200/60 bg-white ${buttonBase} font-medium text-slate-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50 hover:shadow-md active:scale-[0.98] cursor-pointer whitespace-nowrap text-right relative z-[9999]`}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

