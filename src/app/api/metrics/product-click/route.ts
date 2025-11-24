import { NextResponse } from 'next/server';
import { recordProductClick } from '@/lib/telemetry/metrics';

type ProductClickRequest = {
  sessionId: string;
  productId: string;
};

export async function POST(request: Request) {
  const { sessionId, productId } = (await request.json()) as ProductClickRequest;

  await recordProductClick(sessionId, productId);

  return NextResponse.json({ status: 'recorded' });
}

