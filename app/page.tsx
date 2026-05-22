'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadPlan, savePlan, loadUserId, loadGarminTokens, loadGarminUserId } from '@/lib/store';
import { TrainingPlan, Session } from '@/lib/types';
import { getZoneConfig, getZoneHRRange } from '@/lib/zones';
import { Zone } from '@/lib/types';
import { getPlanStartMonday, getSessionDate } from '@/lib/dates';

const ZONE_SHORT: Record<Zone, string> = {
  EF: 'EF',
  Recup: 'Récup',
  Neutre: 'Neutre',
  Seuil: 'Seuil',
  SSeuilVO2: 'S-VO2',
  VO2max: 'VO2',
};

const DAY_LABELS = ['', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const RACE_LABELS: Record<string, string> = {
  marathon: 'Marathon',
  halfMarathon: 'Semi-Marathon',
  '10k': '10 km',
  '5k': '5 km',
};


function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function getDaysRemaining(goalDate: string): number {
  const now = new Date();
  const goal = new Date(goalDate);
  const diff = goal.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatGoalDate(goalDate: string): string {
  return new Date(goalDate).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const ZONE_INTENSITY: Record<Zone, number> = {
  Recup: 0.2, EF: 0.35, Neutre: 0.45, SSeuilVO2: 0.7, Seuil: 0.8, VO2max: 1.0,
};

function sessionTargetHR(session: Session, maxHR?: number): string | null {
  if (session.type === 'strength') return null;
  let best: Zone | null = null;
  let bestIntensity = -1;
  for (const step of session.steps) {
    if (!step.zone || step.isRecovery) continue;
    const intensity = ZONE_INTENSITY[step.zone] ?? 0;
    if (intensity > bestIntensity) { bestIntensity = intensity; best = step.zone; }
  }
  if (!best) return null;
  const range = getZoneHRRange(best);
  if (maxHR) {
    return `${Math.round(maxHR * range.min / 100)}–${Math.round(maxHR * range.max / 100)} bpm`;
  }
  return `${range.min}–${range.max}% FC`;
}

function SessionCard({ session, date, maxHR }: { session: Session; date: Date; maxHR?: number }) {
  const totalDuration = session.totalMin;
  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <Link href={`/session/${session.id}`}>
      <div
        className={`rounded-[20px] p-4 cursor-pointer transition-all active:scale-[0.97] ${
          session.completed
            ? 'bg-[#C8E635]/15 border border-[#C8E635]/30'
            : session.skipped
            ? 'bg-white/50 border border-[#8E8E93]/20 opacity-60'
            : 'bg-white border border-black/5 hover:border-black/10'
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.12em]">
                {DAY_LABELS[session.day]}
              </p>
              {isToday && (
                <span className="text-[9px] font-bold bg-[#0F0F10] text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  Auj.
                </span>
              )}
            </div>
            <p className="text-[11px] font-semibold text-[#8E8E93] mb-0.5">{formatDayMonth(date)}</p>
            <h3 className="text-sm font-semibold text-[#0F0F10] leading-tight truncate">
              {session.name}
            </h3>
          </div>
          <div className="flex gap-1 ml-2 flex-shrink-0">
            {session.completed && (
              <div className="w-5 h-5 rounded-full bg-[#C8E635] flex items-center justify-center">
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l2.5 2.5L9 1" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )}
            {session.skipped && !session.completed && (
              <div className="w-5 h-5 rounded-full bg-[#8E8E93] flex items-center justify-center">
                <span className="text-white text-[10px] font-bold leading-none">–</span>
              </div>
            )}
            {session.garminSynced && (
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white text-[9px] font-bold">G</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mb-2.5">
          <p className="text-[11px] text-[#8E8E93]">{totalDuration} min</p>
          {sessionTargetHR(session, maxHR) && (
            <p className="text-[11px] text-[#8E8E93]">· ♥ {sessionTargetHR(session, maxHR)}</p>
          )}
        </div>

        {session.type === 'strength' ? (
          <div className="flex flex-wrap gap-1">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#6366f1]/12">
              <span className="text-[9px] font-semibold text-[#6366f1]">💪 {session.steps.filter(s => s.exercise && !s.exercise.startsWith('É') && !s.exercise.startsWith('R')).length} exercices</span>
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#F2F2F7]">
              <span className="text-[9px] font-semibold text-[#8E8E93]">{totalDuration} min</span>
            </span>
          </div>
        ) : (
          <>
            <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden mb-2.5">
              {session.steps.map((step, i) => {
                if (!step.zone) return null;
                const config = getZoneConfig(step.zone);
                const reps = step.reps ?? 1;
                const width = (step.durationMin * reps) / totalDuration;
                return (
                  <div
                    key={i}
                    style={{ backgroundColor: config.color, flexBasis: `${width * 100}%`, flexShrink: 0, flexGrow: 0 }}
                    title={config.label}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from(new Set(session.steps.filter(s => !s.isRecovery && s.zone).map(s => s.zone!))).map((zone) => {
                const cfg = getZoneConfig(zone);
                return (
                  <span key={zone} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md" style={{ backgroundColor: cfg.color + '22' }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                    <span className="text-[9px] font-semibold text-[#0F0F10]">{ZONE_SHORT[zone]}</span>
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Link>
  );
}

function RestCard({ day, date }: { day: number; date: Date }) {
  const isToday = new Date().toDateString() === date.toDateString();
  return (
    <div className="rounded-[20px] p-4 bg-white/50 border border-black/5">
      <div className="flex items-center gap-1.5 mb-0.5">
        <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.12em]">
          {DAY_LABELS[day]}
        </p>
        {isToday && (
          <span className="text-[9px] font-bold bg-[#0F0F10] text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide">
            Auj.
          </span>
        )}
      </div>
      <p className="text-[11px] font-semibold text-[#8E8E93] mb-1">{formatDayMonth(date)}</p>
      <p className="text-[12px] text-[#8E8E93]">Repos</p>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [garminConnected, setGarminConnected] = useState(false);
  const [garminRequired, setGarminRequired] = useState(false);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [notifState, setNotifState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const handleTestNotif = async () => {
    setNotifState('loading');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('Notifications non supportées sur ce navigateur');
        setNotifState('idle');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setNotifState('idle'); return; }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        });
      }

      const userId = loadUserId();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subscription: sub.toJSON() }),
      });

      await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          title: 'RunAI',
          body: 'Les notifications sont activées !',
          url: '/',
        }),
      });
      setNotifState('done');
      setTimeout(() => setNotifState('idle'), 3000);
    } catch (err) {
      console.error(err);
      setNotifState('error');
      setTimeout(() => setNotifState('idle'), 3000);
    }
  };

  useEffect(() => {
    const tokens = loadGarminTokens();
    const garminId = loadGarminUserId();
    if (!tokens && !garminId) {
      setGarminRequired(true);
    }
    const local = loadPlan();
    if (local) {
      setPlan(local);
      setGarminConnected(!!tokens);
      setLoaded(true);
    } else {
      const userId = loadUserId();
      if (!userId) { router.replace('/setup'); return; }
      fetch(`/api/profile?userId=${encodeURIComponent(userId)}`)
        .then((r) => r.json())
        .then((data: { plan?: TrainingPlan | null }) => {
          if (data.plan) {
            savePlan(data.plan);
            setPlan(data.plan);
            setGarminConnected(!!loadGarminTokens());
            setLoaded(true);
          } else {
            router.replace('/setup');
          }
        })
        .catch(() => router.replace('/setup'));
    }
    // Load random background image from Blob IMG/ folder
    fetch('/api/blob-images')
      .then((r) => r.json())
      .then((d: { url: string | null }) => { if (d.url) setHeroUrl(d.url); })
      .catch(() => {});
  }, [router]);

  if (garminRequired && !loaded) {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-[20px] bg-[#C8E635]/20 flex items-center justify-center mb-5">
          <span className="text-[#0F0F10] font-black text-2xl">G</span>
        </div>
        <h1 className="text-[22px] font-black text-[#0F0F10] mb-2">Connecte Garmin</h1>
        <p className="text-[13px] text-[#8E8E93] leading-relaxed mb-6 max-w-xs">
          RunAI nécessite un compte Garmin Connect pour synchroniser tes données et sauvegarder ta progression.
        </p>
        <Link
          href="/settings"
          className="px-6 py-3.5 rounded-[16px] bg-[#0F0F10] text-white text-[14px] font-semibold transition-all active:scale-[0.97]"
        >
          Connecter mon compte Garmin
        </Link>
        <Link href="/setup" className="mt-3 text-[12px] text-[#8E8E93] underline underline-offset-2">
          Créer un plan sans Garmin
        </Link>
      </div>
    );
  }

  if (!loaded || !plan) {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
      </div>
    );
  }

  const totalWeeks = Math.max(...plan.sessions.map((s) => s.week));
  const weekSessions = plan.sessions.filter((s) => s.week === currentWeek);
  const sessionByDay: Record<number, Session | null> = {};
  for (let d = 1; d <= 7; d++) {
    sessionByDay[d] = weekSessions.find((s) => s.day === d) ?? null;
  }

  const daysRemaining = getDaysRemaining(plan.profile.goalDate);
  const raceLabel = RACE_LABELS[plan.profile.goalRace] ?? plan.profile.goalRace;
  const completedCount = plan.sessions.filter((s) => s.completed).length;
  const progressPct = Math.round((completedCount / plan.sessions.length) * 100);

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <main className="max-w-md mx-auto px-4 pt-14 pb-32 space-y-3">
        {/* Hero card */}
        <div className="relative rounded-[28px] bg-[#0F0F10] overflow-hidden">
          {/* Background image (from gallery) or glow orbs fallback */}
          {heroUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                style={{ objectPosition: 'center 35%' }}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/80" />
            </>
          ) : (
            <>
              <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-[#C8E635]/20 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
            </>
          )}

          <div className="relative p-6">
            <p className="text-[10px] font-semibold text-white/50 uppercase tracking-[0.15em] mb-1">{raceLabel}</p>
            <div className="flex items-end gap-3 mb-1">
              <span className="text-[72px] font-black text-white leading-none tabular-nums">{daysRemaining}</span>
              <div className="mb-2">
                <p className="text-[13px] font-medium text-white/60 leading-tight">jours</p>
                <p className="text-[13px] font-medium text-white/60 leading-tight">restants</p>
              </div>
            </div>
            <p className="text-[13px] text-white/50 mb-5">{formatGoalDate(plan.profile.goalDate)}</p>

            {/* Week progress */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-white/50">Semaine {currentWeek} / {totalWeeks}</span>
              <span className="text-[11px] font-medium text-white/50">{progressPct}%</span>
            </div>
            <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#C8E635] rounded-full transition-all"
                style={{ width: `${(currentWeek / totalWeeks) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[24px] bg-white border border-black/5 p-5">
            <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.12em] mb-2">Complétées</p>
            <p className="text-4xl font-black text-[#0F0F10] tabular-nums leading-none mb-1">{completedCount}</p>
            <p className="text-[11px] text-[#8E8E93]">sur {plan.sessions.length} séances</p>
          </div>
          <div className="rounded-[24px] bg-[#C8E635] p-5">
            <p className="text-[10px] font-semibold text-[#0F0F10]/60 uppercase tracking-[0.12em] mb-2">Semaine</p>
            <p className="text-4xl font-black text-[#0F0F10] tabular-nums leading-none mb-1">{currentWeek}</p>
            <p className="text-[11px] text-[#0F0F10]/60">sur {totalWeeks} semaines</p>
          </div>
        </div>

        {/* Week navigation + sessions */}
        <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <button
              onClick={() => setCurrentWeek((w) => Math.max(1, w - 1))}
              disabled={currentWeek === 1}
              className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center disabled:opacity-30 transition-opacity"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div className="text-center">
              <p className="text-[15px] font-bold text-[#0F0F10]">Semaine {currentWeek}</p>
              <p className="text-[11px] text-[#8E8E93]">sur {totalWeeks} semaines</p>
            </div>
            <button
              onClick={() => setCurrentWeek((w) => Math.min(totalWeeks, w + 1))}
              disabled={currentWeek === totalWeeks}
              className="w-8 h-8 rounded-full bg-[#F2F2F7] flex items-center justify-center disabled:opacity-30 transition-opacity"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 2l5 5-5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 px-3 pb-3">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => {
              const session = sessionByDay[day];
              const date = getSessionDate(plan.createdAt, currentWeek, day);
              if (session) return <SessionCard key={day} session={session} date={date} maxHR={plan.profile.maxHR} />;
              return <RestCard key={day} day={day} date={date} />;
            })}
          </div>
        </div>

        {/* PDF export + Notifications row */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/plan-print"
            target="_blank"
            className="rounded-[20px] bg-white border border-black/5 p-4 flex items-center gap-3 transition-all active:scale-[0.97]"
          >
            <div className="w-9 h-9 rounded-[12px] bg-[#F2F2F7] flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-[#0F0F10]">Exporter PDF</p>
              <p className="text-[10px] text-[#8E8E93]">Plan imprimable</p>
            </div>
          </Link>
          <button
            onClick={handleTestNotif}
            className="rounded-[20px] bg-white border border-black/5 p-4 flex items-center gap-3 transition-all active:scale-[0.97] text-left w-full"
          >
            <div className="w-9 h-9 rounded-[12px] bg-[#F2F2F7] flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-[#0F0F10]">
                {notifState === 'done' ? '✓ Activées' : notifState === 'error' ? 'Erreur' : notifState === 'loading' ? '...' : 'Notifications'}
              </p>
              <p className="text-[10px] text-[#8E8E93]">Rappels de séance</p>
            </div>
          </button>
        </div>

      </main>
    </div>
  );
}
