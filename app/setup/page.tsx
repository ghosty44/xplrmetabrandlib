'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generatePlan } from '@/lib/plan';
import { savePlan, saveProfile, saveGarminTokens, loadGarminTokens, getOrCreateUserId, loadUserId, loadPlan, loadGarminUserId, saveGarminUserId, saveShoes, GarminTokens } from '@/lib/store';
import { UserProfile, TrainingPlan, Shoe } from '@/lib/types';
import { formatPace } from '@/lib/zones';

type Phase = 'garmin' | 'loading' | 'goalType' | 'trailPriority' | 'trailDetails' | 'chat' | 'preview';
type GoalType = 'road' | 'trail' | 'beginner' | 'injury' | 'test';
type ChatMessage = { role: 'user' | 'model'; content: string; hidden?: boolean };

const CHAT_KEY = 'runai_chat_messages';

function saveChatMessages(msgs: ChatMessage[]) {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(msgs)); } catch {}
}
function loadChatMessages(): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]') as ChatMessage[]; } catch { return []; }
}
function clearChatMessages() {
  try { localStorage.removeItem(CHAT_KEY); } catch {}
}

function getQuickReplies(lastBotMsg: string, allMessages: ChatMessage[]): string[] {
  const m = lastBotMsg.toLowerCase();
  const userMsgs = allMessages
    .filter(msg => msg.role === 'user' && !msg.hidden)
    .map(msg => msg.content.toLowerCase());

  const hasDistance = userMsgs.some(u =>
    u.includes('marathon') || u.includes('semi') || u.includes('10 km') || u.includes('5 km') || u.includes('10k') || u.includes('5k'));
  const chosenRace = userMsgs.find(u =>
    u.includes('marathon') || u.includes('semi') || u.includes('10 km') || u.includes('5 km') || u.includes('10k') || u.includes('5k'));
  const isMarathon = !!chosenRace && chosenRace.includes('marathon') && !chosenRace.includes('semi');
  const isSemi = !!chosenRace && (chosenRace.includes('semi') || chosenRace.includes('semi-marathon'));
  const is10k = !!chosenRace && (chosenRace.includes('10 km') || chosenRace.includes('10k'));
  const is5k = !!chosenRace && (chosenRace.includes('5 km') || chosenRace.includes('5k'));

  if (m.includes('terrain') || m.includes('trail') || m.includes('route plate') || m.includes('vallonné') || m.includes('montagne') || m.includes('sentier')) {
    return ['Route (plat)', 'Route (vallonné)', 'Trail / Montagne'];
  }
  if (m.includes('fc max') || m.includes('fréquence cardiaque maximale') || m.includes('fréquence max') || m.includes('fcmax')) {
    return ['Je ne sais pas', '170 bpm', '180 bpm', '190 bpm'];
  }
  if (m.includes('blessure') || m.includes('douleur') || m.includes('problème physique')) {
    return ['Aucune blessure', 'Genou', "Tendon d'Achille", 'Dos / hanche'];
  }
  if (m.includes('renforcement') || m.includes('musculaire') || m.includes('gainage') || m.includes('séances de renforcement')) {
    return ['0 séance', '1 séance/semaine', '2 séances/semaine'];
  }
  if (m.includes('jours') || m.includes('disponible') || (m.includes('semaine') && m.includes('courir'))) {
    const sessionMatch = userMsgs.join(' ').match(/(\d+)\s*séance/);
    const n = sessionMatch ? parseInt(sessionMatch[1]) : 4;
    if (n <= 3) return ['Mar · Jeu · Sam', 'Lun · Mer · Sam', 'Mer · Ven · Dim', 'Lun · Jeu · Sam'];
    if (n === 5) return ['Lun · Mar · Jeu · Sam · Dim', 'Lun · Mer · Jeu · Ven · Sam', 'Mar · Mer · Jeu · Sam · Dim'];
    if (n >= 6) return ['Lun · Mar · Mer · Jeu · Ven · Sam', 'Lun · Mar · Jeu · Ven · Sam · Dim'];
    return ['Mar · Jeu · Sam · Dim', 'Lun · Mer · Ven · Sam', 'Mar · Jeu · Ven · Dim', 'Lun · Mer · Sam · Dim'];
  }
  if (m.includes('km/semaine') || m.includes('kilomètres par semaine') || m.includes('volume') || m.includes('actuellement')) {
    return ['20 km/sem · 3 séances', '35 km/sem · 4 séances', '50 km/sem · 5 séances', '65 km/sem · 6 séances'];
  }
  if (hasDistance && (m.includes('date') || m.includes('chrono') || m.includes('objectif de temps') || m.includes('temps cible') || m.includes('en combien') || m.includes('performance'))) {
    if (isMarathon) return ['3h00', '3h30', '4h00', '4h30'];
    if (isSemi) return ['1h30', '1h45', '2h00', '2h15'];
    if (is10k) return ['40 min', '45 min', '50 min', '55 min'];
    if (is5k) return ['20 min', '22 min', '25 min', '28 min'];
  }
  if (!hasDistance && (m.includes('distance') || m.includes('objectif précis') || m.includes('marathon') || m.includes('semi') || m.includes('10') || m.includes('5 km') || m.includes('course'))) {
    return ['Marathon', 'Semi-marathon', '10 km', '5 km'];
  }
  return [];
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }} />
      ))}
    </div>
  );
}

