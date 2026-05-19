"use client";

import { useEffect, useState } from "react";
import { Brand, MetaAd } from "@/types/brand";
import AdCard from "./AdCard";
import { ExternalLink, RefreshCw } from "lucide-react";

interface Props {
  brand: Brand;
}

export default function AdsPanel({ brand }: Props) {
  const [ads, setAds] = useState<MetaAd[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deterministic pastel from brand name
  const hue = brand.name
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const color = `hsl(${hue}, 65%, 50%)`;
  const bgLight = `hsl(${hue}, 60%, 96%)`;

  useEffect(() => {
    if (!brand.pageId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAds([]);

    fetch(`/api/ads?pageId=${brand.pageId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setAds(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Impossible de charger les publicités.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [brand.pageId]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Brand header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0"
        style={{ background: bgLight }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-base shrink-0"
            style={{ background: color }}
          >
            {brand.name.charAt(0)}
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 text-base leading-tight">
              {brand.name}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-gray-500">{brand.secteur}</span>
              <span className="text-gray-300">·</span>
              <span className="text-xs text-gray-500">{brand.categorie}</span>
            </div>
          </div>
        </div>

        <a
          href={brand.metaAdsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-current text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <ExternalLink size={12} />
          Meta Ads Library
        </a>
      </div>

      {/* Ads grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <div className="flex items-center justify-center h-40 gap-2 text-gray-400 text-sm">
            <RefreshCw size={14} className="animate-spin" />
            Chargement des publicités…
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-40 text-red-500 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && ads.length === 0 && brand.pageId && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
            <span className="text-3xl">📭</span>
            <p className="text-sm">Aucune publicité trouvée.</p>
          </div>
        )}

        {!loading && !error && !brand.pageId && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
            <span className="text-3xl">🔗</span>
            <p className="text-sm">Pas d&apos;ID de page Meta configuré.</p>
          </div>
        )}

        {ads.length > 0 && (
          <>
            <p className="text-xs text-gray-400 mb-4">
              {ads.length} publicité{ads.length > 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {ads.map((ad) => (
                <AdCard key={ad.id} ad={ad} brandColor={color} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
