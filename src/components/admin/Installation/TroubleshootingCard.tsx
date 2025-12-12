/**
 * Troubleshooting Card
 * 
 * Collapsible FAQ section with common issues and solutions.
 */

'use client';

import { useState } from 'react';

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: 'Widget not showing?',
    answer:
      'Check that the script tag is in your HTML (open browser console with F12 and look for errors). Verify your domain is in the Allowed Origins list. Make sure your API key is correct and active.',
  },
  {
    question: 'Getting CORS errors?',
    answer:
      'Add your domain to the Allowed Origins list in API Configuration. Make sure the domain name is an exact match (including https://). Wildcard subdomains are supported (e.g., *.example.com).',
  },
  {
    question: 'Widget not loading CSS?',
    answer:
      'Clear your browser cache and reload the page. Check that the CDN is accessible (https://cdn.velou.ai/widget.js should load). Try opening the widget script URL directly in your browser.',
  },
  {
    question: 'Getting 401 Unauthorized?',
    answer:
      'Check that your API key is correct and hasn\'t been regenerated. If you regenerated the key, update your widget installation with the new key. Verify the API key starts with "pk_live_".',
  },
  {
    question: 'Widget appears but no response?',
    answer:
      'Check that your API key is active and the merchant ID matches. Verify the widget can reach the API (check browser Network tab). Make sure rate limits haven\'t been exceeded.',
  },
  {
    question: 'Widget styling conflicts with my site?',
    answer:
      'The widget uses encapsulated CSS to prevent conflicts. If you see styling issues, check that your site isn\'t overriding widget styles. Contact support if you need custom styling.',
  },
];

export default function TroubleshootingCard() {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const toggleItem = (index: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedItems(newExpanded);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Troubleshooting</h3>
      <p className="text-sm text-slate-600 mb-6">
        Common issues and solutions for widget installation and configuration.
      </p>

      <div className="space-y-2">
        {faqItems.map((item, index) => (
          <div key={index} className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleItem(index)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition"
            >
              <span className="text-sm font-medium text-slate-900">{item.question}</span>
              <svg
                className={`h-5 w-5 text-slate-500 transition-transform ${
                  expandedItems.has(index) ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedItems.has(index) && (
              <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
                <p className="text-sm text-slate-700">{item.answer}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          <strong>Still need help?</strong> Contact our support team at{' '}
          <a href="mailto:support@velou.ai" className="text-blue-700 underline hover:text-blue-800">
            support@velou.ai
          </a>
        </p>
      </div>
    </div>
  );
}


