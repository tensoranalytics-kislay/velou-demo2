# Exact Failure Points - From Logs

## Query: "for women"

### ✅ Step 1: Gender Extraction - WORKING
```
[16:27:04.746Z] gender_and_agegroup_extracted_early
resolvedGender: "female" ✅
```

### ✅ Step 2: Categories Filtered Before Classification - WORKING  
```
[16:27:05.775Z] categories_filtered_before_classification
totalCategories: 101 ✅
```

### ❌ Step 3: Category Classification - FAILING
```
[16:27:11.237Z] starting_retrieval
categoryCount: 0 ❌
```

**ROOT CAUSE**: Query "for women" is too vague - no product type, so LLM returns 0 categories.

### ❌ Step 4: Tier 1 Block SKIPPED
**Location**: `retrieval.ts` line 362
```typescript
if (expandedCategories && expandedCategories.length > 0) {
  // Tier 1: Post-SQL filtering with gender filter
}
// When topCategories.length === 0, this entire block is SKIPPED
```

**Result**: Code goes to fallback path at line 926.

### ❌ Step 5: Fallback Path - MISSING GENDER FILTER
**Location**: `retrieval.ts` line 926-942
```typescript
if (result.length === 0 && (!topCategories || topCategories.length === 0)) {
  result = await searchVectorIndexWithDeduplication(
    queryEmbedding,
    150,
    {
      inStockOnly: true,
      merchantId,
      categories: undefined,
      priceMinCents: searchConstraints.priceMinCents,
      // ❌ MISSING: genders: searchConstraints.genders
      ageGroups: searchConstraints.ageGroups,
      ...
    }
  );
}
```

**ROOT CAUSE**: Gender filter NOT passed to `searchVectorIndexWithDeduplication` in fallback path.

### ❌ Step 6: Ranking - RANKING MEN'S PRODUCTS
**Evidence from logs**:
```
[16:27:13.675Z] constraint_match_details
productId: "475424152530651146"
productTitle: "Men's Bundle 06..."
rawAttributesSample: {"gender":"male"}
finalScore: 1
```

**ROOT CAUSE**: Products with `gender: "male"` are being ranked because SQL gender filter wasn't applied.

## Fixes Applied

1. ✅ Added `genders` to fallback `searchVectorIndexWithDeduplication` call (line 927)
2. ✅ Added `genders` to Tier 1 post-SQL path (line 528)
3. ✅ Added `genders` to Tier 2 relaxed path (line 752)
4. ✅ Added `genders` to Tier 3 keyword vector fallback (line 638)
5. ✅ Added `genders` to Tier 4 pure vector (line 903)
6. ✅ Added `genders` to `deduplicateProductsByCategory` calls (Tier 2, Tier 4)
7. ✅ Added `genders` to `searchProductsByKeyword` calls (Tier 3)
8. ✅ Added `genders` parameter to `searchProductsByKeyword` function signature

## Remaining Issue

Even after fixes, products with `gender: "male"` may still appear if:
- Database `gender` column doesn't match `attributes.gender`
- Products are marked as "unisex" in database but have "male" in attributes

**Need to verify**: Check actual SQL queries being generated to confirm gender filter is in WHERE clause.
