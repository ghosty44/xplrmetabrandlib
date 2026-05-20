'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadGarminTokens, saveGarminTokens, GarminTokens } from '@/lib/store';
import { formatPace } from '@/lib/zones';

type GarminData = {
  profile: {
    displayName: string;
    fullName: string;
    location: string;
    profileImageUrlMedium: string;
    userLevel: number;
    userPoint: number;
    runningTrainingSpeed: number;
    showVO2Max: boolean;
  } | null;
  settings: {
    userData: {
      weight: number | null;
      height: number | null;
      vo2MaxRunning: number | null;
      lactateThresholdSpeed: number | null;
    };
  } | null;
  activities: Array<{
    activityId: number;
    activityName: string;
    startTimeLocal: string;
    activityType: { typeKey: string };
    distance: number;
    duration: number;
    calories: number;
    averageHR: number;
    maxHR: number;
    vO2MaxValue: number;
    averageSpeed: number;
    elevationGain: number;
    steps: number;
  }>;
  steps: number | null;
  sleep: {
    dailySleepDTO: {
      calendarDate: string;
      sleepTimeSeconds: number;
      deepSleepSeconds: number;
      lightSleepSeconds: number;
      remSleepSeconds: number;
      awakeSleepSeconds: number;
      awakeCount: number;
      restingHeartRate: number;
      avgSleepStress: number;
      sleepScores?: {
        overall?: { value: number; qualifierKey: string };
      };
    };
    avgOvernightHrv: number;
    bodyBatteryChange: number;
  } | null;
  heartRate: {
    maxHeartRate: number;
    minHeartRate: number;
    restingHeartRate: number;
    lastSevenDaysAvgRestingHeartRate: number;
  } | null;
  weight: {
    dateWeightList: Array<{
      calendarDate: string;
      weight: number;
      bmi: number | null;
      bodyFat: number | null;
      muscleMass: number | null;
    }>;
  } | null;
};

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtDistance(meters: number): string {
  return (meters / 1000).toFixed(2) + ' km';
}

