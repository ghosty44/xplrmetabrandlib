const NOTION_API = "https://api.notion.com/v1";
const DB_ID = process.env.NOTION_BRAND_DB_ID!;

function headers() {
  return {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };
}

export type NotionBrand = {
  id: string;
  name: string;
  metaPageId: string;
  url: string | null;
  isFollowing: boolean;
  category: string;
  createdAt: string;
};

function extractPageId(url: string | null): string {
  if (!url) return "";
  const match = url.match(/view_all_page_id=(\d+)/);
  return match?.[1] ?? "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseBrand(page: any): NotionBrand {
  const p = page.properties;
  const url: string | null = p.URL?.url ?? null;
  const explicitId: string = p.ID?.rich_text?.[0]?.plain_text ?? "";
  return {
    id: page.id,
    name: p.Nommarque?.title?.[0]?.plain_text ?? "",
    metaPageId: explicitId || extractPageId(url),
    url,
    isFollowing: p.Suivi?.checkbox ?? false,
    category: p.Categorie?.rich_text?.[0]?.plain_text ?? "",
    createdAt: page.created_time,
  };
}

export async function getBrands(): Promise<NotionBrand[]> {
  const res = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion query failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.results.map(parseBrand);
}

export async function getBrandById(id: string): Promise<NotionBrand | null> {
  const res = await fetch(`${NOTION_API}/pages/${id}`, { headers: headers() });
  if (!res.ok) return null;
  return parseBrand(await res.json());
}

export async function createBrand(data: {
  name: string;
  metaPageId: string;
  category: string;
}): Promise<NotionBrand> {
  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      parent: { database_id: DB_ID },
      properties: {
        Nommarque: { title: [{ text: { content: data.name } }] },
        ID: { rich_text: [{ text: { content: data.metaPageId } }] },
        Categorie: { rich_text: [{ text: { content: data.category } }] },
        Suivi: { checkbox: false },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion create failed: ${res.status} ${text}`);
  }
  return parseBrand(await res.json());
}

export async function archiveBrand(id: string): Promise<void> {
  await fetch(`${NOTION_API}/pages/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ archived: true }),
  });
}

export async function toggleFollow(id: string): Promise<NotionBrand> {
  const page = await getBrandById(id);
  const current = page?.isFollowing ?? false;
  const res = await fetch(`${NOTION_API}/pages/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({
      properties: { Suivi: { checkbox: !current } },
    }),
  });
  if (!res.ok) throw new Error(`Notion update failed: ${res.status}`);
  return parseBrand(await res.json());
}
