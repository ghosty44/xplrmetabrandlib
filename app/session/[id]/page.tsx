'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadPlan, savePlan, markSessionCompleted, markSessionSkipped, markSessionGarminSynced, loadGarminTokens, saveGarminTokens, loadUserId, GarminTokens } from '@/lib/store';
import { Session, GpxPoint } from '@/lib/types';
import { getZoneConfig, formatPace, getZoneHRRange } from '@/lib/zones';

const RouteMap = dynamic(() => import('../RouteMapClient'), { ssr: false });
const RouteEditor = dynamic(() => import('../RouteEditorClient'), { ssr: false });

const ZONE_INTENSITY: Record<string, number> = {
  Recup: 0.2,
  EF: 0.35,
  Neutre: 0.45,
  SSeuilVO2: 0.7,
  Seuil: 0.8,
  VO2max: 1.0,
};

const DAY_LABELS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

type ExplInfo = {
  emoji: string;
  what: string;
  why: string;
  tips: string[];
};

const SESSION_EXPLANATIONS: Record<string, ExplInfo> = {
  'Endurance Fondamentale': {
    emoji: '🫁',
    what: 'Course à allure modérée et confortable où tu peux tenir une conversation complète.',
    why: 'Développe le système aérobie de base, améliore la capacité de ton corps à brûler les graisses comme carburant et renforce tes tendons et os progressivement.',
    tips: ['Reste en zone "conversation" (tu dois pouvoir parler par phrases entières)', 'Résiste à la tentation d\'aller plus vite', 'C\'est la séance qui construit 80% de ta forme'],
  },
  'Sortie Longue': {
    emoji: '🏃',
    what: 'La séance phare de la semaine : longue sortie à allure EF pour bâtir ton endurance spécifique.',
    why: 'Adapte ton corps à rester longtemps sur les jambes, améliore la gestion des réserves de glycogène et prépare mentalement et physiquement à la distance de course.',
    tips: ['Pars lentement — plus lentement que tu ne le penses nécessaire', 'Hydrate-toi toutes les 20 min', 'Simule les conditions de course (nutrition, chaussures)'],
  },
  'Récupération Active': {
    emoji: '🌿',
    what: 'Footing très léger à allure récupération, souvent le lendemain d\'un effort intense.',
    why: 'Accélère la récupération musculaire en activant la circulation sans fatiguer davantage. Mieux que le repos complet pour éliminer les déchets métaboliques.',
    tips: ['Vrai rythme de récup — encore plus lent qu\'EF', 'Ne te fixe aucun objectif de performance', 'C\'est le moment de scanner tes sensations'],
  },
  'Intervalles Seuil': {
    emoji: '⚡',
    what: 'Répétitions à allure seuil (environ 87% de ta VMA) entrecoupées de récupération.',
    why: 'Repousse le seuil lactique — la vitesse à laquelle tu commences à accumuler de l\'acide lactique. Un seuil plus élevé = tu cours plus vite plus longtemps.',
    tips: ['L\'allure doit être "confortablement difficile" — tu peux dire quelques mots', 'La récupération est aussi importante que l\'effort', 'Consistance sur toutes les répétitions'],
  },
  'Seuil Longs': {
    emoji: '🔥',
    what: 'Blocs continus à allure seuil de 10 à 20 min — plus exigeants que les intervalles courts.',
    why: 'Améliore la capacité à maintenir une allure rapide sur la durée, ce qui est directement corrélé avec ta performance en course.',
    tips: ['Démarre légèrement en dessous de l\'allure cible et monte progressivement', 'Concentre-toi sur la régularité de l\'allure', 'Surveille ta FC — elle monte progressivement même à allure constante'],
  },
  'Tempo': {
    emoji: '🎯',
    what: 'Course soutenue à allure tempo (85-90% VMA) pendant une durée prolongée.',
    why: 'Développe à la fois l\'efficacité mécanique et la tolérance à l\'inconfort à allures rapides. Excellente séance de préparation spécifique.',
    tips: ['Choisis un parcours plat pour maintenir l\'allure', 'Commence 5-10 sec/km plus lent et accélère', 'La distance doit être calculée avant — ne t\'arrête pas pour regarder la montre'],
  },
  'Rappel Allure Cible': {
    emoji: '🎪',
    what: 'Entraîne-toi à courir précisément à l\'allure de ta course objectif.',
    why: 'Le feeling de ton allure cible doit devenir automatique. Cette séance grave en mémoire musculaire le rythme exact que tu devras tenir en compétition.',
    tips: ['Concentre-toi sur les sensations, pas seulement sur les chiffres de la montre', 'C\'est l\'allure que tu vises en course — teste-la en conditions proches', 'Note comment tu te sens : c\'est une allure que tu dois pouvoir maintenir longtemps'],
  },
  'VO2max Courts': {
    emoji: '🚀',
    what: 'Répétitions courtes (30s à 2 min) à allure VO2max (95-100% VMA) avec récupération égale ou supérieure.',
    why: 'Stimule le développement du VO2max — ta capacité maximale à utiliser l\'oxygène. La zone la plus efficace pour progresser en vitesse pure.',
    tips: ['Chaque répétition doit être à fond — qualité sur quantité', 'Récupère complètement entre les répétitions', 'Commence conservateur : si tu tiens toutes les reps, tu es au bon niveau'],
  },
  'VO2max Développement': {
    emoji: '🚀',
    what: 'Intervalles de 2 à 4 min à intensité VO2max pour développer ta puissance aérobie maximale.',
    why: 'Ces séances sont celles qui font le plus progresser ta VMA et donc ton plafond de vitesse. Elles sont exigeantes mais très efficaces.',
    tips: ['Chauffe-toi bien — au moins 15 min à EF', 'Règle ton effort par la FC en fin d\'intervalle (95%+ FC max)', 'Laisse 48-72h de récupération après cette séance'],
  },
  'VO2max Spécifique': {
    emoji: '🚀',
    what: 'Travail ciblé à l\'intensité VO2max adapté à ta discipline et ta phase d\'entraînement.',
    why: 'Perfectionne ton efficacité à haute intensité tout en préparant spécifiquement les filières énergétiques que tu utiliseras en course.',
    tips: ['Adapte selon tes sensations — la fatigue s\'accumule sur les semaines', 'Priorise la qualité des premières répétitions', 'Bois de l\'eau entre chaque répétition'],
  },
};

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<import('@/lib/types').TrainingPlan | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showRouteEditor, setShowRouteEditor] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [showExpl, setShowExpl] = useState(false);

  useEffect(() => {
    const p = loadPlan();
    if (!p) { router.replace('/setup'); return; }
    const found = p.sessions.find((s) => s.id === params.id);
    if (!found) { router.replace('/'); return; }
    setPlan(p);
    setSession(found);
    setLoaded(true);
  }, [params.id, router]);

  function syncPlanToDB() {
    const updated = loadPlan();
    const userId = loadUserId();
    if (!updated || !userId) return;
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan: updated }),
    }).catch(() => {});
  }

  const handleComplete = () => {
    if (!session) return;
    markSessionCompleted(session.id);
    setSession((s) => s ? { ...s, completed: true, skipped: false } : s);
    syncPlanToDB();
  };

  const handleSkip = () => {
    if (!session) return;
    if (!confirmSkip) { setConfirmSkip(true); return; }
    markSessionSkipped(session.id, true);
    setSession((s) => s ? { ...s, skipped: true, completed: false } : s);
    setConfirmSkip(false);
    syncPlanToDB();
  };

  const handleUndoSkip = () => {
    if (!session) return;
    markSessionSkipped(session.id, false);
    setSession((s) => s ? { ...s, skipped: false } : s);
    syncPlanToDB();
  };

  const handleGarminSync = async () => {
    if (!session) return;
    const garminTokens = loadGarminTokens();
    if (!garminTokens) {
      setSyncResult({ success: false, message: 'Connectez votre compte Garmin dans les Paramètres avant de synchroniser.' });
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/garmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, plan, garminTokens }),
      });
      const data = await res.json() as { success: boolean; workoutId?: string; scheduledDate?: string; refreshedTokens?: GarminTokens; error?: string };
      if (data.success) {
        if (data.refreshedTokens) saveGarminTokens(data.refreshedTokens);
        markSessionGarminSynced(session.id);
        setSession((s) => s ? { ...s, garminSynced: true } : s);
        const scheduleMsg = data.scheduledDate ? ` · Planifié le ${data.scheduledDate}` : '';
        setSyncResult({ success: true, message: `Synchronisé dans ton calendrier Garmin !${scheduleMsg}` });
        syncPlanToDB();
      } else {
        setSyncResult({ success: false, message: data.error ?? 'Erreur inconnue' });
      }
    } catch {
      setSyncResult({ success: false, message: 'Erreur réseau' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveRoute = (coords: GpxPoint[], distanceKm: number) => {
    if (!session) return;
    const p = loadPlan();
    if (!p) return;
    p.sessions = p.sessions.map((s) =>
      s.id === session.id ? { ...s, gpxCoords: coords, gpxDistanceKm: distanceKm } : s
    );
    savePlan(p);
    setSession((s) => s ? { ...s, gpxCoords: coords, gpxDistanceKm: distanceKm } : s);
    setShowRouteEditor(false);
    const userId = loadUserId();
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan: p }),
    }).catch(() => {});
  };

  if (!loaded || !session) {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
      </div>
    );
  }

  const totalMin = session.totalMin;
  const isStrength = session.type === 'strength';
  const uniqueZones = Array.from(new Set(session.steps.map((s) => s.zone).filter(Boolean))) as import('@/lib/types').Zone[];
  const expl = SESSION_EXPLANATIONS[session.name];

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#F2F2F7]/80 backdrop-blur-xl">
        <div className="max-w-md mx-auto px-4 pt-12 pb-3 flex items-center gap-3">
          <Link
            href="/"
            className="w-8 h-8 rounded-full bg-white border border-black/8 flex items-center justify-center flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-bold text-[#0F0F10] truncate">{session.name}</h1>
              {session.completed && (
                <div className="w-5 h-5 rounded-full bg-[#C8E635] flex items-center justify-center flex-shrink-0">
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4l2.5 2.5L9 1" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}
              {session.skipped && !session.completed && (
                <div className="w-5 h-5 rounded-full bg-[#8E8E93] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[10px] font-bold leading-none">–</span>
                </div>
              )}
              {session.garminSynced && (
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-[9px] font-bold">G</span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-[#8E8E93]">
              {DAY_LABELS[session.day]} · Sem. {session.week} · {totalMin} min
              {!isStrength && (() => {
                const INTENSITY: Record<string, number> = { Recup: 0.2, EF: 0.35, Neutre: 0.45, SSeuilVO2: 0.7, Seuil: 0.8, VO2max: 1.0 };
                let best: import('@/lib/types').Zone | null = null;
                let bestI = -1;
                for (const s of session.steps) {
                  if (!s.zone || s.isRecovery) continue;
                  const i = INTENSITY[s.zone] ?? 0;
                  if (i > bestI) { bestI = i; best = s.zone; }
                }
                if (!best) return null;
                const r = getZoneHRRange(best);
                const mhr = plan?.profile.maxHR;
                const label = mhr
                  ? `${Math.round(mhr * r.min / 100)}–${Math.round(mhr * r.max / 100)} bpm`
                  : `${r.min}–${r.max}% FC`;
                return ` · ♥ ${label}`;
              })()}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-32 space-y-3">
        {/* Skipped banner */}
        {session.skipped && !session.completed && (
          <div className="rounded-[20px] bg-[#8E8E93]/10 border border-[#8E8E93]/20 px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-[#8E8E93]">Séance passée</p>
              <p className="text-[11px] text-[#8E8E93]/70 mt-0.5">Tu as indiqué ne pas avoir fait cette séance.</p>
            </div>
            <button
              onClick={handleUndoSkip}
              className="text-[12px] font-semibold text-[#0F0F10] bg-white border border-black/8 px-3 py-1.5 rounded-[10px] flex-shrink-0 transition-all active:scale-[0.97]"
            >
              Annuler
            </button>
          </div>
        )}

        {/* Description */}
        {session.description && (
          <div className="rounded-[20px] bg-white border border-black/5 px-5 py-4">
            <p className="text-[13px] text-[#8E8E93] leading-relaxed">{session.description}</p>
          </div>
        )}

        {/* Session explanation card */}
        {expl && (
          <div className="rounded-[20px] bg-white border border-black/5 overflow-hidden">
            <button
              onClick={() => setShowExpl((v) => !v)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left transition-all active:bg-[#F2F2F7]/50"
            >
              <span className="text-xl flex-shrink-0">{expl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#0F0F10]">C&apos;est quoi cette séance ?</p>
                <p className="text-[11px] text-[#8E8E93]">{showExpl ? 'Masquer les détails' : 'Voir les détails'}</p>
              </div>
              <svg
                width="16" height="16" viewBox="0 0 16 16" fill="none"
                className={`flex-shrink-0 transition-transform ${showExpl ? 'rotate-180' : ''}`}
              >
                <path d="M4 6l4 4 4-4" stroke="#8E8E93" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {showExpl && (
              <div className="px-5 pb-5 space-y-3 border-t border-[#F2F2F7]">
                <div className="pt-3">
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Qu&apos;est-ce que c&apos;est</p>
                  <p className="text-[13px] text-[#0F0F10] leading-relaxed">{expl.what}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Pourquoi c&apos;est utile</p>
                  <p className="text-[13px] text-[#0F0F10] leading-relaxed">{expl.why}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Conseils</p>
                  <ul className="space-y-1.5">
                    {expl.tips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-[#C8E635] font-bold text-[13px] mt-0.5 flex-shrink-0">·</span>
                        <p className="text-[13px] text-[#0F0F10] leading-relaxed">{tip}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Route map — running only */}
        {!isStrength && session.gpxCoords && session.gpxCoords.length > 0 ? (
          <div>
            <RouteMap coords={session.gpxCoords} distanceKm={session.gpxDistanceKm} />
            <button
              onClick={() => setShowRouteEditor(true)}
              className="mt-2 w-full py-2 text-[12px] font-semibold text-[#8E8E93] text-center"
            >
              Modifier le tracé
            </button>
          </div>
        ) : !isStrength ? (
          <button
            onClick={() => setShowRouteEditor(true)}
            className="w-full py-3.5 rounded-[20px] border border-dashed border-[#8E8E93]/40 text-[13px] font-semibold text-[#8E8E93] flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 11l19-9-9 19-2-8-8-2z"/>
            </svg>
            Tracer un itinéraire
          </button>
        ) : null}

        {/* Route editor modal */}
        {showRouteEditor && (
          <RouteEditor
            initial={session.gpxCoords}
            onSave={handleSaveRoute}
            onClose={() => setShowRouteEditor(false)}
          />
        )}

        {isStrength ? (
          /* ── Strength exercise list ── */
          <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F2F2F7] flex items-center gap-2">
              <span className="text-lg">💪</span>
              <p className="text-[13px] font-semibold text-[#0F0F10]">Programme de la séance</p>
            </div>
            {session.steps.map((step, idx) => {
              const isWarmCool = idx === 0 || idx === session.steps.length - 1;
              return (
                <div key={idx} className="flex items-center gap-4 px-5 py-3.5 border-b border-[#F2F2F7]/80 last:border-0">
                  <div
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: isWarmCool ? '#9ca3af' : '#6366f1', minHeight: '36px' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#0F0F10]">{step.exercise}</p>
                    {!isWarmCool && step.sets && (
                      <p className="text-[11px] text-[#8E8E93]">{step.sets} séries · {step.repCount}</p>
                    )}
                    {isWarmCool && (
                      <p className="text-[11px] text-[#8E8E93]">{step.durationMin} min</p>
                    )}
                  </div>
                  {!isWarmCool && (
                    <div className="w-8 h-8 rounded-[10px] bg-[#6366f1]/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-bold text-[#6366f1]">{step.sets}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {/* ── Running interval chart ── */}
            <div className="rounded-[24px] bg-[#0F0F10] overflow-hidden p-5">
              <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-4">Graphique des intervalles</p>
              <div className="flex items-end gap-0.5 h-20 mb-4">
                {session.steps.map((step, idx) => {
                  if (!step.zone) return null;
                  const reps = step.reps ?? 1;
                  const config = getZoneConfig(step.zone);
                  const intensity = ZONE_INTENSITY[step.zone] ?? 0.5;
                  const widthPct = (step.durationMin * reps) / totalMin;
                  return (
                    <div key={idx} className="rounded-t-[4px] flex-shrink-0"
                      style={{ backgroundColor: config.color, width: `${widthPct * 100}%`, height: `${intensity * 100}%` }}
                      title={`${config.label} – ${step.durationMin * reps} min`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3">
                {uniqueZones.map((zone) => {
                  const cfg = getZoneConfig(zone);
                  return (
                    <div key={zone} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
                      <span className="text-[11px] text-[#8E8E93]">{cfg.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Running steps list ── */}
            <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
              <div className="px-5 py-4 border-b border-[#F2F2F7]">
                <p className="text-[13px] font-semibold text-[#0F0F10]">Détail des étapes</p>
              </div>
              {session.steps.map((step, idx) => {
                if (!step.zone) return null;
                const config = getZoneConfig(step.zone);
                const reps = step.reps ?? 1;
                const effectiveDuration = step.durationMin * reps;
                return (
                  <div key={idx} className="flex items-center gap-4 px-5 py-3.5 border-b border-[#F2F2F7]/80 last:border-0">
                    <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: config.color, minHeight: '36px' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[13px] font-semibold text-[#0F0F10]">{config.label}</span>
                        {step.isRecovery && <span className="text-[10px] bg-[#F2F2F7] text-[#8E8E93] px-1.5 py-0.5 rounded-md font-medium">récup</span>}
                        {reps > 1 && <span className="text-[10px] bg-[#F2F2F7] text-[#0F0F10] px-1.5 py-0.5 rounded-md font-semibold">×{reps}</span>}
                      </div>
                      <p className="text-[11px] text-[#8E8E93]">
                        {reps > 1 ? `${reps}×${step.durationMin} min = ${effectiveDuration} min` : `${effectiveDuration} min`}
                      </p>
                    </div>
                    {(() => {
                      const hrPct = getZoneHRRange(step.zone!);
                      const maxHR = plan?.profile.maxHR;
                      const hrLabel = maxHR
                        ? `${Math.round(maxHR * hrPct.min / 100)}–${Math.round(maxHR * hrPct.max / 100)} bpm`
                        : `${hrPct.min}–${hrPct.max}% FCmax`;
                      return (
                        <div className="text-right flex-shrink-0">
                          {step.targetPace && (
                            <>
                              <p className="text-[13px] font-bold text-[#0F0F10] tabular-nums">
                                {formatPace(step.targetPace.minSec)}–{formatPace(step.targetPace.maxSec)}
                              </p>
                              <p className="text-[10px] text-[#8E8E93]">/km</p>
                            </>
                          )}
                          <p className="text-[11px] font-semibold text-[#8E8E93] tabular-nums mt-0.5">{hrLabel}</p>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Sync result */}
        {syncResult && (
          <div className={`rounded-[20px] p-4 text-[13px] ${
            syncResult.success
              ? 'bg-[#C8E635]/15 border border-[#C8E635]/30 text-[#0F0F10]'
              : 'bg-red-50 border border-red-100 text-red-700'
          }`}>
            <p>{syncResult.success ? '✓ ' : '✗ '}{syncResult.message}</p>
            {!syncResult.success && syncResult.message.includes('Paramètres') && (
              <Link href="/settings" className="inline-block mt-1 text-[11px] text-[#8E8E93] underline underline-offset-2">
                Aller aux Paramètres →
              </Link>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2 pt-1">
          <div className="flex gap-2">
            {!isStrength && (
              <button
                onClick={handleGarminSync}
                disabled={syncing || !!session.garminSynced}
                className="flex-1 py-3.5 px-4 rounded-[16px] bg-white border border-black/8 text-[13px] font-semibold text-[#0F0F10] disabled:opacity-40 transition-all active:scale-[0.97]"
              >
                {syncing ? 'Sync...' : session.garminSynced ? '✓ Garmin' : 'Sync Garmin'}
              </button>
            )}
            <button
              onClick={handleComplete}
              disabled={session.completed}
              className="flex-1 py-3.5 px-4 rounded-[16px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:bg-[#C8E635] disabled:text-[#0F0F10] transition-all active:scale-[0.97]"
            >
              {session.completed ? '✓ Complétée' : 'Valider la séance'}
            </button>
          </div>
          {!session.completed && !session.skipped && (
            <button
              onClick={handleSkip}
              onBlur={() => setConfirmSkip(false)}
              className={`w-full py-3 rounded-[14px] text-[13px] font-semibold transition-all active:scale-[0.98] ${
                confirmSkip
                  ? 'bg-red-500 text-white'
                  : 'bg-[#F2F2F7] text-[#8E8E93]'
              }`}
            >
              {confirmSkip ? 'Confirmer — marquer comme non faite' : 'Je ne l\'ai pas faite'}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
