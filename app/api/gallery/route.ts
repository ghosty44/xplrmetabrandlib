import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export type GalleryImage = {
  id: string;
  name: string;
  dataUrl: string;
  purpose: 'hero' | 'general';
  createdAt: string;
};

type GalleryStore = { images: GalleryImage[] };

function galleryId(userId: string) {
  return `${userId}-gallery`;
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ images: [] });
  try {
    const row = await prisma.userData.findUnique({ where: { id: galleryId(userId) } });
    const store = (row?.plan ?? { images: [] }) as GalleryStore;
    return NextResponse.json({ images: store.images ?? [] });
  } catch {
    return NextResponse.json({ images: [] });
  }
}

export async function POST(req: NextRequest) {
  const { userId, images } = await req.json() as { userId: string; images: GalleryImage[] };
  if (!userId) return NextResponse.json({ success: false }, { status: 400 });
  await prisma.userData.upsert({
    where: { id: galleryId(userId) },
    create: { id: galleryId(userId), plan: { images } },
    update: { plan: { images } },
  });
  return NextResponse.json({ success: true });
}
