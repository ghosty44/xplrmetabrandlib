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

type Phase =
  | 'garmin' | 'loading'
  | 'target' | 'feasibility'
  | 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'step6' | 'step7' | 'step8'
  | 'summary' | 'chat' | 'preview';

type GoalType = 'road' | 'trail' | 'beginner' | 'injury' | 'test';
type FitnessState = 'active' | 'break2w' | 'break3w' | 'break1m';
type RecentInjuries = 'none' | 'knee' | 'achilles' | 'back' | 'other';
type StrengthPerWeek = 0 | 1 | 2;
type TrainingEnv = 'flat' | 'bump' | 'hill' | 'mountain' | 'cols';
type ChatMessage = { role: 'user' | 'model'; content: string; hidden?: boolean };

// ── Chat storage ──────────────────────────────────────────────────────────────

const CHAT_KEY = 'runai_chat_messages';
function saveChatMessages(msgs: ChatMessage[]) {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs)); } catch {}
}
function loadChatMessages(): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]') as ChatMessage[]; } catch { return []; }
}
function clearChatMessages() {
  try { localStorage.removeItem(CHAT_KEY); } catch {}
}

// ── Quick replies (resumed chat only) ────────────────────────────────────────

function getQuickReplies(lastBotMsg: string, allMessages: ChatMessage[]): string[] {
  const m = lastBotMsg.toLowerCase();
  const userMsgs = allMessages.filter(msg => msg.role === 'user' && !msg.hidden).map(msg => msg.content.toLowerCase());
  const hasDistance = userMsgs.some(u => u.includes('marathon') || u.includes('semi') || u.includes('10k') || u.includes('5k'));
  const chosenRace = userMsgs.find(u => u.includes('marathon') || u.includes('semi') || u.includes('10k') || u.includes('5k'));
  const isMarathon = !!chosenRace && chosenRace.includes('marathon') && !chosenRace.includes('semi');
  const isSemi = !!chosenRace && chosenRace.includes('semi');
  const is10k = !!chosenRace && chosenRace.includes('10k');

  if (m.includes('fc max') || m.includes('fréquence cardiaque')) return ['Je ne sais pas', '170 bpm', '180 bpm', '190 bpm'];
  if (m.includes('blessure') || m.includes('douleur')) return ['Aucune blessure', 'Genou', "Tendon d'Achille", 'Dos / hanche'];
  if (m.includes('renforcement') || m.includes('musculaire')) return ['0 séance', '1 séance/semaine', '2 séances/semaine'];
  if (m.includes('jours') || m.includes('disponible')) {
    const n = parseInt(userMsgs.join(' ').match(/(\d+)\s*séance/)?.[1] ?? '4');
    if (n <= 3) return ['Mar · Jeu · Sam', 'Lun · Mer · Sam', 'Mer · Ven · Dim', 'Lun · Jeu · Sam'];
    if (n === 5) return ['Lun · Mar · Jeu · Sam · Dim', 'Lun · Mer · Jeu · Ven · Sam'];
    if (n >= 6) return ['Lun · Mar · Mer · Jeu · Ven · Sam', 'Lun · Mar · Jeu · Ven · Sam · Dim'];
    return ['Mar · Jeu · Sam · Dim', 'Lun · Mer · Ven · Sam', 'Mar · Jeu · Ven · Dim', 'Lun · Mer · Sam · Dim'];
  }
  if (m.includes('km/semaine') || m.includes('volume')) return ['20 km/sem · 3 séances', '35 km/sem · 4 séances', '50 km/sem · 5 séances', '65 km/sem · 6 séances'];
  if (hasDistance && (m.includes('date') || m.includes('chrono') || m.includes('temps'))) {
    if (isMarathon) return ['3h00', '3h30', '4h00', '4h30'];
    if (isSemi) return ['1h30', '1h45', '2h00', '2h15'];
    if (is10k) return ['40 min', '45 min', '50 min', '55 min'];
    return ['20 min', '22 min', '25 min', '28 min'];
  }
  if (!hasDistance && (m.includes('distance') || m.includes('objectif') || m.includes('course'))) return ['Marathon', 'Semi-marathon', '10 km', '5 km'];
  return [];
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

// ── Onboarding context builder for Gemini ────────────────────────────────────

function buildOnboardingContext(
  goalType: GoalType,
  raceName: string, raceDate: string, raceDistanceKm: string, raceElevationGain: string,
  racePriority: 'main' | 'secondary' | null,
  fitnessState: FitnessState,
  weeklySessions: number,
  trainingEnv: TrainingEnv,
): string {
  const GOAL_LABELS: Record<GoalType, string> = { road: 'course sur route', trail: 'trail', beginner: 'programme débutant', injury: 'reprise après blessure', test: 'test de niveau' };
  const FITNESS_LABELS: Record<FitnessState, string> = { active: 'je cours régulièrement sans interruption', break2w: "j'ai fait une pause de 2 à 3 semaines récemment", break3w: "j'ai fait une pause de 3 à 4 semaines", break1m: "j'ai fait une pause de plus d'un mois" };
  const ENV_LABELS: Record<TrainingEnv, string> = { flat: 'terrain plat uniquement, pas de côte', bump: 'petite butte, montées courtes (< 2 min)', hill: 'colline, montées 2-4 min', mountain: 'petite montagne, montées 4-6 min', cols: 'longs cols, montées prolongées' };
  const weeklyKmEst = ([0, 0, 0, 25, 35, 45, 55] as number[])[weeklySessions] ?? 25;
  const isTrail = goalType === 'trail';
  const raceTerrainLabel = isTrail ? 'trail (sentiers/montagne)' : trainingEnv === 'flat' ? 'route plate' : 'route vallonnée';

  return [
    `Voici toutes mes informations pour créer mon plan d'entraînement :`,
    ``,
    `TYPE D'OBJECTIF : ${GOAL_LABELS[goalType]}`,
    raceName ? `NOM DE LA COURSE : ${raceName}` : '',
    raceDistanceKm ? `DISTANCE : ${raceDistanceKm} km` : '',
    isTrail && raceElevationGain ? `DÉNIVELÉ POSITIF : ${raceElevationGain} m` : '',
    raceDate ? `DATE DE LA COURSE : ${raceDate}` : '',
    racePriority ? `IMPORTANCE : ${racePriority === 'main' ? 'objectif principal (pic de forme ce jour-là)' : 'objectif secondaire (pour se tester)'}` : '',
    ``,
    `MON PROFIL :`,
    `- Terrain de la course : ${raceTerrainLabel}`,
    `- État de forme actuel : ${FITNESS_LABELS[fitnessState]}`,
    `- Volume actuel estimé : ${weeklyKmEst} km/semaine en ${weeklySessions} séances`,
    `- Terrain d'entraînement disponible : ${ENV_LABELS[trainingEnv]}`,
    `- Blessures récentes : aucune`,
    `- Renforcement musculaire : 0 séance/semaine`,
    ``,
    `Tu as TOUTES les informations nécessaires. Ne pose AUCUNE question supplémentaire.`,
    `Génère directement le bloc <PROFILE> et le bloc <EXPLANATION>.`,
    `Pour goalTimeMin et thresholdPaceSec : utilise ton expertise de coach pour estimer un chrono réaliste selon ces données.`,
  ].filter(s => s !== null && s !== undefined && !(s === '' && false)).join('\n');
}

// ── Shared UI primitives ──────────────────────────────────────────────────────

function StepHeader({ step, onBack }: { step: number; onBack?: () => void }) {
  return (
    <div className="px-5 pt-14 pb-5 max-w-md mx-auto w-full">
      <div className="flex items-center gap-3 mb-4">
        {onBack ? (
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white border border-black/8 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : <div className="w-9 h-9 flex-shrink-0" />}
        <p className="flex-1 text-center text-[15px] font-semibold text-[#0F0F10]">Ajouter un objectif</p>
        <p className="text-[13px] font-semibold text-[#8E8E93] w-9 text-right flex-shrink-0">{step}/8</p>
      </div>
      <div className="h-1 bg-[#E5E5EA] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#0F0F10] rounded-full transition-all duration-500"
          style={{ width: `${(step / 8) * 100}%` }}
        />
      </div>
    </div>
  );
}

function RadioCard({
  selected, onSelect, title, subtitle, badge,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-[20px] bg-white border-2 transition-all ${selected ? 'border-[#0F0F10]' : 'border-transparent'}`}
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-bold text-[#0F0F10] leading-snug">{title}</p>
            {badge && (
              <span className="px-2 py-0.5 rounded-full bg-[#C8E635] text-[9px] font-black text-[#0F0F10] uppercase tracking-wide flex-shrink-0">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-[12px] text-[#8E8E93] mt-0.5 leading-snug">{subtitle}</p>}
        </div>
        <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${selected ? 'border-[#0F0F10] bg-[#0F0F10]' : 'border-[#D1D1D6]'}`}>
          {selected && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
        </div>
      </div>
    </button>
  );
}

function ContinueBtn({ disabled, onClick, label = 'Continuer' }: { disabled?: boolean; onClick: () => void; label?: string }) {
  return (
    <div className="fixed bottom-8 inset-x-0 px-5 max-w-md mx-auto left-0 right-0">
      <button
        disabled={disabled}
        onClick={onClick}
        className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black disabled:opacity-30 transition-all active:scale-[0.98]"
      >
        {label}
      </button>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }} />
      ))}
    </div>
  );
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

