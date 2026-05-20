import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { TrainingPlan } from '@/lib/types';

// GET /api/profile?userId=xxx  → returns stored plan
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  try {
    const row = await prisma.userData.findUnique({ where: { id: userId } });
    if (!row) return NextResponse.json({ plan: null });
    return NextResponse.json({ plan: row.plan });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'DB error';
    return NextResponse.json({ error }, { status: 500 });
  }
}

// POST /api/profile  { userId, plan }  → upsert
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { userId: string; plan: TrainingPlan };
    const { userId, plan } = body;

    if (!userId || !plan) {
      return NextResponse.json({ error: 'userId and plan required' }, { status: 400 });
    }

    await prisma.userData.upsert({
      where: { id: userId },
      update: { plan: plan as object },
      create: { id: userId, plan: plan as object },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'DB error';
    return NextResponse.json({ error }, { status: 500 });
  }
}
