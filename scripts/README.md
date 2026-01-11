# Database Migration Scripts

This directory contains scripts for analyzing and migrating the database from the current structure (size variants as separate Product rows) to a normalized structure (Product + ProductVariant).

## Phase 1: Analysis & Preparation

### `analyze-database.ts`

Analyzes the current database structure to understand duplication patterns.

**Usage**:
```bash
npm run analyze:database
```

**Output**:
- Console report with statistics
- `database-analysis-results.json` - Detailed analysis data

**What it does**:
- Counts total vs unique products
- Analyzes deduplication key availability
- Identifies duplicate groups
- Calculates size/category distributions
- Samples duplicate products

### `analyze-database-queries.sql`

Raw SQL queries for direct database analysis. Useful for:
- Verifying analysis script results
- Custom queries for specific merchants
- Performance testing

**Usage**:
```bash
psql $DATABASE_URL -f scripts/analyze-database-queries.sql
```

### `migration-prep.ts`

Generates migration plan based on analysis results.

**Usage**:
```bash
npm run migrate:prepare
```

**Output**:
- Console report with migration plan
- `migration-plan.json` - Detailed migration plan

**What it does**:
- Validates data integrity
- Generates migration batches
- Identifies risks
- Provides recommendations

## Phase 2: Schema Migration (Coming Soon)

Scripts for creating the new schema will be added here.

## Phase 3: Data Migration (Coming Soon)

Scripts for migrating existing data will be added here.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `MERCHANT_ID` - Optional: filter analysis to specific merchant
- `BATCH_SIZE` - Optional: batch size for migration (default: 1000)

## Output Files

- `database-analysis-results.json` - Analysis results
- `migration-plan.json` - Migration plan

## See Also

- [Phase 1 Implementation Guide](../docs/PHASE1_IMPLEMENTATION.md)
- [Database Audit](../DATABASE_AUDIT.md)










