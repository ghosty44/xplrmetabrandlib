-- Remove FK constraint from Ad, then drop Brand table
ALTER TABLE "Ad" DROP CONSTRAINT IF EXISTS "Ad_brandId_fkey";
DROP TABLE IF EXISTS "Brand";
