'use client';

import { useEffect, useRef, useState } from 'react';
import { loadPlan, loadGarminTokens } from '@/lib/store';
import { TrainingPlan } from '@/lib/types';

type Message = { role: 'user' | 'model'; content: string };

const ASSISTANT_KEY = 'runai_assistant_messages';
const WELCOME: Message = {
  role: 'model',
  content: 'Bonjour ! Je suis Coach RunAI. J\'ai accès à ton plan d\'entraînement et tes données Garmin. Pose-moi n\'importe quelle question : analyse de séance, récupération, nutrition, allures, blessures…',
};

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [garminSummary, setGarminSummary] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const p = loadPlan();
    setPlan(p);

    try {
      const cached = localStorage.getItem(ASSISTANT_KEY);
      if (cached) {
        setMessages(JSON.parse(cached) as Message[]);
      } else {
        setMessages([WELCOME]);
      }
    } catch {
      setMessages([WELCOME]);
    }

    const tokens = loadGarminTokens();
    if (tokens) {
      fetch('/api/garmin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garminTokens: tokens }),
      })
        .then(r => r.json())
        .then((d: { activities?: Array<{ activityName: string; startTimeLocal: string; distance: number; duration: number; averageHR?: number; maxHR?: number; activityType?: { typeKey: string } }>; weeklyStats?: { totalDistance: number; totalSessions: number } }) => {
          if (d.activities) {
            const lines = d.activities.slice(0, 10).map(a => {
              const km = (a.distance / 1000).toFixed(1);
              const min = Math.round(a.duration / 60);
              const hr = a.averageHR ? ` · ${a.averageHR} bpm` : '';
              return `- ${a.startTimeLocal?.slice(0, 10)} : ${a.activityType?.typeKey ?? 'activité'} ${km}km en ${min}min${hr}`;
            });
            setGarminSummary(lines.join('\n'));
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (messages.length > 1) {
      localStorage.setItem(ASSISTANT_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: Message = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, plan, garminSummary }),
      });
      const data = await res.json() as { message: string };
      setMessages(prev => [...prev, { role: 'model', content: data.message }]);
    } catch {
      setMessages(prev => [...prev, { role: 'model', content: 'Erreur réseau. Réessaie dans un instant.' }]);
    } finally {
      setLoading(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClear = () => {
    setMessages([WELCOME]);
    localStorage.removeItem(ASSISTANT_KEY);
  };

  const QUICK_QUESTIONS = [
    'Comment se passe ma progression ?',
    'Quelle séance faire demain ?',
    'Comment gérer la fatigue ?',
    'Explique ma prochaine séance clé',
  ];

  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
      <header className="sticky top-0 z-10 bg-[#F2F2F7]/80 backdrop-blur-xl">
        <div className="max-w-md mx-auto px-4 pt-12 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-black text-[#0F0F10] tracking-tight">Assistant</h1>
            <p className="text-[11px] text-[#8E8E93]">
              {plan ? `Plan ${plan.profile.goalRace} · ${plan.sessions.length} séances` : 'Aucun plan chargé'}
              {garminSummary ? ' · Garmin ✓' : ''}
            </p>
          </div>
          <button onClick={handleClear} className="text-[12px] text-[#8E8E93] font-semibold">Effacer</button>
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 pb-4 space-y-3 overflow-y-auto">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full bg-[#0F0F10] flex items-center justify-center flex-shrink-0 mr-2 mt-1">
              <span className="text-[9px] font-black text-white">AI</span>
            </div>
            <div className="bg-white border border-black/5 rounded-[20px] rounded-bl-[6px] px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {messages.length === 1 && !loading && (
          <div className="space-y-2 pt-2">
            <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.1em] px-1">Questions rapides</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
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
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Pose ta question…" rows={1}
            className="flex-1 resize-none px-4 py-3 bg-white border border-black/8 rounded-[18px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#0F0F10]/10 max-h-32"
            style={{ scrollbarWidth: 'none' }}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()}
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
