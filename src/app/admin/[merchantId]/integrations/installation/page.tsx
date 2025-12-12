/**
 * Widget Installation Page
 * 
 * Admin page for merchants to install the Velou widget on their website.
 * Shows platform-specific instructions and API configuration.
 */

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PlatformTabs from '@/components/admin/Installation/PlatformTabs';
import ApiConfigCard from '@/components/admin/Installation/ApiConfigCard';
import InstallationStatusCard from '@/components/admin/Installation/InstallationStatusCard';
import TestWidgetCard from '@/components/admin/Installation/TestWidgetCard';
import TroubleshootingCard from '@/components/admin/Installation/TroubleshootingCard';

interface WidgetConfig {
  apiKey: string;
  apiKeyId: string;
  apiKeyName: string;
  allowedOrigins: Array<{
    origin: string;
    verified: boolean;
    verifiedAt: string | null;
  }>;
  lastDetected: string | null;
  health: 'connected' | 'degraded' | 'disconnected';
  metrics: {
    requestsLast24h: number;
    errorsLast24h: number;
    avgResponseTime: number;
  };
}

interface MerchantInfo {
  id: string;
  name: string;
  brandName: string;
}

export default function InstallationPage() {
  const params = useParams();
  const merchantId = params.merchantId as string;

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!merchantId) return;

    async function fetchData() {
      try {
        // Fetch widget config
        const configRes = await fetch(`/api/admin/${merchantId}/integrations/widget/config`, {
          credentials: 'include',
        });
        if (!configRes.ok) {
          throw new Error('Failed to load widget configuration');
        }
        const configData = await configRes.json();
        setConfig(configData);

        // Fetch merchant info
        const merchantRes = await fetch('/api/admin/auth/me', {
          credentials: 'include',
        });
        if (merchantRes.ok) {
          const merchantData = await merchantRes.json();
          if (merchantData.user) {
            setMerchant({
              id: merchantData.user.merchantId,
              name: merchantData.user.merchant?.name || 'Your Store',
              brandName: merchantData.user.merchant?.brandName || merchantData.user.merchant?.name || 'Your Store',
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [merchantId]);

  const handleRegenerateKey = async () => {
    try {
      const res = await fetch(`/api/admin/${merchantId}/integrations/widget/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKeyId: config?.apiKeyId }),
      });

      if (!res.ok) {
        throw new Error('Failed to regenerate API key');
      }

      const data = await res.json();
      setConfig((prev) => (prev ? { ...prev, apiKey: data.apiKey } : null));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to regenerate API key');
      throw err;
    }
  };

  const handleAddOrigin = async (origin: string) => {
    const res = await fetch(`/api/admin/${merchantId}/integrations/widget/origins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ origin, apiKeyId: config?.apiKeyId }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to add origin');
    }

    const data = await res.json();
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            allowedOrigins: [
              ...prev.allowedOrigins,
              { origin: data.origin, verified: false, verifiedAt: null },
            ],
          }
        : null
    );
  };

  const handleRemoveOrigin = async (origin: string) => {
    const res = await fetch(
      `/api/admin/${merchantId}/integrations/widget/origins?origin=${encodeURIComponent(origin)}&apiKeyId=${config?.apiKeyId || ''}`,
      {
        method: 'DELETE',
        credentials: 'include',
      }
    );

    if (!res.ok) {
      throw new Error('Failed to remove origin');
    }

    setConfig((prev) =>
      prev
        ? {
            ...prev,
            allowedOrigins: prev.allowedOrigins.filter((o) => o.origin !== origin),
          }
        : null
    );
  };

  const handleVerifyOrigin = async (origin: string) => {
    const res = await fetch(`/api/admin/${merchantId}/integrations/widget/origins/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ origin }),
    });

    if (!res.ok) {
      throw new Error('Failed to verify origin');
    }

    const data = await res.json();
    if (data.verified) {
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              allowedOrigins: prev.allowedOrigins.map((o) =>
                o.origin === origin ? { ...o, verified: true, verifiedAt: new Date().toISOString() } : o
              ),
            }
          : null
      );
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl">
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-rose-500 border-t-transparent"></div>
        </div>
      </div>
    );
  }

  if (error || !config || !merchant) {
    return (
      <div className="max-w-6xl">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error || 'Failed to load widget configuration'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">How to Add Velou to Your Site?</h1>
        <p className="mt-2 text-slate-600">Choose your platform below and follow the installation steps.</p>
      </div>

      {/* Platform Tabs */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <PlatformTabs apiKey={config.apiKey} merchantId={merchant.id} merchantName={merchant.name} />
      </div>

      {/* API Configuration & Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ApiConfigCard
          apiKey={config.apiKey}
          apiKeyId={config.apiKeyId}
          allowedOrigins={config.allowedOrigins}
          onRegenerate={handleRegenerateKey}
          onAddOrigin={handleAddOrigin}
          onRemoveOrigin={handleRemoveOrigin}
          onVerifyOrigin={handleVerifyOrigin}
        />
        <InstallationStatusCard
          lastDetected={config.lastDetected}
          health={config.health}
          metrics={config.metrics}
        />
      </div>

      {/* Test Widget */}
      <TestWidgetCard merchantId={merchant.id} apiKey={config.apiKey} />

      {/* Troubleshooting */}
      <TroubleshootingCard />
    </div>
  );
}

