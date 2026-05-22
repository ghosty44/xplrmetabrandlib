import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { EXERCISES } from '@/lib/exercises';

const exerciseNames = EXERCISES.map(e => `"${e.name}"`).join(', ');

const SYSTEM_PROMPT = `Tu es un kinésithérapeute expert et diplômé. L'utilisateur te décrit une douleur, une gêne ou une zone corporelle à problème. Tu lui recommandes des exercices de rééducation ou de renforcement adaptés.

Pour chaque recommandation, précise :
- Quels exercices faire (nombre de séries, répétitions, durée)
- À quelle fréquence par semaine
- Les précautions et signes d'alerte à surveiller

RÈGLE DE SÉCURITÉ ABSOLUE : Si la douleur est > 3/10, articulaire, ou présente depuis plus d'une semaine, commence TOUJOURS par recommander une consultation médicale avant tout exercice.

Tu peux recommander des exercices présents dans la bibliothèque de l'application. La bibliothèque contient les exercices suivants : ${exerciseNames}.
Quand tu recommandes un exercice de la bibliothèque, mentionne son nom EXACTEMENT tel qu'il est dans la liste ci-dessus — l'application pourra alors le mettre en évidence.

Réponds en français, de façon concise, bienveillante et professionnelle. Maximum 6 phrases sauf si l'utilisateur demande plus de détails.`;

type GeminiMessage = {
  role: 'user' | 'model';
  parts: [{ text: string }];
};

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        message: '⚠️ Clé API Gemini manquante. Configure GEMINI_API_KEY.',
      });
    }

    let body: { messages?: Array<{ role: 'user' | 'model'; content: string }> };
    try {
      body = await req.json() as typeof body;
    } catch {
      return NextResponse.json({ message: '⚠️ Corps de requête invalide.' });
    }

    const { messages } = body;
    if (!messages?.length) {
      return NextResponse.json({ message: '⚠️ messages requis.' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    // Drop leading model messages (welcome) so history starts with 'user'
    const historyRaw = messages.slice(0, -1);
    const firstUserIdx = historyRaw.findIndex(m => m.role === 'user');
    const history: GeminiMessage[] = (firstUserIdx >= 0 ? historyRaw.slice(firstUserIdx) : []).map(m => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const lastMsg = messages[messages.length - 1].content;

    let raw: string;
    try {
      const result = await chat.sendMessage(lastMsg);
      raw = result.response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Gemini';
      return NextResponse.json({ message: `⚠️ ${msg}` });
    }

    // Detect exercise names mentioned in the response
    const mentioned = EXERCISES
      .filter(e => raw.includes(e.name))
      .map(e => e.id);

    return NextResponse.json({ message: raw, suggestedExerciseIds: mentioned });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ message: `⚠️ Erreur interne : ${msg}` });
  }
}
