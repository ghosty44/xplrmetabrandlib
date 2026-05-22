import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { TrainingPlan } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ message: '⚠️ Clé API Gemini manquante.' });
    }

    let body: { messages?: Array<{ role: 'user' | 'model'; content: string }>; plan?: TrainingPlan | null; garminSummary?: string | null };
    try {
      body = await req.json() as typeof body;
    } catch {
      return NextResponse.json({ message: '⚠️ Corps de requête invalide.' });
    }

    const { messages, plan, garminSummary } = body;
    if (!messages?.length) {
      return NextResponse.json({ message: '⚠️ messages requis.' });
    }

    const planContext = plan ? buildPlanContext(plan) : 'Aucun plan disponible.';
    const garminContext = garminSummary ?? 'Aucune donnée Garmin disponible.';

    const systemPrompt = `Tu es "Coach RunAI", assistant personnel de course à pied. Tu parles exclusivement en français, de façon concise et bienveillante. Tu réponds en 3-5 phrases maximum sauf si l'utilisateur demande une explication détaillée.

Tu as accès aux données complètes de l'utilisateur :

=== PROFIL & PLAN ===
${planContext}

=== DONNÉES GARMIN (dernières activités) ===
${garminContext}

RÈGLES :
- Si on te pose une question sur une séance précise, réponds en citant le contenu du plan.
- Si on te demande de modifier le plan, explique que les modifications se font depuis l'app (pas depuis ce chat).
- Pour les questions de santé/blessures, recommande de consulter un médecin si la douleur est > 3/10.
- Ne joue jamais au médecin.
- Tu peux suggérer des adaptations de l'entraînement (allure, volume) basées sur les données Garmin si elles montrent de la fatigue ou de la progression.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });

    // Gemini requires history to start with a 'user' turn — drop leading model messages (welcome msg)
    const historyRaw = messages.slice(0, -1);
    const firstUserIdx = historyRaw.findIndex(m => m.role === 'user');
    const history = (firstUserIdx >= 0 ? historyRaw.slice(firstUserIdx) : []).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const lastMsg = messages[messages.length - 1].content;

    let text: string;
    try {
      const result = await chat.sendMessage(lastMsg);
      text = result.response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Gemini';
      return NextResponse.json({ message: `⚠️ ${msg}` });
    }

    return NextResponse.json({ message: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[/api/assistant] unhandled error:', msg);
    return NextResponse.json({ message: `⚠️ Erreur interne : ${msg}` });
  }
}

function buildPlanContext(plan: TrainingPlan): string {
  const p = plan.profile;
  const raceLabels: Record<string, string> = { marathon: 'Marathon', halfMarathon: 'Semi-Marathon', '10k': '10 km', '5k': '5 km' };
  const thresholdMin = Math.floor(p.thresholdPaceSec / 60);
  const thresholdSec = p.thresholdPaceSec % 60;
  const thresholdPace = `${thresholdMin}'${thresholdSec.toString().padStart(2, '0')}''`;

  const totalSessions = plan.sessions.length;
  const completed = plan.sessions.filter(s => s.completed).length;
  const skipped = plan.sessions.filter(s => s.skipped).length;
  const totalWeeks = Math.max(...plan.sessions.map(s => s.week));

  const weekStats = Array.from({ length: totalWeeks }, (_, i) => {
    const w = i + 1;
    const wSessions = plan.sessions.filter(s => s.week === w);
    return `S${w}: ${wSessions.map(s => `${s.name}(${s.totalMin}min${s.completed ? ' ✓' : s.skipped ? ' –' : ''})`).join(', ')}`;
  }).join('\n');

  return `Objectif: ${raceLabels[p.goalRace]} le ${p.goalDate}${p.goalTimeMin ? ` en ${Math.floor(p.goalTimeMin / 60)}h${p.goalTimeMin % 60 > 0 ? p.goalTimeMin % 60 + 'min' : ''}` : ''}
Allure seuil: ${thresholdPace}/km
Volume hebdo: ${p.weeklyKm} km/semaine
FC max: ${p.maxHR ?? 'non renseignée'}
Renforcement: ${p.strengthPerWeek ?? 0} séance(s)/semaine
Plan: ${totalWeeks} semaines · ${totalSessions} séances · ${completed} complétées · ${skipped} passées

Détail par semaine:
${weekStats}`;
}
