"use client";

import { useState, useEffect, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import FilterBar from "@/components/FilterBar";
import MasonryGrid from "@/components/MasonryGrid";
import AdDetailPanel from "@/components/AdDetailPanel";
import type { AdWithBrand, Brand, Board } from "@/lib/types";

type FormatFilter = "ALL" | "IMAGE" | "VIDEO";

export default function DiscoverPage() {
  const [ads, setAds] = useState<AdWithBrand[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedAd, setSelectedAd] = useState<AdWithBrand | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterBrandId, setFilterBrandId] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<FormatFilter>("ALL");
  const [loading, setLoading] = useState(false);

  const fetchBrands = useCallback(async () => {
    const res = await fetch("/api/brands");
    if (res.ok) {
      const data = await res.json();
      setBrands(data);
    }
  }, []);

  const fetchBoards = useCallback(async () => {
    const res = await fetch("/api/boards");
    if (res.ok) {
      const data = await res.json();
      setBoards(data);
    }
  }, []);

  const fetchAds = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterBrandId) params.set("brandId", filterBrandId);
    if (filterCategory) params.set("category", filterCategory);

    const res = await fetch(`/api/ads?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setAds(data.ads);
    }
    setLoading(false);
  }, [filterBrandId, filterCategory]);

  // Initial load
  useEffect(() => {
    fetchBrands();
    fetchBoards();
  }, [fetchBrands, fetchBoards]);

  // Re-fetch ads when filters change
  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  async function handleAddBrand(data: {
    name: string;
    metaPageId: string;
    category: string;
  }) {
    const res = await fetch("/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      await fetchBrands();
      // Reload ads after a short delay to give sync time to run
      setTimeout(() => fetchAds(), 2000);
    }
  }

  async function handleFollowToggle(brandId: string) {
    const res = await fetch(`/api/brands/${brandId}/follow`, {
      method: "POST",
    });
    if (res.ok) {
      const updated = await res.json();
      setBrands((prev) =>
        prev.map((b) => (b.id === brandId ? { ...b, isFollowing: updated.isFollowing } : b))
      );
    }
  }

  async function handleSync(brandId: string) {
    await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId }),
    });
    await fetchAds();
  }

  async function handleCreateBoard(name: string) {
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      await fetchBoards();
    }
  }

  async function handleSaveToBoard(boardId: string, adId: string) {
    await fetch(`/api/boards/${boardId}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adId }),
    });
  }

  function handleSelectBrand(brandId: string | null) {
    setFilterBrandId(brandId);
    setFilterCategory(null);
  }

  function handleSelectCategory(category: string | null) {
    setFilterCategory(category);
    setFilterBrandId(null);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <Sidebar
        brands={brands}
        boards={boards}
        onAddBrand={handleAddBrand}
        onFollowToggle={handleFollowToggle}
        onSync={handleSync}
        onSelectBrand={handleSelectBrand}
        selectedBrandId={filterBrandId}
        onSelectCategory={handleSelectCategory}
        selectedCategory={filterCategory}
        onCreateBoard={handleCreateBoard}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <FilterBar
          totalAds={ads.length}
          selectedFormat={selectedFormat}
          onFilterFormat={setSelectedFormat}
        />

        <main className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="text-gray-400">Loading ads...</div>
            </div>
          ) : (
            <MasonryGrid
              ads={ads}
              onSelect={setSelectedAd}
              selectedAdId={selectedAd?.id}
              boards={boards}
              onSaveToBoard={handleSaveToBoard}
            />
          )}
        </main>
      </div>

      {/* Detail panel */}
      <AdDetailPanel
        ad={selectedAd}
        onClose={() => setSelectedAd(null)}
        boards={boards}
        onSaveToBoard={handleSaveToBoard}
      />

      {/* Overlay when detail panel is open */}
      {selectedAd && (
        <div
          className="fixed inset-0 z-30 bg-transparent"
          onClick={() => setSelectedAd(null)}
        />
      )}
    </div>
  );
}
