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

function fmtPaceSec(sec: number): string {
  if (!sec) return '?';
  return `${Math.floor(sec / 60)}'${(sec % 60).toString().padStart(2, '0')}''/km`;
}

function buildGarminSection(summary: GarminActivitySummary): string {
  const fmtMps = (mps: number) => {
    const sec = Math.round(1000 / mps);
    return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}''/km`;
  };

  const lines: string[] = [
    '',
    '═══════════════════════════════════════',
    'DONNÉES GARMIN RÉELLES',
    '═══════════════════════════════════════',
    ...(summary.vo2Max ? [`VO2max : ${summary.vo2Max} ml/kg/min`] : []),
    ...(summary.lactateThresholdSpeedMps ? [`Allure seuil lactique : ${fmtMps(summary.lactateThresholdSpeedMps)}`] : []),
    ...(summary.lactateThresholdHR ? [`FC seuil lactique : ${summary.lactateThresholdHR} bpm`] : []),
    `Volume moyen 4 semaines : ${summary.weeklyKm4w} km/semaine`,
    `Volume moyen 8 semaines : ${summary.weeklyKm8w} km/semaine`,
    `Sortie longue max (8 sem) : ${summary.longestRunKm} km`,
    `Séances/semaine réelles   : ${summary.avgSessionsPerWeek}`,
    `Allure moyenne récente    : ${fmtPaceSec(summary.recentAvgPaceSecKm)}`,
    '',
    `Dernières sorties (${summary.runs.length}) :`,
  ];

  for (const r of summary.runs.slice(0, 20)) {
    const pace = fmtPaceSec(r.paceSecKm);
    const hr = r.avgHR ? ` · ${r.avgHR}bpm` : '';
    const elev = r.elevationGain ? ` · +${r.elevationGain}m` : '';
    const tag = r.isTrail ? ' [TRAIL]' : '';
    lines.push(`  ${r.date}  ${r.distanceKm}km  ${r.durationMin}min  ${pace}${hr}${elev}${tag}`);
  }

  lines.push(
    '',
    '→ Priorité absolue : utilise ces données pour calibrer TOUTES les allures, le volume et la progression.',
    '→ Ces données corrigent uniquement les allures/volume — PAS le nombre de séances par semaine.',
    '═══════════════════════════════════════',
  );
  return lines.join('\n');
}

function buildPrompt(onboarding: OnboardingData, weeksCount: number, garmin?: GarminActivitySummary): string {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const FITNESS_LABELS: Record<string, string> = {
    active: 'court régulièrement, sans interruption récente',
    break2w: 'pause de 2 à 3 semaines récemment',
    break3w: 'pause de 3 à 4 semaines récemment',
    break1m: "pause de plus d'un mois",
  };
  const ENV_LABELS: Record<string, string> = {
    flat: 'terrain plat uniquement',
    bump: 'petites bosses, montées < 2 min',
    hill: 'collines, montées 2-4 min',
    mountain: 'petite montagne, montées 4-6 min',
    cols: 'longs cols, montées prolongées',
  };
  const GOAL_LABELS: Record<string, string> = {
    road: 'course sur route', trail: 'trail', beginner: 'programme débutant',
    injury: 'reprise après blessure', test: 'test de niveau',
  };

  const isTrail = onboarding.goalType === 'trail';
  const dist = parseFloat(onboarding.raceDistanceKm ?? '0');
  const elev = parseFloat(onboarding.raceElevationGain ?? '0');

  return `Date du jour : ${today}

RÉPONSES BRUTES DE L'ATHLÈTE :
- Type d'objectif : ${GOAL_LABELS[onboarding.goalType]}
${onboarding.raceName ? `- Nom de la course : ${onboarding.raceName}` : ''}
${dist > 0 ? `- Distance : ${dist} km` : ''}
${isTrail && elev > 0 ? `- Dénivelé positif : ${elev} m D+` : ''}
${onboarding.raceDate ? `- Date de la course : ${onboarding.raceDate}` : ''}
${onboarding.racePriority ? `- Priorité : ${onboarding.racePriority === 'main' ? 'objectif principal' : 'objectif secondaire'}` : ''}
${onboarding.raceGoalTime ? `- Chrono visé par l'athlète : ${onboarding.raceGoalTime}` : ''}
- État de forme : ${FITNESS_LABELS[onboarding.fitnessState]}
- Séances souhaitées : ${onboarding.weeklySessions} par semaine
- Terrain d'entraînement disponible : ${ENV_LABELS[onboarding.trainingEnv]}
- Blessures récentes : aucune signalée
- Renforcement musculaire : 0 séance/semaine${garmin ? buildGarminSection(garmin) : ''}

MISSION : Génère un plan d'entraînement COMPLET de ${weeksCount} semaines.

FORMAT DE RÉPONSE : Objet JSON UNIQUEMENT, aucun texte avant ou après, aucun markdown.
Structure exacte :
{
  "profile": {
    "goalRace": "marathon"|"halfMarathon"|"10k"|"5k",
    "goalDate": "YYYY-MM-DD",
    "goalTimeMin": <chrono cible du plan en minutes entières>,
    "weeklyKm": <volume hebdo estimé en km>,
    "thresholdPaceSec": <allure seuil en secondes/km>,
    "availableDays": [<tableau de ${onboarding.weeklySessions} jours optimaux, 1=Lun...7=Dim, espacés pour la récupération>],
    "terrain": "flat"|"hilly"|"trail"${isTrail ? ',\n    "elevationGainPerRace": ' + (elev > 0 ? elev : '<D+ estimé>') : ''}
  },
  "goal": {
    "userMin": ${onboarding.raceGoalTime ? '<chrono visé en minutes, converti>' : 'null'},
    "realisticMin": <chrono réaliste AUJOURD'HUI sans entraînement supplémentaire>,
    "achievableMin": <chrono atteignable après ${weeksCount} semaines de ce plan>,
    "verdict": "réaliste"|"ambitieux"|"sous-estimé"|"excellent",
    "message": "<2-3 phrases bienveillantes analysant l'objectif>"
  },
  "sessions": [
    {"week":1,"day":2,"name":"...","totalMin":45,"km":7,"intensity":"easy","description":"..."},
    ...
  ]
}

CALCUL DU PROFIL (champ "profile") :
- goalRace : pour trail, mappe la distance → "5k" (<15km), "halfMarathon" (15-34km), "marathon" (≥35km)
- goalTimeMin : estime un chrono réaliste après ce plan (tiens compte des données Garmin en priorité)
- thresholdPaceSec : déduit de goalTimeMin et de la distance via formule physiologique (≈ pace race × 0.92)
- availableDays : exactement ${onboarding.weeklySessions} jours, bien répartis pour la récupération (ex: [2,4,6] ou [1,3,5,7])
- weeklyKm : volume de départ cohérent avec l'état de forme et les données Garmin réelles

ANALYSE OBJECTIF (champ "goal") :
- realisticMin : niveau ACTUEL de l'athlète (aujourd'hui, sans entraînement supplémentaire)
- achievableMin : objectif du plan après ${weeksCount} semaines
- verdict : "réaliste" si chrono visé ≈ niveau actuel (±5%), "ambitieux" si visé < actuel de >5%, "sous-estimé" si visé > actuel de >10%, "excellent" si l'athlète peut viser encore mieux

