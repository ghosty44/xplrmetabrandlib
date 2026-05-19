import { NextRequest, NextResponse } from "next/server";
import { archiveBrand } from "@/lib/notion";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    await archiveBrand(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/brands/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
