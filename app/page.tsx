"use client";

import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/types/brand";
import BrandCard from "@/components/BrandCard";
import FilterBar from "@/components/FilterBar";

export default function Home() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedSecteur, setSelectedSecteur] = useState("");
  const [selectedCategorie, setSelectedCategorie] = useState("");

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data) => {
        setBrands(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Impossible de charger les marques.");
        setLoading(false);
      });
  }, []);

  const secteurs = useMemo(
    () => [...new Set(brands.map((b) => b.secteur).filter(Boolean))].sort(),
    [brands]
  );

  const categories = useMemo(() => {
    const base = brands.filter(
      (b) => !selectedSecteur || b.secteur === selectedSecteur
    );
    return [...new Set(base.map((b) => b.categorie).filter(Boolean))].sort();
  }, [brands, selectedSecteur]);

  const filtered = useMemo(() => {
    return brands.filter((b) => {
      const matchSearch =
        !search || b.name.toLowerCase().includes(search.toLowerCase());
      const matchSecteur = !selectedSecteur || b.secteur === selectedSecteur;
      const matchCat = !selectedCategorie || b.categorie === selectedCategorie;
      return matchSearch && matchSecteur && matchCat;
    });
  }, [brands, search, selectedSecteur, selectedCategorie]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">📡</span>
            <h1 className="text-xl font-bold text-gray-900">
              Meta Brands Tracker
            </h1>
          </div>
          <FilterBar
            search={search}
            onSearch={setSearch}
            secteurs={secteurs}
            selectedSecteur={selectedSecteur}
            onSecteur={(v) => {
              setSelectedSecteur(v);
              setSelectedCategorie("");
            }}
            categories={categories}
            selectedCategorie={selectedCategorie}
            onCategorie={setSelectedCategorie}
            total={brands.length}
            filtered={filtered.length}
          />
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
            Chargement…
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-24 text-red-500 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-gray-400">
            <span className="text-4xl">🔍</span>
            <p className="text-sm">Aucune marque ne correspond aux filtres.</p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filtered.map((brand) => (
              <BrandCard key={brand.id} brand={brand} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
