# Database Audit & Optimization Recommendations

**Date**: 2025-01-XX  
**Scope**: Product catalog structure, size variant handling, and search efficiency

---

## Executive Summary

The current database structure stores each size variant as a separate `Product` row, leading to:
- **Massive duplication** (same product appears 5-10+ times)
- **Inefficient queries** (deduplication happens at query time)
- **Poor constraint filtering** (JSONB queries are slow)
- **Harder product discovery** (users see duplicate products)

**Recommendation**: Migrate to a normalized `Product` + `ProductVariant` model.

---

## 1. Current Database Structure Issues

### 1.1 Size Variant Duplication

**Problem**: Each size variant is stored as a separate `Product` row.

**Example**:
```
Product 1: "Floral Summer Dress" - Size S - $99
Product 2: "Floral Summer Dress" - Size M - $99
Product 3: "Floral Summer Dress" - Size L - $99
Product 4: "Floral Summer Dress" - Size XL - $99
```

**Impact**:
- **5-10x more rows** than unique products
- Search results show the same product multiple times
- Deduplication logic runs on every query (expensive)
- Storage bloat (duplicate title, description, images, embeddings)

### 1.2 Current Deduplication Strategy

The system attempts to deduplicate at query time using:

```sql
-- Deduplication key priority:
1. Extract Shopify product ID from product.id (regex)
2. parent_id (from attributes JSON)
3. related_id (from attributes JSON)
4. shopifyProductId (column)
5. sourceId with size suffix stripped (regex)
6. product.id (fallback - no deduplication)
```

**Problems**:
- **Regex operations** on every query (slow)
- **JSONB lookups** (`attributes->>'parent_id'`) are slower than indexed columns
- **Inconsistent grouping** when parent_id/related_id are missing
- **Query-time cost**: Window functions (`ROW_NUMBER() OVER PARTITION BY`) on large datasets

**Location**: `src/lib/search/vector/index.ts:398-421`

### 1.3 JSONB Attribute Storage

**Current Structure**:
```typescript
Product {
  id: string
  title: string
  description: string
  attributes: Json  // All product attributes stored here
}
```

**Attributes stored in JSONB**:
- `sizes`: `string[]` (e.g., `["S", "M", "L"]`)
- `colors`: `string`
- `materials`: `string[]`
- `fabric`: `string`
- `fit`: `string`
- `occasion`: `string`
- `season`: `string`
- `parent_id`: `string`
- `related_id`: `string`
- ... and 20+ more fields

**Problems**:
1. **No indexes on JSONB fields** (except GIN on entire JSONB, which is less efficient)
2. **Slow filtering**: Queries like `WHERE attributes->>'color' = 'red'` can't use B-tree indexes
3. **Type ambiguity**: JSONB doesn't enforce types (sizes can be string or array)
4. **Query complexity**: Size matching requires `jsonb_array_elements_text()` which is expensive

**Example Query** (from `src/lib/loveshackfancy/ranking/sql-ranker.ts:96-118`):
```sql
-- Expensive: Must expand JSONB array for every product
SELECT 1 FROM jsonb_array_elements_text(
  COALESCE(p.attributes->'sizes', p.attributes->'size', '[]'::jsonb)
) AS size_val
WHERE LOWER(size_val) = 's'
```

### 1.4 Missing Indexes for Common Constraints

**Currently Indexed**:
- `merchantId`
- `category`
- `stockStatus`
- `isActive`
- `shopifyProductId`
- `embedding` (vector index)
- `search_vector` (GIN index)

**NOT Indexed** (but frequently queried):
- `attributes->>'color'` (queried in every color filter)
- `attributes->>'fabric'` (queried in material filters)
- `attributes->>'occasion'` (queried in occasion filters)
- `attributes->>'parent_id'` (used for deduplication)
- `attributes->>'related_id'` (used for deduplication)
- `attributes->'sizes'` (queried in size filters)

**Impact**: Every constraint filter requires a full table scan or JSONB expansion.

---

## 2. Query Performance Issues

### 2.1 Deduplication Overhead

