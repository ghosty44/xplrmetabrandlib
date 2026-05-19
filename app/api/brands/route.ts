import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAdsForBrand } from "@/lib/meta";

export async function GET() {
  try {
    const brands = await prisma.brand.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(brands);
  } catch (error) {
    console.error("GET /api/brands error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, metaPageId, category } = body;

    if (!name || !metaPageId) {
      return NextResponse.json(
        { error: "name and metaPageId are required" },
        { status: 400 }
      );
    }

    const brand = await prisma.brand.create({
      data: { name, metaPageId, category: category ?? "" },
    });

    // Trigger initial sync in background
    const token = process.env.META_ACCESS_TOKEN ?? "";
    if (token) {
      fetchAdsForBrand(metaPageId, token)
        .then(async (ads) => {
          for (const ad of ads) {
            await prisma.ad.upsert({
              where: { metaAdId: ad.id },
              update: {
                snapshotUrl: ad.ad_snapshot_url ?? null,
                bodyText: ad.ad_creative_bodies?.[0] ?? null,
                linkTitle: ad.ad_creative_link_titles?.[0] ?? null,
                linkDescription: ad.ad_creative_link_descriptions?.[0] ?? null,
                platforms: ad.publisher_platforms?.join(",") ?? null,
                activeSince: ad.ad_delivery_start_time
                  ? new Date(ad.ad_delivery_start_time)
                  : null,
                fetchedAt: new Date(),
              },
              create: {
                metaAdId: ad.id,
                brandId: brand.id,
                snapshotUrl: ad.ad_snapshot_url ?? null,
                bodyText: ad.ad_creative_bodies?.[0] ?? null,
                linkTitle: ad.ad_creative_link_titles?.[0] ?? null,
                linkDescription: ad.ad_creative_link_descriptions?.[0] ?? null,
                platforms: ad.publisher_platforms?.join(",") ?? null,
                activeSince: ad.ad_delivery_start_time
                  ? new Date(ad.ad_delivery_start_time)
                  : null,
              },
            });
          }
        })
        .catch((err) => console.error("Initial sync error:", err));
    }

    return NextResponse.json(brand, { status: 201 });
  } catch (error) {
    console.error("POST /api/brands error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
