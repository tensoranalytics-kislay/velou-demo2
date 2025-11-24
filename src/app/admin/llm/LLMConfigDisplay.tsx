'use client';

import { useState } from 'react';

type Props = {
  currentProvider: string;
  hasOpenAIKey: boolean;
  hasPerplexityKey: boolean;
  useMerchantKey: boolean;
  hasMerchantOpenAIKey: boolean;
  hasMerchantPerplexityKey: boolean;
};

export default function LLMConfigDisplay({
  currentProvider,
  hasOpenAIKey,
  hasPerplexityKey,
  useMerchantKey,
  hasMerchantOpenAIKey,
  hasMerchantPerplexityKey,
}: Props) {
  const [isSaving, setIsSaving] = useState(false);

  const handleToggleMerchantKey = async () => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/admin/brand-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useMerchantKey: !useMerchantKey }),
      });

      if (!response.ok) throw new Error('Failed to update');
      window.location.reload();
    } catch (error) {
      console.error('Failed to update merchant key setting:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-medium text-slate-900">Current Configuration</h3>
        <dl className="space-y-4">
          <div>
            <dt className="text-sm font-medium text-slate-500">Provider</dt>
            <dd className="mt-1 text-sm text-slate-900">
              <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 font-medium text-blue-800">
                {currentProvider}
              </span>
            </dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-slate-500">Environment Keys</dt>
            <dd className="mt-1 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-700">OpenAI API Key</span>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    hasOpenAIKey
                      ? 'bg-green-100 text-green-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {hasOpenAIKey ? 'Set' : 'Not set'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-700">Perplexity API Key</span>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    hasPerplexityKey
                      ? 'bg-green-100 text-green-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {hasPerplexityKey ? 'Set' : 'Not set'}
                </span>
              </div>
            </dd>
          </div>

          <div>
            <dt className="text-sm font-medium text-slate-500">Merchant Keys</dt>
            <dd className="mt-1 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-700">Use Merchant Key</span>
                <button
                  onClick={handleToggleMerchantKey}
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    useMerchantKey ? 'bg-blue-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      useMerchantKey ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {useMerchantKey && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-700">Merchant OpenAI Key</span>
                    <span className="font-mono text-xs text-slate-500">
                      {hasMerchantOpenAIKey ? '********' : 'Not set'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-700">Merchant Perplexity Key</span>
                    <span className="font-mono text-xs text-slate-500">
                      {hasMerchantPerplexityKey ? '********' : 'Not set'}
                    </span>
                  </div>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          <strong>Note:</strong> LLM provider and API keys are configured via environment variables (
          <code className="rounded bg-amber-100 px-1">LLM_PROVIDER</code>,{' '}
          <code className="rounded bg-amber-100 px-1">OPENAI_API_KEY</code>, etc.). Changes require
          a server restart.
        </p>
      </div>
    </div>
  );
}

