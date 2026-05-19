"use client";

import { useEffect, useState } from "react";
import type { NotionBrand } from "@/lib/notion";
import type { MetaAd } from "@/lib/meta";
import AdCard from "./AdCard";
import { ExternalLink, RefreshCw } from "lucide-react";

interface Props {
  brand: NotionBrand;
}

function metaAdsUrl(metaPageId: string) {
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=FR&search_type=page&view_all_page_id=${metaPageId}`;
}

export default function AdsPanel({ brand }: Props) {
  const [ads, setAds] = useState<MetaAd[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hue =
    brand.name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const color = `hsl(${hue}, 65%, 50%)`;
  const bgLight = `hsl(${hue}, 60%, 96%)`;

  useEffect(() => {
    if (!brand.metaPageId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAds([]);

    fetch(`/api/ads?pageId=${brand.metaPageId}`)
      .then(async (r) => {
        const data = await r.json();
        if (!cancelled) {
          if (!r.ok) {
            const msg = data?.metaError?.message ?? data?.error ?? `Erreur ${r.status}`;
            setError(`Meta API : ${msg}`);
          } else {
            setAds(Array.isArray(data) ? data : []);
          }
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
  }, [brand.metaPageId]);

  return (
    <div className="flex flex-col h-full min-h-0">
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
            {brand.category && (
              <p className="text-xs text-gray-500 mt-0.5">{brand.category}</p>
            )}
          </div>
        </div>

        {brand.metaPageId && (
          <a
            href={metaAdsUrl(brand.metaPageId)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-current text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <ExternalLink size={12} />
            Meta Ads Library
          </a>
        )}
      </div>

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

        {!loading && !error && ads.length === 0 && brand.metaPageId && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
            <span className="text-3xl">📭</span>
            <p className="text-sm">Aucune publicité trouvée.</p>
          </div>
        )}

        {!loading && !error && !brand.metaPageId && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
            <span className="text-3xl">🔗</span>
            <p className="text-sm">Pas d&apos;ID de page Meta configuré.</p>
          </div>
        )}

        {ads.length > 0 && (
          <>
            <p className="text-xs text-gray-400 mb-4">
              {ads.length} publicité{ads.length > 1 ? "s" : ""}
              {ads[0].id.startsWith("mock_") && (
                <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded text-xs font-medium">
                  données de démo — configurez META_ACCESS_TOKEN pour le live
                </span>
              )}
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
