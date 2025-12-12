/**
 * Custom Website Installation Tab
 */

'use client';

import CodeBlock from '../CodeBlock';

interface CustomWebsiteTabProps {
  apiKey: string;
  merchantId: string;
}

export default function CustomWebsiteTab({ apiKey, merchantId }: CustomWebsiteTabProps) {
  const installationScript = `<script src="https://cdn.velou.ai/widget.js"
  data-merchant-id="${merchantId}"
  data-api-key="${apiKey}"
  data-primary-color="#e11d48">
</script>`;

  const advancedScript = `<script src="https://cdn.velou.ai/widget.js"
  data-merchant-id="${merchantId}"
  data-api-key="${apiKey}"
  data-primary-color="#e11d48"
  data-position="bottom-right"
  data-theme="light"
  data-initial-message="Hi! Can I help?">
</script>`;

  return (
    <div className="space-y-6">
      {/* Step 1: Copy Installation Script */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 1: Copy Installation Script</h3>
          <p className="mt-1 text-sm text-slate-600">
            Copy the script below and add it to your website HTML.
          </p>
        </div>
        <CodeBlock code={installationScript} language="html" />
        <button
          onClick={() => {
            navigator.clipboard.writeText(installationScript);
          }}
          className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700"
        >
          Copy Script
        </button>
      </div>

      {/* Step 2: Add to Website */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 2: Add to Your Website</h3>
          <p className="mt-1 text-sm text-slate-600">Follow these steps to add the widget to your site.</p>
        </div>
        <ol className="space-y-3 text-sm text-slate-700">
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              1
            </span>
            <span>Open your website HTML file (usually <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">index.html</code> or similar)</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              2
            </span>
            <span>Find the <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">&lt;/body&gt;</code> tag near the bottom of the file</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              3
            </span>
            <span>Paste the script tag <strong>before</strong> the <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">&lt;/body&gt;</code> tag</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              4
            </span>
            <span>Save the file and reload your website</span>
          </li>
        </ol>
      </div>

      {/* Step 3: Advanced Configuration */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 3: Advanced Configuration (Optional)</h3>
          <p className="mt-1 text-sm text-slate-600">
            Customize the widget appearance and behavior with these optional parameters.
          </p>
        </div>
        <div className="mb-4 space-y-2 text-sm">
          <div>
            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs">data-position</code>
            <span className="ml-2 text-slate-600">
              Widget position: <code className="text-slate-900">"bottom-right"</code>, <code className="text-slate-900">"bottom-left"</code>, or <code className="text-slate-900">"float"</code>
            </span>
          </div>
          <div>
            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs">data-theme</code>
            <span className="ml-2 text-slate-600">
              Color theme: <code className="text-slate-900">"light"</code>, <code className="text-slate-900">"dark"</code>, or <code className="text-slate-900">"auto"</code>
            </span>
          </div>
          <div>
            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs">data-initial-message</code>
            <span className="ml-2 text-slate-600">
              Custom greeting message (e.g., <code className="text-slate-900">"Hi! Can I help?"</code>)
            </span>
          </div>
        </div>
        <CodeBlock code={advancedScript} language="html" />
        <p className="mt-4 text-xs text-slate-500">
          <a href="https://docs.velou.ai/widget/configuration" target="_blank" rel="noopener noreferrer" className="text-rose-600 hover:text-rose-700 underline">
            View full documentation →
          </a>
        </p>
      </div>
    </div>
  );
}


