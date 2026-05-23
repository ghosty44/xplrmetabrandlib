import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import type { OnboardingData } from '@/app/api/generate-plan/route';
import type { GarminActivitySummary } from '@/app/api/garmin/activities/route';

export const maxDuration = 60;

const fmtPaceSec = (sec: number) => `${Math.floor(sec / 60)}'${String(Math.round(sec % 60)).padStart(2, '0')}''/km`;

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
      active: 'court régulièrement, sans interruption récente',
      break2w: 'pause de 2 à 3 semaines récente',
      break3w: 'pause de 3 à 4 semaines récente',
      break1m: "pause de plus d'un mois",
    };
    const ENV_LABELS: Record<string, string> = {
      flat: 'terrain plat uniquement',
      bump: 'petites bosses, montées < 2 min',
      hill: 'collines, montées 2-4 min',
      mountain: 'petite montagne, montées 4-6 min',
      cols: 'longs cols, montées prolongées',
    };
    const PRIORITY_LABELS: Record<string, string> = {
      main: 'objectif principal (pic de forme ce jour-là)',
      secondary: 'objectif secondaire',
    };

    const dist = parseFloat(onboarding.raceDistanceKm ?? '0');
    const elev = parseFloat(onboarding.raceElevationGain ?? '0');
    const isTrail = onboarding.goalType === 'trail';

    // Chrono calculation details for the prompt
    let chronoMethod = '';
    let chronoCalc = '';
    const effectiveKm = isTrail ? dist + elev / 100 : dist;

    if (garmin?.lactateThresholdSpeedMps && garmin.lactateThresholdSpeedMps > 0) {
      const ltPaceSec = 1000 / garmin.lactateThresholdSpeedMps;
      const ltFactor = isTrail ? 1.12 : dist >= 25 ? 1.10 : dist >= 17 ? 1.03 : dist >= 8 ? 0.97 : 0.94;
      const racePaceSec = ltPaceSec * ltFactor;
      const estimatedMin = Math.round(effectiveKm * racePaceSec / 60);
      const h = Math.floor(estimatedMin / 60);
      const m = estimatedMin % 60;
      chronoMethod = `MÉTHODE UTILISÉE : Seuil lactique Garmin (méthode la plus précise — physiologie directe)
Seuil lactique mesuré : ${fmtPaceSec(ltPaceSec)}
Facteur distance (${dist}km) : ×${ltFactor} → allure cible ${fmtPaceSec(racePaceSec)}
${isTrail && elev > 0 ? `Naismith trail : ${dist}km + ${elev}m D+ ÷ 100 = ${effectiveKm.toFixed(1)} km effectifs\n` : ''}Chrono estimé : ${effectiveKm.toFixed(1)} km × ${fmtPaceSec(racePaceSec)} = ${h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`}`;
      chronoCalc = `Le chrono est calculé à partir du seuil lactique Garmin (${fmtPaceSec(ltPaceSec)}), avec un facteur de ${ltFactor} pour la distance de ${dist}km.`;
    } else if (garmin?.vo2Max && garmin.vo2Max > 10) {
      const intensity = isTrail ? 0.82 : dist >= 25 ? 0.84 : dist >= 17 ? 0.89 : dist >= 8 ? 0.93 : 0.95;
      const targetVO2 = garmin.vo2Max * intensity;
      const v = (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (targetVO2 + 4.60))) / (2 * 0.000104);
      const roadPaceSec = 60000 / v;
      const racePaceSec = isTrail ? roadPaceSec * 1.10 : roadPaceSec;
      const estimatedMin = Math.round(effectiveKm * racePaceSec / 60);
      const h = Math.floor(estimatedMin / 60);
      const m = estimatedMin % 60;
      chronoMethod = `MÉTHODE UTILISÉE : Formule VDOT de Jack Daniels (VO2max Garmin)
