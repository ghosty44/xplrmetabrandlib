import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { blobs } = await list({ prefix: 'IMG/' });
    const urls = blobs.filter((b) => !b.pathname.endsWith('/')).map((b) => b.url);
    if (!urls.length) return NextResponse.json({ url: null, all: [] });
    const random = urls[Math.floor(Math.random() * urls.length)];
    return NextResponse.json({ url: random, all: urls });
  } catch {
    return NextResponse.json({ url: null, all: [] });
  }
}
