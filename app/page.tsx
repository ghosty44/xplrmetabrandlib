'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadPlan, savePlan, loadUserId, loadGarminTokens } from '@/lib/store';
import { TrainingPlan, Session } from '@/lib/types';
import { getZoneConfig } from '@/lib/zones';

const DAY_LABELS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const RACE_LABELS: Record<string, string> = {
  marathon: 'Marathon',
  halfMarathon: 'Semi-Marathon',
  '10k': '10 km',
  '5k': '5 km',
};

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

function SessionCard({ session }: { session: Session }) {
  const totalDuration = session.totalMin;

  return (
    <Link href={`/session/${session.id}`}>
      <div
        className={`rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md ${
          session.completed
            ? 'bg-green-50 border-green-200'
            : 'bg-white border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
              {DAY_LABELS[session.day]}
            </p>
            <h3 className="text-sm font-semibold text-gray-800 leading-tight truncate">
              {session.name}
            </h3>
          </div>
          <div className="flex gap-1 ml-2 flex-shrink-0">
            {session.completed && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500 text-white text-xs font-bold">
                ✓
              </span>
            )}
            {session.garminSynced && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-xs font-bold">
                G
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-3">{totalDuration} min</p>

        {/* Zone color bars */}
        <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
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
      </div>
    </Link>
  );
}

function RestCard({ day }: { day: number }) {
  return (
    <div className="rounded-xl border border-gray-100 p-4 bg-gray-50">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
        {DAY_LABELS[day]}
      </p>
      <p className="text-sm text-gray-400 italic">Repos</p>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [garminConnected, setGarminConnected] = useState(false);

  useEffect(() => {
    const local = loadPlan();
    if (local) {
      setPlan(local);
      setGarminConnected(!!loadGarminTokens());
      setLoaded(true);
      return;
    }
    // No localStorage — try to restore from DB
    const userId = loadUserId();
    if (!userId) {
      router.replace('/setup');
      return;
    }
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
  }, [router]);

  if (!loaded || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  const totalWeeks = Math.max(...plan.sessions.map((s) => s.week));
  const weekSessions = plan.sessions.filter((s) => s.week === currentWeek);

  // Build a map of sessions by day
  const sessionByDay: Record<number, Session | null> = {};
  for (let d = 1; d <= 7; d++) {
    sessionByDay[d] = weekSessions.find((s) => s.day === d) ?? null;
  }

  const daysRemaining = getDaysRemaining(plan.profile.goalDate);
  const raceLabel = RACE_LABELS[plan.profile.goalRace] ?? plan.profile.goalRace;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Campus Coach</h1>
            <p className="text-sm text-gray-500">
              {raceLabel} · {formatGoalDate(plan.profile.goalDate)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{daysRemaining}</p>
              <p className="text-xs text-gray-500">jours restants</p>
            </div>
            {garminConnected && (
              <Link
                href="/garmin"
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-green-200 bg-green-50 hover:bg-green-100 transition-colors text-green-700 font-bold text-sm"
                title="Données Garmin"
              >
                G
              </Link>
            )}
            <Link
              href="/settings"
              className="flex flex-col items-center justify-center w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              title="Paramètres"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span
                className={`w-1.5 h-1.5 rounded-full mt-0.5 ${garminConnected ? 'bg-green-500' : 'bg-gray-300'}`}
              />
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Week navigation */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => setCurrentWeek((w) => Math.max(1, w - 1))}
            disabled={currentWeek === 1}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            ← Sem. précédente
          </button>
          <div className="text-center">
            <h2 className="text-base font-semibold text-gray-800">Semaine {currentWeek}</h2>
            <p className="text-xs text-gray-500">sur {totalWeeks} semaines</p>
          </div>
          <button
            onClick={() => setCurrentWeek((w) => Math.min(totalWeeks, w + 1))}
            disabled={currentWeek === totalWeeks}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 disabled:opacity-40 hover:bg-gray-50 transition-colors"
          >
            Sem. suivante →
          </button>
        </div>

        {/* Weekly grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const session = sessionByDay[day];
            if (session) {
              return <SessionCard key={day} session={session} />;
            }
            return <RestCard key={day} day={day} />;
          })}
        </div>

        {/* Progress bar */}
        <div className="mt-8 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Progression du plan</span>
            <span>Sem. {currentWeek}/{totalWeeks}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-gray-800 h-2 rounded-full transition-all"
              style={{ width: `${(currentWeek / totalWeeks) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-3 text-xs text-gray-500">
            <span>
              {plan.sessions.filter((s) => s.completed).length} séances complétées
            </span>
            <span>{plan.sessions.length} séances au total</span>
          </div>
        </div>

        {/* Reset link */}
        <div className="mt-6 text-center">
          <Link
            href="/setup"
            className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            Reconfigurer mon profil
          </Link>
        </div>
      </main>
    </div>
  );
}
