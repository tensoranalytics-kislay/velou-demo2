# Implementation Summary: Body Type Mentions → `inclusivitySizing` Hard SQL Filter

## Changes Made

### 1. Type Definitions Updated

**Files**:
- `src/lib/search/types.ts` - Added `inclusivitySizing?: string[]` to `SearchConstraints`
- `src/lib/search/query/types.ts` - Added `inclusivitySizing?: string[]` to `BroadWhereFilters`
- `src/lib/loveshackfancy/classifier.ts` - Added `inclusivitySizing?: string[] | ConstraintWithIntent | null` to `FashionConstraints`

### 2. SQL Filtering Updated

**Files**:
- `src/lib/search/query/buildFilters.ts` - Added `inclusivitySizing` to `buildBroadWhereFilters()` output
- `src/lib/search/ranking/dbRankedSearch.ts` - Added SQL WHERE clause filter: `"inclusivitySizing" = ANY(ARRAY[...])`

### 3. Constraint Extraction Updated

**Files**:
- `src/lib/loveshackfancy/prompts.ts`:
  - Added `inclusivitySizing` to JSON schema (lines ~1166-1179)
  - Updated contextual inference rules (lines ~459-471) to extract body type mentions as `inclusivitySizing: ["Plus Size"]` with "required" intent
  - Updated fit inference rules (lines ~792-794) to prioritize `inclusivitySizing` extraction
  - Updated size inference rules (lines ~810-814) to clarify body type ≠ sizes

- `src/lib/loveshackfancy/retrieval.ts` - Updated `classificationToSearchConstraints()` to map `inclusivitySizing` from `FashionConstraints` to `SearchConstraints`

---

## Body Type Mapping Rules

### Extracted as `inclusivitySizing: ["Plus Size"]` (Hard SQL Filter)

**Keywords that trigger "Plus Size" extraction**:
- "curvy", "curvy women", "curvy woman", "curvy mom", "curvy moms"
- "fat", "overweight", "larger size", "bigger size"
- "plus size", "plus-size", "plus sized"

**Intent**: Always `"required"` (hard SQL filter)

### Extracted as Other `inclusivitySizing` Values

- "petite", "small frame" → `inclusivitySizing: ["Petite"]` (required)
- "tall", "long torso" → `inclusivitySizing: ["Tall"]` (required)
- "extended sizes" → `inclusivitySizing: ["Extended Sizes"]` (required)

---

## SQL Filter Behavior

### Hard SQL Filter Applied

When `inclusivitySizing: ["Plus Size"]` is extracted:

```sql
WHERE "inclusivitySizing" = ANY(ARRAY['Plus Size']::text[])
```

**Result**: Only products with `inclusivitySizing = 'Plus Size'` are returned (78 products in the database).

**Applied at**: SQL WHERE clause level (before vector search, before ranking)

**Indexed**: Yes - `inclusivitySizing` column has an index (`idx_product_age_group` in migration)

---

## Example Queries

### Query: "I am a curvy mom, suggest me a dress"

**Extracted Constraints**:
```javascript
{
  ageGroups: ["Adult"],           // ✅ Correct (not "Curvy Women")
  gender: "female",               // ✅ Extracted from "mom"
  inclusivitySizing: ["Plus Size"], // ✅ NEW: Hard SQL filter
  category: "Women's Dresses"     // ✅ Extracted from "dress"
}
```

**SQL WHERE Clause**:
```sql
WHERE 
  "merchantId" = 'default'
  AND "stockStatus" = 'in_stock'
  AND "category" = "Women's Dresses"
  AND "gender" = 'female'
  AND "ageGroup" = 'Adult'
  AND "inclusivitySizing" = 'Plus Size'  -- ✅ NEW: Hard SQL filter
```

**Result**: Only 78 products with `inclusivitySizing = "Plus Size"` are returned.

---

## Verification

To verify the implementation works:

1. **Test Query**: "I am a curvy mom, suggest me a dress"
2. **Expected Constraint**: `inclusivitySizing: ["Plus Size"]` (required intent)
3. **Expected SQL Filter**: `WHERE "inclusivitySizing" = 'Plus Size'`
4. **Expected Results**: Only products with `inclusivitySizing = "Plus Size"` (78 products)

---

## Database Column

**Column**: `Product.inclusivitySizing` (TEXT)
**Index**: `idx_product_age_group` (shared with ageGroup)
**Values**: 
- `"Plus Size"` (78 products)
- `"Petite"` (6 products)
- `"Tall"` (0 products)
- `"Extended Sizes"` (24 products)
- `"Standard Sizing"` (2,704 products)
- `null` (2,678 products)

---

## Summary

✅ **Body type mentions** (curvy, fat, plus size, etc.) are now extracted as `inclusivitySizing: ["Plus Size"]` with "required" intent

✅ **Hard SQL filter** is applied at database level: `WHERE "inclusivitySizing" = 'Plus Size'`

✅ **Only 78 products** with `inclusivitySizing = "Plus Size"` will be returned for "curvy" queries

✅ **Age groups remain correct**: "curvy mom" → `ageGroups: ["Adult"]` (not "Curvy Women")

✅ **No changes to age groups**: Body type is correctly handled as `inclusivitySizing`, not `ageGroups`
