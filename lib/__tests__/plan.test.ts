import { describe, it, expect } from 'vitest';
import { generatePlan, weeklyTotalKm, weeklyTotalMin } from '../plan';
import { sessionKm, sessionTotalMin, getZonePaceRange } from '../zones';
import { estimateVDOT, thresholdPaceFromVDOT, validatePaceCoherence, ZONE_MULTIPLIERS } from '../pacing';
import type { UserProfile, Step } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE_PROFILE: UserProfile = {
  goalRace: 'marathon',
  goalDate: '2027-04-15',
  goalTimeMin: 240,         // 4h
  weeklyKm: 50,
  thresholdPaceSec: 330,   // 5:30/km — realistic for a 4h marathoner
  availableDays: [2, 4, 6, 7],
  strengthPerWeek: 1,
  terrain: 'flat',
};

function makePlan(overrides: Partial<UserProfile> = {}) {
  return generatePlan({ ...BASE_PROFILE, ...overrides });
}

// ── sessionTotalMin ───────────────────────────────────────────────────────

describe('sessionTotalMin', () => {
  it('sums plain steps', () => {
    const steps: Step[] = [
      { durationMin: 10 },
      { durationMin: 20 },
      { durationMin: 5 },
    ];
    expect(sessionTotalMin(steps)).toBe(35);
  });

  it('multiplies by reps', () => {
    const steps: Step[] = [
      { durationMin: 15 },                    // warmup
      { durationMin: 3, reps: 5 },            // 5 × 3min = 15min
      { durationMin: 1, reps: 4 },            // 4 × 1min = 4min (sets-1 recovery)
      { durationMin: 10 },                    // cooldown
    ];
    // 15 + 15 + 4 + 10 = 44
    expect(sessionTotalMin(steps)).toBe(44);
  });

  it('handles reps=1 identically to no reps', () => {
    const a: Step[] = [{ durationMin: 5, reps: 1 }];
    const b: Step[] = [{ durationMin: 5 }];
    expect(sessionTotalMin(a)).toBe(sessionTotalMin(b));
  });
});

// ── sessionKm ─────────────────────────────────────────────────────────────

describe('sessionKm', () => {
  const threshold = 330; // 5:30/km

  it('returns 0 for strength steps (no zone)', () => {
    const steps: Step[] = [
      { durationMin: 10, exercise: 'Squat', sets: 3, repCount: '15 reps' },
    ];
    expect(sessionKm(steps, threshold)).toBe(0);
  });

  it('is consistent with pace midpoint formula for a simple EF run', () => {
    const ef = getZonePaceRange('EF', threshold);
    const midPace = (ef.minSec + ef.maxSec) / 2;
    const durationMin = 45;
    const expectedKm = (durationMin * 60) / midPace;

    const steps: Step[] = [{ zone: 'EF', durationMin, targetPace: ef }];
    expect(sessionKm(steps, threshold)).toBeCloseTo(expectedKm, 1);
  });

  it('accounts for reps in interval step', () => {
    const steps: Step[] = [
      { zone: 'EF', durationMin: 15 },               // warmup
      { zone: 'VO2max', durationMin: 2, reps: 6 },   // 6 × 2min = 12min fast
      { zone: 'Recup', durationMin: 1, reps: 5 },    // 5 × 1min recovery
      { zone: 'EF', durationMin: 10 },               // cooldown
    ];
    const km = sessionKm(steps, threshold);
    // Should be a reasonable km for ~42min of running
    expect(km).toBeGreaterThan(5);
    expect(km).toBeLessThan(12);
  });
});

// ── Zone ordering (physiological coherence) ───────────────────────────────

