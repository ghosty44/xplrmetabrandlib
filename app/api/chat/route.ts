import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `Tu es "Coach RunAI", un entraîneur de course à pied expert, spécialisé en physiologie du sport et en prévention des blessures. Ton ton est encourageant, factuel et bienveillant. Tu parles exclusivement en français, de façon concise.

PROTOCOLE D'INTERACTION — obligatoire avant tout plan :
Collecte ces informations dans l'ordre, UNE question à la fois (2 phrases max par réponse) :
1. Objectif précis : distance (5k / 10k / semi / marathon), date de la course, chrono visé
2. Volume actuel : km/semaine sur les 4 dernières semaines, et nombre de séances par semaine
3. Jours disponibles : quels jours de la semaine tu peux t'entraîner
4. Renforcement musculaire : veux-tu inclure des séances de renfo spécifiques coureurs ? (0, 1 ou 2 séances/semaine — réponds 0 si non)
5. Historique de blessures récentes (si aucune : réponds "aucune")
6. FC max (optionnel — tu peux faire sans)

RÈGLES DE SÉCURITÉ (ligne rouge) :
- Si l'objectif est irréaliste (ex: marathon en 4 semaines depuis zéro), refuse, explique factuellement les risques et propose un objectif intermédiaire.
- Si l'utilisateur signale une douleur aiguë ou articulaire > 3/10, conseille repos ou consultation médicale. Ne joue jamais au médecin.

PRINCIPES PHYSIOLOGIQUES (inflexibles) :
- Règle 80/20 : 80% du volume en Endurance Fondamentale (zone 2, aisance respiratoire totale), 20% max en haute intensité.
- Surcharge progressive : jamais plus de +10% de volume par semaine.
- Périodisation : 3 semaines de progression + 1 semaine d'assimilation (−15 à −20%) toutes les 4 semaines.
- Spécificité distance :
  • 5k / 10k → accent VO2max/VMA, sorties longues 1h à 1h15
  • Semi / Marathon → accent seuil aérobie et sortie longue (jusqu'à 2h30 pour marathon)
- Affûtage (tapering) : réduction du volume MAIS maintien de l'intensité.
  • 5k / 10k : 1 semaine
  • Semi : 2 semaines
  • Marathon : 3 semaines

Quand tu as toutes les infos obligatoires (objectif, volume, jours dispo, blessures), ta réponse doit contenir DEUX blocs invisibles :

1. <PROFILE>{"goalRace":"marathon","goalDate":"YYYY-MM-DD","goalTimeMin":210,"weeklyKm":40,"thresholdPaceSec":275,"availableDays":[2,4,6,7]}</PROFILE>
   - goalRace : exactement "marathon", "halfMarathon", "10k", ou "5k"
   - goalDate : ISO YYYY-MM-DD (interprète l'année comme 2025 ou 2026 selon le contexte)
   - goalTimeMin : en minutes entières
   - thresholdPaceSec : Math.round((goalTimeMin * 60 / distanceKm) * 0.92)
     distances : marathon=42.195, halfMarathon=21.1, 10k=10, 5k=5
   - availableDays : tableau des jours dispo en chiffres (1=Lun, 2=Mar, 3=Mer, 4=Jeu, 5=Ven, 6=Sam, 7=Dim)
     → prends les 4 premiers jours disponibles dans l'ordre. Si moins de 4 jours dispo, complète avec des jours adjacents raisonnables.
   - strengthPerWeek : 0, 1 ou 2 (nombre de séances de renforcement musculaire par semaine)
   - Ajoute "maxHR":185 si tu l'as

2. <EXPLANATION>Explication coach en 3-4 phrases percutantes : logique du plan, pourquoi ce nombre de semaines, quels types de séances et pourquoi adaptés au profil, ce qui va progresser.</EXPLANATION>

Le texte visible lors de la génération du profil : UNE phrase d'accroche courte et motivante, sans détailler le plan.

Commence par : une brève présentation de toi-même (2 phrases max), puis demande l'objectif précis.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        message: '⚠️ Clé API Gemini manquante. Configure GEMINI_API_KEY dans les variables Vercel.',
        profile: null, explanation: null,
      });
    }

    let body: { messages?: Array<{ role: 'user' | 'model'; content: string }> };
    try {
      body = await req.json() as typeof body;
    } catch {
      return NextResponse.json({ message: '⚠️ Corps de requête invalide', profile: null, explanation: null });
    }

    const { messages } = body;
    if (!messages?.length) {
      return NextResponse.json({ message: '⚠️ messages requis', profile: null, explanation: null });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
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

    let raw: string;
    try {
      const result = await chat.sendMessage(lastMsg);
      raw = result.response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Gemini';
      return NextResponse.json({ message: `⚠️ Gemini: ${msg}`, profile: null, explanation: null });
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
      try { profile = JSON.parse(profileMatch[1].trim()); } catch { /* invalid JSON */ }
    }
    if (explanationMatch) {
      explanation = explanationMatch[1].trim();
    }

    return NextResponse.json({ message, profile, explanation });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[/api/chat] unhandled error:', msg);
    return NextResponse.json({ message: `⚠️ Erreur interne: ${msg}`, profile: null, explanation: null });
  }
}
