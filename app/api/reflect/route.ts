import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import type { OnboardingData } from '@/app/api/generate-plan/route';
import type { GarminActivitySummary } from '@/app/api/garmin/activities/route';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ reflection: 'Clé API manquante.' });

    const body = await req.json() as { onboarding: Partial<OnboardingData>; garmin?: GarminActivitySummary };
    const { onboarding, garmin } = body;

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
    const ENV_LABELS: Record<string, string> = {
      flat: 'terrain plat uniquement',
      bump: 'petites bosses < 2 min',
      hill: 'collines 2-4 min',
      mountain: 'petite montagne 4-6 min',
      cols: 'longs cols, montées prolongées',
    };

    const fmtPaceSec = (sec: number) => `${Math.floor(sec / 60)}'${String(Math.round(sec % 60)).padStart(2, '0')}''`;

    const lines: string[] = [
      `Tu es un coach de course à pied expert. Voici le profil complet d'un athlète qui vient de terminer son onboarding.`,
      ``,
      `PROFIL COMPLET :`,
    ];
    if (onboarding.goalType) lines.push(`- Objectif : ${GOAL_LABELS[onboarding.goalType] ?? onboarding.goalType}`);
    if (onboarding.raceName) lines.push(`- Course : ${onboarding.raceName}`);
    if (onboarding.raceDistanceKm) lines.push(`- Distance : ${onboarding.raceDistanceKm} km`);
    if (onboarding.raceElevationGain) lines.push(`- Dénivelé : ${onboarding.raceElevationGain} m D+`);
    if (onboarding.raceDate) lines.push(`- Date : ${onboarding.raceDate}`);
    if (onboarding.raceGoalTime) lines.push(`- Chrono visé : ${onboarding.raceGoalTime}`);
    if (onboarding.fitnessState) lines.push(`- Forme : ${FITNESS_LABELS[onboarding.fitnessState] ?? onboarding.fitnessState}`);
    if (onboarding.weeklySessions) lines.push(`- Fréquence : ${onboarding.weeklySessions} séances/semaine`);
    if (onboarding.trainingEnv) lines.push(`- Terrain : ${ENV_LABELS[onboarding.trainingEnv] ?? onboarding.trainingEnv}`);

    if (garmin) {
      lines.push(``, `DONNÉES GARMIN RÉELLES :`);
      if (garmin.vo2Max) lines.push(`- VO2max : ${garmin.vo2Max} ml/kg/min`);
      if (garmin.lactateThresholdSpeedMps) {
        const ltSec = Math.round(1000 / garmin.lactateThresholdSpeedMps);
        lines.push(`- Seuil lactique : ${fmtPaceSec(ltSec)}/km`);
      }
      if (garmin.recentAvgPaceSecKm) lines.push(`- Allure moyenne (10 dernières sorties) : ${fmtPaceSec(garmin.recentAvgPaceSecKm)}/km`);
      lines.push(`- Volume 4 semaines : ${garmin.weeklyKm4w} km/sem`);
      lines.push(`- Sortie longue max : ${garmin.longestRunKm} km`);
    }

    const hasLT = !!garmin?.lactateThresholdSpeedMps;
    const hasVO2 = !!garmin?.vo2Max;
    const hasGarminPace = !!garmin?.recentAvgPaceSecKm;

    lines.push(``, `MÉTHODE DE CALCUL DU CHRONO :`, hasLT
      ? `Le chrono sera calculé à partir du seuil lactique Garmin (méthode la plus précise : physiologie directe).`
      : hasVO2
        ? `Le chrono sera calculé via la formule VDOT de Jack Daniels à partir du VO2max Garmin.`
        : hasGarminPace
          ? `Le chrono sera estimé à partir de l'allure moyenne des dernières sorties Garmin.`
          : `Le chrono sera estimé par formule générique (pas de données Garmin disponibles).`
    );

    lines.push(``, `MISSION : En 3 à 5 phrases directes et techniques, explique à l'athlète :`);
    lines.push(`1. Ce que ses données révèlent sur son profil et son niveau actuel`);
    lines.push(`2. Comment son chrono estimé a été calculé et ce qu'il signifie`);
    lines.push(`3. Ce que son plan d'entraînement va cibler (structure, priorités)`);
    lines.push(`Sois précis, bienveillant, professionnel. Pas de mise en forme, juste du texte.`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
    });

    const result = await model.generateContent(lines.join('\n'));
    const reflection = result.response.text().trim();
    return NextResponse.json({ reflection });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ reflection: `Erreur : ${msg}` });
  }
}
