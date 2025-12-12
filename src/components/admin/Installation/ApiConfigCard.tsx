/**
 * API Configuration Card
 * 
 * Displays API key and allows regeneration, plus manages allowed origins.
 */

'use client';

import { useState } from 'react';
import StatusBadge from './StatusBadge';

interface Origin {
  origin: string;
  verified: boolean;
  verifiedAt: string | null;
}

interface ApiConfigCardProps {
  apiKey: string;
  apiKeyId: string;
  allowedOrigins: Origin[];
  onRegenerate: () => Promise<void>;
  onAddOrigin: (origin: string) => Promise<void>;
  onRemoveOrigin: (origin: string) => Promise<void>;
  onVerifyOrigin: (origin: string) => Promise<void>;
}

export default function ApiConfigCard({
  apiKey,
  apiKeyId,
  allowedOrigins,
  onRegenerate,
  onAddOrigin,
  onRemoveOrigin,
  onVerifyOrigin,
}: ApiConfigCardProps) {
  const [newOrigin, setNewOrigin] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  const handleAddOrigin = async () => {
    if (!newOrigin.trim()) return;

    setIsAdding(true);
    try {
      await onAddOrigin(newOrigin.trim());
      setNewOrigin('');
    } catch (error) {
      console.error('Failed to add origin:', error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRegenerate = async () => {
    if (!showRegenerateConfirm) {
      setShowRegenerateConfirm(true);
      return;
    }

    setIsRegenerating(true);
    try {
      await onRegenerate();
      setShowRegenerateConfirm(false);
      alert('API key regenerated successfully. Update your widget installation with the new key.');
    } catch (error) {
      console.error('Failed to regenerate key:', error);
      alert('Failed to regenerate API key. Please try again.');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-6">API Configuration</h3>

      {/* API Key */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">API Key</label>
        <div className="flex items-center gap-3">
          <input
            type="text"
            readOnly
            value={apiKey}
            className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-mono text-slate-900"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(apiKey);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Copy
          </button>
          <button
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className={`rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition ${
              showRegenerateConfirm
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isRegenerating
              ? 'Regenerating...'
              : showRegenerateConfirm
              ? 'Confirm Regenerate'
              : 'Regenerate Key'}
          </button>
          {showRegenerateConfirm && (
            <button
              onClick={() => setShowRegenerateConfirm(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
        </div>
        {showRegenerateConfirm && (
          <p className="mt-2 text-xs text-red-600">
            ⚠️ Warning: Regenerating will invalidate the current key. Update your widget installation immediately.
          </p>
        )}
      </div>

      {/* Allowed Origins */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Allowed Origins (CORS Whitelist)</label>
        <p className="mb-4 text-xs text-slate-500">
          Add domains where your widget will be embedded. Only requests from these origins will be accepted.
        </p>

        {/* Origin List */}
        {allowedOrigins.length > 0 && (
          <div className="mb-4 space-y-2">
            {allowedOrigins.map((item) => (
              <div key={item.origin} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-slate-900">{item.origin}</span>
                  {item.verified ? (
                    <StatusBadge status="verified" label="Verified" />
                  ) : (
                    <StatusBadge status="not-verified" label="Not Verified" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onVerifyOrigin(item.origin)}
                    className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 transition"
                  >
                    Verify
                  </button>
                  <button
                    onClick={() => onRemoveOrigin(item.origin)}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Origin */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={newOrigin}
            onChange={(e) => setNewOrigin(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAddOrigin();
              }
            }}
          />
          <button
            onClick={handleAddOrigin}
            disabled={isAdding || !newOrigin.trim()}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAdding ? 'Adding...' : '+ Add Origin'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Enter the full domain (e.g., https://example.com). Wildcard subdomains (e.g., *.example.com) are supported.
        </p>
      </div>
    </div>
  );
}


