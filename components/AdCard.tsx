"use client";

import { useState } from "react";
import { MetaAd } from "@/types/brand";
import { Eye } from "lucide-react";

function formatDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatImpressions(imp?: { lower_bound: string; upper_bound: string }) {
  if (!imp) return null;
  const fmt = (n: string) => {
    const v = parseInt(n, 10);
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
    return String(v);
  };
  return `${fmt(imp.lower_bound)} – ${fmt(imp.upper_bound)}`;
}

interface Props {
  ad: MetaAd;
  brandColor: string;
}

export default function AdCard({ ad, brandColor }: Props) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const body = ad.ad_creative_bodies?.[0];
  const title = ad.ad_creative_link_titles?.[0];
  const imp = formatImpressions(ad.impressions);
  const date = formatDate(ad.ad_delivery_start_time);
  const isMock = ad.id.startsWith("mock_");

  return (
    <div className="flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Color accent */}
      <div className="h-1 w-full shrink-0" style={{ background: brandColor }} />

      {/* Ad visual — proxied through /api/snapshot to bypass Meta's X-Frame-Options */}
      {!isMock && ad.ad_snapshot_url && (
        <div className="relative w-full border-b border-gray-100 overflow-hidden bg-gray-100" style={{ height: 320 }}>
          {!iframeLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-gray-300 border-t-gray-500 animate-spin" />
            </div>
          )}
          <iframe
            src={`/api/snapshot?url=${encodeURIComponent(ad.ad_snapshot_url)}`}
            className="w-full h-full border-0"
            loading="lazy"
            onLoad={() => setIframeLoaded(true)}
            title={`Ad ${ad.id}`}
          />
        </div>
      )}

      {/* Text content */}
      <div className="flex flex-col gap-2 p-3 flex-1">
        {body && (
          <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">
            {body}
          </p>
        )}
        {title && (
          <p className="text-xs font-semibold text-gray-800 line-clamp-1">
            {title}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 pb-3 pt-0 gap-2">
        <div className="flex items-center gap-3 text-xs text-gray-400 min-w-0">
          {date && <span>{date}</span>}
          {imp && (
            <span className="flex items-center gap-1">
              <Eye size={10} />
              {imp}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
