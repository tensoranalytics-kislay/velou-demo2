import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      brandName?: string;
      voiceInstructions?: string;
      toneFormal?: number;
      tonePlayful?: number;
      primaryColor?: string;
      accentColor?: string;
      useMerchantKey?: boolean;
    };

    const updated = await prisma.brandConfig.update({
      where: { id: 1 },
      data: {
        ...(body.brandName !== undefined && { brandName: body.brandName }),
        ...(body.voiceInstructions !== undefined && { voiceInstructions: body.voiceInstructions }),
        ...(body.toneFormal !== undefined && { toneFormal: body.toneFormal }),
        ...(body.tonePlayful !== undefined && { tonePlayful: body.tonePlayful }),
        ...(body.primaryColor !== undefined && { primaryColor: body.primaryColor }),
        ...(body.accentColor !== undefined && { accentColor: body.accentColor }),
        ...(body.useMerchantKey !== undefined && { useMerchantKey: body.useMerchantKey }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update brand config:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

