# Stress Test Issues and Fixes

## Issues Found

### 1. ✅ FIXED: `queryAgeGroups is not defined` Error
**Problem**: Variable `queryAgeGroups` was defined inside an `else` block but referenced outside.
**Fix**: Moved `queryAgeGroups` declaration outside the `if/else` block.
**Status**: ✅ Fixed

### 2. ⚠️ IN PROGRESS: Wrong Gender Products Returned
**Problem**: When query is "for women", men's products are still being returned.
**Root Cause**: 
- Category expansion includes opposite-gender categories (e.g., "Womens-jeans" expands to include "Mens-jeans")
- Gender filter may not be applied correctly when categories are expanded
- Follow-up queries like "for women" may not extract gender correctly

**Fix Applied**: Added gender filtering to expanded categories in `retrieval.ts`
```typescript
// Filter expanded categories by resolved gender
if (expandedCategories && resolvedGender) {
  // Remove opposite-gender categories
}
```

**Status**: ⚠️ Needs verification - still seeing men's products

### 3. ⚠️ Gender Extraction for Follow-ups
**Problem**: Short follow-up queries like "for women" may not extract gender correctly.
**Investigation Needed**: Check if `detectGenderFromQuery` handles short phrases correctly.

### 4. ⚠️ AgeGroup Extraction Missing "baby" Keyword
**Problem**: Query "Find me baby clothes" extracts `Adult` instead of `Baby`.
**Root Cause**: AgeGroup extraction mapping doesn't include "baby" keyword.
**Fix Needed**: Add "baby" to ageGroup keyword mapping.

### 5. ⚠️ Gender Inference from Product Type
**Problem**: Queries like "I need a dress" don't infer `female` gender.
**Fix Needed**: Add product type → gender inference (dress → female, blouse → female, etc.)

## Next Steps

1. Verify gender filtering in expanded categories is working
2. Fix gender extraction for short follow-up queries
3. Add "baby" keyword to ageGroup extraction
4. Add gender inference from product types
5. Re-run stress test after fixes
