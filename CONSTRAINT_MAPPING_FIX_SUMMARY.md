# Constraint Mapping Fix Summary

## Date
2026-01-22

## Issue
All constraints needed to be audited to ensure they are mapped correctly between:
1. Dictionary extraction (build-category-specific-dictionaries.ts)
2. SQL filtering (searchVectorIndexWithDeduplication in vector/index.ts)
3. Post-SQL filtering (post-filter.ts)

## Audit Results

### Initial State
- **Matched:** 6/14 constraints
- **Mismatched:** 8/14 constraints

### Final State
- **Matched:** 14/14 constraints ✅
- **Mismatched:** 0/14 constraints

## Fixes Applied

### 1. Necklines ✅
**Issue:** SQL filter only checked `attributes->>'neckline'`, missing `p."neckline"` column.

**Fix:** Added check for `p."neckline"` column (PRIMARY SOURCE) before attributes fallback.

### 2. Fits ✅
**Issue:** SQL filter only checked `attributes->>'fit'`, missing `p."fit"` column.

**Fix:** Added check for `p."fit"` column (PRIMARY SOURCE) before attributes fallback.

### 3. Materials ✅
**Issue:** SQL filter only checked attributes, missing `p."material"` and `p."fabric"` columns.

**Fix:** Added checks for `p."material"` and `p."fabric"` columns (PRIMARY SOURCE) before attributes fallback.

### 4. Seasons ✅
**Issue:** SQL filter only checked attributes, missing `p."season"` column.

**Fix:** Added check for `p."season"` column (PRIMARY SOURCE) before attributes fallback.

### 5. Rises ✅
**Issue:** SQL filter only checked `attributes->>'rise'`, missing `p."riseWaist"` column.

**Fix:** Added check for `p."riseWaist"` column (PRIMARY SOURCE) before attributes fallback.

### 6. Colors ✅
**Issue:** SQL filter only checked `attributes->>'enriched_color'`, missing `p."enrichedColor"` column.

**Fix:** Added checks for `p."enrichedColor"` and `p."color"` columns (PRIMARY SOURCE) before attributes fallback. Applied to both included and excluded color filters.

### 7. Occasions ✅
**Issue:** SQL filter checked `p."occasionContext"` (array) and attributes, but missing `p."occasion"` column.

**Fix:** Added check for `p."occasion"` column (if it exists) in addition to `p."occasionContext"` array column.

### 8. Styles ✅
**Issue:** Dictionary build script only extracted from `attributes->>'style'`, missing `p."silhouetteCut"` column.

**Fix:** Updated build script to extract from `p."silhouetteCut"` column (PRIMARY SOURCE) first, then fall back to attributes. SQL filter already correctly checks `p."silhouetteCut"`.

## Constraint Mapping Pattern

All constraints now follow this consistent pattern:

1. **PRIMARY SOURCE:** Database column (e.g., `p."sleeve"`, `p."length"`, `p."neckline"`)
2. **FALLBACK:** JSONB attributes (e.g., `p.attributes->>'sleeve'`, `p.attributes->>'length'`)
3. **EXTENSIBLE:** Extensible attributes (e.g., `p.attributes->'extensible'->>'sleeve'`)

This ensures:
- Dictionary extraction and SQL filtering use the same data sources
- Primary database columns are checked first (most reliable)
- Legacy data in attributes is still supported
- Consistency across the entire pipeline

## Files Modified

1. `src/lib/search/vector/index.ts`
   - Fixed neckline filter
   - Fixed fit filter
   - Fixed material filter
   - Fixed season filter
   - Fixed rise filter
   - Fixed color filters (included and excluded)
   - Fixed occasion filter

2. `scripts/build-category-specific-dictionaries.ts`
   - Added `p."silhouetteCut"` to SQL query
   - Updated style extraction to use `silhouetteCut` column first

## Verification

All constraints now pass the audit:
- ✅ colors
- ✅ lengths
- ✅ sleeves
- ✅ necklines
- ✅ formalityLevel
- ✅ colorShade
- ✅ fits
- ✅ materials
- ✅ occasions
- ✅ seasons
- ✅ styles
- ✅ patterns
- ✅ sizes
- ✅ rises

## Impact

This fix ensures that:
1. Products with data in database columns are correctly found
2. Dictionary values match what SQL filters check
3. No products are missed due to mismatched data sources
4. The pipeline is consistent and reliable
