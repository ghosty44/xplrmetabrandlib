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

    // Fetch gear (shoes) via authenticated internal HTTP client
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
    } catch { /* gear not available, ignore */ }

    const shoes = gear.filter(g =>
      g.gearTypeText?.toUpperCase().includes('SHOE') ||
      g.gearTypeText?.toUpperCase().includes('RUNNING')
    );

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
        shoes,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}
