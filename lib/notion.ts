import { Client } from "@notionhq/client";
import { Brand } from "@/types/brand";

const notion = new Client({ auth: process.env.NOTION_API_KEY });

function extractPageId(url: string): string | undefined {
  const match = url.match(/view_all_page_id=(\d+)/);
  return match?.[1];
}

export async function getBrandsFromNotion(): Promise<Brand[]> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) throw new Error("NOTION_DATABASE_ID is not set");

  // notion@5.x uses search instead of databases.query
  const response = await notion.search({
    filter: { property: "object", value: "page" },
    sort: { direction: "ascending", timestamp: "last_edited_time" },
  });

  return response.results
    .filter((r: any) => r.parent?.database_id?.replace(/-/g, "") === databaseId.replace(/-/g, ""))
    .map((page: any) => {
      const props = page.properties;

      const name =
        props["Nom"]?.title?.[0]?.plain_text ||
        props["Name"]?.title?.[0]?.plain_text ||
        "";

      const metaAdsUrl =
        props["Meta Ads"]?.url ||
        props["Lien Meta Ads"]?.url ||
        props["URL"]?.url ||
        "";

      const secteur =
        props["Secteur"]?.select?.name ||
        props["Secteur"]?.multi_select?.[0]?.name ||
        "";

      const categorie =
        props["Catégorie"]?.select?.name ||
        props["Categorie"]?.select?.name ||
        props["Catégorie"]?.multi_select?.[0]?.name ||
        "";

      return {
        id: page.id,
        name,
        metaAdsUrl,
        secteur,
        categorie,
        pageId: extractPageId(metaAdsUrl),
      } as Brand;
    })
    .filter((b) => b.name && b.metaAdsUrl);
}
