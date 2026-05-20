'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { saveGarminTokens, loadGarminTokens, clearGarminTokens, GarminTokens } from '@/lib/store';

export default function SettingsPage() {
  const [tokens, setTokens] = useState<GarminTokens | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setTokens(loadGarminTokens());
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
    setSuccess(false);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-gray-600 text-sm"
          >
            ←
          </Link>
          <h1 className="text-base font-bold text-gray-900">Paramètres</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
              G
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Garmin Connect</h2>
              <p className="text-xs text-gray-500">Synchronisez vos séances vers votre montre</p>
            </div>
            <div className="ml-auto">
              {tokens ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Connecté
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 text-xs font-medium rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  Non connecté
                </span>
              )}
            </div>
          </div>

          {tokens ? (
            <div className="space-y-3">
              {success && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-sm text-green-700 font-medium">✓ Compte Garmin connecté avec succès</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    Vos identifiants ne sont pas stockés — seulement les tokens de session.
                  </p>
                </div>
              )}
              <p className="text-sm text-gray-600">
                Votre compte Garmin est connecté. Les prochaines synchronisations utiliseront votre session active.
              </p>
              <button
                onClick={handleDisconnect}
                className="w-full py-2.5 px-4 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Déconnecter
              </button>
            </div>
          ) : (
            <form onSubmit={handleConnect} className="space-y-3">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Email Garmin Connect
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="ton@email.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Mot de passe
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-400">
                Vos identifiants sont envoyés de façon sécurisée et ne sont jamais stockés — seuls les tokens de session OAuth sont conservés localement.
              </p>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Connexion en cours...' : 'Se connecter à Garmin'}
              </button>
            </form>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Plan d&apos;entraînement</h2>
          <Link
            href="/setup"
            className="block w-full py-2.5 px-4 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors text-center"
          >
            Reconfigurer mon profil
          </Link>
        </div>
      </main>
    </div>
  );
}
