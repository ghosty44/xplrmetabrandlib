import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { UserProfile } from '@/lib/types';

export interface GeminiSession {
  week: number;
  day: number;
  name: string;
  totalMin: number;
  km?: number;
  intensity: 'easy' | 'moderate' | 'hard' | 'long' | 'recovery' | 'strength' | 'hill';
  description: string;
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

function buildPrompt(profile: UserProfile, weeksCount: number): string {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const distKm = RACE_KM[profile.goalRace] ?? 10;
  const isTrail = profile.terrain === 'trail';
  const daysStr = (profile.availableDays ?? [2, 4, 6]).map(d => `${DAYS_FR[d]}(${d})`).join(', ');
  const taper = taperWeeks(profile.goalRace);
  const easyPace = fmtPace(Math.round((profile.thresholdPaceSec ?? 300) * 1.2));
  const seuilPace = fmtPace(profile.thresholdPaceSec ?? 300);
  const vmaPace = fmtPace(Math.round((profile.thresholdPaceSec ?? 300) * 0.85));

  return `Date du jour : ${today}

PROFIL ATHLÈTE :
- Objectif : ${profile.goalRace} · ${distKm}km${isTrail ? ' TRAIL' : ''} · terrain ${profile.terrain ?? 'flat'}
- Date de course : ${profile.goalDate}
- Chrono cible : ${profile.goalTimeMin}min (${Math.floor(profile.goalTimeMin / 60)}h${profile.goalTimeMin % 60}min)
- Allures de référence : EF ${easyPace} | Seuil ${seuilPace} | VMA ${vmaPace}
- Volume actuel : ${profile.weeklyKm}km/semaine
- Jours disponibles : ${daysStr}
- Renforcement : ${profile.strengthPerWeek ?? 0} séance(s)/semaine${profile.elevationGainPerRace ? `\n- Dénivelé course : ${profile.elevationGainPerRace}m D+` : ''}

MISSION : Génère un plan d'entraînement COMPLET de ${weeksCount} semaines menant à la course.

FORMAT DE RÉPONSE : Tableau JSON UNIQUEMENT, aucun texte avant ou après, aucun markdown.
Exemple :
[{"week":1,"day":2,"name":"Endurance fondamentale","totalMin":45,"km":7,"intensity":"easy","description":"45min à allure ${easyPace}, conversation facile pendant toute la sortie. Concentration sur la respiration nasale."},
{"week":1,"day":4,"name":"Tempo","totalMin":50,"km":9,"intensity":"moderate","description":"15min échauffement progressif + 20min à allure seuil ${seuilPace} (effort soutenu mais contrôlé, souffle court) + 15min retour au calme."}]

VALEURS intensity :
- "easy" : endurance fondamentale zone 2, allure ${easyPace}
- "moderate" : tempo/seuil zone 3, allure ${seuilPace}
- "hard" : intervalles VMA zone 4-5, allure ${vmaPace}
- "long" : sortie longue zone 2 (durée +25% vs sortie normale)
- "recovery" : décrassage très léger, allure libre très lente
- "hill" : montées de côte spécifiques${isTrail ? ' (OBLIGATOIRE dès sem.3 pour trail)' : ''}
- "strength" : renforcement musculaire (gainage, squats, fentes, mollets)

RÈGLES PHYSIOLOGIQUES (non négociables) :
1. Utilise EXCLUSIVEMENT les jours ${JSON.stringify(profile.availableDays ?? [2, 4, 6])}
2. Règle 80/20 : 80% du volume total en easy/long/recovery, max 20% en moderate/hard/hill
3. Progression : jamais +10% de volume hebdo
4. Périodisation : 3 semaines de charge + 1 semaine récupération (−15 à −20%) toutes les 4 semaines
5. Affûtage : ${taper} dernière(s) semaine(s) — réduire volume mais MAINTENIR l'intensité
6. Chaque description doit donner les allures exactes, durées précises et consignes d'exécution
${isTrail ? '7. Trail : sortie longue avec dénivelé dès sem.2, montées de côte (hill) régulières, volume final > 25km D+' : ''}
${(profile.strengthPerWeek ?? 0) > 0 ? `${isTrail ? '8' : '7'}. Ajouter ${profile.strengthPerWeek} séance(s) strength/semaine avec exercices spécifiques coureur` : ''}

JSON uniquement, tableau complet, toutes les semaines. Pas de troncature.`;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ sessions: null, error: 'Clé API Gemini manquante' });
    }

    let body: { profile?: UserProfile };
    try { body = await req.json() as typeof body; }
    catch { return NextResponse.json({ sessions: null, error: 'Corps de requête invalide' }); }

    const { profile } = body;
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

    const prompt = buildPrompt(profile, weeksCount);

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
    try {
      const parsed = JSON.parse(jsonStr) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Not an array');
      sessions = parsed as GeminiSession[];
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

    return NextResponse.json({ sessions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[/api/generate-plan] unhandled:', msg);
    return NextResponse.json({ sessions: null, error: msg });
  }
}
