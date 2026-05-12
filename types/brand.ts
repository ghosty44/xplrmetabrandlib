export interface Brand {
  id: string;
  name: string;
  metaAdsUrl: string;
  secteur: string;
  categorie: string;
  pageId?: string;
}

export interface MetaAd {
  id: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_snapshot_url?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  impressions?: { lower_bound: string; upper_bound: string };
}