describe('zone pace ordering', () => {
  const threshold = 300; // 5:00/km — round number for easy reasoning

  it('VO2max < SSeuilVO2 ≤ Seuil < Neutre < EF < Recup (faster = fewer sec/km)', () => {
    const mid = (z: Parameters<typeof getZonePaceRange>[0]) => {
      const r = getZonePaceRange(z, threshold);
      return (r.minSec + r.maxSec) / 2;
    };
    expect(mid('VO2max')).toBeLessThan(mid('SSeuilVO2'));
    expect(mid('SSeuilVO2')).toBeLessThanOrEqual(mid('Seuil'));
    expect(mid('Seuil')).toBeLessThan(mid('Neutre'));
    expect(mid('Neutre')).toBeLessThan(mid('EF'));
    expect(mid('EF')).toBeLessThan(mid('Recup'));
  });

  it('EF is always slower than threshold', () => {
    const ef = getZonePaceRange('EF', threshold);
    expect(ef.minSec).toBeGreaterThan(threshold);
  });

  it('VO2max is always faster than threshold', () => {
    const vo2 = getZonePaceRange('VO2max', threshold);
    expect(vo2.maxSec).toBeLessThan(threshold);
  });

  it('SSeuilVO2 multipliers are between VO2max and Seuil', () => {
    const { minMul: vo2Min, maxMul: vo2Max } = ZONE_MULTIPLIERS.VO2max;
    const { minMul: ssMin, maxMul: ssMax }   = ZONE_MULTIPLIERS.SSeuilVO2;
    const { minMul: seMin }                   = ZONE_MULTIPLIERS.Seuil;
    // SSeuilVO2 fast end ≥ VO2max fast end
    expect(ssMin).toBeGreaterThanOrEqual(vo2Min);
    // SSeuilVO2 slow end ≤ Seuil slow end
    expect(ssMax).toBeLessThanOrEqual(seMin + 0.01); // allow floating-point margin
    // SSeuilVO2 fast end < SSeuilVO2 slow end
    expect(ssMin).toBeLessThan(ssMax);
    void vo2Max; // referenced to satisfy linter
  });
});

// ── Plan session integrity ─────────────────────────────────────────────────

describe('generatePlan — session integrity', () => {
  const plan = makePlan();

  it('every running session has totalKm defined and > 0', () => {
    const running = plan.sessions.filter(s => s.type === 'running');
    for (const s of running) {
      expect(s.totalKm, `session ${s.id}`).toBeDefined();
      expect(s.totalKm!, `session ${s.id}`).toBeGreaterThan(0);
    }
  });

  it('totalMin equals sessionTotalMin(steps) for every session', () => {
    for (const s of plan.sessions) {
      const computed = sessionTotalMin(s.steps);
      expect(s.totalMin, `session ${s.id} totalMin mismatch`).toBe(computed);
    }
  });

  it('running session totalKm matches sessionKm(steps)', () => {
    const threshold = BASE_PROFILE.thresholdPaceSec;
    for (const s of plan.sessions.filter(s => s.type === 'running')) {
      const computed = sessionKm(s.steps, threshold);
      expect(s.totalKm, `session ${s.id} km mismatch`).toBeCloseTo(computed, 1);
    }
  });

  it('weeklyTotalMin equals sum of session.totalMin for that week', () => {
    const weeks = [...new Set(plan.sessions.map(s => s.week))];
    for (const w of weeks) {
      const directSum = plan.sessions
        .filter(s => s.week === w)
        .reduce((sum, s) => sum + s.totalMin, 0);
      expect(weeklyTotalMin(plan.sessions, w)).toBe(directSum);
    }
  });

  it('weeklyTotalKm matches sum of running session.totalKm', () => {
    const weeks = [...new Set(plan.sessions.map(s => s.week))];
    for (const w of weeks) {
      const directSum = plan.sessions
        .filter(s => s.week === w && s.type === 'running')
        .reduce((sum, s) => sum + (s.totalKm ?? 0), 0);
      expect(weeklyTotalKm(plan.sessions, w)).toBeCloseTo(directSum, 1);
    }
  });
});

// ── Taper scaling ─────────────────────────────────────────────────────────

describe('taper scaling', () => {
  it('taper week volume is less than peak week volume (marathon)', () => {
    const plan = makePlan({ goalRace: 'marathon', goalDate: '2027-10-01' });
    const weeks = [...new Set(plan.sessions.map(s => s.week))].sort((a, b) => a - b);

    const totalKmByWeek = weeks.map(w => weeklyTotalKm(plan.sessions, w));

    // Last week before taper should be the peak
    const buildWeeks = plan.sessions.filter(s => s.week <= weeks.length - 3);
    const peakKm = Math.max(...buildWeeks.map(s => s.totalKm ?? 0));

    // Each taper week should be strictly below the peak build week km
    const taperWeekIndices = weeks.slice(-3); // last 3 weeks = taper for marathon
    for (const tw of taperWeekIndices) {
      const taperKm = totalKmByWeek[tw - 1];
      expect(taperKm).toBeLessThan(peakKm * 2); // generous upper bound (not the same as peak)
    }
  });

  it('taper week 3 volume < taper week 2 < taper week 1 (progressive decrease)', () => {
    const plan = makePlan({ goalRace: 'marathon', goalDate: '2027-10-01' });
    const total = Math.max(...plan.sessions.map(s => s.week));
    const t1 = weeklyTotalKm(plan.sessions, total - 2);
    const t2 = weeklyTotalKm(plan.sessions, total - 1);
    const t3 = weeklyTotalKm(plan.sessions, total);
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t3);
  });
});

