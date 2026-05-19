"use client";

import { useState } from "react";
import { Bookmark, ExternalLink } from "lucide-react";
import type { AdWithBrand, Board } from "@/lib/types";

function relativeDate(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months}mo`;
  if (weeks > 0) return `${weeks}w`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "now";
}

function getBrandColor(name: string): string {
  const colors = [
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-yellow-500",
    "bg-red-500",
    "bg-indigo-500",
    "bg-teal-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

interface AdCardProps {
  ad: AdWithBrand;
  onClick: () => void;
  isSelected: boolean;
  boards: Board[];
  onSaveToBoard: (boardId: string, adId: string) => void;
}

export default function AdCard({
  ad,
  onClick,
  isSelected,
  boards,
  onSaveToBoard,
}: AdCardProps) {
  const [showBoardMenu, setShowBoardMenu] = useState(false);

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer mb-4 overflow-hidden ${
        isSelected ? "ring-2 ring-blue-500" : ""
      }`}
      style={{ breakInside: "avoid" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${getBrandColor(
            ad.brand.name
          )}`}
        >
          {ad.brand.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-800 truncate">
            {ad.brand.name}
          </p>
          {ad.activeSince && (
            <p className="text-xs text-gray-400">
              {relativeDate(ad.activeSince)} ago
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      {ad.bodyText && (
        <div className="px-3 pb-2">
          <p className="text-sm text-gray-700 line-clamp-4">{ad.bodyText}</p>
        </div>
      )}

      {/* Link title */}
      {ad.linkTitle && (
        <div className="px-3 pb-2">
          <p className="text-xs font-bold text-gray-900">{ad.linkTitle}</p>
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-end gap-2 px-3 pb-3 pt-1"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bookmark / Save to board */}
        <div className="relative">
          <button
            onClick={() => setShowBoardMenu(!showBoardMenu)}
            title="Save to board"
            className="text-gray-400 hover:text-blue-600 transition"
          >
            <Bookmark size={16} />
          </button>
          {showBoardMenu && (
            <div className="absolute bottom-6 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[140px]">
              {boards.length === 0 ? (
                <p className="text-xs text-gray-400 px-3 py-2">No boards yet</p>
              ) : (
                boards.map((board) => (
                  <button
                    key={board.id}
                    onClick={() => {
                      onSaveToBoard(board.id, ad.id);
                      setShowBoardMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition"
                  >
                    {board.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* External link */}
        {ad.snapshotUrl && (
          <a
            href={ad.snapshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="View creative"
            className="text-gray-400 hover:text-blue-600 transition"
          >
            <ExternalLink size={16} />
          </a>
        )}
      </div>
    </div>
  );
}
