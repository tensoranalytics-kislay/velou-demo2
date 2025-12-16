import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

/**
 * POST /api/assistant/clear
 *
 * Clears server-side conversation artifacts for a given sessionId:
 * - ConversationState
 * - ConversationEvent
 *
 * This is used when the user presses “Clear chat” so the next query
 * starts with a truly fresh session (no lingering follow-up context).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const sessionId = body.sessionId;

    // Best-effort cleanup; do not fail the user if something goes wrong.
    const [stateResult, eventResult] = await Promise.allSettled([
      prisma.conversationState.deleteMany({ where: { sessionId } }),
      prisma.conversationEvent.deleteMany({ where: { sessionId } }),
    ]);

    logger.info('assistant_clear_session', {
      sessionId,
      stateDeleted:
        stateResult.status === 'fulfilled' ? stateResult.value.count : 'failed',
      eventsDeleted:
        eventResult.status === 'fulfilled' ? eventResult.value.count : 'failed',
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.warn('assistant_clear_session_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Return success so UI is not blocked; this endpoint is best-effort.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}


