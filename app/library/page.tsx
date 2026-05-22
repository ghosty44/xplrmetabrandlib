'use client';

import { useEffect, useRef, useState } from 'react';
import { EXERCISES, ALL_MUSCLE_GROUPS, type Exercise, type MuscleGroup } from '@/lib/exercises';

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'exercises' | 'kine';
type Message = { role: 'user' | 'model'; content: string; suggestedIds?: string[] };

// ── Constants ─────────────────────────────────────────────────────────────────

const KINE_STORAGE_KEY = 'runai_kine_messages';
const WELCOME: Message = {
  role: 'model',
  content: 'Bonjour ! Je suis votre assistant kinésithérapeute. Décrivez-moi votre douleur ou la zone que vous souhaitez renforcer — je vous proposerai des exercices adaptés.',
};

const QUICK_PROMPTS = [
  'J\'ai mal au genou après mes runs',
  'Renforcer mes chevilles',
  'Douleur lombaire chronique',
  'Prévenir les blessures aux ischio-jambiers',
];

const DIFFICULTY_COLORS: Record<string, string> = {
  'Débutant':       '#C8E635',
  'Intermédiaire':  '#F59E0B',
  'Avancé':         '#EF4444',
};

const DIFFICULTY_TEXT: Record<string, string> = {
  'Débutant':       '#4a6300',
  'Intermédiaire':  '#7c4a00',
  'Avancé':         '#7c0000',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold"
      style={{
        backgroundColor: `${DIFFICULTY_COLORS[difficulty]}22`,
        color: DIFFICULTY_TEXT[difficulty],
      }}
    >
      {difficulty}
    </span>
  );
}

