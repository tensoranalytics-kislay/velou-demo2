import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require ADMIN or EDITOR role for creating merch rules
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
    const body = (await request.json()) as {
      ruleType: string;
      value: string;
      weight: number;
      isActive: boolean;
    };

    // Create merch rule with merchantId
    const created = await prisma.merchRule.create({
      data: {
        merchantId: session.merchantId,
        ruleType: body.ruleType as 'boost_category' | 'exclude_category' | 'hide_out_of_stock',
        value: body.value,
        weight: body.weight,
        isActive: body.isActive,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info('merch_rule_created', {
      userId: session.userId,
      merchantId: session.merchantId,
      ruleId: created.id,
    });

    return NextResponse.json(created);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('merch_rule_create_failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}

