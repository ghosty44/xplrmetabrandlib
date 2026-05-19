"use client";

import { useState } from "react";
import { Plus, RefreshCw, Heart, LayoutGrid, Bookmark } from "lucide-react";
import type { Brand, Board } from "@/lib/types";

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

interface SidebarProps {
  brands: Brand[];
  boards: Board[];
  onAddBrand: (data: { name: string; metaPageId: string; category: string }) => Promise<void>;
  onFollowToggle: (brandId: string) => void;
  onSync: (brandId: string) => void;
  onSelectBrand: (brandId: string | null) => void;
  selectedBrandId: string | null;
  onSelectCategory: (category: string | null) => void;
  selectedCategory: string | null;
  onCreateBoard: (name: string) => Promise<void>;
}

export default function Sidebar({
  brands,
  boards,
  onAddBrand,
  onFollowToggle,
  onSync,
  onSelectBrand,
  selectedBrandId,
  onSelectCategory,
  selectedCategory,
  onCreateBoard,
}: SidebarProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPageId, setFormPageId] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [showBoardInput, setShowBoardInput] = useState(false);

  const categories = Array.from(
    new Set(brands.map((b) => b.category).filter(Boolean))
  );

  const filteredBrands = brands.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAddBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!formName || !formPageId) return;
    setSubmitting(true);
    try {
      await onAddBrand({ name: formName, metaPageId: formPageId, category: formCategory });
      setFormName("");
      setFormPageId("");
      setFormCategory("");
      setShowAddForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateBoard(e: React.FormEvent) {
    e.preventDefault();
    if (!newBoardName) return;
    await onCreateBoard(newBoardName);
    setNewBoardName("");
    setShowBoardInput(false);
  }

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-gray-100 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-4">
          <LayoutGrid className="text-blue-600" size={22} />
          <span className="font-bold text-lg text-gray-900">AdSpy</span>
        </div>
        <input
          type="text"
          placeholder="Search brands..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
        />
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={16} />
          Add brand
        </button>

        {showAddForm && (
          <form onSubmit={handleAddBrand} className="mt-3 space-y-2">
            <input
              type="text"
              placeholder="Brand name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Meta Page ID"
              value={formPageId}
              onChange={(e) => setFormPageId(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Category (optional)"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-2 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {submitting ? "Adding..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Brands section */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Brands ({brands.length})
          </h3>
          <ul className="space-y-1">
            {filteredBrands.map((brand) => (
              <li key={brand.id}>
                <button
                  onClick={() =>
                    onSelectBrand(selectedBrandId === brand.id ? null : brand.id)
                  }
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition ${
                    selectedBrandId === brand.id
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${getBrandColor(brand.name)}`}
                  >
                    {brand.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 text-sm font-medium truncate">
                    {brand.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFollowToggle(brand.id);
                    }}
                    title={brand.isFollowing ? "Unfollow" : "Follow"}
                    className="text-gray-400 hover:text-pink-500 transition"
                  >
                    <Heart
                      size={14}
                      className={brand.isFollowing ? "fill-pink-500 text-pink-500" : ""}
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSync(brand.id);
                    }}
                    title="Sync ads"
                    className="text-gray-400 hover:text-blue-500 transition"
                  >
                    <RefreshCw size={14} />
                  </button>
                </button>
              </li>
            ))}
            {filteredBrands.length === 0 && (
              <li className="text-sm text-gray-400 px-2 py-4 text-center">
                No brands yet
              </li>
            )}
          </ul>
        </div>

        {/* Sectors section */}
        {categories.length > 0 && (
          <div className="px-4 pb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Sectors
            </h3>
            <ul className="space-y-1">
              {categories.map((cat) => (
                <li key={cat}>
                  <button
                    onClick={() =>
                      onSelectCategory(selectedCategory === cat ? null : cat)
                    }
                    className={`w-full text-left px-2 py-1.5 text-sm rounded-lg transition ${
                      selectedCategory === cat
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {cat}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Boards section */}
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Boards
            </h3>
            <button
              onClick={() => setShowBoardInput(!showBoardInput)}
              className="text-gray-400 hover:text-blue-600 transition"
            >
              <Plus size={14} />
            </button>
          </div>
          {showBoardInput && (
            <form onSubmit={handleCreateBoard} className="mb-2 flex gap-1">
              <input
                type="text"
                placeholder="Board name"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-2 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
              >
                +
              </button>
            </form>
          )}
          <ul className="space-y-1">
            {boards.map((board) => (
              <li key={board.id}>
                <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600">
                  <Bookmark size={14} className="text-gray-400" />
                  <span className="truncate">{board.name}</span>
                </div>
              </li>
            ))}
            {boards.length === 0 && (
              <li className="text-sm text-gray-400 px-2 py-2 text-center">
                No boards yet
              </li>
            )}
          </ul>
        </div>
      </div>
    </aside>
  );
}