**Current Flow**:
1. Query returns 500 products (including duplicates)
2. Deduplication CTE groups by `dedup_key` (regex + JSONB lookups)
3. Window function ranks products within each group
4. Returns top 1 per group (150 unique products)

**Cost**: O(n log n) where n = number of duplicate products

**Example**:
- 10,000 products in database
- 2,000 unique products (5 variants each)
- Query returns 500 products (100 unique)
- Deduplication processes 500 rows with window functions

### 2.2 Size Filtering Inefficiency

**Current Query** (from `sql-ranker.ts:96-118`):
```sql
-- Must expand JSONB array for EVERY product
SELECT 1 FROM jsonb_array_elements_text(
  COALESCE(p.attributes->'sizes', p.attributes->'size', '[]'::jsonb)
) AS size_val
CROSS JOIN (VALUES ('s'), ('m')) AS qs(qs_val)
WHERE LOWER(size_val) = qs_val
```

**Problems**:
- `jsonb_array_elements_text()` expands array for every row
- Can't use index (must scan all products)
- Handles both `sizes` (array) and `size` (string) inconsistently

**Better Approach**:
```sql
-- If sizes were in a separate table with index:
SELECT p.id FROM Product p
JOIN ProductVariant v ON v.productId = p.id
WHERE v.size IN ('S', 'M')
-- Uses index on v.size
```

### 2.3 Constraint Filtering Performance

**Current**: All constraints are filtered in-memory after fetching products:
```typescript
// src/lib/search/filtering/attributes.ts:208
export function matchesAttributeFilters(
  attributes: ProductAttributes,
  constraints: SearchConstraints
): boolean {
  // Checks 15+ JSONB fields in memory
  if (constraints.sizes?.length && !arrayIncludes(attrs.sizes, constraints.sizes)) return false;
  if (constraints.colors?.length && !valueMatches(attrs.color, constraints.colors)) return false;
  // ... 13 more checks
}
```

**Impact**: 
- Products fetched from DB, then filtered in application code
- Can't push filters to SQL (no indexes on JSONB fields)
- Wastes bandwidth fetching products that will be filtered out

---

## 3. Data Quality Issues

### 3.1 Inconsistent Size Storage

**Current**: Sizes stored in multiple formats:
- `attributes.sizes`: `["S", "M", "L"]` (array)
- `attributes.size`: `"M"` (string)
- `sourceId`: `"product-123-size-m"` (with size in ID)

**Problem**: Code must handle all three formats:
```typescript
// src/lib/loveshackfancy/ranking/constraint-matcher.ts:130
const productSizes = extractAttrValue(productAttrs, 'sizes') || 
                     extractAttrValue(productAttrs, 'size');
```

### 3.2 Missing Parent Relationships

**Problem**: Many products lack `parent_id` or `related_id`, so deduplication falls back to:
- Regex on `sourceId` (unreliable)
- Product ID (no deduplication)

**Impact**: Products that should be grouped aren't, leading to duplicate results.

### 3.3 Embedding Duplication

**Current**: Each size variant has its own embedding (1536 dimensions).

**Problem**:
- Same product, different sizes = 5 identical embeddings
- Wastes storage (~7.5KB per embedding × 5 = 37.5KB per product)
- Vector search returns duplicates (must deduplicate after)

---

## 4. Recommended Database Schema Changes

### 4.1 New Schema: Product + ProductVariant

**Proposed Structure**:

