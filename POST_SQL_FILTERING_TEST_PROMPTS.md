# Post-SQL Filtration Test Prompts

This document contains 3 comprehensive test prompts to verify all post-SQL filtering changes work correctly.

**Feature Flag**: Set `ENABLE_POST_SQL_FILTERING=true` in your `.env` file before testing.

---

## Quick Test Prompts (Copy & Paste Ready)

### Test Prompt 1: Blue Maxi Dresses with Long Sleeves for Kids
```
"blue maxi dresses with long sleeves for kids"
```
**Expected Result**: 0 products (no products match ALL criteria: blue + maxi + long sleeves + kids age group)

### Test Prompt 2: Semi-Formal Round Neck Tops
```
"semi-formal round neck tops"
```
**Expected Result**: Product 8271020622009 - "Kelli Sequin Tweed Jacket for Women in Country Air" (matches Round neckline + Semi-Formal formalityLevel)

### Test Prompt 3: Light Colored Casual Dresses
```
"light colored casual dresses"
```
**Expected Result**: At least 5 products including:
- Product 8084016267449 - "Judalon Cotton Midi Dress for Women in Optic White"
- Product 7814030885049 - "Esilda Heritage Cotton Midi Dress for Women in True White"
- Product 8084018757817 - "Aline Gingham Eyelet Mini Dress for Women in Angel Pink"
- Product 8084018921657 - "Linella Linen Maxi Dress for Women in Ballerina Pink"
- Product 8084018888889 - "Sherina Cotton Smocked Mini Dress for Women in Pink Shimmer"

---

**Expected Behavior**: 
- Stage 1: Category-only SQL filter should return a candidate set
- Stage 2: Category-specific dictionaries should be built from candidate set
- Stage 3: Post-SQL filters should be applied using dictionaries
- Stage 4: Vector search on filtered IDs

**Logging**: Check terminal logs for:
- `buildCategorySpecificDictionaries: loaded products` - Should show product count and sample IDs
- `buildCategorySpecificDictionaries: built dictionary` - Should show dictionary for each category/subcategory with sample values and frequencies
- `applyPostSQLFilters: processing products` - Should show filters being applied
- `applyPostSQLFilters: product_matched_all_filters` / `product_failed_filters` - Should show why products matched/failed
- `applyPostSQLFilters: completed` - Should show reduction percentage and sample filtered IDs
- `fashion_semantic_search: post_sql_filtering_stage1_complete` - Stage 1 completion
- `fashion_semantic_search: post_sql_filtering_stage2_complete` - Stage 2 completion  
- `fashion_semantic_search: post_sql_filtering_stage3_complete` - Stage 3 completion

---

## Test Prompt 1: Blue Maxi Dresses with Long Sleeves for Kids

**Query**: `"blue maxi dresses with long sleeves for kids"`

**Expected Constraint Extraction**:
- **Colors**: `["Blue"]` (semantically extracted from "blue")
- **Lengths**: `["Maxi"]` (semantically extracted from "maxi dresses")
- **Sleeves**: `["Long Sleeve"]` → mapped to `["Long"]` (semantically extracted from "long sleeves")
- **Age Groups**: `["Kids"]` (semantically extracted from "for kids")
- **Categories**: `["Girls Dresses", "Women's Dresses"]` (multi-category classification)

