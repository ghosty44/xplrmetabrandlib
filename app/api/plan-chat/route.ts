import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import type { TrainingPlan, UserProfile } from '@/lib/types';
import type { GeminiSession } from '@/app/api/generate-plan/route';

export const maxDuration = 60;

type ChatMessage = { role: 'user' | 'model'; content: string };

const DAY_NAMES = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function formatPlanForPrompt(plan: TrainingPlan): string {
  const p = plan.profile;
  const totalWeeks = Math.max(0, ...plan.sessions.map(s => s.week));
  const fmtSec = (s: number) => `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}''`;

  const lines = [
    `PROFIL :`,
    `- Objectif : ${p.goalRace} · ${p.goalDate}`,
    `- Chrono cible : ${Math.floor(p.goalTimeMin / 60)}h${p.goalTimeMin % 60 > 0 ? String(p.goalTimeMin % 60).padStart(2, '0') : ''}`,
    `- Allure seuil : ${fmtSec(p.thresholdPaceSec)}/km`,
    `- Volume hebdo : ${p.weeklyKm} km/sem`,
    `- Terrain : ${p.terrain ?? 'flat'}`,
    `- Jours d'entraînement : ${(p.availableDays ?? []).map(d => DAY_NAMES[d]).join(', ')} (${p.availableDays?.length ?? 3} séances/sem)`,
    `- Plan : ${totalWeeks} semaines, ${plan.sessions.length} séances`,
    ``,
    `SÉANCES :`,
  ];

  for (let w = 1; w <= totalWeeks; w++) {
    const ws = plan.sessions.filter(s => s.week === w);
    if (!ws.length) continue;
    lines.push(`Sem ${w} :`);
    for (const s of ws) {
      const desc = s.description ? ` — ${s.description.slice(0, 100)}` : '';
      lines.push(`  [J${s.day}=${DAY_NAMES[s.day] ?? '?'}] ${s.name} · ${s.totalMin}min${s.totalKm ? ` · ${s.totalKm}km` : ''}${desc}`);
    }
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ type: 'answer', message: 'Clé API manquante.' });

    const body = await req.json() as { messages: ChatMessage[]; plan: TrainingPlan };
    const { messages, plan } = body;
    if (!messages?.length || !plan) {
      return NextResponse.json({ type: 'answer', message: 'Données manquantes.' });
    }

    const planText = formatPlanForPrompt(plan);
    const maxPerWeek = Math.max(3, Math.min(6, plan.profile.availableDays?.length ?? 3));

    // Build full conversation as a single prompt (more reliable than startChat for structured output)
    const conversationHistory = messages
      .slice(0, -1)
      .map(m => `${m.role === 'user' ? 'Utilisateur' : 'Coach'}: ${m.content}`)
      .join('\n');
    const lastUserMsg = messages.filter(m => m.role === 'user').at(-1)?.content ?? '';

    const prompt = `Tu es RunAI, coach de course à pied expert. Voici le plan actuel de l'athlète :

${planText}

${conversationHistory ? `HISTORIQUE :\n${conversationHistory}\n` : ''}Utilisateur: ${lastUserMsg}

RÈGLE ABSOLUE : réponds UNIQUEMENT en JSON valide, sans texte avant ni après, sans markdown.

Si l'utilisateur pose une question ou veut une explication → réponds avec :
{"type":"answer","message":"<réponse précise en 2-4 phrases, avec allures exactes si pertinent>"}

Si l'utilisateur demande de modifier le plan (changer des séances, adapter le volume, décaler des jours, modifier l'intensité, supprimer/ajouter des séances, etc.) → génère le plan COMPLET modifié et réponds avec :
{"type":"modification","message":"<2-3 phrases expliquant ce que tu as changé et pourquoi>","sessions":[{"week":N,"day":N,"name":"...","totalMin":N,"km":N,"intensity":"easy|moderate|hard|long|recovery|hill|strength","description":"..."}...],"profile":{"goalRace":"...","goalDate":"...","goalTimeMin":N,"weeklyKm":N,"thresholdPaceSec":N,"availableDays":[...],"terrain":"flat|hilly|trail"}}

Contraintes pour les modifications :
- Conserve TOUTES les semaines (${Math.max(0, ...plan.sessions.map(s => s.week))} semaines)
- Exactement ${maxPerWeek} séances par semaine
- Respecte les jours actuels sauf si l'utilisateur demande de les changer
- Adapte le profil si le chrono cible ou le volume change

JSON uniquement.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.6 },
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();

    // Strip markdown fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

    let parsed: { type: string; message: string; sessions?: GeminiSession[]; profile?: UserProfile };
    try {
      parsed = JSON.parse(jsonStr) as typeof parsed;
    } catch {
      // Gemini didn't return valid JSON — treat as plain answer
      console.error('[plan-chat] JSON parse failed, raw:', raw.slice(0, 200));
      return NextResponse.json({ type: 'answer', message: raw.replace(/^["']|["']$/g, '').slice(0, 500) });
    }

    if (parsed.type === 'modification' && parsed.sessions?.length) {
      // Enforce session count per week
      const byWeek = new Map<number, GeminiSession[]>();
      for (const s of parsed.sessions) {
        if (!byWeek.has(s.week)) byWeek.set(s.week, []);
        byWeek.get(s.week)!.push(s);
      }
      const enforcedSessions: GeminiSession[] = [];
      const days = plan.profile.availableDays ?? [2, 4, 6];
      for (const [, ws] of byWeek) {
        const limited = ws.slice(0, maxPerWeek);
        limited.forEach((s, i) => { s.day = days[i % days.length]; });
        enforcedSessions.push(...limited);
      }
      return NextResponse.json({
        type: 'modification',
        message: parsed.message,
        updatedSessions: enforcedSessions,
        updatedProfile: parsed.profile ?? null,
      });
    }

    return NextResponse.json({ type: 'answer', message: parsed.message ?? raw });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[plan-chat]', msg);
    return NextResponse.json({ type: 'answer', message: `Erreur : ${msg}` });
  }
}
