'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadPlan, savePlan, loadUserId, loadGarminTokens } from '@/lib/store';
import { TrainingPlan, Session } from '@/lib/types';
import { getZoneConfig } from '@/lib/zones';
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

function SessionCard({ session, date }: { session: Session; date: Date }) {
  const totalDuration = session.totalMin;
  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <Link href={`/session/${session.id}`}>
      <div
        className={`rounded-[20px] p-4 cursor-pointer transition-all active:scale-[0.97] ${
          session.completed
            ? 'bg-[#C8E635]/15 border border-[#C8E635]/30'
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
            {session.garminSynced && (
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white text-[9px] font-bold">G</span>
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-[#8E8E93] mb-2.5">{totalDuration} min</p>

        <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden mb-2.5">
          {session.steps.map((step, i) => {
            const config = getZoneConfig(step.zone);
            const reps = step.reps ?? 1;
            const width = (step.durationMin * reps) / totalDuration;
            return (
              <div
                key={i}
                style={{
                  backgroundColor: config.color,
                  flexBasis: `${width * 100}%`,
                  flexShrink: 0,
                  flexGrow: 0,
                }}
                title={config.label}
              />
            );
          })}
        </div>

        {/* Zone chips */}
        <div className="flex flex-wrap gap-1">
          {Array.from(new Set(session.steps.filter((s) => !s.isRecovery).map((s) => s.zone))).map((zone) => {
            const cfg = getZoneConfig(zone);
            return (
              <span
                key={zone}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md"
                style={{ backgroundColor: cfg.color + '22' }}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                <span className="text-[9px] font-semibold text-[#0F0F10]">{ZONE_SHORT[zone]}</span>
              </span>
            );
          })}
        </div>
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
  const [heroDataUrl, setHeroDataUrl] = useState<string | null>(null);
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
          title: 'Campus Coach',
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
    const local = loadPlan();
    if (local) {
      setPlan(local);
      setGarminConnected(!!loadGarminTokens());
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
    // Load hero image from gallery
    const userId = loadUserId();
    if (userId) {
      fetch(`/api/gallery?userId=${encodeURIComponent(userId)}`)
        .then((r) => r.json())
        .then((d: { images: Array<{ purpose: string; dataUrl: string }> }) => {
          const hero = d.images?.find((i) => i.purpose === 'hero');
          if (hero) setHeroDataUrl(hero.dataUrl);
        })
        .catch(() => {});
    }
  }, [router]);

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
          {heroDataUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroDataUrl}
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
              if (session) return <SessionCard key={day} session={session} date={date} />;
              return <RestCard key={day} day={day} date={date} />;
            })}
          </div>
        </div>

      </main>
    </div>
  );
}
