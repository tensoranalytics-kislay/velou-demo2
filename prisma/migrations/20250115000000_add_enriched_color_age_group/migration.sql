-- Add enrichedColor and ageGroup columns for enriched 2.csv dataset
-- Migration: add_enriched_color_age_group

-- Add enrichedColor column (user-friendly color terms)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "enrichedColor" TEXT;

-- Add ageGroup column (age categories)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "ageGroup" TEXT;

-- Create indexes for fast filtering
CREATE INDEX IF NOT EXISTS "idx_product_enriched_color" ON "Product"("enrichedColor");
CREATE INDEX IF NOT EXISTS "idx_product_age_group" ON "Product"("ageGroup");
CREATE INDEX IF NOT EXISTS "idx_product_category_subcategory" ON "Product"("category", "subcategory");


