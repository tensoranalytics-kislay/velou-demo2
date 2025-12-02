'use client';

import { useEffect, useState } from 'react';

// Generic default suggestions (will be replaced by API call)
const DEFAULT_SUGGESTIONS = [
  'popular items',
  'best sellers',
  'featured products',
];

type SuggestedPromptsProps = {
  onSelect: (prompt: string) => void;
  lastUserMessage?: string | null;
  orientation?: 'row' | 'column';
  className?: string;
};

export default function SuggestedPrompts({
  onSelect,
  lastUserMessage,
  orientation = 'row',
  className,
}: SuggestedPromptsProps) {
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Fetch suggestions - include lastMessage if available for follow-up prompts
    const url = lastUserMessage && lastUserMessage.trim()
      ? `/api/suggestions?lastMessage=${encodeURIComponent(lastUserMessage.trim())}`
      : '/api/suggestions';
    
    setIsLoading(true);
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.suggestions && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        }
      })
      .catch((error) => {
        console.error('Failed to load suggestions:', error);
        // Keep default suggestions on error
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [lastUserMessage]);

  const layoutClass =
    orientation === 'column'
      ? 'flex flex-col items-end gap-2'
      : 'flex flex-wrap gap-1.5';
  const buttonBase =
    orientation === 'column'
      ? 'px-3 py-1.5 text-xs'
      : 'px-2.5 py-1 text-[10px]';

  if (isLoading) {
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

  return (
    <div className={`mb-2 ${className ?? ''}`}>
      <div className={layoutClass}>
        {suggestions.map((prompt) => (
          <button
            key={prompt}
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

