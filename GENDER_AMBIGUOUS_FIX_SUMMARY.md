# Gender-Ambiguous Query Fix Summary

## Issue
The query "do you have any tops in pastel shades" (without "for women") was triggering clarification instead of returning products because:
1. Category classifier returned 0 categories (confidence 0.4 < 0.5 threshold)
2. LLM was not confident matching "top" to "Tops" category when gender was ambiguous

## Root Cause
- When gender is ambiguous, the system was using "strict majority mode" which filtered to only categories with ≥95% male or female
- "Tops" category exists in database (535 products) but was being filtered out
- Even after fixing to include all categories when product type is mentioned, the LLM was still returning low confidence (0.4)

## Fixes Applied

### 1. Product Type Detection for Gender-Agnostic Categories
**File**: `src/lib/loveshackfancy/classifier.ts`
- Added `hasExplicitProductType` parameter to `buildAllowedCategoriesForClassifier`
- When product type is explicitly mentioned (e.g., "tops", "dresses"), include ALL categories (male, female, unisex) even when gender is ambiguous
- This allows matching "top" to "Tops" category regardless of gender context

### 2. Product Type Detection in Orchestrator
**File**: `src/lib/loveshackfancy/orchestrator.ts`
- Added product type keyword detection before category classification
- Detects explicit product types: top, tops, dress, dresses, jeans, pants, etc.
- Passes `hasExplicitProductType` flag to category classifier

### 3. Product Type Detection in Category Classifier
**File**: `src/lib/loveshackfancy/category-classifier.ts`
- Added product type detection before building allowed categories
- Ensures all categories are included when product type is mentioned

### 4. Improved Category Classifier Prompt
**File**: `src/lib/loveshackfancy/category-classifier.ts`
- Added explicit instructions that "top" or "tops" MUST map to "Tops" category
- Added examples: "blue top" → ["Tops"], "do you have any tops" → ["Tops"]
- Emphasized that when product type is explicitly mentioned, return confidence >= 0.5 even if gender is ambiguous

### 5. Product Type Detection in Constraint Classifier
**File**: `src/lib/loveshackfancy/classifier.ts`
- Added product type detection in `classifyQueryWithMetadata`
- Ensures constraint classifier also uses gender-agnostic categories when product type is mentioned

## Test Results

### Query: "do you have any tops in pastel shades" (gender-ambiguous)
✅ **SUCCESS**
- Products Returned: 4
- Category: Correctly identified as "Tops"
- Colors: Correctly extracted as "Pastel Blue, Pastel Pink"
- Pastel Accuracy: 100% (4/4 products are pastel-colored)

### Query: "do you have any tops in pastel shades for women" (gender-specified)
✅ **SUCCESS** (was already working)
- Products Returned: 4
- Category: Correctly identified as "Tops"
- Colors: Correctly extracted as "Pastel Pink, Pastel Blue"
- Pastel Accuracy: 100% (4/4 products are pastel-colored)

## Key Changes

1. **Gender-Agnostic Category Matching**: When a product type is explicitly mentioned, the system now includes all categories (male, female, unisex) for matching, allowing "top" to match "Tops" regardless of gender context.

2. **Improved LLM Confidence**: Updated prompt to explicitly instruct the LLM to return confidence >= 0.5 when product types are mentioned, even if gender is ambiguous.

3. **Consistent Product Type Detection**: Product type detection is now applied consistently across:
   - Orchestrator (before category classification)
   - Category classifier (before building allowed categories)
   - Constraint classifier (before building allowed categories)

## Files Modified

1. `src/lib/loveshackfancy/classifier.ts` - Added `hasExplicitProductType` parameter and product type detection
2. `src/lib/loveshackfancy/orchestrator.ts` - Added product type detection before category classification
3. `src/lib/loveshackfancy/category-classifier.ts` - Added product type detection and improved prompt
4. `src/lib/loveshackfancy/classifier.ts` - Added product type detection in constraint classifier

## Status
✅ **FIXED** - Gender-ambiguous queries with explicit product types now work correctly.
