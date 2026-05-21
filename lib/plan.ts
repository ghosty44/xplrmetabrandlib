import { Session, Step, TrainingPlan, UserProfile, Zone } from './types';
import { getZonePaceRange } from './zones';

// ── Running helpers ────────────────────────────────────────────────────────

function makeStep(zone: Zone, durationMin: number, thresholdSec: number, isRecovery = false, reps?: number): Step {
  return {
    zone,
    durationMin,
    targetPace: getZonePaceRange(zone, thresholdSec),
    isRecovery,
    ...(reps !== undefined ? { reps } : {}),
  };
}

function makeIntervalSession(
  id: string, name: string, week: number, day: number,
  warmupMin: number, cooldownMin: number,
  intervalZone: Zone, intervalMin: number, recoveryMin: number, sets: number,
  thresholdSec: number
): Session {
  const steps: Step[] = [
    makeStep('EF', warmupMin, thresholdSec),
    { zone: intervalZone, durationMin: intervalMin, targetPace: getZonePaceRange(intervalZone, thresholdSec), reps: sets },
    makeStep('Recup', recoveryMin, thresholdSec, true, sets > 1 ? sets - 1 : undefined),
    makeStep('EF', cooldownMin, thresholdSec),
  ];
  const total = warmupMin + (intervalMin + recoveryMin) * sets - recoveryMin + cooldownMin;
  return {
    id, name, week, day, completed: false, garminSynced: false, type: 'running',
    description: `${sets}×${intervalMin}min ${intervalZone} · ${recoveryMin}min récup`,
    steps,
    totalMin: Math.max(total, warmupMin + cooldownMin),
  };
}

function makeTempo(
  id: string, week: number, day: number,
  warmupMin: number, tempoMin: number, cooldownMin: number,
  thresholdSec: number
): Session {
  return {
    id, name: 'Tempo', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${tempoMin}min en allure seuil (zone 3)`,
    steps: [
      makeStep('EF', warmupMin, thresholdSec),
      makeStep('Seuil', tempoMin, thresholdSec),
      makeStep('EF', cooldownMin, thresholdSec),
    ],
    totalMin: warmupMin + tempoMin + cooldownMin,
  };
}

function makeLongRun(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  return {
    id, name: 'Sortie Longue', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${durationMin}min en endurance fondamentale (zone 2)`,
    steps: [makeStep('EF', durationMin, thresholdSec)],
    totalMin: durationMin,
  };
}

function makeEFRun(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  return {
    id, name: 'Endurance Fondamentale', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${durationMin}min en zone 2 — aisance respiratoire totale`,
    steps: [makeStep('EF', durationMin, thresholdSec)],
    totalMin: durationMin,
  };
}

function makeRecovery(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  const core = Math.max(durationMin - 10, 10);
  return {
    id, name: 'Récupération Active', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${durationMin}min très facile — régénération`,
    steps: [
      makeStep('Recup', 5, thresholdSec, true),
      makeStep('EF', core, thresholdSec),
      makeStep('Recup', 5, thresholdSec, true),
    ],
    totalMin: durationMin,
  };
}

// ── Strength training library ──────────────────────────────────────────────

type Exercise = { name: string; sets: number; repCount: string; durationMin: number };

const STRENGTH_EARLY: Exercise[] = [
  { name: 'Planche',              sets: 3, repCount: '30s',      durationMin: 3 },
  { name: 'Pont fessier',         sets: 3, repCount: '15 reps',  durationMin: 3 },
  { name: 'Squat',                sets: 3, repCount: '15 reps',  durationMin: 4 },
  { name: 'Gainage latéral',      sets: 3, repCount: '20s/côté', durationMin: 3 },
  { name: 'Fentes statiques',     sets: 3, repCount: '12/jambe', durationMin: 4 },
  { name: 'Chaise au mur',        sets: 3, repCount: '30s',      durationMin: 3 },
];

const STRENGTH_MID: Exercise[] = [
  { name: 'Fentes marchées',           sets: 3, repCount: '10/jambe', durationMin: 4 },
  { name: 'Pont fessier unilatéral',   sets: 3, repCount: '12/jambe', durationMin: 4 },
  { name: 'Squat unilatéral',          sets: 3, repCount: '8/jambe',  durationMin: 4 },
  { name: 'Gainage dynamique',         sets: 3, repCount: '12 reps',  durationMin: 3 },
  { name: 'Mollets debout',            sets: 3, repCount: '20 reps',  durationMin: 3 },
  { name: 'Superman',                  sets: 3, repCount: '15 reps',  durationMin: 3 },
];

