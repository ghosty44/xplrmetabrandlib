import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `Tu es Campus Coach, un assistant coach running expert et bienveillant. Tu parles exclusivement en français, de façon chaleureuse et concise.

Ton objectif : collecter les informations nécessaires pour créer un plan d'entraînement running personnalisé.

Informations à collecter dans l'ordre :
1. La course cible : marathon (42.195km), semi-marathon (21.1km), 10km, ou 5km
2. La date de la course (tu peux l'interpréter même en format naturel ex: "15 juin", "mars 2026")
3. Le temps visé sur cette distance (ex: "3h30", "45 minutes")
4. Le volume d'entraînement actuel (km par semaine)
5. La FC max — précise que c'est facultatif, tu peux faire sans

Règles impératives :
- Pose UNE seule question à la fois
- 2 phrases max par réponse pendant la collecte
- Confirme chaque info reçue en une phrase avant de passer à la suivante
- Quand tu as les 4 infos obligatoires (course, date, temps, km/sem), génère le profil

Quand tu as toutes les infos obligatoires, ta réponse doit contenir DEUX choses :

1. Un bloc PROFILE (invisible) avec les données :
<PROFILE>{"goalRace":"marathon","goalDate":"YYYY-MM-DD","goalTimeMin":210,"weeklyKm":40,"thresholdPaceSec":275}</PROFILE>
Si tu as la FC max, ajoute "maxHR":185 dans le JSON.

2. Un bloc EXPLANATION (invisible) avec une explication coach du plan proposé, 3-4 phrases percutantes :
<EXPLANATION>Ton plan de X semaines est construit autour de... [explique la logique du plan, pourquoi ce nombre de semaines, quels types de séances et pourquoi ils sont adaptés à l'objectif et au profil, ce qui va progresser semaine après semaine]</EXPLANATION>

Règles de calcul :
- thresholdPaceSec = Math.round((goalTimeMin * 60 / distanceKm) * 0.92)
- distances : marathon=42.195, halfMarathon=21.1, 10k=10, 5k=5
- goalRace : exactement "marathon", "halfMarathon", "10k", ou "5k"
- goalDate : ISO YYYY-MM-DD (interprète l'année comme 2025 ou 2026 selon le contexte)
- goalTimeMin : en minutes entières

Le texte visible quand tu génères le profil doit être UNE phrase d'accroche courte et motivante (ex: "Parfait, voici ce que j'ai préparé pour toi !"), sans détailler le plan — les détails sont dans l'EXPLANATION.

Commence par : une phrase de bienvenue et demande la course cible.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY non configurée' }, { status: 500 });
  }

  const { messages } = await req.json() as {
    messages: Array<{ role: 'user' | 'model'; content: string }>;
  };

  if (!messages?.length) {
    return NextResponse.json({ error: 'messages requis' }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: SYSTEM_PROMPT,
  });

  const history = messages.slice(0, -1).map((m) => ({
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
    return NextResponse.json({ message: `Désolé, une erreur est survenue : ${msg}`, profile: null, explanation: null }, { status: 200 });
  }

  const profileMatch = raw.match(/<PROFILE>([\s\S]*?)<\/PROFILE>/);
  const explanationMatch = raw.match(/<EXPLANATION>([\s\S]*?)<\/EXPLANATION>/);

  let profile = null;
  let explanation: string | null = null;
  const message = raw
    .replace(/<PROFILE>[\s\S]*?<\/PROFILE>/g, '')
    .replace(/<EXPLANATION>[\s\S]*?<\/EXPLANATION>/g, '')
    .trim();

  if (profileMatch) {
    try {
      profile = JSON.parse(profileMatch[1].trim());
    } catch { /* invalid JSON, ignore */ }
  }
  if (explanationMatch) {
    explanation = explanationMatch[1].trim();
  }

  return NextResponse.json({ message, profile, explanation });
}
