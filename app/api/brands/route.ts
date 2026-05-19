import { NextRequest, NextResponse } from "next/server";
import { getBrands, createBrand } from "@/lib/notion";

export async function GET() {
  try {
    const brands = await getBrands();
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

    const brand = await createBrand({ name, metaPageId, category: category ?? "" });
    return NextResponse.json(brand, { status: 201 });
  } catch (error) {
    console.error("POST /api/brands error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
