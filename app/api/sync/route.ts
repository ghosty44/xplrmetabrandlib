import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchAdsForBrand } from "@/lib/meta";
import { getBrandById } from "@/lib/notion";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { brandId } = body;
    if (!brandId) {
      return NextResponse.json({ error: "brandId is required" }, { status: 400 });
    }

    const brand = await getBrandById(brandId);
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const token = process.env.META_ACCESS_TOKEN ?? "";
    const ads = await fetchAdsForBrand(brand.metaPageId, token);

    let synced = 0;
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
      synced++;
    }

    return NextResponse.json({ synced });
  } catch (error) {
    console.error("POST /api/sync error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
