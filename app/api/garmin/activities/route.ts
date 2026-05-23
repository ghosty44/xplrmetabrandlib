import { NextRequest, NextResponse } from 'next/server';
import type { GarminTokens } from '@/lib/store';

export const maxDuration = 60;

interface RawActivity {
  activityId?: number;
  startTimeLocal?: string;
  distance?: number;       // metres
  duration?: number;       // seconds
  averageSpeed?: number;   // m/s
  averageHR?: number;
  elevationGain?: number;
  activityType?: { typeKey?: string };
  vO2MaxValue?: number;    // ml/kg/min, computed by Garmin per activity
}

export interface RunActivity {
  date: string;          // YYYY-MM-DD
  distanceKm: number;
  durationMin: number;
  paceSecKm: number;     // seconds/km
  avgHR?: number;
  elevationGain?: number;
  isTrail: boolean;
}

export interface GarminActivitySummary {
  runs: RunActivity[];
  weeklyKm4w: number;   // average km/week over last 4 weeks
  weeklyKm8w: number;   // average km/week over last 8 weeks
  longestRunKm: number; // longest single run in last 8 weeks
  avgSessionsPerWeek: number;
  recentAvgPaceSecKm: number; // avg pace over last 10 runs
  vo2Max?: number;                   // ml/kg/min from Garmin user settings or recent activity
  lactateThresholdSpeedMps?: number; // m/s from Garmin user settings
  lactateThresholdHR?: number;       // bpm from Garmin user settings
}

function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week.toString().padStart(2, '0')}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { garminTokens?: GarminTokens };
    if (!body.garminTokens) {
      return NextResponse.json({ summary: null, error: 'Tokens Garmin manquants' });
    }

    const { GarminConnect } = await import('garmin-connect');
    const client = new GarminConnect({ username: '', password: '' });
    client.loadToken(body.garminTokens.oauth1, body.garminTokens.oauth2);

    let raw: RawActivity[] = [];
    try {
      raw = await client.getActivities(0, 60) as RawActivity[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Garmin';
      return NextResponse.json({ summary: null, error: msg });
    }

    const RUNNING_TYPES = ['running', 'trail_running', 'track_running', 'treadmill_running', 'indoor_running'];

    const runs: RunActivity[] = raw
      .filter(a => {
        const type = (a.activityType?.typeKey ?? '').toLowerCase();
        return RUNNING_TYPES.some(t => type.includes(t.replace('_', ''))) ||
               type.includes('running') || type.includes('trail');
      })
      .map(a => ({
        date: (a.startTimeLocal ?? '').slice(0, 10),
        distanceKm: Math.round((a.distance ?? 0) / 100) / 10,
        durationMin: Math.round((a.duration ?? 0) / 60),
        paceSecKm: a.averageSpeed && a.averageSpeed > 0
          ? Math.round(1000 / a.averageSpeed)
          : 0,
        avgHR: a.averageHR ?? undefined,
        elevationGain: a.elevationGain ? Math.round(a.elevationGain) : undefined,
        isTrail: (a.activityType?.typeKey ?? '').toLowerCase().includes('trail'),
      }))
      .filter(a => a.distanceKm > 0.5 && a.durationMin > 5 && a.date);

    if (!runs.length) {
      return NextResponse.json({ summary: null, error: 'Aucune sortie course trouvée' });
    }

    // Group by ISO week for stats
    const weekMap: Record<string, number> = {};
    const cutoff8w = new Date();
    cutoff8w.setDate(cutoff8w.getDate() - 56);
    const cutoff4w = new Date();
    cutoff4w.setDate(cutoff4w.getDate() - 28);

    for (const r of runs) {
      if (new Date(r.date) < cutoff8w) continue;
      const w = isoWeek(r.date);
      weekMap[w] = (weekMap[w] ?? 0) + r.distanceKm;
    }

    const weekKms = Object.values(weekMap);
    const weekKms4w = Object.entries(weekMap)
      .filter(([, v]) => { void v; return true; })
      .map(([, v]) => v);

    // Re-filter to 4w for separate average
    const weekMap4w: Record<string, number> = {};
    for (const r of runs) {
      if (new Date(r.date) < cutoff4w) continue;
      const w = isoWeek(r.date);
      weekMap4w[w] = (weekMap4w[w] ?? 0) + r.distanceKm;
    }
    const wkms4 = Object.values(weekMap4w);

    const weeklyKm8w = weekKms.length ? Math.round(weekKms.reduce((a, b) => a + b, 0) / 8) : 0;
    const weeklyKm4w = wkms4.length ? Math.round(wkms4.reduce((a, b) => a + b, 0) / 4) : 0;
    void weekKms4w;

    const recent8w = runs.filter(r => new Date(r.date) >= cutoff8w);
    const longestRunKm = recent8w.length ? Math.max(...recent8w.map(r => r.distanceKm)) : 0;
    const avgSessionsPerWeek = weekKms.length ? Math.round(recent8w.length / 8 * 10) / 10 : 0;

    const last10 = runs.slice(0, 10).filter(r => r.paceSecKm > 0);
    const recentAvgPaceSecKm = last10.length
      ? Math.round(last10.reduce((a, r) => a + r.paceSecKm, 0) / last10.length)
      : 0;

    // Fetch physiological metrics from Garmin user settings
    let vo2Max: number | undefined;
    let lactateThresholdSpeedMps: number | undefined;
    let lactateThresholdHR: number | undefined;
    try {
      const settings = await client.getUserSettings() as { userData?: Record<string, unknown> };
      const ud = settings?.userData;
      if (ud) {
        if (typeof ud.vo2MaxRunning === 'number' && ud.vo2MaxRunning > 0) vo2Max = ud.vo2MaxRunning;
        if (typeof ud.lactateThresholdSpeed === 'number' && ud.lactateThresholdSpeed > 0) lactateThresholdSpeedMps = ud.lactateThresholdSpeed;
        if (typeof ud.lactateThresholdHeartRate === 'number' && ud.lactateThresholdHeartRate > 0) lactateThresholdHR = ud.lactateThresholdHeartRate;
      }
    } catch { /* non-fatal: physiological data is optional */ }

    // Fallback VO2max: most recent non-zero vO2MaxValue from activities
    if (!vo2Max) {
      const withVO2 = raw.find(a => typeof a.vO2MaxValue === 'number' && a.vO2MaxValue > 10);
      if (withVO2?.vO2MaxValue) vo2Max = withVO2.vO2MaxValue;
    }

    const summary: GarminActivitySummary = {
      runs: runs.slice(0, 30),
      weeklyKm4w,
      weeklyKm8w,
      longestRunKm,
      avgSessionsPerWeek,
      recentAvgPaceSecKm,
      ...(vo2Max ? { vo2Max } : {}),
      ...(lactateThresholdSpeedMps ? { lactateThresholdSpeedMps } : {}),
      ...(lactateThresholdHR ? { lactateThresholdHR } : {}),
    };

    return NextResponse.json({ summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[garmin/activities]', msg);
    return NextResponse.json({ summary: null, error: msg });
  }
}
