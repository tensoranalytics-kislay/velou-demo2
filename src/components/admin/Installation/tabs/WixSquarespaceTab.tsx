/**
 * Wix / Squarespace Installation Tab
 */

'use client';

import CodeBlock from '../CodeBlock';

interface WixSquarespaceTabProps {
  apiKey: string;
  merchantId: string;
}

export default function WixSquarespaceTab({ apiKey, merchantId }: WixSquarespaceTabProps) {
  const installationScript = `<script src="https://cdn.velou.ai/widget.js"
  data-merchant-id="${merchantId}"
  data-api-key="${apiKey}"
  data-primary-color="#e11d48">
</script>`;

  return (
    <div className="space-y-6">
      {/* Step 1: Add Custom Code */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 1: Add Custom Code</h3>
          <p className="mt-1 text-sm text-slate-600">
            Copy the script below and add it to your Wix or Squarespace site.
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

      {/* Wix Instructions */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Wix Instructions</h3>
        </div>
        <ol className="space-y-3 text-sm text-slate-700">
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              1
            </span>
            <span>Go to <strong>Settings</strong> → <strong>Advanced</strong> → <strong>Custom Code</strong></span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              2
            </span>
            <span>Click <strong>Add Code</strong> → <strong>Add to Footer</strong></span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              3
            </span>
            <span>Paste the script code in the code box</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              4
            </span>
            <span>Click <strong>Apply</strong> and publish your site</span>
          </li>
        </ol>
      </div>

      {/* Squarespace Instructions */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Squarespace Instructions</h3>
        </div>
        <ol className="space-y-3 text-sm text-slate-700">
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              1
            </span>
            <span>Go to <strong>Settings</strong> → <strong>Advanced</strong> → <strong>Code Injection</strong></span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              2
            </span>
            <span>Find the <strong>Footer</strong> section</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              3
            </span>
            <span>Paste the script code in the footer code box</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-semibold">
              4
            </span>
            <span>Click <strong>Save</strong> and refresh your site</span>
          </li>
        </ol>
      </div>
    </div>
  );
}


