import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brandId = searchParams.get("brandId") ?? undefined;
    const category = searchParams.get("category") ?? undefined;
    const cursor = searchParams.get("cursor") ?? undefined;

    const where: Record<string, unknown> = {};
    if (brandId) where.brandId = brandId;
    if (category) {
      where.brand = { category };
    }

    const ads = await prisma.ad.findMany({
      where,
      include: { brand: true },
      orderBy: { fetchedAt: "desc" },
      take: 48,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const nextCursor = ads.length === 48 ? ads[ads.length - 1].id : null;

    return NextResponse.json({ ads, nextCursor });
  } catch (error) {
    console.error("GET /api/ads error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
