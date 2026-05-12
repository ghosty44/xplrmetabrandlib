import { NextResponse } from "next/server";
import { MOCK_BRANDS } from "@/lib/mock-data";

export async function GET() {
  // Use Notion when credentials are set, otherwise fall back to mock data
  if (process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
    try {
      const { getBrandsFromNotion } = await import("@/lib/notion");
      const brands = await getBrandsFromNotion();
      return NextResponse.json(brands);
    } catch (err) {
      console.error("Notion fetch failed, using mock data:", err);
    }
  }

  return NextResponse.json(MOCK_BRANDS);
}
