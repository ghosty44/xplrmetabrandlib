import { NextResponse } from "next/server";
import { Brand } from "@/types/brand";

const BRANDS: Brand[] = [
  {
    id: "10936503735",
    name: "ASOS",
    metaAdsUrl:
      "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&is_targeted_country=false&media_type=all&search_type=page&sort_data[direction]=desc&sort_data[mode]=total_impressions&view_all_page_id=10936503735",
    secteur: "Mode",
    categorie: "E-commerce",
    pageId: "10936503735",
  },
];

export async function GET() {
  return NextResponse.json(BRANDS);
}
