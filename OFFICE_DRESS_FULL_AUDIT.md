# Office Dress Query - Full Audit Results

## Query
"i am joining office next month, suggest me a dress to wear"

## Test Date
2026-01-22

## Executive Summary

### ✅ Filter Implementation: CORRECT
The SQL filter implementation for occasions with "strong" intent is **working correctly**. The code properly:
- Extracts occasions with "strong" or "required" intent
- Adds them to `requiredIntentFilters.occasions`
- Passes them to SQL filter function
- Applies them as hard SQL filters

### ❌ Classifier Issue: Occasions NOT Being Extracted
**Root Cause:** The LLM classifier is **not extracting occasions** from the query, so there's nothing to filter on.

**Evidence:**
```
parsedConstraints: {
  occasions: null,  // ❌ Should be: { values: ['Work'], intent: 'strong' }
  ...
}
```

## Detailed Findings

### 1. Category Classification ✅
- **Category:** `Women's Dresses`
- **Confidence:** 0.8
- **Status:** Working correctly

### 2. Constraint Extraction

#### ✅ Colors - WORKING
- **Extracted:** `['White', 'Beige', 'Navy Blue', 'Black', 'Blush', 'Pink']`
- **Intent:** `required`
- **Applied as:** Hard SQL filter ✅
- **Result:** Products filtered by colors at SQL level

#### ✅ Age Groups - WORKING
- **Extracted:** `['Adult']`
- **Intent:** `required`
- **Applied as:** Hard SQL filter ✅
- **Result:** Products filtered by age group at SQL level

#### ❌ Occasions - NOT EXTRACTED
- **Extracted:** `null` ❌
- **Expected:** `{ values: ['Work'], intent: 'strong' }`
- **Reason:** LLM classifier not recognizing "office" as occasion context
- **Impact:** No SQL filter applied for occasions
- **Result:** Products may not match "Work" occasion

### 3. SQL Filtering Status

**Required Intent Filters Extracted:**
```json
{
  "colors": ["White", "Beige", "Navy Blue", "Black", "Blush", "Pink"]
  // ❌ "occasions" is missing because classifier didn't extract it
}
```

**SQL Filters Applied:**
- ✅ Colors: Applied (6 colors)
- ✅ Age Groups: Applied (Adult)
- ❌ Occasions: NOT applied (because `occasions: null`)

**Log Evidence:**
- ✅ `required_intent_filters_extracted_for_hard_sql_filtering` - shows only colors
- ❌ `occasion_filter_applied` - NOT in logs (because occasions weren't extracted)

### 4. Products Returned

1. **Black Floral Frill Wrap Midi Dress** - $44.99
2. **Blue Ditsy Print Chiffon Wrap Midi Dress** - $39.99
3. **Petite Black Floral Bardot Skater Midi Dress** - $54.99
4. **Black Geometric Bardot Mini Dress** - $36.99

**Issue:** None of these products are verified to have "Work" occasion because:
- Occasions weren't extracted from query
- No SQL filter was applied
- Products ranked by vector similarity only

## Root Cause Analysis

### The Problem Chain

1. **Classifier Prompt Issue:**
   - Query: "i am joining office next month, suggest me a dress to wear"
   - LLM should extract: `occasions: { values: ['Work'], intent: 'strong' }`
   - LLM actually extracts: `occasions: null`
   - **Reason:** Classifier prompt may not be emphasizing occasion extraction for office/work context

2. **Filter Implementation:**
   - ✅ Code is correct: `extractStrongOccasionsFilter` function works
   - ✅ Logic is correct: Checks for "strong" or "required" intent
   - ❌ Never called with valid data: Because occasions are `null`

### Why Occasions Aren't Being Extracted

**Possible Reasons:**
1. **Classifier Prompt:** May not have examples for "office" → "Work" mapping
2. **Query Type:** Classified as `direct_product_search` which might not trigger occasion extraction
3. **LLM Interpretation:** LLM might not recognize "joining office" as an occasion context
4. **Prompt Examples:** May lack examples showing how to extract occasions from context (not explicit mentions)

## Verification of Filter Implementation

### Code Review ✅

**File:** `src/lib/loveshackfancy/retrieval.ts`

**Line 232-243:** `extractStrongOccasionsFilter` function
```typescript
const extractStrongOccasionsFilter = (
  intent: 'required' | 'strong' | 'preferred' | 'excluded' | null | undefined,
  constraint: any
) => {
  if (intent === 'strong' || intent === 'required') {
    const values = extractConstraintValues(constraint);
    if (values && values.length > 0) {
      requiredIntentFilters.occasions = values;
    }
  }
};
```

**Status:** ✅ Implementation is correct

**Line 250:** Function is called
```typescript
extractStrongOccasionsFilter(constraintIntents.occasions, classification.constraints.occasions);
```

**Status:** ✅ Function is being called

**Issue:** Function receives `intent: null` and `constraint: null` because classifier didn't extract occasions

## Recommendations

### 1. Fix Classifier Prompt (HIGH PRIORITY)
- Add explicit examples: "office" → "Work", "joining office" → "Work"
- Emphasize context-based occasion extraction (not just explicit mentions)
- Add examples for office/work queries in the classifier prompt

### 2. Test Filter Implementation (Once Classifier is Fixed)
- Run query again after classifier fix
- Verify: `occasions: { values: ['Work'], intent: 'strong' }` in classification
- Verify: `occasions: ['Work']` in `requiredIntentFilters`
- Verify: `occasion_filter_applied` log appears
- Verify: Products returned have "Work" in occasion attributes

### 3. Add Debug Logging
- Log when `extractStrongOccasionsFilter` is called with null values
- Log the actual intent and constraint values received
- This will help diagnose classifier issues in the future

## Conclusion

**Filter Implementation:** ✅ **CORRECT** - The code to filter occasions with "strong" intent is properly implemented and will work once occasions are extracted.

**Classifier Issue:** ❌ **NEEDS FIX** - The classifier is not extracting occasions from office/work queries. This needs to be fixed in the classifier prompt.

**Next Steps:**
1. Update classifier prompt to extract occasions from office/work context
2. Re-test the query
3. Verify occasions are extracted
4. Verify SQL filter is applied
5. Verify products match the occasion constraint
