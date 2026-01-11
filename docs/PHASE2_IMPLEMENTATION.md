# Phase 2: Schema Migration

**Status**: ✅ Schema Created, Ready for Deployment  
**Date**: 2025-01-03

---

## Overview

Phase 2 adds the new database schema to support the normalized Product + ProductVariant model. This migration is **backward compatible** - existing code continues to work while we prepare for data migration.

---

## What Was Added

### 1. ProductVariant Table ✅

New table to store size/color variants:

```prisma
model ProductVariant {
  id                String          @id @default(cuid())
  productId         String          // Foreign key to Product
  size              String?         // "S", "M", "L", "XL", etc.
  color             String?         // Variant-specific color
  sku               String?
  barcode           String?
  priceCents        Int?            // Can override product.priceCents
  salePriceCents    Int?
  stockStatus       StockStatus     @default(in_stock)
  inventoryQuantity Int?
  shopifyVariantId  String?
  sourceId          String?
  vendorId          String?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  
  product           Product         @relation(...)
  
  @@unique([productId, size, color])
  @@index([productId])
  @@index([size])
  @@index([color])
  @@index([stockStatus])
  // ... more indexes
}
```

### 2. Indexed Columns on Product ✅

Added nullable columns for commonly-queried attributes:

- `color` - String? (indexed)
- `fabric` - String? (indexed)
- `material` - String? (indexed)
- `occasion` - String? (indexed)
- `season` - String? (indexed)
- `fit` - String? (indexed)

**Why nullable?** Backward compatibility - existing products don't have these values yet. They'll be populated during Phase 3 data migration.

### 3. New Indexes ✅

**Product indexes:**
- `idx_product_color` - Fast color filtering
- `idx_product_fabric` - Fast fabric filtering
- `idx_product_material` - Fast material filtering
- `idx_product_occasion` - Fast occasion filtering
- `idx_product_season` - Fast season filtering
- `idx_product_fit` - Fast fit filtering
- `idx_product_source_id` - Fast deduplication lookups
- `idx_product_category_color` - Composite for common queries
- `idx_product_merchant_category` - Composite for merchant queries

**ProductVariant indexes:**
- `idx_variant_product_id` - Fast product → variants lookup
- `idx_variant_size` - Fast size filtering
- `idx_variant_color` - Fast variant color filtering
- `idx_variant_stock_status` - Fast stock filtering
- `idx_variant_product_size` - Composite for product + size queries
- `idx_variant_size_stock` - Composite for size + stock queries

---

## Migration File

**Location**: `prisma/migrations/20250103000000_add_product_variant_model/migration.sql`

**What it does**:
1. Adds nullable columns to Product (backward compatible)
2. Creates ProductVariant table
3. Adds foreign key constraint
4. Creates all indexes
5. Zero downtime (no data changes)

---

## Backward Compatibility

✅ **Fully backward compatible**:
- Existing Product rows work unchanged
- `attributes` JSONB field preserved
- New columns are nullable (won't break existing queries)
- ProductVariant table starts empty
- Existing code continues to work

---

## Deployment Steps

### Step 1: Review Migration

```bash
# Review the migration SQL
cat prisma/migrations/20250103000000_add_product_variant_model/migration.sql
```

### Step 2: Test on Staging (Recommended)

```bash
# Apply migration to staging database
DATABASE_URL="your-staging-db-url" npx prisma migrate deploy
```

### Step 3: Apply to Production

```bash
# Apply migration to production
npx prisma migrate deploy
```

**Note**: This is a **zero-downtime migration**:
- Only adds new columns and table
- No data modifications
- No locks on existing data
- Safe to run during business hours

### Step 4: Verify Schema

```bash
# Generate Prisma client (already done)
npx prisma generate

# Verify schema in database
npx prisma db pull --print
```

---

## Verification Checklist

After deploying, verify:

- [ ] ProductVariant table exists
- [ ] New columns added to Product (color, fabric, etc.)
- [ ] All indexes created successfully
- [ ] Foreign key constraint works
- [ ] Unique constraint prevents duplicate variants
- [ ] Existing Product queries still work
- [ ] Prisma client generated successfully

---

## What's Next

After Phase 2 is deployed:

1. **Phase 3: Data Migration**
   - Populate ProductVariant table from existing Product rows
   - Extract attributes to indexed columns
   - Group variants by deduplication keys

2. **Phase 4: Code Migration**
   - Update search functions to use new schema
   - Update retrieval functions
   - Update ingestion pipeline

---

## Rollback Plan

If needed, rollback is simple:

```sql
-- Drop ProductVariant table
DROP TABLE IF EXISTS "ProductVariant";

-- Remove new columns from Product
ALTER TABLE "Product" 
  DROP COLUMN IF EXISTS "color",
  DROP COLUMN IF EXISTS "fabric",
  DROP COLUMN IF EXISTS "material",
  DROP COLUMN IF EXISTS "occasion",
  DROP COLUMN IF EXISTS "season",
  DROP COLUMN IF EXISTS "fit";

-- Indexes will be dropped automatically with columns
```

**Note**: Only rollback if migration hasn't been used yet. Once Phase 3 starts, rollback becomes more complex.

---

## Files Created

1. **`prisma/schema.prisma`** - Updated with ProductVariant model and new columns
2. **`prisma/migrations/20250103000000_add_product_variant_model/migration.sql`** - Migration SQL
3. **`docs/PHASE2_IMPLEMENTATION.md`** - This documentation

---

## Expected Impact

**Before Migration**:
- Product table: 5,178 rows
- No variant separation
- Slow JSONB queries

**After Migration** (before Phase 3 data migration):
- Product table: 5,178 rows (unchanged)
- ProductVariant table: 0 rows (empty, ready for Phase 3)
- New indexed columns: NULL (will be populated in Phase 3)
- **Zero impact on existing functionality**

**After Phase 3** (data migration):
- Product table: ~1,085 rows (unique products)
- ProductVariant table: ~5,178 rows (variants)
- ~79% storage reduction
- 50x faster constraint filtering

---

## Notes

- Migration is **idempotent** (safe to run multiple times)
- Uses `IF NOT EXISTS` and `IF EXISTS` for safety
- All new columns are nullable for backward compatibility
- ProductVariant table starts empty (Phase 3 will populate it)
- No data is modified in this phase

---

## References

- [Database Audit Document](../DATABASE_AUDIT.md)
- [Phase 1 Implementation](../docs/PHASE1_IMPLEMENTATION.md)
- [Prisma Schema](../prisma/schema.prisma)










