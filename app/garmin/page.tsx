'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadGarminTokens, saveGarminTokens, GarminTokens } from '@/lib/store';
import { formatPace } from '@/lib/zones';

// ── Types ──────────────────────────────────────────────────────────────────

type GarminData = {
  profile: {
    displayName: string;
    fullName: string;
    location: string;
    profileImageUrlMedium: string;
    userLevel: number;
    userPoint: number;
    runningTrainingSpeed: number; // m/s → convert to pace
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
    distance: number;       // m
    duration: number;       // s
    calories: number;
    averageHR: number;
    maxHR: number;
    vO2MaxValue: number;
    averageSpeed: number;   // m/s
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
      weight: number; // grams
      bmi: number | null;
      bodyFat: number | null;
      muscleMass: number | null;
    }>;
  } | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  return 1000 / mps; // sec/km
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

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color = 'gray',
}: { label: string; value: string; sub?: string; color?: 'gray' | 'blue' | 'green' | 'red' | 'orange' }) {
  const colors = {
    gray: 'bg-white border-gray-200',
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    orange: 'bg-orange-50 border-orange-200',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-gray-100 p-4 bg-white animate-pulse">
      <div className="h-3 bg-gray-100 rounded w-16 mb-3" />
      <div className="h-8 bg-gray-100 rounded w-24" />
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function GarminDashboard() {
  const [data, setData] = useState<GarminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'activities' | 'sleep' | 'health'>('overview');

  useEffect(() => {
    const tokens = loadGarminTokens();
    if (!tokens) {
      setError('not_connected');
      setLoading(false);
      return;
    }
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
      const json = await res.json() as {
        success: boolean;
        data?: GarminData;
        refreshedTokens?: GarminTokens;
        error?: string;
      };
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

  // ── Not connected ──
  if (!loading && error === 'not_connected') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="text-4xl mb-4">📡</div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Compte Garmin non connecté</h2>
        <p className="text-sm text-gray-500 mb-6 text-center">
          Connectez votre compte Garmin depuis les Paramètres pour voir vos données.
        </p>
        <Link
          href="/settings"
          className="px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors"
        >
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

  // ── Tabs ──

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-600 text-sm"
          >
            ←
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-900">Garmin Connect</h1>
            {profile && (
              <p className="text-xs text-gray-500">{profile.fullName || profile.displayName}</p>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-40"
            title="Actualiser"
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={loading ? 'animate-spin' : ''}
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-4xl mx-auto px-4 flex gap-1 pb-3 overflow-x-auto">
          {(['overview', 'activities', 'sleep', 'health'] as const).map((tab) => {
            const labels = { overview: 'Vue d\'ensemble', activities: 'Activités', sleep: 'Sommeil', health: 'Santé' };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>
      </header>

      {/* Error (non-auth) */}
      {error && error !== 'not_connected' && (
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-5 pb-12">

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Profile card */}
            {loading ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse flex gap-4">
                <div className="w-14 h-14 rounded-full bg-gray-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-32" />
                  <div className="h-3 bg-gray-100 rounded w-20" />
                </div>
              </div>
            ) : profile ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
                {profile.profileImageUrlMedium ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.profileImageUrlMedium}
                    alt={profile.fullName}
                    className="w-14 h-14 rounded-full object-cover border border-gray-100"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-2xl">
                    👤
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-gray-900 truncate">
                    {profile.fullName || profile.displayName}
                  </h2>
                  {profile.location && (
                    <p className="text-xs text-gray-500">{profile.location}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-500">Niveau {profile.userLevel}</span>
                    {profile.runningTrainingSpeed > 0 && (
                      <span className="text-xs text-gray-500">
                        Allure entraînement : {formatPace(speedToPaceSec(profile.runningTrainingSpeed))}/km
                      </span>
                    )}
                  </div>
                </div>
                {settings?.userData?.vo2MaxRunning && (
                  <div className="text-center flex-shrink-0">
                    <p className="text-2xl font-bold text-blue-600">{settings.userData.vo2MaxRunning}</p>
                    <p className="text-xs text-gray-500">VO2max</p>
                  </div>
                )}
              </div>
            ) : null}

            {/* Key stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
              ) : (
                <>
                  <StatCard
                    label="Pas aujourd'hui"
                    value={data?.steps != null ? data.steps.toLocaleString('fr-FR') : '—'}
                    sub="objectif 10 000"
                    color="green"
                  />
                  <StatCard
                    label="FC repos"
                    value={hr?.restingHeartRate ? `${hr.restingHeartRate} bpm` : '—'}
                    sub={hr?.lastSevenDaysAvgRestingHeartRate ? `moy 7j : ${hr.lastSevenDaysAvgRestingHeartRate} bpm` : undefined}
                    color="red"
                  />
                  <StatCard
                    label="Sommeil"
                    value={sleep ? sleepHours(sleep.sleepTimeSeconds) : '—'}
                    sub={sleep?.sleepScores?.overall ? `Score ${sleep.sleepScores.overall.value}` : undefined}
                    color="blue"
                  />
                  <StatCard
                    label="HRV nuit"
                    value={data?.sleep?.avgOvernightHrv ? `${Math.round(data.sleep.avgOvernightHrv)} ms` : '—'}
                    sub={data?.sleep?.bodyBatteryChange != null
                      ? `Batterie ${data.sleep.bodyBatteryChange > 0 ? '+' : ''}${data.sleep.bodyBatteryChange}`
                      : undefined}
                    color="orange"
                  />
                </>
              )}
            </div>

            {/* Last 3 activities */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-800">Dernières activités</h2>
                <button onClick={() => setActiveTab('activities')} className="text-xs text-gray-400 hover:text-gray-600">
                  Voir tout →
                </button>
              </div>
              {loading ? (
                <div className="divide-y divide-gray-50">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="px-5 py-3 flex gap-4 animate-pulse">
                      <div className="w-8 h-8 rounded-lg bg-gray-100" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 bg-gray-100 rounded w-32" />
                        <div className="h-3 bg-gray-100 rounded w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (data?.activities ?? []).length === 0 ? (
                <p className="px-5 py-4 text-sm text-gray-400">Aucune activité récente</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {(data?.activities ?? []).slice(0, 3).map((a) => {
                    const paceSec = speedToPaceSec(a.averageSpeed);
                    return (
                      <div key={a.activityId} className="px-5 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-lg flex-shrink-0">
                          {activityIcon(a.activityType?.typeKey ?? '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{a.activityName}</p>
                          <p className="text-xs text-gray-400">{fmtDate(a.startTimeLocal)}</p>
                        </div>
                        <div className="text-right flex-shrink-0 space-y-0.5">
                          {a.distance > 0 && (
                            <p className="text-sm font-semibold text-gray-800">{fmtDistance(a.distance)}</p>
                          )}
                          {paceSec > 0 && (
                            <p className="text-xs text-gray-500">{formatPace(paceSec)}/km</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ACTIVITIES TAB ── */}
        {activeTab === 'activities' && (
          <div className="space-y-3">
            <div className="flex gap-2 text-xs text-gray-500 font-medium px-1">
              <span>{(data?.activities ?? []).length} activités récentes</span>
              {runningActivities.length > 0 && (
                <span>· {runningActivities.length} courses</span>
              )}
            </div>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 animate-pulse flex gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-40" />
                    <div className="h-3 bg-gray-100 rounded w-60" />
                  </div>
                </div>
              ))
            ) : (data?.activities ?? []).length === 0 ? (
              <div className="text-center py-12">
                <p className="text-3xl mb-3">🏃</p>
                <p className="text-sm text-gray-500">Aucune activité récente</p>
              </div>
            ) : (
              (data?.activities ?? []).map((a) => {
                const paceSec = speedToPaceSec(a.averageSpeed);
                return (
                  <div key={a.activityId} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">
                        {activityIcon(a.activityType?.typeKey ?? '')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{a.activityName}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(a.startTimeLocal).toLocaleDateString('fr-FR', {
                            weekday: 'long', day: 'numeric', month: 'long',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {a.distance > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">Distance</p>
                          <p className="text-sm font-semibold text-gray-800">{fmtDistance(a.distance)}</p>
                        </div>
                      )}
                      {a.duration > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">Durée</p>
                          <p className="text-sm font-semibold text-gray-800">{fmtDuration(a.duration)}</p>
                        </div>
                      )}
                      {paceSec > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">Allure moy.</p>
                          <p className="text-sm font-semibold text-gray-800">{formatPace(paceSec)}/km</p>
                        </div>
                      )}
                      {a.averageHR > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">FC moy.</p>
                          <p className="text-sm font-semibold text-gray-800">{a.averageHR} bpm</p>
                        </div>
                      )}
                      {a.calories > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">Calories</p>
                          <p className="text-sm font-semibold text-gray-800">{a.calories} kcal</p>
                        </div>
                      )}
                      {a.elevationGain > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">D+</p>
                          <p className="text-sm font-semibold text-gray-800">{Math.round(a.elevationGain)} m</p>
                        </div>
                      )}
                      {a.maxHR > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">FC max</p>
                          <p className="text-sm font-semibold text-gray-800">{a.maxHR} bpm</p>
                        </div>
                      )}
                      {a.steps > 0 && (
                        <div>
                          <p className="text-xs text-gray-400">Foulées</p>
                          <p className="text-sm font-semibold text-gray-800">{a.steps.toLocaleString('fr-FR')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── SLEEP TAB ── */}
        {activeTab === 'sleep' && (
          <div className="space-y-4">
            {loading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : !sleep ? (
              <div className="text-center py-12">
                <p className="text-3xl mb-3">🌙</p>
                <p className="text-sm text-gray-500">Pas de données sommeil pour aujourd&apos;hui</p>
              </div>
            ) : (
              <>
                {/* Sleep score */}
                {sleep.sleepScores?.overall && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex items-center gap-5">
                    <div className="text-center">
                      <p className="text-5xl font-bold text-blue-700">{sleep.sleepScores.overall.value}</p>
                      <p className="text-xs text-blue-500 mt-1 font-medium uppercase tracking-wide">
                        {sleep.sleepScores.overall.qualifierKey}
                      </p>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-blue-900 mb-1">Score sommeil</p>
                      <p className="text-xs text-blue-700">
                        {sleepHours(sleep.sleepTimeSeconds)} de sommeil · {sleep.awakeCount} réveils
                      </p>
                      {data?.sleep?.avgOvernightHrv != null && (
                        <p className="text-xs text-blue-700 mt-0.5">
                          HRV nocturne : {Math.round(data.sleep.avgOvernightHrv)} ms
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Sleep stages */}
                <div className="bg-white rounded-2xl border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-800 mb-4">Phases de sommeil</h2>
                  {(() => {
                    const total = sleep.sleepTimeSeconds;
                    const stages = [
                      { label: 'Profond', sec: sleep.deepSleepSeconds, color: '#1e40af' },
                      { label: 'REM', sec: sleep.remSleepSeconds, color: '#6366f1' },
                      { label: 'Léger', sec: sleep.lightSleepSeconds, color: '#93c5fd' },
                      { label: 'Éveillé', sec: sleep.awakeSleepSeconds, color: '#e5e7eb' },
                    ];
                    return (
                      <>
                        {/* Bar */}
                        <div className="flex h-4 rounded-full overflow-hidden mb-4">
                          {stages.map((s) => s.sec > 0 && (
                            <div
                              key={s.label}
                              style={{ backgroundColor: s.color, flexBasis: `${(s.sec / total) * 100}%` }}
                              title={`${s.label} : ${sleepHours(s.sec)}`}
                            />
                          ))}
                        </div>
                        {/* Legend */}
                        <div className="grid grid-cols-2 gap-3">
                          {stages.map((s) => (
                            <div key={s.label} className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                              <div>
                                <p className="text-xs font-medium text-gray-700">{s.label}</p>
                                <p className="text-xs text-gray-500">
                                  {sleepHours(s.sec)} · {Math.round((s.sec / total) * 100)}%
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label="FC au repos"
                    value={sleep.restingHeartRate ? `${sleep.restingHeartRate} bpm` : '—'}
                    color="red"
                  />
                  <StatCard
                    label="Stress sommeil"
                    value={sleep.avgSleepStress ? String(Math.round(sleep.avgSleepStress)) : '—'}
                    sub="score moyen"
                    color="orange"
                  />
                  {data?.sleep?.bodyBatteryChange != null && (
                    <StatCard
                      label="Batterie corporelle"
                      value={`${data.sleep.bodyBatteryChange > 0 ? '+' : ''}${data.sleep.bodyBatteryChange}`}
                      sub="variation pendant le sommeil"
                      color="green"
                    />
                  )}
                  {data?.sleep?.avgOvernightHrv != null && (
                    <StatCard
                      label="HRV nuit"
                      value={`${Math.round(data.sleep.avgOvernightHrv)} ms`}
                      sub="variabilité cardiaque"
                      color="blue"
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── HEALTH TAB ── */}
        {activeTab === 'health' && (
          <div className="space-y-4">
            {loading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : (
              <>
                {/* Heart rate */}
                <div className="bg-white rounded-2xl border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-800 mb-3">Fréquence cardiaque</h2>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard label="FC repos" value={hr?.restingHeartRate ? `${hr.restingHeartRate}` : '—'} sub="bpm" color="red" />
                    <StatCard label="FC min" value={hr?.minHeartRate ? `${hr.minHeartRate}` : '—'} sub="bpm" />
                    <StatCard label="FC max" value={hr?.maxHeartRate ? `${hr.maxHeartRate}` : '—'} sub="bpm" />
                  </div>
                  {hr?.lastSevenDaysAvgRestingHeartRate && (
                    <p className="text-xs text-gray-400 mt-3">
                      Moy. 7 derniers jours : {hr.lastSevenDaysAvgRestingHeartRate} bpm au repos
                    </p>
                  )}
                </div>

                {/* Body metrics */}
                {(settings?.userData || latestWeight) && (
                  <div className="bg-white rounded-2xl border border-gray-200 p-5">
                    <h2 className="text-sm font-semibold text-gray-800 mb-3">Métriques corporelles</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {settings?.userData?.weight && (
                        <StatCard
                          label="Poids"
                          value={`${(settings.userData.weight / 1000).toFixed(1)} kg`}
                          color="gray"
                        />
                      )}
                      {settings?.userData?.height && (
                        <StatCard
                          label="Taille"
                          value={`${settings.userData.height} cm`}
                          color="gray"
                        />
                      )}
                      {latestWeight?.weight && (
                        <StatCard
                          label="Dernier pesage"
                          value={`${(latestWeight.weight / 1000).toFixed(1)} kg`}
                          sub={latestWeight.calendarDate}
                          color="gray"
                        />
                      )}
                      {latestWeight?.bmi && (
                        <StatCard label="IMC" value={latestWeight.bmi.toFixed(1)} color="gray" />
                      )}
                      {latestWeight?.bodyFat && (
                        <StatCard label="Masse grasse" value={`${latestWeight.bodyFat.toFixed(1)} %`} color="gray" />
                      )}
                      {latestWeight?.muscleMass && (
                        <StatCard
                          label="Masse musculaire"
                          value={`${(latestWeight.muscleMass / 1000).toFixed(1)} kg`}
                          color="gray"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Performance */}
                {settings?.userData && (
                  <div className="bg-white rounded-2xl border border-gray-200 p-5">
                    <h2 className="text-sm font-semibold text-gray-800 mb-3">Performance</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {settings.userData.vo2MaxRunning && (
                        <StatCard
                          label="VO2max course"
                          value={String(settings.userData.vo2MaxRunning)}
                          sub="ml/kg/min"
                          color="blue"
                        />
                      )}
                      {settings.userData.lactateThresholdSpeed && (
                        <StatCard
                          label="Vitesse seuil"
                          value={formatPace(speedToPaceSec(settings.userData.lactateThresholdSpeed)) + '/km'}
                          sub="allure seuil lactique"
                          color="orange"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Steps */}
                <div className="bg-white rounded-2xl border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-800 mb-3">Activité quotidienne</h2>
                  <div className="flex items-end gap-3">
                    <div>
                      <p className="text-4xl font-bold text-gray-900">
                        {data?.steps != null ? data.steps.toLocaleString('fr-FR') : '—'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">pas aujourd&apos;hui</p>
                    </div>
                    {data?.steps != null && (
                      <div className="flex-1 mb-1">
                        <div className="w-full bg-gray-100 rounded-full h-2.5">
                          <div
                            className="bg-green-500 h-2.5 rounded-full transition-all"
                            style={{ width: `${Math.min((data.steps / 10000) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-400 mt-1 text-right">
                          {Math.round((data.steps / 10000) * 100)}% de l&apos;objectif
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
