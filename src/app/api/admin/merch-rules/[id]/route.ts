import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { isActive?: boolean };

    const updated = await prisma.merchRule.update({
      where: { id: Number(id) },
      data: { isActive: body.isActive },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update merch rule:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await prisma.merchRule.delete({ where: { id: Number(id) } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete merch rule:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

