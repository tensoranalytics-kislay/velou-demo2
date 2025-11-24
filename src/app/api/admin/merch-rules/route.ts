import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      ruleType: string;
      value: string;
      weight: number;
      isActive: boolean;
    };

    const created = await prisma.merchRule.create({
      data: {
        ruleType: body.ruleType as 'boost_category' | 'exclude_category' | 'hide_out_of_stock',
        value: body.value,
        weight: body.weight,
        isActive: body.isActive,
      },
    });

    return NextResponse.json(created);
  } catch (error) {
    console.error('Failed to create merch rule:', error);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}

