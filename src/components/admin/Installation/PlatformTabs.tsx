/**
 * PlatformTabs Component
 * 
 * Tabbed interface for different platform installation instructions.
 */

'use client';

import { useState } from 'react';
import ShopifyTab from './tabs/ShopifyTab';
import WordPressTab from './tabs/WordPressTab';
import CustomWebsiteTab from './tabs/CustomWebsiteTab';
import WixSquarespaceTab from './tabs/WixSquarespaceTab';

type Platform = 'shopify' | 'wordpress' | 'custom' | 'wix';

interface PlatformTabsProps {
  apiKey: string;
  merchantId: string;
  merchantName: string;
}

export default function PlatformTabs({ apiKey, merchantId, merchantName }: PlatformTabsProps) {
  const [activeTab, setActiveTab] = useState<Platform>('shopify');

  const tabs = [
    { id: 'shopify' as Platform, label: 'Shopify' },
    { id: 'wordpress' as Platform, label: 'WordPress' },
    { id: 'custom' as Platform, label: 'Custom Website' },
    { id: 'wix' as Platform, label: 'Wix / Squarespace' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium transition-colors
                ${
                  activeTab === tab.id
                    ? 'border-rose-500 text-rose-600'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'shopify' && <ShopifyTab merchantName={merchantName} />}
        {activeTab === 'wordpress' && <WordPressTab apiKey={apiKey} merchantName={merchantName} />}
        {activeTab === 'custom' && <CustomWebsiteTab apiKey={apiKey} merchantId={merchantId} />}
        {activeTab === 'wix' && <WixSquarespaceTab apiKey={apiKey} merchantId={merchantId} />}
      </div>
    </div>
  );
}


