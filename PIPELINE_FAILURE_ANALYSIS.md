# Pipeline Failure Analysis

## Test Results Summary

### TEST 1: "I am joining office next month, suggest me a dress to wear"
**Status: ❌ FAILED (0 products returned)**

**Pipeline Stages:**
1. ✅ **Pre-deduplication**: 103 products found
2. ✅ **Vector Search**: Products passed through
3. ✅ **Semantic Search**: Tier 1 success
4. ❌ **Ranking**: All products scored 0
5. ❌ **Filtering**: All products filtered out (score < 0.25 threshold)

**Root Cause:**
- Products are matching the OR filter (103 products found in pre-deduplication)
- However, all products score 0 in ranking
- Products are filtered out because score (0) < threshold (0.25)

**Issue:**
- Colors: Products don't match query colors (White, Beige, Navy, Black, Gray) - scoring 0
- FormalityLevel: Products may not have "Semi-Formal" data - scoring 0
- Occasions: Products may not have "Work" occasion - scoring 0
- With OR logic, products should show up if they match ANY constraint, but ranking is giving 0 for all constraints

### TEST 2: "show me dresses"
**Status: ✅ SUCCESS (4 products returned)**

**Pipeline Stages:**
1. ✅ **Pre-deduplication**: 331 products found
2. ✅ **Vector Search**: Products passed through
3. ✅ **Semantic Search**: Tier 1 success
4. ✅ **Ranking**: Top score = 1, Avg score = 0.826
5. ✅ **Filtering**: 4 products passed threshold

**Why it works:**
- No strict constraints (no colors, occasions, formalityLevel)
- Products score well on category match and vector similarity
- Scores are above threshold (0.25)

### TEST 3: "do you have any tops in pastel shades"
**Status: ✅ SUCCESS (4 products returned)**

**Pipeline Stages:**
1. ✅ **Pre-deduplication**: 7 products found
2. ✅ **Vector Search**: Products passed through
3. ✅ **Semantic Search**: Tier 1 success
4. ✅ **Ranking**: Top score = 1, Avg score = 1.0
5. ✅ **Filtering**: 4 products passed threshold

**Why it works:**
- Colors are "required" intent, but products match the colors (Pastel Pink, Pastel Blue)
- Products score perfectly (1.0) because they match the color constraint
- Scores are well above threshold (0.25)

## Exact Failure Point for TEST 1

### Stage 1: Pre-Deduplication ✅
- **Status**: PASSED
- **Products Found**: 103
- **Filter Applied**: OR logic for constraints (occasions OR formalityLevel)
- **Result**: Products matching either "Work" occasion OR "Semi-Formal" formalityLevel are included

### Stage 2: Vector Search ✅
- **Status**: PASSED
- **Products**: 103 products passed through
- **Result**: Products are ready for ranking

### Stage 3: Semantic Search ✅
- **Status**: PASSED
- **Tier 1**: Success
- **Result**: Products are ready for ranking

### Stage 4: Ranking ❌ **FAILURE POINT**
- **Status**: FAILED
- **Top Score**: 0
- **Avg Score**: 0
- **Score Range**: 0.000 - 0.000
- **Issue**: All products score 0 because:
  1. **Colors**: Products don't match query colors (Green vs White/Beige/Navy/Black/Gray)
     - Color intent is "strong"
     - Products have color data that doesn't match
     - Current fix gives neutral score (0.5) for non-matching colors with "strong" intent
     - **BUT**: This may not be enough if other constraints also score 0
  2. **FormalityLevel**: Products may not have "Semi-Formal" data
     - FormalityLevel intent is "strong"
     - Neutral score (0.5) should apply for missing data
     - **BUT**: If products have formalityLevel data that doesn't match, they score 0
  3. **Occasions**: Products may not have "Work" occasion
     - Occasion intent is "required" (from previous fix)
     - Products without "Work" occasion score 0
     - **BUT**: With OR logic, products should show up if they match formalityLevel even without Work occasion

### Stage 5: Filtering ❌ **FAILURE POINT**
- **Status**: FAILED
- **Before Filter**: Some products (need to check exact count)
- **After Filter**: 0 products
- **Threshold**: 0.25
- **Issue**: All products scored 0, which is below threshold (0.25)
- **Result**: All products filtered out

## Root Cause Analysis

### Problem 1: Ranking Scores Are All Zero
Even though we implemented:
1. OR logic for constraint filters (products match if they satisfy ANY constraint)
2. Neutral score (0.5) for missing/non-matching data with "strong" intent

**Why products still score 0:**
1. **Color Scoring**: 
   - Products have colors (Green) that don't match query colors (White/Beige/Navy/Black/Gray)
   - With "strong" intent, we give neutral score (0.5) for non-matching colors
   - **BUT**: This may be weighted down by other constraints scoring 0
   
2. **FormalityLevel Scoring**:
   - Products may not have "Semi-Formal" formalityLevel data
   - With "strong" intent, we give neutral score (0.5) for missing data
   - **BUT**: If products have formalityLevel data that doesn't match, they score 0
   
3. **Occasion Scoring**:
   - Products may not have "Work" occasion
   - With "required" intent, products without "Work" score 0
   - **BUT**: With OR logic, products should show up if they match formalityLevel even without Work occasion

### Problem 2: Weighted Score Calculation
Even if individual constraints get neutral scores (0.5), the weighted final score may still be 0 if:
- Constraint weights are low
- Other constraints score 0
- Final weighted average is below threshold

### Problem 3: OR Logic Not Fully Implemented in Ranking
- **SQL Filtering**: OR logic is implemented (products match if they satisfy ANY constraint)
- **Ranking**: OR logic is NOT fully implemented (products still need to score well on ALL constraints to pass threshold)

## Recommendations

### Fix 1: Ensure Neutral Scores Are Applied Correctly
- Verify that neutral scores (0.5) are being applied for:
  - Colors with "strong" intent when they don't match
  - FormalityLevel with "strong" intent when data is missing or doesn't match
  - Other constraints with "strong"/"preferred" intent

### Fix 2: Adjust Ranking Logic for OR Constraints
- When constraints are OR'd together, products should get credit for matching ANY constraint
- Products matching multiple constraints should rank higher
- Products matching one constraint should still score above threshold

### Fix 3: Lower Threshold or Adjust Scoring
- Consider lowering the relevance threshold (0.25) for OR-filtered queries
- Or adjust scoring to ensure products matching at least one constraint score above threshold

### Fix 4: Verify Constraint Intent Extraction
- Ensure formalityLevel is extracted with "strong" intent (not "required")
- Ensure occasions are extracted with correct intent
- Ensure colors are extracted with "strong" intent (not "required") when inferred
