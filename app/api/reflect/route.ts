import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import type { OnboardingData } from '@/app/api/generate-plan/route';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ reflection: 'Clé API manquante.' });

    const body = await req.json() as { onboarding: Partial<OnboardingData>; step: number };
    const { onboarding, step } = body;

    const GOAL_LABELS: Record<string, string> = {
      road: 'course sur route', trail: 'trail', beginner: 'programme débutant',
      injury: 'reprise après blessure', test: 'test de niveau',
    };
    const FITNESS_LABELS: Record<string, string> = {
      active: 'court régulièrement sans interruption',
      break2w: 'pause de 2-3 semaines récente',
      break3w: 'pause de 3-4 semaines récente',
      break1m: "pause de plus d'un mois",
    };
    const PRIORITY_LABELS: Record<string, string> = {
      main: 'objectif principal (pic de forme ce jour-là)',
      secondary: 'objectif secondaire (pour se tester)',
    };
    const ENV_LABELS: Record<string, string> = {
      flat: 'terrain plat uniquement',
      bump: 'petites bosses < 2 min',
      hill: 'collines 2-4 min',
      mountain: 'petite montagne 4-6 min',
      cols: 'longs cols, montées prolongées',
    };

    const lines: string[] = [
      `Tu es un coach de course à pied expert. Un athlète vient de terminer l'étape ${step}/6 de son onboarding.`,
      ``,
      `Données collectées jusqu'ici :`,
    ];
    if (onboarding.goalType) lines.push(`- Type d'objectif : ${GOAL_LABELS[onboarding.goalType] ?? onboarding.goalType}`);
    if (onboarding.racePriority) lines.push(`- Importance : ${PRIORITY_LABELS[onboarding.racePriority] ?? onboarding.racePriority}`);
    if (onboarding.raceName) lines.push(`- Nom de la course : ${onboarding.raceName}`);
    if (onboarding.raceDistanceKm) lines.push(`- Distance : ${onboarding.raceDistanceKm} km`);
    if (onboarding.raceElevationGain) lines.push(`- Dénivelé positif : ${onboarding.raceElevationGain} m D+`);
    if (onboarding.raceDate) lines.push(`- Date de la course : ${onboarding.raceDate}`);
    if (onboarding.raceGoalTime) lines.push(`- Chrono visé : ${onboarding.raceGoalTime}`);
    if (onboarding.fitnessState) lines.push(`- État de forme : ${FITNESS_LABELS[onboarding.fitnessState] ?? onboarding.fitnessState}`);
    if (onboarding.weeklySessions) lines.push(`- Séances souhaitées : ${onboarding.weeklySessions}/semaine`);
    if (onboarding.trainingEnv) lines.push(`- Terrain d'entraînement : ${ENV_LABELS[onboarding.trainingEnv] ?? onboarding.trainingEnv}`);

    lines.push(``, `En 3-5 phrases concises, dis ce que tu comprends du profil de cet athlète, ce que tu penses de ses ambitions, et comment tu vas orienter son plan. Sois direct et technique, comme un vrai coach.`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.8, maxOutputTokens: 300 },
    });

    const result = await model.generateContent(lines.join('\n'));
    const reflection = result.response.text().trim();
    return NextResponse.json({ reflection });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ reflection: `Erreur Gemini : ${msg}` });
  }
}
