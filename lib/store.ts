import { TrainingPlan, UserProfile } from './types';

const PLAN_KEY = 'campus_coach_plan';
const PROFILE_KEY = 'campus_coach_profile';

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
