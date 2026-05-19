import type { Ad, Brand, Board } from "@prisma/client";

export type AdWithBrand = Ad & {
  brand: Brand;
};

export type { Brand, Board, Ad };
