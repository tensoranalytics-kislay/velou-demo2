# Discovery Pipeline Fixes - CHANGELOG

## Summary

Fixed product discovery pipeline end-to-end to handle follow-up queries correctly, map user language to dataset taxonomy, and ensure full catalog coverage.

## Root Causes Fixed

1. **LLM outputs categories that don't match DB taxonomy** - strict equality caused `dbCandidates=0`
2. **Text query only soft scoring** - correct items weren't fetched when category missing
3. **Pending suggestion logic wrongly confirms** - old suggestions confirmed instead of running new discovery
4. **Relaxation drops all constraints** - response layer hides results as "noExactMatch"
5. **Follow-ups return wrong categories or 0 cards** - no synonym mapping or tolerant matching

## Fixes Implemented

### A) Canonicalization + Synonym Layer

**Location:** `src/lib/search/canonicalize.ts`

- Created comprehensive `CATEGORY_SYNONYMS` map with canonical groups
- Maps user language variations to canonical categories:
  - `tshirt`, `t-shirt`, `tee`, `tees`, `graphic tee` → `TSHIRT`
  - `skirt`, `skirts`, `denim skirt` → `SKIRT`
  - `jean`, `jeans`, `denim` → `JEANS`
  - And more...
- Exposes:
  - `canonicalizeCategory(userText, ontology)` - maps text to canonical category
  - `getExpandedLeafCategories(canonical, ontology)` - gets DB category values
  - `getParentGpcTerms(canonical)` - gets Google Product Category terms
  - `getSynonymTerms(canonical)` - gets product type synonyms

**Key Functions:**
- `canonicalizeCategory()` - Returns canonical category, matched synonyms, confidence
- `getExpandedLeafCategories()` - Returns actual DB category values for matching
- `getSynonymTerms()` - Returns synonyms for keyword filtering

### B) Normalize DB Category Matching (No Strict Equality)

**Location:** `src/lib/search/index.ts`

- Updated `buildBroadWhereFilters()` to use canonicalization
- Replaced strict `category = constraints.category` with tolerant matching:
  - Builds `categoryOr` array with OR conditions for:
    - DB category field (contains match on expanded leaf categories)
    - googleProductCategory (in JSON attributes)
    - productType (in JSON attributes)
- Updated `dbRankedSearch()` to handle `categoryOr` in SQL WHERE clause
- Updated `matchesAttributeFilters()` to check JSON attributes for canonical category matches

**Key Changes:**
- `buildBroadWhereFilters()` now async, accepts `userMessage` for canonicalization
- `categoryOr` field in `BroadWhereFilters` for tolerant matching
- SQL WHERE uses `LIKE` for category matching instead of strict equality
- Post-filter checks `googleProductCategory` and `productType` in JSON attributes

### C) Keyword Prefilter in SQL

**Location:** `src/lib/search/index.ts`

- Always includes keyword prefilter when canonical category detected
- When category is missing or UNKNOWN, uses synonym terms for SQL filtering
- SQL WHERE clause includes `LIKE` conditions on `title`, `description`, `category`
- Keyword filters passed through widening tiers during relaxation

**Key Changes:**
- `keywordFilters` field in `BroadWhereFilters`
- SQL text filtering when category missing or low confidence
- Keyword filters preserved during relaxation (Fix F)

### D) Fix Follow-up vs Switch Logic

**Location:** `src/lib/llm/orchestrator/followup-detector.ts`

- Created `detectFollowUpType()` function with heuristics:
  - **SWITCH**: Detects `only/just/instead/show me X` → drops incompatible constraints
  - **REFINE**: Detects `black ones/cheaper/smaller` → keeps vibe and hard filters
  - **CONFIRM_SUGGESTION**: Detects `yes/show me` without new category → confirms pending
- Updated `mergeConstraints()` to handle follow-up types:
  - SWITCH: Drops derived filters (seasons/occasions/materials) unless user restates
  - REFINE: Keeps vibe and hard filters
  - Default: Normal merge behavior

**Key Functions:**
- `detectFollowUpType(userMessage, previousConstraints, hasPendingSuggestion, ontology)`
- Returns `FollowUpDetection` with `followUpType`, `overrideCategory`, `carryOver`

### E) Fix Pending Suggestion Gating

**Location:** `src/lib/llm/orchestrator/index.ts`

- Pending suggestion only auto-confirmed if `followUpType == CONFIRM_SUGGESTION`
- If user includes canonical category noun, always runs discovery and overrides suggestion
- Uses `detectFollowUpType()` before confirming pending suggestions

