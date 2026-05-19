import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
    });

    if (!res.ok) {
      return new NextResponse(`Meta returned ${res.status}`, { status: 502 });
    }

    let html = await res.text();

    // Fix relative URLs so assets load correctly
    if (!html.includes("<base ")) {
      html = html.replace(/<head([^>]*)>/i, '<head$1><base href="https://www.facebook.com">');
    }

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Intentionally omit X-Frame-Options so our iframe can embed it
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return new NextResponse(String(err), { status: 502 });
  }
}