**Expected Products in Database**:
- Product ID: `8051735298233` - "Girls Mini Rialto Maxi Dress in Cotton Candy Swirl"
  - Category: "Girls Dresses", Subcategory: "Mini Rialto Maxi Dress"
  - enrichedColor: "Light Blue, Pink, Aqua, Pastel Pink, Soft Blue"
  - length: "Maxi"
  - sleeve: "Sleeveless" ❌ (Should be EXCLUDED - doesn't match "Long")
  - ageGroup: "Kids, Teen"

- Product ID: `8217312821433` - "Galatea Metallic Silk Chiffon Maxi Dress for Women in Airy Blue"
  - Category: "Women's Dresses", Subcategory: "Maxi Dresses"
  - enrichedColor: "Airy Blue, Light Blue, Soft Blue, Sky Blue" ✅
  - length: "Maxi" ✅
  - sleeve: "Long" ✅
  - formalityLevel: "Formal"
  - ageGroup: "Adult" ❌ (Should be EXCLUDED - doesn't match "Kids")

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Girls Dresses" and "Women's Dresses" categories with ageGroup "Kids"
2. **Dictionary Building (Stage 2)**: Should build dictionaries for:
   - `"Girls Dresses|Mini Rialto Maxi Dress"` - Should include colors: ["light blue", "pink", "aqua", "pastel pink", "soft blue"], lengths: ["maxi"], sleeves: ["sleeveless"]
   - `"Women's Dresses|Maxi Dresses"` - Should include colors: ["airy blue", "light blue", "soft blue", "sky blue"], lengths: ["maxi"], sleeves: ["long"]
   - `"Girls Dresses|"` - If products exist without subcategory
3. **Post-Filtering (Stage 3)**: 
   - For "Girls Dresses" products: Should filter by blue colors (match), maxi length (match), long sleeves (FAIL - only "Sleeveless" in dictionary)
   - For "Women's Dresses" products: Should filter by blue colors (match), maxi length (match), long sleeves (match), but EXCLUDE because ageGroup is "Adult"
4. **Expected Result**: Should return 0 products (all are filtered out due to age group or sleeve mismatch)

**Verification Logs to Check**:
```
✓ buildCategorySpecificDictionaries: loaded products - Should show product count for Girls Dresses and Women's Dresses
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Girls Dresses|Mini Rialto Maxi Dress" with sleeves: ["sleeveless"] (NOT "long")
✓ applyPostSQLFilters: processing products - Should show filters: {colors: ["Blue"], lengths: ["Maxi"], sleeves: ["Long"]}
✓ applyPostSQLFilters: product_failed_filters - Should show product 8051735298233 failed because sleeve "Sleeveless" doesn't match query "Long"
✓ applyPostSQLFilters: product_failed_filters - Should show product 8217312821433 failed because ageGroup "Adult" (filtered in Stage 1) or not in candidate set
✓ applyPostSQLFilters: completed - Should show filteredCount: 0 or very low
```

---

## Test Prompt 2: Semi-Formal Round Neck Tops (Updated - Using "Semi-Formal" since that's what exists in dataset)

**Query**: `"semi-formal round neck tops"`

**Expected Constraint Extraction**:
- **Necklines**: `["Round"]` (semantically extracted from "round neck")
- **Formality Level**: `["Semi-Formal"]` (semantically extracted from "semi-formal")
- **Categories**: `["Tops"]` (classified from "tops")

**Expected Products in Database**:
- Product ID: `8271020622009` - "Kelli Sequin Tweed Jacket for Women in Country Air"
  - Category: "Tops", Subcategory: "Jackets"
  - enrichedColor: "Light Blue, Sky Blue, Baby Blue, Silver, White"
  - neckline: "Round" ✅
  - formalityLevel: "Semi-Formal" ✅
  - sleeve: "Long"

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Tops" category (both with and without subcategory)
2. **Dictionary Building (Stage 2)**: Should build dictionaries for:
   - `"Tops|Jackets"` - Should include necklines: ["round"], formalityLevels: ["semi-formal"]
   - `"Tops|"` - Should include necklines: ["round"], formalityLevels: ["casual", "semi-formal"] (and "formal" if any exist)
3. **Post-Filtering (Stage 3)**:
   - Should filter by neckline="Round" (match for product 8271020622009)
   - Should filter by formalityLevel="Semi-Formal" (match for product 8271020622009)
4. **Expected Result**: Should return product 8271020622009 (and any others matching both criteria)

**Verification Logs to Check**:
```
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Tops|Jackets" with necklines: ["round"], formalityLevels: ["semi-formal"]
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Tops|" with necklines: ["round"], formalityLevels: ["casual", "semi-formal"]
✓ applyPostSQLFilters: processing products - Should show filters: {necklines: ["Round"], formalityLevels: ["Semi-Formal"]}
✓ applyPostSQLFilters: product_matched_all_filters - Should show product 8271020622009 matched both Round neckline AND Semi-Formal formalityLevel
✓ applyPostSQLFilters: completed - Should show filteredCount >= 1 (product 8271020622009)
```

**Alternative Test**: If testing strict matching, use `"formal round neck tops"` instead - this should return 0 products since "Semi-Formal" doesn't match "Formal" exactly.

---

## Test Prompt 3: Light Colored Casual Dresses

**Query**: `"light colored casual dresses"`

**Expected Constraint Extraction**:
- **Color Shade**: `["Light"]` (semantically extracted from "light colored")
- **Formality Level**: `["Casual"]` (semantically extracted from "casual")
- **Categories**: `["Women's Dresses"]` (classified from "dresses")

**Expected Products in Database**:
- Product ID: `8084016267449` - "Judalon Cotton Midi Dress for Women in Optic White"
  - Category: "Women's Dresses", Subcategory: "Midi Dresses"
  - enrichedColor: "White, Optic White, Pink, Light Pink" ✅ (contains "White" which is light)
  - colorShade: "Light" ✅
  - formalityLevel: "Casual" ✅
  - length: "Midi"
  - sleeve: "Sleeveless"

- Product ID: `7814030885049` - "Esilda Heritage Cotton Midi Dress for Women in True White"
  - Category: "Women's Dresses", Subcategory: "Midi Dresses"
  - enrichedColor: "White, Bright White, Pure White, Pink, Light Pink, Soft Pink" ✅
  - colorShade: "Light" ✅
  - formalityLevel: "Casual" ✅
  - length: "Midi"
  - sleeve: "Sleeveless"
  - neckline: "V-Neck"

- Product ID: `8084018757817` - "Aline Gingham Eyelet Mini Dress for Women in Angel Pink"
  - Category: "Women's Dresses", Subcategory: "Mini Dresses"
  - enrichedColor: null
  - colorShade: "Light" ✅
  - formalityLevel: "Casual" ✅
  - length: "Mini" (NOT "Midi" or "Maxi")

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Women's Dresses" category
2. **Dictionary Building (Stage 2)**: Should build dictionaries for:
   - `"Women's Dresses|Midi Dresses"` - Should include colorShades: ["light"], formalityLevels: ["casual"]
   - `"Women's Dresses|Mini Dresses"` - Should include colorShades: ["light"], formalityLevels: ["casual"]
   - `"Women's Dresses|"` - If products exist without subcategory
3. **Post-Filtering (Stage 3)**:
   - Should filter by colorShade="Light" (match for all 3 products)
   - Should filter by formalityLevel="Casual" (match for all 3 products)
4. **Expected Result**: Should return all 3 products (or more if others match)

**Verification Logs to Check**:
```
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Women's Dresses|Midi Dresses" with colorShades: ["light"], formalityLevels: ["casual"]
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Women's Dresses|Mini Dresses" with colorShades: ["light"], formalityLevels: ["casual"]
✓ applyPostSQLFilters: processing products - Should show filters: {colorShades: ["Light"], formalityLevels: ["Casual"]}
✓ applyPostSQLFilters: product_matched_all_filters - Should show products 8084016267449, 7814030885049, 8084018757817 all matched
✓ applyPostSQLFilters: completed - Should show filteredCount >= 3 (all matching products)
```

---

## Test Prompt 4: Blue Cardigans for 12 Year Old (Bonus Test - Age Group Filtering)

**Query**: `"blue cardigans for 12 year old"`

**Expected Constraint Extraction**:
- **Colors**: `["Blue"]`
- **Categories**: `["Tween Sweaters", "Girls Tops"]` (multi-category for age-specific query)
- **Age Groups**: `["Tween"]` (normalized from "12 year old")

**Expected Products in Database**:
- Product ID: `8246752346297` - "Little Girls Ebett Secret Crush Cardigan for Women in Chantilly"
  - Category: "Girls Tops"
  - neckline: "Round"
  - ageGroup: Should match "Tween" or be in "Girls" category

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Tween Sweaters" and "Girls Tops" categories with ageGroup="Tween"
2. **Dictionary Building (Stage 2)**: Should build dictionaries for each category
3. **Post-Filtering (Stage 3)**: Should filter by blue colors using category-specific dictionaries
4. **Expected Result**: Should return blue cardigans/sweaters for Tween age group

**Verification Logs to Check**:
```
✓ deduplicateProductsByCategoryForPostFiltering: executing query - Should show categories: ["Tween Sweaters", "Girls Tops"], ageGroups: ["Tween"]
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionaries for "Tween Sweaters|" and "Girls Tops|" with available colors including blue variations
✓ applyPostSQLFilters: processing products - Should show filters: {colors: ["Blue"]}
✓ applyPostSQLFilters: completed - Should show products filtered by blue colors from category-specific dictionaries
```

---

## How to Run Tests

1. **Set Feature Flag**:
   ```bash
   export ENABLE_POST_SQL_FILTERING=true
   # Or add to .env file:
   echo "ENABLE_POST_SQL_FILTERING=true" >> .env
   ```

2. **Start the Application**:
   ```bash
   npm run dev
   ```

3. **Send Test Queries** via API or UI:
   - Use the queries above in the chat interface
   - Monitor terminal logs for detailed logging output

4. **Verify Logs**:
   - Check for `post_sql_filtering` log entries
   - Verify dictionary building shows correct category-specific values
   - Verify post-filtering shows correct matching/failing products
   - Verify final results match expected products

5. **Verify Results**:
   - Check that returned products match all specified filters
   - Check that excluded products are not in results
   - Check that category-specific filtering worked correctly

---

## Expected Log Flow

For each test query, you should see this log sequence:

```
1. fashion_semantic_search: tier1_strict_filtering
   → usePostSQLFiltering: true

2. deduplicateProductsByCategoryForPostFiltering: executing query
   → categories: [...]
   → ageGroups: [...]
   → NOTE: colors, lengths, sleeves, necklines, formalityLevels, colorShades NOT in SQL filters

3. deduplicateProductsByCategoryForPostFiltering: results found
   → count: N (category-filtered product count)

4. buildCategorySpecificDictionaries: loaded products
   → productIdsCount: N
   → loadedProductsCount: M

5. buildCategorySpecificDictionaries: built dictionary
   → For each category/subcategory:
     → key: "Category|Subcategory"
     → productCount: N
     → sampleColors: [...]
     → sampleLengths: [...]
     → sampleSleeves: [...]
     → sampleNecklines: [...]
     → sampleFormalityLevels: [...]
     → sampleColorShades: [...]
     → frequencies: {...}

6. applyPostSQLFilters: processing products
   → productIdsCount: N
   → productsLoaded: M
   → filtersProvided: {...}
   → dictionaryCount: X
   → dictionaryKeys: [...]

7. applyPostSQLFilters: product_matched_all_filters / product_failed_filters
   → For each product (debug level):
     → productId, productTitle, categoryKey
     → filterResults: {...} (shows which filters matched/failed)

8. applyPostSQLFilters: completed
   → originalCount: N
   → filteredCount: M
   → reductionPercentage: "X%"
   → filtersApplied: {...}
   → sampleFilteredIds: [...]

9. fashion_semantic_search: post_sql_filtering_stage1_complete
   → categoryFilteredCount: N

10. fashion_semantic_search: post_sql_filtering_stage2_complete
    → dictionaryCount: X

11. fashion_semantic_search: post_sql_filtering_stage3_complete
    → originalCount: N
    → postFilteredCount: M
    → filtersApplied: {...}

12. fashion_semantic_search: tier1_success
    → resultCount: K
    → usePostSQLFiltering: true
    → productIdsToSearchCount: M
```

---

## Troubleshooting

If results are unexpected:

1. **Check Dictionary Building**: Look for `buildCategorySpecificDictionaries: built dictionary` logs - verify dictionaries contain expected values for each category
2. **Check Filter Matching**: Look for `applyPostSQLFilters: product_failed_filters` logs - verify why products are being excluded
3. **Check Category Filtering**: Look for `deduplicateProductsByCategoryForPostFiltering: results found` - verify category filtering returned expected products
4. **Check Constraint Extraction**: Look for `constraint_context: applied_category_metadata` - verify constraints were extracted correctly
5. **Check Feature Flag**: Verify `ENABLE_POST_SQL_FILTERING=true` is set and `usePostSQLFiltering: true` appears in logs

---

## Success Criteria

✅ **Test 1 (Blue Maxi Dresses with Long Sleeves for Kids)**: 
- Dictionary built for "Girls Dresses" shows sleeves: ["sleeveless"] (not "long")
- Products filtered out if sleeve doesn't match "Long"
- Products filtered out if ageGroup doesn't match "Kids"
- Final results: 0 products (or products that actually match all criteria)

✅ **Test 2 (Semi-Formal Round Neck Tops)**:
- Dictionary built for "Tops|Jackets" shows necklines: ["round"], formalityLevels: ["semi-formal"]
- Products filtered by neckline="Round" AND formalityLevel="Semi-Formal"
- Final results: Product 8271020622009 (and any others matching both criteria)

✅ **Test 3 (Light Colored Casual Dresses)**:
- Dictionary built for "Women's Dresses|Midi Dresses" shows colorShades: ["light"], formalityLevels: ["casual"]
- Products filtered by colorShade="Light" AND formalityLevel="Casual"
- Final results: Products 8084016267449, 7814030885049, 8084018757817 (and any others matching both criteria)


This document contains 3 comprehensive test prompts to verify all post-SQL filtering changes work correctly.

**Feature Flag**: Set `ENABLE_POST_SQL_FILTERING=true` in your `.env` file before testing.

---

## Quick Test Prompts (Copy & Paste Ready)

### Test Prompt 1: Blue Maxi Dresses with Long Sleeves for Kids
```
"blue maxi dresses with long sleeves for kids"
```
**Expected Result**: 0 products (no products match ALL criteria: blue + maxi + long sleeves + kids age group)

### Test Prompt 2: Semi-Formal Round Neck Tops
```
"semi-formal round neck tops"
```
**Expected Result**: Product 8271020622009 - "Kelli Sequin Tweed Jacket for Women in Country Air" (matches Round neckline + Semi-Formal formalityLevel)

### Test Prompt 3: Light Colored Casual Dresses
```
"light colored casual dresses"
```
**Expected Result**: At least 5 products including:
- Product 8084016267449 - "Judalon Cotton Midi Dress for Women in Optic White"
- Product 7814030885049 - "Esilda Heritage Cotton Midi Dress for Women in True White"
- Product 8084018757817 - "Aline Gingham Eyelet Mini Dress for Women in Angel Pink"
- Product 8084018921657 - "Linella Linen Maxi Dress for Women in Ballerina Pink"
- Product 8084018888889 - "Sherina Cotton Smocked Mini Dress for Women in Pink Shimmer"

---

**Expected Behavior**: 
- Stage 1: Category-only SQL filter should return a candidate set
- Stage 2: Category-specific dictionaries should be built from candidate set
- Stage 3: Post-SQL filters should be applied using dictionaries
- Stage 4: Vector search on filtered IDs

**Logging**: Check terminal logs for:
- `buildCategorySpecificDictionaries: loaded products` - Should show product count and sample IDs
- `buildCategorySpecificDictionaries: built dictionary` - Should show dictionary for each category/subcategory with sample values and frequencies
- `applyPostSQLFilters: processing products` - Should show filters being applied
- `applyPostSQLFilters: product_matched_all_filters` / `product_failed_filters` - Should show why products matched/failed
- `applyPostSQLFilters: completed` - Should show reduction percentage and sample filtered IDs
- `fashion_semantic_search: post_sql_filtering_stage1_complete` - Stage 1 completion
- `fashion_semantic_search: post_sql_filtering_stage2_complete` - Stage 2 completion  
- `fashion_semantic_search: post_sql_filtering_stage3_complete` - Stage 3 completion

---

## Test Prompt 1: Blue Maxi Dresses with Long Sleeves for Kids

**Query**: `"blue maxi dresses with long sleeves for kids"`

**Expected Constraint Extraction**:
- **Colors**: `["Blue"]` (semantically extracted from "blue")
- **Lengths**: `["Maxi"]` (semantically extracted from "maxi dresses")
- **Sleeves**: `["Long Sleeve"]` → mapped to `["Long"]` (semantically extracted from "long sleeves")
- **Age Groups**: `["Kids"]` (semantically extracted from "for kids")
- **Categories**: `["Girls Dresses", "Women's Dresses"]` (multi-category classification)

**Expected Products in Database**:
- Product ID: `8051735298233` - "Girls Mini Rialto Maxi Dress in Cotton Candy Swirl"
  - Category: "Girls Dresses", Subcategory: "Mini Rialto Maxi Dress"
  - enrichedColor: "Light Blue, Pink, Aqua, Pastel Pink, Soft Blue"
  - length: "Maxi"
  - sleeve: "Sleeveless" ❌ (Should be EXCLUDED - doesn't match "Long")
  - ageGroup: "Kids, Teen"

- Product ID: `8217312821433` - "Galatea Metallic Silk Chiffon Maxi Dress for Women in Airy Blue"
  - Category: "Women's Dresses", Subcategory: "Maxi Dresses"
  - enrichedColor: "Airy Blue, Light Blue, Soft Blue, Sky Blue" ✅
  - length: "Maxi" ✅
  - sleeve: "Long" ✅
  - formalityLevel: "Formal"
  - ageGroup: "Adult" ❌ (Should be EXCLUDED - doesn't match "Kids")

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Girls Dresses" and "Women's Dresses" categories with ageGroup "Kids"
2. **Dictionary Building (Stage 2)**: Should build dictionaries for:
   - `"Girls Dresses|Mini Rialto Maxi Dress"` - Should include colors: ["light blue", "pink", "aqua", "pastel pink", "soft blue"], lengths: ["maxi"], sleeves: ["sleeveless"]
   - `"Women's Dresses|Maxi Dresses"` - Should include colors: ["airy blue", "light blue", "soft blue", "sky blue"], lengths: ["maxi"], sleeves: ["long"]
   - `"Girls Dresses|"` - If products exist without subcategory
3. **Post-Filtering (Stage 3)**: 
   - For "Girls Dresses" products: Should filter by blue colors (match), maxi length (match), long sleeves (FAIL - only "Sleeveless" in dictionary)
   - For "Women's Dresses" products: Should filter by blue colors (match), maxi length (match), long sleeves (match), but EXCLUDE because ageGroup is "Adult"
4. **Expected Result**: Should return 0 products (all are filtered out due to age group or sleeve mismatch)

**Verification Logs to Check**:
```
✓ buildCategorySpecificDictionaries: loaded products - Should show product count for Girls Dresses and Women's Dresses
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Girls Dresses|Mini Rialto Maxi Dress" with sleeves: ["sleeveless"] (NOT "long")
✓ applyPostSQLFilters: processing products - Should show filters: {colors: ["Blue"], lengths: ["Maxi"], sleeves: ["Long"]}
✓ applyPostSQLFilters: product_failed_filters - Should show product 8051735298233 failed because sleeve "Sleeveless" doesn't match query "Long"
✓ applyPostSQLFilters: product_failed_filters - Should show product 8217312821433 failed because ageGroup "Adult" (filtered in Stage 1) or not in candidate set
✓ applyPostSQLFilters: completed - Should show filteredCount: 0 or very low
```

---

## Test Prompt 2: Semi-Formal Round Neck Tops (Updated - Using "Semi-Formal" since that's what exists in dataset)

**Query**: `"semi-formal round neck tops"`

**Expected Constraint Extraction**:
- **Necklines**: `["Round"]` (semantically extracted from "round neck")
- **Formality Level**: `["Semi-Formal"]` (semantically extracted from "semi-formal")
- **Categories**: `["Tops"]` (classified from "tops")

**Expected Products in Database**:
- Product ID: `8271020622009` - "Kelli Sequin Tweed Jacket for Women in Country Air"
  - Category: "Tops", Subcategory: "Jackets"
  - enrichedColor: "Light Blue, Sky Blue, Baby Blue, Silver, White"
  - neckline: "Round" ✅
  - formalityLevel: "Semi-Formal" ✅
  - sleeve: "Long"

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Tops" category (both with and without subcategory)
2. **Dictionary Building (Stage 2)**: Should build dictionaries for:
   - `"Tops|Jackets"` - Should include necklines: ["round"], formalityLevels: ["semi-formal"]
   - `"Tops|"` - Should include necklines: ["round"], formalityLevels: ["casual", "semi-formal"] (and "formal" if any exist)
3. **Post-Filtering (Stage 3)**:
   - Should filter by neckline="Round" (match for product 8271020622009)
   - Should filter by formalityLevel="Semi-Formal" (match for product 8271020622009)
4. **Expected Result**: Should return product 8271020622009 (and any others matching both criteria)

**Verification Logs to Check**:
```
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Tops|Jackets" with necklines: ["round"], formalityLevels: ["semi-formal"]
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Tops|" with necklines: ["round"], formalityLevels: ["casual", "semi-formal"]
✓ applyPostSQLFilters: processing products - Should show filters: {necklines: ["Round"], formalityLevels: ["Semi-Formal"]}
✓ applyPostSQLFilters: product_matched_all_filters - Should show product 8271020622009 matched both Round neckline AND Semi-Formal formalityLevel
✓ applyPostSQLFilters: completed - Should show filteredCount >= 1 (product 8271020622009)
```

**Alternative Test**: If testing strict matching, use `"formal round neck tops"` instead - this should return 0 products since "Semi-Formal" doesn't match "Formal" exactly.

---

## Test Prompt 3: Light Colored Casual Dresses

**Query**: `"light colored casual dresses"`

**Expected Constraint Extraction**:
- **Color Shade**: `["Light"]` (semantically extracted from "light colored")
- **Formality Level**: `["Casual"]` (semantically extracted from "casual")
- **Categories**: `["Women's Dresses"]` (classified from "dresses")

**Expected Products in Database**:
- Product ID: `8084016267449` - "Judalon Cotton Midi Dress for Women in Optic White"
  - Category: "Women's Dresses", Subcategory: "Midi Dresses"
  - enrichedColor: "White, Optic White, Pink, Light Pink" ✅ (contains "White" which is light)
  - colorShade: "Light" ✅
  - formalityLevel: "Casual" ✅
  - length: "Midi"
  - sleeve: "Sleeveless"

- Product ID: `7814030885049` - "Esilda Heritage Cotton Midi Dress for Women in True White"
  - Category: "Women's Dresses", Subcategory: "Midi Dresses"
  - enrichedColor: "White, Bright White, Pure White, Pink, Light Pink, Soft Pink" ✅
  - colorShade: "Light" ✅
  - formalityLevel: "Casual" ✅
  - length: "Midi"
  - sleeve: "Sleeveless"
  - neckline: "V-Neck"

- Product ID: `8084018757817` - "Aline Gingham Eyelet Mini Dress for Women in Angel Pink"
  - Category: "Women's Dresses", Subcategory: "Mini Dresses"
  - enrichedColor: null
  - colorShade: "Light" ✅
  - formalityLevel: "Casual" ✅
  - length: "Mini" (NOT "Midi" or "Maxi")

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Women's Dresses" category
2. **Dictionary Building (Stage 2)**: Should build dictionaries for:
   - `"Women's Dresses|Midi Dresses"` - Should include colorShades: ["light"], formalityLevels: ["casual"]
   - `"Women's Dresses|Mini Dresses"` - Should include colorShades: ["light"], formalityLevels: ["casual"]
   - `"Women's Dresses|"` - If products exist without subcategory
3. **Post-Filtering (Stage 3)**:
   - Should filter by colorShade="Light" (match for all 3 products)
   - Should filter by formalityLevel="Casual" (match for all 3 products)
4. **Expected Result**: Should return all 3 products (or more if others match)

**Verification Logs to Check**:
```
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Women's Dresses|Midi Dresses" with colorShades: ["light"], formalityLevels: ["casual"]
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionary for "Women's Dresses|Mini Dresses" with colorShades: ["light"], formalityLevels: ["casual"]
✓ applyPostSQLFilters: processing products - Should show filters: {colorShades: ["Light"], formalityLevels: ["Casual"]}
✓ applyPostSQLFilters: product_matched_all_filters - Should show products 8084016267449, 7814030885049, 8084018757817 all matched
✓ applyPostSQLFilters: completed - Should show filteredCount >= 3 (all matching products)
```

---

## Test Prompt 4: Blue Cardigans for 12 Year Old (Bonus Test - Age Group Filtering)

**Query**: `"blue cardigans for 12 year old"`

**Expected Constraint Extraction**:
- **Colors**: `["Blue"]`
- **Categories**: `["Tween Sweaters", "Girls Tops"]` (multi-category for age-specific query)
- **Age Groups**: `["Tween"]` (normalized from "12 year old")

**Expected Products in Database**:
- Product ID: `8246752346297` - "Little Girls Ebett Secret Crush Cardigan for Women in Chantilly"
  - Category: "Girls Tops"
  - neckline: "Round"
  - ageGroup: Should match "Tween" or be in "Girls" category

**Expected Behavior**:
1. **Category Filtering (Stage 1)**: Should return products in "Tween Sweaters" and "Girls Tops" categories with ageGroup="Tween"
2. **Dictionary Building (Stage 2)**: Should build dictionaries for each category
3. **Post-Filtering (Stage 3)**: Should filter by blue colors using category-specific dictionaries
4. **Expected Result**: Should return blue cardigans/sweaters for Tween age group

**Verification Logs to Check**:
```
✓ deduplicateProductsByCategoryForPostFiltering: executing query - Should show categories: ["Tween Sweaters", "Girls Tops"], ageGroups: ["Tween"]
✓ buildCategorySpecificDictionaries: built dictionary - Should show dictionaries for "Tween Sweaters|" and "Girls Tops|" with available colors including blue variations
✓ applyPostSQLFilters: processing products - Should show filters: {colors: ["Blue"]}
✓ applyPostSQLFilters: completed - Should show products filtered by blue colors from category-specific dictionaries
```

---

## How to Run Tests

1. **Set Feature Flag**:
   ```bash
   export ENABLE_POST_SQL_FILTERING=true
   # Or add to .env file:
   echo "ENABLE_POST_SQL_FILTERING=true" >> .env
   ```

2. **Start the Application**:
   ```bash
   npm run dev
   ```

3. **Send Test Queries** via API or UI:
   - Use the queries above in the chat interface
   - Monitor terminal logs for detailed logging output

4. **Verify Logs**:
   - Check for `post_sql_filtering` log entries
   - Verify dictionary building shows correct category-specific values
   - Verify post-filtering shows correct matching/failing products
   - Verify final results match expected products

5. **Verify Results**:
   - Check that returned products match all specified filters
   - Check that excluded products are not in results
   - Check that category-specific filtering worked correctly

---

## Expected Log Flow

For each test query, you should see this log sequence:

```
1. fashion_semantic_search: tier1_strict_filtering
   → usePostSQLFiltering: true

2. deduplicateProductsByCategoryForPostFiltering: executing query
   → categories: [...]
   → ageGroups: [...]
   → NOTE: colors, lengths, sleeves, necklines, formalityLevels, colorShades NOT in SQL filters

3. deduplicateProductsByCategoryForPostFiltering: results found
   → count: N (category-filtered product count)

4. buildCategorySpecificDictionaries: loaded products
   → productIdsCount: N
   → loadedProductsCount: M

5. buildCategorySpecificDictionaries: built dictionary
   → For each category/subcategory:
     → key: "Category|Subcategory"
     → productCount: N
     → sampleColors: [...]
     → sampleLengths: [...]
     → sampleSleeves: [...]
     → sampleNecklines: [...]
     → sampleFormalityLevels: [...]
     → sampleColorShades: [...]
     → frequencies: {...}

6. applyPostSQLFilters: processing products
   → productIdsCount: N
   → productsLoaded: M
   → filtersProvided: {...}
   → dictionaryCount: X
   → dictionaryKeys: [...]

7. applyPostSQLFilters: product_matched_all_filters / product_failed_filters
   → For each product (debug level):
     → productId, productTitle, categoryKey
     → filterResults: {...} (shows which filters matched/failed)

8. applyPostSQLFilters: completed
   → originalCount: N
   → filteredCount: M
   → reductionPercentage: "X%"
   → filtersApplied: {...}
   → sampleFilteredIds: [...]

9. fashion_semantic_search: post_sql_filtering_stage1_complete
   → categoryFilteredCount: N

10. fashion_semantic_search: post_sql_filtering_stage2_complete
    → dictionaryCount: X

11. fashion_semantic_search: post_sql_filtering_stage3_complete
    → originalCount: N
    → postFilteredCount: M
    → filtersApplied: {...}

12. fashion_semantic_search: tier1_success
    → resultCount: K
    → usePostSQLFiltering: true
    → productIdsToSearchCount: M
```

---

## Troubleshooting

If results are unexpected:

1. **Check Dictionary Building**: Look for `buildCategorySpecificDictionaries: built dictionary` logs - verify dictionaries contain expected values for each category
2. **Check Filter Matching**: Look for `applyPostSQLFilters: product_failed_filters` logs - verify why products are being excluded
3. **Check Category Filtering**: Look for `deduplicateProductsByCategoryForPostFiltering: results found` - verify category filtering returned expected products
4. **Check Constraint Extraction**: Look for `constraint_context: applied_category_metadata` - verify constraints were extracted correctly
5. **Check Feature Flag**: Verify `ENABLE_POST_SQL_FILTERING=true` is set and `usePostSQLFiltering: true` appears in logs

---

## Success Criteria

✅ **Test 1 (Blue Maxi Dresses with Long Sleeves for Kids)**: 
- Dictionary built for "Girls Dresses" shows sleeves: ["sleeveless"] (not "long")
- Products filtered out if sleeve doesn't match "Long"
- Products filtered out if ageGroup doesn't match "Kids"
- Final results: 0 products (or products that actually match all criteria)

✅ **Test 2 (Semi-Formal Round Neck Tops)**:
- Dictionary built for "Tops|Jackets" shows necklines: ["round"], formalityLevels: ["semi-formal"]
- Products filtered by neckline="Round" AND formalityLevel="Semi-Formal"
- Final results: Product 8271020622009 (and any others matching both criteria)

✅ **Test 3 (Light Colored Casual Dresses)**:
- Dictionary built for "Women's Dresses|Midi Dresses" shows colorShades: ["light"], formalityLevels: ["casual"]
- Products filtered by colorShade="Light" AND formalityLevel="Casual"
- Final results: Products 8084016267449, 7814030885049, 8084018757817 (and any others matching both criteria)

