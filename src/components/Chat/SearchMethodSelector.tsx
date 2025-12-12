'use client';

import { useState, useRef, useEffect } from 'react';

export type SearchMode = 'fast' | 'advanced';

export type SearchMethodPreferences = {
  lexical: boolean;
  semantic: boolean;
  concept: boolean;
};

type SearchMethodSelectorProps = {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
};

export default function SearchMethodSelector({ mode, onChange }: SearchMethodSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleModeChange = (newMode: SearchMode) => {
    console.log('[SearchMethodSelector] Mode changed to:', newMode);
    onChange(newMode);
    setIsOpen(false);
  };

  const displayText = mode === 'fast' ? 'Fast' : 'Advanced';
  const description = mode === 'fast' 
    ? 'Semantic + Concept' 
    : 'All methods (Lexical + Semantic + Concept)';

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Dropdown trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-600 hover:text-slate-900 hover:bg-slate-100/60 rounded transition-colors"
        aria-label="Search mode"
      >
        <span className="font-medium">{displayText}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu - Always opens upward */}
      {isOpen && (
        <div 
          className="absolute bottom-full right-0 mb-1 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-[1000]"
        >
          <div className="px-3 py-2 border-b border-slate-100">
            <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wide">Search Mode</span>
          </div>
          
          <div className="py-1.5">
            {/* Fast mode */}
            <button
              type="button"
              onClick={() => handleModeChange('fast')}
              className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors text-left ${
                mode === 'fast' ? 'bg-rose-50/50' : ''
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-700 font-medium">Fast</span>
                <span className="text-[9px] text-slate-500">Semantic + Concept</span>
              </div>
              {mode === 'fast' && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5 text-[#D61F2B]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {/* Advanced mode */}
            <button
              type="button"
              onClick={() => handleModeChange('advanced')}
              className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 cursor-pointer transition-colors text-left ${
                mode === 'advanced' ? 'bg-rose-50/50' : ''
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-700 font-medium">Advanced</span>
                <span className="text-[9px] text-slate-500">All methods</span>
              </div>
              {mode === 'advanced' && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5 text-[#D61F2B]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to convert mode to search method preferences
export function modeToPreferences(mode: SearchMode): SearchMethodPreferences {
  if (mode === 'fast') {
    return {
      lexical: false,
      semantic: true,
      concept: true,
    };
  } else {
    return {
      lexical: true,
      semantic: true,
      concept: true,
    };
  }
}
