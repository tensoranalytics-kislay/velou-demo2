import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getDatasetContext } from '@/lib/catalog/getDatasetContext';

/**
 * GET /api/brand-info
 * Returns brand name and dataset context for UI components
 */
export async function GET() {
  try {
    const [merchant, datasetContext] = await Promise.all([
      prisma.merchant.findUnique({ where: { slug: 'default' } }),
      getDatasetContext(),
    ]);

    return NextResponse.json({
      brandName: merchant?.brandName || 'our store',
      vertical: datasetContext?.vertical,
    });
  } catch (error) {
    console.error('Error fetching brand info:', error);
    return NextResponse.json({
      brandName: 'our store',
      vertical: null,
    });
  }
}

