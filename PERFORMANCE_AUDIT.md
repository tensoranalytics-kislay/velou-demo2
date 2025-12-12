# Performance Audit - 40 Second Response Time

## Issues Identified

### 1. ❌ CRITICAL: Optimized Pipeline NOT Used
**Problem**: Request is going to `/api/assistant/stream` endpoint, which **does NOT have the optimized pipeline**.
- The optimized pipeline only exists in `/api/assistant/route.ts` (non-stream)
- `/api/assistant/stream/route.ts` still uses the old pipeline with multiple LLM calls

**Evidence from logs**:
- Line 776: `POST /api/assistant/stream 200 in 40s`
- Lines 409-414: ContextGatekeeper LLM call (should be rule-based)
- Lines 416-426: Intent extraction LLM call (should be rule-based)
- Multiple suggestion API calls with LLM (lines 206-343)

### 2. ❌ CRITICAL: Raw SQL Search Failing
**Problem**: PostgreSQL `tsvector` column deserialization error causing fallback to slow Prisma queries.

**Evidence from logs** (lines 687-699):
```
Raw query failed. Code: `N/A`. Message: `Failed to deserialize column of type 'tsvector'.
dbRankedSearch raw SQL failed, falling back to Prisma
```

**Impact**: Instead of fast raw SQL with full-text search, it's using slow Prisma queries with many LIKE conditions (see line 700).

### 3. ❌ Feature Flag Not Set
**Problem**: `USE_LOCCITANE_OPTIMIZED_PIPELINE` is not in `.env` file.
- Even if we fix the stream endpoint, it won't activate without the flag

### 4. ⚠️ Multiple LLM Calls in Original Pipeline
**Time breakdown** (from logs):
- ContextGatekeeper: ~2-3s (line 409-414)
- Intent Extraction: ~8s (lines 416-426) 
- Search (with fallback): ~5s (lines 534-700)
- Card Reasons generation: ~7s (estimated)
- Final Reply: ~10s (estimated)
- Multiple suggestion API calls: ~8-9s each (lines 206-343)
- **Total: ~40 seconds**

## Root Causes

1. **Stream endpoint missing optimized pipeline** - The optimized code was only added to the non-stream endpoint
2. **tsvector deserialization error** - Prisma can't deserialize tsvector type in raw SQL results
3. **Feature flag not enabled** - Even if code exists, it won't run

## Solutions Required

1. ✅ Add optimized pipeline to `/api/assistant/stream/route.ts` - **FIXED**
2. ✅ Fix tsvector deserialization in raw SQL (exclude search_vector from SELECT) - **FIXED**
3. ✅ Enable feature flag in `.env` - **FIXED**
4. ⏳ Test with optimized pipeline enabled - **PENDING**

## Fixes Applied

### Fix 1: Added Optimized Pipeline to Stream Endpoint
- Added optimized pipeline check at the start of `/api/assistant/stream/route.ts`
- Uses `handleLoccitaneQuery` for fast single-LLM-call processing
- Maintains SSE streaming for progress updates

### Fix 2: Fixed tsvector Deserialization Error
- Excluded `search_vector` column from SELECT statement in raw SQL
- Still uses `search_vector` in WHERE clause for full-text search ranking
- Prevents Prisma deserialization error that was causing fallback to slow queries

### Fix 3: Enabled Feature Flag
- Added `USE_LOCCITANE_OPTIMIZED_PIPELINE=true` to `.env`
- Pipeline will now activate for HOME and PLP pages

## Expected Performance Improvement

**Before:**
- 40 seconds total
- 4-5 LLM calls
- Slow Prisma fallback queries

**After (Expected):**
- 1.5-3 seconds total
- 1 LLM call
- Fast raw SQL with full-text search
- Parallel search + LLM execution

