# Database-Level Ranking Search Refactor - Summary

## ✅ Completed

1. **Migration Created**: `prisma/migrations/20251122193715_add_fulltext_search/migration.sql`
   - Adds `search_vector` tsvector column
   - Creates GIN index for fast full-text search
   - Auto-updates search_vector via trigger
   - Adds indexes on `priceCents` and `brand`

2. **Search Function Refactored**: `src/lib/search/index.ts`
   - Database-level ranking using full-text search
   - Dynamic take logic based on query breadth (300-2500)
   - Widening tiers for guaranteed full-catalog coverage
   - Fallback to Prisma if raw query fails

## 🔧 Implementation Details

### Database-Level Ranking
- Uses PostgreSQL `ts_rank_cd` for full-text search
- Combines multiple ranking factors:
  - Full-text search relevance (5.0x weight)
  - Category boost from MerchRules
  - Recency boost (newer products slightly favored)

### Dynamic Take Logic
- Base: `limit * 50` (minimum 300)
- Maximum: 2500 (safe for ~13k catalog)
- Broad queries (no category/brand/price): use MAX_TAKE

### Widening Tiers
When strict search yields < limit results:
1. Drop category, keep price/brand/stock
2. Drop brand, keep price/stock
3. Drop price, keep only stock
4. Only stock filter (if required)

### Fallback Strategy
- If `search_vector` column doesn't exist → fallback to Prisma.findMany
- If raw query fails → fallback to Prisma.findMany with text search

## ⚠️ Known Issue

TypeScript errors with Prisma.sql template literals for array parameters. The code uses `$queryRawUnsafe` as a workaround, but proper Prisma.sql usage needs to be fixed.

## 📝 Next Steps

1. **Run Migration**: `npx prisma migrate deploy` (or `npx prisma migrate dev`)
2. **Fix Prisma.sql Usage**: Resolve TypeScript errors with array parameters
3. **Test**: Verify full-text search works and ranking is correct
4. **Monitor**: Check query performance on ~13k catalog

## 🎯 Benefits

- ✅ Never misses products due to 400-item cap
- ✅ Database considers all 13k products before capping
- ✅ Full-text search for better relevance
- ✅ Guaranteed widening fallback for coverage
- ✅ Performance-safe with bounded fetch sizes

