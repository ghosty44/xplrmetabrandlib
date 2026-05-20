'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadPlan, savePlan, markSessionCompleted, markSessionGarminSynced, loadGarminTokens, saveGarminTokens, loadUserId, GarminTokens } from '@/lib/store';
import { Session, GpxPoint } from '@/lib/types';
import { getZoneConfig, formatPace, getZoneHRRange } from '@/lib/zones';

const RouteMap = dynamic(() => import('../RouteMapClient'), { ssr: false });
const RouteEditor = dynamic(() => import('../RouteEditorClient'), { ssr: false });

const ZONE_INTENSITY: Record<string, number> = {
  Recup: 0.2,
  EF: 0.35,
  Neutre: 0.45,
  SSeuilVO2: 0.7,
  Seuil: 0.8,
  VO2max: 1.0,
};

const DAY_LABELS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<import('@/lib/types').TrainingPlan | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showRouteEditor, setShowRouteEditor] = useState(false);

  useEffect(() => {
    const p = loadPlan();
    if (!p) { router.replace('/setup'); return; }
    const found = p.sessions.find((s) => s.id === params.id);
    if (!found) { router.replace('/'); return; }
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
      setSyncResult({ success: false, message: 'Connectez votre compte Garmin dans les Paramètres avant de synchroniser.' });
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
      const data = await res.json() as { success: boolean; workoutId?: string; scheduledDate?: string; refreshedTokens?: GarminTokens; error?: string };
      if (data.success) {
        if (data.refreshedTokens) saveGarminTokens(data.refreshedTokens);
        markSessionGarminSynced(session.id);
        setSession((s) => s ? { ...s, garminSynced: true } : s);
        const scheduleMsg = data.scheduledDate ? ` · Planifié le ${data.scheduledDate}` : '';
        setSyncResult({ success: true, message: `Synchronisé dans ton calendrier Garmin !${scheduleMsg}` });
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

  const handleSaveRoute = (coords: GpxPoint[], distanceKm: number) => {
    if (!session) return;
    const p = loadPlan();
    if (!p) return;
    p.sessions = p.sessions.map((s) =>
      s.id === session.id ? { ...s, gpxCoords: coords, gpxDistanceKm: distanceKm } : s
    );
    savePlan(p);
    setSession((s) => s ? { ...s, gpxCoords: coords, gpxDistanceKm: distanceKm } : s);
    setShowRouteEditor(false);
    const userId = loadUserId();
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan: p }),
    }).catch(() => {});
  };

  if (!loaded || !session) {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
      </div>
    );
  }

  const totalMin = session.totalMin;
  const uniqueZones = Array.from(new Set(session.steps.map((s) => s.zone)));

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#F2F2F7]/80 backdrop-blur-xl">
        <div className="max-w-md mx-auto px-4 pt-12 pb-3 flex items-center gap-3">
          <Link
            href="/"
            className="w-8 h-8 rounded-full bg-white border border-black/8 flex items-center justify-center flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-bold text-[#0F0F10] truncate">{session.name}</h1>
              {session.completed && (
                <div className="w-5 h-5 rounded-full bg-[#C8E635] flex items-center justify-center flex-shrink-0">
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4l2.5 2.5L9 1" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}
              {session.garminSynced && (
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[9px] font-bold">G</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-[#8E8E93]">
              {DAY_LABELS[session.day]} · Sem. {session.week} · {totalMin} min
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-32 space-y-3">
        {/* Description */}
        {session.description && (
          <div className="rounded-[20px] bg-white border border-black/5 px-5 py-4">
            <p className="text-[13px] text-[#8E8E93] leading-relaxed">{session.description}</p>
          </div>
        )}

        {/* Route map */}
        {session.gpxCoords && session.gpxCoords.length > 0 ? (
          <div>
            <RouteMap coords={session.gpxCoords} distanceKm={session.gpxDistanceKm} />
            <button
              onClick={() => setShowRouteEditor(true)}
              className="mt-2 w-full py-2 text-[12px] font-semibold text-[#8E8E93] text-center"
            >
              Modifier le tracé
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowRouteEditor(true)}
            className="w-full py-3.5 rounded-[20px] border border-dashed border-[#8E8E93]/40 text-[13px] font-semibold text-[#8E8E93] flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 11l19-9-9 19-2-8-8-2z"/>
            </svg>
            Tracer un itinéraire
          </button>
        )}

        {/* Route editor modal */}
        {showRouteEditor && (
          <RouteEditor
            initial={session.gpxCoords}
            onSave={handleSaveRoute}
            onClose={() => setShowRouteEditor(false)}
          />
        )}

        {/* Interval chart card */}
        <div className="rounded-[24px] bg-[#0F0F10] overflow-hidden p-5">
          <div className="absolute opacity-0 pointer-events-none" />
          <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-4">Graphique des intervalles</p>

          <div className="flex items-end gap-0.5 h-20 mb-4">
            {session.steps.map((step, idx) => {
              const reps = step.reps ?? 1;
              const config = getZoneConfig(step.zone);
              const intensity = ZONE_INTENSITY[step.zone] ?? 0.5;
              const widthPct = (step.durationMin * reps) / totalMin;
              return (
                <div
                  key={idx}
                  className="rounded-t-[4px] flex-shrink-0"
                  style={{
                    backgroundColor: config.color,
                    width: `${widthPct * 100}%`,
                    height: `${intensity * 100}%`,
                  }}
                  title={`${config.label} – ${step.durationMin * reps} min`}
                />
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            {uniqueZones.map((zone) => {
              const cfg = getZoneConfig(zone);
              return (
                <div key={zone} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                  <span className="text-[11px] text-[#8E8E93]">{cfg.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Steps list */}
        <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F2F2F7]">
            <p className="text-[13px] font-semibold text-[#0F0F10]">Détail des étapes</p>
          </div>
          {session.steps.map((step, idx) => {
            const config = getZoneConfig(step.zone);
            const reps = step.reps ?? 1;
            const effectiveDuration = step.durationMin * reps;
            return (
              <div key={idx} className="flex items-center gap-4 px-5 py-3.5 border-b border-[#F2F2F7]/80 last:border-0">
                <div
                  className="w-1 self-stretch rounded-full flex-shrink-0"
                  style={{ backgroundColor: config.color, minHeight: '36px' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-semibold text-[#0F0F10]">{config.label}</span>
                    {step.isRecovery && (
                      <span className="text-[10px] bg-[#F2F2F7] text-[#8E8E93] px-1.5 py-0.5 rounded-md font-medium">récup</span>
                    )}
                    {reps > 1 && (
                      <span className="text-[10px] bg-[#F2F2F7] text-[#0F0F10] px-1.5 py-0.5 rounded-md font-semibold">×{reps}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#8E8E93]">
                    {reps > 1 ? `${reps}×${step.durationMin} min = ${effectiveDuration} min` : `${effectiveDuration} min`}
                  </p>
                </div>
                {(() => {
                  const hrPct = getZoneHRRange(step.zone);
                  const maxHR = plan?.profile.maxHR;
                  const hrLabel = maxHR
                    ? `${Math.round(maxHR * hrPct.min / 100)}–${Math.round(maxHR * hrPct.max / 100)} bpm`
                    : `${hrPct.min}–${hrPct.max}% FCmax`;
                  return (
                    <div className="text-right flex-shrink-0">
                      {step.targetPace && (
                        <>
                          <p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">
                            {formatPace(step.targetPace.minSec)}–{formatPace(step.targetPace.maxSec)}
                          </p>
                          <p className="text-[10px] text-[#8E8E93]">/km</p>
                        </>
                      )}
                      <p className="text-[11px] font-semibold text-[#8E8E93] tabular-nums mt-0.5">{hrLabel}</p>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Sync result */}
        {syncResult && (
          <div className={`rounded-[20px] p-4 text-[13px] ${
            syncResult.success
              ? 'bg-[#C8E635]/15 border border-[#C8E635]/30 text-[#0F0F10]'
              : 'bg-red-50 border border-red-100 text-red-700'
          }`}>
            <p>{syncResult.success ? '✓ ' : '✗ '}{syncResult.message}</p>
            {!syncResult.success && syncResult.message.includes('Paramètres') && (
              <Link href="/settings" className="inline-block mt-1 text-[11px] text-[#8E8E93] underline underline-offset-2">
                Aller aux Paramètres →
              </Link>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleGarminSync}
            disabled={syncing || !!session.garminSynced}
            className="flex-1 py-3.5 px-4 rounded-[16px] bg-white border border-black/8 text-[13px] font-semibold text-[#0F0F10] disabled:opacity-40 transition-all active:scale-[0.97]"
          >
            {syncing ? 'Sync...' : session.garminSynced ? '✓ Garmin' : 'Sync Garmin'}
          </button>
          <button
            onClick={handleComplete}
            disabled={session.completed}
            className="flex-1 py-3.5 px-4 rounded-[16px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:bg-[#C8E635] disabled:text-[#0F0F10] transition-all active:scale-[0.97]"
          >
            {session.completed ? '✓ Complétée' : 'Valider la séance'}
          </button>
        </div>
      </main>
    </div>
  );
}
