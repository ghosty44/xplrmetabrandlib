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
    `PROFIL ATHLÈTE :`,
    `- Objectif : ${p.goalRace} · ${p.goalDate}`,
    `- Chrono cible : ${Math.floor(p.goalTimeMin / 60)}h${p.goalTimeMin % 60 > 0 ? String(p.goalTimeMin % 60).padStart(2, '0') : ''}`,
    `- Allure seuil : ${fmtSec(p.thresholdPaceSec)}/km`,
    `- Volume hebdo : ${p.weeklyKm} km/sem`,
    `- Terrain : ${p.terrain ?? 'flat'}`,
    `- Séances/sem : ${p.availableDays?.length ?? '?'} (jours : ${(p.availableDays ?? []).map(d => DAY_NAMES[d]).join(', ')})`,
    `- Plan : ${totalWeeks} semaines, ${plan.sessions.length} séances au total`,
    ``,
    `PLAN COMPLET :`,
  ];

  for (let w = 1; w <= totalWeeks; w++) {
    const ws = plan.sessions.filter(s => s.week === w);
    if (!ws.length) continue;
    lines.push(`Semaine ${w} :`);
    for (const s of ws) {
      const desc = s.description ? ` — ${s.description.slice(0, 120)}` : '';
      const sType = s.type ?? 'running';
      lines.push(`  [${DAY_NAMES[s.day] ?? `J${s.day}`}] ${s.name} · ${s.totalMin}min${s.totalKm ? ` · ${s.totalKm}km` : ''} · ${sType}${desc}`);
    }
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ message: 'Clé API manquante.' });

    const body = await req.json() as {
      messages: ChatMessage[];
      plan: TrainingPlan;
    };
    const { messages, plan } = body;
    if (!messages?.length || !plan) {
      return NextResponse.json({ message: 'Données manquantes.' });
    }

    const planText = formatPlanForPrompt(plan);
    const lastUserMsg = messages.filter(m => m.role === 'user').at(-1)?.content ?? '';

    // Detect modification intent
    const isModification = /modif|chang|remplace|enlève|supprime|ajoute|adapte|décale|réduis|augmente|retire|déplace/i.test(lastUserMsg);

    const systemPrompt = `Tu es RunAI, un coach de course à pied expert. Tu assistes l'utilisateur sur son plan d'entraînement personnalisé.

${planText}

${isModification ? `L'utilisateur demande une MODIFICATION du plan. Réponds en JSON UNIQUEMENT, sans texte avant ni après, sans markdown :
{
  "message": "<explication bienveillante de 2-3 phrases de ce que tu as modifié et pourquoi>",
  "sessions": [<tableau COMPLET de TOUTES les séances modifiées, même format que le plan original : {"week":N,"day":N,"name":"...","totalMin":N,"km":N,"intensity":"easy|moderate|hard|long|recovery|hill|strength","description":"..."}>, ...],
  "profile": {"goalRace":"...","goalDate":"...","goalTimeMin":N,"weeklyKm":N,"thresholdPaceSec":N,"availableDays":[...],"terrain":"flat|hilly|trail"}
}
Conserve toutes les semaines. Respecte le nombre de séances par semaine (${plan.profile.availableDays?.length ?? 3}).` : `L'utilisateur pose une QUESTION sur son plan. Réponds en texte clair, 2-4 phrases. Sois précis et technique. Donne des allures exactes si pertinent. Pas de JSON.`}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7 },
      systemInstruction: systemPrompt,
    });

    const history = messages.slice(0, -1).map(m => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastUserMsg);
    const raw = result.response.text().trim();

    // Try to parse as JSON (modification response)
    const jsonStr = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    try {
      const parsed = JSON.parse(jsonStr) as {
        message: string;
        sessions?: GeminiSession[];
        profile?: UserProfile;
      };
      if (parsed.sessions?.length) {
        // Enforce session count
        const maxPerWeek = plan.profile.availableDays?.length ?? 3;
        const byWeek = new Map<number, GeminiSession[]>();
        for (const s of parsed.sessions) {
          if (!byWeek.has(s.week)) byWeek.set(s.week, []);
          byWeek.get(s.week)!.push(s);
        }
        const sessions: GeminiSession[] = [];
        for (const [, ws] of byWeek) {
          sessions.push(...ws.slice(0, maxPerWeek));
        }
        return NextResponse.json({
          message: parsed.message ?? 'Plan modifié.',
          updatedSessions: sessions,
          updatedProfile: parsed.profile ?? null,
        });
      }
      if (parsed.message) return NextResponse.json({ message: parsed.message });
    } catch { /* not JSON — plain text answer */ }

    return NextResponse.json({ message: raw });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ message: `Erreur : ${msg}` });
  }
}
