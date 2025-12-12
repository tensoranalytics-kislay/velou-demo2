/**
 * Installation Status Card
 * 
 * Displays widget installation status and metrics.
 */

import StatusBadge from './StatusBadge';

interface InstallationStatusCardProps {
  lastDetected: string | null;
  health: 'connected' | 'degraded' | 'disconnected';
  metrics: {
    requestsLast24h: number;
    errorsLast24h: number;
    avgResponseTime: number;
  };
}

export default function InstallationStatusCard({
  lastDetected,
  health,
  metrics,
}: InstallationStatusCardProps) {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    } catch {
      return 'Invalid date';
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const errorRate = metrics.requestsLast24h > 0
    ? ((metrics.errorsLast24h / metrics.requestsLast24h) * 100).toFixed(2)
    : '0.00';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-6">Installation Status</h3>

      <div className="space-y-6">
        {/* Last Detected */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">Last Detected</p>
          <p className="text-sm text-slate-900">{formatDate(lastDetected)}</p>
        </div>

        {/* Widget Health */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Widget Health</p>
          <div className="flex items-center gap-3">
            {health === 'connected' && <StatusBadge status="connected" label="Connected" />}
            {health === 'degraded' && <StatusBadge status="degraded" label="Degraded" />}
            {health === 'disconnected' && <StatusBadge status="disconnected" label="Disconnected" />}
            <span className="text-xs text-slate-500">
              {health === 'connected' && 'Widget is active and responding normally'}
              {health === 'degraded' && 'Widget is active but experiencing some issues'}
              {health === 'disconnected' && 'Widget not detected. Check installation.'}
            </span>
          </div>
        </div>

        {/* Metrics */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-3">Metrics (Last 24 Hours)</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-semibold text-slate-900">{formatNumber(metrics.requestsLast24h)}</p>
              <p className="text-xs text-slate-500">Requests</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-slate-900">
                {metrics.errorsLast24h} <span className="text-sm text-slate-500">({errorRate}%)</span>
              </p>
              <p className="text-xs text-slate-500">Errors</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-slate-900">{metrics.avgResponseTime}ms</p>
              <p className="text-xs text-slate-500">Avg Response</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


