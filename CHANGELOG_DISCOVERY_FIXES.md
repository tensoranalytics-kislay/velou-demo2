# Discovery Flow Fixes - CHANGELOG

## Summary

Fixed discovery flow failures for follow-up queries like "just show tees / tshirts only" that were returning zero results even when the catalog contained many matching products.

## Root Causes Fixed

1. **LLM constraint extraction returning `category: undefined`** for t-shirt synonyms
2. **Constraint merge leaking old outfit constraints** (occasions/materials/etc.) into follow-ups
3. **Text query being soft-scoring only**, so SQL didn't hard-filter when category was missing
4. **Candidate sampling capping early** (dbCandidates=120) even on broad queries

## Fixes Implemented

### Fix A: Deterministic Synonym Normalization (Pre-merge)

**Location:** `src/lib/llm/orchestrator/utils.ts`

- Added `CATEGORY_SYNONYM_MAP` with comprehensive synonym mappings
- Added `normalizeCategoryFromMessage()` function to extract category from user message deterministically
- Maps common variations: `tshirt`, `t-shirt`, `tee`, `tees`, `graphic tee` → `"t shirt"`
- Runs BEFORE LLM extraction to catch cases where LLM misses category
- Added `extractHardTextFilterKeywords()` for SQL fallback filtering

**Key Functions:**
- `normalizeCategoryFromMessage(message, llmCategory, ontology)` - Normalizes category from message
- `extractHardTextFilterKeywords(message, normalizedCategory)` - Extracts keywords for SQL filtering

### Fix B: Override/Reset-Aware Merging

**Location:** `src/lib/llm/orchestrator/intent.ts`

- Updated `mergeConstraints()` to accept optional `contextAction` parameter
- Detects override keywords: `"only"`, `"just"`, `"instead"`, `"show me"`, `"switch to"`, `"not that"`, `"forget previous"`, `"reset"`
- For `override` or `reset`:
  - Drops previous attribute filters (occasions/materials/fabrics/colors/fit/etc.)
  - Keeps safe persistent prefs (size, gender, price) only if not explicitly changed
- For `carry`: Merges normally as before

**Key Changes:**
- `mergeConstraints()` now accepts `contextAction?: 'carry' | 'override' | 'reset'`
- Override detection via regex pattern matching
- Context action passed from LLM response to merging logic

### Fix C: Hard Text Filter Fallback in SQL

**Location:** `src/lib/search/index.ts`

- Added `hardTextFilters` parameter to `dbRankedSearch()`
- When category is missing AND hard text filters are available:
  - Adds SQL WHERE clause with `LIKE` conditions on `title`, `description`, `category`
  - Uses OR conditions for multiple keywords
  - Example: `"t shirt" OR "tshirt" OR "tee"` when user says "tees"
- Keeps existing soft scoring but adds hard filtering when needed
- Passes hard text filters through widening tiers

**Key Changes:**
- `dbRankedSearch()` accepts optional `hardTextFilters?: string[]`
- SQL WHERE clause includes text filters when category missing
- Hard text filters extracted in `runDiscoveryFlow()` and passed to search

### Fix D: Adaptive Candidate Take (Full DB Coverage)

**Location:** `src/lib/search/index.ts`

- Updated `calculateDynamicTake()` to accept `hardTextFilters` parameter
- When category is missing OR query includes apparel keywords:
  - Increases take to at least 1500 (up to MAX_TAKE=2500)
  - Ensures full ~13k product DB is effectively searched
- When category is specific (like "skirts"), keeps current tight take
- Still caps max to avoid performance blowups

**Key Changes:**
- `calculateDynamicTake()` signature: `(constraints, limit, hardTextFilters?)`
- Adaptive logic: broad queries → larger take, specific categories → tight take
- Minimum 1500 for broad queries, max 2500 for safety

## Debug Logging Added

All fixes include comprehensive debug logging:

- `normalizeCategoryFromMessage` - logs original vs normalized category
- `extractHardTextFilterKeywords` - logs when hard filters enabled
- `mergeConstraints` - logs contextAction and merge decisions
- `runDiscoveryFlow hardTextFilters` - logs filter extraction
- `searchProducts hardTextFilters` - logs SQL filter usage
- `searchProducts adaptiveTakeUsed` - logs take calculation

## Files Modified

1. **`src/lib/llm/orchestrator/utils.ts`**
   - Added `CATEGORY_SYNONYM_MAP`
   - Added `normalizeCategoryFromMessage()`
   - Added `extractHardTextFilterKeywords()`

2. **`src/lib/llm/orchestrator/intent.ts`**
   - Updated `mergeConstraints()` to handle `contextAction`
   - Updated `normalizeResult()` to extract hard text filters
   - Added debug logging

3. **`src/lib/llm/orchestrator/index.ts`**
   - Updated `runDiscoveryFlow()` to extract and pass hard text filters
   - Added import for `extractHardTextFilterKeywords`
   - Added debug logging

4. **`src/lib/search/index.ts`**
   - Updated `dbRankedSearch()` to accept `hardTextFilters`
   - Added SQL WHERE clause for hard text filtering
   - Updated `calculateDynamicTake()` for adaptive take
   - Updated `searchProducts()` to extract and use hard text filters
   - Passes hard text filters to widening tiers
   - Added debug logging

## Test Cases Covered

### Tees Override
- **Input:** `previous constraints: { occasions: ["office"], materials:["linen"], category: undefined }`
- **Message:** `"just show some tshirts only in that vibe"`
- **Expected:**
  - `merged.category === "t shirt"` (normalized)
  - `merged.occasions/materials/fabrics/colors` cleared (override detected)
  - SQL filter includes tee keywords hard-filter

### Synonym Mapping
- **Messages:** `"show me tees"`, `"graphic tee"`, `"t-shirts"`
- **Expected:** All normalize to `"t shirt"` category

### Carry Case
- **Conversation:**
  - User: `"black skirts"`
  - Follow-up: `"show more like that"`
- **Expected:** Category/colors persist (carry context)

### Broad Query Adaptive Take
- **Message:** `"smart casual outfit in summer"`
- **Expected:** Take increases when category broad; not for specific category

### No Regression
- Existing behavior for `"skirts"` shouldn't suddenly pull random apparel

## Acceptance Criteria Met

✅ Follow-up "find me only good tshirts" returns tee products  
✅ `searchProducts` counts for tee follow-ups shows non-zero `dbCandidates` even if LLM misses category  
✅ `afterAttributeFilter` is not 0 for tee follow-ups due to leaked constraints  
✅ No regression on skirts/jeans/etc.  
✅ Performance stable on 13k catalog  

## Performance Impact

- **Minimal:** Synonym normalization is O(1) map lookup
- **SQL filtering:** Uses indexed `LIKE` queries (acceptable for fallback case)
- **Adaptive take:** Increases take only when needed (category missing/broad query)
- **Safe caps:** MAX_TAKE=2500 prevents performance blowups

## Backward Compatibility

- All changes are backward compatible
- Existing flows continue to work
- New functionality only activates when category is missing or override detected
- No breaking API changes


