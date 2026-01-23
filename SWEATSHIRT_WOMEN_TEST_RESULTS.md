# Sweatshirt for Women Query Test Results

## Query
"sweatshirt for women"

## Extracted Constraints

### Gender
- **Value**: `female` (extracted early)
- **Intent**: `required` (hard SQL filter)

### Category
- **Category**: `Womens-sweaters` ⚠️
- **Classification**: `direct_search`
- **Issue**: Category was classified as "Womens-sweaters" instead of a sweatshirt-specific category

## Recommended Products

### 1. Stone Knitted Crop Jumper
- **Product ID**: `100041888`
- **Price**: $26.99
- **Reason**: Chosen because comfortable.
- **Category**: `Womens-sweaters`
- **Gender**: `female`
- **Is Sweatshirt**: ❌ NO (it's a jumper/sweater)
- **Is Women's**: ✅ YES
- **Matches All Requirements**: ❌ NO

### 2. Cream Ribbed Bardot Jumper
- **Product ID**: `100042645`
- **Price**: $26.99
- **Reason**: Chosen because flattering and comfortable.
- **Category**: `Womens-sweaters / Bardot Tops`
- **Gender**: `female`
- **Is Sweatshirt**: ❌ NO (it's a jumper/sweater)
- **Is Women's**: ✅ YES
- **Matches All Requirements**: ❌ NO

### 3. Blue Ribbed Bardot Jumper
- **Product ID**: `100042646`
- **Price**: $26.99
- **Reason**: Chosen because flattering and comfortable.
- **Category**: `Womens-sweaters`
- **Gender**: `female`
- **Is Sweatshirt**: ❌ NO (it's a jumper/sweater)
- **Is Women's**: ✅ YES
- **Matches All Requirements**: ❌ NO

### 4. Black Knitted Beaded Batwing Jumper
- **Product ID**: `200265000`
- **Price**: $29.99
- **Reason**: Chosen because comfortable and stretch.
- **Category**: `Womens-sweaters`
- **Gender**: `female`
- **Is Sweatshirt**: ❌ NO (it's a jumper/sweater)
- **Is Women's**: ✅ YES
- **Matches All Requirements**: ❌ NO

## Analysis

### ⚠️ Constraint Extraction Issues
- Gender correctly extracted as `female` with `required` intent ✅
- **Category incorrectly classified**: "sweatshirt" was mapped to "Womens-sweaters" instead of a sweatshirt-specific category ❌
- The system is treating "sweatshirt" as similar to "sweater" and returning sweaters/jumpers

### ❌ Product Quality Issues
- **0% of products match the sweatshirt requirement** ❌
- All 4 products are:
  - Women's (gender: female) ✅
  - Sweaters/Jumpers, NOT sweatshirts ❌

### ❌ Results Accuracy
- **0% match rate for sweatshirt requirement** (0/4 products)
- All products are sweaters/jumpers, not sweatshirts
- Products match the gender requirement but not the product type requirement

## Issues Identified

### 1. Category Classification Problem
- **Issue**: "sweatshirt" is being classified as "Womens-sweaters" instead of a sweatshirt-specific category
- **Root Cause**: The category classifier is likely treating "sweatshirt" and "sweater" as similar/related categories
- **Impact**: Returns sweaters/jumpers instead of sweatshirts

### 2. Product Type Mismatch
- **Issue**: All returned products are jumpers/sweaters, not sweatshirts
- **Root Cause**: Category classification is too broad, and vector search is matching on "sweater" similarity rather than "sweatshirt" specificity
- **Impact**: 0% accuracy for the actual query requirement

## Database Investigation

### Actual Sweatshirts in Database
There **ARE** actual sweatshirts in the database (3 found):
1. **Havenleigh Lace Logo Crewneck Sweatshirt for Women** - Category: `Tops`
2. **Wicked x LoveShackFancy Lumi Sweatshirt for Women** - Category: `Girls Tops`
3. **Little Girls Serafina Sequin Bow Sweatshirt for Women** - Category: `Girls Tops`

### Root Cause Identified
- **Actual sweatshirts are categorized as**: `Tops` and `Girls Tops` (NOT `Womens-sweaters`)
- **Query classified as**: `Womens-sweaters` (WRONG category)
- **Result**: 0 sweatshirts returned because the search is in the wrong category

## Recommendations

1. **Fix Category Classification**:
   - Map "sweatshirt" queries to `Tops` category (not `Womens-sweaters`)
   - Update the category classifier prompt to distinguish "sweatshirt" from "sweater"
   - Consider including both `Tops` and `Girls Tops` categories for "sweatshirt for women" queries

2. **Improve Category Mapping**:
   - Add explicit rule: "sweatshirt" → `Tops` category
   - Ensure "sweatshirt" is not conflated with "sweater" in classification

3. **Enhance Vector Search**:
   - Ensure vector embeddings distinguish between "sweatshirt" and "sweater" more clearly
   - Consider adding product type constraints to the search

## Summary
The query "sweatshirt for women" is **NOT working correctly**:
- ✅ Gender correctly extracted: `female` (required)
- ❌ **Category incorrectly classified**: "Womens-sweaters" instead of sweatshirt category
- ❌ **0% of products are sweatshirts** (0/4 products)
- ❌ All products are sweaters/jumpers, not sweatshirts
- **Action Required**: Fix category classification to properly distinguish "sweatshirt" from "sweater"
