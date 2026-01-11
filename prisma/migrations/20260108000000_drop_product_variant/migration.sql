-- DropProductVariant
-- This migration removes the ProductVariant model and all related indexes/constraints

-- Drop foreign key constraint from ProductVariant to Product
ALTER TABLE "ProductVariant" DROP CONSTRAINT IF EXISTS "ProductVariant_productId_fkey";

-- Drop all indexes on ProductVariant
DROP INDEX IF EXISTS "idx_variant_product_id";
DROP INDEX IF EXISTS "idx_variant_size";
DROP INDEX IF EXISTS "idx_variant_color";
DROP INDEX IF EXISTS "idx_variant_stock_status";
DROP INDEX IF EXISTS "idx_variant_shopify_id";
DROP INDEX IF EXISTS "idx_variant_source_id";
DROP INDEX IF EXISTS "idx_variant_product_size";
DROP INDEX IF EXISTS "idx_variant_size_stock";
DROP INDEX IF EXISTS "unique_product_variant";

-- Drop the ProductVariant table
DROP TABLE IF EXISTS "ProductVariant";




