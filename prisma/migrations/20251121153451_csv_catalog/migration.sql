-- AlterTable
ALTER TABLE "Product"
ADD COLUMN     "productUrl" TEXT,
ADD COLUMN     "salePriceCents" INTEGER;

UPDATE "Product"
SET "productUrl" = COALESCE("attributes" ->> 'productUrl', 'https://placeholder.local/product/' || "id")
WHERE "productUrl" IS NULL;

ALTER TABLE "Product"
ALTER COLUMN "productUrl" SET NOT NULL;

