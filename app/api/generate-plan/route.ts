import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { UserProfile } from '@/lib/types';
import type { GarminActivitySummary, RunActivity } from '@/app/api/garmin/activities/route';

// Extend Vercel function timeout (requires Pro plan — on Hobby falls back to 10s)
export const maxDuration = 60;

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

const DAYS_FR = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const RACE_KM: Record<string, number> = { marathon: 42.195, halfMarathon: 21.1, '10k': 10, '5k': 5 };

function taperWeeks(race: string): number {
  if (race === 'marathon') return 3;
  if (race === 'halfMarathon') return 2;
  return 1;
}

function fmtPace(sec: number): string {
  return `${Math.floor(sec / 60)}'${(sec % 60).toString().padStart(2, '0')}''/km`;
}

function fmtPaceSec(sec: number): string {
  if (!sec) return '?';
  return `${Math.floor(sec / 60)}'${(sec % 60).toString().padStart(2, '0')}''/km`;
}

function buildGarminSection(summary: GarminActivitySummary): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════',
    'DONNÉES GARMIN RÉELLES (ne pas ignorer)',
    '═══════════════════════════════════════',
    `Volume moyen 4 semaines : ${summary.weeklyKm4w} km/semaine`,
    `Volume moyen 8 semaines : ${summary.weeklyKm8w} km/semaine`,
    `Sortie longue max (8 sem) : ${summary.longestRunKm} km`,
    `Séances/semaine moyenne  : ${summary.avgSessionsPerWeek}`,
    `Allure moyenne récente   : ${fmtPaceSec(summary.recentAvgPaceSecKm)}`,
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
    '→ Utilise ces données RÉELLES pour calibrer le VOLUME hebdo, les ALLURES et la PROGRESSION.',
    '→ Les données Garmin corrigent uniquement les allures et le volume — PAS le nombre de séances ni les jours disponibles.',
    '═══════════════════════════════════════',
  );
  return lines.join('\n');
}

