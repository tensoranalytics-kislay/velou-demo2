# Analysis: "I want long sleeve tshirts" Query

## Summary

**Query**: "I want long sleeve tshirts"  
**Result**: 0 products returned  
**Total Time**: 14.00 seconds  
**Issue**: Vector search returned 0 results after filtering found 10 matching products

---

## Pipeline Flow Analysis

### 1. Classification Stage ✅

**Categories Extracted:**
- `Mens-tees` (primary category)

**Constraints Extracted:**
- **Sleeves**: `{ values: ["long"], intent: "required" }` ✅ Correctly extracted
- **Colors**: `{ values: ["White", "Navy", "Gray", "Beige", "Black", "Blush"], intent: "strong" }` (inferred)
- **Gender**: `male` (inferred from "tshirts" context)
- **AgeGroup**: `Adult` (default)

**Classification Status**: ✅ Working correctly

---

### 2. Retrieval Stage

#### Stage 1: Category SQL Filtering
- **Found**: 139 products in category `Mens-tees`
- **Status**: ✅ Working

#### Stage 2: Post-SQL Filtering
- **Input**: 139 products
- **Filters Applied**:
  - Sleeves: `["long"]` (required - hard filter)
  - Colors: `["White", "Navy", "Gray", "Beige", "Black", "Blush"]` (strong - soft ranking)
- **Filtered Down To**: 10 products ✅
- **Reduction**: 92.81% (129 products filtered out)
- **Status**: ✅ Working correctly - found 10 long sleeve products

**Sample Matching Products:**
- `cwch-mari-dmos` - "Men's Cotton Waffle Curved Hem Henley"
- `sclt-drig-heag` - "Long Sleeve Crew Tee Driggs"
- `sclt-drig-darg` - "Men's Classic Crew Neck Black T-Shirt"
- `long-sleeve-crew-tee-driggs-2-pack-d-3`
- `long-sleeve-crew-tee-driggs-3-pack-d-3`

**Issues Found:**
- ⚠️ Several `Womens-tees` products were skipped due to missing dictionary:
  - `the-v-neck-marcy-essentials-4-pack`
  - `cwcc-mari-darg`
  - `svnt-drig-balt`
  - `slub`
  - `fitted-v-neck-marcy-10-pack-d-4`
  - `boxy-semi-crop-noble-2-pack-d-6`

  **Note**: These products don't have dictionaries, so they're excluded from filtering.

#### Stage 3: Vector Search
- **Input**: 10 pre-filtered product IDs
- **Result**: 0 products ❌
- **Status**: ❌ **PROBLEM** - Vector search returned 0 results even though 10 products matched filters

**Root Cause**: The vector search query appears to be applying the sleeve filter again, but the products that passed post-SQL filtering might not be matching the vector search's sleeve filter criteria. There might be a normalization mismatch (e.g., "Long" vs "long" vs "Long Sleeve").

---

## Key Findings

### ✅ What Worked:
1. **Constraint Extraction**: Correctly extracted `sleeves: { values: ["long"], intent: "required" }`
2. **Category Classification**: Correctly identified `Mens-tees`
3. **Post-SQL Filtering**: Successfully filtered 139 → 10 products with long sleeves
4. **Color Inference**: Correctly inferred neutral colors as "strong" intent

### ❌ What Failed:
1. **Vector Search**: Returned 0 results after post-SQL filtering found 10 matches
2. **Missing Dictionaries**: `Womens-tees` products excluded due to missing category dictionaries

---

## Detailed Logs

### Constraint Extraction:
```
sleeves: { values: ["long"], intent: "required" }
colors: { values: ["White", "Navy", "Gray", "Beige", "Black", "Blush"], intent: "strong" }
```

### Post-SQL Filtering Results:
```
originalCount: 139
filteredCount: 10
reductionPercentage: 92.81%
filtersApplied: {
  sleeves: 1,
  sleeveValues: ["long"],
  sleeveIntent: "required",
  colors: 6,
  colorValues: ["White", "Navy", "Gray", "Beige", "Black", "Blush"],
  colorIntent: "strong"
}
```

### Vector Search Results:
```
count: 0
requestedLimit: 150
hasPreDeduplicatedIds: true
productIdsCount: 10
```

---

## Recommendations

1. **Fix Vector Search Sleeve Matching**: The vector search appears to be too strict. The 10 products that passed post-SQL filtering should be returned, but vector search is filtering them out again.

2. **Build Dictionaries for Womens-tees**: Add category dictionaries for `Womens-tees` so those products can be included in filtering.

3. **Check Sleeve Normalization**: Verify that the vector search's sleeve filter matches the post-SQL filtering normalization (e.g., "Long" vs "long" vs "Long Sleeve").

4. **Consider Bypassing Vector Search**: If products are already filtered correctly by post-SQL filtering, consider bypassing vector search's duplicate filtering or making it less strict for pre-filtered products.
