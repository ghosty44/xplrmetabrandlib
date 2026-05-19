import { NextRequest, NextResponse } from "next/server";
import { toggleFollow } from "@/lib/notion";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const updated = await toggleFollow(id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("POST /api/brands/[id]/follow error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
