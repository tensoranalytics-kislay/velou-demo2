# Phase 1: Database Analysis & Preparation

**Status**: ✅ Implementation Complete  
**Date**: 2025-01-XX

---

## Overview

Phase 1 focuses on understanding the current database structure, identifying duplication patterns, and preparing for the migration to a normalized `Product` + `ProductVariant` schema.

---

## Deliverables

### 1. Database Analysis Scripts

#### `scripts/analyze-database.ts`
TypeScript script that analyzes the database and generates comprehensive reports.

**Features**:
- Counts total products vs unique products
- Analyzes deduplication key availability (parent_id, related_id, shopifyProductId, sourceId)
- Identifies duplicate groups
- Calculates size and category distributions
- Exports results to JSON

**Usage**:
```bash
# Analyze all merchants
npm run analyze:database

# Analyze specific merchant
MERCHANT_ID=merchant_123 npm run analyze:database
```

**Output**:
- Console report with statistics
- `database-analysis-results.json` with detailed data

#### `scripts/analyze-database-queries.sql`
Raw SQL queries for direct database analysis.

**Usage**:
```bash
# Run queries directly in PostgreSQL
psql $DATABASE_URL -f scripts/analyze-database-queries.sql
```

**Queries Include**:
- Basic statistics
- Deduplication key analysis
- Duplicate group identification
- Size distribution
- Category distribution
- Embedding analysis

### 2. Migration Preparation Script

#### `scripts/migration-prep.ts`
Generates migration plan based on analysis results.

**Features**:
- Validates data integrity
- Generates migration batches
- Identifies risks
- Provides recommendations
- Creates migration plan JSON

**Usage**:
```bash
# Generate migration plan
npm run migrate:prepare

# With custom batch size
BATCH_SIZE=500 npm run migrate:prepare

# For specific merchant
MERCHANT_ID=merchant_123 npm run migrate:prepare
```

**Output**:
- Console report with migration plan
- `migration-plan.json` with detailed plan

---

## Step-by-Step Execution

### Step 1: Run Database Analysis

```bash
# 1. Analyze the database
npm run analyze:database

# 2. Review the output
cat database-analysis-results.json
```

**What to Look For**:
- **Duplication Factor**: Should be 3-10x (e.g., 5x means 5 variants per product)
- **Deduplication Key Coverage**: Higher is better (aim for >80%)
- **Products Without Keys**: Lower is better (may need manual review)
- **Size Distribution**: Verify sizes are extractable

### Step 2: Review SQL Queries (Optional)

```bash
# Run SQL queries directly for deeper analysis
psql $DATABASE_URL -f scripts/analyze-database-queries.sql
```

**Use Cases**:
- Verify analysis script results
- Custom queries for specific merchants
- Performance testing

### Step 3: Generate Migration Plan

```bash
# Generate migration plan
npm run migrate:prepare

# Review the plan
cat migration-plan.json
```

**What to Check**:
- **Estimated Unique Products**: Should match analysis results
- **Migration Batches**: Verify batch sizes are reasonable
- **Risks**: Address any identified risks
- **Recommendations**: Follow all recommendations

### Step 4: Validate Data Integrity

The migration prep script automatically validates:
- ✅ Products with missing titles
- ⚠️ Products with missing categories
- ⚠️ Products with invalid prices
- ❌ Orphaned products (no merchant)

**If validation fails**:
1. Fix data quality issues
2. Re-run validation
3. Proceed only when all errors are resolved

---

## Expected Results

### Analysis Output Example

```
📊 BASIC STATISTICS
────────────────────────────────────────────────────────────────────────────────
Total Products:           50,000
Unique Products:          10,000
Avg Variants per Product: 5.00
Duplication Factor:      5.00x

🔑 DEDUPLICATION KEY AVAILABILITY
────────────────────────────────────────────────────────────────────────────────
Products with parent_id:  30,000 (60.0%)
Products with related_id: 15,000 (30.0%)
Products with shopifyId:   25,000 (50.0%)
Products without key:     5,000 (10.0%)

📦 DUPLICATE GROUPS
────────────────────────────────────────────────────────────────────────────────
Total duplicate groups:   10,000
Max variants in group:   12
Min variants in group:   2
Avg variants in group:   5.00
```

### Migration Plan Output Example

```
📊 ESTIMATES
────────────────────────────────────────────────────────────────────────────────
Unique Products:          10,000
Total Variants:           50,000
Manual Review Needed:    5,000
Storage Reduction:       ~80.0%
Migration Batches:       50

⚠️  RISKS
────────────────────────────────────────────────────────────────────────────────
  1. 5,000 products lack deduplication keys and may not be properly grouped

✅ RECOMMENDATIONS
────────────────────────────────────────────────────────────────────────────────
  1. Run full database backup before migration
  2. Test migration on staging environment first
  3. Process in 1000 product batches to avoid timeouts
  4. Keep old Product rows during migration (add isMigrated flag)
  5. Verify data integrity after each batch
  6. Review 5,000 products without deduplication keys manually
  7. Expected storage reduction: ~80.0%
```

---

## Files Created

1. **`scripts/analyze-database.ts`** - Main analysis script
2. **`scripts/analyze-database-queries.sql`** - SQL queries for analysis
3. **`scripts/migration-prep.ts`** - Migration plan generator
4. **`docs/PHASE1_IMPLEMENTATION.md`** - This documentation

---

## Output Files

1. **`database-analysis-results.json`** - Detailed analysis results
2. **`migration-plan.json`** - Migration plan with batches and recommendations

---

## Next Steps

After completing Phase 1:

1. ✅ **Review Analysis Results**
   - Verify duplication patterns match expectations
   - Check deduplication key coverage
   - Identify any data quality issues

2. ✅ **Review Migration Plan**
   - Verify batch sizes are reasonable
   - Address identified risks
   - Plan for manual review of products without keys

3. ✅ **Create Database Backup**
   - Full backup before proceeding
   - Test restore procedure

4. ✅ **Set Up Staging Environment**
   - Copy production data to staging
   - Test migration scripts on staging

5. ➡️ **Proceed to Phase 2: Schema Migration**
   - Create Prisma migration for ProductVariant
   - Add new indexed columns to Product
   - Deploy migration (zero downtime)

---

## Troubleshooting

### Analysis Script Fails

**Error**: Database connection failed
- **Solution**: Check `DATABASE_URL` environment variable

**Error**: Out of memory
- **Solution**: Filter by merchantId or process in smaller chunks

### Migration Plan Shows High Risk

**Issue**: Many products without deduplication keys
- **Solution**: 
  1. Review sample products manually
  2. Improve deduplication logic if needed
  3. Plan for manual grouping during migration

**Issue**: Very high variant count (>20 per product)
- **Solution**: 
  1. Verify deduplication logic is correct
  2. Check for data quality issues
  3. May need to adjust grouping strategy

---

## Notes

- Analysis scripts are read-only (no data modification)
- Safe to run on production (only SELECT queries)
- Results are exported to JSON for further analysis
- Migration plan is generated but not executed (Phase 3)

---

## References

- [Database Audit Document](../DATABASE_AUDIT.md)
- [Prisma Schema](../prisma/schema.prisma)
- [Deduplication Logic](../src/lib/search/vector/index.ts)










