# Pipeline Failure - Detailed Log Analysis

## Query: "for women" (test-gender-filter-fix session)

### Expected Pipeline Flow:
1. Extract gender from query → `female`
2. Filter categories to women's/unisex only → 101 categories
3. LLM classifies to closest categories from filtered list
4. Expand categories (if any)
5. Filter expanded categories by gender
6. Use LLM to extract other constraints (excluding gender, category, ageGroup)
7. Use category-specific dictionaries
8. Apply constraints for ranking/filtering with relaxation

### Actual Execution from Logs:

#### ✅ Step 1: Gender Extraction - WORKING
```
[16:27:04.746Z] gender_and_agegroup_extracted_early
resolvedGender: "female" ✅
resolvedAgeGroup: "Adult" ✅
genderSource: "query" ✅
```

#### ✅ Step 2: Categories Filtered Before Classification - WORKING
```
[16:27:05.775Z] categories_filtered_before_classification
resolvedGender: "female" ✅
totalCategories: 101 ✅
```

#### ❌ Step 3: Category Classification - FAILING
```
[16:27:11.237Z] handleLoveshackfancyQuery: starting_retrieval
categoryCount: 0 ❌
```

**PROBLEM**: Query "for women" is too vague - no product type specified, so category classification returns **0 categories**.

#### ❌ Step 4: Category Expansion - SKIPPED
Because `topCategories.length === 0`, the code at line 362:
```typescript
if (expandedCategories && expandedCategories.length > 0) {
  // Tier 1 filtering...
}
```
**This entire block is SKIPPED** because `expandedCategories` is `undefined` (since `topCategories` is empty).

#### ❌ Step 5: Gender Filter in SQL - NOT APPLIED CORRECTLY

When there are NO categories, the code falls back to a different path. Looking at line 299-306:
```typescript
const contextAware = topCategories && topCategories.length > 0
  ? getContextAwareConstraints(searchConstraints, topCategories, query)
  : {
      sqlFilters: searchConstraints,  // Uses searchConstraints directly
      ...
    };
```

When `topCategories` is empty, it uses `searchConstraints` directly. But `searchConstraints` should have `genders: ["female"]` from line 106.

However, when the Tier 1 block is skipped (no categories), the code goes to a **FALLBACK PATH** that does a pure vector search WITHOUT proper gender filtering.

Looking at the logs:
```
[16:27:12.705Z] fashion_semantic_search
resultCount: 150
fallbackTier: "strict"
```

The vector search returned 150 candidates, but **men's products are in the results**.

#### ❌ Step 6: Ranking - RANKING MEN'S PRODUCTS

From logs:
```
[16:27:13.665Z] orchestrator_constraint_ranking_start
topVectorScores: [
  {productId: "475424152530651146", productTitle: "Men's Bundle 06...", vectorScore: 0.3699},
  {productId: "8366304792295533170", productTitle: "Men's Set...", vectorScore: 0.3640}
]

[16:27:13.675Z] constraint_match_details
productId: "475424152530651146"
productTitle: "Men's Bundle 06: 1 Polo + 1 Driggs Tee + 1 pair of Jeans"
rawAttributesSample: {"gender":"male", ...}
finalScore: 1
```

**PROBLEM**: Products with `"gender":"male"` are being ranked and returned!

## Root Cause Analysis

### Issue #1: No Categories Classified for Vague Queries

**Problem**: Query "for women" doesn't specify a product type, so category classification returns 0 categories.

**Why**: The LLM classifier needs a product type (jeans, dress, top, etc.) to classify. "for women" alone is too vague.

**Impact**: When `topCategories.length === 0`, the entire Tier 1 filtering block is skipped.

### Issue #2: Gender Filter Not Applied When No Categories

**Problem**: When there are no categories, the code takes a fallback path that doesn't properly apply gender filtering.

**Location**: `retrieval.ts` line 362 - the `if (expandedCategories && expandedCategories.length > 0)` check fails, so Tier 1 is skipped.

**What happens instead**: The code likely goes to a pure vector search path that doesn't include gender in the SQL WHERE clause, OR the gender filter is being applied but products in the database have incorrect gender tags.

### Issue #3: Products with Wrong Gender Tags in Database

**Evidence from logs**: Products being ranked have `"gender":"male"` in their `rawAttributesSample`, but they're still being returned for a `resolvedGender: "female"` query.

**Possible causes**:
1. Database `gender` column doesn't match `attributes.gender`
2. SQL gender filter isn't being applied correctly
3. Products are marked as "unisex" in database but have "male" in attributes

## Exact Breaking Points

### Breaking Point #1: Line 362 in `retrieval.ts`
```typescript
if (expandedCategories && expandedCategories.length > 0) {
  // Tier 1: Post-SQL filtering with gender filter
}
// When this is FALSE (no categories), code skips to fallback
```

**Fix needed**: When there are no categories BUT gender is resolved, we should still apply gender filter in the fallback path.

### Breaking Point #2: Fallback Vector Search Path

When Tier 1 is skipped, the code needs to ensure gender filter is still applied. Currently, the fallback path might not be passing `genders` to the vector search function.

### Breaking Point #3: Category Classification for Vague Queries

When query is just "for women" (no product type), category classification should still return some default categories (e.g., all women's categories) rather than 0.

## Required Fixes

1. **Fix fallback path to apply gender filter when no categories**
   - When `topCategories.length === 0` but `resolvedGender` is set, still apply gender filter in vector search

2. **Fix category classification for vague queries**
   - When query is too vague (just "for women"), return default categories based on gender (all women's categories)

3. **Verify database gender tags**
   - Check if products with `attributes.gender: "male"` have correct `gender` column in database
   - If not, fix database or add post-filtering to remove wrong-gender products

4. **Add gender filter to all vector search calls**
   - Ensure `genders` parameter is passed to `searchVectorIndexWithDeduplication` even when there are no categories
