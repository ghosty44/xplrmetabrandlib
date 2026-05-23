'use client';

import { useEffect, useRef, useState } from 'react';
import { loadPlan, savePlan, loadGarminTokens } from '@/lib/store';
import type { TrainingPlan } from '@/lib/types';
import type { GeminiSession } from '@/app/api/generate-plan/route';
import type { Session } from '@/lib/types';

type Message = { role: 'user' | 'model'; content: string; planUpdated?: boolean };

const STORAGE_KEY = 'runai_assistant_messages';
const WELCOME: Message = {
  role: 'model',
  content: 'Bonjour ! Je suis Coach RunAI. J\'ai accès à ton plan complet. Pose-moi une question ou demande-moi de modifier ton plan : volume, intensité, jours d\'entraînement, séances …',
};

const KM_PER_MIN: Record<string, number> = {
  easy: 0.165, moderate: 0.2, hard: 0.185, long: 0.165,
  recovery: 0.13, strength: 0, hill: 0.13,
};

const QUICK_QUESTIONS = [
  'Quelle séance faire demain ?',
  'Réduis le volume sem. 1',
  'Décale les séances au week-end',
  'Explique ma prochaine séance clé',
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [planUpdatedCount, setPlanUpdatedCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPlan(loadPlan());
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) setMessages(JSON.parse(cached) as Message[]);
    } catch { /* use default */ }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (messages.length > 1) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages, loading]);

  // Fetch Garmin summary for context (non-blocking)
  const [garminCtx, setGarminCtx] = useState<string | null>(null);
  useEffect(() => {
    const tokens = loadGarminTokens();
    if (!tokens) return;
    fetch('/api/garmin/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ garminTokens: tokens }),
    })
      .then(r => r.json())
      .then((d: { activities?: Array<{ activityName: string; startTimeLocal: string; distance: number; duration: number; averageHR?: number; activityType?: { typeKey: string } }> }) => {
        if (d.activities) {
          const lines = d.activities.slice(0, 8).map(a =>
            `- ${a.startTimeLocal?.slice(0, 10)}: ${a.activityType?.typeKey ?? ''} ${(a.distance / 1000).toFixed(1)}km ${Math.round(a.duration / 60)}min${a.averageHR ? ` ${a.averageHR}bpm` : ''}`
          );
          setGarminCtx(lines.join('\n'));
        }
      })
      .catch(() => {});
  }, []);

  const sendMessage = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading || !plan) return;
    setInput('');
    const next: Message[] = [...messages, { role: 'user', content: msg }];
    setMessages(next);
    setLoading(true);

    try {
      // Build plan with optional garmin context appended
      const planWithContext = garminCtx
        ? { ...plan, _garminContext: garminCtx }
        : plan;

      const res = await fetch('/api/plan-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
          plan: planWithContext,
        }),
      });

      const data = await res.json() as {
        type: 'answer' | 'modification';
        message: string;
        updatedSessions?: GeminiSession[];
        updatedProfile?: import('@/lib/types').UserProfile;
      };

      if (data.type === 'modification' && data.updatedSessions?.length) {
        const newProfile = data.updatedProfile ?? plan.profile;
        const newSessions: Session[] = data.updatedSessions.map((gs, i) => ({
          id: `coach_${gs.week}_${gs.day}_${i}`,
          name: gs.name,
          week: gs.week,
          day: gs.day,
          type: gs.intensity === 'strength' ? 'strength' : 'running',
          description: gs.description,
          totalMin: gs.totalMin,
          totalKm: gs.km ?? Math.round((KM_PER_MIN[gs.intensity] ?? 0.165) * gs.totalMin * 10) / 10,
          completed: false,
          garminSynced: false,
          steps: [],
        }));
        const updated: TrainingPlan = { ...plan, profile: newProfile, sessions: newSessions };
        savePlan(updated);
        setPlan(updated);
        setPlanUpdatedCount(n => n + 1);
        setMessages([...next, { role: 'model', content: data.message, planUpdated: true }]);
      } else {
        setMessages([...next, { role: 'model', content: data.message }]);
      }
    } catch {
      setMessages([...next, { role: 'model', content: 'Erreur de connexion. Réessaie.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([WELCOME]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const totalWeeks = plan ? Math.max(0, ...plan.sessions.map(s => s.week)) : 0;

  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
      <header className="sticky top-0 z-10 bg-[#F2F2F7]/80 backdrop-blur-xl">
        <div className="max-w-md mx-auto px-4 pt-12 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-black text-[#0F0F10] tracking-tight">Coach</h1>
            {plan ? (
              <p className="text-[11px] text-[#8E8E93]">
                {plan.profile.goalRace} · {totalWeeks} sem. · {plan.sessions.length} séances
                {garminCtx ? ' · Garmin ✓' : ''}
                {planUpdatedCount > 0 && (
                  <span className="ml-1.5 text-[#5A6A00] font-semibold">· {planUpdatedCount} modif.</span>
                )}
              </p>
            ) : (
              <p className="text-[11px] text-[#FF3B30]">Aucun plan — génère-en un d&apos;abord</p>
            )}
          </div>
          <button onClick={handleClear} className="text-[12px] text-[#8E8E93] font-semibold">Effacer</button>
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 pb-4 space-y-3 overflow-y-auto">
        {!plan && (
          <div className="rounded-[20px] bg-[#FF3B30]/10 border border-[#FF3B30]/20 px-4 py-3 mt-2">
            <p className="text-[12px] text-[#FF3B30] font-semibold">Aucun plan chargé. Génère ton plan depuis l&apos;onglet + pour activer le coach.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.planUpdated && (
              <div className="flex items-center gap-2 my-2">
                <div className="h-px flex-1 bg-[#C8E635]/50" />
                <span className="text-[10px] font-bold text-[#5A6A00] uppercase tracking-wide px-2 py-1 bg-[#C8E635]/15 rounded-full">
                  Plan mis à jour ✓
                </span>
                <div className="h-px flex-1 bg-[#C8E635]/50" />
              </div>
            )}
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'model' && (
                <div className="w-6 h-6 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 mr-2 mt-1">
                  <span className="text-[9px] font-black text-white">AI</span>
                </div>
              )}
              <div className={`max-w-[82%] px-4 py-3 rounded-[20px] text-[13px] leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#0F0F10] text-white rounded-br-[6px]'
                  : 'bg-white border border-black/5 text-[#0F0F10] rounded-bl-[6px]'
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 mr-2 mt-1">
              <span className="text-[9px] font-black text-white">AI</span>
            </div>
            <div className="bg-white border border-black/5 rounded-[20px] rounded-bl-[6px] px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }} />
              ))}
            </div>
          </div>
        )}

        {messages.length === 1 && !loading && (
          <div className="space-y-2 pt-2">
            <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.1em] px-1">Suggestions</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map(q => (
                <button key={q} onClick={() => sendMessage(q)}
                  className="px-3.5 py-2 rounded-[14px] bg-white border border-black/5 text-[12px] font-medium text-[#0F0F10] transition-all active:scale-[0.97]">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-1" />
      </main>

      <div className="sticky bottom-0 bg-[#F2F2F7]/90 backdrop-blur-xl border-t border-black/5 pb-24">
        <div className="max-w-md mx-auto px-4 py-3 flex items-end gap-2">
          <textarea
            ref={inputRef} value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={plan ? 'Pose une question ou demande une modification…' : 'Génère un plan d\'abord…'}
            disabled={!plan}
            rows={1}
            className="flex-1 resize-none px-4 py-3 bg-white border border-black/8 rounded-[18px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#0F0F10]/10 max-h-32 disabled:opacity-40"
            style={{ scrollbarWidth: 'none' }}
          />
          <button onClick={() => sendMessage(input)} disabled={loading || !input.trim() || !plan}
            className="w-10 h-10 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-all active:scale-[0.93]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5m-7 7 7-7 7 7"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
