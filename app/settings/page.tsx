'use client';

import { useEffect, useState, FormEvent, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { saveGarminTokens, loadGarminTokens, clearGarminTokens, garminTokensExpiresAt, GarminTokens, loadPlan, savePlan, saveShoes, saveGarminUserId } from '@/lib/store';
import { generatePlan } from '@/lib/plan';
import { Shoe } from '@/lib/types';

type Tab = 'garmin' | 'vma' | 'plan';

function calcVMA(distM: number): { vmaKmh: number; thresholdSec: number; thresholdPace: string } {
  const vmaKmh = distM / 100;
  const vmaMs = vmaKmh * 1000 / 3600;
  const thresholdMs = vmaMs * 0.875;
  const thresholdSec = Math.round(1000 / thresholdMs);
  const min = Math.floor(thresholdSec / 60);
  const sec = thresholdSec % 60;
  return { vmaKmh, thresholdSec, thresholdPace: `${min}'${sec.toString().padStart(2, '0')}''` };
}

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('garmin');

  // Garmin state
  const [tokens, setTokens] = useState<import('@/lib/store').GarminTokens | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState<string | null>(null);
  const [garminSuccess, setGarminSuccess] = useState(false);

  // VMA state
  const [vmaMethod, setVmaMethod] = useState<'cooper' | 'direct'>('cooper');
  const [distInput, setDistInput] = useState('');
  const [directVma, setDirectVma] = useState('');
  const [vmaResult, setVmaResult] = useState<{ vmaKmh: number; thresholdSec: number; thresholdPace: string } | null>(null);
  const [vmaApplied, setVmaApplied] = useState(false);

  // Plan reset state
  const [confirmReset, setConfirmReset] = useState(false);

  const handleReset = useCallback(() => {
    if (!confirmReset) { setConfirmReset(true); return; }
    router.push('/setup?force=1');
  }, [confirmReset, router]);

  useEffect(() => {
    setTokens(loadGarminTokens());
    setExpiresAt(garminTokensExpiresAt());
  }, []);

  const handleConnect = async (e: FormEvent) => {
    e.preventDefault();
    setGarminLoading(true);
    setGarminError(null);
    setGarminSuccess(false);
    try {
      const res = await fetch('/api/garmin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { success: boolean; tokens?: GarminTokens; garminUserId?: string; error?: string };
      if (data.success && data.tokens) {
        saveGarminTokens(data.tokens);
        setTokens(data.tokens);
        setExpiresAt(garminTokensExpiresAt());
        // Save stable Garmin ID and reload persisted data from DB
        if (data.garminUserId) {
          saveGarminUserId(data.garminUserId as string);
          try {
            const dbRes = await fetch(`/api/profile?userId=${encodeURIComponent(data.garminUserId as string)}`);
            const dbData = await dbRes.json() as { plan?: import('@/lib/types').TrainingPlan | null; shoes?: Shoe[] };
            if (dbData.plan) savePlan(dbData.plan);
            if (dbData.shoes?.length) saveShoes(dbData.shoes);
          } catch { /* non-fatal */ }
        }
        setGarminSuccess(true);
        setEmail('');
        setPassword('');
      } else {
        setGarminError(data.error ?? 'Erreur de connexion');
      }
    } catch {
      setGarminError('Erreur réseau');
    } finally {
      setGarminLoading(false);
    }
  };

  const handleDisconnect = () => {
    clearGarminTokens();
    setTokens(null);
    setExpiresAt(null);
    setGarminSuccess(false);
    setGarminError(null);
  };

  const handleCalcVma = () => {
    if (vmaMethod === 'cooper') {
      const d = parseFloat(distInput);
      if (!d || d < 500 || d > 4000) return;
      setVmaResult(calcVMA(d));
    } else {
      const v = parseFloat(directVma);
      if (!v || v < 8 || v > 30) return;
      const vmaMs = v * 1000 / 3600;
      const thresholdMs = vmaMs * 0.875;
      const thresholdSec = Math.round(1000 / thresholdMs);
      const min = Math.floor(thresholdSec / 60);
      const sec = thresholdSec % 60;
      setVmaResult({ vmaKmh: v, thresholdSec, thresholdPace: `${min}'${sec.toString().padStart(2, '0')}''` });
    }
    setVmaApplied(false);
  };

  const handleApplyVma = () => {
    if (!vmaResult) return;
    const plan = loadPlan();
    if (!plan) return;
    const updated = generatePlan({ ...plan.profile, thresholdPaceSec: vmaResult.thresholdSec });
    updated.id = plan.id;
    updated.createdAt = plan.createdAt;
    savePlan(updated);
    setVmaApplied(true);
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'garmin', label: 'Garmin' },
    { id: 'vma', label: 'Test VMA' },
    { id: 'plan', label: 'Plan' },
  ];

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <main className="max-w-md mx-auto px-4 pt-14 pb-32 space-y-3">
        <h1 className="text-[28px] font-black text-[#0F0F10] tracking-tight px-1 pb-1">Réglages</h1>

        {/* Tab bar */}
        <div className="flex gap-1.5 p-1 bg-white rounded-[16px] border border-black/5">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-2.5 rounded-[12px] text-[13px] font-semibold transition-all ${
                tab === id
                  ? 'bg-[#0F0F10] text-white'
                  : 'text-[#8E8E93]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Garmin tab */}
        {tab === 'garmin' && (
          <div className="rounded-[24px] bg-white border border-black/5 overflow-hidden">
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[#F2F2F7]">
              <div className="w-10 h-10 rounded-[14px] bg-[#C8E635]/20 flex items-center justify-center text-[#0F0F10] font-black text-lg">
                G
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-semibold text-[#0F0F10]">Garmin Connect</p>
                <p className="text-[11px] text-[#8E8E93]">Synchronisez vos séances vers votre montre</p>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                tokens
                  ? 'bg-[#C8E635]/20 text-[#0F0F10]'
                  : 'bg-[#F2F2F7] text-[#8E8E93]'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tokens ? 'bg-[#C8E635]' : 'bg-[#8E8E93]'}`} />
                {tokens ? 'Connecté' : 'Non connecté'}
              </span>
            </div>

            <div className="px-5 py-4">
              {tokens ? (
                <div className="space-y-3">
                  {garminSuccess && (
                    <div className="rounded-[14px] bg-[#C8E635]/15 border border-[#C8E635]/30 p-3">
                      <p className="text-[12px] font-semibold text-[#0F0F10]">✓ Compte Garmin connecté</p>
                      <p className="text-[11px] text-[#8E8E93] mt-0.5">Seuls les tokens de session sont stockés.</p>
                    </div>
                  )}
                  <p className="text-[13px] text-[#8E8E93]">
                    Votre compte Garmin est connecté. Les séances se synchroniseront avec votre session active.
                  </p>
                  {expiresAt && (
                    <p className="text-[11px] text-[#8E8E93]">
                      Valide jusqu&apos;au{' '}
                      {expiresAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                  <button
                    onClick={handleDisconnect}
                    className="w-full py-3 rounded-[14px] bg-red-50 border border-red-100 text-[13px] font-semibold text-red-600 transition-all active:scale-[0.98]"
                  >
                    Déconnecter
                  </button>
                </div>
              ) : (
                <form onSubmit={handleConnect} className="space-y-3">
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
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
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
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10"
                    />
                  </div>
                  <p className="text-[11px] text-[#8E8E93]">
                    Vos identifiants ne sont jamais stockés — seuls les tokens OAuth sont conservés localement.
                  </p>
                  <button
                    type="submit"
                    disabled={garminLoading}
                    className="w-full py-3.5 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:opacity-50 transition-all active:scale-[0.98]"
                  >
                    {garminLoading ? 'Connexion...' : 'Se connecter à Garmin'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* VMA tab */}
        {tab === 'vma' && (
          <div className="space-y-3">
            <div className="rounded-[24px] bg-white border border-black/5 p-5 space-y-4">
              <div>
                <p className="text-[15px] font-bold text-[#0F0F10] mb-1">Test VMA</p>
                <p className="text-[12px] text-[#8E8E93] leading-relaxed">
                  Mesure ta Vitesse Maximale Aérobie pour calibrer toutes tes zones d&apos;entraînement.
                </p>
              </div>

              {/* Method toggle */}
              <div className="flex gap-1.5 p-1 bg-[#F2F2F7] rounded-[14px]">
                <button
                  onClick={() => { setVmaMethod('cooper'); setVmaResult(null); }}
                  className={`flex-1 py-2 rounded-[10px] text-[12px] font-semibold transition-all ${
                    vmaMethod === 'cooper' ? 'bg-white text-[#0F0F10] shadow-sm' : 'text-[#8E8E93]'
                  }`}
                >
                  Demi-Cooper (6 min)
                </button>
                <button
                  onClick={() => { setVmaMethod('direct'); setVmaResult(null); }}
                  className={`flex-1 py-2 rounded-[10px] text-[12px] font-semibold transition-all ${
                    vmaMethod === 'direct' ? 'bg-white text-[#0F0F10] shadow-sm' : 'text-[#8E8E93]'
                  }`}
                >
                  VMA directe
                </button>
              </div>

              {vmaMethod === 'cooper' ? (
                <div className="space-y-3">
                  <div className="rounded-[16px] bg-[#F2F2F7] p-4 space-y-2">
                    <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em]">Protocole</p>
                    {['Échauffement 10 min à allure EF', 'Course à fond pendant exactement 6 minutes', 'Note la distance parcourue (GPS ou piste)', 'Récupération 10 min'].map((step, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#0F0F10] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                        <p className="text-[12px] text-[#0F0F10]">{step}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                      Distance parcourue (mètres)
                    </label>
                    <input
                      type="number"
                      value={distInput}
                      onChange={(e) => setDistInput(e.target.value)}
                      placeholder="ex : 1650"
                      min={500}
                      max={4000}
                      className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1.5">
                    VMA connue (km/h)
                  </label>
                  <input
                    type="number"
                    value={directVma}
                    onChange={(e) => setDirectVma(e.target.value)}
                    placeholder="ex : 16.5"
                    step="0.5"
                    min={8}
                    max={30}
                    className="w-full px-4 py-3 bg-[#F2F2F7] rounded-[14px] text-[13px] text-[#0F0F10] placeholder:text-[#8E8E93] border-0 outline-none focus:ring-2 focus:ring-[#0F0F10]/10"
                  />
                </div>
              )}

              <button
                onClick={handleCalcVma}
                className="w-full py-3.5 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold transition-all active:scale-[0.98]"
              >
                Calculer ma VMA
              </button>
            </div>

            {vmaResult && (
              <div className="rounded-[24px] bg-white border border-black/5 p-5 space-y-4">
                <p className="text-[13px] font-bold text-[#0F0F10]">Résultat</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[16px] bg-[#C8E635]/15 p-4 text-center">
                    <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1">VMA</p>
                    <p className="text-[28px] font-black text-[#0F0F10] tabular-nums">{vmaResult.vmaKmh.toFixed(1)}</p>
                    <p className="text-[11px] text-[#8E8E93]">km/h</p>
                  </div>
                  <div className="rounded-[16px] bg-[#F2F2F7] p-4 text-center">
                    <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1">Allure seuil</p>
                    <p className="text-[28px] font-black text-[#0F0F10] tabular-nums">{vmaResult.thresholdPace}</p>
                    <p className="text-[11px] text-[#8E8E93]">/km</p>
                  </div>
                </div>
                <p className="text-[11px] text-[#8E8E93] leading-relaxed">
                  L&apos;allure seuil correspond à 87,5% de ta VMA. Elle sera utilisée comme base pour calibrer toutes tes zones d&apos;intensité.
                </p>
                {vmaApplied ? (
                  <div className="rounded-[14px] bg-[#C8E635]/15 border border-[#C8E635]/30 p-3">
                    <p className="text-[12px] font-semibold text-[#0F0F10]">✓ Plan mis à jour avec ta nouvelle VMA</p>
                    <p className="text-[11px] text-[#8E8E93] mt-0.5">Toutes les allures ont été recalculées.</p>
                  </div>
                ) : (
                  <button
                    onClick={handleApplyVma}
                    className="w-full py-3.5 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold transition-all active:scale-[0.98]"
                  >
                    Appliquer au plan d&apos;entraînement
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Plan tab */}
        {tab === 'plan' && (
          <div className="rounded-[24px] bg-white border border-black/5 p-5">
            <p className="text-[13px] font-semibold text-[#0F0F10] mb-1">Plan d&apos;entraînement</p>
            <p className="text-[11px] text-[#8E8E93] mb-3">Crée un nouveau plan — l&apos;actuel sera remplacé.</p>
            <button
              onClick={handleReset}
              onBlur={() => setConfirmReset(false)}
              className={`w-full py-3 rounded-[14px] text-[13px] font-semibold transition-all active:scale-[0.98] ${
                confirmReset
                  ? 'bg-red-500 text-white'
                  : 'bg-[#F2F2F7] text-[#0F0F10]'
              }`}
            >
              {confirmReset ? 'Confirmer — effacer le plan actuel' : 'Reconfigurer mon profil'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
