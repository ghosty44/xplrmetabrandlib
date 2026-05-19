import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }
    const updated = await prisma.brand.update({
      where: { id },
      data: { isFollowing: !brand.isFollowing },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("POST /api/brands/[id]/follow error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
