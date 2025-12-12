import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, createAuthErrorResponse } from '@/middleware/auth';
import { requireRoleForRequest } from '@/middleware/requireRole';
import { updateMerchantProfile } from '@/lib/services/MerchantService';

export async function PATCH(request: NextRequest) {
  try {
    // SECURITY: Require ADMIN or EDITOR role for updating merchant profile
    const session = await requireRoleForRequest(request, ['ADMIN', 'EDITOR']);
    const body = (await request.json()) as {
      brandName?: string;
      voiceInstructions?: string;
      toneFormal?: number;
      tonePlayful?: number;
      primaryColor?: string;
      accentColor?: string;
      useMerchantKey?: boolean;
      backgroundColor?: string;
      surfaceColor?: string;
      borderColor?: string;
      logoUrl?: string | null;
    };

    // Use MerchantService to update merchant profile
    const updated = await updateMerchantProfile(session.merchantId, {
      ...(body.brandName !== undefined && { brandName: body.brandName }),
      ...(body.voiceInstructions !== undefined && { voiceInstructions: body.voiceInstructions }),
      ...(body.toneFormal !== undefined && { toneFormal: body.toneFormal }),
      ...(body.tonePlayful !== undefined && { tonePlayful: body.tonePlayful }),
      ...(body.primaryColor !== undefined && { primaryColor: body.primaryColor }),
      ...(body.accentColor !== undefined && { accentColor: body.accentColor }),
      ...(body.useMerchantKey !== undefined && { useMerchantKey: body.useMerchantKey }),
      ...(body.backgroundColor !== undefined && { backgroundColor: body.backgroundColor }),
      ...(body.surfaceColor !== undefined && { surfaceColor: body.surfaceColor }),
      ...(body.borderColor !== undefined && { borderColor: body.borderColor }),
      ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return createAuthErrorResponse(error);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update' },
      { status: 500 }
    );
  }
}

