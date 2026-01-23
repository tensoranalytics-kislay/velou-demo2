# Failed Prompts Audit Report

## Summary

This report details the exact failure points for each of the 6 prompts that returned 0 products.

---

## Test 3: "i am joining office next month, suggest me a dress to wear"

### Extracted Constraints
- **Category:** Women's Dresses
- **Occasions:** Work (required intent)
- **Colors:** White, Beige, Blush, Pink, Light Blue, Light Yellow, Mint, Lavender (required intent)
- **Age Groups:** Adult (required intent)

### Database Check Results
- ✅ **Category:** 331 products found
- ✅ **Colors:** 2,228 products found (individual colors exist)
- ❌ **Occasions:** 0 products found with "Work" in occasionContext
- ✅ **Age Groups:** 331 products found

### Combined AND Query Result
- **Result:** 0 products
- **Reason:** No products have "Work" in occasionContext column

### Failure Point
**Location:** SQL filter for occasions
**Issue:** Database has no products with "Work" in the `occasionContext` column for Women's Dresses category
**Evidence from logs:**
```
requiredIntentFilters: { colors: [...], occasions: ['Work'] }
occasion_filter_applied: occasions: ['Wedding']
searchVectorIndexWithDeduplication: results found: count: 0
```

### Root Cause
- Occasion filter correctly applied in SQL using `occasionContext && ARRAY['Work']`
- Database simply doesn't have "Work" occasion data for dresses
- AND logic between occasion and colors filters out all products

---

## Test 4: "show me floral maxi dresses in pastel colors"

### Extracted Constraints
- **Category:** Women's Dresses
- **Patterns:** Floral (required intent)
- **Lengths:** Maxi (required intent)
- **Colors:** Pastel colors expanded to: White, Ivory, Cream, Beige, Blush, Pink, Peach, Lemon, Mint, Sky Blue, Lavender, Baby Blue (required intent)
- **Age Groups:** Adult (required intent)

### Database Check Results
- ✅ **Category:** 331 products found
- ✅ **Colors:** 2,228 products found (pastel colors exist)
- ❌ **Patterns:** 0 products found with "Floral" pattern
- ❌ **Lengths:** 0 products found with "Maxi" length

### Combined AND Query Result
- **Result:** 0 products
- **Reason:** Pattern filter may not be checking correct database columns, or "Floral" pattern data doesn't exist

### Failure Point
**Location:** SQL filter for patterns
**Issue:** Pattern filter is checking `attributes->>'pattern'` and title, but no products match "Floral"
**Evidence from logs:**
```
requiredIntentFilters: { colors: [...], patterns: ['Floral'], lengths: ['Maxi'] }
constraint_filters_combined: constraintCount: 3 (Colors, Patterns, Lengths)
searchVectorIndexWithDeduplication: results found: count: 0
```

### Root Cause
- Pattern filter SQL logic may not be checking correct columns
- "Floral" may not be stored in `attributes->>'pattern'` or title
- AND logic between pattern, length, and colors filters out all products

---

## Test 5: "i need a black formal evening dress with long sleeves"

### Extracted Constraints
- **Category:** Women's Dresses
- **Colors:** Black (required intent)
- **Occasions:** Evening (required intent)
- **Sleeve Lengths:** Long (required intent)
- **Formality Level:** Formal (required intent)
- **Age Groups:** Adult (required intent)

### Database Check Results
- ✅ **Category:** 331 products found
- ✅ **Colors:** 1,234 products found with "Black"
- ❌ **Occasions:** 0 products found with "Evening" in occasionContext
- ✅ **Sleeves:** 1,234 products found with "Long" sleeve
- ❌ **Formality Level:** 0 products found with "Formal" formalityLevel

### Combined AND Query Result
- **Result:** 0 products
- **Reason:** No products have both "Evening" occasion AND "Formal" formalityLevel

