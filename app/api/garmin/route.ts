import { NextRequest, NextResponse } from 'next/server';
import { syncSessionToGarmin } from '@/lib/garmin';
import { TrainingPlan } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { sessionId: string; plan?: TrainingPlan };
    const { sessionId, plan } = body;

    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'sessionId is required' }, { status: 400 });
    }

    if (!plan) {
      return NextResponse.json(
        { success: false, error: 'Plan data must be provided in the request body' },
        { status: 400 }
      );
    }

    const session = plan.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const result = await syncSessionToGarmin(session, plan.profile);
    return NextResponse.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
