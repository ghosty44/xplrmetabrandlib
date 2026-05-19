'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { generatePlan } from '@/lib/plan';
import { savePlan, saveProfile } from '@/lib/store';
import { UserProfile } from '@/lib/types';
import { formatPace } from '@/lib/zones';

type Step = 1 | 2 | 3;

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
  // Average pace in sec/km
  const avgPaceSec = (goalTimeMin * 60) / raceKm;
  // Threshold pace is roughly 1.05x avg pace for marathon, 1.02x for shorter races
  // Simple heuristic: threshold ≈ avg × 0.92
  return Math.round(avgPaceSec * 0.92);
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1 fields
  const [goalRace, setGoalRace] = useState<UserProfile['goalRace']>('marathon');
  const [goalDate, setGoalDate] = useState('');

  // Step 2 fields
  const [goalHours, setGoalHours] = useState('3');
  const [goalMinutes, setGoalMinutes] = useState('30');
  const [thresholdInput, setThresholdInput] = useState('');
  const [useManualThreshold, setUseManualThreshold] = useState(false);

  // Step 3 fields
  const [weeklyKm, setWeeklyKm] = useState('40');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedRace = RACE_OPTIONS.find((r) => r.value === goalRace)!;

  const getEstimatedThreshold = (): number => {
    if (useManualThreshold && thresholdInput) {
      const parts = thresholdInput.split(':');
      if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
      }
    }
    const goalTimeMin = timeToMinutes(goalHours, goalMinutes);
    return goalTimeToThresholdPace(goalTimeMin, selectedRace.km);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      setStep((s) => (s + 1) as Step);
      return;
    }

    setIsSubmitting(true);
    const goalTimeMin = timeToMinutes(goalHours, goalMinutes);
    const thresholdPaceSec = getEstimatedThreshold();

    const profile: UserProfile = {
      goalRace,
      goalDate,
      goalTimeMin,
      weeklyKm: parseFloat(weeklyKm) || 40,
      thresholdPaceSec,
    };

    saveProfile(profile);
    const plan = generatePlan(profile);
    savePlan(plan);
    router.push('/');
  };

  const estimatedThreshold = getEstimatedThreshold();

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
          {([1, 2, 3] as Step[]).map((s) => (
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
                {step > s ? '✓' : s}
              </div>
              {s < 3 && <div className={`w-8 h-0.5 ${step > s ? 'bg-green-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

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
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Date de la course
                  </label>
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
                      min="0"
                      max="10"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Minutes</label>
                    <input
                      type="number"
                      value={goalMinutes}
                      onChange={(e) => setGoalMinutes(e.target.value)}
                      min="0"
                      max="59"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-500">
                    Allure seuil estimée :{' '}
                    <span className="font-semibold text-gray-800">
                      {formatPace(estimatedThreshold)} /km
                    </span>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Allure seuil (mm:ss /km)
                    </label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Kilomètres par semaine
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={weeklyKm}
                      onChange={(e) => setWeeklyKm(e.target.value)}
                      min="5"
                      max="200"
                      required
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

          {/* Navigation buttons */}
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
              {isSubmitting
                ? 'Génération...'
                : step === 3
                ? 'Générer mon plan →'
                : 'Continuer →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
