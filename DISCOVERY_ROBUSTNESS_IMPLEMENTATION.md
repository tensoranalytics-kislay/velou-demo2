# Discovery Robustness Fixes - Implementation Summary

## ✅ All Fixes Implemented & Tested

All 5 fixes have been implemented, tested, and verified. Build passes and all 123 tests pass.

---

## Fix A: Category Canonical → DB Mapping ✅

### Problem
Strict category match returns 0 results because LLM outputs canonicals like `"shirts & tops"` but DB stores variants like `"shirts"`, `"tops"`, `"t-shirts"`. Exact equality fails.

### Solution
**Files Created:**
- `src/lib/search/category-mapping.ts` - Config-driven canonical → DB mapping

**Files Modified:**
- `src/lib/search/types.ts` - Updated `SearchConstraints.category` to `string | string[]`
- `src/lib/search/index.ts` - Updated `buildBroadWhereFilters` to use category mapping

**Implementation:**
1. Created `CANONICAL_TO_DB_CATEGORIES` mapping:
   ```typescript
   "shirts & tops": ["shirts", "tops", "t-shirts", "tees", "blouses"]
   "tshirt": ["t-shirts", "tees", "t shirt", "tshirt"]
   ```

2. `expandCanonicalToDbCategories()` expands canonical → DB list

3. `buildBroadWhereFilters()` now:
   - Parses category (handles arrays and comma-separated strings)
   - Expands each canonical to DB categories
   - Builds `categoryOr` array for OR matching
   - Uses ILIKE pattern matching instead of exact equality

**Result:** Strict search now uses `categoryOr` with ILIKE, preventing 0-result failures.

---

## Fix B: Apply Gender Properly ✅

### Problem
`detectedGenders` logged but `genderFilter` undefined, results unchanged.

### Solution
**Files Modified:**
- `src/lib/llm/orchestrator/intent.ts` - Gender detection and merging
- `src/lib/search/index.ts` - Gender filter application (already implemented)

**Implementation:**
1. `detectGenderTokens()` called pre-LLM, seeds `constraintsDelta.genders`
2. Gender merged into `constraints.genders` before LLM processing
3. `dbRankedSearch` applies gender filter:
   - Raw SQL: JSON path filter on `attributes.gender`
   - Prisma fallback: In-memory filter after fetch
   - Logic: `mens` → allow `mens` OR `unisex`, `womens` → allow `womens` OR `unisex`

**Result:** Gender constraints properly filter results at DB level.

---

## Fix C: Multi-Category Outfits ✅

### Problem
LLM returns comma-separated categories like `"shirts & tops, pants, dresses"` but only first category is used.

### Solution
**Files Modified:**
- `src/lib/search/category-mapping.ts` - Added `parseCategoryString()`
- `src/lib/llm/orchestrator/intent.ts` - Parse comma-separated category into array
- `src/lib/search/index.ts` - Handle array categories in `buildBroadWhereFilters`

**Implementation:**
1. `parseCategoryString()` splits comma-separated strings: `"a, b, c"` → `["a", "b", "c"]`
2. LLM parsing detects comma-separated category and converts to array
3. `buildBroadWhereFilters` handles array:
   - Expands each category canonical → DB list
   - Builds OR conditions across all expanded categories
   - Query searches across all categories

**Result:** Outfit requests search across multiple categories, returning diverse results.

---

## Fix D: Card Repetition / Diversity ✅

### Problem
Deterministic top-k slicing + dedup after truncation causes repeated cards.

### Solution
**Files Modified:**
- `src/lib/llm/orchestrator/index.ts` - Deduplication and diversity in `runDiscoveryFlow`

**Implementation:**
1. **Deduplicate by `product.id` BEFORE slicing:**
   ```typescript
   const seenIds = new Set<string>();
   const uniqueEvaluated = evaluated.filter(entry => {
     if (seenIds.has(entry.item.id)) return false;
     seenIds.add(entry.item.id);
     return true;
   });
   ```

2. **Diversity step - group by category, interleave:**
   ```typescript
   const groupedByCategory = new Map();
   // Group by category
   // Interleave round-robin
   // Take top N from interleaved
   ```

3. Final `deduplicateProductCards` still runs for safety (by `productUrl`/`canonicalSku`)

