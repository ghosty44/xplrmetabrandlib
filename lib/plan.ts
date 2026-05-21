import { Session, Step, TrainingPlan, UserProfile, Zone } from './types';
import { getZonePaceRange } from './zones';

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
    id, name, week, day, completed: false, garminSynced: false,
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
    id, name: 'Tempo', week, day, completed: false, garminSynced: false,
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
    id, name: 'Sortie Longue', week, day, completed: false, garminSynced: false,
    description: `${durationMin}min en endurance fondamentale (zone 2)`,
    steps: [makeStep('EF', durationMin, thresholdSec)],
    totalMin: durationMin,
  };
}

function makeEFRun(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  return {
    id, name: 'Endurance Fondamentale', week, day, completed: false, garminSynced: false,
    description: `${durationMin}min en zone 2 — aisance respiratoire totale`,
    steps: [makeStep('EF', durationMin, thresholdSec)],
    totalMin: durationMin,
  };
}

function makeRecovery(id: string, week: number, day: number, durationMin: number, thresholdSec: number): Session {
  const core = Math.max(durationMin - 10, 10);
  return {
    id, name: 'Récupération Active', week, day, completed: false, garminSynced: false,
    description: `${durationMin}min très facile — régénération`,
    steps: [
      makeStep('Recup', 5, thresholdSec, true),
      makeStep('EF', core, thresholdSec),
      makeStep('Recup', 5, thresholdSec, true),
    ],
    totalMin: durationMin,
  };
}

export function generatePlan(profile: UserProfile): TrainingPlan {
  const { thresholdPaceSec, goalRace } = profile;
  const sessions: Session[] = [];

  // Days (default Tue/Thu/Sat/Sun if not specified)
  const days = profile.availableDays?.length === 4
    ? profile.availableDays
    : [2, 4, 6, 7];
  const [qualityDay, efDay, longDay, recovDay] = days;

  // Plan duration — longer plans for longer distances
  const totalWeeks = goalRace === 'marathon' ? 16
    : goalRace === 'halfMarathon' ? 12
    : goalRace === '10k' ? 10
    : 8;

  // Tapering: shorter for shorter distances
  const taperWeeks = goalRace === 'marathon' ? 3
    : goalRace === 'halfMarathon' ? 2
    : 1;
  const buildWeeks = totalWeeks - taperWeeks;

  // Long run targets
  const longBase = goalRace === 'marathon' ? 90
    : goalRace === 'halfMarathon' ? 65
    : goalRace === '10k' ? 50
    : 40;
  const longPeak = goalRace === 'marathon' ? 150   // 2h30
    : goalRace === 'halfMarathon' ? 105             // 1h45
    : goalRace === '10k' ? 75                       // 1h15
    : 60;                                           // 1h

  const taperFactors = goalRace === 'marathon' ? [0.80, 0.65, 0.50]
    : goalRace === 'halfMarathon' ? [0.70, 0.55]
    : [0.60];

  const isShort = goalRace === '5k' || goalRace === '10k';

  for (let w = 1; w <= totalWeeks; w++) {
    const taperIdx = w > buildWeeks ? w - buildWeeks - 1 : -1;
    const isTaper = taperIdx >= 0;

    // 4-week periodization: weeks 1-3 build, week 4 assimilation (-20%)
    const cyclePos = ((w - 1) % 4) + 1;
    const isAssimilation = !isTaper && cyclePos === 4;

    // Volume factor
    let volFactor: number;
    if (isTaper) {
      volFactor = taperFactors[taperIdx] ?? 0.55;
    } else if (isAssimilation) {
      volFactor = 0.80;
    } else {
      const cycle = Math.floor((w - 1) / 4);
      const posInCycle = cyclePos - 1; // 0,1,2
      volFactor = Math.min(1.0 + cycle * 0.24 + posInCycle * 0.08, 1.6);
    }

    // Phase in build block (for session type selection)
    const buildPct = buildWeeks > 1 ? (w - 1) / (buildWeeks - 1) : 1;
    const phase: 'early' | 'mid' | 'late' | 'taper' = isTaper ? 'taper'
      : buildPct <= 0.4 ? 'early'
      : buildPct <= 0.75 ? 'mid'
      : 'late';

    // ── Quality session (day 1) ───────────────────────────────────────────
    let quality: Session;
    if (phase === 'taper') {
      // Taper: keep intensity, reduce volume — short allure-cible rappels
      quality = makeIntervalSession(`w${w}-q`, 'Rappel Allure Cible', w, qualityDay, 15, 10, 'Seuil', 2, 1, 3, thresholdPaceSec);
    } else if (isShort) {
      // 5k / 10k — VO2max / VMA focus
      const cfg = phase === 'early'
        ? { name: 'VO2max Courts',        dur: 1,   rec: 1,   sets: 6 }
        : phase === 'mid'
        ? { name: 'VO2max Développement', dur: 2,   rec: 1.5, sets: 5 }
        : { name: 'VO2max Spécifique',    dur: 3,   rec: 2,   sets: 4 };
      quality = makeIntervalSession(`w${w}-q`, cfg.name, w, qualityDay, 15, 10, 'VO2max', cfg.dur, cfg.rec, cfg.sets, thresholdPaceSec);
    } else {
      // Semi / Marathon — seuil & tempo focus
      if (phase === 'early') {
        quality = makeIntervalSession(`w${w}-q`, 'Intervalles Seuil', w, qualityDay, 20, 10, 'Seuil', 2, 1, 5, thresholdPaceSec);
      } else if (phase === 'mid') {
        quality = makeIntervalSession(`w${w}-q`, 'Seuil Longs', w, qualityDay, 20, 10, 'Seuil', 4, 2, 3, thresholdPaceSec);
      } else {
        quality = makeTempo(`w${w}-q`, w, qualityDay, 20, 25, 10, thresholdPaceSec);
      }
    }
    sessions.push(quality);

    // ── EF run (day 2) — règle 80/20 ──────────────────────────────────────
    // Remplace l'ancienne 2ème séance de qualité
    const efMin = Math.max(25, Math.round((28 + w * 2) * volFactor));
    sessions.push(makeEFRun(`w${w}-ef`, w, efDay, efMin, thresholdPaceSec));

    // ── Sortie longue (day 3) ─────────────────────────────────────────────
    let longMin: number;
    if (isTaper) {
      longMin = Math.round(longPeak * (taperFactors[taperIdx] ?? 0.55));
    } else {
      const raw = longBase + buildPct * (longPeak - longBase);
      longMin = Math.round(raw * (isAssimilation ? 0.80 : 1.0));
    }
    sessions.push(makeLongRun(`w${w}-lr`, w, longDay, Math.max(longMin, 25), thresholdPaceSec));

    // ── Récupération (day 4) ──────────────────────────────────────────────
    const recovMin = Math.max(15, Math.round((isTaper ? 20 : isAssimilation ? 25 : 30) * volFactor));
    sessions.push(makeRecovery(`w${w}-rec`, w, recovDay, recovMin, thresholdPaceSec));
  }

  return {
    id: `plan-${Date.now()}`,
    profile,
    sessions,
    createdAt: new Date().toISOString(),
  };
}
