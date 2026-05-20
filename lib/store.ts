import { TrainingPlan, UserProfile } from './types';

const PLAN_KEY = 'campus_coach_plan';
const PROFILE_KEY = 'campus_coach_profile';
const GARMIN_KEY = 'campus_coach_garmin_tokens';
const USER_ID_KEY = 'campus_coach_user_id';
const GARMIN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// ── User ID (stable key for DB row) ────────────────────────────────────────
// App mono-utilisateur : on utilise un ID fixe "solo" pour la DB.
// localStorage + cookie sont des caches ; en leur absence, "solo" permet
// toujours de retrouver le plan en DB sans aucun identifiant côté client.

const SOLO_USER_ID = 'solo';
const UID_COOKIE = 'cc_uid';
const UID_MAX_AGE = 365 * 24 * 3600; // 1 an

export function loadUserId(): string {
  if (typeof window === 'undefined') return SOLO_USER_ID;
  const ls = localStorage.getItem(USER_ID_KEY);
  if (ls) return ls;
  const match = document.cookie.match(new RegExp(`(?:^|; )${UID_COOKIE}=([^;]+)`));
  if (match) {
    localStorage.setItem(USER_ID_KEY, match[1]);
    return match[1];
  }
  return SOLO_USER_ID;
}

export function saveUserId(id: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_ID_KEY, id);
  document.cookie = `${UID_COOKIE}=${id}; max-age=${UID_MAX_AGE}; path=/; SameSite=Lax`;
}

// ── Garmin tokens ─────────────────────────────────────────────────────────

export type GarminTokens = {
  oauth1: { oauth_token: string; oauth_token_secret: string };
  oauth2: {
    scope: string; jti: string; access_token: string; token_type: string;
    refresh_token: string; expires_in: number; refresh_token_expires_in: number;
    expires_at: number; refresh_token_expires_at: number;
    last_update_date: string; expires_date: string;
  };
};

type StoredGarmin = { tokens: GarminTokens; savedAt: number };

export function saveGarminTokens(tokens: GarminTokens): void {
  if (typeof window === 'undefined') return;
  const entry: StoredGarmin = { tokens, savedAt: Date.now() };
  localStorage.setItem(GARMIN_KEY, JSON.stringify(entry));
}

export function loadGarminTokens(): GarminTokens | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(GARMIN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredGarmin | GarminTokens;
    // Handle old format (tokens stored directly without savedAt)
    if (!('savedAt' in parsed)) {
      clearGarminTokens();
      return null;
    }
    const { tokens, savedAt } = parsed as StoredGarmin;
    if (Date.now() - savedAt > GARMIN_TTL_MS) {
      clearGarminTokens();
      return null;
    }
    return tokens;
  } catch {
    return null;
  }
}

export function garminTokensExpiresAt(): Date | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(GARMIN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredGarmin;
    if (!parsed.savedAt) return null;
    return new Date(parsed.savedAt + GARMIN_TTL_MS);
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