**Result:** Cards are unique by ID, diverse across categories, count matches requested limit.

---

## Fix E: LLM JSON Parse Robustness ✅

### Problem
Malformed JSON wipes all constraints, losing rule-based refinements (gender, overrideCategory).

### Solution
**Files Created:**
- `src/lib/llm/orchestrator/json-parse.ts` - Safe JSON parsing with fallback

**Files Modified:**
- `src/lib/llm/orchestrator/intent.ts` - Use `safeParseLlmJson` instead of direct `JSON.parse`

**Implementation:**
1. `safeParseLlmJson()` with 3 strategies:
   - Strategy 1: Strip JSON fences and parse
   - Strategy 2: Extract `{...}` substring and parse
   - Strategy 3: Use fallback constraints (previous + rule-based refinements)

2. On parse failure:
   - Uses `previousConstraints` (if contextAction=carry)
   - Merges `constraintsDelta` (includes detected genders)
   - Preserves rule-based refinements (gender, overrideCategory)

**Result:** LLM JSON failures don't wipe constraints; rule-based refinements survive.

---

## Logging Updates ✅

Added debug logs for:
- `constraints.category` + `categoryType` (string/array)
- `expandedDbCategories` (from category mapping)
- `constraints.genders` + `genderFilter` (applied filter)
- `deduplicateProductCards` stats: `requestedLimit`, `uniqueIds`

**Log locations:**
- `searchProducts dbRankedSearch` - Shows category expansion and gender filter
- `inferIntentAndConstraintsWithLlm` - Shows category type and genders
- `deduplicateProductCards` - Shows dedup stats

---

## Test Coverage ✅

**New Tests:** `tests/discovery_robustness.test.ts` (14 tests)

- **T1:** Category canonical mismatch → DB expansion
- **T2:** Gender refinement → filtering works
- **T3:** Multi-category outfits → no truncation, OR search
- **T4:** Diversity/dedup → unique IDs, diverse categories
- **T5:** LLM JSON failure → fallback preserves refinements

**All Tests:** 123 tests passing across 18 test files

---

## Files Changed Summary

### New Files
- `src/lib/search/category-mapping.ts` - Canonical → DB mapping
- `src/lib/llm/orchestrator/json-parse.ts` - Safe JSON parsing
- `tests/discovery_robustness.test.ts` - Comprehensive tests
- `DISCOVERY_FIXES_PLAN.md` - Implementation plan
- `DISCOVERY_ROBUSTNESS_IMPLEMENTATION.md` - This summary

### Modified Files
- `src/lib/search/types.ts` - `category: string | string[]`
- `src/lib/search/index.ts` - Category expansion, gender filter, logging
- `src/lib/llm/orchestrator/intent.ts` - Multi-category parsing, safe JSON, gender merging
- `src/lib/llm/orchestrator/index.ts` - Deduplication + diversity before slicing
- `src/lib/llm/orchestrator/utils.ts` - Category array handling in normalization
- `src/lib/llm/orchestrator/cards.ts` - Category array handling
- `src/lib/llm/orchestrator/followup-detector.ts` - Category array handling

---

## Verification

✅ Build passes: `npm run build`  
✅ All tests pass: `npm run test` (123/123)  
✅ Type safety: All TypeScript errors resolved  
✅ Logging: Debug logs added for observability  

---

## Expected Behavior After Fixes

1. **Strict category match:** `"shirts & tops"` → expands to `["shirts", "tops", "t-shirts"]` → uses OR matching → returns >0 results
2. **Gender refinement:** `"tshirts for men"` → `genders: ["mens"]` → `genderFilter: ["mens"]` → only mens/unisex products
3. **Multi-category outfits:** `"shirts & tops, pants, dresses"` → searches all categories → returns diverse results
4. **Card diversity:** Dedup by ID before slicing + diversity interleaving → unique, varied cards
5. **JSON failure resilience:** Malformed JSON → uses fallback → gender/overrideCategory preserved

---

## Next Steps (if needed)

1. Monitor logs to verify category expansion is working
2. Verify gender filter is applied in production
3. Test multi-category outfit queries end-to-end
4. Monitor card diversity metrics
5. Track LLM JSON parse failure rate and fallback usage

All fixes are production-ready and tested.


