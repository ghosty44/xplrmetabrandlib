import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import type { GarminActivitySummary } from '@/app/api/garmin/activities/route';
import type { UserProfile } from '@/lib/types';

export const maxDuration = 60;

export interface OnboardingData {
  goalType: 'road' | 'trail' | 'beginner' | 'injury' | 'test';
  raceName?: string;
  raceDate?: string;
  raceDistanceKm?: string;
  raceElevationGain?: string;
  racePriority?: 'main' | 'secondary';
  fitnessState: 'active' | 'break2w' | 'break3w' | 'break1m';
  weeklySessions: 3 | 4 | 5 | 6;
  trainingEnv: 'flat' | 'bump' | 'hill' | 'mountain' | 'cols';
  raceGoalTime?: string;
}

export interface GeminiSession {
  week: number;
  day: number;
  name: string;
  totalMin: number;
  km?: number;
  intensity: 'easy' | 'moderate' | 'hard' | 'long' | 'recovery' | 'strength' | 'hill';
  description: string;
}

export interface GoalAssessment {
  userMin: number | null;
  realisticMin: number;
  achievableMin: number;
  verdict: 'réaliste' | 'ambitieux' | 'sous-estimé' | 'excellent';
  message: string;
}

// ── Context builder — assembles athlete data into a clean structured block ─────

function fmtPaceSec(sec: number): string {
  if (!sec) return '?';
  return `${Math.floor(sec / 60)}'${(sec % 60).toString().padStart(2, '0')}''/km`;
}

