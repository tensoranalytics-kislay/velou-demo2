/**
 * ActionChips Component
 * 
 * Renders action proposal chips as quick-reply buttons.
 * Clicking a chip triggers the action via API call with actionId.
 */

'use client';

import type { ActionProposal } from '@/lib/loccitane/actions';

type ActionChipsProps = {
  actions: ActionProposal[];
  onActionClick: (actionId: string) => void;
  disabled?: boolean;
};

/**
 * Safely extract a user-friendly label from action.label
 * Handles cases where label might be JSON, array, or object
 */
function extractLabel(rawLabel: string | unknown): string {
  if (!rawLabel) return 'More options';
  
  const labelStr = typeof rawLabel === 'string' ? rawLabel : String(rawLabel);
  
  // Try to parse as JSON if it looks like JSON
  if (labelStr.trim().startsWith('{') || labelStr.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(labelStr);
      if (Array.isArray(parsed)) {
        return parsed[0] || 'More options';
      }
      if (typeof parsed === 'object' && parsed !== null) {
        // Handle {"labels": [...]} format
        if ('labels' in parsed && Array.isArray(parsed.labels) && parsed.labels.length > 0) {
          return String(parsed.labels[0]);
        }
        if ('label' in parsed && typeof parsed.label === 'string') {
          return parsed.label;
        }
      }
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // Not valid JSON, continue with string processing
    }
  }
  
  // Clean up string: remove quotes, brackets, etc.
  return labelStr
    .replace(/^["'`]/g, '')
    .replace(/["'`]$/g, '')
    .replace(/^\[|\]$/g, '')
    .replace(/\{[^}]*"labels"\s*:\s*\[([^\]]+)\][^}]*\}/, '$1')
    .replace(/["'`]/g, '')
    .trim() || 'More options';
}

export default function ActionChips({ actions, onActionClick, disabled = false }: ActionChipsProps) {
  if (!actions || actions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action) => {
        const displayLabel = extractLabel(action.label);
        return (
          <button
            key={action.id}
            onClick={() => !disabled && onActionClick(action.id)}
            disabled={disabled}
            className="group inline-flex rounded-full border border-rose-200/60 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all hover:border-rose-300 hover:bg-rose-50 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-rose-200/60 disabled:hover:bg-white disabled:hover:shadow-sm whitespace-nowrap"
            aria-label={`Action: ${displayLabel}`}
          >
            {displayLabel}
          </button>
        );
      })}
    </div>
  );
}

