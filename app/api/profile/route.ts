import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { TrainingPlan, Shoe } from '@/lib/types';

type AppData = { plan?: TrainingPlan; shoes?: Shoe[] };

function parseStored(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  // New format: { plan, shoes }
  if ('plan' in obj || 'shoes' in obj) {
    return { plan: obj.plan as TrainingPlan | undefined, shoes: obj.shoes as Shoe[] | undefined };
  }
  // Old format: raw TrainingPlan (has 'sessions')
  if ('sessions' in obj) return { plan: raw as TrainingPlan, shoes: [] };
  return {};
}

// GET /api/profile?userId=xxx
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  try {
    const row = await prisma.userData.findUnique({ where: { id: userId } });
    if (!row) return NextResponse.json({ plan: null, shoes: [] });
    const { plan, shoes } = parseStored(row.plan);
    return NextResponse.json({ plan: plan ?? null, shoes: shoes ?? [] });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'DB error';
    return NextResponse.json({ error }, { status: 500 });
  }
}

// POST /api/profile  { userId, plan?, shoes? }  — partial update, merges with existing
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { userId: string; plan?: TrainingPlan; shoes?: Shoe[] };
    const { userId, plan, shoes } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const existing = await prisma.userData.findUnique({ where: { id: userId } });
    const current = existing ? parseStored(existing.plan) : {};

    const merged: AppData = {
      plan: plan !== undefined ? plan : current.plan,
      shoes: shoes !== undefined ? shoes : (current.shoes ?? []),
    };

    await prisma.userData.upsert({
      where: { id: userId },
      update: { plan: merged as object },
      create: { id: userId, plan: merged as object },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'DB error';
    return NextResponse.json({ error }, { status: 500 });
  }
}
