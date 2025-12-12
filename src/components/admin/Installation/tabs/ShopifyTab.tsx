/**
 * Shopify Installation Tab
 */

import StatusBadge from '../StatusBadge';

interface ShopifyTabProps {
  merchantName: string;
}

export default function ShopifyTab({ merchantName }: ShopifyTabProps) {
  // TODO: Check Shopify connection status from database
  const isConnected = false;
  const shopifyStore = null; // 'acme.myshopify.com';

  return (
    <div className="space-y-6">
      {/* Step 1: Install App */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 1: Install Velou App</h3>
          <p className="mt-1 text-sm text-slate-600">
            Install the Velou app from the Shopify App Store to automatically embed the widget in your store.
          </p>
        </div>
        <a
          href="https://apps.shopify.com/velou"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-[#95BF47] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#7FA03A]"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          Install from Shopify App Store
        </a>
        <p className="mt-3 text-sm text-slate-600">
          Click the button above, select your store, and authorize the Velou app. The widget will be automatically
          embedded in your Shopify store.
        </p>
      </div>

      {/* Step 2: Verify Installation */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Step 2: Verify Installation</h3>
          <p className="mt-1 text-sm text-slate-600">Check if Velou is connected to your Shopify store.</p>
        </div>
        <div className="flex items-center gap-4">
          {isConnected && shopifyStore ? (
            <>
              <StatusBadge status="connected" label="Connected" />
              <div>
                <p className="text-sm font-medium text-slate-900">Store: {shopifyStore}</p>
                <p className="text-xs text-slate-500">Widget is active on your store</p>
              </div>
            </>
          ) : (
            <>
              <StatusBadge status="disconnected" label="Not Connected" />
              <div>
                <p className="text-sm font-medium text-slate-900">No Shopify connection detected</p>
                <p className="text-xs text-slate-500">Install the app to connect your store</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Info Box */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-900">Shopify App Integration</p>
            <p className="mt-1 text-sm text-blue-700">
              The Shopify app automatically embeds the Velou widget in your store. No manual code installation required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


