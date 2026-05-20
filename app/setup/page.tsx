'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generatePlan } from '@/lib/plan';
import { savePlan, saveProfile, saveGarminTokens, saveUserId, loadUserId, loadPlan, GarminTokens } from '@/lib/store';
import { UserProfile } from '@/lib/types';
import { formatPace } from '@/lib/zones';

type Step = 1 | 2 | 3 | 4;

const RACE_OPTIONS = [
  { value: 'marathon', label: 'Marathon', km: 42.195, icon: '🏃' },
  { value: 'halfMarathon', label: 'Semi-Marathon', km: 21.1, icon: '🏃' },
  { value: '10k', label: '10 km', km: 10, icon: '🏃' },
  { value: '5k', label: '5 km', km: 5, icon: '🏃' },
] as const;

function timeToMinutes(h: string, m: string): number {
  return parseInt(h || '0') * 60 + parseInt(m || '0');
}

function goalTimeToThresholdPace(goalTimeMin: number, raceKm: number): number {
  const avgPaceSec = (goalTimeMin * 60) / raceKm;
  return Math.round(avgPaceSec * 0.92);
}

function SetupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>(1);

  // Redirect to dashboard if a plan already exists (unless ?force=1)
  useEffect(() => {
    if (searchParams.get('force') === '1') return;
    const existing = loadPlan();
    if (existing) {
      router.replace('/');
    }
  }, [router, searchParams]);

  // Steps 1-3
  const [goalRace, setGoalRace] = useState<UserProfile['goalRace']>('marathon');
  const [goalDate, setGoalDate] = useState('');
  const [goalHours, setGoalHours] = useState('3');
  const [goalMinutes, setGoalMinutes] = useState('30');
  const [thresholdInput, setThresholdInput] = useState('');
  const [useManualThreshold, setUseManualThreshold] = useState(false);
  const [weeklyKm, setWeeklyKm] = useState('40');

  // Step 4 — Garmin
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState<string | null>(null);
  const [garminConnected, setGarminConnected] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedRace = RACE_OPTIONS.find((r) => r.value === goalRace)!;

  const getEstimatedThreshold = (): number => {
    if (useManualThreshold && thresholdInput) {
      const parts = thresholdInput.split(':');
      if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    const goalTimeMin = timeToMinutes(goalHours, goalMinutes);
    return goalTimeToThresholdPace(goalTimeMin, selectedRace.km);
  };

  // Called on steps 1–3 (save plan on step 3, then advance to step 4)
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      setStep((s) => (s + 1) as Step);
      return;
    }
    if (step === 3) {
      setIsSubmitting(true);
      const goalTimeMin = timeToMinutes(goalHours, goalMinutes);
      const profile: UserProfile = {
        goalRace,
        goalDate,
        goalTimeMin,
        weeklyKm: parseFloat(weeklyKm) || 40,
        thresholdPaceSec: getEstimatedThreshold(),
      };
      saveProfile(profile);
      const plan = generatePlan(profile);
      savePlan(plan);

      // Persist to DB — reuse existing userId or use plan.id
      const userId = loadUserId() ?? plan.id;
      saveUserId(userId);
      fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan }),
      }).catch(() => {}); // best-effort, localStorage is source of truth

      setIsSubmitting(false);
      setStep(4);
    }
  };

  const handleGarminConnect = async () => {
    setGarminLoading(true);
    setGarminError(null);
    try {
      const res = await fetch('/api/garmin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: garminEmail, password: garminPassword }),
      });
      const data = await res.json() as { success: boolean; tokens?: GarminTokens; error?: string };
      if (data.success && data.tokens) {
        saveGarminTokens(data.tokens);
        setGarminConnected(true);
      } else {
        setGarminError(data.error ?? 'Identifiants incorrects');
      }
    } catch {
      setGarminError('Erreur réseau');
    } finally {
      setGarminLoading(false);
    }
  };

  const estimatedThreshold = getEstimatedThreshold();
  const totalSteps = 4;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Campus Coach</h1>
          <p className="text-gray-500">Crée ton plan d&apos;entraînement personnalisé</p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                  step === s
                    ? 'bg-gray-900 text-white'
                    : step > s
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {step > s ? '✓' : s === 4 ? 'G' : s}
              </div>
              {s < totalSteps && (
                <div className={`w-8 h-0.5 ${step > s ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Steps 1–3 use a form; step 4 is standalone */}
        {step < 4 ? (
          <form onSubmit={handleSubmit}>
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              {/* Step 1 */}
              {step === 1 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">Ton objectif</h2>
                  <p className="text-sm text-gray-500 mb-5">Quelle course vises-tu ?</p>
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    {RACE_OPTIONS.map((race) => (
                      <button
                        key={race.value}
                        type="button"
                        onClick={() => setGoalRace(race.value)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          goalRace === race.value
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        <div className="text-2xl mb-1">{race.icon}</div>
                        <div className="font-semibold text-sm">{race.label}</div>
                        <div className={`text-xs mt-0.5 ${goalRace === race.value ? 'text-gray-300' : 'text-gray-400'}`}>
                          {race.km} km
                        </div>
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Date de la course</label>
                    <input
                      type="date"
                      value={goalDate}
                      onChange={(e) => setGoalDate(e.target.value)}
                      required
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {/* Step 2 */}
              {step === 2 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">Temps visé</h2>
                  <p className="text-sm text-gray-500 mb-5">Quel temps vises-tu sur {selectedRace.label} ?</p>
                  <div className="flex gap-3 mb-5">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Heures</label>
                      <input
                        type="number"
                        value={goalHours}
                        onChange={(e) => setGoalHours(e.target.value)}
                        min="0" max="10"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Minutes</label>
                      <input
                        type="number"
                        value={goalMinutes}
                        onChange={(e) => setGoalMinutes(e.target.value)}
                        min="0" max="59"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <p className="text-xs text-gray-500">
                      Allure seuil estimée :{' '}
                      <span className="font-semibold text-gray-800">{formatPace(estimatedThreshold)} /km</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseManualThreshold(!useManualThreshold)}
                    className="text-sm text-gray-500 underline underline-offset-2 mb-3 block"
                  >
                    {useManualThreshold ? 'Utiliser le calcul automatique' : 'Saisir mon allure seuil manuellement'}
                  </button>
                  {useManualThreshold && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Allure seuil (mm:ss /km)</label>
                      <input
                        type="text"
                        placeholder="ex: 4:30"
                        value={thresholdInput}
                        onChange={(e) => setThresholdInput(e.target.value)}
                        pattern="[0-9]+:[0-5][0-9]"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 */}
              {step === 3 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">Volume actuel</h2>
                  <p className="text-sm text-gray-500 mb-5">Combien de km cours-tu par semaine actuellement ?</p>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Kilomètres par semaine</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={weeklyKm}
                        onChange={(e) => setWeeklyKm(e.target.value)}
                        min="5" max="200" required
                        className="w-full px-3 py-2.5 pr-12 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">km</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[20, 40, 60, 80].map((km) => (
                      <button
                        key={km}
                        type="button"
                        onClick={() => setWeeklyKm(String(km))}
                        className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                          weeklyKm === String(km)
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {km}
                      </button>
                    ))}
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-700">
                      <span className="font-semibold">Récapitulatif :</span>{' '}
                      {RACE_OPTIONS.find((r) => r.value === goalRace)?.label} ·{' '}
                      {new Date(goalDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
                      Allure seuil {formatPace(estimatedThreshold)}/km
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="flex gap-3 mt-4">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s - 1) as Step)}
                  className="flex-1 py-3 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                >
                  ← Retour
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting || (step === 1 && !goalDate)}
                className="flex-1 py-3 px-4 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {isSubmitting ? 'Génération...' : step === 3 ? 'Continuer →' : 'Continuer →'}
              </button>
            </div>
          </form>
        ) : (
          /* ── Step 4 : Garmin ── */
          <div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              {garminConnected ? (
                <div className="text-center py-4">
                  <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl mx-auto mb-4">
                    ✓
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">Garmin connecté !</h2>
                  <p className="text-sm text-gray-500">
                    Tes séances seront synchronisées avec Garmin Connect.<br />
                    La connexion sera mémorisée pendant 30 jours.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 font-bold">G</div>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Connecte Garmin</h2>
                      <p className="text-sm text-gray-500">Pour synchroniser tes séances</p>
                    </div>
                  </div>

                  {garminError && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                      <p className="text-sm text-red-700">{garminError}</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Email Garmin Connect</label>
                      <input
                        type="email"
                        value={garminEmail}
                        onChange={(e) => setGarminEmail(e.target.value)}
                        placeholder="ton@email.com"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Mot de passe</label>
                      <input
                        type="password"
                        value={garminPassword}
                        onChange={(e) => setGarminPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 mt-3">
                    Ton mot de passe n&apos;est jamais stocké — seulement les tokens OAuth, valables 30 jours.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-4">
              {!garminConnected && (
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="flex-1 py-3 px-4 border border-gray-200 rounded-xl text-sm font-medium text-gray-500 bg-white hover:bg-gray-50 transition-colors"
                >
                  Passer cette étape
                </button>
              )}
              <button
                type="button"
                onClick={garminConnected ? () => router.push('/') : handleGarminConnect}
                disabled={garminLoading || (!garminConnected && (!garminEmail || !garminPassword))}
                className="flex-1 py-3 px-4 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {garminConnected
                  ? 'Commencer →'
                  : garminLoading
                  ? 'Connexion...'
                  : 'Se connecter'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupPageContent />
    </Suspense>
  );
}
