import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/telemetry/logger';

/**
 * DELETE /api/admin/catalog/clear
 * 
 * Deletes all products from the database.
 * WARNING: This is a destructive operation that cannot be undone.
 * 
 * TODO: Add authentication middleware to restrict to admin users
 */
export async function DELETE() {
  try {
    logger.info('Starting catalog clear operation');

    // Delete all products
    const deleteResult = await prisma.product.deleteMany({});

    logger.info('Catalog clear complete', {
      deletedCount: deleteResult.count,
    });

    return NextResponse.json({
      success: true,
      deletedCount: deleteResult.count,
      message: `Successfully deleted ${deleteResult.count} products from the catalog.`,
    });
  } catch (error) {
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

