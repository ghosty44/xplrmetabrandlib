import { NextRequest, NextResponse } from 'next/server';
import type { GarminTokens } from '@/lib/store';

function dateOffset(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// Try a call, return { value } on success or { error } on failure
async function attempt<T>(label: string, fn: () => Promise<T>): Promise<{ value: T; error: null } | { value: null; error: string }> {
  try {
    const value = await fn();
    if (value == null) return { value: null, error: `${label}: returned null/undefined` };
    return { value, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { value: null, error: `${label}: ${msg}` };
  }
}

// Try multiple dated calls, return first non-null value + all errors for debug
async function firstWithFallback<T>(
  label: string,
  dates: Date[],
  fn: (d: Date) => Promise<T>,
): Promise<{ value: T | null; errors: string[] }> {
  const errors: string[] = [];
  for (const date of dates) {
    const dateStr = date.toISOString().slice(0, 10);
    const r = await attempt(`${label}(${dateStr})`, () => fn(date));
    if (r.value != null) return { value: r.value, errors };
    errors.push(r.error!);
  }
  return { value: null, errors };
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

    const today      = new Date();
    const yesterday  = dateOffset(today, -1);
    const twoDaysAgo = dateOffset(today, -2);

    // Parallel: profile + settings + activities (not date-sensitive)
    const [profileResult, settingsResult, activitiesResult] = await Promise.allSettled([
      client.getUserProfile(),
      client.getUserSettings(),
      client.getActivities(0, 20),
    ]);

    // Steps — today only (resets daily, fallback would give wrong count)
    const stepsResult = await attempt('steps', () => client.getSteps(today) as Promise<number>);

    // Date-sensitive health data with J-1 / J-2 fallback
    const sleepResult  = await firstWithFallback('sleep',     [today, yesterday, twoDaysAgo], d => client.getSleepData(d));
    const hrResult     = await firstWithFallback('heartRate', [today, yesterday],             d => client.getHeartRate(d));
    const weightResult = await firstWithFallback('weight',    [today, yesterday, twoDaysAgo], d => client.getDailyWeightData(d));

    // Log all errors to Vercel/server console for debugging
    const allErrors = [
      ...(stepsResult.error ? [stepsResult.error] : []),
      ...sleepResult.errors,
      ...hrResult.errors,
      ...weightResult.errors,
    ];
    if (allErrors.length > 0) {
      console.error('[garmin/data] partial failures:', allErrors);
    }

    const refreshedTokens = client.exportToken() as GarminTokens;

    // Gear (shoes)
    type GarminGearItem = {
      gearPk: number; gearTypeText: string; displayName: string;
      customMakeModel?: string; dateBegin: string; totalMeters: number; maximumMeters: number;
    };
    let gear: GarminGearItem[] = [];
    try {
      const profile = profileResult.status === 'fulfilled' ? profileResult.value as { displayName?: string } : null;
      if (profile?.displayName) {
        const gearUrl = `https://connectapi.garmin.com/gear-service/gear/filterGear?userDisplayName=${encodeURIComponent(profile.displayName)}&start=0&limit=100`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (client as any).client.get(gearUrl);
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
      // _debug: returned only in non-production for diagnosis
      ...(process.env.NODE_ENV !== 'production' && { _debug: { errors: allErrors } }),
      data: {
        profile:    profileResult.status === 'fulfilled' ? profileResult.value    : null,
        settings:   settingsResult.status === 'fulfilled' ? settingsResult.value   : null,
        activities: activitiesResult.status === 'fulfilled' ? activitiesResult.value : [],
        steps:      stepsResult.value,
        sleep:      sleepResult.value,
        heartRate:  hrResult.value,
        weight:     weightResult.value,
        shoes,
        // Always return health errors so the frontend can show a meaningful state
        _healthErrors: allErrors.length > 0 ? allErrors : undefined,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
