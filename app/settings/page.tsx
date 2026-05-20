'use client';

import { useEffect, useState, FormEvent, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { saveGarminTokens, loadGarminTokens, clearGarminTokens, garminTokensExpiresAt, GarminTokens } from '@/lib/store';

export default function SettingsPage() {
  const router = useRouter();
  const [tokens, setTokens] = useState<GarminTokens | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleReset = useCallback(() => {
    if (!confirmReset) { setConfirmReset(true); return; }
    router.push('/setup?force=1');
  }, [confirmReset, router]);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setTokens(loadGarminTokens());
    setExpiresAt(garminTokensExpiresAt());
  }, []);

  const handleConnect = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/garmin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { success: boolean; tokens?: GarminTokens; error?: string };
      if (data.success && data.tokens) {
        saveGarminTokens(data.tokens);
        setTokens(data.tokens);
        setExpiresAt(garminTokensExpiresAt());
        setSuccess(true);
        setEmail('');
        setPassword('');
      } else {
        setError(data.error ?? 'Erreur de connexion');
      }
    } catch {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    clearGarminTokens();
    setTokens(null);
    setExpiresAt(null);
    setSuccess(false);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <header className="sticky top-0 z-10 bg-[#F2F2F7]/80 backdrop-blur-xl">
        <div className="max-w-md mx-auto px-4 pt-12 pb-3 flex items-center gap-3">
          <Link
            href="/"
            className="w-8 h-8 rounded-full bg-white border border-black/8 flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="#0F0F10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <h1 className="text-[17px] font-bold text-[#0F0F10]">Paramètres</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-32 space-y-3">
        {/* Garmin card */}
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
                {success && (
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
                {error && (
                  <div className="rounded-[14px] bg-red-50 border border-red-100 p-3">
                    <p className="text-[12px] text-red-600">{error}</p>
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
                  disabled={loading}
                  className="w-full py-3.5 rounded-[14px] bg-[#0F0F10] text-white text-[13px] font-semibold disabled:opacity-50 transition-all active:scale-[0.98]"
                >
                  {loading ? 'Connexion...' : 'Se connecter à Garmin'}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Training plan card */}
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
      </main>
    </div>
  );
}
