import { Session, Step, TerrainType, TrainingPlan, UserProfile, Zone } from './types';
import { getZonePaceRange, sessionKm, sessionTotalMin } from './zones';
import { validatePaceCoherence } from './pacing';

// ── Running helpers ────────────────────────────────────────────────────────

function makeStep(
  zone: Zone,
  durationMin: number,
  thresholdSec: number,
  isRecovery = false,
  reps?: number,
): Step {
  return {
    zone,
    durationMin,
    targetPace: getZonePaceRange(zone, thresholdSec),
    isRecovery,
    ...(reps !== undefined ? { reps } : {}),
  };
}

/**
 * Build a session and derive totalMin + totalKm from the steps array.
 * Never pass a hand-rolled totalMin — all durations are authoritative from steps.
 */
function buildRunningSession(
  partial: Omit<Session, 'totalMin' | 'totalKm'> & { steps: Step[] },
  thresholdSec: number,
): Session {
  const totalMin = sessionTotalMin(partial.steps);
  const totalKm  = sessionKm(partial.steps, thresholdSec);
  return { ...partial, totalMin, totalKm };
}

function makeIntervalSession(
  id: string, name: string, week: number, day: number,
  warmupMin: number, cooldownMin: number,
  intervalZone: Zone, intervalMin: number, recoveryMin: number, sets: number,
  thresholdSec: number,
): Session {
  const steps: Step[] = [
    makeStep('EF', warmupMin, thresholdSec),
    { zone: intervalZone, durationMin: intervalMin, targetPace: getZonePaceRange(intervalZone, thresholdSec), reps: sets },
  ];
  // Only add recovery if there is more than one rep (last rep has no recovery)
  if (sets > 1) {
    steps.push(makeStep('Recup', recoveryMin, thresholdSec, true, sets - 1));
  }
  steps.push(makeStep('EF', cooldownMin, thresholdSec));

  return buildRunningSession({
    id, name, week, day, completed: false, garminSynced: false, type: 'running',
    description: `${sets}×${intervalMin}min ${intervalZone} · ${recoveryMin}min récup`,
    steps,
  }, thresholdSec);
}

function makeTempo(
  id: string, week: number, day: number,
  warmupMin: number, tempoMin: number, cooldownMin: number,
  thresholdSec: number,
): Session {
  const steps: Step[] = [
    makeStep('EF', warmupMin, thresholdSec),
    makeStep('Seuil', tempoMin, thresholdSec),
    makeStep('EF', cooldownMin, thresholdSec),
  ];
  return buildRunningSession({
    id, name: 'Tempo', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${tempoMin}min en allure seuil (zone 3)`,
    steps,
  }, thresholdSec);
}

function makeLongRun(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  const steps: Step[] = [makeStep('EF', durationMin, thresholdSec)];
  return buildRunningSession({
    id, name: 'Sortie Longue', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${durationMin}min en endurance fondamentale (zone 2)`,
    steps,
  }, thresholdSec);
}

function makeEFRun(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  const steps: Step[] = [makeStep('EF', durationMin, thresholdSec)];
  return buildRunningSession({
    id, name: 'Endurance Fondamentale', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${durationMin}min en zone 2 — aisance respiratoire totale`,
    steps,
  }, thresholdSec);
}

function makeRecovery(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  // Steps sum must equal durationMin: cap the core so total stays coherent
  const fringe = 10; // 5min Recup on each side
  const core = Math.max(durationMin - fringe, 5);
  const actualDuration = fringe + core; // may differ from durationMin when durationMin < 15
  const steps: Step[] = [
    makeStep('Recup', 5, thresholdSec, true),
    makeStep('EF', core, thresholdSec),
    makeStep('Recup', 5, thresholdSec, true),
  ];
  return buildRunningSession({
    id, name: 'Récupération Active', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${actualDuration}min très facile — régénération`,
    steps,
  }, thresholdSec);
}

/**
 * Hill repeats — replaces flat quality sessions when terrain is hilly/trail.
 * Pace targets are omitted for ascending reps (terrain makes speed irrelevant);
 * effort is expressed as HR zone instead.
 */
