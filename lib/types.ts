import type { Ad, Board } from "@prisma/client";
import type { NotionBrand } from "@/lib/notion";

export type Brand = NotionBrand;

export type AdWithBrand = Ad & {
  brand: Brand;
};

export type { Board, Ad };