function buildAthleteContext(onboarding: OnboardingData, garmin?: GarminActivitySummary): string {
  const FITNESS_LABELS: Record<string, string> = {
    active: 'actif — court régulièrement sans interruption récente',
    break2w: 'pause récente de 2 à 3 semaines',
    break3w: 'pause récente de 3 à 4 semaines',
    break1m: "pause de plus d'un mois",
  };
  const ENV_LABELS: Record<string, string> = {
    flat: 'terrain plat uniquement',
    bump: 'petites bosses, montées < 2 min',
    hill: 'collines, montées 2–4 min',
    mountain: 'petite montagne, montées 4–6 min',
    cols: 'longs cols, montées prolongées',
  };
  const GOAL_LABELS: Record<string, string> = {
    road: 'course sur route',
    trail: 'trail',
    beginner: 'programme débutant',
    injury: 'reprise après blessure',
    test: 'test de niveau',
  };

  const dist = parseFloat(onboarding.raceDistanceKm ?? '0');
  const elev = parseFloat(onboarding.raceElevationGain ?? '0');
  const isTrail = onboarding.goalType === 'trail';

  const lines: string[] = [
    `Date du jour : ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
    '',
    '── Objectif ──',
    `Type : ${GOAL_LABELS[onboarding.goalType]}`,
  ];

  if (onboarding.raceName) lines.push(`Course : ${onboarding.raceName}`);
  if (dist > 0) lines.push(`Distance : ${dist} km`);
  if (isTrail && elev > 0) lines.push(`Dénivelé positif : ${elev} m D+`);
  if (onboarding.raceDate) lines.push(`Date de course : ${onboarding.raceDate}`);
  if (onboarding.racePriority) lines.push(`Priorité : ${onboarding.racePriority === 'main' ? 'objectif principal' : 'objectif secondaire'}`);
  if (onboarding.raceGoalTime) lines.push(`Chrono visé : ${onboarding.raceGoalTime}`);

  lines.push(
    '',
    '── Profil athlète ──',
    `État de forme : ${FITNESS_LABELS[onboarding.fitnessState]}`,
    `Séances souhaitées : ${onboarding.weeklySessions} par semaine`,
    `Terrain d'entraînement : ${ENV_LABELS[onboarding.trainingEnv]}`,
    `Blessures récentes : aucune signalée`,
    `Renforcement musculaire : 0 séance/semaine`,
  );

  if (garmin) {
    const fmtMps = (mps: number) => {
      const sec = Math.round(1000 / mps);
      return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}''/km`;
    };
    lines.push(
      '',
      '── Données Garmin réelles ──',
      ...(garmin.vo2Max ? [`VO2max : ${garmin.vo2Max} ml/kg/min`] : []),
      ...(garmin.lactateThresholdSpeedMps ? [`Allure seuil lactique : ${fmtMps(garmin.lactateThresholdSpeedMps)}`] : []),
      ...(garmin.lactateThresholdHR ? [`FC seuil lactique : ${garmin.lactateThresholdHR} bpm`] : []),
      `Volume moyen (4 sem) : ${garmin.weeklyKm4w} km/semaine`,
      `Volume moyen (8 sem) : ${garmin.weeklyKm8w} km/semaine`,
      `Sortie longue max (8 sem) : ${garmin.longestRunKm} km`,
      `Séances/semaine réelles : ${garmin.avgSessionsPerWeek}`,
      `Allure moyenne récente : ${fmtPaceSec(garmin.recentAvgPaceSecKm)}`,
      '',
      `Dernières sorties (${Math.min(garmin.runs.length, 20)}) :`,
    );
    for (const r of garmin.runs.slice(0, 20)) {
      const pace = fmtPaceSec(r.paceSecKm);
      const hr = r.avgHR ? ` · ${r.avgHR}bpm` : '';
      const elevStr = r.elevationGain ? ` · +${r.elevationGain}m` : '';
      const tag = r.isTrail ? ' [TRAIL]' : '';
      lines.push(`  ${r.date}  ${r.distanceKm}km  ${r.durationMin}min  ${pace}${hr}${elevStr}${tag}`);
    }
    lines.push(
      '',
      '→ Priorité absolue : calibre TOUTES les allures et le volume sur ces données réelles.',
      '→ Ces données corrigent allures/volume — PAS le nombre de séances par semaine.',
    );
  } else {
    lines.push('', '── Données Garmin : non disponibles ──');
  }

  return lines.join('\n');
}

// ── Prompt template — pure generation instructions, no athlete data ────────────

function buildPlanPrompt(athleteContext: string, weeksCount: number, sessionsPerWeek: number, isTrail: boolean): string {
  return `Tu es RunAI, coach de course à pied expert. Tu reçois le contexte structuré d'un athlète et tu génères son plan d'entraînement complet.

CONTEXTE ATHLÈTE :
${athleteContext}

DONNÉES MANQUANTES :
Si une donnée est absente du contexte, applique ces valeurs par défaut :
- séances/semaine : 3
- terrain : flat
- renforcement musculaire : 0
- blessures : aucune
- données Garmin : non disponibles (utilise l'état de forme et le chrono visé)

MISSION : Génère un plan d'entraînement COMPLET de ${weeksCount} semaines.

FORMAT DE RÉPONSE : JSON strict, aucun texte avant ou après, aucun markdown.
{
  "profile": {
    "goalRace": "5k" | "10k" | "halfMarathon" | "marathon",
    "goalDate": "YYYY-MM-DD",
    "goalTimeMin": <entier — chrono cible du plan en minutes>,
    "weeklyKm": <entier — volume de départ en km/semaine>,
    "thresholdPaceSec": <entier — allure seuil en secondes/km>,
    "availableDays": [<exactement ${sessionsPerWeek} entiers, 1=Lun … 7=Dim, bien répartis>],
    "terrain": "flat" | "hilly" | "trail"${isTrail ? ',\n    "elevationGainPerRace": <D+ estimé en mètres>' : ''}
  },
  "goal": {
    "userMin": <entier ou null — chrono visé converti en minutes>,
    "realisticMin": <entier — niveau actuel de l'athlète sans entraînement supplémentaire>,
    "achievableMin": <entier — chrono atteignable après ${weeksCount} semaines>,
    "verdict": "réaliste" | "ambitieux" | "sous-estimé" | "excellent",
    "message": "<2-3 phrases bienveillantes analysant l'objectif>"
  },
  "sessions": [
    { "week": 1, "day": 2, "name": "...", "totalMin": 45, "km": 7, "intensity": "easy", "description": "..." },
    ...
  ]
}

CALCUL DU PROFIL :
- goalRace : mappe la distance déclarée → "5k" (<8 km), "10k" (8–16 km), "halfMarathon" (17–34 km), "marathon" (≥35 km) ; pour trail utilise la même règle
- goalTimeMin : chrono cible réaliste après ce plan — priorité aux données Garmin si disponibles, sinon déduis de l'état de forme et du chrono visé
- thresholdPaceSec : allure race × 0.92 (formule physiologique standard)
- availableDays : exactement ${sessionsPerWeek} jours bien espacés (récupération minimale 1 jour entre séances)
- weeklyKm : volume de départ cohérent avec l'état de forme et les données Garmin ; applique un coefficient de reprise si pause récente

ANALYSE OBJECTIF (champ "goal") :
- realisticMin : niveau ACTUEL de l'athlète (aujourd'hui, sans entraînement supplémentaire)
- achievableMin : objectif du plan après ${weeksCount} semaines de travail
- verdict : "réaliste" si chrono visé ≈ niveau actuel (±5%) ; "ambitieux" si visé < actuel de >5% ; "sous-estimé" si visé > actuel de >10% ; "excellent" si l'athlète peut viser encore mieux

INTENSITÉS :
- "easy"     : endurance fondamentale zone 2 — conversation possible
- "moderate" : tempo / seuil zone 3 — effort contrôlé
- "hard"     : intervalles VMA zone 4–5 — effort élevé
- "long"     : sortie longue zone 2 — durée +25 % vs sortie easy normale
- "recovery" : décrassage léger — allure très facile
- "hill"     : montées de côte${isTrail ? ' — OBLIGATOIRE dès la semaine 3 pour trail' : ''}
- "strength" : renforcement musculaire (hors course)

RÈGLES PHYSIOLOGIQUES (non négociables) :
1. Exactement ${sessionsPerWeek} séances par semaine — ni plus, ni moins
2. Utilise exclusivement les ${sessionsPerWeek} jours définis dans profile.availableDays
3. Règle 80/20 : ≥ 80 % du volume en easy / long / recovery ; ≤ 20 % en moderate / hard / hill
4. Progression : jamais +10 % de volume hebdomadaire
5. Périodisation : 3 semaines de charge + 1 semaine de récupération (−15 %) toutes les 4 semaines
6. Affûtage : dernière(s) semaine(s) — volume réduit, intensité maintenue
7. Descriptions : allures exactes, durées précises, consignes d'exécution claires${isTrail ? '\n8. Trail : D+ en sortie longue dès sem. 2, hill réguliers, volume final > 25 km D+' : ''}

⚠️ CONTRAINTE ABSOLUE — ${sessionsPerWeek} SÉANCES PAR SEMAINE EXACTEMENT ⚠️
Avant de répondre : compte les séances de chaque semaine. Si une semaine ≠ ${sessionsPerWeek}, corrige.

JSON uniquement — objet complet avec "profile", "goal" et "sessions". Toutes les semaines sans troncature.`;
}

// ── Public builder (called by POST handler) ────────────────────────────────────

function buildPrompt(onboarding: OnboardingData, weeksCount: number, garmin?: GarminActivitySummary): string {
  const isTrail = onboarding.goalType === 'trail';
  const athleteContext = buildAthleteContext(onboarding, garmin);
  return buildPlanPrompt(athleteContext, weeksCount, onboarding.weeklySessions, isTrail);
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ sessions: null, error: 'Clé API Gemini manquante' });
    }

    let body: { onboarding?: OnboardingData; garmin?: GarminActivitySummary };
    try { body = await req.json() as typeof body; }
    catch { return NextResponse.json({ sessions: null, error: 'Corps de requête invalide' }); }

    const { onboarding, garmin } = body;
    if (!onboarding) {
      return NextResponse.json({ sessions: null, error: 'Données onboarding manquantes' });
    }

    const weeksUntil = onboarding.raceDate
      ? Math.round((new Date(onboarding.raceDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7))
      : 12;
    const weeksCount = Math.max(4, Math.min(weeksUntil, 24));

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7 },
    });

    const prompt = buildPrompt(onboarding, weeksCount, garmin);

    let raw: string;
    try {
      const result = await model.generateContent(prompt);
      raw = result.response.text().trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Gemini';
      return NextResponse.json({ sessions: null, error: `Gemini: ${msg}` });
    }

    const jsonStr = raw
      .replace(/^```(?:json)?\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();

    let sessions: GeminiSession[];
    let goalAssessment: GoalAssessment | null = null;
    let geminiProfile: UserProfile | null = null;
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      if (Array.isArray(parsed)) {
        sessions = parsed as GeminiSession[];
      } else if (parsed && typeof parsed === 'object' && 'sessions' in parsed) {
        const obj = parsed as { profile?: UserProfile; goal?: GoalAssessment; sessions: GeminiSession[] };
        sessions = obj.sessions ?? [];
        goalAssessment = obj.goal ?? null;
        geminiProfile = obj.profile ?? null;
      } else {
        throw new Error('Format inattendu');
      }
    } catch {
      console.error('[/api/generate-plan] JSON parse failed. Raw:', raw.slice(0, 300));
      return NextResponse.json({ sessions: null, error: 'Réponse Gemini invalide (JSON mal formé)' });
    }

    sessions = sessions.filter(
      s => typeof s.week === 'number' && typeof s.day === 'number' &&
           typeof s.name === 'string' && typeof s.totalMin === 'number'
    );

    if (!sessions.length) {
      return NextResponse.json({ sessions: null, error: 'Aucune séance valide reçue de Gemini' });
    }

    const maxPerWeek = Math.max(3, Math.min(6, Math.round(Number(onboarding.weeklySessions)))) || 3;
    const days = (geminiProfile?.availableDays?.length === maxPerWeek)
      ? geminiProfile.availableDays
      : buildDefaultDays(maxPerWeek);

    const byWeek = new Map<number, GeminiSession[]>();
    for (const s of sessions) {
      if (!byWeek.has(s.week)) byWeek.set(s.week, []);
      byWeek.get(s.week)!.push(s);
    }
    sessions = [];
    for (const [, ws] of byWeek) {
      const limited = ws.slice(0, maxPerWeek);
      limited.forEach((s, i) => { s.day = days[i % days.length]; });
      sessions.push(...limited);
    }

    console.log(`[generate-plan] enforced ${maxPerWeek} sessions/week (requested: ${onboarding.weeklySessions}), total: ${sessions.length}`);

    if (geminiProfile) geminiProfile.availableDays = days;

    return NextResponse.json({ sessions, goalAssessment, profile: geminiProfile });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[/api/generate-plan] unhandled:', msg);
    return NextResponse.json({ sessions: null, error: msg });
  }
}

function buildDefaultDays(n: number): number[] {
  const defaults: Record<number, number[]> = { 3: [2, 4, 6], 4: [2, 4, 6, 7], 5: [1, 2, 4, 6, 7], 6: [1, 2, 3, 4, 6, 7] };
  return defaults[n] ?? [2, 4, 6];
}