function makeHillRepeats(
  id: string, week: number, day: number,
  sets: number, repUpMin: number, repDownMin: number,
  thresholdSec: number,
): Session {
  const warmupMin  = 15;
  const cooldownMin = 10;
  const steps: Step[] = [
    makeStep('EF', warmupMin, thresholdSec),
    // Ascending: VO2max effort but express via HR not pace
    {
      zone: 'VO2max',
      durationMin: repUpMin,
      reps: sets,
      effortMode: 'hr',
      // No targetPace — speed on hills is meaningless
    },
    // Descending recovery (jog back down) — pace shown
    ...(sets > 1
      ? [makeStep('Recup', repDownMin, thresholdSec, true, sets - 1)]
      : []),
    makeStep('EF', cooldownMin, thresholdSec),
  ];
  return buildRunningSession({
    id, name: 'Répétitions en Côtes', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${sets}×${repUpMin}min montée (FCmax 92–100%) · descente récup`,
    steps,
  }, thresholdSec);
}

/**
 * Hilly EF run — shows HR target instead of pace because speed on hills is misleading.
 */
function makeHillyEFRun(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  const steps: Step[] = [{
    zone: 'EF',
    durationMin,
    effortMode: 'hr',
    // No targetPace — runner should target 70–80% FCmax regardless of slope
  }];
  return buildRunningSession({
    id, name: 'Endurance Fondamentale (terrain)', week, day, completed: false, garminSynced: false, type: 'running',
    description: `${durationMin}min zone 2 — cible 70–80% FCmax (ignorer l'allure en côte)`,
    steps,
  }, thresholdSec);
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
  phase: 'early' | 'mid' | 'late' | 'taper',
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
    { durationMin: warmup,    exercise: 'Échauffement (marche + mobilité)', sets: 1, repCount: `${warmup}min` },
    ...library.map((ex): Step => ({
      durationMin: ex.durationMin,
      exercise: ex.name,
      sets: ex.sets,
      repCount: ex.repCount,
    })),
    { durationMin: cooldown,  exercise: 'Retour au calme (étirements)',    sets: 1, repCount: `${cooldown}min` },
  ];

  const phaseLabels = { early: 'Fondations', mid: 'Force', late: 'Puissance', taper: 'Maintien' };

  return {
    id, name: `Renforcement — ${phaseLabels[phase]}`, week, day,
    completed: false, garminSynced: false, type: 'strength',
    description: `${library.length} exercices · axe ${phaseLabels[phase].toLowerCase()} pour coureurs`,
    steps,
    totalMin,
    // No totalKm for strength sessions
  };
}

// ── Peak volFactor pre-computation ─────────────────────────────────────────

/**
 * Compute the maximum volFactor that will be reached during the build phase.
 * Used to express taper factors as a fraction of peak load rather than
 * an absolute value, so the taper scales correctly for any plan length.
 */
function computePeakVolFactor(buildWeeks: number): number {
  let peak = 0;
  for (let w = 1; w <= buildWeeks; w++) {
    const cyclePos = ((w - 1) % 4) + 1;
    const isAssimilation = cyclePos === 4;
    if (isAssimilation) continue; // assimilation weeks never reach peak
    const cycle = Math.floor((w - 1) / 4);
    const posInCycle = cyclePos - 1;
    const vf = Math.min(1.0 + cycle * 0.24 + posInCycle * 0.08, 1.6);
    if (vf > peak) peak = vf;
  }
  return Math.max(peak, 1.0); // at minimum 1.0 for very short plans
}

// ── Plan generator ─────────────────────────────────────────────────────────

