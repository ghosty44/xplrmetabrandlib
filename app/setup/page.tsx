'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { generatePlan } from '@/lib/plan';
import { savePlan, saveProfile, saveGarminTokens, saveUserId, loadUserId, loadPlan, GarminTokens } from '@/lib/store';
import { UserProfile } from '@/lib/types';
import { formatPace } from '@/lib/zones';

type Step = 1 | 2 | 3 | 4;

const RACE_OPTIONS = [
  { value: 'marathon', label: 'Marathon', km: 42.195 },
  { value: 'halfMarathon', label: 'Semi-Marathon', km: 21.1 },
  { value: '10k', label: '10 km', km: 10 },
  { value: '5k', label: '5 km', km: 5 },
] as const;

const STEP_LABELS = ['Objectif', 'Temps', 'Volume', 'Garmin'];

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
  const [showWelcome, setShowWelcome] = useState(true);
  const [step, setStep] = useState<Step>(1);

  useEffect(() => {
    if (searchParams.get('force') === '1') {
      setShowWelcome(false);
      return;
    }
    const existing = loadPlan();
    if (existing) router.replace('/');
  }, [router, searchParams]);

  const [goalRace, setGoalRace] = useState<UserProfile['goalRace']>('marathon');
  const [goalDate, setGoalDate] = useState('');
  const [goalHours, setGoalHours] = useState('3');
  const [goalMinutes, setGoalMinutes] = useState('30');
  const [thresholdInput, setThresholdInput] = useState('');
  const [useManualThreshold, setUseManualThreshold] = useState(false);
  const [weeklyKm, setWeeklyKm] = useState('40');
  const [maxHR, setMaxHR] = useState('');

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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < 3) { setStep((s) => (s + 1) as Step); return; }
    if (step === 3) {
      setIsSubmitting(true);
      const goalTimeMin = timeToMinutes(goalHours, goalMinutes);
      const profile: UserProfile = {
        goalRace,
        goalDate,
        goalTimeMin,
        weeklyKm: parseFloat(weeklyKm) || 40,
        thresholdPaceSec: getEstimatedThreshold(),
        ...(maxHR ? { maxHR: parseInt(maxHR) } : {}),
      };
      saveProfile(profile);
      const plan = generatePlan(profile);
      savePlan(plan);
      const userId = loadUserId() ?? plan.id;
      saveUserId(userId);
      fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan }),
      }).catch(() => {});
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

  if (showWelcome) {
    return (
      <div className="min-h-screen bg-[#0F0F10] relative overflow-hidden flex flex-col">
        {/* Hero image */}
        <div className="absolute inset-0">
          <Image
            src="/hero-running.jpg"
            alt="Running"
            fill
            style={{ objectFit: 'cover', objectPosition: 'center 30%' }}
            priority
          />
          {/* Gradient: transparent top → dark bottom */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-[#0F0F10]" />
        </div>

        {/* Content anchored at bottom */}
        <div className="relative flex-1 flex flex-col justify-end px-6 pb-14 max-w-md mx-auto w-full">
          <p className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.2em] mb-3">
            Campus Coach
          </p>
          <h1 className="text-[38px] font-black text-white leading-[1.1] mb-3">
            Ton plan<br />running<br />sur mesure.
          </h1>
          <p className="text-[14px] text-white/60 mb-10 leading-relaxed">
            Génère un programme personnalisé selon ton objectif et synchronise-le avec ta montre Garmin.
          </p>
          <button
            onClick={() => setShowWelcome(false)}
            className="w-full h-14 bg-white text-[#0F0F10] rounded-full text-[15px] font-bold tracking-tight transition-all active:scale-[0.97]"
          >
            Commencer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col">
      {/* Top bar */}
      <div className="max-w-md mx-auto w-full px-4 pt-16 pb-6">
        <h1 className="text-[28px] font-black text-[#0F0F10] tracking-tight mb-1">Campus Coach</h1>
        <p className="text-[13px] text-[#8E8E93]">Crée ton plan d&apos;entraînement personnalisé</p>

        {/* Step pills */}
        <div className="flex gap-2 mt-6">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <div className={`h-1 rounded-full transition-all ${
                  step > s ? 'bg-[#C8E635]' : step === s ? 'bg-[#0F0F10]' : 'bg-[#E5E5EA]'
                }`} />
                <p className={`text-[10px] font-semibold mt-1.5 transition-colors ${
                  step === s ? 'text-[#0F0F10]' : 'text-[#8E8E93]'
                }`}>{STEP_LABELS[s - 1]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 max-w-md mx-auto w-full px-4 pb-10">
        {step < 4 ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-[24px] bg-white border border-black/5 p-6">
              {/* Step 1 */}
              {step === 1 && (
                <div>
                  <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-1">Étape 1</p>
                  <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Ton objectif</h2>
                  <p className="text-[13px] text-[#8E8E93] mb-5">Quelle course vises-tu ?</p>
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {RACE_OPTIONS.map((race) => (
                      <button
                        key={race.value}
                        type="button"
                        onClick={() => setGoalRace(race.value)}
                        className={`p-4 rounded-[16px] text-left transition-all active:scale-[0.97] ${
                          goalRace === race.value
                            ? 'bg-[#0F0F10] text-white'
                            : 'bg-[#F2F2F7] text-[#0F0F10]'
                        }`}
                      >
                        <p className={`text-[15px] font-bold mb-0.5 ${goalRace === race.value ? 'text-white' : 'text-[#0F0F10]'}`}>
                          {race.label}
                        </p>
                        <p className={`text-[11px] ${goalRace === race.value ? 'text-white/60' : 'text-[#8E8E93]'}`}>
                          {race.km} km
                        </p>
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                      Date de la course
                    </label>
                    <input
                      type="date"
                      value={goalDate}
                      onChange={(e) => setGoalDate(e.target.value)}
                      required
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10"
                    />
                  </div>
                </div>
              )}

              {/* Step 2 */}
              {step === 2 && (
                <div>
                  <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-1">Étape 2</p>
                  <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Temps visé</h2>
                  <p className="text-[13px] text-[#8E8E93] mb-5">Quel temps vises-tu sur {selectedRace.label} ?</p>
                  <div className="flex gap-3 mb-4">
                    <div className="flex-1">
                      <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Heures</label>
                      <input
                        type="number"
                        value={goalHours}
                        onChange={(e) => setGoalHours(e.target.value)}
                        min="0" max="10"
                        className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[15px] font-bold text-[#0F0F10] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10 tabular-nums"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">Minutes</label>
                      <input
                        type="number"
                        value={goalMinutes}
                        onChange={(e) => setGoalMinutes(e.target.value)}
                        min="0" max="59"
                        className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[15px] font-bold text-[#0F0F10] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10 tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="bg-[#C8E635]/15 rounded-[14px] p-4 mb-4">
                    <p className="text-[11px] text-[#8E8E93] uppercase tracking-[0.08em] font-semibold mb-1">Allure seuil estimée</p>
                    <p className="text-[22px] font-black text-[#0F0F10] tabular-nums">{formatPace(estimatedThreshold)}<span className="text-[13px] font-medium text-[#8E8E93] ml-1">/km</span></p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUseManualThreshold(!useManualThreshold)}
                    className="text-[12px] text-[#8E8E93] underline underline-offset-2 mb-3 block"
                  >
                    {useManualThreshold ? 'Utiliser le calcul automatique' : 'Saisir mon allure seuil manuellement'}
                  </button>
                  {useManualThreshold && (
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                        Allure seuil (mm:ss /km)
                      </label>
                      <input
                        type="text"
                        placeholder="ex: 4:30"
                        value={thresholdInput}
                        onChange={(e) => setThresholdInput(e.target.value)}
                        pattern="[0-9]+:[0-5][0-9]"
                        className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 */}
              {step === 3 && (
                <div>
                  <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-1">Étape 3</p>
                  <h2 className="text-[22px] font-black text-[#0F0F10] mb-1">Volume actuel</h2>
                  <p className="text-[13px] text-[#8E8E93] mb-5">Combien de km cours-tu par semaine ?</p>
                  <div className="mb-4">
                    <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                      Km par semaine
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={weeklyKm}
                        onChange={(e) => setWeeklyKm(e.target.value)}
                        min="5" max="200" required
                        className="w-full px-4 py-3 pr-12 bg-[#F2F2F7] rounded-[14px] text-[15px] font-bold text-[#0F0F10] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10 tabular-nums"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-[#8E8E93]">km</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mb-5">
                    {[20, 40, 60, 80].map((km) => (
                      <button
                        key={km}
                        type="button"
                        onClick={() => setWeeklyKm(String(km))}
                        className={`py-2.5 rounded-[12px] text-[13px] font-semibold transition-all active:scale-[0.95] ${
                          weeklyKm === String(km)
                            ? 'bg-[#0F0F10] text-white'
                            : 'bg-[#F2F2F7] text-[#0F0F10]'
                        }`}
                      >
                        {km}
                      </button>
                    ))}
                  </div>
                  <div className="mb-4">
                    <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                      FC max <span className="normal-case font-normal">(optionnel)</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={maxHR}
                        onChange={(e) => setMaxHR(e.target.value)}
                        min="120" max="220"
                        placeholder="ex : 185"
                        className="w-full px-4 py-3 pr-14 bg-[#F2F2F7] rounded-[14px] text-[15px] font-bold text-[#0F0F10] placeholder:font-normal placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10 tabular-nums"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-[#8E8E93]">bpm</span>
                    </div>
                    <p className="text-[11px] text-[#8E8E93] mt-1.5">Permet d&apos;afficher des cibles BPM précises par séance</p>
                  </div>

                  <div className="rounded-[14px] bg-[#F2F2F7] p-4">
                    <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-2">Récapitulatif</p>
                    <p className="text-[13px] text-[#0F0F10] font-medium">
                      {RACE_OPTIONS.find((r) => r.value === goalRace)?.label}
                    </p>
                    <p className="text-[11px] text-[#8E8E93] mt-0.5">
                      {new Date(goalDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-[11px] text-[#8E8E93]">
                      Allure seuil {formatPace(estimatedThreshold)}/km · {weeklyKm} km/sem
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation */}
            <div className="flex gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s - 1) as Step)}
                  className="w-12 h-12 rounded-[14px] bg-white border border-black/8 flex items-center justify-center flex-shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 2L4 7l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting || (step === 1 && !goalDate)}
                className="flex-1 h-12 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:opacity-40 transition-all active:scale-[0.98]"
              >
                {isSubmitting ? 'Génération...' : 'Continuer'}
              </button>
            </div>
          </form>
        ) : (
          /* Step 4 — Garmin */
          <div className="space-y-3">
            <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
              {garminConnected ? (
                <div className="p-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-[#C8E635]/20 flex items-center justify-center mx-auto mb-4">
                    <svg width="28" height="22" viewBox="0 0 28 22" fill="none">
                      <path d="M2 11l7 7L26 2" stroke="#0F0F10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <h2 className="text-[18px] font-black text-[#0F0F10] mb-1">Garmin connecté !</h2>
                  <p className="text-[13px] text-[#8E8E93]">
                    Tes séances seront synchronisées avec Garmin Connect.
                    La connexion est mémorisée 30 jours.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[#F2F2F7]">
                    <div className="w-10 h-10 rounded-[14px] bg-[#C8E635]/20 flex items-center justify-center text-[#0F0F10] font-black text-lg">G</div>
                    <div>
                      <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.15em] mb-0.5">Étape 4</p>
                      <h2 className="text-[16px] font-black text-[#0F0F10]">Connecte Garmin</h2>
                    </div>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {garminError && (
                      <div className="rounded-[14px] bg-red-50 border border-red-100 p-3">
                        <p className="text-[12px] text-red-600">{garminError}</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                        Email Garmin Connect
                      </label>
                      <input
                        type="email"
                        value={garminEmail}
                        onChange={(e) => setGarminEmail(e.target.value)}
                        placeholder="ton@email.com"
                        className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                        Mot de passe
                      </label>
                      <input
                        type="password"
                        value={garminPassword}
                        onChange={(e) => setGarminPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10"
                      />
                    </div>
                    <p className="text-[11px] text-[#8E8E93]">
                      Ton mot de passe n&apos;est jamais stocké — seuls les tokens OAuth, valables 30 jours.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {!garminConnected && (
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="flex-1 h-12 rounded-[14px] bg-white border border-black/8 text-[13px] font-semibold text-[#8E8E93] transition-all active:scale-[0.98]"
                >
                  Passer
                </button>
              )}
              <button
                type="button"
                onClick={garminConnected ? () => router.push('/') : handleGarminConnect}
                disabled={garminLoading || (!garminConnected && (!garminEmail || !garminPassword))}
                className="flex-1 h-12 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:opacity-40 transition-all active:scale-[0.98]"
              >
                {garminConnected ? 'Commencer' : garminLoading ? 'Connexion...' : 'Se connecter'}
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
