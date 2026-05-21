'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { generatePlan } from '@/lib/plan';
import { savePlan, saveProfile, saveGarminTokens, loadGarminTokens, getOrCreateUserId, loadUserId, loadPlan, GarminTokens } from '@/lib/store';
import { UserProfile, TrainingPlan } from '@/lib/types';
import { formatPace } from '@/lib/zones';

type Phase = 'chat' | 'preview' | 'garmin';
type ChatMessage = { role: 'user' | 'model'; content: string; hidden?: boolean };

const RACE_LABELS: Record<string, string> = {
  marathon: 'Marathon',
  halfMarathon: 'Semi-Marathon',
  '10k': '10 km',
  '5k': '5 km',
};

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-2 h-2 rounded-full bg-[#8E8E93] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function SetupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('force') === '1') return false;
    return !loadPlan();
  });
  const [welcomePhase, setWelcomePhase] = useState<'hero' | 'garmin'>('hero');
  const [heroDataUrl, setHeroDataUrl] = useState<string | null>(null);

  // Chat state
  const [phase, setPhase] = useState<Phase>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Preview state — plan generated but not saved yet
  const [pendingPlan, setPendingPlan] = useState<TrainingPlan | null>(null);
  const [pendingProfile, setPendingProfile] = useState<UserProfile | null>(null);
  const [planExplanation, setPlanExplanation] = useState('');

  // Garmin state
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState<string | null>(null);
  const [garminConnected, setGarminConnected] = useState(false);

  useEffect(() => {
    if (searchParams.get('force') !== '1' && loadPlan()) {
      router.replace('/');
      return;
    }
    const userId = loadUserId();
    if (userId) {
      fetch(`/api/gallery?userId=${encodeURIComponent(userId)}`)
        .then((r) => r.json())
        .then((d: { images: Array<{ purpose: string; dataUrl: string }> }) => {
          const hero = d.images?.find((i) => i.purpose === 'hero');
          if (hero) setHeroDataUrl(hero.dataUrl);
        })
        .catch(() => {});
    }
  }, [router, searchParams]);

  useEffect(() => {
    if (!showWelcome && messages.length === 0) {
      kickstart();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWelcome]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function kickstart() {
    setThinking(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Bonjour' }] }),
      });
      const data = await res.json() as { message?: string; error?: string };
      const msg = data.message || data.error || 'Bonjour ! Je suis Campus Coach. Quelle course prépares-tu ?';
      // Keep the initial 'Bonjour' in history (Gemini requires history to start with 'user')
      // but mark it hidden so it doesn't render in the UI
      setMessages([
        { role: 'user', content: 'Bonjour', hidden: true },
        { role: 'model', content: msg },
      ]);
    } catch {
      setMessages([{ role: 'model', content: 'Bonjour ! Je suis Campus Coach. Quelle course prépares-tu ?' }]);
    } finally {
      setThinking(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setThinking(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json() as {
        message?: string;
        profile?: UserProfile | null;
        explanation?: string | null;
        error?: string;
      };

      const reply = data.message || data.error || 'Désolé, une erreur est survenue.';
      setMessages((prev) => [...prev, { role: 'model', content: reply }]);

      if (data.profile) {
        const plan = generatePlan(data.profile);
        setPendingProfile(data.profile);
        setPendingPlan(plan);
        setPlanExplanation(data.explanation ?? '');
        setTimeout(() => setPhase('preview'), 900);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'model', content: 'Erreur réseau. Réessaie !' }]);
    } finally {
      setThinking(false);
    }
  }

  function confirmPlan() {
    if (!pendingPlan || !pendingProfile) return;
    saveProfile(pendingProfile);
    savePlan(pendingPlan);
    const userId = getOrCreateUserId();
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan: pendingPlan }),
    }).catch(() => {});
    setPhase('garmin');
  }

  function restartChat() {
    setPendingPlan(null);
    setPendingProfile(null);
    setPlanExplanation('');
    setMessages([]);
    setPhase('chat');
    kickstart();
  }

  const handleGarminConnect = async () => {
    setGarminLoading(true);
    setGarminError(null);
    try {
      const res = await fetch('/api/garmin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: garminEmail, password: garminPassword }),
      });
      const data = await res.json() as { success: boolean; tokens?: GarminTokens; error?: string };
      if (data.success && data.tokens) {
        saveGarminTokens(data.tokens);
        setGarminConnected(true);
      } else {
        setGarminError(data.error ?? 'Identifiants incorrects');
      }
    } catch {
      setGarminError('Erreur réseau');
    } finally {
      setGarminLoading(false);
    }
  };

  // ── Welcome screen ────────────────────────────────────────────────────────
  if (showWelcome) {
    const heroSrc = heroDataUrl ?? '/hero-running.jpg';
    const alreadyConnected = typeof window !== 'undefined' && !!loadGarminTokens();

    return (
      <div className="min-h-screen bg-[#0F0F10] relative overflow-hidden flex flex-col">
        <div className="absolute inset-0">
          {heroDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroSrc} alt="Running" className="w-full h-full object-cover" style={{ objectPosition: 'center 30%' }} />
          ) : (
            <Image src={heroSrc} alt="Running" fill style={{ objectFit: 'cover', objectPosition: 'center 30%' }} priority />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-[#0F0F10]" />
        </div>

        {welcomePhase === 'hero' ? (
          <div className="relative flex-1 flex flex-col justify-end px-6 pb-14 max-w-md mx-auto w-full">
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.2em] mb-3">Campus Coach</p>
            <h1 className="text-[38px] font-black text-white leading-[1.1] mb-3">
              Ton plan<br />running<br />sur mesure.
            </h1>
            <p className="text-[14px] text-white/60 mb-10 leading-relaxed">
              Génère un programme personnalisé selon ton objectif et synchronise-le avec ta montre Garmin.
            </p>
            {alreadyConnected ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-5 h-5 rounded-full bg-[#C8E635] flex items-center justify-center flex-shrink-0">
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l2.5 2.5L9 1" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <p className="text-[13px] font-semibold text-white/80">Garmin déjà connecté</p>
                </div>
                <button onClick={() => setShowWelcome(false)} className="w-full h-14 bg-white text-[#0F0F10] rounded-full text-[15px] font-bold tracking-tight transition-all active:scale-[0.97]">
                  Commencer
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setWelcomePhase('garmin')} className="w-full h-14 bg-white text-[#0F0F10] rounded-full text-[15px] font-bold tracking-tight transition-all active:scale-[0.97] mb-3">
                  Se connecter à Garmin
                </button>
                <button onClick={() => setShowWelcome(false)} className="w-full h-12 text-white/50 text-[13px] font-medium">
                  Commencer sans Garmin
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="relative flex-1 flex flex-col justify-end max-w-md mx-auto w-full">
            <div className="bg-[#0F0F10]/95 backdrop-blur-xl rounded-t-[32px] px-6 pt-8 pb-14">
              <div className="w-12 h-1.5 rounded-full bg-white/20 mx-auto mb-6" />
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-[14px] bg-[#C8E635]/20 flex items-center justify-center text-white font-black text-lg">G</div>
                <div>
                  <p className="text-[15px] font-black text-white">Connecte Garmin</p>
                  <p className="text-[12px] text-white/50">Tes séances seront dans ton calendrier</p>
                </div>
              </div>
              {garminError && <div className="rounded-[14px] bg-red-500/20 border border-red-500/30 p-3 mb-4"><p className="text-[12px] text-red-300">{garminError}</p></div>}
              {garminConnected ? (
                <div className="text-center py-4 mb-6">
                  <div className="w-14 h-14 rounded-full bg-[#C8E635]/20 flex items-center justify-center mx-auto mb-3">
                    <svg width="24" height="19" viewBox="0 0 24 19" fill="none"><path d="M1.5 9.5l6 6L22.5 1.5" stroke="#C8E635" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <p className="text-[15px] font-black text-white mb-1">Garmin connecté !</p>
                  <p className="text-[12px] text-white/50">Tes séances se synchroniseront automatiquement</p>
                </div>
              ) : (
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-[0.08em] mb-1.5">Email Garmin Connect</label>
                    <input type="email" value={garminEmail} onChange={(e) => setGarminEmail(e.target.value)} placeholder="ton@email.com" className="w-full px-4 py-3 bg-white/10 rounded-[14px] text-[13px] text-white placeholder:text-white/30 border-0 outline-none focus:ring-2 focus:ring-white/20" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-white/40 uppercase tracking-[0.08em] mb-1.5">Mot de passe</label>
                    <input type="password" value={garminPassword} onChange={(e) => setGarminPassword(e.target.value)} placeholder="••••••••" className="w-full px-4 py-3 bg-white/10 rounded-[14px] text-[13px] text-white placeholder:text-white/30 border-0 outline-none focus:ring-2 focus:ring-white/20" />
                  </div>
                  <p className="text-[11px] text-white/30">Ton mot de passe n&apos;est jamais stocké — seuls les tokens OAuth, valables 30 jours.</p>
                </div>
              )}
              <div className="flex gap-2">
                {!garminConnected && <button type="button" onClick={() => setShowWelcome(false)} className="flex-1 h-12 rounded-[14px] bg-white/10 text-white/60 text-[13px] font-semibold">Passer</button>}
                <button type="button" onClick={garminConnected ? () => setShowWelcome(false) : handleGarminConnect} disabled={garminLoading || (!garminConnected && (!garminEmail || !garminPassword))} className="flex-1 h-12 rounded-[14px] bg-white text-[#0F0F10] text-[13px] font-bold disabled:opacity-40 transition-all active:scale-[0.98]">
                  {garminConnected ? 'Commencer' : garminLoading ? 'Connexion...' : 'Se connecter'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Plan preview ──────────────────────────────────────────────────────────
  if (phase === 'preview' && pendingPlan && pendingProfile) {
    const totalWeeks = Math.max(...pendingPlan.sessions.map((s) => s.week));
    const sessionsPerWeek = pendingPlan.sessions.filter((s) => s.week === 1).length;
    const weeklyMins = pendingPlan.sessions.reduce<Record<number, number>>((acc, s) => {
      acc[s.week] = (acc[s.week] ?? 0) + s.totalMin;
      return acc;
    }, {});
    const peakWeekMin = Math.max(...Object.values(weeklyMins));

    return (
      <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
        <div className="max-w-md mx-auto w-full px-4 pt-14 pb-10 space-y-3 flex-1 overflow-y-auto">

          {/* Hero card */}
          <div className="rounded-[28px] bg-[#0F0F10] overflow-hidden p-6 relative">
            <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-[#C8E635]/15 blur-3xl pointer-events-none" />
            <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-2">Ton plan personnalisé</p>
            <h2 className="text-[26px] font-black text-white leading-tight mb-1">
              {RACE_LABELS[pendingProfile.goalRace]}
            </h2>
            <p className="text-[13px] text-white/50">
              {new Date(pendingProfile.goalDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>

            <div className="grid grid-cols-3 gap-3 mt-5">
              {[
                { label: 'Semaines', value: String(totalWeeks) },
                { label: 'Séances/sem.', value: String(sessionsPerWeek) },
                { label: 'Allure seuil', value: formatPace(pendingProfile.thresholdPaceSec) + '/km' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/8 rounded-[14px] p-3">
                  <p className="text-[18px] font-black text-white tabular-nums leading-none mb-1">{value}</p>
                  <p className="text-[10px] text-white/40 font-medium">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Coach explanation */}
          {planExplanation && (
            <div className="rounded-[24px] bg-white border border-black/5 p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-[9px] bg-[#0F0F10] flex items-center justify-center flex-shrink-0">
                  <span className="text-[#C8E635] font-black text-[10px]">CC</span>
                </div>
                <p className="text-[12px] font-semibold text-[#8E8E93]">Analyse de ton coach</p>
              </div>
              <p className="text-[14px] text-[#0F0F10] leading-relaxed">{planExplanation}</p>
            </div>
          )}

          {/* Session structure */}
          <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F2F2F7]">
              <p className="text-[13px] font-semibold text-[#0F0F10]">Structure hebdomadaire</p>
            </div>
            {[
              { icon: '⚡', label: 'Intervalles qualité', sub: 'Mardi — développement seuil et VO2max' },
              { icon: '🎯', label: 'Tempo / Qualité 2', sub: 'Jeudi — progression du seuil' },
              { icon: '🏃', label: 'Sortie longue', sub: 'Samedi — endurance fondamentale progressive' },
              { icon: '🔄', label: 'Récupération active', sub: 'Dimanche — régénération' },
            ].map(({ icon, label, sub }) => (
              <div key={label} className="flex items-center gap-4 px-5 py-3.5 border-b border-[#F2F2F7]/80 last:border-0">
                <span className="text-xl flex-shrink-0">{icon}</span>
                <div>
                  <p className="text-[13px] font-semibold text-[#0F0F10]">{label}</p>
                  <p className="text-[11px] text-[#8E8E93]">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Peak volume */}
          <div className="rounded-[20px] bg-[#C8E635]/12 border border-[#C8E635]/25 px-5 py-4 flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F0F10" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
            </svg>
            <p className="text-[13px] text-[#0F0F10]">
              <span className="font-bold">Volume de pointe :</span>{' '}
              ~{Math.round(peakWeekMin / 60)}h de course en phase intensive
            </p>
          </div>

          {/* CTA */}
          <div className="flex gap-2 pt-1 pb-4">
            <button
              onClick={restartChat}
              className="flex-none px-5 h-14 rounded-[16px] bg-white border border-black/8 text-[13px] font-semibold text-[#8E8E93] transition-all active:scale-[0.97]"
            >
              Modifier
            </button>
            <button
              onClick={confirmPlan}
              className="flex-1 h-14 rounded-[16px] bg-[#0F0F10] text-white text-[15px] font-bold transition-all active:scale-[0.97]"
            >
              Valider ce plan
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Garmin step ───────────────────────────────────────────────────────────
  if (phase === 'garmin') {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
        <div className="flex-1 max-w-md mx-auto w-full px-4 pt-20 pb-10 space-y-3">
          <div className="rounded-[20px] bg-[#C8E635]/15 border border-[#C8E635]/30 p-5 text-center mb-2">
            <div className="w-12 h-12 rounded-full bg-[#C8E635]/20 flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="17" viewBox="0 0 22 17" fill="none">
                <path d="M1.5 8.5l5.5 5.5L20.5 1.5" stroke="#0F0F10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-[16px] font-black text-[#0F0F10]">Ton plan est activé !</p>
            <p className="text-[12px] text-[#8E8E93] mt-1">Programme sauvegardé et prêt à l&apos;utilisation.</p>
          </div>

          <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
            {garminConnected ? (
              <div className="p-6 text-center">
                <div className="w-16 h-16 rounded-full bg-[#C8E635]/20 flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="22" viewBox="0 0 28 22" fill="none"><path d="M2 11l7 7L26 2" stroke="#0F0F10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <h2 className="text-[18px] font-black text-[#0F0F10] mb-1">Garmin connecté !</h2>
                <p className="text-[13px] text-[#8E8E93]">Tes séances seront synchronisées avec Garmin Connect.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[#F2F2F7]">
                  <div className="w-10 h-10 rounded-[14px] bg-[#C8E635]/20 flex items-center justify-center text-[#0F0F10] font-black text-lg">G</div>
                  <div>
                    <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-0.5">Optionnel</p>
                    <h2 className="text-[16px] font-black text-[#0F0F10]">Connecte Garmin</h2>
                  </div>
                </div>
                <div className="px-5 py-4 space-y-3">
                  {garminError && <div className="rounded-[14px] bg-red-50 border border-red-100 p-3"><p className="text-[12px] text-red-600">{garminError}</p></div>}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Email Garmin Connect</label>
                    <input type="email" value={garminEmail} onChange={(e) => setGarminEmail(e.target.value)} placeholder="ton@email.com" className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Mot de passe</label>
                    <input type="password" value={garminPassword} onChange={(e) => setGarminPassword(e.target.value)} placeholder="••••••••" className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10" />
                  </div>
                  <p className="text-[11px] text-[#8E8E93]">Ton mot de passe n&apos;est jamais stocké — seuls les tokens OAuth.</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {!garminConnected && (
              <button onClick={() => router.push('/')} className="flex-1 h-12 rounded-[14px] bg-white border border-black/8 text-[13px] font-semibold text-[#8E8E93]">
                Passer
              </button>
            )}
            <button
              onClick={garminConnected ? () => router.push('/') : handleGarminConnect}
              disabled={garminLoading || (!garminConnected && (!garminEmail || !garminPassword))}
              className="flex-1 h-12 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:opacity-40 transition-all active:scale-[0.98]"
            >
              {garminConnected ? 'C\'est parti !' : garminLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat phase ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
      <div className="max-w-md mx-auto w-full px-4 pt-14 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[12px] bg-[#0F0F10] flex items-center justify-center flex-shrink-0">
            <span className="text-[#C8E635] font-black text-[14px]">CC</span>
          </div>
          <div>
            <p className="text-[15px] font-black text-[#0F0F10]">Campus Coach</p>
            <p className="text-[11px] text-[#8E8E93]">Création de ton plan</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-w-md mx-auto w-full px-4 py-2 space-y-3">
        {messages.filter((m) => !m.hidden).map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[82%] px-4 py-3 rounded-[18px] text-[14px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#0F0F10] text-white rounded-br-[6px]'
                  : 'bg-white border border-black/5 text-[#0F0F10] rounded-bl-[6px]'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex justify-start">
            <div className="bg-white border border-black/5 rounded-[18px] rounded-bl-[6px]">
              <TypingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="max-w-md mx-auto w-full px-4 pb-8 pt-2 flex-shrink-0">
        <button
          onClick={() => { getOrCreateUserId(); router.push('/garmin'); }}
          className="w-full text-center text-[12px] text-[#8E8E93] pb-3"
        >
          Reprendre plus tard →
        </button>
        <div className="flex gap-2 bg-white border border-black/8 rounded-[20px] px-4 py-2 items-end">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder={thinking ? 'Coach en train de répondre…' : 'Réponds ici…'}
            disabled={thinking}
            className="flex-1 text-[14px] text-[#0F0F10] placeholder:text-[#8E8E93] bg-transparent outline-none py-1 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || thinking}
            className="w-8 h-8 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-all active:scale-[0.9] mb-0.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupPageContent />
    </Suspense>
  );
}