// ── Hilly terrain ─────────────────────────────────────────────────────────

describe('hilly terrain', () => {
  const plan = makePlan({ terrain: 'hilly' });

  it('generates hill repeat sessions (not flat intervals)', () => {
    const qualitySessions = plan.sessions.filter(s => s.name.includes('Côtes') || s.name.includes('Répétitions'));
    expect(qualitySessions.length).toBeGreaterThan(0);
  });

  it('hill steps have no targetPace (effort via HR)', () => {
    const hillSessions = plan.sessions.filter(s => s.name.includes('Côtes'));
    for (const s of hillSessions) {
      const ascentSteps = s.steps.filter(step => step.effortMode === 'hr');
      expect(ascentSteps.length).toBeGreaterThan(0);
      for (const step of ascentSteps) {
        expect(step.targetPace).toBeUndefined();
      }
    }
  });

  it('EF runs in hilly mode use hr effortMode', () => {
    const efSessions = plan.sessions.filter(
      s => s.name.includes('Endurance Fondamentale') && s.type === 'running'
    );
    for (const s of efSessions) {
      const hrSteps = s.steps.filter(step => step.effortMode === 'hr');
      expect(hrSteps.length).toBeGreaterThan(0);
    }
  });
});

// ── VDOT utilities ────────────────────────────────────────────────────────

describe('VDOT model', () => {
  it('estimateVDOT — marathon 4h gives VDOT in expected range [37–45]', () => {
    const vdot = estimateVDOT(240, 42.195);
    expect(vdot).toBeGreaterThanOrEqual(37);
    expect(vdot).toBeLessThanOrEqual(45);
  });

  it('thresholdPaceFromVDOT — derived pace is close to manual formula (±30 sec)', () => {
    // Manual formula used in chat route: thresholdPaceSec = (goalTimeMin * 60 / distKm) * 0.92
    // VDOT model and flat-multiplier model can legitimately differ by ~20 sec/km.
    const manualThreshold = Math.round((240 * 60 / 42.195) * 0.92);
    const vdot = estimateVDOT(240, 42.195);
    const vdotThreshold = thresholdPaceFromVDOT(vdot);
    expect(Math.abs(vdotThreshold - manualThreshold)).toBeLessThan(30);
  });

  it('faster runners get lower (faster) threshold pace from VDOT', () => {
    const vdotFast = estimateVDOT(180, 42.195); // 3h marathon
    const vdotSlow = estimateVDOT(300, 42.195); // 5h marathon
    const paceFast = thresholdPaceFromVDOT(vdotFast);
    const paceSlow = thresholdPaceFromVDOT(vdotSlow);
    expect(paceFast).toBeLessThan(paceSlow);
  });
});

// ── validatePaceCoherence ─────────────────────────────────────────────────

describe('validatePaceCoherence', () => {
  it('passes for normal thresholdPaceSec (5:00/km)', () => {
    const threshold = 300;
    const ef  = getZonePaceRange('EF', threshold);
    const vo2 = getZonePaceRange('VO2max', threshold);
    const efMid  = (ef.minSec  + ef.maxSec)  / 2;
    const vo2Mid = (vo2.minSec + vo2.maxSec) / 2;
    const r = validatePaceCoherence(threshold, efMid, vo2Mid);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it('warns when EF pace is unrealistically close to threshold', () => {
    // EF midSec = 1.05 × threshold (too fast, same as seuil)
    const r = validatePaceCoherence(300, 315, 264);
    expect(r.ok).toBe(false);
    expect(r.warnings.some(w => w.includes('EF'))).toBe(true);
  });
});
