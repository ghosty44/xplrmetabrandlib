'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadPlan, markSessionCompleted, markSessionGarminSynced, loadGarminTokens, saveGarminTokens, loadUserId, GarminTokens } from '@/lib/store';
import { Session } from '@/lib/types';
import { getZoneConfig, formatPace } from '@/lib/zones';

// Intensity height for each zone (0..1)
const ZONE_INTENSITY: Record<string, number> = {
  Recup: 0.2,
  EF: 0.35,
  Neutre: 0.45,
  SSeuilVO2: 0.7,
  Seuil: 0.8,
  VO2max: 1.0,
};

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<import('@/lib/types').TrainingPlan | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const p = loadPlan();
    if (!p) {
      router.replace('/setup');
      return;
    }
    const found = p.sessions.find((s) => s.id === params.id);
    if (!found) {
      router.replace('/');
      return;
    }
    setPlan(p);
    setSession(found);
    setLoaded(true);
  }, [params.id, router]);

  function syncPlanToDB() {
    const updated = loadPlan();
    const userId = loadUserId();
    if (!updated || !userId) return;
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan: updated }),
    }).catch(() => {});
  }

  const handleComplete = () => {
    if (!session) return;
    markSessionCompleted(session.id);
    setSession((s) => s ? { ...s, completed: true } : s);
    syncPlanToDB();
  };

  const handleGarminSync = async () => {
    if (!session) return;

    const garminTokens = loadGarminTokens();
    if (!garminTokens) {
      setSyncResult({
        success: false,
        message: 'Connectez votre compte Garmin dans les Paramètres avant de synchroniser.',
      });
      return;
    }

    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/garmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, plan, garminTokens }),
      });
      const data = await res.json() as {
        success: boolean;
        workoutId?: string;
        refreshedTokens?: GarminTokens;
        error?: string;
      };
      if (data.success) {
        if (data.refreshedTokens) saveGarminTokens(data.refreshedTokens);
        markSessionGarminSynced(session.id);
        setSession((s) => s ? { ...s, garminSynced: true } : s);
        setSyncResult({ success: true, message: `Synchronisé ! ID: ${data.workoutId ?? 'OK'}` });
        syncPlanToDB();
      } else {
        setSyncResult({ success: false, message: data.error ?? 'Erreur inconnue' });
      }
    } catch {
      setSyncResult({ success: false, message: 'Erreur réseau' });
    } finally {
      setSyncing(false);
    }
  };

  if (!loaded || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  const totalMin = session.totalMin;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-gray-800 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-900 truncate">{session.name}</h1>
              {session.completed && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500 text-white text-xs font-bold flex-shrink-0">
                  ✓
                </span>
              )}
              {session.garminSynced && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                  G
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">Semaine {session.week} · {totalMin} min</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Session description */}
        {session.description && (
          <p className="text-sm text-gray-600 mb-5">{session.description}</p>
        )}

        {/* Interval chart */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Graphique des intervalles</h2>
          <div className="flex items-end gap-0.5 h-24">
            {session.steps.map((step, idx) => {
              const reps = step.reps ?? 1;
              const config = getZoneConfig(step.zone);
              const intensity = ZONE_INTENSITY[step.zone] ?? 0.5;
              const widthPct = (step.durationMin * reps) / totalMin;
              const heightPct = intensity;

              return (
                <div
                  key={idx}
                  className="rounded-t-sm flex-shrink-0"
                  style={{
                    backgroundColor: config.color,
                    width: `${widthPct * 100}%`,
                    height: `${heightPct * 100}%`,
                  }}
                  title={`${config.label} – ${step.durationMin * reps} min`}
                />
              );
            })}
          </div>

          {/* Zone legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {Array.from(new Set(session.steps.map((s) => s.zone))).map((zone) => {
              const cfg = getZoneConfig(zone);
              return (
                <div key={zone} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                  <span className="text-xs text-gray-600">{cfg.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Steps list */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-4">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Détail des étapes</h2>
          </div>
          {session.steps.map((step, idx) => {
            const config = getZoneConfig(step.zone);
            const reps = step.reps ?? 1;
            const effectiveDuration = step.durationMin * reps;

            return (
              <div key={idx} className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-50 last:border-0">
                <div
                  className="w-1 self-stretch rounded-full flex-shrink-0"
                  style={{ backgroundColor: config.color, minHeight: '36px' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-gray-800">{config.label}</span>
                    {step.isRecovery && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">récup</span>
                    )}
                    {reps > 1 && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                        ×{reps}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {reps > 1
                      ? `${reps}×${step.durationMin} min = ${effectiveDuration} min`
                      : `${effectiveDuration} min`}
                  </p>
                </div>
                {step.targetPace && (
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-800">
                      {formatPace(step.targetPace.minSec)}–{formatPace(step.targetPace.maxSec)}
                    </p>
                    <p className="text-xs text-gray-400">/km</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sync result */}
        {syncResult && (
          <div
            className={`rounded-xl p-3 mb-4 text-sm ${
              syncResult.success
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            <p>{syncResult.success ? '✓ ' : '✗ '}{syncResult.message}</p>
            {!syncResult.success && syncResult.message.includes('Paramètres') && (
              <Link href="/settings" className="inline-block mt-1 text-xs underline underline-offset-2">
                Aller aux Paramètres →
              </Link>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleGarminSync}
            disabled={syncing || !!session.garminSynced}
            className="flex-1 py-3 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {syncing
              ? 'Synchronisation...'
              : session.garminSynced
              ? '✓ Synchro Garmin'
              : 'Synchroniser Garmin'}
          </button>
          <button
            onClick={handleComplete}
            disabled={session.completed}
            className="flex-1 py-3 px-4 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 disabled:bg-green-600 transition-colors"
          >
            {session.completed ? '✓ Séance complétée' : 'Valider la séance'}
          </button>
        </div>
      </main>
    </div>
  );
}
