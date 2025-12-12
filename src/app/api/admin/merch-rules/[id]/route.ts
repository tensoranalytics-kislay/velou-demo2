import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { logger } from '@/lib/telemetry/logger';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // SECURITY: Require ADMIN or EDITOR role for updating merch rules
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
    const { id } = await params;
    const body = (await request.json()) as { isActive?: boolean };

    // Verify rule belongs to user's merchant
    const rule = await prisma.merchRule.findUnique({
      where: { id: Number(id) },
    });

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Verify merchantId matches
    if (rule.merchantId !== session.merchantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await prisma.merchRule.update({
      where: { id: Number(id) },
      data: { isActive: body.isActive, updatedAt: new Date() },
    });

    logger.info('merch_rule_updated', {
      userId: session.userId,
      merchantId: session.merchantId,
      ruleId: updated.id,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('merch_rule_update_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // SECURITY: Require ADMIN or EDITOR role for deleting merch rules
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);

    const { id } = await params;

    // Verify rule belongs to user's merchant
    const rule = await prisma.merchRule.findUnique({
      where: { id: Number(id) },
    });

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Verify merchantId matches
    if (rule.merchantId !== session.merchantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.merchRule.delete({ where: { id: Number(id) } });

    logger.info('merch_rule_deleted', {
      userId: session.userId,
      merchantId: session.merchantId,
      ruleId: Number(id),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('merch_rule_delete_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