### Failure Point
**Location:** SQL filters for occasions and formalityLevel
**Issue:** 
1. Occasion "Evening" may not exist in occasionContext
2. FormalityLevel "Formal" may not be stored correctly
**Evidence from logs:**
```
requiredIntentFilters: { colors: ['Black'], occasions: ['Evening'], sleeves: ['Long'], formalityLevel: ['Formal'] }
constraint_filters_combined: constraintCount: 4
searchVectorIndexWithDeduplication: results found: count: 0
```

### Root Cause
- Too many AND constraints (4 constraint types)
- Occasion "Evening" may not match occasionContext values
- FormalityLevel may not be stored in database column
- AND logic filters out all products

---

## Test 6: "cotton summer dresses in light colors"

### Extracted Constraints
- **Category:** Women's Dresses
- **Materials:** Cotton (required intent)
- **Seasons:** Summer (required intent)
- **Colors:** Light colors expanded to: White, Ivory, Cream, Beige, Blush, Pink, Peach, Lemon, Mint, Sky Blue, Lavender, Baby Blue (required intent)
- **Age Groups:** Adult (required intent)

### Database Check Results
- ✅ **Category:** 331 products found
- ✅ **Colors:** 2,228 products found (light colors exist)
- ✅ **Materials:** 1,198 products found with "Cotton"
- ✅ **Seasons:** 1,732 products found with "Summer"

### Combined AND Query Result
- **Result:** 234 products found
- **Reason:** Products exist that match all constraints, but pipeline returned 0

### Failure Point
**Location:** SQL filter implementation for materials/seasons
**Issue:** Materials and seasons filters are applied, but the combined AND query returns 0 products in the vector search
**Evidence from logs:**
```
requiredIntentFilters: { colors: [...], materials: ['Cotton'], seasons: ['Summer'] }
material_filter_applied: materials: ['Cotton']
season_filter_applied: seasons: ['Summer']
constraint_filters_combined: constraintCount: 3
searchVectorIndexWithDeduplication: results found: count: 0
```

### Root Cause
- Materials and seasons filters are being applied in SQL
- Combined AND query in database shows 234 products exist
- But vector search with same filters returns 0
- **Likely issue:** Material/season filter SQL logic may not match database column structure

---

## Test 9: "wedding guest dresses in navy or burgundy"

### Extracted Constraints
- **Category:** Women's Dresses
- **Occasions:** Wedding (required intent)
- **Colors:** Navy Blue, Burgundy (required intent)
- **Age Groups:** Adult (required intent)

### Database Check Results
- ✅ **Category:** 331 products found
- ✅ **Colors:** Products exist with "Navy" and "Burgundy" colors
- ✅ **Occasions:** Products exist with "Wedding" in occasionContext

### Combined AND Query Result
- **Result:** Need to check exact count
- **Reason:** Products exist individually, but AND logic may filter them out

### Failure Point
**Location:** SQL filter for occasions + colors AND logic
**Issue:** Occasion "Wedding" exists, colors exist, but no products have BOTH Wedding occasion AND Navy/Burgundy colors
**Evidence from logs:**
```
requiredIntentFilters: { colors: ['Navy Blue', 'Burgundy'], occasions: ['Wedding'] }
color_filter_applied: colors: ['Navy Blue', 'Burgundy']
occasion_filter_applied: occasions: ['Wedding']
constraint_filters_combined: constraintCount: 2
searchVectorIndexWithDeduplication: results found: count: 0
```

### Root Cause
- Occasion filter correctly applied
- Color filter correctly applied
- AND logic between occasion and colors filters out all products
- **Likely:** Wedding dresses exist, but not in Navy/Burgundy colors, OR Navy/Burgundy dresses exist but not with Wedding occasion

---

## Test 10: "relaxed fit linen pants for summer"