function MuscleTag({ muscle }: { muscle: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-black/5 text-[9px] font-semibold text-[#8E8E93]">
      {muscle}
    </span>
  );
}

function ExerciseCard({
  exercise,
  highlighted,
  onTap,
}: {
  exercise: Exercise;
  highlighted: boolean;
  onTap: () => void;
}) {
  return (
    <button
      onClick={onTap}
      className="w-full text-left rounded-[20px] p-4 border transition-all active:scale-[0.97]"
      style={{
        backgroundColor: highlighted ? '#C8E635' : 'white',
        borderColor: highlighted ? '#b5cf2a' : 'rgba(0,0,0,0.05)',
        boxShadow: highlighted
          ? '0 2px 12px rgba(200,230,53,0.3)'
          : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <DifficultyBadge difficulty={exercise.difficulty} />
        {/* chevron */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
      <p className="text-[13px] font-bold text-[#0F0F10] leading-tight mb-1.5">{exercise.name}</p>
      <p className="text-[11px] text-[#8E8E93] leading-snug mb-2 line-clamp-2">{exercise.description}</p>
      <div className="flex flex-wrap gap-1">
        {exercise.muscles.slice(0, 3).map(m => <MuscleTag key={m} muscle={m} />)}
      </div>
    </button>
  );
}

function ExerciseSheet({
  exercise,
  onClose,
}: {
  exercise: Exercise;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-auto rounded-t-[32px] overflow-y-auto"
        style={{ background: '#F2F2F7', maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* drag indicator */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-8 h-1 rounded-full bg-black/15" />
        </div>

        <div className="px-5 pb-12 space-y-5">
          {/* header */}
          <div className="flex items-start justify-between gap-3 pt-2">
            <div className="flex-1">
              <h2 className="text-[20px] font-black text-[#0F0F10] leading-tight">{exercise.name}</h2>
              <p className="text-[12px] text-[#8E8E93] mt-1">{exercise.description}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-black/8 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* badges row */}
          <div className="flex flex-wrap gap-2 items-center">
            <DifficultyBadge difficulty={exercise.difficulty} />
            {exercise.muscles.map(m => <MuscleTag key={m} muscle={m} />)}
          </div>

          {/* volume card */}
          <div className="rounded-[20px] bg-[#0F0F10] p-4 grid grid-cols-3 gap-2">
            {[
              { label: 'Séries', value: exercise.sets },
              { label: 'Reps', value: exercise.reps },
              { label: 'Repos', value: exercise.rest },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-[10px] font-semibold text-white/50 uppercase tracking-[0.08em] mb-0.5">{label}</p>
                <p className="text-[16px] font-black text-white tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* instructions */}
          <div>
            <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.1em] mb-3">Instructions</p>
            <ol className="space-y-3">
              {exercise.instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                    style={{ backgroundColor: '#C8E635', color: '#4a6300' }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-[13px] text-[#0F0F10] leading-snug pt-0.5">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Exercises tab ─────────────────────────────────────────────────────────────

function ExercisesTab({
  highlightedIds,
  onExerciseTap,
}: {
  highlightedIds: string[];
  onExerciseTap: (e: Exercise) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<MuscleGroup | null>(null);

  const filtered = activeFilter
    ? EXERCISES.filter(e => e.muscles.includes(activeFilter))
    : EXERCISES;

  return (
    <div>
      {/* filter chips */}
      <div className="sticky top-[108px] z-10 bg-[#F2F2F7]/95 backdrop-blur-sm py-2">
        <div className="flex gap-2 overflow-x-auto px-4 no-scrollbar">
          <button
            onClick={() => setActiveFilter(null)}
            className="flex-shrink-0 px-4 py-2 rounded-full text-[12px] font-semibold transition-all active:scale-[0.96] whitespace-nowrap"
            style={{
              background: activeFilter === null ? '#0F0F10' : 'white',
              color: activeFilter === null ? 'white' : '#0F0F10',
              border: activeFilter === null ? 'none' : '1px solid rgba(0,0,0,0.08)',
            }}
          >
            Tous ({EXERCISES.length})
          </button>
          {ALL_MUSCLE_GROUPS.map(group => {
            const count = EXERCISES.filter(e => e.muscles.includes(group)).length;
            const active = activeFilter === group;
            return (
              <button
                key={group}
                onClick={() => setActiveFilter(active ? null : group)}
                className="flex-shrink-0 px-4 py-2 rounded-full text-[12px] font-semibold transition-all active:scale-[0.96] whitespace-nowrap"
                style={{
                  background: active ? '#0F0F10' : 'white',
                  color: active ? 'white' : '#0F0F10',
                  border: active ? 'none' : '1px solid rgba(0,0,0,0.08)',
                }}
              >
                {group} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* exercise grid */}
      <div className="px-4 pt-3 pb-4">
        {/* highlighted suggestion banner */}
        {highlightedIds.length > 0 && (
          <div className="rounded-[16px] bg-[#C8E635]/20 border border-[#C8E635]/40 px-4 py-3 mb-3 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a6300" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M12 8v4m0 4h.01" />
            </svg>
            <p className="text-[12px] font-semibold text-[#4a6300]">
              Le kiné a suggéré {highlightedIds.length} exercice{highlightedIds.length > 1 ? 's' : ''} — mis en évidence ci-dessous
            </p>
          </div>
        )}

        <p className="text-[11px] text-[#8E8E93] mb-3">
          {filtered.length} exercice{filtered.length > 1 ? 's' : ''}
          {activeFilter ? ` · ${activeFilter}` : ''}
        </p>

        <div className="grid grid-cols-2 gap-3">
          {filtered.map(exercise => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              highlighted={highlightedIds.includes(exercise.id)}
              onTap={() => onExerciseTap(exercise)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Kine chatbot tab ──────────────────────────────────────────────────────────

function KineTab({
  onSuggestedIds,
}: {
  onSuggestedIds: (ids: string[]) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(KINE_STORAGE_KEY);
      setMessages(cached ? JSON.parse(cached) as Message[] : [WELCOME]);
    } catch {
      setMessages([WELCOME]);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (messages.length > 1) {
      localStorage.setItem(KINE_STORAGE_KEY, JSON.stringify(messages));
    }
    // Propagate the latest batch of suggested exercise ids upward
    const lastWithSuggestions = [...messages].reverse().find(m => m.suggestedIds?.length);
    onSuggestedIds(lastWithSuggestions?.suggestedIds ?? []);
  }, [messages, onSuggestedIds]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch('/api/kine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json() as { message: string; suggestedExerciseIds?: string[] };
      setMessages(prev => [...prev, {
        role: 'model',
        content: data.message,
        suggestedIds: data.suggestedExerciseIds,
      }]);
    } catch {
      setMessages(prev => [...prev, { role: 'model', content: 'Erreur réseau. Réessaie dans un instant.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleClear() {
    setMessages([WELCOME]);
    localStorage.removeItem(KINE_STORAGE_KEY);
    onSuggestedIds([]);
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 108px)' }}>
      {/* clear button */}
      <div className="flex justify-end px-4 py-1">
        <button onClick={handleClear} className="text-[12px] text-[#8E8E93] font-semibold">Effacer</button>
      </div>

      {/* messages */}
      <div className="flex-1 px-4 pb-4 space-y-3 overflow-y-auto">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'model' && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-1"
                style={{ background: '#C8E635' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4a6300" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                  <path d="M12 8v4m0 4h.01" />
                </svg>
              </div>
            )}
            <div className="space-y-1 max-w-[82%]">
              <div className={`px-4 py-3 rounded-[20px] text-[13px] leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#0F0F10] text-white rounded-br-[6px]'
                  : 'bg-white border border-black/5 text-[#0F0F10] rounded-bl-[6px]'
              }`}>
                {msg.content}
              </div>
              {/* suggested exercises badge */}
              {msg.suggestedIds && msg.suggestedIds.length > 0 && (
                <p className="text-[10px] text-[#8E8E93] pl-1 font-medium">
                  💚 {msg.suggestedIds.length} exercice{msg.suggestedIds.length > 1 ? 's' : ''} suggéré{msg.suggestedIds.length > 1 ? 's' : ''} dans la bibliothèque
                </p>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-1"
              style={{ background: '#C8E635' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4a6300" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
            </div>
            <div className="bg-white border border-black/5 rounded-[20px] rounded-bl-[6px] px-4 py-3 flex items-center gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#8E8E93] animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* quick prompts */}
        {messages.length === 1 && !loading && (
          <div className="space-y-2 pt-2">
            <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.1em] px-1">Sujets courants</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map(q => (
                <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="px-3.5 py-2 rounded-[14px] bg-white border border-black/5 text-[12px] font-medium text-[#0F0F10] transition-all active:scale-[0.97]">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-1" />
      </div>

      {/* input bar */}
      <div className="sticky bottom-0 bg-[#F2F2F7]/90 backdrop-blur-xl border-t border-black/5 pb-24">
        <div className="max-w-md mx-auto px-4 py-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Décrivez votre douleur ou zone à renforcer…"
            rows={1}
            className="flex-1 resize-none px-4 py-3 bg-white border border-black/8 rounded-[18px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] outline-none focus:ring-2 focus:ring-[#0F0F10]/10 max-h-32"
            style={{ scrollbarWidth: 'none' }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-all active:scale-[0.93]"
            style={{ background: '#C8E635' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a6300" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5m-7 7 7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('exercises');
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      {/* sticky header with tabs */}
      <header className="sticky top-0 z-20 bg-[#F2F2F7]/90 backdrop-blur-xl">
        <div className="max-w-md mx-auto px-4 pt-12 pb-2">
          <div className="flex items-end justify-between mb-3">
            <div>
              <h1 className="text-[28px] font-black text-[#0F0F10] tracking-tight">Bibliothèque</h1>
              <p className="text-[11px] text-[#8E8E93]">{EXERCISES.length} exercices · Kiné IA</p>
            </div>
          </div>

          {/* tab switcher */}
          <div className="flex gap-1 p-1 rounded-[18px] bg-black/5">
            {([
              { key: 'exercises', label: 'Exercices' },
              { key: 'kine',      label: 'Kiné IA'   },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className="flex-1 py-2 rounded-[14px] text-[13px] font-semibold transition-all active:scale-[0.97]"
                style={{
                  background: activeTab === key ? 'white' : 'transparent',
                  color: activeTab === key ? '#0F0F10' : '#8E8E93',
                  boxShadow: activeTab === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {label}
                {key === 'kine' && suggestedIds.length > 0 && (
                  <span
                    className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-black"
                    style={{ background: '#C8E635', color: '#4a6300' }}
                  >
                    {suggestedIds.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* tab content */}
      <main className="max-w-md mx-auto w-full">
        {activeTab === 'exercises' ? (
          <ExercisesTab
            highlightedIds={suggestedIds}
            onExerciseTap={setSelectedExercise}
          />
        ) : (
          <KineTab onSuggestedIds={setSuggestedIds} />
        )}
      </main>

      {/* exercise detail bottom sheet */}
      {selectedExercise && (
        <ExerciseSheet
          exercise={selectedExercise}
          onClose={() => setSelectedExercise(null)}
        />
      )}
    </div>
  );
}
