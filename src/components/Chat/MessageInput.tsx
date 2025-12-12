'use client';

import { useState, useEffect, useRef } from 'react';
import SearchMethodSelector, { type SearchMethodPreferences, type SearchMode, modeToPreferences } from './SearchMethodSelector';

type ProductContext = {
  id: string;
  title: string;
  imageUrl: string;
};

type MessageInputProps = {
  onSend: (message: string, searchMethods?: SearchMethodPreferences) => Promise<void> | void;
  disabled?: boolean;
  productContext?: ProductContext | undefined;
  onClearProductContext?: () => void;
  onProductContextHeightChange?: (height: number) => void;
};

const SEARCH_MODE_STORAGE_KEY = 'velou_search_mode';

export default function MessageInput({ onSend, disabled, productContext, onClearProductContext, onProductContextHeightChange }: MessageInputProps) {
  const productContextRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [placeholder, setPlaceholder] = useState('Ask for products...');
  
  // Load search mode from localStorage, default to 'fast'
  const [searchMode, setSearchMode] = useState<SearchMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SEARCH_MODE_STORAGE_KEY);
      return (saved === 'fast' || saved === 'advanced') ? saved : 'fast';
    }
    return 'fast';
  });
  
  // Use ref to always have latest mode value (avoids React state timing issues)
  const searchModeRef = useRef<SearchMode>(searchMode);
  useEffect(() => {
    searchModeRef.current = searchMode;
  }, [searchMode]);

  // Save search mode to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SEARCH_MODE_STORAGE_KEY, searchMode);
      const preferences = modeToPreferences(searchMode);
      console.log('[MessageInput] useEffect - searchMode changed to:', searchMode);
      console.log('[MessageInput] useEffect - preferences:', preferences);
      console.log('[MessageInput] useEffect - saved to localStorage as:', searchMode);
    }
  }, [searchMode]);

  // Real-time cross-tab synchronization: listen for search mode changes from other tabs
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SEARCH_MODE_STORAGE_KEY && e.newValue) {
        const newMode = (e.newValue === 'fast' || e.newValue === 'advanced') ? e.newValue : 'fast';
        if (newMode !== searchMode) {
          console.log('[MessageInput] Cross-tab sync: searchMode changed from', searchMode, 'to', newMode);
          searchModeRef.current = newMode; // Update ref immediately
          setSearchMode(newMode); // Update state
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [searchMode]);

  useEffect(() => {
    // Fetch LLM-driven placeholder text
    fetch('/api/chat/placeholder')
      .then((res) => res.json())
      .then((data) => {
        if (data.placeholder) {
          setPlaceholder(data.placeholder);
        }
      })
      .catch(() => {
        // Keep default placeholder on error
      });
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    const message = value.trim();
    setValue('');
    // Always read from localStorage to get the absolute latest value (handles cross-tab changes)
    const latestMode = (() => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(SEARCH_MODE_STORAGE_KEY);
        return (saved === 'fast' || saved === 'advanced') ? saved : 'fast';
      }
      return searchModeRef.current;
    })();
    // Update ref and state if they're out of sync
    if (latestMode !== searchModeRef.current) {
      searchModeRef.current = latestMode;
      setSearchMode(latestMode);
    }
    // Always send searchMethods based on user's choice - no auto-selection
    const searchMethods = modeToPreferences(latestMode);
    console.log('[MessageInput] handleSubmit - Latest mode from localStorage:', latestMode);
    console.log('[MessageInput] handleSubmit - Converting to searchMethods:', searchMethods);
    console.log('[MessageInput] handleSubmit - Expected for advanced:', { lexical: true, semantic: true, concept: true });
    console.log('[MessageInput] handleSubmit - Expected for fast:', { lexical: false, semantic: true, concept: true });
    await onSend(message, searchMethods);
    // Don't clear product context - user can ask multiple questions
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If Enter is pressed without Shift, send the message
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && !disabled) {
        const message = value.trim();
        setValue('');
        // Always read from localStorage to get the absolute latest value (handles cross-tab changes)
        const latestMode = (() => {
          if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(SEARCH_MODE_STORAGE_KEY);
            return (saved === 'fast' || saved === 'advanced') ? saved : 'fast';
          }
          return searchModeRef.current;
        })();
        // Update ref and state if they're out of sync
        if (latestMode !== searchModeRef.current) {
          searchModeRef.current = latestMode;
          setSearchMode(latestMode);
        }
        // Always send searchMethods based on user's choice - no auto-selection
        const searchMethods = modeToPreferences(latestMode);
        console.log('[MessageInput] handleKeyDown - Latest mode from localStorage:', latestMode);
        console.log('[MessageInput] handleKeyDown - Converting to searchMethods:', searchMethods);
        onSend(message, searchMethods);
        // Don't clear product context - user can ask multiple questions
      }
    }
    // Shift+Enter will create a new line (default behavior)
  };

  // Notify parent of product context card height changes
  useEffect(() => {
    if (onProductContextHeightChange) {
      const updateHeight = () => {
        if (productContextRef.current) {
          onProductContextHeightChange(productContextRef.current.offsetHeight);
        } else {
          onProductContextHeightChange(0);
        }
      };
      
      // Initial measurement
      updateHeight();
      
      // Use ResizeObserver for dynamic changes
      if (productContextRef.current) {
        const resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(productContextRef.current);
        return () => resizeObserver.disconnect();
      }
    }
  }, [productContext, onProductContextHeightChange]);

  return (
    <div className="space-y-2">
      {/* Product context display - matches screenshot style */}
      {productContext && (
        <div 
          ref={productContextRef}
          className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200/60"
        >
          {/* Product thumbnail */}
          <div className="flex-shrink-0">
            <div className="h-12 w-12 rounded border border-slate-200 bg-white overflow-hidden">
              <img
                src={productContext.imageUrl}
                alt={productContext.title}
                className="h-full w-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${productContext.id}/400/600`;
                }}
              />
            </div>
          </div>
          {/* Text and close button */}
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-700 font-medium">
              Ask more about this product
            </span>
            {onClearProductContext && (
              <button
                type="button"
                onClick={onClearProductContext}
                className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
                aria-label="Clear product context"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 sm:gap-3 rounded-2xl sm:rounded-3xl border border-rose-200/60 bg-[#FEEEED] p-3 sm:p-4 shadow-sm transition-shadow focus-within:border-rose-300/80 focus-within:shadow-md relative overflow-visible"
      >
        <div className="flex-1 flex flex-col gap-1 overflow-visible">
          <textarea
            className="h-14 sm:h-16 flex-1 resize-none bg-transparent text-xs sm:text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
            placeholder={productContext ? `Ask about ${productContext.title}...` : placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          />
          <div className="flex items-center justify-end relative overflow-visible">
            <SearchMethodSelector
              mode={searchMode}
              onChange={(newMode) => {
                console.log('[MessageInput] SearchMethodSelector onChange called with:', newMode);
                // Update ref immediately for synchronous access
                searchModeRef.current = newMode;
                // Update state (triggers useEffect to save to localStorage)
                setSearchMode(newMode);
                // Also save to localStorage immediately for cross-tab sync
                if (typeof window !== 'undefined') {
                  localStorage.setItem(SEARCH_MODE_STORAGE_KEY, newMode);
                }
              }}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full bg-[#D61F2B] px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-[#FEEEED] shadow-lg shadow-[#D61F2B]/30 transition hover:bg-[#b91822] disabled:opacity-50 cursor-pointer"
        >
          Send
        </button>
      </form>
    </div>
  );
}