// ── Step 1 — Goal type ────────────────────────────────────────────────────────

const GOAL_CARDS: { id: GoalType; title: string; subtitle: string; color: string }[] = [
  { id: 'road',     title: 'Préparer une course route',    subtitle: 'Un plan construit pour ton prochain dossard',              color: '#1C3A5E' },
  { id: 'trail',    title: 'Préparer une course trail',    subtitle: "On t'accompagne sur tous les terrains, du 5km à l'ultra",  color: '#1A3A2A' },
  { id: 'beginner', title: 'Commencer à courir',           subtitle: 'Un programme pour apprendre les bases',                   color: '#3A2A1A' },
  { id: 'injury',   title: 'Reprendre après une blessure', subtitle: 'On sécurise ta reprise pour retrouver tes sensations',    color: '#3A1A1A' },
  { id: 'test',     title: 'Tester mon niveau',            subtitle: 'On définit ton profil avec un test sur 1500m',            color: '#2A1A3A' },
];

function Step1GoalType({ onSelect, images }: { onSelect: (t: GoalType) => void; images: string[] }) {
  const [selected, setSelected] = useState<GoalType | null>(null);

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <StepHeader step={1} />
      <div className="max-w-md mx-auto w-full px-5 pb-36 space-y-3">
        <h1 className="text-[22px] font-black text-[#0F0F10] mb-5">Quel est ton objectif&nbsp;?</h1>
        {GOAL_CARDS.map((card, i) => {
          const img = images.length > 0 ? images[i % images.length] : null;
          const active = selected === card.id;
          return (
            <button key={card.id} onClick={() => setSelected(card.id)}
              className={`w-full flex items-center gap-4 p-4 rounded-[20px] bg-white border-2 text-left transition-all ${active ? 'border-[#0F0F10]' : 'border-transparent'}`}
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <div className="w-[72px] h-[72px] rounded-[14px] overflow-hidden flex-shrink-0" style={{ backgroundColor: card.color }}>
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-[#0F0F10] leading-snug">{card.title}</p>
                <p className="text-[12px] text-[#8E8E93] mt-0.5 leading-snug">{card.subtitle}</p>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${active ? 'border-[#0F0F10] bg-[#0F0F10]' : 'border-[#D1D1D6]'}`}>
                {active && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
              </div>
            </button>
          );
        })}
      </div>
      <ContinueBtn disabled={!selected} onClick={() => selected && onSelect(selected)} />
    </div>
  );
}

// ── Step 2 — Race priority ────────────────────────────────────────────────────

function Step2Priority({ onSelect, onBack }: { onSelect: (p: 'main' | 'secondary') => void; onBack: () => void }) {
  const [selected, setSelected] = useState<'main' | 'secondary' | null>(null);

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <StepHeader step={2} onBack={onBack} />
      <div className="max-w-md mx-auto w-full px-5 pb-36">
        <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Comment envisages-tu cette course&nbsp;?</h2>
        <p className="text-[13px] text-[#8E8E93] mb-6">Ton plan s&apos;adapte à l&apos;importance de cet objectif</p>
        <div className="space-y-3">
          <RadioCard selected={selected === 'main'} onSelect={() => setSelected('main')}
            title="C'est un objectif principal"
            subtitle="Tout mon plan sera construit pour m'amener au pic de forme ce jour-là" />
          <RadioCard selected={selected === 'secondary'} onSelect={() => setSelected('secondary')}
            title="C'est un objectif secondaire"
            subtitle="Cette course s'intègre à ma routine pour me tester ou pour le plaisir" />
        </div>
      </div>
      <ContinueBtn disabled={!selected} onClick={() => selected && onSelect(selected)} />
    </div>
  );
}

// ── Step 3 — Race details ─────────────────────────────────────────────────────

function Step3RaceDetails({
  goalType, raceName, raceDate, raceDistanceKm, raceElevationGain, raceGoalTime,
  onChange, onConfirm, onBack,
}: {
  goalType: GoalType;
  raceName: string; raceDate: string; raceDistanceKm: string; raceElevationGain: string; raceGoalTime: string;
  onChange: (field: string, val: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const isTrail = goalType === 'trail';
  const canContinue = !!raceDistanceKm && Number(raceDistanceKm) > 0;

  const fields = [
    { key: 'raceName', label: 'NOM DE LA COURSE (OPTIONNEL)', placeholder: isTrail ? 'UTMB' : 'Marathon de Paris', type: 'text', value: raceName },
    { key: 'raceDate', label: 'DATE DE LA COURSE (OPTIONNEL)', placeholder: '', type: 'date', value: raceDate },
    { key: 'raceDistanceKm', label: 'DISTANCE (KM)', placeholder: isTrail ? '26' : '42', type: 'number', value: raceDistanceKm },
    ...(isTrail ? [{ key: 'raceElevationGain', label: 'DÉNIVELÉ POSITIF (M)', placeholder: '650', type: 'number', value: raceElevationGain }] : []),
    { key: 'raceGoalTime', label: 'CHRONO VISÉ (OPTIONNEL)', placeholder: isTrail ? '5h30' : '3h45', type: 'text', value: raceGoalTime },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <StepHeader step={3} onBack={onBack} />
      <div className="max-w-md mx-auto w-full px-5 pb-36">
        <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Dis-nous en plus sur ta course&nbsp;!</h2>
        <p className="text-[13px] text-[#8E8E93] mb-5">Pour personnaliser au mieux ton entraînement</p>
        <div className="space-y-3 mb-5">
          {fields.map((f) => (
            <div key={f.key} className="bg-white rounded-[20px] p-4" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-[0.12em] mb-2">{f.label}</p>
              <input
                type={f.type}
                value={f.value}
                onChange={(e) => onChange(f.key, e.target.value)}
                placeholder={f.placeholder}
                min={f.type === 'number' ? '0' : undefined}
                className="w-full text-[17px] font-semibold text-[#0F0F10] bg-transparent outline-none placeholder:text-[#D1D1D6]"
              />
            </div>
          ))}
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 text-[12px] text-[#8E8E93]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="#8E8E93" strokeWidth="1.5" />
            <path d="M8 7v4M8 5.5v.5" stroke="#8E8E93" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Pourquoi imposer une durée minimum ?
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm px-5 pb-8">
          <div className="w-full max-w-md bg-white rounded-[28px] p-6 space-y-4">
            <h3 className="text-[20px] font-black text-[#0F0F10]">Pourquoi imposer une durée minimum&nbsp;?</h3>
            <p className="text-[14px] text-[#8E8E93] leading-relaxed">
              On calcule ce délai en fonction de ta course objectif, son dénivelé, et de ton profil actuel. Ce délai est indispensable pour :
            </p>
            <div className="space-y-2">
              <p className="text-[14px] text-[#0F0F10]">✓ Progresser sans risque en respectant tes capacités actuelles</p>
              <p className="text-[14px] text-[#0F0F10]">✓ Garantir ta fraîcheur et ton succès le jour de la course</p>
            </div>
            <button onClick={() => setShowModal(false)}
              className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black transition-all active:scale-[0.98]">
              J&apos;ai compris
            </button>
          </div>
        </div>
      )}

      <ContinueBtn disabled={!canContinue} onClick={onConfirm} />
    </div>
  );
}

// ── Step 4 — Fitness state ────────────────────────────────────────────────────

function Step4FitnessState({ onSelect, onBack }: { onSelect: (s: FitnessState) => void; onBack: () => void }) {

  const [selected, setSelected] = useState<FitnessState | null>(null);
  const opts: { id: FitnessState; title: string; subtitle?: string }[] = [
    { id: 'active',  title: 'Non, je cours régulièrement' },
    { id: 'break2w', title: 'Oui, entre 2 et 3 semaines', subtitle: 'Légère pause récente' },
    { id: 'break3w', title: 'Oui, entre 3 et 4 semaines', subtitle: 'Reprise progressive conseillée' },
    { id: 'break1m', title: "Oui, plus d'un mois",         subtitle: 'On adoucira le début de ton programme' },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <StepHeader step={4} onBack={onBack} />
      <div className="max-w-md mx-auto w-full px-5 pb-36">
        <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">As-tu fait une pause ces dernières semaines&nbsp;?</h2>
        <p className="text-[13px] text-[#8E8E93] mb-6">Si oui, on adoucira ton début de programme</p>
        <div className="space-y-3">
          {opts.map((opt) => (
            <RadioCard key={opt.id} selected={selected === opt.id} onSelect={() => setSelected(opt.id)}
              title={opt.title} subtitle={opt.subtitle} />
          ))}
        </div>
      </div>
      <ContinueBtn disabled={!selected} onClick={() => selected && onSelect(selected)} />
    </div>
  );
}

// ── Step 5 — Physical profile (injuries + strength) ──────────────────────────

function Step5PhysicalProfile({
  onSelect, onBack,
}: {
  onSelect: (injuries: RecentInjuries, strength: StrengthPerWeek) => void;
  onBack: () => void;
}) {
  const [injuries, setInjuries] = useState<RecentInjuries | null>(null);
  const [strength, setStrength] = useState<StrengthPerWeek | null>(null);

  const injuryOpts: { id: RecentInjuries; title: string; subtitle?: string }[] = [
    { id: 'none',     title: 'Aucune blessure' },
    { id: 'knee',     title: 'Genou',            subtitle: 'Douleur, tendinite ou opération récente' },
    { id: 'achilles', title: "Tendon d'Achille",  subtitle: 'Tendinite ou déchirure récente' },
    { id: 'back',     title: 'Dos / hanche',      subtitle: 'Lombaires, sciatique ou hanche' },
    { id: 'other',    title: 'Autre',             subtitle: 'Précise à ton coach si besoin' },
  ];
  const strengthOpts: { val: StrengthPerWeek; title: string; subtitle?: string }[] = [
    { val: 0, title: '0 séance',           subtitle: 'Pas de renforcement actuellement' },
    { val: 1, title: '1 séance / semaine', subtitle: 'Gainage, muscu légère…' },
    { val: 2, title: '2 séances / semaine', subtitle: 'Programme de force régulier' },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <StepHeader step={5} onBack={onBack} />
      <div className="max-w-md mx-auto w-full px-5 pb-36 space-y-6">
        <div>
          <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Ton profil physique</h2>
          <p className="text-[13px] text-[#8E8E93]">Pour adapter les séances et la progression</p>
        </div>

        <div>
          <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-[0.1em] mb-2">Blessures récentes</p>
          <div className="space-y-2">
            {injuryOpts.map((opt) => (
              <RadioCard key={opt.id} selected={injuries === opt.id} onSelect={() => setInjuries(opt.id)}
                title={opt.title} subtitle={opt.subtitle} />
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-[0.1em] mb-2">Renforcement musculaire</p>
          <div className="space-y-2">
            {strengthOpts.map((opt) => (
              <RadioCard key={opt.val} selected={strength === opt.val} onSelect={() => setStrength(opt.val)}
                title={opt.title} subtitle={opt.subtitle} />
            ))}
          </div>
        </div>
      </div>
      <ContinueBtn
        disabled={injuries === null || strength === null}
        onClick={() => injuries !== null && strength !== null && onSelect(injuries, strength)}
      />
    </div>
  );
}

// ── Step 6 — Weekly rhythm ────────────────────────────────────────────────────

function Step6WeeklyRhythm({ onSelect, onBack }: { onSelect: (s: 3 | 4 | 5 | 6) => void; onBack: () => void }) {
  const [selected, setSelected] = useState<3 | 4 | 5 | 6 | null>(null);
  const opts: { sessions: 3 | 4 | 5 | 6; subtitle: string; badge?: string }[] = [
    { sessions: 3, subtitle: '12 à 20 km par semaine', badge: 'RECOMMANDÉ' },
    { sessions: 4, subtitle: '15 à 22 km par semaine' },
    { sessions: 5, subtitle: '17 à 25 km par semaine' },
    { sessions: 6, subtitle: '21 à 31 km par semaine' },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <StepHeader step={6} onBack={onBack} />
      <div className="max-w-md mx-auto w-full px-5 pb-36">
        <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">À quel rythme hebdo souhaites-tu t&apos;entraîner&nbsp;?</h2>
        <p className="text-[13px] text-[#8E8E93] mb-6">Choisis ce qui s&apos;adapte le mieux à ton quotidien</p>
        <div className="space-y-3">
          {opts.map((opt) => (
            <RadioCard key={opt.sessions}
              selected={selected === opt.sessions}
              onSelect={() => setSelected(opt.sessions)}
              title={`${opt.sessions} séances`}
              subtitle={opt.subtitle}
              badge={opt.badge} />
          ))}
        </div>
      </div>
      <ContinueBtn disabled={!selected} onClick={() => selected && onSelect(selected)} />
    </div>
  );
}

// ── Step 7 — Training environment ─────────────────────────────────────────────

function Step7TrainingEnv({ onSelect, onBack }: { onSelect: (e: TrainingEnv) => void; onBack: () => void }) {
  const [selected, setSelected] = useState<TrainingEnv | null>(null);
  const opts: { id: TrainingEnv; title: string; subtitle: string }[] = [
    { id: 'flat',     title: 'Pas de côte',       subtitle: 'Terrain plat uniquement' },
    { id: 'bump',     title: 'Petite butte',       subtitle: 'Montée < 2 min' },
    { id: 'hill',     title: 'Colline',            subtitle: 'Montée 2 à 4 min' },
    { id: 'mountain', title: 'Petite montagne',    subtitle: 'Montée 4 à 6 min' },
    { id: 'cols',     title: 'Longs cols',         subtitle: 'Montées prolongées' },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <StepHeader step={7} onBack={onBack} />
      <div className="max-w-md mx-auto w-full px-5 pb-36">
        <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">À quoi ressemble ton terrain de jeu&nbsp;?</h2>
        <p className="text-[13px] text-[#8E8E93] mb-6">Pour adapter tes séances de côte</p>
        <div className="space-y-3">
          {opts.map((opt) => (
            <RadioCard key={opt.id} selected={selected === opt.id} onSelect={() => setSelected(opt.id)}
              title={opt.title} subtitle={opt.subtitle} />
          ))}
        </div>
      </div>
      <ContinueBtn disabled={!selected} onClick={() => selected && onSelect(selected)} />
    </div>
  );
}

// ── Step 7 — Result ───────────────────────────────────────────────────────────

function Step7Result({
  goalType, raceName, raceDistanceKm, raceElevationGain, raceDate,
  fitnessState, weeklySessions, garminPaceSec, garminVO2Max, garminLTSpeedMps, image,
  onLaunch, launching, launchStatus, streamText, onBack,
}: {
  goalType: GoalType;
  raceName: string; raceDistanceKm: string; raceElevationGain: string; raceDate: string;
  fitnessState: FitnessState; weeklySessions: 3 | 4 | 5 | 6;
  garminPaceSec?: number;
  garminVO2Max?: number;
  garminLTSpeedMps?: number;
  image?: string;
  onLaunch: () => void;
  launching: boolean;
  launchStatus?: string;
  streamText?: string;
  onBack: () => void;
}) {
  const dist = parseFloat(raceDistanceKm) || 10;
  const elev = parseFloat(raceElevationGain) || 0;
  const isTrail = goalType === 'trail';
  const estimatedMin = estimateFinishMin(dist, elev, isTrail, weeklySessions, fitnessState, garminPaceSec, garminVO2Max, garminLTSpeedMps);

  const fmtPaceSec = (sec: number) => `${Math.floor(sec / 60)}'${String(Math.round(sec % 60)).padStart(2, '0')}''`;
  const fitMult: Record<FitnessState, number> = { active: 1.0, break2w: 1.12, break3w: 1.20, break1m: 1.30 };
  const fitLabel: Record<FitnessState, string> = { active: '', break2w: ' × 1.12 (reprise légère)', break3w: ' × 1.20 (reprise modérée)', break1m: ' × 1.30 (reprise longue)' };
  const effectiveKm = isTrail ? dist + elev / 100 : dist;

  const calcSteps: string[] = (() => {
    // P1 — Lactate threshold
    if (garminLTSpeedMps && garminLTSpeedMps > 0) {
      const ltPaceSecKm = 1000 / garminLTSpeedMps;
      const ltFactor = isTrail ? 1.12 : dist >= 25 ? 1.10 : dist >= 17 ? 1.03 : dist >= 8 ? 0.97 : 0.94;
      const adjustedLTPace = ltPaceSecKm * fitMult[fitnessState];
      const racePaceSec = adjustedLTPace * ltFactor;
      return [
        `Seuil lactique Garmin : ${fmtPaceSec(ltPaceSecKm)}/km`,
        ...(fitnessState !== 'active' ? [`Ajustement forme${fitLabel[fitnessState]} → ${fmtPaceSec(adjustedLTPace)}/km`] : []),
        `Facteur course ×${ltFactor} → allure cible : ${fmtPaceSec(racePaceSec)}/km`,
        ...(isTrail && elev > 0 ? [`Naismith : ${dist}km + ${elev}m D+ ÷ 100 = ${effectiveKm.toFixed(1)} km effectifs`] : []),
        `${effectiveKm.toFixed(1)} km × ${fmtPaceSec(racePaceSec)} = ${formatTime(estimatedMin)}`,
      ];
    }
    // P2 — VO2max
    if (garminVO2Max && garminVO2Max > 10) {
      const intensity = isTrail ? 0.82 : dist >= 25 ? 0.84 : dist >= 17 ? 0.89 : dist >= 8 ? 0.93 : 0.95;
      const targetVO2 = garminVO2Max * intensity;
      const v = (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (targetVO2 + 4.60))) / (2 * 0.000104);
      const roadPaceSec = (60000 / v) * fitMult[fitnessState];
      const racePaceSec = isTrail ? roadPaceSec * 1.10 : roadPaceSec;
      return [
        `VO2max Garmin : ${garminVO2Max} ml/kg/min`,
        `Intensité course : ${Math.round(intensity * 100)}% VO2max → formule VDOT`,
        ...(fitnessState !== 'active' ? [`Ajustement forme${fitLabel[fitnessState]}`] : []),
        ...(isTrail ? [`Trail ×1.10 + Naismith (${effectiveKm.toFixed(1)} km effectifs)`] : []),
        `Allure calculée : ${fmtPaceSec(racePaceSec)}/km → ${formatTime(estimatedMin)}`,
      ];
    }
    // P3 — Avg training pace
    if (garminPaceSec && garminPaceSec > 0) {
      const adjustedPaceSec = garminPaceSec * fitMult[fitnessState];
      const racePaceSec = adjustedPaceSec * 0.93;
      return [
        `Allure entraînement : ${fmtPaceSec(garminPaceSec)}/km (moy. 10 dernières sorties)`,
        ...(fitnessState !== 'active' ? [`Ajustement forme${fitLabel[fitnessState]} → ${fmtPaceSec(adjustedPaceSec)}/km`] : []),
        `Effort course ×0.93 → ${fmtPaceSec(racePaceSec)}/km`,
        ...(isTrail && elev > 0 ? [`Naismith : ${dist}km + ${elev}m D+ ÷ 100 = ${effectiveKm.toFixed(1)} km effectifs`] : []),
        `${effectiveKm.toFixed(1)} km × ${fmtPaceSec(racePaceSec)} = ${formatTime(estimatedMin)}`,
      ];
    }
    // P4 — Generic
    const km = ([0, 0, 0, 25, 35, 45, 55] as number[])[weeklySessions] ?? 25;
    const basePace = km >= 50 ? 5.5 : km >= 35 ? 6.2 : km >= 25 ? 7.0 : 8.0;
    const adjPace = basePace * fitMult[fitnessState];
    return [
      `Estimation par défaut (pas de données Garmin)`,
      `Volume estimé : ${km} km/sem → allure de base : ${fmtPaceSec(adjPace * 60)}/km`,
      ...(isTrail ? [`Trail ×1.5 + ${elev}m D+ ÷ 8 → estimation globale`] : []),
      `${dist} km × ${fmtPaceSec(adjPace * 60)} = ${formatTime(estimatedMin)}`,
    ];
  })();

  const GOAL_LABELS: Record<GoalType, string> = {
    road: 'Course route', trail: 'Trail', beginner: 'Débutant', injury: 'Reprise', test: 'Test niveau',
  };
  const raceLabel = raceName || GOAL_LABELS[goalType];
  const statsLine = [
    raceDistanceKm ? `${raceDistanceKm} km` : null,
    isTrail && raceElevationGain ? `${raceElevationGain} D+` : null,
  ].filter(Boolean).join(' · ');

  const totalWeeksEst = (() => {
    if (!raceDate) return 12;
    const diff = Math.round((new Date(raceDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7));
    return Math.max(4, Math.min(diff, 24));
  })();

  return (
    <div className="min-h-screen bg-[#0F0F10] flex flex-col relative overflow-hidden">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/80" />

      <div className="relative z-10 px-5 pt-14 max-w-md mx-auto w-full">
        <button onClick={onBack} className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="relative z-10 flex flex-col flex-1 px-5 pb-36 pt-8 max-w-md mx-auto w-full justify-center">
        <p className="text-[12px] font-semibold text-white/40 uppercase tracking-[0.2em] mb-2">Ton objectif</p>
        <h1 className="text-[34px] font-black text-white leading-tight mb-1">{raceLabel}</h1>
        {statsLine && <p className="text-[16px] text-white/50 mb-10">{statsLine}</p>}

        <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-[28px] p-6 mb-4">
          <p className="text-[11px] font-semibold text-white/40 uppercase tracking-[0.15em] mb-3">Ta prévision de chrono</p>
          <p className="text-[56px] font-black text-white tabular-nums leading-none tracking-tight">{formatTime(estimatedMin)}</p>
          <div className="mt-4 pt-4 border-t border-white/10 space-y-1.5">
            {calcSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[10px] text-white/25 font-semibold mt-0.5 flex-shrink-0">{i + 1}</span>
                <p className={`text-[11px] leading-snug ${i === calcSteps.length - 1 ? 'text-white/70 font-semibold' : 'text-white/35'}`}>{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Durée du plan', value: `${totalWeeksEst} sem.` },
            { label: 'Séances / semaine', value: `${weeklySessions} × sem.` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white/8 border border-white/10 rounded-[20px] p-4 text-center">
              <p className="text-[22px] font-black text-white">{value}</p>
              <p className="text-[10px] font-semibold text-white/40 uppercase tracking-[0.08em] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {launching && (
        <div className="fixed inset-0 z-30 bg-black/95 backdrop-blur-sm flex flex-col px-5 pt-16 pb-6 overflow-hidden">
          <div className="flex items-center gap-3 mb-4 flex-shrink-0">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin flex-shrink-0" />
            <p className="text-white text-[13px] font-semibold">{launchStatus || 'Gemini génère ton plan…'}</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <pre className="text-[11px] text-[#C8E635]/80 font-mono leading-relaxed whitespace-pre-wrap">{streamText}</pre>
          </div>
          <p className="text-white/20 text-[11px] mt-3 flex-shrink-0 text-center">Propulsé par Gemini 2.5 Flash</p>
        </div>
      )}

      <div className="fixed bottom-8 inset-x-0 px-5 max-w-md mx-auto z-20 left-0 right-0">
        <button onClick={onLaunch} disabled={launching}
          className="w-full py-4 rounded-[20px] bg-white text-[#0F0F10] text-[15px] font-black disabled:opacity-50 transition-all active:scale-[0.98]">
          {launching ? 'Génération en cours…' : 'Découvrir mon plan →'}
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

// ── Summary screen ────────────────────────────────────────────────────────────

function SummaryScreen({
  loading, text, onNext,
  goalType, raceName, raceDistanceKm, raceElevationGain, raceDate,
  fitnessState, weeklySessions, hasGarmin,
}: {
  loading: boolean;
  text: string;
  onNext: () => void;
  goalType: GoalType;
  raceName: string; raceDistanceKm: string; raceElevationGain: string; raceDate: string;
  fitnessState: FitnessState | null; weeklySessions: 3 | 4 | 5 | 6 | null;
  hasGarmin: boolean;
}) {
  const GOAL_LABELS: Record<GoalType, string> = {
    road: 'Course route', trail: 'Trail', beginner: 'Débutant', injury: 'Reprise', test: 'Test',
  };
  const FITNESS_LABELS: Record<FitnessState, string> = {
    active: 'En forme', break2w: 'Pause 2-3 sem.', break3w: 'Pause 3-4 sem.', break1m: 'Pause > 1 mois',
  };

  const chips = [
    GOAL_LABELS[goalType],
    raceName || null,
    raceDistanceKm ? `${raceDistanceKm} km` : null,
    raceElevationGain && goalType === 'trail' ? `${raceElevationGain} D+` : null,
    raceDate ? new Date(raceDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
    fitnessState ? FITNESS_LABELS[fitnessState] : null,
    weeklySessions ? `${weeklySessions} séances/sem.` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <div className="px-5 pt-14 pb-5 max-w-md mx-auto w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 flex-shrink-0" />
          <p className="flex-1 text-center text-[15px] font-semibold text-[#0F0F10]">Ajouter un objectif</p>
          <p className="text-[13px] font-semibold text-[#8E8E93] w-9 text-right flex-shrink-0">8/8</p>
        </div>
        <div className="h-1 bg-[#E5E5EA] rounded-full overflow-hidden">
          <div className="h-full bg-[#0F0F10] rounded-full" style={{ width: '92%' }} />
        </div>
      </div>

      <div className="max-w-md mx-auto w-full px-5 pb-36 space-y-4">
        <div>
          <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Prompt Gemini</h2>
          <p className="text-[13px] text-[#8E8E93]">Contexte exact envoyé à l&apos;IA pour générer ton plan</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span key={chip} className="px-3 py-1.5 rounded-full bg-white border border-black/8 text-[12px] font-semibold text-[#0F0F10]"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              {chip}
            </span>
          ))}
          {hasGarmin && (
            <span className="px-3 py-1.5 rounded-full bg-[#C8E635]/15 border border-[#C8E635]/30 text-[12px] font-semibold text-[#5A6A00]">
              Garmin connecté
            </span>
          )}
        </div>

        <div className="bg-[#0F0F10] rounded-[24px] p-5" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <p className="text-[12px] font-bold text-white uppercase tracking-[0.08em]">Prompt Gemini</p>
          </div>
          {loading ? (
            <div className="space-y-2">
              <div className="h-2.5 bg-white/10 rounded-full w-full animate-pulse" />
              <div className="h-2.5 bg-white/10 rounded-full w-4/5 animate-pulse" />
              <div className="h-2.5 bg-white/10 rounded-full w-full animate-pulse" />
              <div className="h-2.5 bg-white/10 rounded-full w-3/4 animate-pulse" />
              <div className="h-2.5 bg-white/10 rounded-full w-full animate-pulse" />
            </div>
          ) : (
            <pre className="text-[11px] text-white/70 leading-relaxed whitespace-pre-wrap font-mono overflow-y-auto max-h-[400px]">{text}</pre>
          )}
        </div>

        <div className="bg-[#0F0F10] rounded-[20px] p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-[10px] bg-[#C8E635]/20 flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8E635" strokeWidth="2.5" strokeLinecap="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div>
            <p className="text-[12px] font-bold text-white">Étape suivante</p>
            <p className="text-[11px] text-white/40">Calcul du chrono et génération du plan</p>
          </div>
        </div>
      </div>

      <ContinueBtn disabled={loading} onClick={onNext} label="Voir ma prévision →" />
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
  onSubmit, onSkip,
}: {
  initialChoice: DistanceChoice | null;
  initialTrailKm: string;
  initialTrailDPlus: string;
  initialDate: string;
  initialGoalTime: string;
  initialDays: number[];
  garminDays?: number[];
  onSubmit: (data: { choice: DistanceChoice; trailKm: string; trailDPlus: string; date: string; goalTime: string; days: number[] }) => void;
  onSkip: () => void;
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
          <button onClick={onSkip}
            className="w-full text-[11px] text-[#8E8E93] py-2">Passer en mode questionnaire détaillé</button>
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
  const bottomRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('garmin');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<TrainingPlan | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Onboarding state
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [raceDate, setRaceDate] = useState('');
  const [raceName, setRaceName] = useState('');
  const [raceDistanceKm, setRaceDistanceKm] = useState('');
  const [raceElevationGain, setRaceElevationGain] = useState('');
  const [raceGoalTime, setRaceGoalTime] = useState('');
  const [fitnessState, setFitnessState] = useState<FitnessState | null>(null);
  const [recentInjuries, setRecentInjuries] = useState<RecentInjuries | null>(null);
  const [strengthPerWeek, setStrengthPerWeek] = useState<StrengthPerWeek | null>(null);
  const [weeklySessions, setWeeklySessions] = useState<3 | 4 | 5 | 6 | null>(null);
  const [trainingEnv, setTrainingEnv] = useState<TrainingEnv | null>(null);
  const [blobImages, setBlobImages] = useState<string[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState('');
  const [streamText, setStreamText] = useState('');
  const [racePriority, setRacePriority] = useState<'main' | 'secondary' | null>(null);
  const [goalAssessment, setGoalAssessment] = useState<GoalAssessment | null>(null);
  const [garminSummary, setGarminSummary] = useState<GarminActivitySummary | null>(null);

  // New lean onboarding state
  const [distChoice, setDistChoice] = useState<DistanceChoice | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [predictedMin, setPredictedMin] = useState<number | null>(null);
  const [parsedGoalMin, setParsedGoalMin] = useState<number | null>(null);

  // Summary screen
  const [summaryText, setSummaryText] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);

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

  const triggerSummary = (onboarding: Partial<OnboardingData>, garmin?: GarminActivitySummary) => {
    setSummaryText('');
    setSummaryLoading(true);
    setPhase('summary');
    fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarding, garmin, preview: true }),
    })
      .then(r => r.json())
      .then((d: { prompt?: string }) => setSummaryText(d.prompt ?? ''))
      .catch(() => setSummaryText('Erreur lors du chargement du prompt.'))
      .finally(() => setSummaryLoading(false));
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
        raceName: raceName || undefined,
        raceDate: raceDate || undefined,
        raceDistanceKm: raceDistanceKm || undefined,
        raceElevationGain: raceElevationGain || undefined,
        racePriority: racePriority ?? undefined,
        fitnessState: fitnessState ?? 'active',
        recentInjuries: recentInjuries ?? 'none',
        strengthPerWeek: strengthPerWeek ?? 0,
        weeklySessions: weeklySessions ?? 3,
        trainingEnv: trainingEnv ?? 'flat',
        raceGoalTime: raceGoalTime || undefined,
        availableDays: selectedDays.length >= 3 ? selectedDays : undefined,
      };

      // 3. Gemini computes everything: profile + goal assessment + sessions
      const plan = await fetchGeminiPlan(onboarding, garmin);
      setGeneratedPlan(plan);
      setPhase('preview');
    } catch (err) {
      console.error('[step7Launch]', err);
      const profile = buildProfile(goalType ?? 'road', raceDate, raceDistanceKm, raceElevationGain, fitnessState ?? 'active', weeklySessions ?? 3, trainingEnv ?? 'flat');
      try { setGeneratedPlan(generatePlan(profile)); } catch { setGeneratedPlan({ id: `plan_${Date.now()}`, createdAt: new Date().toISOString(), profile, sessions: [] }); }
      setPhase('preview');
    } finally {
      setLaunching(false);
      setLaunchStatus('');
    }
  };

  useEffect(() => {
    fetch('/api/blob-images')
      .then(r => r.json())
      .then((d: { all?: string[] }) => setBlobImages(d.all ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const force = searchParams.get('force') === '1';
    const tokens = loadGarminTokens();
    const garminId = loadGarminUserId();
    const alreadyAuthed = !!tokens || !!garminId;

    const saved = loadChatMessages();
    if (saved.length > 0 && !force) {
      setMessages(saved);
      setPhase('chat');
      setInitialized(true);
      return;
    }

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || thinking) return;
    const userMsg: ChatMessage = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    saveChatMessages(newMessages);
    setInput('');
    setThinking(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      let data: { message?: string; profile?: UserProfile; error?: string };
      try { data = await res.json() as typeof data; }
      catch { throw new Error(`Erreur serveur (HTTP ${res.status})`); }
      if (data.error) throw new Error(data.error);
      if (data.profile) {
        const botMsg: ChatMessage = { role: 'model', content: data.message ?? 'Voici ton plan !' };
        const final = [...newMessages, botMsg];
        setMessages(final);
        saveChatMessages(final);
        setThinking(false);
        setLaunching(true);
        // Fetch Garmin activities to enrich plan generation
        let garmin: GarminActivitySummary | undefined;
        const tokens = loadGarminTokens();
        if (tokens) {
          setLaunchStatus('Récupération de tes courses Garmin…');
          try {
            const gr = await fetch('/api/garmin/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ garminTokens: tokens }) });
            const gd = await gr.json() as { summary?: GarminActivitySummary };
            garmin = gd.summary ?? undefined;
          } catch { /* non-fatal */ }
        }
        const chatOnboarding: OnboardingData = {
          goalType: data.profile.terrain === 'trail' ? 'trail' : 'road',
          fitnessState: 'active',
          recentInjuries: 'none',
          strengthPerWeek: 0,
          weeklySessions: (data.profile.availableDays?.length as 3 | 4 | 5 | 6) ?? 3,
          trainingEnv: data.profile.terrain === 'trail' ? 'mountain' : data.profile.terrain === 'hilly' ? 'hill' : 'flat',
          raceDate: data.profile.goalDate,
          raceGoalTime: data.profile.goalTimeMin ? String(data.profile.goalTimeMin) : undefined,
        };
        const plan = await fetchGeminiPlan(chatOnboarding, garmin);
        setLaunching(false);
        setLaunchStatus('');
        setGeneratedPlan(plan);
        setPhase('preview');
      } else if (data.message) {
        const botMsg: ChatMessage = { role: 'model', content: data.message };
        const final = [...newMessages, botMsg];
        setMessages(final);
        saveChatMessages(final);
      } else {
        throw new Error('Réponse vide du serveur');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      const errMsg: ChatMessage = { role: 'model', content: `⚠️ ${msg}` };
      setMessages([...newMessages, errMsg]);
      saveChatMessages([...newMessages, errMsg]);
    } finally {
      setThinking(false);
    }
  };

  // ── Phase renders ──────────────────────────────────────────────────────────

  if (phase === 'summary') return (
    <SummaryScreen
      loading={summaryLoading}
      text={summaryText}
      onNext={() => setPhase('step8')}
      goalType={goalType ?? 'road'}
      raceName={raceName} raceDistanceKm={raceDistanceKm}
      raceElevationGain={raceElevationGain} raceDate={raceDate}
      fitnessState={fitnessState} weeklySessions={weeklySessions}
      hasGarmin={!!garminSummary}
    />
  );

  if (phase === 'garmin') return <GarminConnectStep onConnected={handleGarminConnected} onSkip={() => { setPhase('target'); setInitialized(true); }} />;

  if (phase === 'loading' || !initialized) return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-center gap-3">
      <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
      <p className="text-[12px] text-[#8E8E93]">Chargement de ton profil…</p>
    </div>
  );

  if (phase === 'target') {
    // Derive default days from Garmin habits if available
    const garminDays = garminSummary?.runs && garminSummary.runs.length > 0
      ? Array.from(new Set(garminSummary.runs.slice(0, 20).map(r => {
          const d = new Date(r.date).getDay();
          return d === 0 ? 7 : d; // Sunday → 7
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
          // 1. Persist user choices into existing onboarding state
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
          setRacePriority('main');
          setFitnessState('active');
          setRecentInjuries('none');
          setStrengthPerWeek(0);
          setTrainingEnv('flat');

          // 2. Fetch Garmin summary if not loaded yet
          let g: GarminActivitySummary | undefined = garminSummary ?? undefined;
          if (!g) g = await fetchGarminSummary();

          // 3. Compute prediction
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
        onSkip={() => setPhase('step1')}
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

  if (phase === 'step1') return (
    <Step1GoalType images={blobImages} onSelect={(t) => { setGoalType(t); setPhase('step2'); }} />
  );

  if (phase === 'step2') return (
    <Step2Priority
      onSelect={(p) => { setRacePriority(p); setPhase('step3'); }}
      onBack={() => setPhase('step1')}
    />
  );

  if (phase === 'step3') return (
    <Step3RaceDetails
      goalType={goalType ?? 'road'}
      raceName={raceName} raceDate={raceDate}
      raceDistanceKm={raceDistanceKm} raceElevationGain={raceElevationGain}
      raceGoalTime={raceGoalTime}
      onChange={(field, val) => {
        if (field === 'raceName') setRaceName(val);
        else if (field === 'raceDate') setRaceDate(val);
        else if (field === 'raceDistanceKm') setRaceDistanceKm(val);
        else if (field === 'raceElevationGain') setRaceElevationGain(val);
        else if (field === 'raceGoalTime') setRaceGoalTime(val);
      }}
      onConfirm={() => setPhase('step4')}
      onBack={() => setPhase('step2')}
    />
  );

  if (phase === 'step4') return (
    <Step4FitnessState
      onSelect={(s) => { setFitnessState(s); setPhase('step5'); }}
      onBack={() => setPhase('step3')}
    />
  );

  if (phase === 'step5') return (
    <Step5PhysicalProfile
      onSelect={(inj, str) => { setRecentInjuries(inj); setStrengthPerWeek(str); setPhase('step6'); }}
      onBack={() => setPhase('step4')}
    />
  );

  if (phase === 'step6') return (
    <Step6WeeklyRhythm
      onSelect={(s) => { setWeeklySessions(s); setPhase('step7'); }}
      onBack={() => setPhase('step5')}
    />
  );

  if (phase === 'step7') return (
    <Step7TrainingEnv
      onSelect={(e) => {
        setTrainingEnv(e);
        const onboarding: Partial<OnboardingData> = {
          goalType: goalType ?? undefined, racePriority: racePriority ?? undefined,
          raceName: raceName || undefined, raceDate: raceDate || undefined,
          raceDistanceKm: raceDistanceKm || undefined, raceElevationGain: raceElevationGain || undefined,
          raceGoalTime: raceGoalTime || undefined, fitnessState: fitnessState ?? undefined,
          recentInjuries: recentInjuries ?? undefined, strengthPerWeek: strengthPerWeek ?? undefined,
          weeklySessions: weeklySessions ?? undefined, trainingEnv: e,
        };
        if (!garminSummary) {
          fetchGarminSummary().then(g => triggerSummary(onboarding, g)).catch(() => triggerSummary(onboarding));
        } else {
          triggerSummary(onboarding, garminSummary);
        }
      }}
      onBack={() => setPhase('step6')}
    />
  );

  if (phase === 'step8') return (
    <Step7Result
      goalType={goalType ?? 'road'}
      raceName={raceName} raceDistanceKm={raceDistanceKm}
      raceElevationGain={raceElevationGain} raceDate={raceDate}
      fitnessState={fitnessState ?? 'active'}
      weeklySessions={weeklySessions ?? 3}
      garminPaceSec={garminSummary?.recentAvgPaceSecKm}
      garminVO2Max={garminSummary?.vo2Max}
      garminLTSpeedMps={garminSummary?.lactateThresholdSpeedMps}
      image={blobImages[goalType === 'trail' ? 1 : 0] ?? blobImages[0]}
      onLaunch={handleStep7Launch}
      launching={launching}
      launchStatus={launchStatus}
      streamText={streamText}
      onBack={() => setPhase('summary')}
    />
  );

  if (phase === 'preview' && generatedPlan) return (
    <PlanPreview
      plan={generatedPlan}
      goalAssessment={goalAssessment}
      garmin={garminSummary}
      onConfirm={handleConfirmPlan}
      onBack={() => setPhase('step7')}
      onPlanUpdate={setGeneratedPlan}
    />
  );

  // ── Resumed chat phase ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col relative">
      {launching && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col px-5 pt-16 pb-6 overflow-hidden">
          <div className="flex items-center gap-3 mb-4 flex-shrink-0">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin flex-shrink-0" />
            <p className="text-white text-[13px] font-semibold">{launchStatus || 'Gemini génère ton plan…'}</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <pre className="text-[11px] text-[#C8E635]/80 font-mono leading-relaxed whitespace-pre-wrap">{streamText}</pre>
          </div>
          <p className="text-white/20 text-[11px] mt-3 flex-shrink-0 text-center">Propulsé par Gemini 2.5 Flash</p>
        </div>
      )}
      <div className="max-w-md mx-auto w-full px-4 pt-14 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[12px] bg-[#0F0F10] flex items-center justify-center flex-shrink-0">
            <span className="text-[#C8E635] font-black text-[14px]">CC</span>
          </div>
          <div>
            <p className="text-[15px] font-black text-[#0F0F10]">RunAI</p>
            <p className="text-[11px] text-[#8E8E93]">Création de ton plan</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-w-md mx-auto w-full px-4 py-2 space-y-3">
        {messages.filter(m => !m.hidden).map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] px-4 py-3 rounded-[18px] text-[14px] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#0F0F10] text-white rounded-br-[6px]'
                : 'bg-white border border-black/5 text-[#0F0F10] rounded-bl-[6px]'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="bg-white border border-black/5 rounded-[18px] rounded-bl-[6px]">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="max-w-md mx-auto w-full pb-8 pt-1 flex-shrink-0">
        {!thinking && (() => {
          const lastBot = [...messages].reverse().find(m => m.role === 'model' && !m.hidden);
          const chips = lastBot ? getQuickReplies(lastBot.content, messages) : [];
          if (!chips.length) return null;
          return (
            <div className="flex gap-2 overflow-x-auto pb-2 px-4 scrollbar-none">
              {chips.map((chip) => (
                <button key={chip} onClick={() => sendMessage(chip)}
                  className="flex-shrink-0 px-4 py-2 rounded-full bg-white border border-black/8 text-[12px] font-semibold text-[#0F0F10] whitespace-nowrap transition-all active:scale-[0.96] active:bg-[#F2F2F7]">
                  {chip}
                </button>
              ))}
            </div>
          );
        })()}
        <div className="flex items-end gap-2 px-4">
          <div className="flex-1 flex items-center bg-white border border-black/8 rounded-[20px] px-4 py-3 gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder="Écris ta réponse..."
              className="flex-1 bg-transparent text-[14px] text-[#0F0F10] placeholder:text-[#8E8E93] outline-none" />
          </div>
          <button onClick={() => sendMessage(input)} disabled={!input.trim() || thinking}
            className="w-11 h-11 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-all active:scale-[0.93]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
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
