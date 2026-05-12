"use client";

import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/types/brand";
import BrandList from "@/components/BrandList";
import AdsPanel from "@/components/AdsPanel";

export default function Home() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Brand | null>(null);

  const [search, setSearch] = useState("");
  const [selectedSecteur, setSelectedSecteur] = useState("");

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((data: Brand[]) => {
        setBrands(data);
        if (data.length > 0) setSelected(data[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const secteurs = useMemo(
    () => [...new Set(brands.map((b) => b.secteur).filter(Boolean))].sort(),
    [brands]
  );

  const filtered = useMemo(
    () =>
      brands.filter((b) => {
        const matchSearch =
          !search || b.name.toLowerCase().includes(search.toLowerCase());
        const matchSecteur =
          !selectedSecteur || b.secteur === selectedSecteur;
        return matchSearch && matchSecteur;
      }),
    [brands, search, selectedSecteur]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Left sidebar — brand list */}
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
            secteurs={secteurs}
            selectedSecteur={selectedSecteur}
            onSecteur={setSelectedSecteur}
          />
        )}
      </div>

      {/* Right — ads */}
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
