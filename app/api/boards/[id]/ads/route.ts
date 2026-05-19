import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: boardId } = await ctx.params;
    const body = await req.json();
    const { adId } = body;
    if (!adId) {
      return NextResponse.json({ error: "adId is required" }, { status: 400 });
    }
    const boardAd = await prisma.boardAd.create({
      data: { boardId, adId },
    });
    return NextResponse.json(boardAd, { status: 201 });
  } catch (error) {
    console.error("POST /api/boards/[id]/ads error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: boardId } = await ctx.params;
    const body = await req.json();
    const { adId } = body;
    if (!adId) {
      return NextResponse.json({ error: "adId is required" }, { status: 400 });
    }
    await prisma.boardAd.delete({
      where: { boardId_adId: { boardId, adId } },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/boards/[id]/ads error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