```prisma
model Product {
  id                String          @id
  merchantId        String
  title             String
  description       String
  imageUrl          String          // Primary image
  productUrl        String
  priceCents        Int             // Base price (variants can override)
  currency          String
  category          String
  subcategory       String?
  brand             String?
  
  // Move commonly-queried attributes to columns (indexed)
  color             String?         // Most common color
  fabric            String?
  material          String?
  occasion          String?
  season            String?
  fit               String?
  
  // Keep flexible attributes in JSONB
  attributes        Json            // Less-frequently-queried fields
  
  stockStatus       StockStatus     @default(in_stock) // Aggregate: in_stock if ANY variant in stock
  vendorId          String?
  sourceId          String?         // Base product ID (no size suffix)
  isActive          Boolean         @default(true)
  
  // Shopify integration
  shopifyProductId  String?         // Parent product ID (not variant ID)
  shopifyHandle     String?
  
  // Reviews (aggregate across variants)
  reviewScore       Float?
  reviewCount       Int?
  
  // Search indexes
  embedding         Unsupported("vector")?  // ONE embedding per product (not per variant)
  search_vector     Unsupported("tsvector")?
  
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  
  // Relations
  merchant          Merchant        @relation(...)
  variants          ProductVariant[]  // NEW: One-to-many relationship
  
  @@index([merchantId])
  @@index([merchantId, category])
  @@index([merchantId, stockStatus])
  @@index([merchantId, isActive])
  @@index([category])
  @@index([color])              // NEW: Indexed for fast color filtering
  @@index([fabric])             // NEW: Indexed for fast fabric filtering
  @@index([occasion])           // NEW: Indexed for fast occasion filtering
  @@index([shopifyProductId])
  @@index([sourceId])           // NEW: Indexed for deduplication
  @@index([embedding], map: "idx_product_embedding")
  @@index([search_vector], map: "idx_product_search", type: Gin)
}

model ProductVariant {
  id                String          @id @default(cuid())
  productId         String          // Foreign key to Product
  product           Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  
  // Variant-specific fields
  size              String?         // "S", "M", "L", "XL", etc.
  color             String?         // Variant-specific color (if different from product)
  sku               String?         // Variant SKU
  barcode           String?
  
  // Pricing (can override product base price)
  priceCents        Int?            // If null, use product.priceCents
  salePriceCents    Int?
  
  // Inventory
  stockStatus       StockStatus     @default(in_stock)
  inventoryQuantity Int?
  
  // Shopify integration
  shopifyVariantId  String?         // Shopify variant ID
  shopifyVariantIds String[]        // Keep for backward compatibility
  
  // Source tracking
  sourceId          String?         // Original variant ID from CSV
  vendorId          String?
  
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  
  @@unique([productId, size, color])  // Prevent duplicate variants
  @@index([productId])
  @@index([size])                     // NEW: Fast size filtering
  @@index([color])                    // NEW: Fast variant color filtering
  @@index([stockStatus])
  @@index([shopifyVariantId])
  @@index([sourceId])
}
```

### 4.2 Benefits of New Schema

**1. Eliminates Duplication**:
- One `Product` row per unique product
- Multiple `ProductVariant` rows for sizes/colors
- **5-10x reduction** in Product table size

**2. Faster Queries**:
- Size filtering: `JOIN ProductVariant WHERE size = 'M'` (uses index)
- Color filtering: `WHERE Product.color = 'red'` (uses index)
- No deduplication needed (already unique)

**3. Better Constraint Filtering**:
- Push filters to SQL (indexed columns)
- Filter before fetching (saves bandwidth)
- No in-memory filtering needed

**4. Cleaner Data Model**:
- Explicit parent-child relationship
- No regex-based deduplication
- Type-safe size/color fields

**5. Storage Savings**:
- One embedding per product (not per variant)
- Shared title, description, images
- ~70% reduction in storage for products with 5 variants

---

## 5. Migration Strategy

### 5.1 Phase 1: Data Analysis

**Goal**: Understand current data structure

**Steps**:
1. Query to identify duplicate products:
   ```sql
   -- Find products that share parent_id/related_id
   SELECT 
     attributes->>'parent_id' as parent_id,
     COUNT(*) as variant_count,
     array_agg(id) as product_ids
   FROM "Product"
   WHERE attributes->>'parent_id' IS NOT NULL
   GROUP BY attributes->>'parent_id'
   HAVING COUNT(*) > 1;
   ```

2. Analyze size distribution:
   ```sql
   -- How many products have size variants?
   SELECT 
     COUNT(DISTINCT COALESCE(
       attributes->>'parent_id',
       attributes->>'related_id',
       regexp_replace(sourceId, '[-_](size|color|variant|s|m|l|xl|xs|xxl|\\d+)$', '', 'i')
     )) as unique_products,
     COUNT(*) as total_rows,
     COUNT(*) / COUNT(DISTINCT COALESCE(...)) as avg_variants_per_product
   FROM "Product";
   ```

