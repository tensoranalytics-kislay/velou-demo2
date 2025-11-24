'use client';

type Metrics = {
  last7Days: {
    conversations: number;
    messages: number;
    clickThroughRate: number;
    noExactMatch: number;
  };
  last30Days: {
    conversations: number;
    messages: number;
    clickThroughRate: number;
    noExactMatch: number;
  };
  recentEvents: Array<{
    id: string;
    sessionId: string;
    userQuery: string;
    assistantReplySnippet: string | null;
    productIds: string[];
    hadExactMatch: boolean;
    clicked: boolean;
    clickedProductId: string | null;
    createdAt: Date;
  }>;
};

const StatCard = ({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}) => (
  <div className="rounded-lg border border-slate-200 bg-white p-6">
    <dt className="text-sm font-medium text-slate-500">{label}</dt>
    <dd className="mt-2">
      <div className="text-3xl font-semibold text-slate-900">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-slate-500">{subtitle}</div>}
    </dd>
  </div>
);

export default function MetricsDisplay({ metrics }: { metrics: Metrics }) {

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-lg font-medium text-slate-900">Last 7 Days</h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Conversations" value={metrics.last7Days.conversations} />
          <StatCard label="Messages" value={metrics.last7Days.messages} />
          <StatCard
            label="Click-Through Rate"
            value={`${metrics.last7Days.clickThroughRate.toFixed(1)}%`}
          />
          <StatCard label="No Exact Match" value={metrics.last7Days.noExactMatch} />
        </dl>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-medium text-slate-900">Last 30 Days</h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Conversations" value={metrics.last30Days.conversations} />
          <StatCard label="Messages" value={metrics.last30Days.messages} />
          <StatCard
            label="Click-Through Rate"
            value={`${metrics.last30Days.clickThroughRate.toFixed(1)}%`}
          />
          <StatCard label="No Exact Match" value={metrics.last30Days.noExactMatch} />
        </dl>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-medium text-slate-900">Recent Events</h3>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Query
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Products
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Match
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Clicked
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {metrics.recentEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500">
                    No events yet.
                  </td>
                </tr>
              ) : (
                metrics.recentEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-6 py-4 text-sm text-slate-900">
                      <div className="max-w-xs truncate">{event.userQuery}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-900">{event.productIds.length}</td>
                    <td className="px-6 py-4 text-sm">
                      {event.hadExactMatch ? (
                        <span className="text-green-600">Yes</span>
                      ) : (
                        <span className="text-amber-600">No</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {event.clicked ? (
                        <span className="text-blue-600">Yes</span>
                      ) : (
                        <span className="text-slate-400">No</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

