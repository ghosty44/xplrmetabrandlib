import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { archiveBrand } from "@/lib/notion";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    await archiveBrand(id);

    const ads = await prisma.ad.findMany({
      where: { brandId: id },
      select: { id: true },
    });
    const adIds = ads.map((a) => a.id);
    await prisma.boardAd.deleteMany({ where: { adId: { in: adIds } } });
    await prisma.ad.deleteMany({ where: { brandId: id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/brands/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