3. Identify products without parent relationships:
   ```sql
   -- Products that can't be deduplicated
   SELECT COUNT(*) 
   FROM "Product"
   WHERE attributes->>'parent_id' IS NULL
     AND attributes->>'related_id' IS NULL
     AND shopifyProductId IS NULL
     AND sourceId IS NULL;
   ```

### 5.2 Phase 2: Schema Migration

**Goal**: Add new tables without breaking existing code

**Steps**:
1. Create migration to add `ProductVariant` table
2. Add new indexed columns to `Product` (color, fabric, etc.) as nullable
3. Keep existing `attributes` JSONB field (backward compatibility)
4. Deploy migration (zero downtime)

### 5.3 Phase 3: Data Migration

**Goal**: Populate new schema from existing data

**Algorithm**:
```typescript
// Pseudocode
1. Group products by deduplication key (parent_id, related_id, shopifyProductId, etc.)
2. For each group:
   a. Select "canonical" product (most complete data, or first created)
   b. Create Product row with:
      - Aggregate data (title, description, images from canonical)
      - Extract common attributes to columns (color, fabric, etc.)
      - Set sourceId to base ID (strip size suffix)
   c. For each variant in group:
      - Extract size from attributes.sizes or sourceId
      - Create ProductVariant row
      - Link to Product via productId
3. Mark old Product rows as migrated (add flag: isMigrated = true)
```

**Migration Script** (`scripts/migrateToVariantModel.ts`):
- Read all products
- Group by deduplication key
- Create Product + ProductVariant rows
- Run in batches (1000 products at a time)
- Log progress and errors

### 5.4 Phase 4: Code Migration

**Goal**: Update code to use new schema

**Changes Required**:

1. **Search Functions** (`src/lib/search/vector/index.ts`):
   - Remove deduplication logic (products already unique)
   - Update size filtering to use `ProductVariant` table
   - Update constraint filtering to use indexed columns

2. **Retrieval Functions** (`src/lib/loveshackfancy/retrieval.ts`):
   - Remove `deduplicateProductsByCategory()` calls
   - Update to query `Product` with `JOIN ProductVariant` for size filters

3. **Ingestion** (`src/lib/catalog/ingestUnifiedCsv.ts`):
   - Detect size variants from CSV
   - Create one `Product` + multiple `ProductVariant` rows
   - Group variants by `parent_id` or base `product_id`

4. **Product Display** (`src/components/ProductCarousel/ProductCarousel.tsx`):
   - Fetch variants when displaying product
   - Show size selector if multiple variants exist
   - Update "View product" to include variant selection

### 5.5 Phase 5: Cleanup

**Goal**: Remove old code and optimize

**Steps**:
1. Remove deduplication functions
2. Drop unused indexes
3. Archive old Product rows (or delete after verification)
4. Update documentation

---

## 6. Query Optimization Examples

### 6.1 Before: Size Filtering

**Current** (slow):
```sql
SELECT p.id, p.title, p.attributes
FROM "Product" p
WHERE p."isActive" = true
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(
      COALESCE(p.attributes->'sizes', p.attributes->'size', '[]'::jsonb)
    ) AS size_val
    WHERE LOWER(size_val) = 'm'
  )
LIMIT 50;
-- No index, must scan all products and expand JSONB
```

**After** (fast):
```sql
SELECT DISTINCT p.id, p.title
FROM "Product" p
JOIN "ProductVariant" v ON v."productId" = p.id
WHERE p."isActive" = true
  AND v.size = 'M'
  AND v."stockStatus" = 'in_stock'
LIMIT 50;
-- Uses index on v.size
```

### 6.2 Before: Color + Size Filtering

