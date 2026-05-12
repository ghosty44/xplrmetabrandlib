"use client";

import { Brand } from "@/types/brand";
import { ExternalLink } from "lucide-react";

interface Props {
  brand: Brand;
}

export default function BrandCard({ brand }: Props) {
  const initial = brand.name.charAt(0).toUpperCase();

  // Deterministic pastel color from brand name
  const hue = brand.name
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const bg = `hsl(${hue}, 60%, 92%)`;
  const fg = `hsl(${hue}, 50%, 35%)`;

  return (
    <div className="group relative flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      {/* Header band */}
      <div
        className="flex items-center justify-center h-24"
        style={{ background: bg }}
      >
        <span
          className="text-4xl font-bold select-none"
          style={{ color: fg }}
        >
          {initial}
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-4 flex-1">
        <h2 className="font-semibold text-gray-900 text-base leading-tight">
          {brand.name}
        </h2>

        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
            {brand.secteur}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {brand.categorie}
          </span>
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 pb-4">
        <a
          href={brand.metaAdsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2 px-4 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <ExternalLink size={14} />
          Voir les pubs Meta
        </a>
      </div>
    </div>
  );
}
