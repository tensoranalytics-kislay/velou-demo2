'use client';

import { useState, useRef, useEffect } from 'react';

export type SearchMethod = 'lexical' | 'semantic' | 'concept';

export type SearchMethodPreferences = {
  lexical: boolean;
  semantic: boolean;
  concept: boolean;
};

type SearchMethodSelectorProps = {
  preferences: SearchMethodPreferences;
  onChange: (preferences: SearchMethodPreferences) => void;
};

export default function SearchMethodSelector({ preferences, onChange }: SearchMethodSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Calculate position and close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const calculatePosition = () => {
      if (buttonRef.current && isOpen) {
        const rect = buttonRef.current.getBoundingClientRect();
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropdownHeight = 140; // Approximate dropdown height
        
        // Open upward if there's more space above, otherwise downward
        setPosition(spaceAbove > spaceBelow ? 'top' : 'bottom');
      }
    };

    if (isOpen) {
      calculatePosition();
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', calculatePosition);
      window.addEventListener('scroll', calculatePosition, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('resize', calculatePosition);
        window.removeEventListener('scroll', calculatePosition, true);
      };
    }
  }, [isOpen]);

  const handleToggle = (method: SearchMethod) => {
    const newPreferences = { ...preferences, [method]: !preferences[method] };
    
    // Ensure at least one method is enabled
    const enabledCount = Object.values(newPreferences).filter(Boolean).length;
    if (enabledCount === 0) {
      return; // Don't allow disabling all methods
    }
    
    onChange(newPreferences);
  };

  const enabledCount = Object.values(preferences).filter(Boolean).length;
  const displayText = enabledCount === 3 ? 'All' : `${enabledCount} method${enabledCount > 1 ? 's' : ''}`;

  return (
    <div className="relative overflow-visible" ref={dropdownRef}>
      {/* Dropdown trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-600 hover:text-slate-900 hover:bg-slate-100/60 rounded transition-colors"
        aria-label="Search methods"
      >
        <span className="font-medium">{displayText}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3 w-3 transition-transform ${isOpen ? (position === 'top' ? 'rotate-180' : 'rotate-0') : 'rotate-0'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div 
          className={`absolute ${position === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-[100] overflow-hidden`}
          style={{ maxHeight: 'calc(100vh - 200px)' }}
        >
          <div className="px-3 py-2 border-b border-slate-100">
            <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wide">Search Methods</span>
          </div>
          
          <div className="py-1">
            {/* Lexical switch */}
            <label className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer transition-colors">
              <span className="text-[10px] text-slate-700 font-medium">Lexical</span>
              <Switch
                checked={preferences.lexical}
                onChange={() => handleToggle('lexical')}
              />
            </label>

            {/* Semantic switch */}
            <label className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer transition-colors">
              <span className="text-[10px] text-slate-700 font-medium">Semantic</span>
              <Switch
                checked={preferences.semantic}
                onChange={() => handleToggle('semantic')}
              />
            </label>

            {/* Concept switch */}
            <label className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 cursor-pointer transition-colors">
              <span className="text-[10px] text-slate-700 font-medium">Concept</span>
              <Switch
                checked={preferences.concept}
                onChange={() => handleToggle('concept')}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// Toggle switch component matching design system
type SwitchProps = {
  checked: boolean;
  onChange: () => void;
};

function Switch({ checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#D61F2B]/20 focus:ring-offset-1 ${
        checked ? 'bg-[#D61F2B]' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

