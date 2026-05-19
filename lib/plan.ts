import { Session, Step, TrainingPlan, UserProfile, Zone } from './types';
import { getZonePaceRange } from './zones';

function makeStep(
  zone: Zone,
  durationMin: number,
  thresholdSec: number,
  isRecovery = false,
  reps?: number
): Step {
  const pace = getZonePaceRange(zone, thresholdSec);
  return {
    zone,
    durationMin,
    targetPace: pace,
    isRecovery,
    ...(reps !== undefined ? { reps } : {}),
  };
}

function totalMin(steps: Step[]): number {
  return steps.reduce((sum, s) => {
    const reps = s.reps ?? 1;
    return sum + s.durationMin * reps;
  }, 0);
}

function makeIntervalSession(
  id: string,
  name: string,
  week: number,
  day: number,
  warmupMin: number,
  cooldownMin: number,
  intervalZone: Zone,
  intervalMin: number,
  recoveryMin: number,
  sets: number,
  thresholdSec: number
): Session {
  const steps: Step[] = [
    makeStep('EF', warmupMin, thresholdSec),
    {
      zone: intervalZone,
      durationMin: intervalMin,
      targetPace: getZonePaceRange(intervalZone, thresholdSec),
      reps: sets,
    },
    makeStep('Recup', recoveryMin, thresholdSec, true, sets - 1 > 0 ? sets - 1 : undefined),
    makeStep('EF', cooldownMin, thresholdSec),
  ];

  // Recalculate total with reps
  const total = warmupMin + (intervalMin + recoveryMin) * sets - recoveryMin + cooldownMin;

  return {
    id,
    name,
    description: `${sets}×${intervalMin}min ${intervalZone} avec ${recoveryMin}min récup`,
    steps,
    totalMin: Math.max(total, warmupMin + cooldownMin),
    week,
    day,
    completed: false,
    garminSynced: false,
  };
}

function makeLongRun(
  id: string,
  week: number,
  durationMin: number,
  thresholdSec: number
): Session {
  const steps: Step[] = [
    makeStep('EF', durationMin, thresholdSec),
  ];
  return {
    id,
    name: 'Sortie Longue',
    description: `${durationMin}min en endurance fondamentale`,
    steps,
    totalMin: durationMin,
    week,
    day: 6, // Samedi
    completed: false,
    garminSynced: false,
  };
}

function makeRecovery(
  id: string,
  week: number,
  durationMin: number,
  thresholdSec: number
): Session {
  const steps: Step[] = [
    makeStep('Recup', 5, thresholdSec, true),
    makeStep('EF', durationMin - 10, thresholdSec),
    makeStep('Recup', 5, thresholdSec, true),
  ];
  return {
    id,
    name: 'Récupération Active',
    description: `${durationMin}min en récupération et EF`,
    steps,
    totalMin: durationMin,
    week,
    day: 7, // Dimanche
    completed: false,
    garminSynced: false,
  };
}

function makeTempo(
  id: string,
  week: number,
  warmupMin: number,
  tempoMin: number,
  cooldownMin: number,
  thresholdSec: number
): Session {
  const steps: Step[] = [
    makeStep('EF', warmupMin, thresholdSec),
    makeStep('SSeuilVO2', tempoMin, thresholdSec),
    makeStep('EF', cooldownMin, thresholdSec),
  ];
  return {
    id,
    name: 'Tempo',
    description: `${tempoMin}min en zone sous-seuil`,
    steps,
    totalMin: warmupMin + tempoMin + cooldownMin,
    week,
    day: 4, // Jeudi
    completed: false,
    garminSynced: false,
  };
}

export function generatePlan(profile: UserProfile): TrainingPlan {
  const { thresholdPaceSec } = profile;
  const sessions: Session[] = [];

  const totalWeeks = profile.goalRace === 'marathon' ? 12
    : profile.goalRace === 'halfMarathon' ? 10
    : profile.goalRace === '10k' ? 8
    : 6;

  for (let week = 1; week <= totalWeeks; week++) {
    const isTaper = week >= totalWeeks - 1;
    const isEarly = week <= 4;
    const isMid = week > 4 && week <= 8;

    // Mardi: séance qualité (intervalles)
    let qualitySession: Session;
    if (isTaper) {
      qualitySession = makeIntervalSession(
        `w${week}-tue`,
        'Intervalles Affûtage',
        week, 2,
        15, 10,
        'Seuil', 2, 1, 4,
        thresholdPaceSec
      );
    } else if (isEarly) {
      qualitySession = makeIntervalSession(
        `w${week}-tue`,
        'Intervalles Courts Seuil',
        week, 2,
        20, 10,
        'Seuil', 1, 1, 6,
        thresholdPaceSec
      );
    } else if (isMid) {
      qualitySession = makeIntervalSession(
        `w${week}-tue`,
        'Intervalles Longs Seuil',
        week, 2,
        20, 10,
        'Seuil', 3, 2, 4,
        thresholdPaceSec
      );
    } else {
      qualitySession = makeIntervalSession(
        `w${week}-tue`,
        'Charge Max Seuil',
        week, 2,
        20, 10,
        'Seuil', 5, 2, 3,
        thresholdPaceSec
      );
    }
    sessions.push(qualitySession);

    // Jeudi: tempo ou VO2max
    let thursdaySession: Session;
    if (isTaper) {
      thursdaySession = makeTempo(`w${week}-thu`, week, 10, 15, 10, thresholdPaceSec);
    } else if (isEarly) {
      thursdaySession = makeIntervalSession(
        `w${week}-thu`,
        'VO2max Courts',
        week, 4,
        15, 10,
        'VO2max', 1, 1, 5,
        thresholdPaceSec
      );
    } else if (isMid) {
      thursdaySession = makeTempo(`w${week}-thu`, week, 15, 20, 10, thresholdPaceSec);
    } else {
      thursdaySession = makeIntervalSession(
        `w${week}-thu`,
        'VO2max Longs',
        week, 4,
        15, 10,
        'VO2max', 2, 2, 4,
        thresholdPaceSec
      );
    }
    sessions.push(thursdaySession);

    // Samedi: sortie longue
    let longRunMin: number;
    const baseMin = profile.goalRace === 'marathon' ? 90
      : profile.goalRace === 'halfMarathon' ? 60
      : profile.goalRace === '10k' ? 45
      : 35;

    if (isTaper) {
      longRunMin = Math.round(baseMin * 0.6);
    } else {
      const progression = Math.min(1.0 + (week - 1) * 0.08, 1.5);
      longRunMin = Math.round(baseMin * progression);
    }
    sessions.push(makeLongRun(`w${week}-sat`, week, longRunMin, thresholdPaceSec));

    // Dimanche: récup
    const recoveryMin = isTaper ? 25 : isEarly ? 30 : 40;
    sessions.push(makeRecovery(`w${week}-sun`, week, recoveryMin, thresholdPaceSec));
  }

  return {
    id: `plan-${Date.now()}`,
    profile,
    sessions,
    createdAt: new Date().toISOString(),
  };
}
