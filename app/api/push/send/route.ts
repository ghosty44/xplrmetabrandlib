import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { prisma } from '@/lib/db';

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// POST /api/push/send  { userId, title, body, url? }
export async function POST(req: NextRequest) {
  try {
    const { userId, title, body, url } = await req.json() as {
      userId: string;
      title: string;
      body: string;
      url?: string;
    };

    const subId = `${userId}-push`;
    const row = await prisma.userData.findUnique({ where: { id: subId } });
    if (!row) return NextResponse.json({ error: 'No subscription found' }, { status: 404 });

    const subscription = row.plan as unknown as webpush.PushSubscription;
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url }));

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
