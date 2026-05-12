export async function GET(
  _req: Request,
  { params }: { params: Promise<{ adId: string }> }
) {
  const { adId } = await params;
  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    return new Response("Token not configured", { status: 503 });
  }

  const url = `https://www.facebook.com/ads/archive/render_ad/?id=${adId}&access_token=${token}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
    });

    const html = await res.text();

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Failed to fetch snapshot", { status: 502 });
  }
}
