"use client";

import { useEffect, useMemo, useState } from "react";
import type { NotionBrand } from "@/lib/notion";
import BrandList from "@/components/BrandList";
import AdsPanel from "@/components/AdsPanel";

export default function Home() {
  const [brands, setBrands] = useState<NotionBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<NotionBrand | null>(null);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data: unknown) => {
        const list = Array.isArray(data) ? (data as NotionBrand[]) : [];
        setBrands(list);
        if (list.length > 0) setSelected(list[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => [...new Set(brands.map((b) => b.category).filter(Boolean))].sort(),
    [brands]
  );

  const filtered = useMemo(
    () =>
      brands.filter((b) => {
        const matchSearch =
          !search || b.name.toLowerCase().includes(search.toLowerCase());
        const matchCategory =
          !selectedCategory || b.category === selectedCategory;
        return matchSearch && matchCategory;
      }),
    [brands, search, selectedCategory]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <div className="w-64 shrink-0 flex flex-col h-full">
        {loading ? (
          <div className="flex items-center justify-center flex-1 text-gray-400 text-sm">
            Chargement…
          </div>
        ) : (
          <BrandList
            brands={filtered}
            selected={selected}
            onSelect={setSelected}
            search={search}
            onSearch={setSearch}
            categories={categories}
            selectedCategory={selectedCategory}
            onCategory={setSelectedCategory}
          />
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {selected ? (
          <AdsPanel key={selected.id} brand={selected} />
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 text-gray-400">
            <span className="text-4xl">👈</span>
            <p className="text-sm">Sélectionne une marque</p>
          </div>
        )}
      </div>
    </div>
  );
}
