"use client";

import { MetaAd } from "@/types/brand";
import { ExternalLink, Eye } from "lucide-react";

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
    <div className="flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Color band */}
      <div
        className="h-1.5 w-full"
        style={{ background: brandColor }}
      />

      <div className="flex flex-col gap-3 p-4 flex-1">
        {/* Body text */}
        {body && (
          <p className="text-sm text-gray-800 leading-relaxed line-clamp-4">
            {body}
          </p>
        )}

        {/* Link preview */}
        {(title || desc) && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
            {title && (
              <p className="text-xs font-semibold text-gray-800 line-clamp-1">
                {title}
              </p>
            )}
            {desc && (
              <p className="text-xs text-gray-500 line-clamp-1">{desc}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 pb-3 pt-1 gap-2">
        <div className="flex items-center gap-3 text-xs text-gray-400 min-w-0">
          {date && <span>Depuis le {date}</span>}
          {imp && (
            <span className="flex items-center gap-1">
              <Eye size={11} />
              {imp}
            </span>
          )}
        </div>

        {ad.ad_snapshot_url && !isMock && (
          <a
            href={ad.ad_snapshot_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Voir
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}
