import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/telemetry/logger';
import { requireAuth, requireRole, createAuthErrorResponse } from '@/middleware/auth';
import { prisma } from '@/lib/db';

/**
 * DELETE /api/admin/catalog/clear
 * 
 * Deletes all products from the database.
 * WARNING: This is a destructive operation that cannot be undone.
 * 
 * Requires ADMIN role (only admins can clear catalog)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Require authentication first
    const session = await requireAuth(request);
    
    // Require ADMIN role for destructive operations
    await requireRole(request, session.merchantId, ['ADMIN']);
    logger.info('Starting catalog clear operation', {
      userId: session.userId,
      merchantId: session.merchantId,
    });

    // Delete all products for this merchant
    const deleteResult = await prisma.product.deleteMany({
      where: { merchantId: session.merchantId },
    });

    logger.info('Catalog clear complete', {
      deletedCount: deleteResult.count,
    });

    return NextResponse.json({
      success: true,
      deletedCount: deleteResult.count,
      message: `Successfully deleted ${deleteResult.count} products from the catalog.`,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    logger.error('Catalog clear failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        error: 'Failed to clear catalog',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

