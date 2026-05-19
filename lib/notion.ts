import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_BRAND_DB_ID!;

export type NotionBrand = {
  id: string;
  name: string;
  metaPageId: string;
  url: string | null;
  isFollowing: boolean;
  category: string;
  createdAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseBrand(page: any): NotionBrand {
  const p = page.properties;
  return {
    id: page.id,
    name: p.Nommarque?.title?.[0]?.plain_text ?? "",
    metaPageId: p.ID?.rich_text?.[0]?.plain_text ?? "",
    url: p.URL?.url ?? null,
    isFollowing: p.Suivi?.checkbox ?? false,
    category: p.Categorie?.rich_text?.[0]?.plain_text ?? "",
    createdAt: page.created_time,
  };
}

export async function getBrands(): Promise<NotionBrand[]> {
  const res = await notion.dataSources.query({
    data_source_id: DB_ID,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.results as any[]).filter((r) => r.object === "page").map(parseBrand);
}

export async function getBrandById(id: string): Promise<NotionBrand | null> {
  try {
    const page = await notion.pages.retrieve({ page_id: id });
    return parseBrand(page);
  } catch {
    return null;
  }
}

export async function getBrandsByCategory(category: string): Promise<NotionBrand[]> {
  const res = await notion.dataSources.query({
    data_source_id: DB_ID,
    filter: { property: "Categorie", rich_text: { equals: category } },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.results as any[]).filter((r) => r.object === "page").map(parseBrand);
}

export async function createBrand(data: {
  name: string;
  metaPageId: string;
  category: string;
}): Promise<NotionBrand> {
  const page = await notion.pages.create({
    parent: { data_source_id: DB_ID },
    properties: {
      Nommarque: { title: [{ text: { content: data.name } }] },
      ID: { rich_text: [{ text: { content: data.metaPageId } }] },
      Categorie: { rich_text: [{ text: { content: data.category } }] },
      Suivi: { checkbox: false },
    },
  });
  return parseBrand(page);
}

export async function archiveBrand(id: string): Promise<void> {
  await notion.pages.update({ page_id: id, in_trash: true });
}

export async function toggleFollow(id: string): Promise<NotionBrand> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = (await notion.pages.retrieve({ page_id: id })) as any;
  const current: boolean = page.properties.Suivi?.checkbox ?? false;
  const updated = await notion.pages.update({
    page_id: id,
    properties: { Suivi: { checkbox: !current } },
  });
  return parseBrand(updated);
}
