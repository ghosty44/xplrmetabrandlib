export interface Brand {
  id: string;
  name: string;
  metaAdsUrl: string;
  secteur: string;
  categorie: string;
  pageId?: string; // Facebook page ID extracted from URL
}
