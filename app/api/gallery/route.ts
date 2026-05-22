import { put, del } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export type GalleryImage = {
  id: string;
  name: string;
  url: string;
  purpose: 'hero' | 'general';
  createdAt: string;
};

type GalleryStore = { images: GalleryImage[] };

function galleryId(userId: string) {
  return `${userId}-gallery`;
}

async function loadImages(userId: string): Promise<GalleryImage[]> {
  try {
    const row = await prisma.userData.findUnique({ where: { id: galleryId(userId) } });
    return ((row?.plan ?? { images: [] }) as GalleryStore).images ?? [];
  } catch {
    return [];
  }
}

async function persistImages(userId: string, images: GalleryImage[]) {
  await prisma.userData.upsert({
    where: { id: galleryId(userId) },
    create: { id: galleryId(userId), plan: { images } },
    update: { plan: { images } },
  });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ images: [] });
  return NextResponse.json({ images: await loadImages(userId) });
}

// PUT — upload one image to Vercel Blob, append metadata to Neon
export async function PUT(req: NextRequest) {
  const form = await req.formData();
  const userId = form.get('userId') as string | null;
  const file = form.get('file') as File | null;
  const name = (form.get('name') as string | null) ?? 'image';
  const purpose = ((form.get('purpose') as string | null) ?? 'general') as GalleryImage['purpose'];

  if (!userId || !file) {
    return NextResponse.json({ success: false, error: 'userId and file required' }, { status: 400 });
  }

  const ext = file.name.split('.').pop() ?? 'jpg';
  const filename = `gallery/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const blob = await put(filename, file, { access: 'public' });

  const image: GalleryImage = {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    url: blob.url,
    purpose,
    createdAt: new Date().toISOString(),
  };

  const current = await loadImages(userId);
  await persistImages(userId, [...current, image]);

  return NextResponse.json({ success: true, image });
}

// POST — update metadata only (rename, purpose change)
export async function POST(req: NextRequest) {
  const { userId, images } = await req.json() as { userId: string; images: GalleryImage[] };
  if (!userId) return NextResponse.json({ success: false }, { status: 400 });
  await persistImages(userId, images);
  return NextResponse.json({ success: true });
}

// DELETE — remove from Blob store + Neon
export async function DELETE(req: NextRequest) {
  const { userId, imageId, url } = await req.json() as { userId: string; imageId: string; url: string };
  if (!userId || !imageId) return NextResponse.json({ success: false }, { status: 400 });

  if (url) {
    try { await del(url); } catch { /* blob may already be gone */ }
  }

  const current = await loadImages(userId);
  await persistImages(userId, current.filter((img) => img.id !== imageId));

  return NextResponse.json({ success: true });
}