function PlanPreview({ plan, onConfirm, onBack }: { plan: TrainingPlan; onConfirm: () => void; onBack: () => void }) {
  const p = plan.profile;
  const RACE_LABELS: Record<string, string> = { marathon: 'Marathon', halfMarathon: 'Semi-Marathon', '10k': '10 km', '5k': '5 km' };
  const totalWeeks = Math.max(...plan.sessions.map(s => s.week));
  const totalSessions = plan.sessions.length;
  const thresholdMin = Math.floor(p.thresholdPaceSec / 60);
  const thresholdSec = p.thresholdPaceSec % 60;
  const thresholdPace = `${thresholdMin}'${thresholdSec.toString().padStart(2, '0')}''`;

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <div className="max-w-md mx-auto px-4 pt-14 pb-32 space-y-3">
        <button onClick={onBack} className="flex items-center gap-2 text-[13px] font-semibold text-[#8E8E93] mb-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Modifier
        </button>
        <div className="rounded-[28px] bg-[#0F0F10] p-6">
          <p className="text-[10px] font-semibold text-white/50 uppercase tracking-[0.15em] mb-1">Ton plan RunAI</p>
          <p className="text-[28px] font-black text-white leading-tight mb-1">
            {p.terrain === 'trail' ? 'Trail' : RACE_LABELS[p.goalRace]}
          </p>
          <p className="text-[13px] text-white/50 mb-5">
            {new Date(p.goalDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            {p.goalTimeMin ? ` · ${Math.floor(p.goalTimeMin / 60)}h${p.goalTimeMin % 60 > 0 ? p.goalTimeMin % 60 + 'min' : ''}` : ''}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Semaines', value: totalWeeks },
              { label: 'Séances', value: totalSessions },
              { label: 'Allure seuil', value: thresholdPace },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-[16px] bg-white/10 p-3 text-center">
                <p className="text-[18px] font-black text-white tabular-nums">{value}</p>
                <p className="text-[9px] font-semibold text-white/40 uppercase tracking-[0.08em] mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F2F2F7]">
            <p className="text-[13px] font-semibold text-[#0F0F10]">Aperçu du plan</p>
          </div>
          {Array.from({ length: Math.min(totalWeeks, 4) }, (_, i) => i + 1).map((week) => {
            const wSessions = plan.sessions.filter(s => s.week === week);
            return (
              <div key={week} className="px-5 py-3.5 border-b border-[#F2F2F7]/80 last:border-0">
                <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-2">Semaine {week}</p>
                <div className="space-y-1">
                  {wSessions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <p className="text-[12px] font-medium text-[#0F0F10]">{s.name}</p>
                      <p className="text-[11px] text-[#8E8E93]">{s.totalMin} min</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {totalWeeks > 4 && (
            <div className="px-5 py-3 text-center">
              <p className="text-[11px] text-[#8E8E93]">+ {totalWeeks - 4} semaines supplémentaires</p>
            </div>
          )}
        </div>
        <button onClick={onConfirm} className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black transition-all active:scale-[0.98]">
          Commencer l&apos;entraînement →
        </button>
      </div>
    </div>
  );
}

function GarminConnectStep({ onConnected, onSkip }: {
  onConnected: (garminUserId: string, tokens: GarminTokens) => void;
  onSkip: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/garmin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { success: boolean; tokens?: GarminTokens; garminUserId?: string; error?: string };
      if (data.success && data.tokens) {
        onConnected(data.garminUserId ?? '', data.tokens);
      } else {
        setError(data.error ?? 'Erreur de connexion');
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
      <div className="max-w-md mx-auto w-full px-4 pt-14 pb-32 space-y-3">
        <div className="rounded-[28px] bg-[#0F0F10] p-6 text-center">
          <div className="w-16 h-16 rounded-[20px] bg-[#C8E635]/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-[#C8E635] font-black text-2xl">G</span>
          </div>
          <p className="text-[20px] font-black text-white mb-2">Connecte ton compte Garmin</p>
          <p className="text-[13px] text-white/50 leading-relaxed">
            Tes données et ton plan sont sauvegardés sur ton compte. Reconnecte-toi depuis n&apos;importe quel appareil.
          </p>
        </div>
        <div className="rounded-[24px] bg-white border border-black/5 p-5">
          <form onSubmit={handleConnect} className="space-y-3">
            {error && (
              <div className="rounded-[14px] bg-red-50 border border-red-100 p-3">
                <p className="text-[12px] text-red-600">{error}</p>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Email Garmin Connect</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="ton@email.com"
                className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••"
                className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10" />
            </div>
            <p className="text-[11px] text-[#8E8E93]">Tes identifiants ne sont jamais stockés — seuls les tokens OAuth sont conservés localement.</p>
            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:opacity-50 transition-all active:scale-[0.98]">
              {loading ? 'Connexion en cours...' : 'Se connecter à Garmin'}
            </button>
          </form>
        </div>
        <button onClick={onSkip} className="w-full py-3 text-[12px] font-medium text-[#8E8E93] transition-all active:scale-[0.98]">
          Continuer sans Garmin
        </button>
      </div>
    </div>
  );
}

// ── Goal type constants ───────────────────────────────────────────────────────

const GOAL_CARDS: { id: GoalType; title: string; subtitle: string; color: string }[] = [
  { id: 'road',     title: 'Préparer une course route',    subtitle: 'Un plan construit pour ton prochain dossard',                  color: '#1C3A5E' },
  { id: 'trail',    title: 'Préparer une course trail',    subtitle: "On t'accompagne sur tous les terrains, du 5km à l'ultra",       color: '#1A3A2A' },
  { id: 'beginner', title: 'Commencer à courir',           subtitle: 'Un programme pour apprendre les bases de la course à pied',     color: '#3A2A1A' },
  { id: 'injury',   title: 'Reprendre après une blessure', subtitle: 'On sécurise ta reprise pour retrouver tes sensations',          color: '#3A1A1A' },
  { id: 'test',     title: 'Tester mon niveau',            subtitle: 'On définit ton profil avec un test de niveau sur 1500m',        color: '#2A1A3A' },
];

// ── GoalTypeStep ──────────────────────────────────────────────────────────────

function GoalTypeStep({ onSelect, images }: { onSelect: (t: GoalType) => void; images: string[] }) {
  const [selected, setSelected] = useState<GoalType | null>(null);

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <div className="max-w-md mx-auto w-full px-5 pt-14 pb-36 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-[20px] font-black text-[#0F0F10] tracking-tight">Ajouter un objectif</h1>
        </div>

        {GOAL_CARDS.map((card, i) => {
          const img = images.length > 0 ? images[i % images.length] : null;
          const active = selected === card.id;
          return (
            <button key={card.id} onClick={() => setSelected(card.id)}
              className={`w-full flex items-center gap-4 p-4 rounded-[20px] bg-white border-2 text-left transition-all ${active ? 'border-[#0F0F10]' : 'border-transparent'}`}
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <div className="w-[72px] h-[72px] rounded-[14px] overflow-hidden flex-shrink-0" style={{ backgroundColor: card.color }}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-[#0F0F10] leading-snug">{card.title}</p>
                <p className="text-[12px] text-[#8E8E93] mt-0.5 leading-snug">{card.subtitle}</p>
              </div>
              <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${active ? 'border-[#0F0F10] bg-[#0F0F10]' : 'border-[#D1D1D6]'}`}>
                {active && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="fixed bottom-8 inset-x-0 px-5 max-w-md mx-auto">
        <button disabled={!selected} onClick={() => selected && onSelect(selected)}
          className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black disabled:opacity-30 transition-all active:scale-[0.98]">
          Continuer
        </button>
      </div>
    </div>
  );
}

// ── TrailHeader (shared) ──────────────────────────────────────────────────────

function TrailHeader({ name, distanceKm, elevationGain, image }: { name: string; distanceKm: string; elevationGain: string; image?: string }) {
  const title = name || 'Course trail';
  const sub = [distanceKm ? `${distanceKm} km` : 'Distance', elevationGain ? `${elevationGain} m` : 'Dénivelé', 'Durée du plan'].join(' | ');
  return (
    <div className="relative rounded-[20px] overflow-hidden h-[88px] mb-6 bg-[#0F0F10]">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />
      <div className="relative flex items-center gap-3 h-full px-4">
        <div className="w-12 h-12 rounded-[12px] bg-white flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F0F10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
        </div>
        <div>
          <p className="text-[15px] font-bold text-white leading-tight">{title}</p>
          <p className="text-[11px] text-white/60">{sub}</p>
        </div>
      </div>
    </div>
  );
}

// ── TrailPriorityStep ─────────────────────────────────────────────────────────

function TrailPriorityStep({ image, onSelect, onBack }: {
  image?: string;
  onSelect: (p: 'main' | 'secondary') => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<'main' | 'secondary' | null>(null);
  const opts = [
    { id: 'main' as const, title: "C'est un objectif principal", sub: "Tout mon plan sera construit pour m'amener au pic de forme ce jour-là" },
    { id: 'secondary' as const, title: "C'est un objectif secondaire", sub: "Cette course s'intègre à ma routine pour me tester ou pour le plaisir" },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <div className="max-w-md mx-auto w-full px-5 pt-14 pb-36">
        <div className="flex items-center justify-between mb-5">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white border border-black/8 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
          <p className="text-[15px] font-semibold text-[#0F0F10]">Ajouter un objectif</p>
          <div className="w-9" />
        </div>

        <TrailHeader name="" distanceKm="" elevationGain="" image={image} />

        <h2 className="text-[22px] font-black text-[#0F0F10] mb-5">Comment envisages-tu cette course&nbsp;?</h2>

        <div className="space-y-3">
          {opts.map((opt) => (
            <button key={opt.id} onClick={() => setSelected(opt.id)}
              className={`w-full text-left p-4 rounded-[20px] bg-white border-2 transition-all ${selected === opt.id ? 'border-[#0F0F10]' : 'border-transparent'}`}
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-[15px] font-bold text-[#0F0F10] leading-snug">{opt.title}</p>
                  <p className="text-[12px] text-[#8E8E93] mt-1 leading-snug">{opt.sub}</p>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${selected === opt.id ? 'border-[#0F0F10] bg-[#0F0F10]' : 'border-[#D1D1D6]'}`}>
                  {selected === opt.id && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="fixed bottom-8 inset-x-0 px-5 max-w-md mx-auto">
        <button disabled={!selected} onClick={() => selected && onSelect(selected)}
          className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black disabled:opacity-30 transition-all active:scale-[0.98]">
          Continuer
        </button>
      </div>
    </div>
  );
}

// ── TrailDetailsStep ──────────────────────────────────────────────────────────

function TrailDetailsStep({ image, onConfirm, onBack }: {
  image?: string;
  onConfirm: (name: string, distanceKm: string, elevationGain: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [elevationGain, setElevationGain] = useState('');
  const [showModal, setShowModal] = useState(false);

  const canContinue = !!distanceKm && Number(distanceKm) > 0;

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex flex-col">
      <div className="max-w-md mx-auto w-full px-5 pt-14 pb-36">
        <div className="flex items-center justify-between mb-5">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white border border-black/8 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
          <p className="text-[15px] font-semibold text-[#0F0F10]">Ajouter un objectif</p>
          <div className="w-9" />
        </div>

        <TrailHeader name={name} distanceKm={distanceKm} elevationGain={elevationGain} image={image} />

        <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Dis-nous en plus sur ta course&nbsp;!</h2>
        <p className="text-[13px] text-[#8E8E93] mb-5">pour personnaliser au mieux ton entraînement</p>

        <div className="space-y-3">
          {[
            { label: 'NOM DE LA COURSE (OPTIONNEL)', placeholder: 'UTMB', value: name, onChange: setName, type: 'text' },
            { label: 'DISTANCE (KM)', placeholder: '0', value: distanceKm, onChange: setDistanceKm, type: 'number' },
            { label: 'DÉNIVELÉ POSITIF (M)', placeholder: '0', value: elevationGain, onChange: setElevationGain, type: 'number' },
          ].map((field) => (
            <div key={field.label} className="bg-white rounded-[20px] p-4" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
              <p className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-[0.12em] mb-2">{field.label}</p>
              <input type={field.type} value={field.value} onChange={(e) => field.onChange(e.target.value)}
                placeholder={field.placeholder} min={field.type === 'number' ? '0' : undefined}
                className="w-full text-[17px] font-semibold text-[#0F0F10] bg-transparent outline-none placeholder:text-[#D1D1D6]" />
            </div>
          ))}
        </div>
      </div>

      {/* Duration explanation modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm px-5 pb-8">
          <div className="w-full max-w-md bg-white rounded-[28px] p-6 space-y-4">
            <h3 className="text-[20px] font-black text-[#0F0F10]">Pourquoi imposer une durée minimum&nbsp;?</h3>
            <p className="text-[14px] text-[#8E8E93] leading-relaxed">
              On calcule ce délai en fonction de ta course objectif, son dénivelé, et de ton profil actuel. Ce délai est indispensable pour&nbsp;:
            </p>
            <div className="space-y-2">
              <p className="text-[14px] text-[#0F0F10]">✓ Progresser sans risque en respectant tes capacités actuelles</p>
              <p className="text-[14px] text-[#0F0F10]">✓ Garantir ta fraîcheur et ton succès le jour de la course</p>
            </div>
            <button onClick={() => { setShowModal(false); onConfirm(name, distanceKm, elevationGain); }}
              className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black transition-all active:scale-[0.98]">
              J&apos;ai compris
            </button>
          </div>
        </div>
      )}

      <div className="fixed bottom-8 inset-x-0 px-5 max-w-md mx-auto">
        <button disabled={!canContinue} onClick={() => setShowModal(true)}
          className="w-full py-4 rounded-[20px] bg-[#0F0F10] text-white text-[15px] font-black disabled:opacity-30 transition-all active:scale-[0.98]">
          Continuer
        </button>
      </div>
    </div>
  );
}

// ── ChatContent ───────────────────────────────────────────────────────────────

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>('garmin');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [generatedPlan, setGeneratedPlan] = useState<TrainingPlan | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Goal type flow state
  const [trailPriority, setTrailPriority] = useState<'main' | 'secondary' | null>(null);
  const [blobImages, setBlobImages] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/blob-images')
      .then(r => r.json())
      .then((d: { all?: string[] }) => setBlobImages(d.all ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const force = searchParams.get('force') === '1';
    const tokens = loadGarminTokens();
    const garminId = loadGarminUserId();
    const alreadyAuthed = !!tokens || !!garminId;

    // Resume in-progress chat session
    const saved = loadChatMessages();
    if (saved.length > 0 && !force) {
      setMessages(saved);
      setPhase('chat');
      setInitialized(true);
      return;
    }

    if (alreadyAuthed) {
      const localPlan = loadPlan();
      if (localPlan && !force) { router.replace('/'); return; }

      const userId = loadUserId();
      if (userId && !force) {
        setPhase('loading');
        fetch(`/api/profile?userId=${encodeURIComponent(userId)}`)
          .then(r => r.json())
          .then((d: { plan?: TrainingPlan | null; shoes?: Shoe[] }) => {
            if (d.plan) {
              savePlan(d.plan);
              if (d.shoes?.length) saveShoes(d.shoes);
              router.replace('/');
            } else {
              setPhase('goalType');
              setInitialized(true);
            }
          })
          .catch(() => { setPhase('goalType'); setInitialized(true); });
        return;
      }
      clearChatMessages();
      setPhase('goalType');
      setInitialized(true);
      return;
    }

    setPhase('garmin');
    setInitialized(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function beginChat(hiddenContext?: string) {
    clearChatMessages();

    if (hiddenContext) {
      const welcome: ChatMessage = {
        role: 'model',
        content: 'Bonjour ! Je suis ton coach RunAI. Pour créer ton plan personnalisé, j\'ai besoin de quelques informations.',
      };
      const hiddenMsg: ChatMessage = { role: 'user', content: hiddenContext, hidden: true };
      const initial: ChatMessage[] = [welcome, hiddenMsg];
      setMessages(initial);
      saveChatMessages(initial);
      setPhase('chat');
      setInitialized(true);

      setThinking(true);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: initial }),
        });
        const data = await res.json() as { message?: string; profile?: UserProfile };
        if (data.message) {
          const ai: ChatMessage = { role: 'model', content: data.message };
          const updated = [...initial, ai];
          setMessages(updated);
          saveChatMessages(updated);
        }
      } catch { /* chat still usable */ }
      finally { setThinking(false); }
    } else {
      const welcome: ChatMessage = {
        role: 'model',
        content: 'Bonjour ! Je suis ton coach RunAI. Pour créer ton plan d\'entraînement personnalisé, j\'ai besoin de quelques informations. Pour quel objectif de course souhaites-tu t\'entraîner ?',
      };
      setMessages([welcome]);
      saveChatMessages([welcome]);
      setPhase('chat');
      setInitialized(true);
    }
  }

  const handleGarminConnected = async (garminUserId: string, tokens: GarminTokens) => {
    saveGarminTokens(tokens);
    if (garminUserId) saveGarminUserId(garminUserId);
    const userId = garminUserId || loadUserId();
    if (userId) {
      setPhase('loading');
      try {
        const res = await fetch(`/api/profile?userId=${encodeURIComponent(userId)}`);
        const d = await res.json() as { plan?: TrainingPlan | null; shoes?: Shoe[] };
        if (d.plan) {
          savePlan(d.plan);
          if (d.shoes?.length) saveShoes(d.shoes);
          router.replace('/');
          return;
        }
      } catch { /* non-fatal */ }
    }
    setPhase('goalType');
    setInitialized(true);
  };

  const handleSkipGarmin = () => {
    setPhase('goalType');
    setInitialized(true);
  };

  const handleGoalSelected = (type: GoalType) => {
    if (type === 'trail') {
      setPhase('trailPriority');
      return;
    }
    const contexts: Record<GoalType, string> = {
      road: "Je veux préparer une course sur route. Commence directement par me demander la distance précise (5km, 10km, semi-marathon ou marathon), puis la date et le chrono visé.",
      trail: '',
      beginner: "Je suis débutant et je veux commencer à courir. Adapte le protocole pour un débutant complet qui veut progresser progressivement.",
      injury: "Je reprends la course après une blessure. J'ai besoin d'un programme de reprise progressif et sécurisé.",
      test: "Je veux tester mon niveau sur 1500m avant de créer mon plan d'entraînement.",
    };
    beginChat(contexts[type]);
  };

  const handleTrailPrioritySelected = (priority: 'main' | 'secondary') => {
    setTrailPriority(priority);
    setPhase('trailDetails');
  };

  const handleTrailDetailsConfirmed = (name: string, distanceKm: string, elevationGain: string) => {
    const priorityLabel = trailPriority === 'main' ? 'objectif principal' : 'objectif secondaire';
    const context = [
      `Je veux préparer un trail${name ? ` : "${name}"` : ''}.`,
      `Distance : ${distanceKm}km.`,
      elevationGain ? `Dénivelé positif : ${elevationGain}m.` : '',
      `C'est un ${priorityLabel}. Le terrain est trail.`,
      `Ne repose pas la question sur le terrain (déjà répondu : trail).`,
      `Commence par me demander la date exacte de la course et mon chrono cible.`,
    ].filter(Boolean).join(' ');
    beginChat(context);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || thinking) return;
    const userMsg: ChatMessage = { role: 'user', content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    saveChatMessages(newMessages);
    setInput('');
    setThinking(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      let data: { message?: string; profile?: UserProfile; error?: string };
      try {
        data = await res.json() as typeof data;
      } catch {
        throw new Error(`Erreur serveur (HTTP ${res.status}) — vérifie les variables d'environnement Vercel`);
      }
      if (data.error) throw new Error(data.error);
      if (data.profile) {
        const plan = generatePlan(data.profile);
        const botMsg: ChatMessage = { role: 'model', content: data.message ?? 'Voici ton plan !' };
        const final = [...newMessages, botMsg];
        setMessages(final);
        saveChatMessages(final);
        setGeneratedPlan(plan);
        setPhase('preview');
      } else if (data.message) {
        const botMsg: ChatMessage = { role: 'model', content: data.message };
        const final = [...newMessages, botMsg];
        setMessages(final);
        saveChatMessages(final);
      } else {
        throw new Error('Réponse vide du serveur');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      const errMsg: ChatMessage = { role: 'model', content: `⚠️ ${msg}` };
      setMessages([...newMessages, errMsg]);
      saveChatMessages([...newMessages, errMsg]);
    } finally {
      setThinking(false);
    }
  };

  const handleConfirmPlan = () => {
    if (!generatedPlan) return;
    saveProfile(generatedPlan.profile);
    savePlan(generatedPlan);
    const userId = loadUserId() ?? getOrCreateUserId();
    fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, plan: generatedPlan }),
    }).catch(() => {});
    clearChatMessages();
    router.push('/');
  };

  // ── Phase renders ─────────────────────────────────────────────────────────

  if (phase === 'garmin') return <GarminConnectStep onConnected={handleGarminConnected} onSkip={handleSkipGarmin} />;

  if (phase === 'loading' || !initialized) {
    return (
      <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
        <p className="text-[12px] text-[#8E8E93]">Chargement de ton profil…</p>
      </div>
    );
  }

  if (phase === 'goalType') return <GoalTypeStep onSelect={handleGoalSelected} images={blobImages} />;

  if (phase === 'trailPriority') return (
    <TrailPriorityStep
      image={blobImages[1] ?? blobImages[0]}
      onSelect={handleTrailPrioritySelected}
      onBack={() => setPhase('goalType')}
    />
  );

  if (phase === 'trailDetails') return (
    <TrailDetailsStep
      image={blobImages[1] ?? blobImages[0]}
      onConfirm={handleTrailDetailsConfirmed}
      onBack={() => setPhase('trailPriority')}
    />
  );

  if (phase === 'preview' && generatedPlan) {
    return <PlanPreview plan={generatedPlan} onConfirm={handleConfirmPlan} onBack={() => setPhase('chat')} />;
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
            <p className="text-[15px] font-black text-[#0F0F10]">RunAI</p>
            <p className="text-[11px] text-[#8E8E93]">Création de ton plan</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-w-md mx-auto w-full px-4 py-2 space-y-3">
        {messages.filter((m) => !m.hidden).map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] px-4 py-3 rounded-[18px] text-[14px] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-[#0F0F10] text-white rounded-br-[6px]'
                : 'bg-white border border-black/5 text-[#0F0F10] rounded-bl-[6px]'
            }`}>
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

      <div className="max-w-md mx-auto w-full pb-8 pt-1 flex-shrink-0">
        {!thinking && (() => {
          const lastBot = [...messages].reverse().find(m => m.role === 'model' && !m.hidden);
          const chips = lastBot ? getQuickReplies(lastBot.content, messages) : [];
          if (!chips.length) return null;
          return (
            <div className="flex gap-2 overflow-x-auto pb-2 px-4 scrollbar-none">
              {chips.map((chip) => (
                <button key={chip} onClick={() => sendMessage(chip)}
                  className="flex-shrink-0 px-4 py-2 rounded-full bg-white border border-black/8 text-[12px] font-semibold text-[#0F0F10] whitespace-nowrap transition-all active:scale-[0.96] active:bg-[#F2F2F7]">
                  {chip}
                </button>
              ))}
            </div>
          );
        })()}
        <div className="flex items-end gap-2 px-4">
          <div className="flex-1 flex items-center bg-white border border-black/8 rounded-[20px] px-4 py-3 gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              placeholder="Écris ta réponse..."
              className="flex-1 bg-transparent text-[14px] text-[#0F0F10] placeholder:text-[#8E8E93] outline-none" />
          </div>
          <button onClick={() => sendMessage(input)} disabled={!input.trim() || thinking}
            className="w-11 h-11 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-all active:scale-[0.93]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-[#8E8E93]/30 border-t-[#0F0F10] rounded-full animate-spin" />
      </div>
    }>
      <ChatContent />
    </Suspense>
  );
}
