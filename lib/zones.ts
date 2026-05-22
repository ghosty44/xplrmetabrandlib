import { Step, Zone, ZoneConfig } from './types';

export const ZONE_CONFIGS: Record<Zone, ZoneConfig> = {
  EF: {
    label: 'Endurance Fondamentale',
    color: '#c8e635',
    description: 'Allure confortable, conversation possible',
  },
  Seuil: {
    label: 'Seuil',
    color: '#7c1c1c',
    description: 'Allure seuil lactique, effort soutenu',
  },
  SSeuilVO2: {
    label: 'Sous-Seuil / VO2',
    color: '#c0392b',
    description: 'Entre seuil et VO2max, effort intense',
  },
  VO2max: {
    label: 'VO2max',
    color: '#e85d04',
    description: 'Consommation maximale d\'oxygène',
  },
  Recup: {
    label: 'Récupération',
    color: '#f4a7b9',
    description: 'Allure très facile, récupération active',
  },
  Neutre: {
    label: 'Neutre',
    color: '#9ca3af',
    description: 'Zone neutre de transition',
  },
};

export function getZoneConfig(zone: Zone): ZoneConfig {
  return ZONE_CONFIGS[zone];
}

export function formatPace(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.round(sec % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getZoneHRRange(zone: Zone): { min: number; max: number } {
  switch (zone) {
    case 'Recup':     return { min: 60, max: 70 };
    case 'EF':        return { min: 70, max: 80 };
    case 'Neutre':    return { min: 78, max: 83 };
    case 'SSeuilVO2': return { min: 83, max: 88 };
    case 'Seuil':     return { min: 88, max: 92 };
    case 'VO2max':    return { min: 92, max: 100 };
  }
}

/**
 * Pace ranges in sec/km relative to threshold pace.
 * minSec = faster end (fewer sec/km), maxSec = slower end.
 *
 * Zone ordering (faster → slower):
 *   VO2max (×0.88–0.94) < SSeuilVO2 (×0.94–1.00) < Seuil (×1.00–1.05)
 *   < Neutre (×1.20–1.25) < EF (×1.28–1.38) < Recup (×1.45–1.60)
 */
export function getZonePaceRange(
  zone: Zone,
  thresholdSec: number,
): { minSec: number; maxSec: number } {
  switch (zone) {
    case 'VO2max':
      return { minSec: Math.round(thresholdSec * 0.88), maxSec: Math.round(thresholdSec * 0.94) };
    case 'SSeuilVO2':
      // Corrected: between VO2max and Seuil (was erroneously 1.07–1.15×, i.e. slower than threshold)
      return { minSec: Math.round(thresholdSec * 0.94), maxSec: Math.round(thresholdSec * 1.00) };
    case 'Seuil':
      return { minSec: Math.round(thresholdSec * 1.00), maxSec: Math.round(thresholdSec * 1.05) };
    case 'Neutre':
      return { minSec: Math.round(thresholdSec * 1.20), maxSec: Math.round(thresholdSec * 1.25) };
    case 'EF':
      return { minSec: Math.round(thresholdSec * 1.28), maxSec: Math.round(thresholdSec * 1.38) };
    case 'Recup':
      return { minSec: Math.round(thresholdSec * 1.45), maxSec: Math.round(thresholdSec * 1.60) };
  }
}

// ── Volume calculation utilities ───────────────────────────────────────────

/**
 * Estimated km for one step from its duration, pace range and repetitions.
 * Uses the midpoint of the pace range as average speed.
 */
export function stepKm(
  durationMin: number,
  paceRange: { minSec: number; maxSec: number },
  reps = 1,
): number {
  const midPaceSec = (paceRange.minSec + paceRange.maxSec) / 2;
  return (durationMin * 60 * reps) / midPaceSec;
}

/**
 * Total km for a session — derived exclusively from its steps.
 * Strength steps (no zone) contribute 0 km.
 * Recovery steps are included in the total because they still cover ground.
 */
export function sessionKm(steps: Step[], thresholdSec: number): number {
  let total = 0;
  for (const step of steps) {
    if (!step.zone) continue;
    const paceRange = getZonePaceRange(step.zone, thresholdSec);
    const reps = step.reps ?? 1;
    total += stepKm(step.durationMin, paceRange, reps);
  }
  return Math.round(total * 10) / 10;
}

/**
 * Total duration in minutes — computed from steps, respecting reps.
 * This is the ground-truth source for session.totalMin.
 */
export function sessionTotalMin(steps: Step[]): number {
  let total = 0;
  for (const step of steps) {
    const reps = step.reps ?? 1;
    total += step.durationMin * reps;
  }
  return total;
}
