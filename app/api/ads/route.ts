import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get("pageId");

  if (!pageId) {
    return NextResponse.json({ error: "pageId requis" }, { status: 400 });
  }

  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN non configuré" }, { status: 503 });
  }

  const params = new URLSearchParams({
    search_page_ids: JSON.stringify([pageId]),
    ad_reached_countries: JSON.stringify(["FR"]),
    ad_type: "ALL",
    fields: [
      "id",
      "page_name",
      "ad_creative_bodies",
      "ad_creative_link_titles",
      "ad_creative_link_descriptions",
      "ad_snapshot_url",
      "ad_delivery_start_time",
      "ad_delivery_stop_time",
      "impressions",
    ].join(","),
    access_token: token,
    limit: "24",
  });

  const res = await fetch(
    `https://graph.facebook.com/v21.0/ads_archive?${params}`
  );
  const data = await res.json();

  if (data.error) {
    console.error("Meta API error:", data.error);
    return NextResponse.json({ error: data.error.message }, { status: 502 });
  }

  return NextResponse.json(data.data ?? []);
}
