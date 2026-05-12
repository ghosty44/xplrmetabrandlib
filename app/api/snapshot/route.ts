import { NextResponse } from "next/server";

const ALLOWED_PREFIX = "https://www.facebook.com/ads/archive/render_ad/";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url || !url.startsWith(ALLOWED_PREFIX)) {
    return new NextResponse("URL invalide", { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });

    const html = await res.text();

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Do NOT set X-Frame-Options — that's the whole point
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Erreur lors du chargement", { status: 502 });
  }
}