function buildPrompt(profile: UserProfile, weeksCount: number, garmin?: GarminActivitySummary, userGoalTimeMin?: number): string {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const distKm = RACE_KM[profile.goalRace] ?? 10;
  const isTrail = profile.terrain === 'trail';
  const daysStr = (profile.availableDays ?? [2, 4, 6]).map(d => `${DAYS_FR[d]}(${d})`).join(', ');
  const taper = taperWeeks(profile.goalRace);
  const easyPace = fmtPace(Math.round((profile.thresholdPaceSec ?? 300) * 1.2));
  const seuilPace = fmtPace(profile.thresholdPaceSec ?? 300);
  const vmaPace = fmtPace(Math.round((profile.thresholdPaceSec ?? 300) * 0.85));

  const goalSection = userGoalTimeMin
    ? `- Chrono VISÉ par l'athlète : ${userGoalTimeMin}min (${Math.floor(userGoalTimeMin / 60)}h${userGoalTimeMin % 60 > 0 ? String(userGoalTimeMin % 60).padStart(2, '0') + 'min' : ''})`
    : `- Chrono cible (estimé par l'app) : ${profile.goalTimeMin}min`;

  return `Date du jour : ${today}

PROFIL ATHLÈTE :
- Objectif : ${profile.goalRace} · ${distKm}km${isTrail ? ' TRAIL' : ''} · terrain ${profile.terrain ?? 'flat'}
- Date de course : ${profile.goalDate}
${goalSection}
- Allures de référence : EF ${easyPace} | Seuil ${seuilPace} | VMA ${vmaPace}
- Volume actuel (estimé) : ${profile.weeklyKm}km/semaine
- Jours disponibles : ${daysStr}
- Renforcement : ${profile.strengthPerWeek ?? 0} séance(s)/semaine${profile.elevationGainPerRace ? `\n- Dénivelé course : ${profile.elevationGainPerRace}m D+` : ''}${garmin ? buildGarminSection(garmin) : ''}

MISSION : Génère un plan d'entraînement COMPLET de ${weeksCount} semaines menant à la course.

FORMAT DE RÉPONSE : Objet JSON UNIQUEMENT, aucun texte avant ou après, aucun markdown.
Structure exacte :
{"goal":{"userMin":${userGoalTimeMin ?? 'null'},"realisticMin":<estimation coach en minutes>,"achievableMin":<objectif du plan en minutes>,"verdict":"réaliste"|"ambitieux"|"sous-estimé"|"excellent","message":"<2-3 phrases : analyse le chrono visé vs données réelles, explique l'estimation, annonce l'objectif du plan>"},"sessions":[{"week":1,"day":2,"name":"Endurance fondamentale","totalMin":45,"km":7,"intensity":"easy","description":"45min à allure ${easyPace}..."},...]}

ANALYSE OBJECTIF (champ "goal") :
- realisticMin : chrono réaliste AUJOURD'HUI selon données Garmin/profil (sans entraînement)
- achievableMin : chrono visé par ce plan (ambitieux mais atteignable après ${weeksCount} semaines)
- verdict : "réaliste" si userMin proche de realisticMin (±5%), "ambitieux" si userMin < realisticMin de plus de 5%, "sous-estimé" si userMin > realisticMin de plus de 10%, "excellent" si l'athlète peut viser mieux que son objectif
- message : analyse bienveillante, factuelle, en français, qui motive

VALEURS intensity :
- "easy" : endurance fondamentale zone 2, allure ${easyPace}
- "moderate" : tempo/seuil zone 3, allure ${seuilPace}
- "hard" : intervalles VMA zone 4-5, allure ${vmaPace}
- "long" : sortie longue zone 2 (durée +25% vs sortie normale)
- "recovery" : décrassage très léger, allure libre très lente
- "hill" : montées de côte spécifiques${isTrail ? ' (OBLIGATOIRE dès sem.3 pour trail)' : ''}
- "strength" : renforcement musculaire (gainage, squats, fentes, mollets)

RÈGLES PHYSIOLOGIQUES (non négociables) :
1. Utilise EXCLUSIVEMENT les jours ${JSON.stringify(profile.availableDays ?? [2, 4, 6])} — exactement ${profile.availableDays?.length ?? 3} séance(s) de course par semaine, jamais plus, jamais moins. Les données Garmin n'autorisent PAS à ajouter des jours supplémentaires.
2. Règle 80/20 : 80% du volume total en easy/long/recovery, max 20% en moderate/hard/hill
3. Progression : jamais +10% de volume hebdo
4. Périodisation : 3 semaines de charge + 1 semaine récupération (−15 à −20%) toutes les 4 semaines
5. Affûtage : ${taper} dernière(s) semaine(s) — réduire volume mais MAINTENIR l'intensité
6. Chaque description doit donner les allures exactes, durées précises et consignes d'exécution
${isTrail ? '7. Trail : sortie longue avec dénivelé dès sem.2, montées de côte (hill) régulières, volume final > 25km D+' : ''}
${(profile.strengthPerWeek ?? 0) > 0 ? `${isTrail ? '8' : '7'}. Ajouter ${profile.strengthPerWeek} séance(s) strength/semaine avec exercices spécifiques coureur` : ''}

JSON uniquement, objet complet avec "goal" et "sessions", toutes les semaines. Pas de troncature.`;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ sessions: null, error: 'Clé API Gemini manquante' });
    }

    let body: { profile?: UserProfile; garmin?: GarminActivitySummary; userGoalTimeMin?: number };
    try { body = await req.json() as typeof body; }
    catch { return NextResponse.json({ sessions: null, error: 'Corps de requête invalide' }); }

    const { profile, garmin, userGoalTimeMin } = body;
    if (!profile?.goalDate || !profile?.thresholdPaceSec) {
      return NextResponse.json({ sessions: null, error: 'Profil incomplet' });
    }

    const weeksUntil = Math.round(
      (new Date(profile.goalDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7)
    );
    const weeksCount = Math.max(4, Math.min(weeksUntil, 24));

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7 },
    });

    const prompt = buildPrompt(profile, weeksCount, garmin, userGoalTimeMin);

    let raw: string;
    try {
      const result = await model.generateContent(prompt);
      raw = result.response.text().trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Gemini';
      return NextResponse.json({ sessions: null, error: `Gemini: ${msg}` });
    }

    // Strip markdown fences if Gemini wrapped in ```json ... ```
    const jsonStr = raw
      .replace(/^```(?:json)?\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();

    let sessions: GeminiSession[];
    let goalAssessment: GoalAssessment | null = null;
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      if (Array.isArray(parsed)) {
        // Legacy format: bare array
        sessions = parsed as GeminiSession[];
      } else if (parsed && typeof parsed === 'object' && 'sessions' in parsed) {
        const obj = parsed as { goal?: GoalAssessment; sessions: GeminiSession[] };
        sessions = obj.sessions ?? [];
        goalAssessment = obj.goal ?? null;
      } else {
        throw new Error('Unexpected format');
      }
    } catch {
      console.error('[/api/generate-plan] JSON parse failed. Raw:', raw.slice(0, 300));
      return NextResponse.json({ sessions: null, error: 'Réponse Gemini invalide (JSON mal formé)' });
    }

    // Basic validation: keep sessions with required fields
    sessions = sessions.filter(
      s => typeof s.week === 'number' && typeof s.day === 'number' &&
           typeof s.name === 'string' && typeof s.totalMin === 'number'
    );

    if (!sessions.length) {
      return NextResponse.json({ sessions: null, error: 'Aucune séance valide reçue de Gemini' });
    }

    return NextResponse.json({ sessions, goalAssessment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[/api/generate-plan] unhandled:', msg);
    return NextResponse.json({ sessions: null, error: msg });
  }
}
