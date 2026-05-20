'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadUserId } from '@/lib/store';
import { GalleryImage } from '@/app/api/gallery/route';

const PURPOSE_LABELS: Record<GalleryImage['purpose'], string> = {
  hero: 'Écran d\'accueil',
  general: 'Générale',
};

function compressImage(file: File, maxWidth = 1920, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function sizeLabel(dataUrl: string): string {
  const bytes = Math.round((dataUrl.length * 3) / 4);
  if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} Mo`;
  return `${Math.round(bytes / 1024)} Ko`;
}

export default function GalleryPage() {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<GalleryImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const userId = typeof window !== 'undefined' ? loadUserId() : null;

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    fetch(`/api/gallery?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d: { images: GalleryImage[] }) => setImages(d.images ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  async function save(next: GalleryImage[]) {
    setImages(next);
    if (!userId) return;
    setSaving(true);
    await fetch('/api/gallery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, images: next }),
    }).catch(() => {});
    setSaving(false);
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const added: GalleryImage[] = [];
    for (const file of Array.from(files)) {
      try {
        const dataUrl = await compressImage(file);
        added.push({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          dataUrl,
          purpose: 'general',
          createdAt: new Date().toISOString(),
        });
      } catch { /* skip */ }
    }
    setUploading(false);
    await save([...images, ...added]);
  }

  async function setPurpose(id: string, purpose: GalleryImage['purpose']) {
    const next = images.map((img) => img.id === id ? { ...img, purpose } : img);
    await save(next);
  }

  async function rename(id: string, name: string) {
    const next = images.map((img) => img.id === id ? { ...img, name } : img);
    await save(next);
  }

  async function remove(id: string) {
    await save(images.filter((img) => img.id !== id));
    if (preview?.id === id) setPreview(null);
  }

  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <main className="max-w-md mx-auto px-4 pt-14 pb-32">
        <div className="flex items-center justify-between mb-4 px-1">
          <h1 className="text-[28px] font-black text-[#0F0F10] tracking-tight">Galerie</h1>
          <div className="flex items-center gap-2">
            {saving && <p className="text-[11px] text-[#8E8E93]">Sauvegarde…</p>}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0F0F10] text-white text-[12px] font-semibold disabled:opacity-50"
            >
              {uploading ? '…' : (
                <>
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M5.5 1v9M1 5.5h9" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  Ajouter
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-[20px] bg-white border border-black/5 aspect-square animate-pulse" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div
            onClick={() => fileRef.current?.click()}
            className="mt-4 rounded-[24px] border-2 border-dashed border-[#8E8E93]/30 p-12 flex flex-col items-center gap-3 cursor-pointer active:bg-black/5 transition-colors"
          >
            <div className="w-14 h-14 rounded-full bg-white border border-black/8 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M11 3v16M3 11h16" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[14px] font-semibold text-[#0F0F10]">Ajoute ta première image</p>
              <p className="text-[12px] text-[#8E8E93] mt-0.5">Les images sont compressées et stockées en ligne</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {images.map((img) => (
              <button
                key={img.id}
                onClick={() => setPreview(img)}
                className="rounded-[20px] overflow-hidden border border-black/5 bg-white relative aspect-square group text-left"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-[11px] font-bold text-white truncate">{img.name}</p>
                  <span className={`inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-1 ${
                    img.purpose === 'hero' ? 'bg-[#C8E635] text-[#0F0F10]' : 'bg-white/20 text-white'
                  }`}>
                    {PURPOSE_LABELS[img.purpose]}
                  </span>
                </div>
              </button>
            ))}

            {/* Add more */}
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-[20px] border-2 border-dashed border-[#8E8E93]/30 aspect-square flex flex-col items-center justify-center gap-2 active:bg-black/5 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2v14M2 9h14" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <p className="text-[11px] text-[#8E8E93] font-medium">Ajouter</p>
            </button>
          </div>
        )}

        {/* Usage info */}
        {images.length > 0 && (
          <div className="mt-4 rounded-[20px] bg-white border border-black/5 p-4">
            <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-2">Utilisation</p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[#0F0F10]">Écran d&apos;accueil (hero)</span>
                <span className="text-[12px] text-[#8E8E93]">
                  {images.find((i) => i.purpose === 'hero')?.name ?? '—'}
                </span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Image detail sheet */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end"
          onClick={(e) => { if (e.target === e.currentTarget) setPreview(null); }}
        >
          <div className="w-full max-w-md mx-auto bg-[#F2F2F7] rounded-t-[32px] p-5 pb-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.dataUrl}
              alt={preview.name}
              className="w-full h-48 object-cover rounded-[20px] mb-4"
            />

            {/* Name */}
            <div className="rounded-[16px] bg-white border border-black/5 px-4 py-3 mb-3">
              <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-1">Nom</p>
              <input
                type="text"
                value={preview.name}
                onChange={(e) => {
                  setPreview((p) => p ? { ...p, name: e.target.value } : p);
                }}
                onBlur={(e) => rename(preview.id, e.target.value)}
                className="w-full text-[14px] font-semibold text-[#0F0F10] bg-transparent outline-none"
              />
            </div>

            {/* Purpose */}
            <div className="rounded-[16px] bg-white border border-black/5 px-4 py-3 mb-3">
              <p className="text-[10px] font-semibold text-[#8E8E93] uppercase tracking-[0.08em] mb-2">Utilisation</p>
              <div className="flex gap-2">
                {(['hero', 'general'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => { setPurpose(preview.id, p); setPreview((prev) => prev ? { ...prev, purpose: p } : prev); }}
                    className={`flex-1 py-2 rounded-[10px] text-[12px] font-semibold transition-all ${
                      preview.purpose === p ? 'bg-[#0F0F10] text-white' : 'bg-[#F2F2F7] text-[#8E8E93]'
                    }`}
                  >
                    {PURPOSE_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-[#8E8E93] text-center mb-4">{sizeLabel(preview.dataUrl)}</p>

            <button
              onClick={() => remove(preview.id)}
              className="w-full py-3 rounded-[16px] bg-red-50 border border-red-100 text-[13px] font-semibold text-red-600"
            >
              Supprimer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
