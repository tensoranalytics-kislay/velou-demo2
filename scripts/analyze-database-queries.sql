-- Database Analysis Queries - Phase 1
-- Run these queries directly in PostgreSQL to understand current data structure

-- ============================================================================
-- 1. BASIC STATISTICS
-- ============================================================================

-- Total products
SELECT COUNT(*) as total_products
FROM "Product"
WHERE "isActive" = true;

-- Products by merchant
SELECT 
  m.name as merchant_name,
  COUNT(*) as product_count
FROM "Product" p
JOIN "Merchant" m ON m.id = p."merchantId"
WHERE p."isActive" = true
GROUP BY m.id, m.name
ORDER BY product_count DESC;

-- ============================================================================
-- 2. DEDUPLICATION KEY ANALYSIS
-- ============================================================================

-- Products with parent_id
SELECT COUNT(*) as products_with_parent_id
FROM "Product"
WHERE "isActive" = true
  AND attributes->>'parent_id' IS NOT NULL
  AND attributes->>'parent_id' != '';

-- Products with related_id
SELECT COUNT(*) as products_with_related_id
FROM "Product"
WHERE "isActive" = true
  AND attributes->>'related_id' IS NOT NULL
  AND attributes->>'related_id' != '';

-- Products with shopifyProductId
SELECT COUNT(*) as products_with_shopify_id
FROM "Product"
WHERE "isActive" = true
  AND "shopifyProductId" IS NOT NULL;

-- Products with sourceId
SELECT COUNT(*) as products_with_source_id
FROM "Product"
WHERE "isActive" = true
  AND "sourceId" IS NOT NULL;

-- Products without any deduplication key
SELECT COUNT(*) as products_without_dedup_key
FROM "Product"
WHERE "isActive" = true
  AND (attributes->>'parent_id' IS NULL OR attributes->>'parent_id' = '')
  AND (attributes->>'related_id' IS NULL OR attributes->>'related_id' = '')
  AND "shopifyProductId" IS NULL
  AND "sourceId" IS NULL;

-- ============================================================================
-- 3. DUPLICATE GROUP ANALYSIS
-- ============================================================================

-- Group products by parent_id
SELECT 
  attributes->>'parent_id' as parent_id,
  COUNT(*) as variant_count,
  array_agg(id ORDER BY "createdAt") as product_ids,
  array_agg(title ORDER BY "createdAt") as titles
FROM "Product"
WHERE "isActive" = true
  AND attributes->>'parent_id' IS NOT NULL
  AND attributes->>'parent_id' != ''
GROUP BY attributes->>'parent_id'
HAVING COUNT(*) > 1
ORDER BY variant_count DESC
LIMIT 20;

-- Group products by related_id
SELECT 
  attributes->>'related_id' as related_id,
  COUNT(*) as variant_count,
  array_agg(id ORDER BY "createdAt") as product_ids
FROM "Product"
WHERE "isActive" = true
  AND attributes->>'related_id' IS NOT NULL
  AND attributes->>'related_id' != ''
GROUP BY attributes->>'related_id'
HAVING COUNT(*) > 1
ORDER BY variant_count DESC
LIMIT 20;

-- Group products by shopifyProductId
SELECT 
  "shopifyProductId",
  COUNT(*) as variant_count,
  array_agg(id ORDER BY "createdAt") as product_ids
FROM "Product"
WHERE "isActive" = true
  AND "shopifyProductId" IS NOT NULL
GROUP BY "shopifyProductId"
HAVING COUNT(*) > 1
ORDER BY variant_count DESC
LIMIT 20;

-- Group products by sourceId pattern (base ID without size suffix)
SELECT 
  regexp_replace("sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\d+)$', '', 'i') as base_source_id,
  COUNT(*) as variant_count,
  array_agg(id ORDER BY "createdAt") as product_ids
FROM "Product"
WHERE "isActive" = true
  AND "sourceId" IS NOT NULL
GROUP BY regexp_replace("sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\d+)$', '', 'i')
HAVING COUNT(*) > 1
ORDER BY variant_count DESC
LIMIT 20;

-- ============================================================================
-- 4. SIZE DISTRIBUTION
-- ============================================================================

-- Extract sizes from attributes.sizes (array)
SELECT 
  size_val as size,
  COUNT(*) as count
FROM "Product",
  jsonb_array_elements_text(COALESCE(attributes->'sizes', '[]'::jsonb)) as size_val
WHERE "isActive" = true
GROUP BY size_val
ORDER BY count DESC
LIMIT 30;

-- Extract sizes from attributes.size (string)
SELECT 
  attributes->>'size' as size,
  COUNT(*) as count
FROM "Product"
WHERE "isActive" = true
  AND attributes->>'size' IS NOT NULL
GROUP BY attributes->>'size'
ORDER BY count DESC
LIMIT 30;

-- Extract sizes from sourceId pattern
SELECT 
  (regexp_match("sourceId", '[-_](size[_-])?([smlx\d]+)$', 'i'))[2] as size,
  COUNT(*) as count
FROM "Product"
WHERE "isActive" = true
  AND "sourceId" IS NOT NULL
  AND "sourceId" ~* '[-_](size[_-])?([smlx\d]+)$'
GROUP BY (regexp_match("sourceId", '[-_](size[_-])?([smlx\d]+)$', 'i'))[2]
ORDER BY count DESC
LIMIT 30;

-- ============================================================================
-- 5. CATEGORY DISTRIBUTION
-- ============================================================================

SELECT 
  category,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM "Product" WHERE "isActive" = true), 2) as percentage
