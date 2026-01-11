# Phase 3: Data Migration

**Status**: ✅ Scripts Created, Ready for Execution  
**Date**: 2025-01-03

---

## Overview

Phase 3 migrates existing Product rows to the normalized Product + ProductVariant structure. This populates the ProductVariant table created in Phase 2 and extracts attributes to indexed columns.

---

## What the Migration Does

### 1. Groups Products by Deduplication Keys

Uses the same logic as Phase 1 analysis:
- `parent_id` (from attributes JSON)
- `related_id` (from attributes JSON)
- `shopifyProductId` (extracted from ID or column)
- `sourceId` (base ID with size suffix stripped)

**From your analysis**: 100% of products have `parent_id` and `related_id`, so all products can be automatically grouped.

### 2. Selects Canonical Product

For each group, selects the "canonical" product (most complete data):
- Has description
- Has image
- In stock
- Earliest created (original)

### 3. Updates Canonical Product

- Extracts attributes to indexed columns (color, fabric, material, occasion, season, fit)
- Sets base `sourceId` (strips size suffix)
- Aggregates stock status (in_stock if ANY variant in stock)
- Uses canonical's price as base price

### 4. Creates ProductVariant Rows

For each product in the group (including canonical):
- Extracts size from `attributes.sizes`, `attributes.size`, or `sourceId`
- Extracts color from `attributes.color` or title
- Creates ProductVariant row linked to canonical product
- Preserves pricing, stock status, source tracking

---

## Migration Script

**Location**: `scripts/migrate-to-variant-model.ts`

**Usage**:
```bash
# Dry run (no changes)
DRY_RUN=true npm run migrate:data

# Actual migration
npm run migrate:data

# With custom batch size
BATCH_SIZE=50 npm run migrate:data

# For specific merchant
MERCHANT_ID=merchant_123 npm run migrate:data
```

**What it does**:
1. Fetches all active products
2. Groups by deduplication keys
3. Processes groups in batches (default: 100 groups per batch)
4. Updates canonical products with extracted attributes
5. Creates ProductVariant rows for all variants
6. Logs progress and errors

---

## Expected Results

Based on your analysis:

**Before Migration**:
- Product table: 5,178 rows
- ProductVariant table: 0 rows
- Attributes in JSONB only

**After Migration**:
- Product table: 5,178 rows (unchanged, but updated with attributes)
- ProductVariant table: ~5,178 rows (one per variant)
- Attributes extracted to indexed columns
- ~1,085 products have variants (grouped products)

**Note**: We keep all Product rows for now. Cleanup (removing duplicate Product rows) happens in Phase 5 after verification.

---

## Safety Features

### 1. Batch Processing
- Processes groups in batches (default: 100)
- Transaction per batch (all-or-nothing)
- 60-second timeout per batch

### 2. Error Handling
- Catches and logs errors per group
- Continues processing other groups
- Tracks error count in stats

### 3. Duplicate Prevention
- Unique constraint on (productId, size, color)
- Skips duplicate variants gracefully
- Logs skipped variants

### 4. Dry Run Mode
- `DRY_RUN=true` to test without changes
- Shows what would be migrated
- Safe to run multiple times

---

## Verification

After migration, run verification:

```bash
npm run verify:phase3
```

**Checks**:
- ✅ ProductVariants created
- ✅ Products have variants
- ✅ Attributes extracted to columns
- ✅ Variants have sizes
- ✅ No orphaned variants
- ✅ No duplicate variants
- ✅ Sample products verified

---

## Migration Process

### Step 1: Backup Database

```bash
# Create backup before migration
pg_dump $DATABASE_URL > backup_before_phase3.sql
```

### Step 2: Test on Staging (Recommended)

```bash
# Test on staging first
DATABASE_URL="staging-url" npm run migrate:data
DATABASE_URL="staging-url" npm run verify:phase3
```

### Step 3: Run Migration

```bash
# Run migration
npm run migrate:data

# Monitor progress
# Script will show:
# - Batch progress
# - Groups processed
# - Variants created
# - Errors (if any)
```

### Step 4: Verify

```bash
# Run verification
npm run verify:phase3

# Review sample products
# Check data integrity
```

---

## Troubleshooting

### Migration Fails Midway

**If migration fails**:
1. Check error logs
2. Fix the issue
3. Re-run migration (idempotent - skips already processed groups)
4. Or restore from backup

**Note**: Migration is designed to be re-runnable. Already created variants are skipped due to unique constraint.

### Duplicate Variant Errors

If you see "Duplicate variant skipped" warnings:
- This is normal - means same productId + size + color already exists
- Variant is skipped (not created again)
- Check logs to see which variants were skipped

### Missing Sizes

If variants don't have sizes:
- Check `attributes.sizes` or `attributes.size` in source data
- Check `sourceId` pattern (may need to adjust regex)
- Review sample products in verification output

---

## Performance

**Expected Runtime**:
- 5,178 products → ~740 groups
- ~100 groups per batch → ~8 batches
- ~1-2 seconds per batch
- **Total: ~10-20 seconds**

**Database Impact**:
- Read: All products (one-time)
- Write: Updates to ~1,085 products + ~5,178 variant inserts
- Indexes: All created in Phase 2 (no impact)

---

## Rollback Plan

If needed, rollback is possible:

```sql
-- Delete all ProductVariants
DELETE FROM "ProductVariant";

-- Clear extracted attributes (optional)
UPDATE "Product" SET
  color = NULL,
  fabric = NULL,
  material = NULL,
  occasion = NULL,
  season = NULL,
  fit = NULL;
```

**Note**: This only removes Phase 3 data. Phase 2 schema changes remain (but harmless if unused).

---

## Next Steps

After successful migration:

1. **Verify Data Integrity**
   - Run verification script
   - Review sample products
   - Test search functionality

2. **Phase 4: Code Migration**
   - Update search functions to use ProductVariant
   - Update retrieval functions
   - Update ingestion pipeline
   - Update UI components

3. **Phase 5: Cleanup**
   - Remove duplicate Product rows (after Phase 4 is stable)
   - Remove old deduplication code
   - Optimize indexes

---

## Files Created

1. **`scripts/migrate-to-variant-model.ts`** - Main migration script
2. **`scripts/verify-phase3-migration.ts`** - Verification script
3. **`docs/PHASE3_IMPLEMENTATION.md`** - This documentation

---

## References

- [Database Audit Document](../DATABASE_AUDIT.md)
- [Phase 1 Implementation](./PHASE1_IMPLEMENTATION.md)
- [Phase 2 Implementation](./PHASE2_IMPLEMENTATION.md)
- [Analysis Results](../database-analysis-results.json)










