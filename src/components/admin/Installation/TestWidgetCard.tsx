/**
 * Test Widget Card
 * 
 * Allows testing the widget on a preview page.
 */

'use client';

import { useState } from 'react';

interface TestWidgetCardProps {
  merchantId: string;
  apiKey: string;
}

export default function TestWidgetCard({ merchantId, apiKey }: TestWidgetCardProps) {
  const [testUrl, setTestUrl] = useState<string | null>(null);

  const handleOpenTestPage = () => {
    // Create a test page URL with the widget embedded
    const testPageUrl = `/admin/test-widget?merchantId=${merchantId}&apiKey=${apiKey}`;
    window.open(testPageUrl, '_blank', 'noopener,noreferrer');
    setTestUrl(testPageUrl);
  };

  const handleResetSession = () => {
    // Clear test session data
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`velou_session_${merchantId}`);
      localStorage.removeItem(`velou_${merchantId}_messages`);
    }
    alert('Test session reset. Refresh the test page to see changes.');
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">Test Widget</h3>
      <p className="text-sm text-slate-600 mb-6">
        Preview how the widget looks and behaves on your site. The test page shows the widget with your brand colors,
        logo, and greeting.
      </p>
      <div className="flex gap-3">
        <button
          onClick={handleOpenTestPage}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700"
        >
          Open Test Page
        </button>
        <button
          onClick={handleResetSession}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Reset Test Session
        </button>
      </div>
      {testUrl && (
        <p className="mt-4 text-xs text-slate-500">
          Test page opened in new tab. You can send test messages to verify the widget is working correctly.
        </p>
      )}
    </div>
  );
}


