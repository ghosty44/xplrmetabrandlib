import { TrainingPlan, UserProfile } from './types';

const PLAN_KEY = 'campus_coach_plan';
const PROFILE_KEY = 'campus_coach_profile';
const GARMIN_KEY = 'campus_coach_garmin_tokens';

export type GarminTokens = {
  oauth1: { oauth_token: string; oauth_token_secret: string };
  oauth2: {
    scope: string; jti: string; access_token: string; token_type: string;
    refresh_token: string; expires_in: number; refresh_token_expires_in: number;
    expires_at: number; refresh_token_expires_at: number;
    last_update_date: string; expires_date: string;
  };
};

export function saveGarminTokens(tokens: GarminTokens): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GARMIN_KEY, JSON.stringify(tokens));
}

export function loadGarminTokens(): GarminTokens | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(GARMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GarminTokens;
  } catch {
    return null;
  }
}

export function clearGarminTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(GARMIN_KEY);
}

export function savePlan(plan: TrainingPlan): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
}

export function loadPlan(): TrainingPlan | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(PLAN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TrainingPlan;
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export function markSessionCompleted(sessionId: string): void {
  if (typeof window === 'undefined') return;
  const plan = loadPlan();
  if (!plan) return;
  plan.sessions = plan.sessions.map((s) =>
    s.id === sessionId ? { ...s, completed: true } : s
  );
  savePlan(plan);
}

export function markSessionGarminSynced(sessionId: string): void {
  if (typeof window === 'undefined') return;
  const plan = loadPlan();
  if (!plan) return;
  plan.sessions = plan.sessions.map((s) =>
    s.id === sessionId ? { ...s, garminSynced: true } : s
  );
  savePlan(plan);
}
