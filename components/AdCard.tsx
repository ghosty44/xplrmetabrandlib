"use client";

import type { MetaAd } from "@/lib/meta";
import { Eye, ExternalLink } from "lucide-react";

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
  const body = ad.ad_creative_bodies?.[0];
  const title = ad.ad_creative_link_titles?.[0];
  const desc = ad.ad_creative_link_descriptions?.[0];
  const imp = formatImpressions(ad.impressions);
  const date = formatDate(ad.ad_delivery_start_time);
  const isMock = ad.id.startsWith("mock_");

  return (
    <div className="flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
      {/* Color bar */}
      <div className="h-1 w-full shrink-0" style={{ background: brandColor }} />

      {/* Creative placeholder */}
      <div
        className="relative flex items-center justify-center mx-4 mt-4 rounded-lg overflow-hidden"
        style={{ height: 160, background: `${brandColor}12` }}
      >
        {/* Decorative background pattern */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, ${brandColor} 0, ${brandColor} 1px, transparent 0, transparent 50%)`,
            backgroundSize: "12px 12px",
          }}
        />
        {/* Preview button */}
        {ad.ad_snapshot_url && !isMock ? (
          <a
            href={ad.ad_snapshot_url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 flex flex-col items-center gap-2 px-5 py-3 rounded-lg text-white text-sm font-medium opacity-80 group-hover:opacity-100 transition-opacity"
            style={{ background: brandColor }}
          >
            <ExternalLink size={18} />
            Voir le visuel
          </a>
        ) : (
          <span className="relative z-10 text-3xl opacity-40 select-none">📢</span>
        )}
      </div>

      {/* Text content */}
      <div className="flex flex-col gap-2 px-4 pt-3 pb-2 flex-1">
        {body && (
          <p className="text-sm text-gray-700 leading-relaxed line-clamp-3">
            {body}
          </p>
        )}
        {title && (
          <p className="text-sm font-semibold text-gray-900 line-clamp-1 border-t border-gray-50 pt-2">
            {title}
          </p>
        )}
        {desc && (
          <p className="text-xs text-gray-400 line-clamp-1">{desc}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {date && <span>{date}</span>}
          {imp && (
            <span className="flex items-center gap-1">
              <Eye size={10} />
              {imp}
            </span>
          )}
        </div>
        {isMock && (
          <span className="text-xs text-amber-500 font-medium">démo</span>
        )}
      </div>
    </div>
  );
}
