import { NextResponse } from "next/server";

const ALLOWED_PREFIX = "https://www.facebook.com/ads/archive/render_ad/";

// Inject a <base> tag so relative URLs in Meta's HTML resolve against facebook.com
function injectBase(html: string): string {
  const base = '<base href="https://www.facebook.com">';
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${base}`);
  }
  if (html.includes("<Head>")) {
    return html.replace("<Head>", `<Head>${base}`);
  }
  return base + html;
}

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
        Referer: "https://www.facebook.com/",
      },
    });

    const html = await res.text();

    return new NextResponse(injectBase(html), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Erreur lors du chargement", { status: 502 });
  }
}
