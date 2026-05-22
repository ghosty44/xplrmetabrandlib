'use client';

import { useEffect, useState } from 'react';
import { loadPlan } from '@/lib/store';
import { TrainingPlan, Session } from '@/lib/types';
import { getSessionDate, formatDateYYYYMMDD } from '@/lib/dates';

const DAY_LABELS = ['', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const RACE_LABELS: Record<string, string> = {
  marathon: 'Marathon', halfMarathon: 'Semi-Marathon', '10k': '10 km', '5k': '5 km',
};

function formatPaceSec(sec: number): string {
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}'${s.toString().padStart(2, '0')}''`;
}

function SessionRow({ session, createdAt }: { session: Session; createdAt: string }) {
  const date = getSessionDate(createdAt, session.week, session.day);
  const dateStr = formatDateYYYYMMDD(date);
  const isStrength = session.type === 'strength';

  return (
    <tr style={{ borderBottom: '1px solid #eee', pageBreakInside: 'avoid' }}>
      <td style={{ padding: '8px 10px', fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>
        {dateStr}<br /><span style={{ fontSize: 10, color: '#999' }}>{DAY_LABELS[session.day]}</span>
      </td>
      <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600 }}>{session.name}</td>
      <td style={{ padding: '8px 10px', fontSize: 11, color: '#444' }}>{session.totalMin} min</td>
      <td style={{ padding: '8px 10px', fontSize: 11, color: '#444' }}>
        {isStrength
          ? `💪 ${session.steps.filter(s => s.exercise && !s.exercise.startsWith('É') && !s.exercise.startsWith('R')).length} exercices`
          : session.steps.filter(s => s.zone && !s.isRecovery).map(s => {
              const zoneLabels: Record<string, string> = { EF: 'EF', Seuil: 'Seuil', VO2max: 'VO2max', Recup: 'Récup', Neutre: 'Neutre', SSeuilVO2: 'S-VO2' };
              const reps = s.reps ?? 1;
              const label = zoneLabels[s.zone!] ?? s.zone;
              const paceStr = s.targetPace ? ` @ ${formatPaceSec(s.targetPace.minSec)}–${formatPaceSec(s.targetPace.maxSec)}/km` : '';
              return reps > 1 ? `${reps}×${s.durationMin}min ${label}${paceStr}` : `${s.durationMin}min ${label}${paceStr}`;
            }).join(' + ')}
      </td>
      <td style={{ padding: '8px 10px', fontSize: 11, textAlign: 'center' }}>
        {session.completed ? '✓' : session.skipped ? '–' : ''}
      </td>
    </tr>
  );
}

export default function PlanPrintPage() {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);

  useEffect(() => {
    const p = loadPlan();
    setPlan(p);
  }, []);

  useEffect(() => {
    if (plan) {
      setTimeout(() => window.print(), 600);
    }
  }, [plan]);

  if (!plan) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
        <p>Aucun plan trouvé. <a href="/">Retour à l&apos;accueil</a></p>
      </div>
    );
  }

  const totalWeeks = Math.max(...plan.sessions.map(s => s.week));
  const p = plan.profile;
  const thresholdPace = formatPaceSec(p.thresholdPaceSec);
  const raceLabel = RACE_LABELS[p.goalRace] ?? p.goalRace;
  const goalTimeStr = p.goalTimeMin
    ? `${Math.floor(p.goalTimeMin / 60)}h${p.goalTimeMin % 60 > 0 ? (p.goalTimeMin % 60).toString().padStart(2, '0') : ''}  `
    : '';

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', maxWidth: 800, margin: '0 auto', padding: 32, color: '#0F0F10' }}>
      <style>{`
        @media print {
          body { margin: 0; }
          @page { size: A4; margin: 15mm; }
          .print-btn { display: none !important; }
        }
      `}</style>

      <div className="print-btn" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24, gap: 12 }}>
        <button onClick={() => window.print()}
          style={{ padding: '10px 20px', background: '#0F0F10', color: '#fff', border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Imprimer / Enregistrer PDF
        </button>
        <a href="/"
          style={{ padding: '10px 20px', background: '#F2F2F7', color: '#0F0F10', border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }}>
          ← Retour
        </a>
      </div>

      <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: '2px solid #0F0F10' }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: -0.5 }}>RunAI — Plan d&apos;entraînement</h1>
        <p style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px', color: '#444' }}>
          {raceLabel} · {p.goalDate} {goalTimeStr && `· Objectif : ${goalTimeStr}`}
        </p>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
          {[
            { label: 'Semaines', val: totalWeeks },
            { label: 'Séances', val: plan.sessions.length },
            { label: 'Allure seuil', val: `${thresholdPace}/km` },
            { label: 'Volume hebdo', val: `${p.weeklyKm} km/sem` },
            ...(p.maxHR ? [{ label: 'FC max', val: `${p.maxHR} bpm` }] : []),
          ].map(({ label, val }) => (
            <div key={label}>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</span>
              <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{val}</p>
            </div>
          ))}
        </div>
      </div>

      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
        const weekSessions = plan.sessions.filter(s => s.week === week);
        return (
          <div key={week} style={{ marginBottom: 24, pageBreakInside: 'avoid' }}>
            <div style={{ background: '#0F0F10', color: '#fff', padding: '8px 14px', borderRadius: '10px 10px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Semaine {week}</span>
              <span style={{ fontSize: 11, color: '#C8E635' }}>{weekSessions.reduce((sum, s) => sum + s.totalMin, 0)} min total</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '0 0 10px 10px', overflow: 'hidden', border: '1px solid #eee', borderTop: 'none' }}>
              <thead>
                <tr style={{ background: '#F2F2F7' }}>
                  {['Date', 'Séance', 'Durée', 'Contenu', '✓'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#888', textAlign: 'left', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekSessions.map(session => (
                  <SessionRow key={session.id} session={session} createdAt={plan.createdAt} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div style={{ marginTop: 32, padding: 20, background: '#F2F2F7', borderRadius: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#888', marginBottom: 12 }}>Légende des zones</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { zone: 'EF', color: '#5B9AF5', label: 'Endurance Fondamentale', pct: '60–75% FCmax' },
            { zone: 'Récup', color: '#A8D8A8', label: 'Récupération', pct: '50–60% FCmax' },
            { zone: 'Seuil', color: '#C8E635', label: 'Seuil Lactique', pct: '80–90% FCmax' },
            { zone: 'VO2max', color: '#FF6B6B', label: 'VO2max', pct: '90–100% FCmax' },
            { zone: 'Neutre', color: '#FFD166', label: 'Allure Neutre', pct: '75–85% FCmax' },
            { zone: '💪', color: '#6366f1', label: 'Renforcement', pct: 'Hors course' },
          ].map(({ zone, color, label, pct }) => (
            <div key={zone} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, margin: 0 }}>{label}</p>
                <p style={{ fontSize: 10, color: '#888', margin: 0 }}>{pct}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p style={{ marginTop: 20, fontSize: 10, color: '#ccc', textAlign: 'center' }}>
        Généré par RunAI · {new Date().toLocaleDateString('fr-FR')}
      </p>
    </div>
  );
}
