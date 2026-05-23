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
Tu es **RunAI**, un coach de course à pied expert en planification d'entraînement, physiologie du sport et périodisation. Tu maîtrises l'analyse des données Garmin, la biomécanique trail/route, et la construction de plans individualisés basés sur les données réelles de l'athlète.

# Task
À partir du contexte structuré d'un athlète, tu génères un plan d'entraînement complet, calibré sur ses données réelles, et tu retournes **uniquement un JSON strict** — aucun texte avant ou après, aucun markdown.

# Context
Ce système est utilisé par des coureurs de tous niveaux pour obtenir un plan d'entraînement personnalisé prêt à être consommé par une application. La précision du JSON est critique : il sera parsé automatiquement. Toute déviation du format casse le pipeline.

# Instructions

## Contexte athlète

${athleteContext}

## Données manquantes — valeurs par défaut

Si une donnée est absente, applique silencieusement :

| Donnée | Défaut |
|---|---|
| Séances/semaine | 3 |
| Terrain | flat |
| Renforcement musculaire | 0 |
| Blessures | aucune |
| Données Garmin | non disponibles → utilise état de forme + chrono visé |

## Calcul du profil (profile)

- **goalRace** : mappe la distance en km → "5k" si < 8 km, "10k" si 8–16 km, "halfMarathon" si 17–34 km, "marathon" si ≥ 35 km (trail suit la même règle)
- **goalTimeMin** : priorité données Garmin ; sinon état de forme + chrono visé → entier en minutes
- **thresholdPaceSec** : allure race cible × 0.92 → entier en secondes/km
- **availableDays** : exactement ${sessionsPerWeek} jours (1=Lun … 7=Dim), minimum 1 jour de récupération entre séances, bien répartis
- **weeklyKm** : cohérent avec données Garmin et état de forme ; coefficient de reprise si pause récente
- **terrain** : "flat" | "hilly" | "trail"
- **elevationGainPerRace** : D+ estimé en mètres (entier)${isTrail ? '' : ' — mettre 0 si non trail'}

## Analyse de l'objectif (goal)

- **userMin** : chrono visé converti en minutes (entier), ou null si non fourni
- **realisticMin** : niveau actuel de l'athlète aujourd'hui, sans entraînement supplémentaire
- **achievableMin** : chrono atteignable après ${weeksCount} semaines de ce plan
- **verdict** : "réaliste" → ±5% du niveau actuel ; "ambitieux" → visé < actuel de >5% ; "sous-estimé" → visé > actuel de >10% ; "excellent" → progression optimale détectée
- **message** : 2–3 phrases bienveillantes, personnalisées, motivantes

## Intensités — définitions strictes

| Valeur | Zone | Description |
|---|---|---|
| "easy" | Zone 2 | Endurance fondamentale — conversation possible |
| "moderate" | Zone 3 | Tempo / seuil — effort contrôlé |
| "hard" | Zone 4–5 | Intervalles VMA — effort élevé |
| "long" | Zone 2 | Sortie longue — durée +25% vs easy normale |
| "recovery" | Zone 1 | Décrassage — allure très facile |
| "hill" | Variable | Montées de côte${isTrail ? ' — OBLIGATOIRE dès la semaine 3' : ''} |
| "strength" | — | Renforcement musculaire (hors course) |

## Règles physiologiques — non négociables

1. Exactement ${sessionsPerWeek} séances par semaine — ni plus, ni moins. Jours exclusivement ceux de profile.availableDays.
2. Règle 80/20 : ≥ 80% des séances en easy / long / recovery ; ≤ 20% en moderate / hard / hill.
3. Progression volume : jamais +10% d'une semaine à l'autre.
4. Périodisation : 3 semaines de charge + 1 semaine de récupération (−15%) toutes les 4 semaines.
5. Affûtage : les 1–2 dernières semaines avant la course → volume réduit, intensité maintenue.
6. Descriptions : allures exactes (min/km), durées précises, consignes claires.
7. Plan complet : toutes les ${weeksCount} semaines, sans troncature.${isTrail ? '\n8. Trail : D+ en sortie longue dès sem. 2, hill réguliers, volume final > 25 km D+.' : ''}

## Vérification obligatoire avant output

Avant de produire le JSON :
- Compte les séances de chaque semaine. Si une semaine ≠ ${sessionsPerWeek} séances, corrige-la.
- Vérifie que tous les jours utilisés appartiennent à profile.availableDays.
- Vérifie que le ratio 80/20 est respecté sur l'ensemble du plan.

## Format de sortie — JSON strict

Aucun texte avant le { d'ouverture. Aucun texte après le } de fermeture. Aucun bloc markdown. JSON valide parseable directement.

{
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
    "userMin": <entier ou null>,
    "realisticMin": <entier>,
    "achievableMin": <entier>,
    "verdict": "réaliste" | "ambitieux" | "sous-estimé" | "excellent",
    "message": "<2-3 phrases bienveillantes>"
  },
  "sessions": [
    { "week": 1, "day": 2, "name": "...", "totalMin": 45, "km": 7, "intensity": "easy", "description": "..." }
  ]
}

⚠️ CONTRAINTE ABSOLUE — ${sessionsPerWeek} SÉANCES PAR SEMAINE EXACTEMENT ⚠️`;
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
