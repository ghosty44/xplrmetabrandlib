import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getBrands,
  getBrandById,
  getBrandsByCategory,
  type NotionBrand,
} from "@/lib/notion";

const FALLBACK_BRAND = (id: string): NotionBrand => ({
  id,
  name: "Unknown",
  metaPageId: "",
  url: null,
  isFollowing: false,
  category: "",
  createdAt: "",
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const brandId = searchParams.get("brandId") ?? undefined;
    const category = searchParams.get("category") ?? undefined;
    const cursor = searchParams.get("cursor") ?? undefined;

    // Resolve brand filter and pre-fetch brand(s) for the response map
    const where: Record<string, unknown> = {};
    let brandMap: Record<string, NotionBrand> = {};

    if (brandId) {
      where.brandId = brandId;
      const b = await getBrandById(brandId);
      if (b) brandMap[b.id] = b;
    } else if (category) {
      const brandsInCategory = await getBrandsByCategory(category);
      for (const b of brandsInCategory) brandMap[b.id] = b;
      where.brandId = { in: Object.keys(brandMap) };
    } else {
      const allBrands = await getBrands();
      for (const b of allBrands) brandMap[b.id] = b;
    }

    const ads = await prisma.ad.findMany({
      where,
      orderBy: { fetchedAt: "desc" },
      take: 48,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const adsWithBrand = ads.map((ad) => ({
      ...ad,
      brand: brandMap[ad.brandId] ?? FALLBACK_BRAND(ad.brandId),
    }));

    const nextCursor = ads.length === 48 ? ads[ads.length - 1].id : null;

    return NextResponse.json({ ads: adsWithBrand, nextCursor });
  } catch (error) {
    console.error("GET /api/ads error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
