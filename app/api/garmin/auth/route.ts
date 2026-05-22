import { NextRequest, NextResponse } from 'next/server';
import type { GarminTokens } from '@/lib/store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email et mot de passe requis' },
        { status: 400 }
      );
    }

    const { GarminConnect } = await import('garmin-connect');
    const client = new GarminConnect({ username: email, password });
    await client.login();
    const tokens = client.exportToken() as GarminTokens;

    // Get stable Garmin user ID (displayName from profile)
    let garminUserId: string | null = null;
    try {
      const profile = await client.getUserProfile() as { displayName?: string; profileId?: number };
      garminUserId = profile?.displayName ?? (profile?.profileId ? String(profile.profileId) : null);
    } catch { /* non-fatal */ }

    return NextResponse.json({ success: true, tokens, garminUserId });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
