"use client";

import type { NotionBrand } from "@/lib/notion";

interface Props {
  brands: NotionBrand[];
  selected: NotionBrand | null;
  onSelect: (b: NotionBrand) => void;
  search: string;
  onSearch: (v: string) => void;
  categories: string[];
  selectedCategory: string;
  onCategory: (v: string) => void;
}

export default function BrandList({
  brands,
  selected,
  onSelect,
  search,
  onSearch,
  categories,
  selectedCategory,
  onCategory,
}: Props) {
  return (
    <div className="flex flex-col h-full min-h-0 border-r border-gray-100 bg-white">
      <div className="px-4 pt-4 pb-3 shrink-0 border-b border-gray-100">
        <h1 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
          <span>📡</span> Meta Brands
        </h1>

        <input
          type="text"
          placeholder="Rechercher…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
        />

        <select
          value={selectedCategory}
          onChange={(e) => onCategory(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tous les secteurs</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {brands.length === 0 && (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            Aucune marque
          </p>
        )}
        {brands.map((brand) => {
          const hue =
            brand.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) %
            360;
          const color = `hsl(${hue}, 65%, 50%)`;
          const isActive = selected?.id === brand.id;

          return (
            <button
              key={brand.id}
              onClick={() => onSelect(brand)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                isActive
                  ? "bg-blue-50 border-r-2 border-blue-500"
                  : "hover:bg-gray-50"
              }`}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ background: color }}
              >
                {brand.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <p
                  className={`text-sm font-medium truncate ${
                    isActive ? "text-blue-700" : "text-gray-800"
                  }`}
                >
                  {brand.name}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {brand.category || "—"}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 shrink-0">
        <p className="text-xs text-gray-400">
          {brands.length} marque{brands.length !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}