**Key Changes:**
- Added follow-up detection before pending suggestion confirmation
- Category switch detection overrides pending suggestions
- Explicit category requests always trigger new discovery

### F) Relaxation + Ranking

**Location:** `src/lib/search/index.ts`

- Updated `buildWideningTiers()` to keep `keywordFilters` during relaxation
- Canonical category OR keyword prefilter maintained at all times
- Only drops category at final stage, but keeps keyword scoring
- Ranking boosts for canonical matches:
  - Boost if DB category ∈ expanded leaf categories
  - Boost if title contains synonym terms

**Key Changes:**
- `keywordFilters` preserved in widening tiers
- Category OR conditions maintained during relaxation
- Soft scoring for canonical matches in ranking

### G) Tests Added

**Location:** `tests/discovery_followups.test.ts`

- Unit tests for canonicalization:
  - T-shirt synonym mapping
  - Skirt synonym mapping
  - UNKNOWN for unrecognized text
- Unit tests for follow-up detection:
  - SWITCH detection (`only tshirts`, `just show some tshirts`, `show me skirts instead`)
  - REFINE detection (`black ones`, `cheaper`, `show more like that`)
  - CONFIRM_SUGGESTION detection (`yes` with pending, `show me tees` overrides)
- End-to-end scenarios:
  - Initial broad request + switch to tshirts
  - Switch with "instead" keyword
  - Refinement maintaining category

## Files Created

1. **`src/lib/search/canonicalize.ts`**
   - Canonical category types and synonym mapping
   - Canonicalization functions

2. **`src/lib/llm/orchestrator/followup-detector.ts`**
   - Follow-up type detection logic
   - Heuristics for SWITCH/REFINE/CONFIRM_SUGGESTION

3. **`tests/discovery_followups.test.ts`**
   - Unit tests for canonicalization
   - Unit tests for follow-up detection
   - End-to-end scenario tests

## Files Modified

1. **`src/lib/search/index.ts`**
   - Updated `buildBroadWhereFilters()` for canonicalization
   - Added `categoryOr` and `keywordFilters` to `BroadWhereFilters`
   - Updated `dbRankedSearch()` for tolerant category matching
   - Updated `matchesAttributeFilters()` for JSON attribute matching
   - Updated `buildWideningTiers()` to keep keyword filters
   - Updated `searchProducts()` to accept `userMessage` parameter

2. **`src/lib/llm/orchestrator/intent.ts`**
   - Updated `IntentResolution` type with follow-up detection fields
   - Updated `inferIntentAndConstraints()` to accept `hasPendingSuggestion`
   - Updated `normalizeResult()` to handle follow-up types in merging

3. **`src/lib/llm/orchestrator/index.ts`**
   - Updated pending suggestion gating with follow-up detection
   - Updated `runDiscoveryFlow()` to pass `userMessage` to search
   - Updated `searchProductsRelaxed()` to accept `userMessage` parameter

## Behavior Changes

### Before
- Follow-ups like "only tshirts" returned 0 cards (strict category matching failed)
- LLM category outputs didn't match DB taxonomy
- Text query was soft scoring only, so items weren't fetched
- Pending suggestions confirmed even when user requested new category
- Relaxation dropped all constraints, hiding results

### After
- Follow-ups correctly map synonyms to canonical categories
- Tolerant category matching finds products even with slight taxonomy mismatches
- Keyword prefilter ensures relevant items are fetched when category missing
- Pending suggestions only confirmed when explicit confirmation, not on category switches
- Relaxation maintains canonical category/keyword prefilter, ensuring results shown

## Test Cases Covered

✅ **Initial broad request + switch**: "smart casual outfit for office in summer" → "only tshirts"  
✅ **Switch with "instead"**: "show me skirts instead"  
✅ **Refinement**: "show me tshirts" → "black ones"  
✅ **Synonym mapping**: "just tees" → canonical TSHIRT  
✅ **Pending suggestion**: "show me" confirms, but "show me tees" overrides  

## Performance Impact

- **Minimal**: Canonicalization is O(1) map lookup
- **SQL filtering**: Uses indexed `LIKE` queries (acceptable for fallback)
- **Tolerant matching**: OR conditions are efficient with proper indexes
- **Full catalog coverage**: Adaptive take ensures 13k products searched effectively

## Backward Compatibility

- All changes are backward compatible
- Existing flows continue to work
- New functionality only activates when needed
- No breaking API changes

