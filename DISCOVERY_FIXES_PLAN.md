# Discovery Flow Fixes - Plan & Implementation

## Files Identified

### Core Constraint Handling
- `src/lib/search/types.ts` - `SearchConstraints` type definition
- `src/lib/llm/orchestrator/intent.ts` - `inferIntentAndConstraintsWithLlm`, `mergeConstraints`, `normalizeResult`
- `src/lib/llm/orchestrator/utils.ts` - `normalizeConstraintValues`, `normalizeConstraintArrays`, `detectGenderTokens`

### Search & Filtering
- `src/lib/search/index.ts` - `searchProducts`, `dbRankedSearch`, `buildBroadWhereFilters`, `matchesAttributeFilters`
- `src/lib/search/canonicalize.ts` - `canonicalizeCategory`, `CATEGORY_SYNONYMS`

### Card Building
- `src/lib/llm/orchestrator/cards.ts` - `deduplicateProductCards`
- `src/lib/llm/orchestrator/index.ts` - `runDiscoveryFlow`, `handleAssistantQuery`

### LLM Integration
- `src/lib/llm/provider.ts` - `callLLM`
- `src/lib/llm/prompts.ts` - LLM prompts and schemas

## Bugs Identified

1. **Strict category match returns 0**: `category = $3` with canonical "shirts & tops" doesn't match DB categories
2. **Detected gender never applied**: `detectedGenders` exists but `genderFilter` is undefined
3. **Multi-category requests collapse**: LLM returns comma-separated categories, but only first is used
4. **Card repetition**: Dedup runs after slicing, causing duplicates
5. **LLM JSON parsing brittle**: Malformed JSON wipes all constraints

## Test Plan

### T1: Category Canonical Mismatch
- Test: Given `{ category: "shirts & tops" }`, strict search should return >0
- Expected: Category normalization maps canonical → DB category list

### T2: Gender Refinement
- Test: "tshirts for men" → only mens products
- Test: "tshirts for women" → only womens products
- Expected: `genderFilter` is set and applied

### T3: Outfit Multi-Category
- Test: LLM returns `category: "shirts & tops, pants, dresses"`
- Expected: Search queries across all categories (OR)

### T4: Diversity / Dedup
- Test: Ranked list with duplicates
- Expected: Final cards unique by `product.id`, diverse, count matches requested

### T5: LLM JSON Failure Resilience
- Test: Malformed JSON response
- Expected: Rule-based refinements (gender, overrideCategory) still apply

## Implementation Plan

### Fix A: Category Canonical → DB Mapping
1. Update `SearchConstraints.category` to `string | string[]`
2. Create `CANONICAL_TO_DB_CATEGORIES` config
3. Expand canonical categories in `buildBroadWhereFilters`
4. Use `categoryOr` array in strict query

### Fix B: Apply Gender Properly
1. Ensure `detectedGenders` merges into `constraints.genders`
2. Apply gender filter in `dbRankedSearch` BEFORE ranking
3. Don't drop gender in widening tiers

### Fix C: Multi-Category Outfits
1. Parse comma-separated category string into array
2. Expand each canonical → DB list
3. Query with OR across all categories

### Fix D: Card Repetition / Diversity
1. Deduplicate by `product.id` BEFORE slicing
2. Add diversity step (group by subcategory/brand, interleave)
3. Ensure dedup runs on full list

### Fix E: LLM JSON Parse Robustness
1. Create `safeParseLlmJson` function
2. Try strict parse, then extract JSON substring
3. On failure, use previous constraints + rule-based refinements