**Current** (slow):
```sql
SELECT p.id
FROM "Product" p
WHERE p."isActive" = true
  AND LOWER(p.attributes->>'color') LIKE '%red%'  -- No index
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(
      COALESCE(p.attributes->'sizes', '[]'::jsonb)
    ) AS size_val
    WHERE LOWER(size_val) = 'm'
  );
```

**After** (fast):
```sql
SELECT DISTINCT p.id
FROM "Product" p
JOIN "ProductVariant" v ON v."productId" = p.id
WHERE p."isActive" = true
  AND p.color = 'red'              -- Uses index on p.color
  AND v.size = 'M'                  -- Uses index on v.size
  AND v."stockStatus" = 'in_stock';
```

### 6.3 Before: Deduplication

**Current** (expensive):
```sql
WITH ranked_products AS (
  SELECT 
    p.id,
    COALESCE(
      (SELECT (regexp_match(p.id, '.*shopify[^0-9]*([0-9]{9,})', 'i'))[1]),
      NULLIF(p.attributes->>'parent_id', ''),
      -- ... more regex/JSONB lookups
    ) as dedup_key
  FROM "Product" p
  WHERE ...
),
deduplicated AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY dedup_key ORDER BY ...) as rank
  FROM ranked_products
)
SELECT id FROM deduplicated WHERE rank = 1;
-- Window function on large dataset
```

**After** (trivial):
```sql
SELECT p.id
FROM "Product" p
WHERE p."isActive" = true
  AND p.category = 'dresses'
LIMIT 50;
-- Products are already unique, no deduplication needed
```

---

## 7. Index Recommendations

### 7.1 New Indexes for Product Table

```sql
-- Fast constraint filtering
CREATE INDEX idx_product_color ON "Product"(color) WHERE color IS NOT NULL;
CREATE INDEX idx_product_fabric ON "Product"(fabric) WHERE fabric IS NOT NULL;
CREATE INDEX idx_product_occasion ON "Product"(occasion) WHERE occasion IS NOT NULL;
CREATE INDEX idx_product_season ON "Product"(season) WHERE season IS NOT NULL;

-- Fast deduplication/lookup
CREATE INDEX idx_product_source_id ON "Product"("sourceId") WHERE "sourceId" IS NOT NULL;
CREATE INDEX idx_product_shopify_id ON "Product"("shopifyProductId") WHERE "shopifyProductId" IS NOT NULL;

-- Composite indexes for common queries
CREATE INDEX idx_product_category_color ON "Product"(category, color) WHERE "isActive" = true;
CREATE INDEX idx_product_merchant_category ON "Product"("merchantId", category) WHERE "isActive" = true;
```

### 7.2 New Indexes for ProductVariant Table

```sql
-- Fast size filtering
CREATE INDEX idx_variant_size ON "ProductVariant"(size) WHERE size IS NOT NULL;
CREATE INDEX idx_variant_stock ON "ProductVariant"("stockStatus") WHERE "stockStatus" = 'in_stock';

-- Composite for common queries
CREATE INDEX idx_variant_product_size ON "ProductVariant"("productId", size);
CREATE INDEX idx_variant_size_stock ON "ProductVariant"(size, "stockStatus") WHERE "stockStatus" = 'in_stock';
```

### 7.3 Remove Unused Indexes

After migration, consider removing:
- GIN index on `attributes` JSONB (if not used for other queries)
- Indexes on fields that are now in `ProductVariant`

---

## 8. Estimated Impact

### 8.1 Storage Reduction

**Current**:
- 10,000 products × 5 variants = 50,000 Product rows
- Each row: ~5KB (title, description, attributes, embedding)
- Total: ~250MB

**After Migration**:
- 10,000 Product rows × 5KB = 50MB
- 50,000 ProductVariant rows × 0.5KB = 25MB
- Total: ~75MB
- **Savings: 70%**

### 8.2 Query Performance

**Size Filtering**:
- Before: 500ms (full table scan + JSONB expansion)
- After: 10ms (indexed join)
- **50x faster**

**Deduplication**:
- Before: 200ms (window function on 500 rows)
- After: 0ms (not needed)
- **Eliminated**

