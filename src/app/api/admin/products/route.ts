import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';
import { getProducts } from '@/lib/services/CatalogService';

export async function GET(request: NextRequest) {
  try {
    // Require authentication (any authenticated user can view products)
    const session = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit')) || 10;

    // Use CatalogService to get products (automatically filters by merchantId)
    const products = await getProducts(session.merchantId, { limit });

    return NextResponse.json({
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