VO2max : ${garmin.vo2Max} ml/kg/min → intensité course ${Math.round(intensity * 100)}% pour ${dist}km
Vitesse de course calculée : ${fmtPaceSec(racePaceSec)}
Chrono estimé : ${effectiveKm.toFixed(1)} km × ${fmtPaceSec(racePaceSec)} = ${h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`}`;
      chronoCalc = `Le chrono est calculé via la formule VDOT de Jack Daniels à partir du VO2max Garmin (${garmin.vo2Max} ml/kg/min).`;
    } else if (garmin?.recentAvgPaceSecKm && garmin.recentAvgPaceSecKm > 0) {
      const racePaceSec = garmin.recentAvgPaceSecKm * 0.93;
      const estimatedMin = Math.round(effectiveKm * racePaceSec / 60);
      const h = Math.floor(estimatedMin / 60);
      const m = estimatedMin % 60;
      chronoMethod = `MÉTHODE UTILISÉE : Allure moyenne des 10 dernières sorties Garmin
Allure entraînement : ${fmtPaceSec(garmin.recentAvgPaceSecKm)} → ×0.93 effort course → ${fmtPaceSec(racePaceSec)}
Chrono estimé : ${effectiveKm.toFixed(1)} km × ${fmtPaceSec(racePaceSec)} = ${h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`}`;
      chronoCalc = `Le chrono est estimé à partir de l'allure moyenne des dernières sorties Garmin (${fmtPaceSec(garmin.recentAvgPaceSecKm)}).`;
    } else {
      chronoMethod = `MÉTHODE UTILISÉE : Formule générique (pas de données Garmin)
Volume estimé selon fréquence (${onboarding.weeklySessions} séances/sem.) → allure de base estimée`;
      chronoCalc = `Aucune donnée Garmin disponible — estimation par formule générique basée sur la fréquence d'entraînement.`;
    }

    const garminSection = garmin ? `
DONNÉES GARMIN RÉCUPÉRÉES :
${garmin.vo2Max ? `- VO2max : ${garmin.vo2Max} ml/kg/min` : ''}
${garmin.lactateThresholdSpeedMps ? `- Seuil lactique : ${fmtPaceSec(Math.round(1000 / garmin.lactateThresholdSpeedMps))} (${garmin.lactateThresholdSpeedMps.toFixed(3)} m/s)` : ''}
${garmin.lactateThresholdHR ? `- FC seuil : ${garmin.lactateThresholdHR} bpm` : ''}
- Volume moyen 4 semaines : ${garmin.weeklyKm4w} km/sem
- Volume moyen 8 semaines : ${garmin.weeklyKm8w} km/sem
- Sortie longue max (8 sem) : ${garmin.longestRunKm} km
- Séances effectives/semaine : ${garmin.avgSessionsPerWeek}
- Allure moyenne (10 dernières sorties) : ${fmtPaceSec(garmin.recentAvgPaceSecKm)}
- Dernières sorties : ${garmin.runs.slice(0, 5).map(r => `${r.date} ${r.distanceKm}km ${r.durationMin}min ${fmtPaceSec(r.paceSecKm)}`).join(' | ')}` : `
DONNÉES GARMIN : non connecté — estimation par formule générique`;

    const prompt = `Tu es un coach de course à pied expert. Voici le profil complet d'un athlète.

DONNÉES COLLECTÉES :
- Objectif : ${GOAL_LABELS[onboarding.goalType ?? 'road'] ?? onboarding.goalType}
${onboarding.raceName ? `- Course : ${onboarding.raceName}` : ''}
${dist > 0 ? `- Distance : ${dist} km` : ''}
${isTrail && elev > 0 ? `- Dénivelé : ${elev} m D+` : ''}
${onboarding.raceDate ? `- Date : ${onboarding.raceDate}` : ''}
${onboarding.racePriority ? `- Importance : ${PRIORITY_LABELS[onboarding.racePriority]}` : ''}
${onboarding.raceGoalTime ? `- Chrono visé par l'athlète : ${onboarding.raceGoalTime}` : ''}
- Forme actuelle : ${FITNESS_LABELS[onboarding.fitnessState ?? 'active']}
- Fréquence souhaitée : ${onboarding.weeklySessions} séances/semaine
- Terrain d'entraînement : ${ENV_LABELS[onboarding.trainingEnv ?? 'flat']}
${garminSection}

CALCUL DU CHRONO :
${chronoMethod}

${chronoCalc}

MISSION : Génère une analyse complète et détaillée en français, structurée en 4 sections SANS titres ni markdown, juste du texte avec des retours à la ligne entre les paragraphes :

Paragraphe 1 — CE QUE JE SAIS DE TOI : Interprète toutes les données disponibles. Explique ce que le VO2max, le seuil lactique et le volume révèlent sur le niveau de l'athlète. Compare à des références (VO2max >50 = bon niveau régional, seuil <4'30 = coureur confirmé, etc.). Mentionne les données Garmin avec leurs valeurs exactes.

Paragraphe 2 — COMMENT J'AI CALCULÉ TON CHRONO : Explique la méthode utilisée pas à pas avec les vrais chiffres. Cite l'allure seuil, le facteur appliqué, le résultat final. Dis pourquoi cette méthode est la plus fiable.

Paragraphe 3 — CE QUE TON PLAN VA CIBLER : Décris la structure du plan (semaines, répartition 80/20, types de séances, progression). Adapte au niveau détecté.

Paragraphe 4 — CE QUI SERA SURVEILLÉ : Mentionne 2-3 points d'attention spécifiques à ce profil (risques de surentraînement, gestion de la récupération, etc.).

Sois direct, technique, précis. Utilise "tu" et pas "vous". Donne les vraies valeurs numériques.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7 },
    });

    const result = await model.generateContent(prompt);
    const reflection = result.response.text().trim();
    return NextResponse.json({ reflection });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ reflection: `Erreur : ${msg}` });
  }
}
