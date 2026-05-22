/**
 * Pacing utilities — VDOT-inspired model linking threshold pace to race performance.
 *
 * Reference: Jack Daniels' Running Formula (2nd ed.).
 * The formulas below are lightweight approximations suitable for a consumer app.
 */

import { Zone } from './types';

const RACE_DISTANCES_KM: Record<string, number> = {
  marathon: 42.195,
  halfMarathon: 21.097,
  '10k': 10,
  '5k': 5,
};

// ── VDOT estimation ────────────────────────────────────────────────────────

/**
 * Oxygen cost at a given speed (mL/kg/min), Daniels & Gilbert 1979.
 * speed in m/min.
 */
function oxygenCost(speedMpm: number): number {
  return -4.6 + 0.182258 * speedMpm + 0.000104 * speedMpm ** 2;
}

/**
 * Percent of VO2max utilised at a given race duration (minutes).
 * Daniels & Gilbert hyperbolic curve.
 */
function pctVO2max(durationMin: number): number {
  if (durationMin <= 0) return 1;
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * durationMin)
             + 0.2989558 * Math.exp(-0.1932605 * durationMin);
}

/**
 * Estimate VDOT from a race result.
 * @param raceTimeMin - finish time in minutes
 * @param raceDistanceKm - race distance in km
 * @returns VDOT (mL/kg/min)
 */
export function estimateVDOT(raceTimeMin: number, raceDistanceKm: number): number {
  const speedMpm = (raceDistanceKm * 1000) / raceTimeMin; // m/min
  const vo2 = oxygenCost(speedMpm);
  const pct = pctVO2max(raceTimeMin);
  return Math.round((vo2 / pct) * 10) / 10;
}

/**
 * Derive threshold pace (sec/km) from VDOT using Daniels' T-pace = ~83% VO2max.
 * The result should be close to goalTimeMin×0.92 used in the chat route,
 * but based on physiological tables rather than a flat multiplier.
 */
export function thresholdPaceFromVDOT(vdot: number): number {
  // Solve iteratively: find speed (m/min) where VO2 = 0.83 × VDOT
  const target = 0.83 * vdot;
  let lo = 100, hi = 500;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    oxygenCost(mid) < target ? (lo = mid) : (hi = mid);
  }
  const speedMpm = (lo + hi) / 2;
  return Math.round(60000 / speedMpm); // sec/km
}

// ── Pace coherence guard ───────────────────────────────────────────────────

export type PaceCoherenceReport = {
  ok: boolean;
  efToThresholdRatio: number;   // should be 1.20–1.50
  vo2ToThresholdRatio: number;  // should be 0.85–0.95
  warnings: string[];
};

/**
 * Validate that the derived zone paces are physiologically coherent
 * for the given threshold pace.  Used in generatePlan() as a guard.
 */
export function validatePaceCoherence(
  thresholdSec: number,
  efMidSec: number,
  vo2MidSec: number,
): PaceCoherenceReport {
  const warnings: string[] = [];
  const efRatio  = efMidSec  / thresholdSec;
  const vo2Ratio = vo2MidSec / thresholdSec;

  if (efRatio < 1.20 || efRatio > 1.55) {
    warnings.push(
      `Ratio EF/Seuil hors plage (${efRatio.toFixed(2)}x, attendu 1.20–1.55). ` +
      `Vérifier thresholdPaceSec=${thresholdSec}.`
    );
  }
  if (vo2Ratio < 0.82 || vo2Ratio > 0.97) {
    warnings.push(
      `Ratio VO2max/Seuil hors plage (${vo2Ratio.toFixed(2)}x, attendu 0.82–0.97). ` +
      `Vérifier thresholdPaceSec=${thresholdSec}.`
    );
  }
  // EF must always be slower (more sec/km) than Seuil
  if (efMidSec <= thresholdSec) {
    warnings.push('Allure EF plus rapide que le seuil — incohérence critique.');
  }

  return { ok: warnings.length === 0, efToThresholdRatio: efRatio, vo2ToThresholdRatio: vo2Ratio, warnings };
}

// ── Convenience helpers ────────────────────────────────────────────────────

export function raceDistanceKm(goalRace: keyof typeof RACE_DISTANCES_KM): number {
  return RACE_DISTANCES_KM[goalRace] ?? 42.195;
}

/**
 * Zone multipliers table — single source of truth to keep zones.ts and pacing.ts aligned.
 * minMul = fastest (fewer sec/km), maxMul = slowest.
 */
export const ZONE_MULTIPLIERS: Record<Zone, { minMul: number; maxMul: number }> = {
  VO2max:    { minMul: 0.88, maxMul: 0.94 },
  SSeuilVO2: { minMul: 0.94, maxMul: 1.00 },
  Seuil:     { minMul: 1.00, maxMul: 1.05 },
  Neutre:    { minMul: 1.20, maxMul: 1.25 },
  EF:        { minMul: 1.28, maxMul: 1.38 },
  Recup:     { minMul: 1.45, maxMul: 1.60 },
};