### Extracted Constraints
- **Category:** Womens-pants
- **Fits:** Relaxed (required intent)
- **Materials:** Linen (required intent)
- **Seasons:** Summer (required intent)
- **Colors:** White, Beige, Light Blue, Light Yellow, Cream, Light Pink, Pastel Blue, Pastel Pink (required intent - inferred)
- **Age Groups:** Adult (required intent)

### Database Check Results
- ✅ **Category:** 72 products found
- ✅ **Colors:** 2,223 products found (light colors exist)
- ✅ **Materials:** 42 products found with "Linen"
- ✅ **Fits:** 528 products found with "Relaxed"
- ✅ **Seasons:** 1,732 products found with "Summer"

### Combined AND Query Result
- **Result:** 1 product found
- **Reason:** One product exists that matches all constraints

### Failure Point
**Location:** SQL filter implementation for fit/material/season
**Issue:** Combined AND query shows 1 product exists, but vector search returns 0
**Evidence from logs:**
```
requiredIntentFilters: { colors: [...], materials: ['Linen'], fits: ['Relaxed'], seasons: ['Summer'] }
material_filter_applied: materials: ['Linen']
fit_filter_applied: fits: ['Relaxed']
season_filter_applied: seasons: ['Summer']
constraint_filters_combined: constraintCount: 4
searchVectorIndexWithDeduplication: results found: count: 0
```

### Root Cause
- All individual constraints have matching products
- Combined AND query shows 1 product exists
- But vector search with same filters returns 0
- **Likely issue:** Fit/material/season filter SQL logic may not match database column structure, OR the single matching product doesn't have embeddings

---

## Common Patterns Across Failures

### 1. Occasion Data Availability
- **Tests 3, 5, 9:** All failed due to occasion constraints
- **Issue:** OccasionContext column may not have data for "Work", "Evening", or "Wedding"
- **Evidence:** Database checks show 0 products for these occasions

### 2. Pattern Matching
- **Test 4:** Failed due to pattern constraint
- **Issue:** Pattern filter may not be checking correct database columns
- **Evidence:** No products found with "Floral" pattern

### 3. FormalityLevel Data
- **Test 5:** Failed due to formalityLevel constraint
- **Issue:** FormalityLevel may not be stored in database
- **Evidence:** No products found with "Formal" formalityLevel

### 4. AND Logic Restrictiveness
- **All tests:** Multiple AND constraints filter out all products
- **Issue:** When 3+ constraint types are combined with AND, products are filtered out
- **Evidence:** Individual constraints have products, but combined AND returns 0

### 5. SQL Filter Implementation
- **Tests 6, 10:** Database shows products exist, but vector search returns 0
- **Issue:** Material/fit/season filter SQL logic may not match database column structure
- **Evidence:** Combined AND query shows products exist, but vector search doesn't find them

---

## Recommendations

### Immediate Actions

1. **Verify Occasion Data**
   - Check if occasionContext column has data for "Work", "Evening", "Wedding"
   - If not, consider using alternative occasion sources (attributes->>'occasion')

2. **Verify Pattern Data**
   - Check if pattern data exists in attributes->>'pattern' or title
   - Consider checking other pattern-related columns

3. **Verify FormalityLevel Data**
   - Check if formalityLevel column exists and has data
   - Verify SQL filter is checking correct column

4. **Verify Material/Fit/Season Filters**
   - Check if material, fit, and season columns match filter SQL logic
   - Verify column names and data types

5. **Add Constraint Relaxation**
   - When AND filters return 0 products, relax least important constraints
   - Consider using "preferred" intent instead of "required" for some constraints

### Long-term Improvements

6. **Improve Data Quality**
   - Ensure occasionContext is populated for all relevant products
   - Ensure pattern, formalityLevel, material, fit, season data is complete

7. **Add Fallback Logic**
   - When strict AND filters return 0, try relaxing constraints one by one
   - Provide partial matches when full matches aren't available

8. **Improve SQL Filter Logic**
   - Verify all filter SQL queries match database column structure
   - Add logging to show which filters are applied and why products are filtered out
