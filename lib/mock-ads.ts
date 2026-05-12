import { MetaAd } from "@/types/brand";

const pool: Omit<MetaAd, "id">[] = [
  {
    ad_creative_bodies: [
      "Notre nouvelle collection est disponible. Des pièces intemporelles, fabriquées avec soin pour durer. Découvrez-la maintenant.",
    ],
    ad_creative_link_titles: ["Nouvelle collection — Découvrir"],
    ad_creative_link_descriptions: ["Livraison gratuite dès 80 €"],
    ad_delivery_start_time: "2025-03-01",
    impressions: { lower_bound: "10000", upper_bound: "50000" },
  },
  {
    ad_creative_bodies: [
      "Profitez de -20 % sur toute la sélection printemps. Offre valable jusqu'au 31 mai uniquement.",
    ],
    ad_creative_link_titles: ["-20 % ce week-end"],
    ad_creative_link_descriptions: ["Voir les offres"],
    ad_delivery_start_time: "2025-04-10",
    impressions: { lower_bound: "5000", upper_bound: "20000" },
  },
  {
    ad_creative_bodies: [
      "Nos best-sellers sont de retour. Les pièces que vous avez adorées, maintenant disponibles en de nouvelles couleurs.",
    ],
    ad_creative_link_titles: ["Les best-sellers sont de retour"],
    ad_creative_link_descriptions: ["Commander maintenant"],
    ad_delivery_start_time: "2025-02-15",
    impressions: { lower_bound: "50000", upper_bound: "200000" },
  },
  {
    ad_creative_bodies: [
      "Rejoignez plus de 200 000 clients satisfaits. Qualité premium, prix juste. Essayez maintenant avec la livraison offerte.",
    ],
    ad_creative_link_titles: ["Essayer maintenant"],
    ad_creative_link_descriptions: ["Retours gratuits sous 30 jours"],
    ad_delivery_start_time: "2025-01-20",
    impressions: { lower_bound: "100000", upper_bound: "500000" },
  },
  {
    ad_creative_bodies: [
      "Vous cherchez le cadeau parfait ? Nos coffrets sont disponibles avec une livraison express garantie avant J+2.",
    ],
    ad_creative_link_titles: ["Idées cadeaux"],
    ad_creative_link_descriptions: ["Livraison express disponible"],
    ad_delivery_start_time: "2025-04-25",
    impressions: { lower_bound: "2000", upper_bound: "8000" },
  },
  {
    ad_creative_bodies: [
      "Fabriqué en France, pensé pour durer. Chaque produit est conçu pour minimiser son impact environnemental.",
    ],
    ad_creative_link_titles: ["Notre engagement éco"],
    ad_creative_link_descriptions: ["En savoir plus"],
    ad_delivery_start_time: "2025-03-18",
    impressions: { lower_bound: "20000", upper_bound: "80000" },
  },
];

export function getMockAds(pageId: string, count = 5): MetaAd[] {
  // Deterministic shuffle based on pageId so each brand has consistent mock ads
  const seed = pageId
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  return Array.from({ length: count }, (_, i) => ({
    id: `mock_${pageId}_${i}`,
    page_name: "Mock Brand",
    ...pool[(seed + i) % pool.length],
  }));
}