const STRENGTH_LATE: Exercise[] = [
  { name: 'Squat sauté',          sets: 3, repCount: '8 reps',   durationMin: 3 },
  { name: 'Fentes sautées',       sets: 3, repCount: '6/jambe',  durationMin: 4 },
  { name: 'Step-ups rapides',     sets: 3, repCount: '10/jambe', durationMin: 4 },
  { name: 'Burpees',              sets: 3, repCount: '8 reps',   durationMin: 4 },
  { name: 'Mollets en saut',      sets: 3, repCount: '15 reps',  durationMin: 3 },
];

const STRENGTH_TAPER: Exercise[] = [
  { name: 'Planche',          sets: 2, repCount: '30s',      durationMin: 2 },
  { name: 'Pont fessier',     sets: 2, repCount: '12 reps',  durationMin: 2 },
  { name: 'Squat',            sets: 2, repCount: '10 reps',  durationMin: 2 },
  { name: 'Fentes statiques', sets: 2, repCount: '8/jambe',  durationMin: 2 },
];

function makeStrengthSession(
  id: string, week: number, day: number,
  phase: 'early' | 'mid' | 'late' | 'taper'
): Session {
  const library = phase === 'taper' ? STRENGTH_TAPER
    : phase === 'late' ? STRENGTH_LATE
    : phase === 'mid' ? STRENGTH_MID
    : STRENGTH_EARLY;

  const warmup = 5;
  const cooldown = 5;
  const exerciseMin = library.reduce((sum, e) => sum + e.durationMin, 0);
  const totalMin = warmup + exerciseMin + cooldown;

  const steps: Step[] = [
    // Warmup
    { durationMin: warmup, exercise: 'Échauffement (marche + mobilité)', sets: 1, repCount: `${warmup}min` },
    // Exercises
    ...library.map((ex): Step => ({
      durationMin: ex.durationMin,
      exercise: ex.name,
      sets: ex.sets,
      repCount: ex.repCount,
    })),
    // Cooldown
    { durationMin: cooldown, exercise: 'Retour au calme (étirements)', sets: 1, repCount: `${cooldown}min` },
  ];

  const phaseLabels = { early: 'Fondations', mid: 'Force', late: 'Puissance', taper: 'Maintien' };

  return {
    id, name: `Renforcement — ${phaseLabels[phase]}`, week, day,
    completed: false, garminSynced: false, type: 'strength',
    description: `${library.length} exercices · axe ${phaseLabels[phase].toLowerCase()} pour coureurs`,
    steps,
    totalMin,
  };
}

// ── Plan generator ─────────────────────────────────────────────────────────

