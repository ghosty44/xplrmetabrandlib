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

  return (
    <div className="flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className="h-1 w-full shrink-0" style={{ background: brandColor }} />

      <div className="flex flex-col gap-2 p-4 flex-1">
        {body && (
          <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">
            {body}
          </p>
        )}
        {title && (
          <p className="text-sm font-semibold text-gray-900 line-clamp-2">
            {title}
          </p>
        )}
        {desc && (
          <p className="text-xs text-gray-500 line-clamp-1">{desc}</p>
        )}
      </div>

      <div className="flex items-center justify-between px-4 pb-4 pt-0 gap-2">
        <div className="flex items-center gap-3 text-xs text-gray-400 min-w-0">
          {date && <span>{date}</span>}
          {imp && (
            <span className="flex items-center gap-1">
              <Eye size={10} />
              {imp}
            </span>
          )}
        </div>

        {ad.ad_snapshot_url && (
          <a
            href={ad.ad_snapshot_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0"
          >
            <ExternalLink size={12} />
            Voir
          </a>
        )}
      </div>
    </div>
  );
}
