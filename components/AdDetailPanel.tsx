"use client";

import { useState } from "react";
import { X, ExternalLink, Bookmark } from "lucide-react";
import type { AdWithBrand, Board } from "@/lib/types";

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

const THOUGHT_STARTERS = [
  "Quel problème cette pub résout-elle en premier ?",
  "Quel élément de preuve sociale est utilisé ?",
  "Quel est le CTA principal et pourquoi ?",
];

interface AdDetailPanelProps {
  ad: AdWithBrand | null;
  onClose: () => void;
  boards: Board[];
  onSaveToBoard: (boardId: string, adId: string) => void;
}

export default function AdDetailPanel({
  ad,
  onClose,
  boards,
  onSaveToBoard,
}: AdDetailPanelProps) {
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [saved, setSaved] = useState(false);

  const isOpen = !!ad;

  function handleSave() {
    if (!ad || !selectedBoardId) return;
    onSaveToBoard(selectedBoardId, ad.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const platforms = ad?.platforms?.split(",").filter(Boolean) ?? [];

  return (
    <div
      className={`fixed top-0 right-0 h-full w-[400px] bg-white shadow-2xl border-l border-gray-100 z-40 overflow-y-auto transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {ad && (
        <div className="flex flex-col h-full">
          {/* Close button */}
          <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
            <h2 className="font-semibold text-gray-900">Ad Detail</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 transition"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 p-4 space-y-5">
            {/* Brand header */}
            <div className="flex items-center gap-3">
              <span
                className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${getBrandColor(
                  ad.brand.name
                )}`}
              >
                {ad.brand.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <p className="font-semibold text-gray-900">{ad.brand.name}</p>
                {ad.brand.category && (
                  <p className="text-xs text-gray-400">{ad.brand.category}</p>
                )}
              </div>
            </div>

            {/* View creative button */}
            {ad.snapshotUrl && (
              <a
                href={ad.snapshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
              >
                <ExternalLink size={16} />
                View creative →
              </a>
            )}

            {/* Copy section */}
            {ad.bodyText && (
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Copy
                </h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {ad.bodyText}
                </p>
              </section>
            )}

            {/* Link section */}
            {(ad.linkTitle || ad.linkDescription) && (
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Link
                </h3>
                {ad.linkTitle && (
                  <p className="text-sm font-bold text-gray-900">{ad.linkTitle}</p>
                )}
                {ad.linkDescription && (
                  <p className="text-sm text-gray-600 mt-0.5">
                    {ad.linkDescription}
                  </p>
                )}
              </section>
            )}

            {/* Platforms section */}
            {platforms.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Platforms
                </h3>
                <div className="flex flex-wrap gap-2">
                  {platforms.map((platform) => (
                    <span
                      key={platform}
                      className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium capitalize"
                    >
                      {platform === "facebook"
                        ? "FB"
                        : platform === "instagram"
                        ? "IG"
                        : platform}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Thought starters */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Thought starters
              </h3>
              <ul className="space-y-2">
                {THOUGHT_STARTERS.map((q, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-gray-700"
                  >
                    <span className="text-blue-400 mt-0.5 flex-shrink-0">→</span>
                    {q}
                  </li>
                ))}
              </ul>
            </section>

            {/* Save to board */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Save to board
              </h3>
              {boards.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No boards yet — create one in the sidebar.
                </p>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={selectedBoardId}
                    onChange={(e) => setSelectedBoardId(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a board...</option>
                    {boards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleSave}
                    disabled={!selectedBoardId}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    <Bookmark size={14} />
                    {saved ? "Saved!" : "Save"}
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
