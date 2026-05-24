'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generatePlan } from '@/lib/plan';
import {
  savePlan, saveProfile, saveGarminTokens, loadGarminTokens,
  getOrCreateUserId, loadUserId, loadPlan, loadGarminUserId,
  saveGarminUserId, saveShoes, GarminTokens,
} from '@/lib/store';
import { UserProfile, TrainingPlan, Session, Step, Zone, Shoe } from '@/lib/types';
import { getZonePaceRange } from '@/lib/zones';
import type { GeminiSession, GoalAssessment, OnboardingData } from '@/app/api/generate-plan/route';
import type { GarminActivitySummary } from '@/app/api/garmin/activities/route';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'garmin' | 'loading' | 'target' | 'feasibility' | 'preview';

type GoalType = 'road' | 'trail' | 'beginner' | 'injury' | 'test';
type FitnessState = 'active' | 'break2w' | 'break3w' | 'break1m';
type TrainingEnv = 'flat' | 'bump' | 'hill' | 'mountain' | 'cols';

function clearChatMessages() {
  try { localStorage.removeItem('runai_chat_messages'); } catch {}
}

// ── Plan estimation ───────────────────────────────────────────────────────────

function estimateFinishMin(
  dist: number, elev: number, isTrail: boolean,
  sessions: number, fitness: FitnessState,
  garminPaceSec?: number,
  vo2Max?: number,
  lactateThresholdSpeedMps?: number,
): number {
  const fitMult: Record<FitnessState, number> = { active: 1.0, break2w: 1.12, break3w: 1.20, break1m: 1.30 };
  const effectiveKm = isTrail ? dist + elev / 100 : dist;

  // P1 — Lactate threshold speed (most accurate: direct physiological measurement)
  if (lactateThresholdSpeedMps && lactateThresholdSpeedMps > 0) {
    const ltPaceSecKm = 1000 / lactateThresholdSpeedMps;
    const ltFactor = isTrail ? 1.12 : dist >= 25 ? 1.10 : dist >= 17 ? 1.03 : dist >= 8 ? 0.97 : 0.94;
    const racePaceSec = ltPaceSecKm * ltFactor * fitMult[fitness];
    return Math.round(effectiveKm * racePaceSec / 60);
  }

  // P2 — VO2max via Jack Daniels VDOT formula
  if (vo2Max && vo2Max > 10) {
    const intensity = isTrail ? 0.82 : dist >= 25 ? 0.84 : dist >= 17 ? 0.89 : dist >= 8 ? 0.93 : 0.95;
    const targetVO2 = vo2Max * intensity;
    // Solve: targetVO2 = -4.60 + 0.182258v + 0.000104v² (v in m/min)
    const v = (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (targetVO2 + 4.60))) / (2 * 0.000104);
    const roadPaceSec = (60000 / v) * fitMult[fitness];
    const trailPaceSec = roadPaceSec * 1.10;
    return Math.round(effectiveKm * (isTrail ? trailPaceSec : roadPaceSec) / 60);
  }

  // P3 — Avg training pace (noisy but available)
  if (garminPaceSec && garminPaceSec > 0) {
    const racePaceSec = garminPaceSec * fitMult[fitness] * 0.93;
    return Math.round(effectiveKm * racePaceSec / 60);
  }

  // P4 — Generic formula (no Garmin data)
  const km = ([0, 0, 0, 25, 35, 45, 55] as number[])[sessions] ?? 25;
  let pace = km >= 50 ? 5.5 : km >= 35 ? 6.2 : km >= 25 ? 7.0 : 8.0;
  pace *= fitMult[fitness];
  return isTrail ? Math.round(dist * pace * 1.5 + elev / 8) : Math.round(dist * pace);
}

function formatTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`;
}

function parseGoalTime(raw: string): number | undefined {
  const s = raw.trim().replace(/\s+/g, '');
  if (!s) return undefined;
  // e.g. "3h30", "3h30m", "3:30", "3h", "210", "45min"
  const hm = s.match(/^(\d+)h(\d+)/i);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const ho = s.match(/^(\d+)h$/i);
  if (ho) return parseInt(ho[1]) * 60;
  const colon = s.match(/^(\d+):(\d{2})$/);
  if (colon) return parseInt(colon[1]) * 60 + parseInt(colon[2]);
  const minOnly = s.match(/^(\d+)min$/i);
  if (minOnly) return parseInt(minOnly[1]);
  const num = parseInt(s);
  return isNaN(num) ? undefined : num;
}

function buildProfile(
  goalType: GoalType,
  raceDate: string,
  raceDistanceKm: string,
  raceElevationGain: string,
  fitnessState: FitnessState,
  weeklySessions: number,
  trainingEnv: TrainingEnv,
): UserProfile {
  const dist = parseFloat(raceDistanceKm) || 10;
  const elev = parseFloat(raceElevationGain) || 0;
  const isTrail = goalType === 'trail';

  const goalTimeMin = estimateFinishMin(dist, elev, isTrail, weeklySessions, fitnessState);

  type GoalRace = 'marathon' | 'halfMarathon' | '10k' | '5k';
  const goalRace: GoalRace = isTrail
    ? (dist < 15 ? '5k' : dist < 35 ? 'halfMarathon' : 'marathon')
    : (dist <= 6 ? '5k' : dist <= 12 ? '10k' : dist <= 25 ? 'halfMarathon' : 'marathon');

  const RACE_KM: Record<GoalRace, number> = { marathon: 42.195, halfMarathon: 21.1, '10k': 10, '5k': 5 };
  const thresholdPaceSec = Math.round((goalTimeMin * 60 / RACE_KM[goalRace]) * 0.92);
  const terrain = isTrail ? 'trail' : trainingEnv === 'flat' ? 'flat' : 'hilly';

  const DAYS: Record<number, number[]> = { 3: [2, 4, 6], 4: [2, 4, 6, 7], 5: [1, 2, 4, 6, 7], 6: [1, 2, 3, 4, 6, 7] };
  const KM_BASE: Record<number, number> = { 3: 25, 4: 35, 5: 45, 6: 55 };
  const FIT_KM: Record<FitnessState, number> = { active: 1.0, break2w: 0.85, break3w: 0.75, break1m: 0.65 };
  const weeklyKm = Math.round((KM_BASE[weeklySessions] ?? 25) * FIT_KM[fitnessState]);

  if (!raceDate) {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    raceDate = d.toISOString().split('T')[0];
  }

  return {
    goalRace,
    goalDate: raceDate,
    goalTimeMin,
    weeklyKm,
    thresholdPaceSec,
    availableDays: DAYS[weeklySessions] ?? [2, 4, 6],
    strengthPerWeek: 0,
    terrain,
    ...(isTrail && elev > 0 ? { elevationGainPerRace: elev } : {}),
  } as UserProfile;
}

// ── Build TrainingPlan from Gemini sessions ───────────────────────────────────

const KM_PER_MIN: Record<string, number> = { easy: 0.165, moderate: 0.2, hard: 0.185, long: 0.165, recovery: 0.13, strength: 0, hill: 0.13 };

function makeStep(zone: Zone, durationMin: number, thresholdSec: number, isRecovery = false, reps?: number): Step {
  return { zone, durationMin, targetPace: getZonePaceRange(zone, thresholdSec), isRecovery, ...(reps !== undefined ? { reps } : {}) };
}

function buildStepsForGeminiSession(intensity: string, totalMin: number, thresholdSec: number): Step[] {
  if (intensity === 'easy' || intensity === 'long') {
    return [makeStep('EF', totalMin, thresholdSec)];
  }
  if (intensity === 'recovery') {
    const core = Math.max(5, totalMin - 10);
    return [makeStep('Recup', 5, thresholdSec, true), makeStep('EF', core, thresholdSec), makeStep('Recup', 5, thresholdSec, true)];
  }
  const warmup = Math.max(10, Math.round(totalMin * 0.28));
  const cooldown = Math.max(8, Math.round(totalMin * 0.16));
  const core = Math.max(5, totalMin - warmup - cooldown);
  if (intensity === 'moderate') {
    return [makeStep('EF', warmup, thresholdSec), makeStep('Seuil', core, thresholdSec), makeStep('EF', cooldown, thresholdSec)];
  }
  if (intensity === 'hard') {
    const iMin = 2, rMin = 2;
    const sets = Math.max(3, Math.round(core / (iMin + rMin)));
    return [
      makeStep('EF', warmup, thresholdSec),
      { zone: 'VO2max', durationMin: iMin, targetPace: getZonePaceRange('VO2max', thresholdSec), reps: sets },
      makeStep('Recup', rMin, thresholdSec, true, sets - 1),
      makeStep('EF', cooldown, thresholdSec),
    ];
  }
  if (intensity === 'hill') {
    const reps = Math.max(4, Math.round(core / 3));
    return [
      makeStep('EF', warmup, thresholdSec),
      { zone: 'SSeuilVO2', durationMin: 2, targetPace: getZonePaceRange('SSeuilVO2', thresholdSec), reps, effortMode: 'rpe' as const },
      makeStep('Recup', 1, thresholdSec, true, reps - 1),
      makeStep('EF', cooldown, thresholdSec),
    ];
  }
  return [makeStep('EF', totalMin, thresholdSec)];
}

function buildPlanFromGeminiSessions(profile: UserProfile, geminiSessions: GeminiSession[]): TrainingPlan {
  const sessions: Session[] = geminiSessions.map((gs, i) => ({
    id: `gemini_${gs.week}_${gs.day}_${i}`,
    name: gs.name,
    week: gs.week,
    day: gs.day,
    type: gs.intensity === 'strength' ? 'strength' : 'running',
    description: gs.description,
    totalMin: gs.totalMin,
    totalKm: gs.km ?? Math.round((KM_PER_MIN[gs.intensity] ?? 0.165) * gs.totalMin * 10) / 10,
    completed: false,
    garminSynced: false,
    intensity: gs.intensity,
    steps: gs.intensity === 'strength' ? [] : buildStepsForGeminiSession(gs.intensity, gs.totalMin, profile.thresholdPaceSec),
  }));
  return {
    id: `gemini_${Date.now()}`,
    createdAt: new Date().toISOString(),
    profile,
    sessions,
  };
}


// ── Garmin step ───────────────────────────────────────────────────────────────

function GarminConnectStep({ onConnected, onSkip }: {
  onConnected: (garminUserId: string, tokens: GarminTokens) => void;
  onSkip: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/garmin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { success: boolean; tokens?: GarminTokens; garminUserId?: string; error?: string };
      if (data.success && data.tokens) {
        onConnected(data.garminUserId ?? '', data.tokens);
      } else {
        setError(data.error ?? 'Erreur de connexion');
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
      <div className="max-w-md mx-auto w-full px-4 pt-14 pb-32 space-y-3">
        <div className="rounded-[28px] bg-[#0F0F10] p-6 text-center">
          <div className="w-16 h-16 rounded-[20px] bg-[#C8E635]/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-[#C8E635] font-black text-2xl">G</span>
          </div>
          <p className="text-[20px] font-black text-white mb-2">Connecte ton compte Garmin</p>
          <p className="text-[13px] text-white/50 leading-relaxed">
            Tes données et ton plan sont sauvegardés sur ton compte. Reconnecte-toi depuis n&apos;importe quel appareil.
          </p>
        </div>
        <div className="rounded-[24px] bg-white border border-black/5 p-5">
          <form onSubmit={handleConnect} className="space-y-3">
            {error && (
              <div className="rounded-[14px] bg-red-50 border border-red-100 p-3">
                <p className="text-[12px] text-red-600">{error}</p>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Email Garmin Connect</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="ton@email.com"
                className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••"
                className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10" />
            </div>
            <p className="text-[11px] text-[#8E8E93]">Tes identifiants ne sont jamais stockés — seuls les tokens OAuth sont conservés localement.</p>
            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:opacity-50 transition-all active:scale-[0.98]">
              {loading ? 'Connexion en cours...' : 'Se connecter à Garmin'}
            </button>
          </form>
        </div>
        <button onClick={onSkip} className="w-full py-3 text-[12px] font-medium text-[#8E8E93] transition-all active:scale-[0.98]">
          Continuer sans Garmin
        </button>
      </div>
    </div>
  );
}

// ── Plan preview ──────────────────────────────────────────────────────────────

type PlanChatMessage = { role: 'user' | 'model'; content: string; planUpdated?: boolean };

function PlanPreview({
  plan, goalAssessment, garmin, onConfirm, onBack, onPlanUpdate,
}: {
  plan: TrainingPlan;
  goalAssessment?: GoalAssessment | null;
  garmin?: GarminActivitySummary | null;
  onConfirm: () => void;
  onBack: () => void;
  onPlanUpdate: (plan: TrainingPlan) => void;
}) {
  const [chatMessages, setChatMessages] = useState<PlanChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const p = plan.profile;
  const RACE_LABELS: Record<string, string> = { marathon: 'Marathon', halfMarathon: 'Semi-Marathon', '10k': '10 km', '5k': '5 km' };
  const totalWeeks = Math.max(0, ...plan.sessions.map(s => s.week));
  const totalSessions = plan.sessions.length;
  const thresholdMin = Math.floor(p.thresholdPaceSec / 60);
  const thresholdSec = p.thresholdPaceSec % 60;
  const thresholdPace = `${thresholdMin}'${thresholdSec.toString().padStart(2, '0')}''`;

  const fmtMin = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`;
  };

  const VERDICT_COLORS: Record<string, string> = {
    réaliste: '#34C759', ambitieux: '#FF9500', 'sous-estimé': '#007AFF', excellent: '#C8E635',
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const sendChat = async (content: string) => {
    if (!content.trim() || chatLoading) return;
    const userMsg: PlanChatMessage = { role: 'user', content };
    const next = [...chatMessages, userMsg];
    setChatMessages(next);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/api/plan-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
          plan,
        }),
      });
      const data = await res.json() as {
        type: 'answer' | 'modification';
        message: string;
        updatedSessions?: GeminiSession[];
        updatedProfile?: UserProfile;
      };

      if (data.type === 'modification' && data.updatedSessions?.length) {
        const KM_PER_MIN: Record<string, number> = { easy: 0.165, moderate: 0.2, hard: 0.185, long: 0.165, recovery: 0.13, strength: 0, hill: 0.13 };
        const newProfile = data.updatedProfile ?? plan.profile;
        const newSessions: Session[] = data.updatedSessions.map((gs, i) => ({
          id: `chat_${gs.week}_${gs.day}_${i}`,
          name: gs.name,
          week: gs.week,
          day: gs.day,
          type: gs.intensity === 'strength' ? 'strength' : 'running',
          description: gs.description,
          totalMin: gs.totalMin,
          totalKm: gs.km ?? Math.round((KM_PER_MIN[gs.intensity] ?? 0.165) * gs.totalMin * 10) / 10,
          completed: false,
          garminSynced: false,
          steps: [],
        }));
        const updatedPlan: TrainingPlan = { ...plan, profile: newProfile, sessions: newSessions };
        onPlanUpdate(updatedPlan);
        setChatMessages([...next, { role: 'model', content: data.message, planUpdated: true }]);
      } else {
        setChatMessages([...next, { role: 'model', content: data.message }]);
      }
    } catch {
      setChatMessages([...next, { role: 'model', content: 'Erreur de connexion. Réessaie.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <div className="max-w-md mx-auto px-4 pt-14 pb-8 space-y-3">
        <button onClick={onBack} className="flex items-center gap-2 text-[13px] font-semibold text-[#8E8E93] mb-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Modifier
        </button>

        {/* Plan header */}
        <div className="rounded-[28px] bg-[#0F0F10] p-6">
          <p className="text-[10px] font-semibold text-white/50 uppercase tracking-[0.15em] mb-1">Ton plan RunAI</p>
          <p className="text-[28px] font-black text-white leading-tight mb-1">
            {p.terrain === 'trail' ? 'Trail' : RACE_LABELS[p.goalRace]}
          </p>
          <p className="text-[13px] text-white/50 mb-5">
            {new Date(p.goalDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            {p.goalTimeMin ? ` · ${Math.floor(p.goalTimeMin / 60)}h${p.goalTimeMin % 60 > 0 ? p.goalTimeMin % 60 + 'min' : ''}` : ''}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Semaines', value: totalWeeks },
              { label: 'Séances', value: totalSessions },
              { label: 'Allure seuil', value: thresholdPace },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-[16px] bg-white/10 p-3 text-center">
                <p className="text-[18px] font-black text-white tabular-nums">{value}</p>
                <p className="text-[9px] font-semibold text-white/40 uppercase tracking-[0.08em] mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Goal assessment */}
        {goalAssessment && (
          <div className="rounded-[24px] bg-white border border-black/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-bold text-[#0F0F10]">Analyse de ton objectif</p>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide"
                style={{ backgroundColor: `${VERDICT_COLORS[goalAssessment.verdict] ?? '#8E8E93'}20`, color: VERDICT_COLORS[goalAssessment.verdict] ?? '#8E8E93' }}>
                {goalAssessment.verdict}
              </span>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: goalAssessment.userMin != null ? 'repeat(3,1fr)' : 'repeat(2,1fr)' }}>
              {[
                ...(goalAssessment.userMin != null ? [{ label: 'Ton objectif', value: fmtMin(goalAssessment.userMin), dark: false }] : []),
                { label: 'Niveau actuel', value: fmtMin(goalAssessment.realisticMin), dark: false, muted: true },
                { label: 'Objectif du plan', value: fmtMin(goalAssessment.achievableMin), dark: true },
              ].map(({ label, value, dark, muted }) => (
                <div key={label} className={`rounded-[16px] p-3 text-center ${dark ? 'bg-[#0F0F10]' : muted ? 'bg-[#F2F2F7]' : 'bg-[#F8F8F8] border border-black/5'}`}>
                  <p className={`text-[16px] font-black tabular-nums ${dark ? 'text-white' : muted ? 'text-[#8E8E93]' : 'text-[#0F0F10]'}`}>{value}</p>
                  <p className={`text-[9px] font-semibold uppercase tracking-[0.08em] mt-0.5 ${dark ? 'text-white/50' : 'text-[#C7C7CC]'}`}>{label}</p>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-[#8E8E93] leading-relaxed">{goalAssessment.message}</p>
          </div>
        )}

        {/* Reasoning card */}
        {(() => {
          const RACE_FACTORS: Record<string, number> = { '5k': 0.92, '10k': 0.97, halfMarathon: 1.03, marathon: 1.10 };
          const RACE_DISTANCES: Record<string, number> = { '5k': 5, '10k': 10, halfMarathon: 21.1, marathon: 42.2 };
          const RACE_FACTOR_DESC: Record<string, string> = {
            '5k': '× 0.92 — le 5k se court nettement au-dessus du seuil',
            '10k': '× 0.97 — le 10k se court légèrement au-dessus du seuil',
            halfMarathon: '× 1.03 — le semi se court légèrement sous le seuil',
            marathon: '× 1.10 — le marathon se court bien sous le seuil',
          };

          const factor = RACE_FACTORS[p.goalRace] ?? 1.0;
          const dist = RACE_DISTANCES[p.goalRace] ?? 10;
          const racePaceSec = Math.round(p.thresholdPaceSec * factor);
          const fmtPace = (sec: number) => `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}''`;
          const computedGoalMin = Math.round(dist * racePaceSec / 60);

          const weeklyStats = (() => {
            const weeks = Math.max(0, ...plan.sessions.map(s => s.week));
            return Array.from({ length: weeks }, (_, i) => {
              const w = i + 1;
              const ws = plan.sessions.filter(s => s.week === w);
              const run = ws.filter(s => s.type !== 'strength');
              const str = ws.filter(s => s.type === 'strength');
              const km = run.reduce((sum, s) => sum + (s.totalKm ?? 0), 0);
              const weekType = w >= weeks - 1 ? 'affûtage' : w % 4 === 0 ? 'récup' : 'charge';
              return { week: w, km: Math.round(km * 10) / 10, runCount: run.length, strCount: str.length, weekType };
            });
          })();
          const maxKm = Math.max(...weeklyStats.map(w => w.km), 1);

          const runSessions = plan.sessions.filter(s => s.type !== 'strength');
          const easyCount = runSessions.filter(s => ['easy', 'long', 'recovery'].includes(s.intensity ?? '')).length;
          const hardCount = runSessions.filter(s => ['moderate', 'hard', 'hill'].includes(s.intensity ?? '')).length;
          const easyPct = runSessions.length > 0 ? Math.round(easyCount / runSessions.length * 100) : 80;
          const hardPct = 100 - easyPct;

          const WEEK_TYPE_COLOR: Record<string, string> = { charge: '#C8E635', récup: '#007AFF', affûtage: '#FF9500' };

          return (
            <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
              <div className="px-5 py-4 border-b border-[#F2F2F7]">
                <p className="text-[13px] font-bold text-[#0F0F10]">Raisonnement complet</p>
                <p className="text-[11px] text-[#8E8E93] mt-0.5">Pourquoi ce temps cible, pourquoi ces entraînements</p>
              </div>

              {/* Garmin data */}
              {garmin && (
                <div className="px-5 py-4 border-b border-[#F2F2F7]">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-[6px] bg-[#007AFF] flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-black text-[9px]">G</span>
                    </div>
                    <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em]">Données Garmin utilisées</p>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: 'Volume moy. 4 sem.', value: `${Math.round(garmin.weeklyKm4w)} km/sem` },
                      { label: 'Volume moy. 8 sem.', value: `${Math.round(garmin.weeklyKm8w)} km/sem` },
                      { label: 'Plus longue sortie', value: `${Math.round(garmin.longestRunKm)} km` },
                      { label: 'Séances/semaine', value: `${garmin.avgSessionsPerWeek.toFixed(1)}/sem` },
                      { label: 'Allure moyenne récente', value: `${Math.floor(garmin.recentAvgPaceSecKm / 60)}'${String(garmin.recentAvgPaceSecKm % 60).padStart(2, '0')}'' /km` },
                      ...(garmin.vo2Max != null ? [{ label: 'VO2max', value: `${garmin.vo2Max} ml/kg/min` }] : []),
                      ...(garmin.lactateThresholdSpeedMps != null ? [{ label: 'Seuil lactique Garmin', value: `${Math.floor(Math.round(1000 / garmin.lactateThresholdSpeedMps) / 60)}'${String(Math.round(1000 / garmin.lactateThresholdSpeedMps) % 60).padStart(2, '0')}'' /km`, accent: true }] : []),
                      ...(garmin.lactateThresholdHR != null ? [{ label: 'FC seuil', value: `${garmin.lactateThresholdHR} bpm` }] : []),
                    ].map(({ label, value, accent }) => (
                      <div key={label} className={`rounded-[10px] p-2.5 ${accent ? 'bg-[#007AFF]/10 col-span-2' : 'bg-[#F8F8F8]'}`}>
                        <p className={`text-[9px] font-semibold uppercase tracking-[0.08em] mb-0.5 ${accent ? 'text-[#007AFF]' : 'text-[#C7C7CC]'}`}>{label}</p>
                        <p className={`text-[13px] font-black tabular-nums ${accent ? 'text-[#007AFF]' : 'text-[#0F0F10]'}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {!garmin.lactateThresholdSpeedMps && (
                    <p className="text-[10px] text-[#FF9500] mt-2">⚠ Seuil lactique non disponible dans Garmin — allure seuil estimée depuis le chrono cible</p>
                  )}
                </div>
              )}

              {/* Time target computation */}
              <div className="px-5 py-4 border-b border-[#F2F2F7]">
                <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em] mb-3">Calcul du temps cible</p>
                <div className="space-y-2">
                  {[
                    { label: 'Allure au seuil lactique', value: fmtPace(p.thresholdPaceSec) + ' /km', sub: p.thresholdSource === 'garmin' ? 'Mesuré par Garmin Connect (seuil lactique réel)' : 'Estimé par le backend (chrono cible)' },
                    { label: `Facteur ${RACE_LABELS[p.goalRace] ?? p.goalRace}`, value: RACE_FACTOR_DESC[p.goalRace] ?? `× ${factor}`, sub: null },
                    { label: 'Allure course cible', value: fmtPace(racePaceSec) + ' /km', sub: null },
                    { label: `${RACE_LABELS[p.goalRace] ?? ''} × ${dist} km ÷ 60`, value: fmtMin(computedGoalMin), accent: true, sub: null },
                  ].map(({ label, value, sub, accent }) => (
                    <div key={label} className={`flex items-start justify-between gap-3 py-1.5 rounded-[10px] px-2 ${accent ? 'bg-[#0F0F10]' : 'bg-[#F8F8F8]'}`}>
                      <div>
                        <p className={`text-[11px] font-semibold ${accent ? 'text-white/70' : 'text-[#8E8E93]'}`}>{label}</p>
                        {sub && <p className="text-[10px] text-[#C7C7CC] mt-0.5">{sub}</p>}
                      </div>
                      <p className={`text-[13px] font-black tabular-nums flex-shrink-0 ${accent ? 'text-[#C8E635]' : 'text-[#0F0F10]'}`}>{value}</p>
                    </div>
                  ))}
                </div>
                {p.goalTimeMin !== computedGoalMin && (
                  <p className="text-[10px] text-[#8E8E93] mt-2">
                    Temps final retenu : <span className="font-bold text-[#0F0F10]">{fmtMin(p.goalTimeMin)}</span>
                    {goalAssessment?.userMin != null ? ` (ajusté sur ton objectif déclaré de ${fmtMin(goalAssessment.userMin)})` : ''}
                  </p>
                )}
              </div>

              {/* Weekly volume */}
              <div className="px-5 py-4 border-b border-[#F2F2F7]">
                <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em] mb-3">Progression du volume hebdomadaire</p>
                <div className="space-y-1.5">
                  {weeklyStats.map(({ week, km, runCount, strCount, weekType }) => (
                    <div key={week} className="flex items-center gap-2">
                      <p className="text-[10px] text-[#8E8E93] w-12 flex-shrink-0">Sem. {week}</p>
                      <div className="flex-1 relative h-4 bg-[#F2F2F7] rounded-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all"
                          style={{ width: `${Math.max(4, (km / maxKm) * 100)}%`, backgroundColor: WEEK_TYPE_COLOR[weekType] ?? '#C8E635', opacity: weekType === 'récup' ? 0.5 : weekType === 'affûtage' ? 0.7 : 1 }}
                        />
                      </div>
                      <p className="text-[11px] font-bold text-[#0F0F10] tabular-nums w-14 text-right flex-shrink-0">{km > 0 ? `${km} km` : `${runCount}s`}</p>
                      <span className="text-[9px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: WEEK_TYPE_COLOR[weekType] ?? '#C8E635', minWidth: 40, textAlign: 'right' }}>
                        {weekType}
                        {strCount > 0 ? ` +${strCount}💪` : ''}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[#C7C7CC] mt-2">Cycle 3 semaines de charge + 1 semaine de récupération · Affûtage avant la course</p>
              </div>

              {/* 80/20 distribution */}
              <div className="px-5 py-4">
                <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em] mb-3">Répartition des intensités (règle 80/20)</p>
                <div className="flex h-5 rounded-full overflow-hidden gap-0.5 mb-2">
                  <div className="rounded-l-full" style={{ width: `${easyPct}%`, backgroundColor: '#C8E635' }} />
                  <div className="rounded-r-full" style={{ width: `${hardPct}%`, backgroundColor: '#0F0F10' }} />
                </div>
                <div className="flex justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#C8E635]" />
                    <p className="text-[11px] text-[#8E8E93]"><span className="font-bold text-[#0F0F10]">{easyPct}%</span> endurance (EF · long · récup)</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] text-[#8E8E93]"><span className="font-bold text-[#0F0F10]">{hardPct}%</span> intensité</p>
                    <div className="w-2.5 h-2.5 rounded-full bg-[#0F0F10]" />
                  </div>
                </div>
                {goalAssessment?.message && (
                  <div className="mt-3 pt-3 border-t border-[#F2F2F7]">
                    <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em] mb-1.5">Message de ton coach IA</p>
                    <p className="text-[12px] text-[#0F0F10] leading-relaxed">{goalAssessment.message}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Plan preview */}
        <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F2F2F7]">
            <p className="text-[13px] font-semibold text-[#0F0F10]">Aperçu du plan</p>
          </div>
          {Array.from({ length: Math.min(totalWeeks, 4) }, (_, i) => i + 1).map((week) => {
            const wSessions = plan.sessions.filter(s => s.week === week);
            return (
              <div key={week} className="px-5 py-3.5 border-b border-[#F2F2F7]/80 last:border-0">
                <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-2">Semaine {week}</p>
                <div className="space-y-1">
                  {wSessions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <p className="text-[12px] font-medium text-[#0F0F10]">{s.name}</p>
                      <p className="text-[11px] text-[#8E8E93]">{s.totalMin} min</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {totalWeeks > 4 && (
            <div className="px-5 py-3 text-center">
              <p className="text-[11px] text-[#8E8E93]">+ {totalWeeks - 4} semaines supplémentaires</p>
            </div>
          )}
        </div>

        {/* Chat with coach */}
        <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F2F2F7] flex items-center gap-3">
            <div className="w-7 h-7 rounded-[9px] bg-[#0F0F10] flex items-center justify-center flex-shrink-0">
              <span className="text-[#C8E635] font-black text-[11px]">AI</span>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[#0F0F10]">Discute avec ton coach</p>
              <p className="text-[11px] text-[#8E8E93]">Pose des questions ou demande des modifications</p>
            </div>
          </div>

          {/* Suggestion chips */}
          {chatMessages.length === 0 && (
            <div className="px-5 py-3 flex gap-2 overflow-x-auto scrollbar-none">
              {[
                'Pourquoi autant de sorties easy ?',
                'Réduis le volume sem. 1',
                'Explique la progression',
                'Décale les séances au week-end',
              ].map((chip) => (
                <button key={chip} onClick={() => sendChat(chip)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full bg-[#F2F2F7] text-[11px] font-semibold text-[#0F0F10] whitespace-nowrap transition-all active:scale-[0.96]">
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          {chatMessages.length > 0 && (
            <div className="px-4 py-3 space-y-2.5 max-h-72 overflow-y-auto">
              {chatMessages.map((msg, i) => (
                <div key={i}>
                  {msg.planUpdated && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="h-px flex-1 bg-[#C8E635]/40" />
                      <span className="text-[10px] font-semibold text-[#5A6A00] uppercase tracking-wide">Plan mis à jour</span>
                      <div className="h-px flex-1 bg-[#C8E635]/40" />
                    </div>
                  )}
                  <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-3.5 py-2.5 rounded-[16px] text-[13px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#0F0F10] text-white rounded-br-[5px]'
                        : 'bg-[#F2F2F7] text-[#0F0F10] rounded-bl-[5px]'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-[#F2F2F7] rounded-[16px] rounded-bl-[5px] px-4 py-3 flex gap-1">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>
          )}

          {/* Input */}
          <div className="px-4 pb-4 pt-2 flex items-center gap-2 border-t border-[#F2F2F7]">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(chatInput); } }}
              placeholder="Ex : réduis les sorties longues…"
              className="flex-1 px-4 py-2.5 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] outline-none"
            />
            <button onClick={() => sendChat(chatInput)} disabled={!chatInput.trim() || chatLoading}
              className="w-9 h-9 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-all active:scale-[0.93]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Confirm button */}
        <button onClick={onConfirm}
          className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black transition-all active:scale-[0.98]">
          Commencer l&apos;entraînement →
        </button>
      </div>
    </div>
  );
}



// ── New lean onboarding (Garmin → Target → Feasibility) ──────────────────────

type DistanceChoice = '5k' | '10k' | 'half' | 'marathon' | 'trail';

const DISTANCE_PRESETS: Record<Exclude<DistanceChoice, 'trail'>, { km: number; label: string }> = {
  '5k': { km: 5, label: '5 km' },
  '10k': { km: 10, label: '10 km' },
  half: { km: 21.1, label: 'Semi' },
  marathon: { km: 42.2, label: 'Marathon' },
};

const DAY_CHIPS: { d: number; label: string }[] = [
  { d: 1, label: 'L' }, { d: 2, label: 'M' }, { d: 3, label: 'M' }, { d: 4, label: 'J' },
  { d: 5, label: 'V' }, { d: 6, label: 'S' }, { d: 7, label: 'D' },
];

function TargetStep({
  initialChoice, initialTrailKm, initialTrailDPlus, initialDate, initialGoalTime, initialDays,
  garminDays,
  onSubmit,
}: {
  initialChoice: DistanceChoice | null;
  initialTrailKm: string;
  initialTrailDPlus: string;
  initialDate: string;
  initialGoalTime: string;
  initialDays: number[];
  garminDays?: number[];
  onSubmit: (data: { choice: DistanceChoice; trailKm: string; trailDPlus: string; date: string; goalTime: string; days: number[] }) => void;
}) {
  const [choice, setChoice] = useState<DistanceChoice | null>(initialChoice);
  const [trailKm, setTrailKm] = useState(initialTrailKm);
  const [trailDPlus, setTrailDPlus] = useState(initialTrailDPlus);
  const [date, setDate] = useState(initialDate);
  const [goalTime, setGoalTime] = useState(initialGoalTime);
  const [days, setDays] = useState<number[]>(initialDays.length > 0 ? initialDays : (garminDays ?? []));

  const toggleDay = (d: number) => setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));

  const trailValid = choice === 'trail' ? Number(trailKm) > 0 : true;
  const daysValid = days.length >= 3 && days.length <= 6;
  const goalValid = parseGoalTime(goalTime) != null;
  const dateValid = !!date && new Date(date).getTime() > Date.now();
  const canSubmit = !!choice && trailValid && daysValid && goalValid && dateValid;

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <div className="max-w-md mx-auto px-5 pt-14 pb-32 space-y-5">
        <div>
          <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-[0.15em] mb-1">Étape 2 / 3</p>
          <h1 className="text-[28px] font-black text-[#0F0F10] leading-tight">Ton objectif</h1>
          <p className="text-[13px] text-[#8E8E93] mt-1">On a tes données physio. Dis-nous juste où tu veux aller.</p>
        </div>

        {/* Distance */}
        <div className="space-y-2">
          <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em]">Distance</p>
          <div className="grid grid-cols-4 gap-2">
            {(['5k', '10k', 'half', 'marathon'] as const).map(k => (
              <button key={k} onClick={() => setChoice(k)}
                className={`py-3 rounded-[14px] text-[12px] font-bold transition-all active:scale-[0.96] ${choice === k ? 'bg-[#0F0F10] text-white' : 'bg-white border border-black/8 text-[#0F0F10]'}`}>
                {DISTANCE_PRESETS[k].label}
              </button>
            ))}
          </div>
          <button onClick={() => setChoice('trail')}
            className={`w-full py-3 rounded-[14px] text-[12px] font-bold transition-all active:scale-[0.96] ${choice === 'trail' ? 'bg-[#0F0F10] text-white' : 'bg-white border border-black/8 text-[#0F0F10]'}`}>
            Trail (distance + D+ libres)
          </button>
          {choice === 'trail' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <input type="number" inputMode="decimal" value={trailKm} onChange={e => setTrailKm(e.target.value)} placeholder="km" min="1"
                  className="w-full px-3 py-2.5 bg-white border border-black/8 rounded-[12px] text-[13px] text-[#0F0F10] outline-none focus:border-[#0F0F10]" />
                <p className="text-[10px] text-[#8E8E93] mt-1 ml-1">Distance (km)</p>
              </div>
              <div>
                <input type="number" inputMode="decimal" value={trailDPlus} onChange={e => setTrailDPlus(e.target.value)} placeholder="m" min="0"
                  className="w-full px-3 py-2.5 bg-white border border-black/8 rounded-[12px] text-[13px] text-[#0F0F10] outline-none focus:border-[#0F0F10]" />
                <p className="text-[10px] text-[#8E8E93] mt-1 ml-1">D+ (m)</p>
              </div>
            </div>
          )}
        </div>

        {/* Date */}
        <div className="space-y-2">
          <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em]">Date de la course</p>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} min={todayStr}
            className="w-full px-4 py-3 bg-white border border-black/8 rounded-[14px] text-[14px] text-[#0F0F10] outline-none focus:border-[#0F0F10]" />
        </div>

        {/* Goal time */}
        <div className="space-y-2">
          <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em]">Chrono visé</p>
          <input type="text" inputMode="text" value={goalTime} onChange={e => setGoalTime(e.target.value)}
            placeholder="ex. 44min ou 3h30"
            className="w-full px-4 py-3 bg-white border border-black/8 rounded-[14px] text-[14px] text-[#0F0F10] placeholder:text-[#8E8E93] outline-none focus:border-[#0F0F10]" />
        </div>

        {/* Available days */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] font-black text-[#8E8E93] uppercase tracking-[0.12em]">Jours dispo (3 à 6)</p>
            <p className="text-[10px] text-[#8E8E93]">{days.length} sélectionné{days.length > 1 ? 's' : ''}</p>
          </div>
          <div className="flex gap-1.5">
            {DAY_CHIPS.map(({ d, label }) => {
              const sel = days.includes(d);
              return (
                <button key={d} onClick={() => toggleDay(d)}
                  className={`flex-1 h-12 rounded-[12px] text-[14px] font-black transition-all active:scale-[0.94] ${sel ? 'bg-[#C8E635] text-[#0F0F10]' : 'bg-white border border-black/8 text-[#8E8E93]'}`}>
                  {label}
                </button>
              );
            })}
          </div>
          {garminDays && garminDays.length > 0 && days.length === 0 && (
            <p className="text-[10px] text-[#007AFF]">Pré-rempli depuis tes habitudes Garmin</p>
          )}
        </div>

        <div className="pt-3 space-y-2">
          <button onClick={() => canSubmit && choice && onSubmit({ choice, trailKm, trailDPlus, date, goalTime, days })}
            disabled={!canSubmit}
            className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black transition-all active:scale-[0.98] disabled:bg-[#C7C7CC]">
            Vérifier la faisabilité →
          </button>
        </div>
      </div>
    </div>
  );
}

function FeasibilityStep({
  goalMin, predictedMin, distanceLabel, hasGarmin,
  onBack, onConfirm, launching,
}: {
  goalMin: number;
  predictedMin: number;
  distanceLabel: string;
  hasGarmin: boolean;
  onBack: () => void;
  onConfirm: () => void;
  launching: boolean;
}) {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60); const mm = m % 60;
    return h > 0 ? `${h}h${String(mm).padStart(2, '0')}` : `${mm} min`;
  };

  const diffPct = (goalMin - predictedMin) / predictedMin;
  let verdict: 'réaliste' | 'ambitieux' | 'sous-estimé' | 'agressif';
  let verdictColor: string;
  let message: string;
  if (diffPct < -0.10) {
    verdict = 'agressif';
    verdictColor = '#FF3B30';
    message = `Ta physiologie actuelle indique un potentiel autour de ${fmt(predictedMin)}. Viser ${fmt(goalMin)} risque de générer des allures blessantes. Tu peux ajuster ou continuer si tu sens que tu peux pousser.`;
  } else if (diffPct < -0.03) {
    verdict = 'ambitieux';
    verdictColor = '#FF9500';
    message = `Tu vises ${fmt(goalMin)} alors qu'on prédit ${fmt(predictedMin)} sur ta forme actuelle. C'est ambitieux mais atteignable avec un plan bien construit.`;
  } else if (diffPct > 0.10) {
    verdict = 'sous-estimé';
    verdictColor = '#007AFF';
    message = `On prédit ${fmt(predictedMin)} sur ta physiologie actuelle — tu as une marge confortable. Tu peux revoir ton objectif à la hausse si tu veux te challenger.`;
  } else {
    verdict = 'réaliste';
    verdictColor = '#34C759';
    message = `Ta cible de ${fmt(goalMin)} est cohérente avec ta physiologie actuelle (${fmt(predictedMin)} estimé). Plan en cours de génération.`;
  }

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <div className="max-w-md mx-auto px-5 pt-14 pb-32 space-y-5">
        <div>
          <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-[0.15em] mb-1">Étape 3 / 3</p>
          <h1 className="text-[28px] font-black text-[#0F0F10] leading-tight">Check de faisabilité</h1>
          <p className="text-[13px] text-[#8E8E93] mt-1">{hasGarmin ? 'On a comparé ta cible à ta physio Garmin.' : 'Estimation basée sur des moyennes (Garmin non connecté).'}</p>
        </div>

        <div className="rounded-[24px] bg-white border border-black/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[#0F0F10]">{distanceLabel}</p>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide"
              style={{ backgroundColor: `${verdictColor}20`, color: verdictColor }}>
              {verdict}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[16px] p-4 bg-[#F8F8F8] border border-black/5 text-center">
              <p className="text-[18px] font-black text-[#0F0F10] tabular-nums">{fmt(goalMin)}</p>
              <p className="text-[9px] font-semibold text-[#C7C7CC] uppercase tracking-[0.08em] mt-0.5">Ton objectif</p>
            </div>
            <div className="rounded-[16px] p-4 bg-[#0F0F10] text-center">
              <p className="text-[18px] font-black text-white tabular-nums">{fmt(predictedMin)}</p>
              <p className="text-[9px] font-semibold text-white/50 uppercase tracking-[0.08em] mt-0.5">Prédiction physio</p>
            </div>
          </div>
          <p className="text-[12px] text-[#8E8E93] leading-relaxed">{message}</p>
        </div>

        <div className="pt-3 space-y-2">
          <button onClick={onConfirm} disabled={launching}
            className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black transition-all active:scale-[0.98] disabled:opacity-60">
            {launching ? 'Génération en cours…' : 'Générer mon plan →'}
          </button>
          <button onClick={onBack} disabled={launching}
            className="w-full text-[13px] text-[#8E8E93] py-2 font-semibold">Modifier mon objectif</button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>('garmin');
  const [generatedPlan, setGeneratedPlan] = useState<TrainingPlan | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Onboarding state
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [raceDate, setRaceDate] = useState('');
  const [raceDistanceKm, setRaceDistanceKm] = useState('');
  const [raceElevationGain, setRaceElevationGain] = useState('');
  const [raceGoalTime, setRaceGoalTime] = useState('');
  const [weeklySessions, setWeeklySessions] = useState<3 | 4 | 5 | 6 | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState('');
  const [streamText, setStreamText] = useState('');
  const [goalAssessment, setGoalAssessment] = useState<GoalAssessment | null>(null);
  const [garminSummary, setGarminSummary] = useState<GarminActivitySummary | null>(null);

  // Lean onboarding state
  const [distChoice, setDistChoice] = useState<DistanceChoice | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [predictedMin, setPredictedMin] = useState<number | null>(null);
  const [parsedGoalMin, setParsedGoalMin] = useState<number | null>(null);

  const fetchGarminSummary = async (): Promise<GarminActivitySummary | undefined> => {
    const tokens = loadGarminTokens();
    if (!tokens) return undefined;
    try {
      const r = await fetch('/api/garmin/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garminTokens: tokens }),
      });
      const d = await r.json() as { summary?: GarminActivitySummary };
      if (d.summary) { setGarminSummary(d.summary); return d.summary; }
    } catch { /* non-fatal */ }
    return undefined;
  };

  const applyGarminThreshold = (profile: { thresholdPaceSec: number; thresholdSource?: string; goalTimeMin: number; goalRace: string }, ltSpeedMps: number) => {
    const RACE_FACTORS: Record<string, number> = { '5k': 0.92, '10k': 0.97, halfMarathon: 1.03, marathon: 1.10 };
    const RACE_DISTANCES: Record<string, number> = { '5k': 5, '10k': 10, halfMarathon: 21.1, marathon: 42.2 };
    profile.thresholdPaceSec = Math.round(1000 / ltSpeedMps);
    profile.thresholdSource = 'garmin';
    const factor = RACE_FACTORS[profile.goalRace] ?? 1.0;
    const dist = RACE_DISTANCES[profile.goalRace] ?? 10;
    profile.goalTimeMin = Math.round(dist * Math.round(profile.thresholdPaceSec * factor) / 60);
  };

  const fetchGeminiPlan = async (onboarding: OnboardingData, garmin?: GarminActivitySummary): Promise<TrainingPlan> => {
    setLaunchStatus('');
    setStreamText('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    try {
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding, garmin, stream: true }),
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const evt = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; sessions?: GeminiSession[]; goalAssessment?: GoalAssessment; profile?: UserProfile; error?: string };
          if (evt.text) {
            accumulated += evt.text;
            setStreamText(accumulated);
          }
          if (evt.done && evt.sessions?.length) {
            clearTimeout(timeout);
            if (evt.goalAssessment) setGoalAssessment(evt.goalAssessment);
            const profile = evt.profile ?? buildProfile(
              onboarding.goalType, onboarding.raceDate ?? '', onboarding.raceDistanceKm ?? '',
              onboarding.raceElevationGain ?? '', onboarding.fitnessState, onboarding.weeklySessions, onboarding.trainingEnv,
            );
            // Garmin lactate threshold is always authoritative — override regardless of profile origin
            if (garmin?.lactateThresholdSpeedMps) {
              applyGarminThreshold(profile, garmin.lactateThresholdSpeedMps);
            } else {
              profile.thresholdSource = profile.thresholdSource ?? 'estimated';
            }
            return buildPlanFromGeminiSessions(profile, evt.sessions!);
          }
          if (evt.error) console.warn('[generate-plan] stream error:', evt.error);
        }
      }
      console.warn('[generate-plan] stream ended without done event, falling back');
    } catch (err) {
      console.warn('[generate-plan] stream error:', err);
    } finally {
      clearTimeout(timeout);
    }
    // Fallback: local formulas only if Gemini fails/times out
    const fallbackProfile = buildProfile(
      onboarding.goalType, onboarding.raceDate ?? '', onboarding.raceDistanceKm ?? '',
      onboarding.raceElevationGain ?? '', onboarding.fitnessState, onboarding.weeklySessions, onboarding.trainingEnv,
    );
    if (garmin?.lactateThresholdSpeedMps) {
      applyGarminThreshold(fallbackProfile, garmin.lactateThresholdSpeedMps);
    } else {
      fallbackProfile.thresholdSource = 'estimated';
    }
    try { return generatePlan(fallbackProfile); }
    catch { return { id: `plan_${Date.now()}`, createdAt: new Date().toISOString(), profile: fallbackProfile, sessions: [] }; }
  };

  const handleStep7Launch = async () => {
    setLaunching(true);
    try {
      // 1. Use pre-fetched Garmin data; re-fetch only if not already loaded
      let garmin: GarminActivitySummary | undefined = garminSummary ?? undefined;
      if (!garmin) {
        setLaunchStatus('Récupération de tes courses Garmin…');
        garmin = await fetchGarminSummary();
      }

      // 2. Build onboarding data object (raw answers, no formulas)
      const onboarding: OnboardingData = {
        goalType: goalType ?? 'road',
        raceDate: raceDate || undefined,
        raceDistanceKm: raceDistanceKm || undefined,
        raceElevationGain: raceElevationGain || undefined,
        racePriority: 'main',
        fitnessState: 'active',
        recentInjuries: 'none',
        strengthPerWeek: 0,
        weeklySessions: weeklySessions ?? 3,
        trainingEnv: 'flat',
        raceGoalTime: raceGoalTime || undefined,
        availableDays: selectedDays.length >= 3 ? selectedDays : undefined,
      };

      // 3. Gemini computes everything: profile + goal assessment + sessions
      const plan = await fetchGeminiPlan(onboarding, garmin);
      setGeneratedPlan(plan);
      setPhase('preview');
    } catch (err) {
      console.error('[step7Launch]', err);
      const profile = buildProfile(goalType ?? 'road', raceDate, raceDistanceKm, raceElevationGain, 'active', weeklySessions ?? 3, 'flat');
      const garminForFallback: GarminActivitySummary | undefined = garminSummary ?? undefined;
      if (garminForFallback?.lactateThresholdSpeedMps) {
        applyGarminThreshold(profile, garminForFallback.lactateThresholdSpeedMps);
      } else {
        profile.thresholdSource = 'estimated';
      }
      try { setGeneratedPlan(generatePlan(profile)); } catch { setGeneratedPlan({ id: `plan_${Date.now()}`, createdAt: new Date().toISOString(), profile, sessions: [] }); }
      setPhase('preview');
    } finally {
      setLaunching(false);
      setLaunchStatus('');
    }
  };


  useEffect(() => {
    const force = searchParams.get('force') === '1';
    const tokens = loadGarminTokens();
    const garminId = loadGarminUserId();
    const alreadyAuthed = !!tokens || !!garminId;

    if (alreadyAuthed) {
      const localPlan = loadPlan();
      if (localPlan && !force) { router.replace('/'); return; }

      const userId = loadUserId();
      if (userId && !force) {
        setPhase('loading');
        fetch(`/api/profile?userId=${encodeURIComponent(userId)}`)
          .then(r => r.json())
          .then((d: { plan?: TrainingPlan | null; shoes?: Shoe[] }) => {
            if (d.plan) {
              savePlan(d.plan);
              if (d.shoes?.length) saveShoes(d.shoes);
              router.replace('/');
            } else {
              setPhase('target');
              setInitialized(true);
            }
          })
          .catch(() => { setPhase('target'); setInitialized(true); });
        return;
      }
      clearChatMessages();
      setPhase('target');
      setInitialized(true);
      return;
    }

    setPhase('garmin');
    setInitialized(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGarminConnected = async (garminUserId: string, tokens: GarminTokens) => {
    saveGarminTokens(tokens);
    if (garminUserId) saveGarminUserId(garminUserId);
    const userId = garminUserId || loadUserId();
    if (userId) {
      setPhase('loading');
      try {
        const res = await fetch(`/api/profile?userId=${encodeURIComponent(userId)}`);
        const d = await res.json() as { plan?: TrainingPlan | null; shoes?: Shoe[] };
        if (d.plan) {
          savePlan(d.plan);
          if (d.shoes?.length) saveShoes(d.shoes);
          router.replace('/');
          return;
        }
      } catch { /* non-fatal */ }
    }
    setPhase('target');
    setInitialized(true);
  };

  const handleConfirmPlan = () => {
    if (!generatedPlan) return;
    saveProfile(generatedPlan.profile);
    savePlan(generatedPlan);
    const userId = loadUserId() ?? getOrCreateUserId();
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan: generatedPlan }),
    }).catch(() => {});
    clearChatMessages();
    router.push('/');
  };

  // ── Phase renders ──────────────────────────────────────────────────────────

  if (phase === 'garmin') return <GarminConnectStep onConnected={handleGarminConnected} onSkip={() => { setPhase('target'); setInitialized(true); }} />;

  if (phase === 'loading' || !initialized) return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-center gap-3">
      <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
      <p className="text-[12px] text-[#8E8E93]">Chargement de ton profil…</p>
    </div>
  );

  if (phase === 'target') {
    const garminDays = garminSummary?.runs && garminSummary.runs.length > 0
      ? Array.from(new Set(garminSummary.runs.slice(0, 20).map(r => {
          const d = new Date(r.date).getDay();
          return d === 0 ? 7 : d;
        }).filter(d => d >= 1 && d <= 7))).slice(0, 4).sort((a, b) => a - b)
      : undefined;

    return (
      <TargetStep
        initialChoice={distChoice}
        initialTrailKm={raceDistanceKm}
        initialTrailDPlus={raceElevationGain}
        initialDate={raceDate}
        initialGoalTime={raceGoalTime}
        initialDays={selectedDays}
        garminDays={garminDays}
        onSubmit={async ({ choice, trailKm, trailDPlus, date, goalTime, days }) => {
          setDistChoice(choice);
          setSelectedDays(days);
          const isTrail = choice === 'trail';
          const km = isTrail ? trailKm : String(DISTANCE_PRESETS[choice].km);
          const dPlus = isTrail ? trailDPlus : '0';
          setGoalType(isTrail ? 'trail' : 'road');
          setRaceDistanceKm(km);
          setRaceElevationGain(dPlus);
          setRaceDate(date);
          setRaceGoalTime(goalTime);
          setWeeklySessions(days.length as 3 | 4 | 5 | 6);

          let g: GarminActivitySummary | undefined = garminSummary ?? undefined;
          if (!g) g = await fetchGarminSummary();

          const distKm = parseFloat(km) || 10;
          const elev = parseFloat(dPlus) || 0;
          const predicted = estimateFinishMin(
            distKm, elev, isTrail, days.length, 'active',
            g?.recentAvgPaceSecKm, g?.vo2Max, g?.lactateThresholdSpeedMps,
          );
          setPredictedMin(predicted);
          setParsedGoalMin(parseGoalTime(goalTime) ?? predicted);
          setPhase('feasibility');
        }}
      />
    );
  }

  if (phase === 'feasibility' && predictedMin != null && parsedGoalMin != null) {
    const isTrail = distChoice === 'trail';
    const distLabel = isTrail
      ? `Trail · ${raceDistanceKm} km${raceElevationGain && Number(raceElevationGain) > 0 ? ` · ${raceElevationGain} m D+` : ''}`
      : distChoice ? DISTANCE_PRESETS[distChoice].label : '';
    return (
      <FeasibilityStep
        goalMin={parsedGoalMin}
        predictedMin={predictedMin}
        distanceLabel={distLabel}
        hasGarmin={!!garminSummary}
        launching={launching}
        onBack={() => setPhase('target')}
        onConfirm={handleStep7Launch}
      />
    );
  }

  if (phase === 'preview' && generatedPlan) return (
    <PlanPreview
      plan={generatedPlan}
      goalAssessment={goalAssessment}
      garmin={garminSummary}
      onConfirm={handleConfirmPlan}
      onBack={() => setPhase('target')}
      onPlanUpdate={setGeneratedPlan}
    />
  );

  return null;
}

export default function SetupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
