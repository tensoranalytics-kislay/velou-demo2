import { prisma } from '@/lib/db';
import MetricsDisplay from './MetricsDisplay';

async function getMetrics() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [eventsLast7d, eventsLast30d, recentEvents] = await Promise.all([
    prisma.conversationEvent.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.conversationEvent.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.conversationEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  // Last 7 days metrics
  const sessionsLast7d = new Set(eventsLast7d.map((e) => e.sessionId));
  const conversations7d = sessionsLast7d.size;
  const messages7d = eventsLast7d.length;
  const clickedSessions7d = new Set(
    eventsLast7d.filter((e) => e.clicked).map((e) => e.sessionId),
  ).size;
  const clickThroughRate7d =
    conversations7d === 0 ? 0 : (clickedSessions7d / conversations7d) * 100;
  const noExactMatch7d = eventsLast7d.filter((e) => !e.hadExactMatch).length;

  // Last 30 days metrics
  const sessionsLast30d = new Set(eventsLast30d.map((e) => e.sessionId));
  const conversations30d = sessionsLast30d.size;
  const messages30d = eventsLast30d.length;
  const clickedSessions30d = new Set(
    eventsLast30d.filter((e) => e.clicked).map((e) => e.sessionId),
  ).size;
  const clickThroughRate30d =
    conversations30d === 0 ? 0 : (clickedSessions30d / conversations30d) * 100;
  const noExactMatch30d = eventsLast30d.filter((e) => !e.hadExactMatch).length;

  return {
    last7Days: {
      conversations: conversations7d,
      messages: messages7d,
      clickThroughRate: clickThroughRate7d,
      noExactMatch: noExactMatch7d,
    },
    last30Days: {
      conversations: conversations30d,
      messages: messages30d,
      clickThroughRate: clickThroughRate30d,
      noExactMatch: noExactMatch30d,
    },
    recentEvents,
  };
}

export default async function MetricsPage() {
  const metrics = await getMetrics();

  return (
    <div className="max-w-6xl">
      <h2 className="mb-6 text-2xl font-semibold text-slate-900">Metrics</h2>
      <p className="mb-8 text-slate-600">
        Track conversation activity, engagement, and assistant performance.
      </p>
      <MetricsDisplay metrics={metrics} />
    </div>
  );
}

