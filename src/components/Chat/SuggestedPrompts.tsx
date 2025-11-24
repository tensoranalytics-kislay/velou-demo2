'use client';

import { useEffect, useState } from 'react';

const DEFAULT_SUGGESTIONS = [
  'flare jeans under $50',
  'dresses date night under $200',
  'skinny jeans under $100',
];

type SuggestedPromptsProps = {
  onSelect: (prompt: string) => void;
  lastUserMessage?: string | null;
};

export default function SuggestedPrompts({ onSelect, lastUserMessage }: SuggestedPromptsProps) {
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

  if (isLoading) {
    return (
      <div className="mb-2">
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_SUGGESTIONS.slice(0, 3).map((prompt, idx) => (
            <div
              key={idx}
              className="h-6 w-32 animate-pulse rounded-full border border-rose-100/50 bg-rose-50/50"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            className="group rounded-full border border-rose-200/60 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50 hover:shadow-md active:scale-[0.98] cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

