import { NextResponse } from "next/server";

export async function GET() {
  if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
    return NextResponse.json({ error: "Notion non configuré" }, { status: 503 });
  }

  const { getBrandsFromNotion } = await import("@/lib/notion");
  const brands = await getBrandsFromNotion();
  return NextResponse.json(brands);
}
