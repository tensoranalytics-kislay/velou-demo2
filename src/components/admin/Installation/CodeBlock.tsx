/**
 * CodeBlock Component
 * 
 * Displays code with syntax highlighting and copy button.
 */

'use client';

import { useState } from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
}

export default function CodeBlock({ code, language = 'html', className = '' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
        <div className="flex items-center justify-between bg-slate-100 px-4 py-2 border-b border-slate-200">
          <span className="text-xs font-medium text-slate-600">{language.toUpperCase()}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors"
          >
            {copied ? (
              <>
                <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Copied!</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
        <pre className="p-4 overflow-x-auto">
          <code className={`text-sm text-slate-900 font-mono ${className}`}>{code}</code>
        </pre>
      </div>
    </div>
  );
}


