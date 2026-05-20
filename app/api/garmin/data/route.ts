import { NextRequest, NextResponse } from 'next/server';
import type { GarminTokens } from '@/lib/store';

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

    const today = new Date();

    const [
      profileResult,
      settingsResult,
      activitiesResult,
      stepsResult,
      sleepResult,
      heartRateResult,
      weightResult,
    ] = await Promise.allSettled([
      client.getUserProfile(),
      client.getUserSettings(),
      client.getActivities(0, 20),
      client.getSteps(today),
      client.getSleepData(today),
      client.getHeartRate(today),
      client.getDailyWeightData(today),
    ]);

    const refreshedTokens = client.exportToken() as GarminTokens;

    return NextResponse.json({
      success: true,
      refreshedTokens,
      data: {
        profile: profileResult.status === 'fulfilled' ? profileResult.value : null,
        settings: settingsResult.status === 'fulfilled' ? settingsResult.value : null,
        activities: activitiesResult.status === 'fulfilled' ? activitiesResult.value : [],
        steps: stepsResult.status === 'fulfilled' ? stepsResult.value : null,
        sleep: sleepResult.status === 'fulfilled' ? sleepResult.value : null,
        heartRate: heartRateResult.status === 'fulfilled' ? heartRateResult.value : null,
        weight: weightResult.status === 'fulfilled' ? weightResult.value : null,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
