"use client";

import { Search, X } from "lucide-react";

interface Props {
  search: string;
  onSearch: (v: string) => void;
  secteurs: string[];
  selectedSecteur: string;
  onSecteur: (v: string) => void;
  categories: string[];
  selectedCategorie: string;
  onCategorie: (v: string) => void;
  total: number;
  filtered: number;
}

export default function FilterBar({
  search,
  onSearch,
  secteurs,
  selectedSecteur,
  onSecteur,
  categories,
  selectedCategorie,
  onCategorie,
  total,
  filtered,
}: Props) {
  const hasFilters = search || selectedSecteur || selectedCategorie;

  function reset() {
    onSearch("");
    onSecteur("");
    onCategorie("");
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          placeholder="Rechercher une marque…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedSecteur}
          onChange={(e) => onSecteur(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tous les secteurs</option>
          {secteurs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={selectedCategorie}
          onChange={(e) => onCategorie(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Toutes les catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          >
            <X size={14} />
            Réinitialiser
          </button>
        )}

        <span className="ml-auto text-sm text-gray-400">
          {filtered === total ? (
            <>{total} marques</>
          ) : (
            <>
              {filtered} / {total} marques
            </>
          )}
        </span>
      </div>
    </div>
  );
}
