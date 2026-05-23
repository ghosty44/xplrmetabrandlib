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
  recentInjuries: 'none' | 'knee' | 'achilles' | 'back' | 'other';
  strengthPerWeek: 0 | 1 | 2;
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

  const INJURY_LABELS: Record<string, string> = {
    none: 'aucune',
    knee: 'genou',
    achilles: "tendon d'Achille",
    back: 'dos / hanche',
    other: 'autre (non précisé)',
  };

  lines.push(
    '',
    '── Profil athlète ──',
    `État de forme : ${FITNESS_LABELS[onboarding.fitnessState]}`,
    `Blessures récentes : ${INJURY_LABELS[onboarding.recentInjuries] ?? 'aucune'}`,
    `Renforcement musculaire : ${onboarding.strengthPerWeek} séance${onboarding.strengthPerWeek > 1 ? 's' : ''}/semaine`,
    `Séances de course souhaitées : ${onboarding.weeklySessions} par semaine`,
    `Terrain d'entraînement : ${ENV_LABELS[onboarding.trainingEnv]}`,
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
  return `# Role
Tu es RunAI, un coach de course à pied expert en planification d'entraînement, physiologie du sport et périodisation. Tu maîtrises l'analyse des données Garmin, la biomécanique trail/route, et la construction de plans individualisés basés sur les données réelles de l'athlète.

# Task
À partir du contexte structuré d'un athlète, tu génères un plan d'entraînement complet et calibré.
CRITIQUE : Ta réponse doit être EXCLUSIVEMENT un objet JSON brut. Aucun texte introductif, aucune conclusion, et SURTOUT AUCUN balisage markdown (ne pas utiliser \`\`\`json ... \`\`\`).

# Context
Ce système alimente une application. La précision du JSON est vitale : il sera parsé automatiquement. Toute déviation ou texte hors du JSON casse le pipeline.

# Instructions

## 1. Contexte athlète

${athleteContext}

## 2. Règles de gestion des données manquantes

Applique silencieusement ces valeurs par défaut si nécessaire :

| Donnée | Défaut |
|---|---|
| Séances/semaine | 3 |
| Terrain | flat |
| Renforcement musculaire | 0 |
| Blessures | aucune |
| Données Garmin absentes | utilise l'état de forme + chrono visé pour estimer le niveau |

## 3. Calculs physiologiques & Profil (object "profile")

- "goalRace" : "5k" (<8 km), "10k" (8–16 km), "halfMarathon" (17–34 km), "marathon" (≥35 km). Valable aussi pour le trail.
- "goalTimeMin" : priorité aux données Garmin. Sinon, estimation via l'état de forme. (Entier).
- "thresholdPaceSec" : allure cible de course × 0.92 (entier en secondes/km).
- "availableDays" : EXACTEMENT ${sessionsPerWeek} jours (1=Lun … 7=Dim). Minimum 1 jour de repos entre les séances intenses.
- "weeklyKm" : cohérent avec l'historique récent. Applique un coefficient de reprise si une pause est détectée.
- "terrain" : "flat" | "hilly" | "trail"
- "elevationGainPerRace" : dénivelé positif estimé en mètres (entier).

## 4. Analyse de l'objectif (object "goal")

- "userMin" : chrono visé en minutes (entier) ou null.
- "realisticMin" : chrono réalisable AUJOURD'HUI sans entraînement (entier).
- "achievableMin" : chrono atteignable à la fin de ce plan de ${weeksCount} semaines (entier).
- "verdict" : "réaliste" (±5% du niveau actuel), "ambitieux" (>5% d'amélioration requise), "sous-estimé" (objectif plus lent que le niveau actuel), "excellent".
- "message" : 2 à 3 phrases bienveillantes, personnalisées et motivantes.

## 5. Règles du plan d'entraînement (array "sessions") — NON NÉGOCIABLES

- Intensités : "easy" (Z2), "moderate" (Z3), "hard" (Z4–Z5), "long" (Z2, durée +25%), "recovery" (Z1), "hill"${isTrail ? ' (OBLIGATOIRE dès sem. 3)' : ''}, "strength".
- Répartition : EXACTEMENT ${sessionsPerWeek} séances par semaine, placées uniquement sur les "availableDays".
- Règle 80/20 : ≥ 80% en easy/long/recovery ; ≤ 20% en moderate/hard/hill.
- Progression : jamais plus de +10% de volume (km) d'une semaine à l'autre.
- Périodisation : cycle de 3 semaines de charge + 1 semaine d'assimilation (−15% volume).
- Affûtage (Tapering) : les 1 à 2 dernières semaines. Le volume chute, l'intensité est maintenue. L'affûtage annule et remplace la règle de périodisation si elles se chevauchent.
- Précision : "description" doit contenir les allures exactes (min/km), les durées et les consignes. Le plan ne doit jamais être tronqué — toutes les ${weeksCount} semaines.${isTrail ? '\n- Trail : D+ en sortie longue dès sem. 2, hill réguliers, volume final > 25 km D+.' : ''}

## 6. Format de sortie strict

Tu dois commencer par l'objet "_verification" pour raisonner et valider tes calculs avant de construire le plan.
Retourne UNIQUEMENT ce JSON (sans backticks markdown) :

{
  "_verification": {
    "sessions_per_week_check": "<Vérifie que chaque semaine a exactement ${sessionsPerWeek} séances>",
    "days_used_check": "<Vérifie que seuls les availableDays sont utilisés>",
    "ratio_80_20_check": "<Vérifie le respect du volume d'intensité>"
  },
  "profile": {
    "goalRace": "5k" | "10k" | "halfMarathon" | "marathon",
    "goalDate": "YYYY-MM-DD",
    "goalTimeMin": <entier>,
    "weeklyKm": <entier>,
    "thresholdPaceSec": <entier>,
    "availableDays": [<exactement ${sessionsPerWeek} entiers, 1=Lun … 7=Dim>],
    "terrain": "flat" | "hilly" | "trail",
    "elevationGainPerRace": <entier>
  },
  "goal": {
    "userMin": <entier | null>,
    "realisticMin": <entier>,
    "achievableMin": <entier>,
    "verdict": "réaliste" | "ambitieux" | "sous-estimé" | "excellent",
    "message": "<string>"
  },
  "sessions": [
    { "week": 1, "day": 2, "name": "<string>", "totalMin": <entier>, "km": <float>, "intensity": "easy" | "moderate" | "hard" | "long" | "recovery" | "hill" | "strength", "description": "<string>" }
  ]
}`;
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

    function stripMarkdown(text: string): string {
      return text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    }

    function parseGeminiResponse(raw: string): { sessions: GeminiSession[]; goalAssessment: GoalAssessment | null; geminiProfile: UserProfile | null } {
      const jsonStr = stripMarkdown(raw);
      const parsed = JSON.parse(jsonStr) as unknown;
      let sessions: GeminiSession[];
      let goalAssessment: GoalAssessment | null = null;
      let geminiProfile: UserProfile | null = null;
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
      return { sessions, goalAssessment, geminiProfile };
    }

    let sessions: GeminiSession[] = [];
    let goalAssessment: GoalAssessment | null = null;
    let geminiProfile: UserProfile | null = null;

    const MAX_ATTEMPTS = 3;
    let lastRaw = '';
    let parsed = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let raw: string;
      try {
        const result = await model.generateContent(prompt);
        raw = result.response.text().trim();
        lastRaw = raw;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur Gemini';
        return NextResponse.json({ sessions: null, error: `Gemini: ${msg}` });
      }
      try {
        ({ sessions, goalAssessment, geminiProfile } = parseGeminiResponse(raw));
        parsed = true;
        if (attempt > 1) console.log(`[generate-plan] JSON parsed on attempt ${attempt}`);
        break;
      } catch {
        console.warn(`[generate-plan] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}). Raw:`, raw.slice(0, 200));
      }
    }

    if (!parsed) {
      console.error('[generate-plan] All attempts failed. Last raw:', lastRaw.slice(0, 300));
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
