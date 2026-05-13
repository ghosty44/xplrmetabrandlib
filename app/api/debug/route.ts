import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.json({ token: false, message: "META_ACCESS_TOKEN non défini" });
  }

  try {
    const params = new URLSearchParams({
      search_page_ids: JSON.stringify(["6550003123"]),
      ad_reached_countries: JSON.stringify(["FR"]),
      ad_type: "ALL",
      fields: "id,page_name",
      access_token: token,
      limit: "3",
    });

    const res = await fetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`);
    const data = await res.json();

    return NextResponse.json({
      token: true,
      tokenLength: token.length,
      metaStatus: res.status,
      metaError: data.error ?? null,
      adsCount: data.data?.length ?? 0,
      sample: data.data?.slice(0, 2) ?? [],
    });
  } catch (err) {
    return NextResponse.json({ token: true, fetchError: String(err) });
  }
}