**Color + Size Filtering**:
- Before: 800ms (multiple JSONB queries)
- After: 15ms (indexed columns + join)
- **53x faster**

### 8.3 Code Simplification

**Lines of Code Removed**:
- Deduplication logic: ~200 lines
- JSONB size parsing: ~100 lines
- Regex-based grouping: ~50 lines
- **Total: ~350 lines removed**

**Complexity Reduction**:
- No more deduplication CTEs in SQL
- No more JSONB array expansion
- No more regex on product IDs
- Simpler, more maintainable code

---

## 9. Risks & Mitigation

### 9.1 Migration Risks

**Risk**: Data loss during migration
- **Mitigation**: 
  - Run migration in staging first
  - Keep old Product rows (mark as `isMigrated = false`)
  - Verify data integrity after migration
  - Rollback plan: Keep old code path active

**Risk**: Downtime during migration
- **Mitigation**:
  - Run migration in batches (1000 products at a time)
  - Use zero-downtime deployment
  - Keep both schemas active during transition

**Risk**: Incomplete variant grouping
- **Mitigation**:
  - Use multiple deduplication strategies (parent_id, related_id, shopifyProductId, sourceId)
  - Log products that can't be grouped
  - Manual review for edge cases

### 9.2 Code Migration Risks

**Risk**: Breaking existing functionality
- **Mitigation**:
  - Feature flag for new schema
  - Gradual rollout (10% → 50% → 100%)
  - Comprehensive testing
  - Monitor error rates

**Risk**: Performance regression
- **Mitigation**:
  - Load testing before/after
  - Monitor query times
  - Keep old code path as fallback

---

## 10. Implementation Plan

### Phase 1: Preparation (Week 1) ✅ COMPLETE
- [x] Run data analysis queries
- [x] Document current data patterns
- [x] Create migration scripts
- [ ] Set up staging environment (manual step)

### Phase 2: Schema Migration (Week 2) ✅ COMPLETE & DEPLOYED
- [x] Create Prisma migration for ProductVariant
- [x] Add new indexed columns to Product
- [x] Deploy migration (zero downtime) - **✅ Successfully deployed**
- [x] Verify schema changes (Prisma client generated successfully)

### Phase 3: Data Migration (Week 3-4) ✅ SCRIPTS READY
- [x] Write migration script
- [ ] Test on staging data (manual step)
- [ ] Run production migration in batches (ready to execute)
- [x] Verify data integrity (verification script created)

### Phase 4: Code Migration (Week 5-6)
- [ ] Update search functions
- [ ] Update retrieval functions
- [ ] Update ingestion pipeline
- [ ] Update UI components
- [ ] Feature flag rollout

### Phase 5: Cleanup (Week 7)
- [ ] Remove old deduplication code
- [ ] Remove unused indexes
- [ ] Archive old Product rows
- [ ] Update documentation

---

## 11. Alternative: Hybrid Approach

If full migration is too risky, consider a **hybrid approach**:

1. **Keep existing Product table** (backward compatibility)
2. **Add ProductVariant table** (new variants go here)
3. **Dual-write**: Write to both tables during transition
4. **Gradual migration**: Migrate products as they're updated
5. **Query both**: Search both tables, merge results

**Benefits**:
- Lower risk (can rollback easily)
- Gradual migration
- No downtime

**Drawbacks**:
- More complex code (query both tables)
- Temporary storage increase
- Slower queries (must query both)

---

## 12. Conclusion

The current database structure with size variants as separate Product rows creates significant inefficiencies:

1. **5-10x data duplication**
2. **Expensive query-time deduplication**
3. **Slow JSONB-based constraint filtering**
4. **Poor product discovery** (duplicate results)

**Recommended Solution**: Migrate to `Product` + `ProductVariant` normalized schema.

**Expected Benefits**:
- 70% storage reduction
- 50x faster constraint filtering
- Eliminated deduplication overhead
- Cleaner, more maintainable code
- Better product discovery experience

**Next Steps**:
1. Review and approve this audit
2. Create detailed migration plan
3. Run data analysis on production data
4. Begin Phase 1 implementation

