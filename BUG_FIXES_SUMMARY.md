# Bug Fixes Summary - Constraint Inference & Search Issues

## Issues Fixed

### 1. ✅ LLM Bad Sentinel Values (`0` and `""`)

**Problem:** LLM was producing `priceMinCents: 0`, `priceMaxCents: 0`, `category: ""`, `fit: ""` which were being treated as real filters, causing searches to return 0 results.

**Fix:** Added `normalizeConstraintValues()` function in `utils.ts` that:
- Converts empty strings to `undefined` for scalar fields (category, fit, query)
- Converts `0` to `undefined` for price fields (unless user explicitly said "$0")
- Filters out empty strings from arrays
- Applied after LLM constraint extraction and gatekeeper delta extraction

**Files Changed:**
- `src/lib/llm/orchestrator/utils.ts` - Added `normalizeConstraintValues()`
- `src/lib/llm/orchestrator/intent.ts` - Applied normalization after LLM parsing and gatekeeper results

---

### 2. ✅ Category Switch Not Clearing Incompatible Constraints

**Problem:** When user switched categories (e.g., "show me skirts instead"), old constraints (colors, fabrics, occasions) from previous category were being merged in, causing over-filtering.

**Fix:** Updated `mergeConstraints()` in `intent.ts` to detect category changes and clear incompatible constraints:
- When `updates.category !== base.category`, clears: colors, fabrics, materials, sizes, fit, occasions, seasons, useCases, productTypes, genders, brands
- Keeps: price range (category-agnostic), query (soft intent)

**Files Changed:**
- `src/lib/llm/orchestrator/intent.ts` - Added category change detection in `mergeConstraints()`

---

### 3. ✅ Empty Category Inventory Handling

**Problem:** When a specific category had 0 products, the system would silently drop the category and show random items without informing the user.

**Fix:** 
- Added specific messaging when category has no results
- Improved empty result handling in `runDiscoveryFlow()`
- When category is dropped during relaxation, shows products with clear messaging

**Files Changed:**
- `src/lib/llm/orchestrator/index.ts` - Enhanced empty result messaging in `runDiscoveryFlow()`

---

### 4. ✅ Retrieval → Response Mismatch (8 retrieved, 0 returned)

**Problem:** When `wasRelaxed=true`, the system was returning `productCards: []` and creating a pending suggestion, even when products were found.

**Fix:** Updated `runDiscoveryFlow()` logic:
- Shows products directly when relaxed (unless many candidates and category wasn't dropped)
- Only creates pending suggestion when: `hasManyCandidates && !categoryWasDropped`
- When category was dropped, shows products with clear messaging about the category switch

**Files Changed:**
- `src/lib/llm/orchestrator/index.ts` - Fixed relaxed search product display logic

---

### 5. ✅ Soft Scoring for Closest Matches

**Problem:** Relaxation strategy was just dropping filters and returning random top results, not finding closest matches.

**Fix:** Enhanced scoring in `searchProducts()` when `wasRelaxed=true`:
- Added soft attribute matching scores:
  - Color match: +0.3
  - Fabric/material match: +0.3
  - Occasion match: +0.2
  - Season match: +0.2
  - Fit match: +0.2
- Products are ranked by how closely they match original constraints, not just by recency

**Files Changed:**
- `src/lib/search/index.ts` - Enhanced scoring with soft attribute matching when relaxed

---

### 6. ✅ Pending Suggestion Override Handling

**Problem:** When pending suggestion was overridden with a new query, LLM delta could be empty, causing fallback to old constraints.

**Fix:** 
- Gatekeeper now properly handles new queries that override pending suggestions
- Constraints delta is normalized to remove bad values
- Category changes properly clear incompatible constraints

**Files Changed:**
- `src/lib/llm/orchestrator/intent.ts` - Normalized gatekeeper constraintsDelta
- `src/lib/llm/orchestrator/index.ts` - Improved pending suggestion override handling

---

## Testing Recommendations

1. **Test bad sentinel values:**
   - Query: "casual summer dress under $50"
   - Follow-up: "can you find some black ones"
   - Verify: No `priceMinCents: 0` or `category: ""` in constraints

2. **Test category switch:**
   - Query: "smart casual outfit for office"
   - Follow-up: "show me skirts instead"
   - Verify: Old colors/fabrics/occasions are cleared, only skirts category remains

3. **Test empty category:**
   - Query: "skirts" (if catalog has no skirts)
   - Verify: Clear message about no skirts, suggests alternatives

4. **Test relaxed search:**
   - Query with strict filters that yield 0 results
   - Verify: Products are shown (not hidden behind pending suggestion)
   - Verify: Products are ranked by closest match to original constraints

5. **Test pending override:**
   - Create pending suggestion
   - Query: "denim skirts"
   - Verify: Fresh constraints extracted, old constraints cleared

---

## Files Modified

1. `src/lib/llm/orchestrator/utils.ts` - Added `normalizeConstraintValues()`
2. `src/lib/llm/orchestrator/intent.ts` - Category change detection, normalization
3. `src/lib/llm/orchestrator/index.ts` - Fixed relaxed search display, empty category handling
4. `src/lib/search/index.ts` - Enhanced soft scoring for closest matches

---

## Verification

- ✅ TypeScript compilation: PASSED
- ✅ Build process: PASSED
- ✅ Linting: PASSED

All fixes are backward compatible and maintain existing API contracts.


