-- Phase 2: Add ProductVariant model and indexed columns to Product
-- This migration adds:
-- 1. ProductVariant table for size/color variants
-- 2. Indexed columns to Product (color, fabric, material, occasion, season, fit)
-- 3. New indexes for fast constraint filtering
-- 4. Backward compatible (keeps existing attributes JSONB field)

-- ============================================================================
-- 1. Add indexed columns to Product table (nullable for backward compatibility)
-- ============================================================================

ALTER TABLE "Product" 
  ADD COLUMN IF NOT EXISTS "color" TEXT,
  ADD COLUMN IF NOT EXISTS "fabric" TEXT,
  ADD COLUMN IF NOT EXISTS "material" TEXT,
  ADD COLUMN IF NOT EXISTS "occasion" TEXT,
  ADD COLUMN IF NOT EXISTS "season" TEXT,
  ADD COLUMN IF NOT EXISTS "fit" TEXT;

-- ============================================================================
-- 2. Create ProductVariant table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ProductVariant" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "size" TEXT,
  "color" TEXT,
  "sku" TEXT,
  "barcode" TEXT,
  "priceCents" INTEGER,
  "salePriceCents" INTEGER,
  "stockStatus" "StockStatus" NOT NULL DEFAULT 'in_stock',
  "inventoryQuantity" INTEGER,
  "shopifyVariantId" TEXT,
  "shopifyVariantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceId" TEXT,
  "vendorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- 3. Add foreign key constraint
-- ============================================================================

ALTER TABLE "ProductVariant" 
  ADD CONSTRAINT "ProductVariant_productId_fkey" 
  FOREIGN KEY ("productId") 
  REFERENCES "Product"("id") 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;

-- ============================================================================
-- 4. Add unique constraint (prevent duplicate variants)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "unique_product_variant" 
  ON "ProductVariant"("productId", "size", "color");

-- ============================================================================
-- 5. Add indexes to ProductVariant
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_variant_product_id" 
  ON "ProductVariant"("productId");

CREATE INDEX IF NOT EXISTS "idx_variant_size" 
  ON "ProductVariant"("size") 
  WHERE "size" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_variant_color" 
  ON "ProductVariant"("color") 
  WHERE "color" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_variant_stock_status" 
  ON "ProductVariant"("stockStatus");

CREATE INDEX IF NOT EXISTS "idx_variant_shopify_id" 
  ON "ProductVariant"("shopifyVariantId") 
  WHERE "shopifyVariantId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_variant_source_id" 
  ON "ProductVariant"("sourceId") 
  WHERE "sourceId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_variant_product_size" 
  ON "ProductVariant"("productId", "size");

CREATE INDEX IF NOT EXISTS "idx_variant_size_stock" 
  ON "ProductVariant"("size", "stockStatus") 
  WHERE "stockStatus" = 'in_stock';

-- ============================================================================
-- 6. Add new indexes to Product table
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_product_color" 
  ON "Product"("color") 
  WHERE "color" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_product_fabric" 
  ON "Product"("fabric") 
  WHERE "fabric" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_product_material" 
  ON "Product"("material") 
  WHERE "material" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_product_occasion" 
  ON "Product"("occasion") 
  WHERE "occasion" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_product_season" 
  ON "Product"("season") 
  WHERE "season" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_product_fit" 
  ON "Product"("fit") 
  WHERE "fit" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_product_source_id" 
  ON "Product"("sourceId") 
  WHERE "sourceId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_product_category_color" 
  ON "Product"("category", "color") 
  WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS "idx_product_merchant_category" 
  ON "Product"("merchantId", "category") 
  WHERE "isActive" = true;

-- ============================================================================
-- Migration complete
-- ============================================================================
-- Note: This migration is backward compatible:
-- - Existing Product rows continue to work (new columns are nullable)
-- - Existing attributes JSONB field is preserved
-- - ProductVariant table is empty initially (will be populated in Phase 3)
-- ============================================================================










