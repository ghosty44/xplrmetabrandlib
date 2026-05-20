import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// POST /api/push/subscribe  { userId, subscription }
export async function POST(req: NextRequest) {
  try {
    const { userId, subscription } = await req.json() as {
      userId: string;
      subscription: PushSubscriptionJSON;
    };
    if (!userId || !subscription) {
      return NextResponse.json({ error: 'userId and subscription required' }, { status: 400 });
    }

    const subId = `${userId}-push`;
    await prisma.userData.upsert({
      where: { id: subId },
      update: { plan: subscription as object },
      create: { id: subId, plan: subscription as object },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
