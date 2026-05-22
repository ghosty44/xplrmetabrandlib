import { NextRequest, NextResponse } from 'next/server';
import type { GarminTokens } from '@/lib/store';

// Helper: date string offset by N days from a base date
function dateOffset(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// Try a fallible async call, return null on any error
async function tryCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    return result ?? null;
  } catch {
    return null;
  }
}

// Return the first non-null result across multiple attempts
async function firstResult<T>(...fns: Array<() => Promise<T | null>>): Promise<T | null> {
  for (const fn of fns) {
    const r = await tryCall(fn);
    if (r != null) return r;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { garminTokens?: GarminTokens };
    const { garminTokens } = body;

    if (!garminTokens) {
      return NextResponse.json({ success: false, error: 'Tokens Garmin manquants' }, { status: 401 });
    }

    const { GarminConnect } = await import('garmin-connect');
    const client = new GarminConnect({ username: '', password: '' });
    client.loadToken(garminTokens.oauth1, garminTokens.oauth2);

    const today     = new Date();
    const yesterday = dateOffset(today, -1);
    const twoDaysAgo = dateOffset(today, -2);

    // Profile + settings + activities: single best-effort fetch
    const [
      profileResult,
      settingsResult,
      activitiesResult,
    ] = await Promise.allSettled([
      client.getUserProfile(),
      client.getUserSettings(),
      client.getActivities(0, 20),
    ]);

    // Steps: today only (the SDK throws if no data — we handle it)
    const steps = await tryCall(() => client.getSteps(today) as Promise<number>);

    // Sleep: try today → yesterday → two days ago (sleep data lags by ~12h after waking)
    const sleep = await firstResult(
      () => client.getSleepData(today),
      () => client.getSleepData(yesterday),
      () => client.getSleepData(twoDaysAgo),
    );

    // Heart rate: try today → yesterday
    const heartRate = await firstResult(
      () => client.getHeartRate(today),
      () => client.getHeartRate(yesterday),
    );

    // Weight: try today → yesterday → two days ago
    const weight = await firstResult(
      () => client.getDailyWeightData(today),
      () => client.getDailyWeightData(yesterday),
      () => client.getDailyWeightData(twoDaysAgo),
    );

    const refreshedTokens = client.exportToken() as GarminTokens;

    // Gear (shoes) via internal HTTP client
    type GarminGearItem = {
      gearPk: number;
      gearTypeText: string;
      displayName: string;
      customMakeModel?: string;
      dateBegin: string;
      totalMeters: number;
      maximumMeters: number;
    };
    let gear: GarminGearItem[] = [];
    try {
      const profile = profileResult.status === 'fulfilled' ? profileResult.value as { displayName?: string } : null;
      const displayName = profile?.displayName;
      if (displayName) {
        const gearUrl = `https://connectapi.garmin.com/gear-service/gear/filterGear?userDisplayName=${encodeURIComponent(displayName)}&start=0&limit=100`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const httpClient = (client as any).client;
        const res = await httpClient.get(gearUrl);
        if (Array.isArray(res?.data)) gear = res.data;
        else if (Array.isArray(res)) gear = res;
      }
    } catch { /* gear not available */ }

    const shoes = gear.filter(g =>
      g.gearTypeText?.toUpperCase().includes('SHOE') ||
      g.gearTypeText?.toUpperCase().includes('RUNNING')
    );

    return NextResponse.json({
      success: true,
      refreshedTokens,
      data: {
        profile:    profileResult.status === 'fulfilled'    ? profileResult.value    : null,
        settings:   settingsResult.status === 'fulfilled'   ? settingsResult.value   : null,
        activities: activitiesResult.status === 'fulfilled' ? activitiesResult.value : [],
        steps,
        sleep,
        heartRate,
        weight,
        shoes,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