export function generatePlan(profile: UserProfile): TrainingPlan {
  const { thresholdPaceSec, goalRace } = profile;
  const sessions: Session[] = [];

  const days = profile.availableDays?.length === 4 ? profile.availableDays : [2, 4, 6, 7];
  const [qualityDay, efDay, longDay, recovDay] = days;
  const strengthPerWeek = profile.strengthPerWeek ?? 0;

  // Strength days = first non-running days
  const allDays = [1, 2, 3, 4, 5, 6, 7];
  const strengthDays = allDays.filter(d => !days.includes(d)).slice(0, strengthPerWeek);

  const totalWeeks = goalRace === 'marathon' ? 16
    : goalRace === 'halfMarathon' ? 12
    : goalRace === '10k' ? 10
    : 8;

  const taperWeeks = goalRace === 'marathon' ? 3
    : goalRace === 'halfMarathon' ? 2
    : 1;
  const buildWeeks = totalWeeks - taperWeeks;

  const longBase = goalRace === 'marathon' ? 90
    : goalRace === 'halfMarathon' ? 65
    : goalRace === '10k' ? 50
    : 40;
  const longPeak = goalRace === 'marathon' ? 150
    : goalRace === 'halfMarathon' ? 105
    : goalRace === '10k' ? 75
    : 60;

  const taperFactors = goalRace === 'marathon' ? [0.80, 0.65, 0.50]
    : goalRace === 'halfMarathon' ? [0.70, 0.55]
    : [0.60];

  const isShort = goalRace === '5k' || goalRace === '10k';

  for (let w = 1; w <= totalWeeks; w++) {
    const taperIdx = w > buildWeeks ? w - buildWeeks - 1 : -1;
    const isTaper = taperIdx >= 0;
    const cyclePos = ((w - 1) % 4) + 1;
    const isAssimilation = !isTaper && cyclePos === 4;

    let volFactor: number;
    if (isTaper) {
      volFactor = taperFactors[taperIdx] ?? 0.55;
    } else if (isAssimilation) {
      volFactor = 0.80;
    } else {
      const cycle = Math.floor((w - 1) / 4);
      const posInCycle = cyclePos - 1;
      volFactor = Math.min(1.0 + cycle * 0.24 + posInCycle * 0.08, 1.6);
    }

    const buildPct = buildWeeks > 1 ? (w - 1) / (buildWeeks - 1) : 1;
    const phase: 'early' | 'mid' | 'late' | 'taper' = isTaper ? 'taper'
      : buildPct <= 0.4 ? 'early'
      : buildPct <= 0.75 ? 'mid'
      : 'late';

    // ── Quality session ────────────────────────────────────────────────────
    let quality: Session;
    if (phase === 'taper') {
      quality = makeIntervalSession(`w${w}-q`, 'Rappel Allure Cible', w, qualityDay, 15, 10, 'Seuil', 2, 1, 3, thresholdPaceSec);
    } else if (isShort) {
      const cfg = phase === 'early' ? { name: 'VO2max Courts',        dur: 1,   rec: 1,   sets: 6 }
                : phase === 'mid'   ? { name: 'VO2max Développement', dur: 2,   rec: 1.5, sets: 5 }
                :                    { name: 'VO2max Spécifique',     dur: 3,   rec: 2,   sets: 4 };
      quality = makeIntervalSession(`w${w}-q`, cfg.name, w, qualityDay, 15, 10, 'VO2max', cfg.dur, cfg.rec, cfg.sets, thresholdPaceSec);
    } else {
      if (phase === 'early') {
        quality = makeIntervalSession(`w${w}-q`, 'Intervalles Seuil',  w, qualityDay, 20, 10, 'Seuil', 2, 1, 5, thresholdPaceSec);
      } else if (phase === 'mid') {
        quality = makeIntervalSession(`w${w}-q`, 'Seuil Longs',        w, qualityDay, 20, 10, 'Seuil', 4, 2, 3, thresholdPaceSec);
      } else {
        quality = makeTempo(`w${w}-q`, w, qualityDay, 20, 25, 10, thresholdPaceSec);
      }
    }
    sessions.push(quality);

    // ── EF run (80/20) ────────────────────────────────────────────────────
    const efMin = Math.max(25, Math.round((28 + w * 2) * volFactor));
    sessions.push(makeEFRun(`w${w}-ef`, w, efDay, efMin, thresholdPaceSec));

    // ── Long run ──────────────────────────────────────────────────────────
    let longMin: number;
    if (isTaper) {
      longMin = Math.round(longPeak * (taperFactors[taperIdx] ?? 0.55));
    } else {
      const raw = longBase + buildPct * (longPeak - longBase);
      longMin = Math.round(raw * (isAssimilation ? 0.80 : 1.0));
    }
    sessions.push(makeLongRun(`w${w}-lr`, w, longDay, Math.max(longMin, 25), thresholdPaceSec));

    // ── Recovery ──────────────────────────────────────────────────────────
    const recovMin = Math.max(15, Math.round((isTaper ? 20 : isAssimilation ? 25 : 30) * volFactor));
    sessions.push(makeRecovery(`w${w}-rec`, w, recovDay, recovMin, thresholdPaceSec));

    // ── Strength sessions ─────────────────────────────────────────────────
    strengthDays.forEach((sDay, idx) => {
      sessions.push(makeStrengthSession(`w${w}-str${idx + 1}`, w, sDay, phase));
    });
  }

  // Sort sessions by week then day
  sessions.sort((a, b) => a.week !== b.week ? a.week - b.week : a.day - b.day);

  return {
    id: `plan-${Date.now()}`,
    profile,
    sessions,
    createdAt: new Date().toISOString(),
  };
}