export function generatePlan(profile: UserProfile): TrainingPlan {
  const { thresholdPaceSec, goalRace, goalDate } = profile;
  const terrain: TerrainType = profile.terrain ?? 'flat';
  const isHilly = terrain !== 'flat';
  const sessions: Session[] = [];

  const days = profile.availableDays?.length === 4 ? profile.availableDays : [2, 4, 6, 7];
  const [qualityDay, efDay, longDay, recovDay] = days;
  const strengthPerWeek = profile.strengthPerWeek ?? 0;

  // Strength days = first non-running days in week order
  const allDays = [1, 2, 3, 4, 5, 6, 7];
  const strengthDays = allDays.filter(d => !days.includes(d)).slice(0, strengthPerWeek);

  // Weeks until race
  const idealWeeks = goalRace === 'marathon' ? 16
    : goalRace === 'halfMarathon' ? 12
    : goalRace === '10k' ? 10
    : 8;
  const msUntilRace = new Date(goalDate).getTime() - Date.now();
  const weeksUntilRace = Math.floor(msUntilRace / (7 * 24 * 3600 * 1000));
  const totalWeeks = Math.max(4, Math.min(idealWeeks, weeksUntilRace));

  // Taper
  const taperWeeks = totalWeeks <= 5 ? 1
    : goalRace === 'marathon' ? 3
    : goalRace === 'halfMarathon' ? 2
    : 1;
  const buildWeeks = totalWeeks - taperWeeks;

  // Taper factors expressed as fraction of peak — scalable to any plan length
  const taperRelativeFactors = goalRace === 'marathon' ? [0.80, 0.65, 0.50]
    : goalRace === 'halfMarathon' ? [0.70, 0.55]
    : [0.60];

  const peakVolFactor = computePeakVolFactor(buildWeeks);
  const taperFactors = taperRelativeFactors.map(f => f * peakVolFactor);

  const longBase = goalRace === 'marathon' ? 90
    : goalRace === 'halfMarathon' ? 65
    : goalRace === '10k' ? 50
    : 40;
  const longPeak = goalRace === 'marathon' ? 150
    : goalRace === 'halfMarathon' ? 105
    : goalRace === '10k' ? 75
    : 60;

  const isShort = goalRace === '5k' || goalRace === '10k';

  // Guard: validate pace coherence once before generating sessions
  const efPace  = getZonePaceRange('EF', thresholdPaceSec);
  const vo2Pace = getZonePaceRange('VO2max', thresholdPaceSec);
  const efMid   = (efPace.minSec  + efPace.maxSec)  / 2;
  const vo2Mid  = (vo2Pace.minSec + vo2Pace.maxSec) / 2;
  const coherence = validatePaceCoherence(thresholdPaceSec, efMid, vo2Mid);
  if (!coherence.ok) {
    coherence.warnings.forEach(w => console.warn('[generatePlan]', w));
  }

  for (let w = 1; w <= totalWeeks; w++) {
    const taperIdx = w > buildWeeks ? w - buildWeeks - 1 : -1;
    const isTaper = taperIdx >= 0;
    const cyclePos = ((w - 1) % 4) + 1;
    const isAssimilation = !isTaper && cyclePos === 4;

    let volFactor: number;
    if (isTaper) {
      volFactor = taperFactors[taperIdx] ?? taperFactors[taperFactors.length - 1];
    } else if (isAssimilation) {
      volFactor = peakVolFactor * 0.80;
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
    } else if (isHilly) {
      // Terrain: replace flat quality with hill repeats
      const hillSets = phase === 'early' ? 6 : phase === 'mid' ? 8 : 10;
      const repUp    = phase === 'early' ? 1 : phase === 'mid' ? 1.5 : 2;
      quality = makeHillRepeats(`w${w}-q`, w, qualityDay, hillSets, repUp, 2, thresholdPaceSec);
    } else if (isShort) {
      const cfg = phase === 'early' ? { name: 'VO2max Courts',        dur: 1,   rec: 1,   sets: 6 }
                : phase === 'mid'   ? { name: 'VO2max Développement', dur: 2,   rec: 1.5, sets: 5 }
                :                    { name: 'VO2max Spécifique',     dur: 3,   rec: 2,   sets: 4 };
      quality = makeIntervalSession(`w${w}-q`, cfg.name, w, qualityDay, 15, 10, 'VO2max', cfg.dur, cfg.rec, cfg.sets, thresholdPaceSec);
    } else {
      if (phase === 'early') {
        quality = makeIntervalSession(`w${w}-q`, 'Intervalles Seuil', w, qualityDay, 20, 10, 'Seuil', 2, 1, 5, thresholdPaceSec);
      } else if (phase === 'mid') {
        quality = makeIntervalSession(`w${w}-q`, 'Seuil Longs', w, qualityDay, 20, 10, 'Seuil', 4, 2, 3, thresholdPaceSec);
      } else {
        quality = makeTempo(`w${w}-q`, w, qualityDay, 20, 25, 10, thresholdPaceSec);
      }
    }
    sessions.push(quality);

    // ── EF run (80/20) ────────────────────────────────────────────────────
    const efMin = Math.max(25, Math.round((28 + w * 2) * volFactor));
    const efSession = isHilly
      ? makeHillyEFRun(`w${w}-ef`, w, efDay, efMin, thresholdPaceSec)
      : makeEFRun(`w${w}-ef`, w, efDay, efMin, thresholdPaceSec);
    sessions.push(efSession);

    // ── Long run ──────────────────────────────────────────────────────────
    let longMin: number;
    if (isTaper) {
      longMin = Math.round(longPeak * (taperRelativeFactors[taperIdx] ?? 0.55));
    } else {
      const raw = longBase + buildPct * (longPeak - longBase);
      longMin = Math.round(raw * (isAssimilation ? 0.80 : 1.0));
    }
    const longSession = isHilly
      ? makeHillyEFRun(`w${w}-lr`, w, longDay, Math.max(longMin, 25), thresholdPaceSec)
      : makeLongRun(`w${w}-lr`, w, longDay, Math.max(longMin, 25), thresholdPaceSec);
    if (isHilly) longSession.name = 'Sortie Longue (terrain)';
    sessions.push(longSession);

    // ── Recovery ──────────────────────────────────────────────────────────
    const recovMin = Math.max(20, Math.round((isTaper ? 20 : isAssimilation ? 25 : 30) * volFactor));
    sessions.push(makeRecovery(`w${w}-rec`, w, recovDay, recovMin, thresholdPaceSec));

    // ── Strength sessions ─────────────────────────────────────────────────
    strengthDays.forEach((sDay, idx) => {
      sessions.push(makeStrengthSession(`w${w}-str${idx + 1}`, w, sDay, phase));
    });
  }

  sessions.sort((a, b) => a.week !== b.week ? a.week - b.week : a.day - b.day);

  return {
    id: `plan-${Date.now()}`,
    profile,
    sessions,
    createdAt: new Date().toISOString(),
  };
}

// ── Weekly aggregate helpers (used by the UI) ──────────────────────────────

/** Sum of all session durations in a given week (minutes). */
export function weeklyTotalMin(sessions: Session[], week: number): number {
  return sessions
    .filter(s => s.week === week)
    .reduce((sum, s) => sum + s.totalMin, 0);
}

/** Sum of all running session km in a given week (km). */
export function weeklyTotalKm(sessions: Session[], week: number): number {
  const raw = sessions
    .filter(s => s.week === week && s.type === 'running')
    .reduce((sum, s) => sum + (s.totalKm ?? 0), 0);
  return Math.round(raw * 10) / 10;
}
