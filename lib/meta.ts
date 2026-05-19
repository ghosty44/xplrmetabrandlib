export interface MetaAd {
  id: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  publisher_platforms?: string[];
  page_name?: string;
}

export async function fetchAdsForBrand(
  pageId: string,
  token: string
): Promise<MetaAd[]> {
  if (!token) {
    console.error("META_ACCESS_TOKEN is not set");
    return [];
  }

  const params = new URLSearchParams({
    search_page_ids: pageId,
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    fields:
      "id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_snapshot_url,ad_delivery_start_time,publisher_platforms,page_name",
    access_token: token,
    limit: "48",
  });

  try {
    const url = `https://graph.facebook.com/v23.0/ads_archive?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Meta API error:", response.status, errorData);
      return [];
    }

    const json = await response.json();

    if (json.error) {
      console.error("Meta API returned error:", json.error);
      return [];
    }

    return (json.data as MetaAd[]) ?? [];
  } catch (error) {
    console.error("Failed to fetch ads from Meta:", error);
    return [];
  }
}
