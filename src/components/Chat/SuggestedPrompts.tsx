'use client';

import { useEffect, useState } from 'react';

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
  // Determine if we should use hardcoded initial prompts
  // Use hardcoded when: no user messages AND no product context AND no last user message
  // Treat empty strings as falsy (no message)
  const hasValidLastMessage = lastUserMessage && typeof lastUserMessage === 'string' && lastUserMessage.trim().length > 0;
  const shouldUseHardcoded = !hasUserMessages && !productContext && !hasValidLastMessage;
  
  // Always start with hardcoded prompts - effect will immediately update if needed
  // This ensures hardcoded prompts show immediately on mount/remount (e.g., after clearing chat)
  const [suggestions, setSuggestions] = useState<string[]>(INITIAL_HARDCODED_SUGGESTIONS);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Log all values at the start for debugging
    const hasValidLastMsg = lastUserMessage && typeof lastUserMessage === 'string' && lastUserMessage.trim().length > 0;
    const productContextId = productContext?.id;
    console.log('[SuggestedPrompts] Effect triggered with values:', {
      hasUserMessages,
      productContext: productContextId,
      lastUserMessage,
      hasValidLastMessage: hasValidLastMsg,
      shouldUseHardcoded,
      currentSuggestions: suggestions,
    });

    // ABSOLUTE FIRST CHECK: If we should use hardcoded, do it immediately and exit
    // This MUST be the first check to prevent any possibility of API calls
    if (shouldUseHardcoded) {
      console.log('[SuggestedPrompts] shouldUseHardcoded=true - using hardcoded prompts (NO API CALL)', {
        hasUserMessages,
        productContext: productContextId,
        lastUserMessage,
        shouldUseHardcoded,
      });
      setSuggestions(INITIAL_HARDCODED_SUGGESTIONS);
      setIsLoading(false);
      return;
    }

    // SECOND CHECK: Verify we have meaningful parameters before proceeding
    // This is an additional safety net
    const hasLastMessage = lastUserMessage && typeof lastUserMessage === 'string' && lastUserMessage.trim().length > 0;
    const hasProductContext = productContext?.id && typeof productContext.id === 'string';
    
    // If no meaningful parameters, use hardcoded prompts and NEVER call API
    if (!hasLastMessage && !hasProductContext) {
      console.log('[SuggestedPrompts] No meaningful parameters - using hardcoded prompts (NO API CALL)', {
        hasUserMessages,
        productContext: productContext?.id,
        lastUserMessage,
        hasLastMessage,
        hasProductContext,
        shouldUseHardcoded,
      });
      setSuggestions(INITIAL_HARDCODED_SUGGESTIONS);
      setIsLoading(false);
      return;
    }

    // At this point, we have meaningful parameters, so fetch dynamic suggestions
    // Reset state immediately on context change so UI shows loading for new scope
    setIsLoading(true);
    setSuggestions(DEFAULT_SUGGESTIONS);

    // Build URL with parameters (we already verified these exist above)
    const params = new URLSearchParams();
    if (hasLastMessage && lastUserMessage) {
      params.set('lastMessage', lastUserMessage.trim());
    }
    if (hasProductContext && productContext?.id) {
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
        hasProductContext,
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
      hasProductContext,
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
    
    // Cleanup: cancel fetch if shouldUseHardcoded becomes true
    return () => {
      cancelled = true;
    };
  }, [lastUserMessage, productContext?.id, shouldUseHardcoded, hasUserMessages]);

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
            onClick={() => onSelect(prompt)}
            className={`group inline-flex rounded-full border border-rose-200/60 bg-white ${buttonBase} font-medium text-slate-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50 hover:shadow-md active:scale-[0.98] cursor-pointer whitespace-nowrap text-right`}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