VALEURS intensity :
- "easy" : endurance fondamentale zone 2
- "moderate" : tempo / seuil zone 3
- "hard" : intervalles VMA zone 4-5
- "long" : sortie longue zone 2 (durée +25% vs sortie normale)
- "recovery" : décrassage léger
- "hill" : montées de côte${isTrail ? ' (OBLIGATOIRE dès sem.3 pour trail)' : ''}
- "strength" : renforcement musculaire

⚠️ CONTRAINTE ABSOLUE — NOMBRE DE SÉANCES : ${onboarding.weeklySessions} SÉANCES PAR SEMAINE EXACTEMENT ⚠️
Compte les séances dans chaque semaine avant de répondre. Si une semaine a ≠ ${onboarding.weeklySessions} séances, recommence.
Chaque semaine doit avoir EXACTEMENT ${onboarding.weeklySessions} entrées dans "sessions" avec ce numéro de semaine.

RÈGLES PHYSIOLOGIQUES (non négociables) :
1. NOMBRE DE SÉANCES : exactement ${onboarding.weeklySessions}/semaine — ni plus, ni moins
2. Utilise EXCLUSIVEMENT les ${onboarding.weeklySessions} jours de "profile.availableDays"
3. Règle 80/20 : 80% du volume en easy/long/recovery, max 20% en moderate/hard/hill
4. Progression : jamais +10% de volume hebdo
5. Périodisation : 3 semaines de charge + 1 semaine récupération (−15%) toutes les 4 semaines
6. Affûtage : dernière(s) semaine(s) — réduire volume mais MAINTENIR l'intensité
7. Chaque description donne allures exactes, durées précises, consignes d'exécution
${isTrail ? '8. Trail : sortie longue avec D+ dès sem.2, hill réguliers, volume final > 25km D+' : ''}

VÉRIFICATION FINALE avant de répondre : compte le nombre de séances par semaine. Toutes les semaines = ${onboarding.weeklySessions} ? Si non, corrige.

JSON uniquement, objet complet avec "profile", "goal" et "sessions". Toutes les semaines, pas de troncature.`;
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

    // Enforce session count: use Gemini's days if valid, else build from weeklySessions
    // Defensive: ensure maxPerWeek is always a valid integer (3–6). If undefined or NaN,
    // slice(0, undefined) would return the full array — so we always clamp explicitly.
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

    // Patch profile with enforced days
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
