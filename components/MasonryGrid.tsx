"use client";

import AdCard from "./AdCard";
import type { AdWithBrand, Board } from "@/lib/types";

interface MasonryGridProps {
  ads: AdWithBrand[];
  onSelect: (ad: AdWithBrand) => void;
  selectedAdId?: string;
  boards: Board[];
  onSaveToBoard: (boardId: string, adId: string) => void;
}

export default function MasonryGrid({
  ads,
  onSelect,
  selectedAdId,
  boards,
  onSaveToBoard,
}: MasonryGridProps) {
  if (ads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-400 text-lg">No ads yet</p>
        <p className="text-gray-300 text-sm mt-1">
          Add a brand and sync to see ads here
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        columnCount: 4,
        columnGap: "1rem",
      }}
      className="masonry-grid"
    >
      {ads.map((ad) => (
        <AdCard
          key={ad.id}
          ad={ad}
          onClick={() => onSelect(ad)}
          isSelected={ad.id === selectedAdId}
          boards={boards}
          onSaveToBoard={onSaveToBoard}
        />
      ))}
    </div>
  );
}
