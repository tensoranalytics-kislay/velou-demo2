/**
 * WordPress Installation Tab
 */

'use client';

import { useState } from 'react';
import CodeBlock from '../CodeBlock';
import StatusBadge from '../StatusBadge';

interface WordPressTabProps {
  apiKey: string;
  merchantName: string;
}

export default function WordPressTab({ apiKey, merchantName }: WordPressTabProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'failed'>('idle');

  const pluginCode = `// In WordPress admin:
// Plugins → Add New → Upload Plugin
// Choose file: velou-plugin.zip
// Activate`;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus('idle');

    // Simulate test (in production, this would make an actual API call)
    setTimeout(() => {
      setIsTesting(false);
      setTestStatus('success');
    }, 2000);
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Install Plugin */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 1: Install Velou Plugin</h3>
          <p className="mt-1 text-sm text-slate-600">
            Upload and activate the Velou plugin in your WordPress admin panel.
          </p>
        </div>
        <CodeBlock code={pluginCode} language="text" className="mb-4" />
        <div className="flex gap-3">
          <button
            onClick={() => {
              navigator.clipboard.writeText(pluginCode);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Copy Plugin Code
          </button>
          <button
            disabled
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-400 shadow-sm cursor-not-allowed"
          >
            Download Plugin ZIP
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Plugin download coming soon. For now, contact support@velou.ai for the plugin file.
        </p>
      </div>

      {/* Step 2: Configure API Key */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 2: Configure API Key</h3>
          <p className="mt-1 text-sm text-slate-600">
            Copy your API key and paste it into the WordPress plugin settings.
          </p>
        </div>
        <div className="space-y-3">
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
              Copy API Key
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Go to WordPress Admin → Settings → Velou → Paste API Key → Save
          </p>
        </div>
      </div>

      {/* Step 3: Test Installation */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 3: Test Installation</h3>
          <p className="mt-1 text-sm text-slate-600">Verify that the widget is working on your WordPress site.</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
          {testStatus === 'success' && <StatusBadge status="connected" label="Connected" />}
          {testStatus === 'failed' && <StatusBadge status="disconnected" label="Failed" />}
          {isTesting && <StatusBadge status="testing" label="Testing..." />}
        </div>
      </div>
    </div>
  );
}