function speedToPaceSec(mps: number): number {
  if (!mps || mps <= 0) return 0;
  return 1000 / mps;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function sleepHours(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h${m.toString().padStart(2, '0')}`;
}

function activityIcon(typeKey: string): string {
  if (typeKey.includes('running') || typeKey === 'street_running' || typeKey === 'trail_running') return '🏃';
  if (typeKey.includes('cycling')) return '🚴';
  if (typeKey.includes('swimming')) return '🏊';
  if (typeKey.includes('walking') || typeKey.includes('hiking')) return '🥾';
  return '⚡';
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[18px] bg-white border border-black/5 p-4">
      <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.12em] mb-1.5">{label}</p>
      <p className="text-[22px] font-black text-[#0F0F10] tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-[#8E8E93] mt-1">{sub}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[18px] bg-white border border-black/5 p-4 animate-pulse">
      <div className="h-2.5 bg-[#F2F2F7] rounded-full w-16 mb-3" />
      <div className="h-7 bg-[#F2F2F7] rounded-full w-20" />
    </div>
  );
}

export default function GarminDashboard() {
  const [data, setData] = useState<GarminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'activities' | 'sleep' | 'health'>('overview');

  useEffect(() => {
    const tokens = loadGarminTokens();
    if (!tokens) { setError('not_connected'); setLoading(false); return; }
    fetchData(tokens);
  }, []);

  async function fetchData(tokens: GarminTokens) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/garmin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garminTokens: tokens }),
      });
      const json = await res.json() as { success: boolean; data?: GarminData; refreshedTokens?: GarminTokens; error?: string };
      if (!json.success) {
        setError(json.error ?? 'Erreur inconnue');
      } else {
        if (json.refreshedTokens) saveGarminTokens(json.refreshedTokens);
        setData(json.data ?? null);
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  }

  const handleRefresh = () => {
    const tokens = loadGarminTokens();
    if (tokens) fetchData(tokens);
  };

  if (!loading && error === 'not_connected') {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-center px-4">
        <div className="w-16 h-16 rounded-[20px] bg-[#0F0F10] flex items-center justify-center text-[#C8E635] font-black text-2xl mb-4">G</div>
        <h2 className="text-[18px] font-black text-[#0F0F10] mb-1">Garmin non connecté</h2>
        <p className="text-[13px] text-[#8E8E93] mb-6 text-center">
          Connectez votre compte Garmin depuis les Paramètres.
        </p>
        <Link href="/settings" className="px-6 py-3 bg-[#0F0F10] text-white rounded-[14px] text-[13px] font-semibold">
          Aller aux Paramètres
        </Link>
      </div>
    );
  }

  const runningActivities = (data?.activities ?? []).filter(
    (a) => a.activityType?.typeKey?.includes('running') || a.activityType?.typeKey === 'street_running' || a.activityType?.typeKey === 'trail_running'
  );
  const latestWeight = data?.weight?.dateWeightList?.[data.weight.dateWeightList.length - 1] ?? null;
  const sleep = data?.sleep?.dailySleepDTO ?? null;
  const hr = data?.heartRate ?? null;
  const profile = data?.profile ?? null;
  const settings = data?.settings ?? null;

  const TAB_LABELS = { overview: 'Vue d\'ensemble', activities: 'Activités', sleep: 'Sommeil', health: 'Santé' };

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <header className="sticky top-0 z-10 bg-[#F2F2F7]/80 backdrop-blur-xl">
        <div className="max-w-md mx-auto px-4 pt-12 pb-3 flex items-center gap-3">
          <Link href="/" className="w-8 h-8 rounded-full bg-white border border-black/8 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <div className="flex-1">
            <h1 className="text-[17px] font-bold text-[#0F0F10]">Garmin Connect</h1>
            {profile && <p className="text-[11px] text-[#8E8E93]">{profile.fullName || profile.displayName}</p>}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="w-8 h-8 rounded-full bg-white border border-black/8 flex items-center justify-center disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="max-w-md mx-auto px-4 pb-3 flex gap-1.5 overflow-x-auto no-scrollbar">
          {(['overview', 'activities', 'sleep', 'health'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
                activeTab === tab ? 'bg-[#0F0F10] text-white' : 'bg-white border border-black/8 text-[#8E8E93]'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </header>

      {error && error !== 'not_connected' && (
        <div className="max-w-md mx-auto px-4 mb-3">
          <div className="rounded-[16px] bg-red-50 border border-red-100 p-4 text-[12px] text-red-600">{error}</div>
        </div>
      )}

      <main className="max-w-md mx-auto px-4 pb-12 space-y-3">

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <>
            {/* Profile hero */}
            {loading ? (
              <div className="rounded-[24px] bg-[#0F0F10] p-5 h-24 animate-pulse" />
            ) : profile ? (
              <div className="rounded-[24px] bg-[#0F0F10] overflow-hidden p-5 flex items-center gap-4 relative">
                <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-[#C8E635]/15 blur-3xl pointer-events-none" />
                {profile.profileImageUrlMedium ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.profileImageUrlMedium} alt={profile.fullName} className="w-12 h-12 rounded-full object-cover border-2 border-white/10 flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-2xl flex-shrink-0">👤</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-white truncate">{profile.fullName || profile.displayName}</p>
                  {profile.location && <p className="text-[11px] text-[#8E8E93]">{profile.location}</p>}
                  {profile.runningTrainingSpeed > 0 && (
                    <p className="text-[11px] text-[#8E8E93]">Allure : {formatPace(speedToPaceSec(profile.runningTrainingSpeed))}/km</p>
                  )}
                </div>
                {settings?.userData?.vo2MaxRunning && (
                  <div className="text-center flex-shrink-0">
                    <p className="text-[28px] font-black text-[#C8E635] tabular-nums leading-none">{settings.userData.vo2MaxRunning}</p>
                    <p className="text-[10px] text-[#8E8E93] mt-0.5">VO2max</p>
                  </div>
                )}
              </div>
            ) : null}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
                <>
                  <StatCard label="Pas aujourd'hui" value={data?.steps != null ? data.steps.toLocaleString('fr-FR') : '—'} sub="obj. 10 000" />
                  <StatCard label="FC repos" value={hr?.restingHeartRate ? `${hr.restingHeartRate}` : '—'} sub="bpm" />
                  <StatCard label="Sommeil" value={sleep ? sleepHours(sleep.sleepTimeSeconds) : '—'} sub={sleep?.sleepScores?.overall ? `Score ${sleep.sleepScores.overall.value}` : undefined} />
                  <StatCard label="HRV nuit" value={data?.sleep?.avgOvernightHrv ? `${Math.round(data.sleep.avgOvernightHrv)}` : '—'} sub="ms" />
                </>
              )}
            </div>

            {/* Last 3 activities */}
            <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#F2F2F7]">
                <p className="text-[13px] font-semibold text-[#0F0F10]">Dernières activités</p>
                <button onClick={() => setActiveTab('activities')} className="text-[11px] text-[#8E8E93]">Voir tout →</button>
              </div>
              {loading ? (
                <div className="divide-y divide-[#F2F2F7]">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="px-5 py-3.5 flex gap-3 animate-pulse">
                      <div className="w-9 h-9 rounded-[12px] bg-[#F2F2F7]" />
                      <div className="flex-1 space-y-2">
                        <div className="h-2.5 bg-[#F2F2F7] rounded-full w-32" />
                        <div className="h-2.5 bg-[#F2F2F7] rounded-full w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (data?.activities ?? []).length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-[#8E8E93]">Aucune activité récente</p>
              ) : (
                <div className="divide-y divide-[#F2F2F7]">
                  {(data?.activities ?? []).slice(0, 3).map((a) => {
                    const paceSec = speedToPaceSec(a.averageSpeed);
                    return (
                      <div key={a.activityId} className="px-5 py-3.5 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-[12px] bg-[#F2F2F7] flex items-center justify-center text-lg flex-shrink-0">
                          {activityIcon(a.activityType?.typeKey ?? '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[#0F0F10] truncate">{a.activityName}</p>
                          <p className="text-[11px] text-[#8E8E93]">{fmtDate(a.startTimeLocal)}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {a.distance > 0 && <p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{fmtDistance(a.distance)}</p>}
                          {paceSec > 0 && <p className="text-[11px] text-[#8E8E93]">{formatPace(paceSec)}/km</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ACTIVITIES */}
        {activeTab === 'activities' && (
          <>
            <p className="text-[12px] text-[#8E8E93] font-medium px-1">
              {(data?.activities ?? []).length} activités · {runningActivities.length} courses
            </p>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-[24px] bg-white border border-black/5 p-5 animate-pulse flex gap-3">
                  <div className="w-10 h-10 rounded-[14px] bg-[#F2F2F7]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-[#F2F2F7] rounded-full w-40" />
                    <div className="h-3 bg-[#F2F2F7] rounded-full w-56" />
                  </div>
                </div>
              ))
            ) : (data?.activities ?? []).length === 0 ? (
              <div className="text-center py-16">
                <p className="text-3xl mb-3">🏃</p>
                <p className="text-[13px] text-[#8E8E93]">Aucune activité récente</p>
              </div>
            ) : (
              (data?.activities ?? []).map((a) => {
                const paceSec = speedToPaceSec(a.averageSpeed);
                return (
                  <div key={a.activityId} className="rounded-[24px] bg-white border border-black/5 p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-10 h-10 rounded-[14px] bg-[#F2F2F7] flex items-center justify-center text-xl flex-shrink-0">
                        {activityIcon(a.activityType?.typeKey ?? '')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-[#0F0F10] truncate">{a.activityName}</p>
                        <p className="text-[11px] text-[#8E8E93]">
                          {new Date(a.startTimeLocal).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {a.distance > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">Distance</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{fmtDistance(a.distance)}</p></div>
                      )}
                      {a.duration > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">Durée</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{fmtDuration(a.duration)}</p></div>
                      )}
                      {paceSec > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">Allure</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{formatPace(paceSec)}/km</p></div>
                      )}
                      {a.averageHR > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">FC moy</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{a.averageHR}</p></div>
                      )}
                      {a.calories > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">Calories</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{a.calories}</p></div>
                      )}
                      {a.elevationGain > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">D+</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{Math.round(a.elevationGain)} m</p></div>
                      )}
                      {a.maxHR > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">FC max</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{a.maxHR}</p></div>
                      )}
                      {a.steps > 0 && (
                        <div><p className="text-[10px] text-[#8E8E93] mb-0.5">Foulées</p><p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">{a.steps.toLocaleString('fr-FR')}</p></div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* SLEEP */}
        {activeTab === 'sleep' && (
          <>
            {loading ? (
              <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
            ) : !sleep ? (
              <div className="text-center py-16">
                <p className="text-3xl mb-3">🌙</p>
                <p className="text-[13px] text-[#8E8E93]">Pas de données sommeil pour aujourd&apos;hui</p>
              </div>
            ) : (
              <>
                {/* Sleep hero */}
                <div className="rounded-[24px] bg-[#0F0F10] p-5 relative overflow-hidden">
                  <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
                  <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-3">Sommeil dernière nuit</p>
                  <div className="flex items-end gap-3 mb-4">
                    <span className="text-[56px] font-black text-white leading-none tabular-nums">{sleepHours(sleep.sleepTimeSeconds)}</span>
                    {sleep.sleepScores?.overall && (
                      <div className="mb-1">
                        <p className="text-[28px] font-black text-[#C8E635] tabular-nums leading-none">{sleep.sleepScores.overall.value}</p>
                        <p className="text-[10px] text-[#8E8E93]">score</p>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-[#8E8E93]">{sleep.awakeCount} réveil{sleep.awakeCount > 1 ? 's' : ''}</p>

                  {/* Sleep stage bar */}
                  <div className="mt-4">
                    {(() => {
                      const total = sleep.sleepTimeSeconds;
                      const stages = [
                        { label: 'Profond', sec: sleep.deepSleepSeconds, color: '#6366f1' },
                        { label: 'REM', sec: sleep.remSleepSeconds, color: '#8b5cf6' },
                        { label: 'Léger', sec: sleep.lightSleepSeconds, color: '#93c5fd' },
                        { label: 'Éveillé', sec: sleep.awakeSleepSeconds, color: '#374151' },
                      ];
                      return (
                        <>
                          <div className="flex h-2 rounded-full overflow-hidden gap-0.5 mb-3">
                            {stages.map((s) => s.sec > 0 && (
                              <div key={s.label} style={{ backgroundColor: s.color, flexBasis: `${(s.sec / total) * 100}%` }} />
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                            {stages.map((s) => s.sec > 0 && (
                              <div key={s.label} className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                                <span className="text-[11px] text-[#8E8E93]">{s.label} {sleepHours(s.sec)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="FC repos" value={sleep.restingHeartRate ? `${sleep.restingHeartRate}` : '—'} sub="bpm" />
                  <StatCard label="Stress sommeil" value={sleep.avgSleepStress ? String(Math.round(sleep.avgSleepStress)) : '—'} sub="score moyen" />
                  {data?.sleep?.bodyBatteryChange != null && (
                    <StatCard label="Batterie" value={`${data.sleep.bodyBatteryChange > 0 ? '+' : ''}${data.sleep.bodyBatteryChange}`} sub="variation" />
                  )}
                  {data?.sleep?.avgOvernightHrv != null && (
                    <StatCard label="HRV nuit" value={`${Math.round(data.sleep.avgOvernightHrv)}`} sub="ms" />
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* HEALTH */}
        {activeTab === 'health' && (
          <>
            {loading ? (
              <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
            ) : (
              <>
                {/* Steps */}
                <div className="rounded-[24px] bg-[#0F0F10] p-5 relative overflow-hidden">
                  <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full bg-[#C8E635]/15 blur-3xl pointer-events-none" />
                  <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-2">Activité quotidienne</p>
                  <p className="text-[52px] font-black text-white leading-none tabular-nums mb-1">
                    {data?.steps != null ? data.steps.toLocaleString('fr-FR') : '—'}
                  </p>
                  <p className="text-[11px] text-[#8E8E93] mb-4">pas aujourd&apos;hui</p>
                  {data?.steps != null && (
                    <div>
                      <div className="w-full bg-white/10 rounded-full h-1.5">
                        <div className="bg-[#C8E635] h-1.5 rounded-full" style={{ width: `${Math.min((data.steps / 10000) * 100, 100)}%` }} />
                      </div>
                      <p className="text-[11px] text-[#8E8E93] mt-1.5 text-right">{Math.round((data.steps / 10000) * 100)}% de l&apos;objectif</p>
                    </div>
                  )}
                </div>

                {/* Heart rate */}
                <div className="rounded-[24px] bg-white border border-black/5 p-5">
                  <p className="text-[13px] font-semibold text-[#0F0F10] mb-3">Fréquence cardiaque</p>
                  <div className="grid grid-cols-3 gap-2">
                    <StatCard label="FC repos" value={hr?.restingHeartRate ? `${hr.restingHeartRate}` : '—'} sub="bpm" />
                    <StatCard label="FC min" value={hr?.minHeartRate ? `${hr.minHeartRate}` : '—'} sub="bpm" />
                    <StatCard label="FC max" value={hr?.maxHeartRate ? `${hr.maxHeartRate}` : '—'} sub="bpm" />
                  </div>
                  {hr?.lastSevenDaysAvgRestingHeartRate && (
                    <p className="text-[11px] text-[#8E8E93] mt-3">Moy. 7 j : {hr.lastSevenDaysAvgRestingHeartRate} bpm</p>
                  )}
                </div>

                {/* Body */}
                {(settings?.userData || latestWeight) && (
                  <div className="rounded-[24px] bg-white border border-black/5 p-5">
                    <p className="text-[13px] font-semibold text-[#0F0F10] mb-3">Métriques corporelles</p>
                    <div className="grid grid-cols-2 gap-2">
                      {settings?.userData?.weight && <StatCard label="Poids" value={`${(settings.userData.weight / 1000).toFixed(1)}`} sub="kg" />}
                      {settings?.userData?.height && <StatCard label="Taille" value={`${settings.userData.height}`} sub="cm" />}
                      {latestWeight?.weight && <StatCard label="Dernier pesage" value={`${(latestWeight.weight / 1000).toFixed(1)}`} sub="kg" />}
                      {latestWeight?.bmi && <StatCard label="IMC" value={latestWeight.bmi.toFixed(1)} />}
                      {latestWeight?.bodyFat && <StatCard label="Masse grasse" value={`${latestWeight.bodyFat.toFixed(1)}`} sub="%" />}
                      {latestWeight?.muscleMass && <StatCard label="Masse musculaire" value={`${(latestWeight.muscleMass / 1000).toFixed(1)}`} sub="kg" />}
                    </div>
                  </div>
                )}

                {/* Performance */}
                {settings?.userData && (
                  <div className="rounded-[24px] bg-white border border-black/5 p-5">
                    <p className="text-[13px] font-semibold text-[#0F0F10] mb-3">Performance</p>
                    <div className="grid grid-cols-2 gap-2">
                      {settings.userData.vo2MaxRunning && <StatCard label="VO2max" value={String(settings.userData.vo2MaxRunning)} sub="ml/kg/min" />}
                      {settings.userData.lactateThresholdSpeed && (
                        <StatCard label="Vitesse seuil" value={formatPace(speedToPaceSec(settings.userData.lactateThresholdSpeed)) + '/km'} sub="seuil lactique" />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