FROM "Product"
WHERE "isActive" = true
GROUP BY category
ORDER BY count DESC
LIMIT 30;

-- ============================================================================
-- 6. SAMPLE DUPLICATE PRODUCTS
-- ============================================================================

-- Sample products that share parent_id
SELECT 
  p1.id,
  p1.title,
  p1.attributes->>'parent_id' as parent_id,
  p1.attributes->>'sizes' as sizes,
  p1.attributes->>'size' as size,
  p1."sourceId",
  p1."shopifyProductId"
FROM "Product" p1
WHERE p1."isActive" = true
  AND p1.attributes->>'parent_id' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Product" p2
    WHERE p2."isActive" = true
      AND p2.attributes->>'parent_id' = p1.attributes->>'parent_id'
      AND p2.id != p1.id
  )
ORDER BY p1.attributes->>'parent_id', p1."createdAt"
LIMIT 30;

-- ============================================================================
-- 7. ESTIMATE UNIQUE PRODUCTS
-- ============================================================================

-- Estimate unique products using deduplication logic
WITH dedup_keys AS (
  SELECT 
    id,
    COALESCE(
      -- Extract Shopify product ID from id
      (SELECT (regexp_match(id, '.*shopify[^0-9]*([0-9]{9,})', 'i'))[1]),
      -- parent_id
      NULLIF(attributes->>'parent_id', ''),
      -- related_id
      NULLIF(attributes->>'related_id', ''),
      -- shopifyProductId
      NULLIF("shopifyProductId"::text, ''),
      -- sourceId base (strip size suffix)
      CASE
        WHEN "sourceId" IS NOT NULL AND "sourceId" != ''
        THEN regexp_replace("sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\d+)$', '', 'i')
        ELSE NULL
      END,
      -- Fallback: product id
      id
    ) as dedup_key
  FROM "Product"
  WHERE "isActive" = true
)
SELECT 
  COUNT(DISTINCT dedup_key) as estimated_unique_products,
  COUNT(*) as total_products,
  ROUND(COUNT(*)::numeric / COUNT(DISTINCT dedup_key), 2) as avg_variants_per_product
FROM dedup_keys;

-- ============================================================================
-- 8. EMBEDDING ANALYSIS
-- ============================================================================

-- Products with embeddings
SELECT 
  COUNT(*) as products_with_embeddings,
  COUNT(*) * 1536 * 4 as estimated_embedding_size_bytes,
  ROUND(COUNT(*) * 1536 * 4 / 1024.0 / 1024.0, 2) as estimated_embedding_size_mb
FROM "Product"
WHERE "isActive" = true
  AND embedding IS NOT NULL;

-- Estimate storage savings from deduplication
WITH dedup_keys AS (
  SELECT 
    COALESCE(
      (SELECT (regexp_match(id, '.*shopify[^0-9]*([0-9]{9,})', 'i'))[1]),
      NULLIF(attributes->>'parent_id', ''),
      NULLIF(attributes->>'related_id', ''),
      NULLIF("shopifyProductId"::text, ''),
      CASE
        WHEN "sourceId" IS NOT NULL AND "sourceId" != ''
        THEN regexp_replace("sourceId", '[-_](size|color|variant|s|m|l|xl|xs|xxl|\d+)$', '', 'i')
        ELSE NULL
      END,
      id
    ) as dedup_key
  FROM "Product"
  WHERE "isActive" = true
    AND embedding IS NOT NULL
)
SELECT 
  COUNT(DISTINCT dedup_key) as unique_products_with_embeddings,
  COUNT(*) as total_embeddings,
  ROUND((1 - COUNT(DISTINCT dedup_key)::numeric / COUNT(*)) * 100, 1) as embedding_duplication_percentage,
  ROUND((COUNT(*) - COUNT(DISTINCT dedup_key)) * 1536 * 4 / 1024.0 / 1024.0, 2) as wasted_embedding_storage_mb
FROM dedup_keys;










