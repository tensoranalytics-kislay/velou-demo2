# Synonym vs Inferred Interpretation Audit Report

## Test Date
January 21, 2026

## Test Overview
This audit tests whether the LLM correctly distinguishes between:
1. **Direct Interpretation (Synonyms)** → Should be `'required'` intent
2. **Inferred Interpretation (Context-based)** → Should be `'strong'` or `'preferred'` intent

## Test Results Summary

### Synonym Tests (Direct Interpretation → "required" intent)

| Test | Query | Expected | Actual LLM Extraction | Intent | Status |
|------|-------|----------|----------------------|--------|--------|
| 1 | "I want a cap sleeve dress for summer" | `sleeveLengths: ["Cap Sleeve"]` | `sleeveLengths: { values: ['Cap Sleeve'], intent: 'required' }` | ✅ `required` | **PASS** |
| 2 | "show me empire waist dresses" | `styles: ["Empire Waist"]` | `styles: ['Empire']` | ❌ Array (no intent) | **FAIL** |
| 3 | "I need a scoop neck blouse" | `necklines: ["Scoop"]` | `necklines: ['Scoop']` | ❌ Array (no intent) | **FAIL** |
| 4 | "looking for fit and flare style dresses" | `styles: ["Fit and Flare"]` | `styles: ['Fit and Flare']` | ❌ Array (no intent) | **FAIL** |

### Inferred Tests (Inferred Interpretation → "strong"/"preferred" intent)

| Test | Query | Expected | Actual LLM Extraction | Intent | Status |
|------|-------|----------|----------------------|--------|--------|
| 1 | "I need something cozy and warm for cold weather" | `materials`, `sleeveLengths`, `colors` | Colors extracted with `'strong'` | ⚠️ Partial | **PARTIAL** |
| 2 | "what would work for a first date?" | `occasions`, `styles`, `formalityLevel` | Colors, sleeveLengths, embellishments, necklines extracted | ⚠️ Partial | **PARTIAL** |
| 3 | "I'm going to a business meeting, need something professional" | `formalityLevel`, `styles`, `occasions` | Colors, occasions, formalityLevel extracted | ⚠️ Partial | **PARTIAL** |
| 4 | "something that won't wrinkle when I travel" | `materials`, `travelFeatures` | Colors, occasions, materials, seasons, travelFeatures extracted | ⚠️ Partial | **PARTIAL** |

## Key Findings

### ✅ What's Working

1. **"cap sleeve" synonym extraction**: Correctly extracted as `sleeveLengths: { values: ['Cap Sleeve'], intent: 'required' }` ✅
   - The LLM correctly recognized "cap sleeve" as a direct synonym for "Cap Sleeve"
   - Intent was correctly set to `'required'`

2. **Inferred constraints**: Some inferred constraints are being extracted with `'strong'` intent (e.g., colors for "cozy and warm for cold weather")

### ❌ Issues Identified

#### Issue 1: Inconsistent Intent Format for Styles and Necklines

**Problem**: For queries like "empire waist dresses", "scoop neck blouse", and "fit and flare style dresses", the LLM is extracting constraints as **arrays** instead of **intent format**.

**Examples**:
- ❌ `styles: ['Empire']` (should be `styles: { values: ['Empire Waist'], intent: 'required' }`)
- ❌ `necklines: ['Scoop']` (should be `necklines: { values: ['Scoop'], intent: 'required' }`)
- ❌ `styles: ['Fit and Flare']` (should be `styles: { values: ['Fit and Flare'], intent: 'required' }`)

**Root Cause**: The LLM prompt may not be emphasizing strongly enough that ALL directly interpretable constraints (including synonyms) must use the intent format.

**Impact**: 
- These constraints are not being applied as hard SQL filters (since they're missing intent)
- They're only used for ranking, which may lead to less accurate results

#### Issue 2: Clarification Loops for Inferred Queries

**Problem**: Queries like "what would work for a first date?" and "I'm going to a business meeting" are triggering clarification loops because:
- No categories are classified (category classifier returns 0 categories)
- The system requires categories before proceeding to retrieval

**Root Cause**: The category classifier is too strict for vague/indirect queries, even when constraints are extracted.

**Impact**:
- Users get clarification questions instead of products
- Constraints are extracted but never used for retrieval

#### Issue 3: Missing Constraint Extraction for Some Inferred Queries

**Problem**: Some inferred constraints are not being extracted:
- "cozy and warm for cold weather" → `materials` and `sleeveLengths` not extracted (only colors)
- "first date" → `occasions` not extracted (though other constraints are)

**Root Cause**: The LLM may not be inferring all relevant constraints from context, or the prompt needs better examples for these edge cases.

## Detailed Log Analysis

### Test 1: "I want a cap sleeve dress for summer" ✅

**LLM Extraction**:
```json
{
  "sleeveLengths": { "values": ["Cap Sleeve"], "intent": "required" },
  "seasons": { "values": ["Summer"], "intent": "required" },
  "colors": { "values": ["White", "Yellow", "Coral", "Sky Blue", "Mint", "Lemon"], "intent": "required" }
}
```

**Analysis**: ✅ **CORRECT**
- "cap sleeve" correctly recognized as synonym for "Cap Sleeve"
- Intent correctly set to `'required'` (direct interpretation)
- However, query triggered clarification (no categories), so constraints weren't used

### Test 2: "show me empire waist dresses" ❌

**LLM Extraction**:
```json
{
  "styles": ["Empire"]
}
```

**Analysis**: ❌ **INCORRECT**
- Extracted as array instead of intent format
- Should be: `styles: { values: ["Empire Waist"], intent: "required" }`
- Value mismatch: "Empire" vs "Empire Waist" (dictionary value)

### Test 3: "I need a scoop neck blouse" ❌

**LLM Extraction**:
```json
{
  "necklines": ["Scoop"]
}
```

**Analysis**: ❌ **INCORRECT**
- Extracted as array instead of intent format
- Should be: `necklines: { values: ["Scoop"], intent: "required" }`
- Value is correct, but missing intent format

### Test 4: "looking for fit and flare style dresses" ❌

**LLM Extraction**:
```json
{
  "styles": ["Fit and Flare"]
}
```

**Analysis**: ❌ **INCORRECT**
- Extracted as array instead of intent format
- Should be: `styles: { values: ["Fit and Flare"], intent: "required" }`
- Value is correct, but missing intent format

### Test 5: "I need something cozy and warm for cold weather" ⚠️

**LLM Extraction**:
```json
{
  "colors": { "values": ["Navy", "Burgundy", "Black", "Charcoal", "Brown", "Gold"], "intent": "strong" },
  "materials": null,
  "sleeveLengths": null
}
```

**Analysis**: ⚠️ **PARTIAL**
- Colors correctly inferred with `'strong'` intent ✅
- Materials NOT extracted (should infer Wool/Cashmere)
- SleeveLengths NOT extracted (should infer Long Sleeve)
- Query triggered clarification (no categories)

### Test 6: "what would work for a first date?" ⚠️

**LLM Extraction**:
```json
{
  "colors": { "values": ["Black", "Navy", "Burgundy", "Plum", "Charcoal", "Gold", "Ivory", "Blush", "Pink", "Lavender", "Mint", "Peach", "Baby Blue", "Lemon", "Coral"], "intent": "strong" },
  "sleeveLengths": ["Long Sleeve", "Three-Quarter Sleeve"],
  "embellishments": ["Lace", "Embroidery", "Beading", "Sequins", "Pearls"],
  "necklines": ["V-Neck", "Round", "High Neck", "High"],
  "occasions": null
}
```

**Analysis**: ⚠️ **PARTIAL**
- Many constraints correctly inferred with `'strong'` intent ✅
- BUT `occasions` NOT extracted (should be "Date Night")
- Query triggered clarification (no categories)

### Test 7: "I'm going to a business meeting, need something professional" ⚠️

**LLM Extraction**:
```json
{
  "colors": { "values": ["White", "Navy", "Gray", "Beige", "Black", "Blush"], "intent": "strong" },
  "occasions": { "values": ["Office"], "intent": "required" },
  "formalityLevel": { "values": ["Professional"], "intent": "strong" },
  "styles": null
}
```

**Analysis**: ⚠️ **PARTIAL**
- `occasions` correctly extracted with `'required'` (explicitly mentioned "business meeting") ✅
- `formalityLevel` correctly inferred with `'strong'` intent ✅
- `styles` NOT extracted (should infer "Classic" or "Professional")
- Query triggered clarification (no categories)

### Test 8: "something that won't wrinkle when I travel" ⚠️

**LLM Extraction**:
```json
{
  "colors": { "values": ["White", "Yellow", "Coral", "Sky Blue", "Mint", "Lemon"], "intent": "required" },
  "occasions": { "values": ["Travel"], "intent": "required" },
  "materials": { "values": ["Polyester", "Nylon", "Modal"], "intent": "preferred" },
  "seasons": { "values": ["Summer"], "intent": "required" },
  "travelFeatures": null
}
```

**Analysis**: ⚠️ **PARTIAL**
- `materials` correctly inferred with `'preferred'` intent ✅
- `occasions` correctly extracted with `'required'` (explicitly mentioned "travel") ✅
- BUT `travelFeatures` NOT extracted (should be "Wrinkle-Free" or similar)
- Colors incorrectly marked as `'required'` (should be `'strong'` - inferred from travel context)
- Query triggered clarification (no categories)

## Recommendations

### 1. Fix Intent Format for Styles and Necklines

**Action**: Update the prompt to emphasize that ALL directly interpretable constraints (including synonyms) MUST use intent format, not arrays.

**Specific Changes**:
- Add explicit examples showing `styles` and `necklines` with intent format
- Emphasize that synonyms like "empire waist", "scoop neck", "fit and flare" are direct interpretations → `'required'` intent

### 2. Improve Synonym Normalization

**Action**: Ensure the LLM maps synonyms to exact dictionary values:
- "empire waist" → "Empire Waist" (not "Empire")
- "cap sleeve" → "Cap Sleeve" ✅ (already working)
- "scoop neck" → "Scoop" ✅ (value correct, but needs intent format)

### 3. Fix Clarification Loops

**Action**: Allow retrieval to proceed even when category classifier returns 0 categories, if constraints are extracted:
- If constraints are extracted (e.g., `occasions`, `styles`, `formalityLevel`), proceed with retrieval
- Only trigger clarification if NO constraints AND no categories

### 4. Improve Inferred Constraint Extraction

**Action**: Add more examples to the prompt for common inferred scenarios:
- "cozy and warm" → materials (Wool/Cashmere), sleeveLengths (Long Sleeve)
- "first date" → occasions (Date Night), styles (Romantic/Elegant)
- "won't wrinkle" → travelFeatures (Wrinkle-Free), materials (synthetic blends)

### 5. Fix Intent Assignment for Inferred Colors

**Action**: Ensure colors inferred from context (not explicitly mentioned) use `'strong'` intent, not `'required'`:
- "something that won't wrinkle when I travel" → colors should be `'strong'` (inferred from travel context), not `'required'`

## Conclusion

The prompt updates for synonym normalization are **partially working**:
- ✅ "cap sleeve" correctly extracted with `'required'` intent
- ❌ "empire waist", "scoop neck", "fit and flare" extracted as arrays (missing intent format)
- ⚠️ Inferred constraints are being extracted but with mixed intent assignments

The main issues are:
1. **Inconsistent format**: Some constraints use intent format, others use arrays
2. **Clarification loops**: Vague queries trigger clarification instead of using extracted constraints
3. **Missing constraints**: Some inferred constraints are not being extracted

**Next Steps**:
1. Update prompt to enforce intent format for ALL directly interpretable constraints
2. Add more synonym examples for styles and necklines
3. Fix clarification logic to allow retrieval when constraints are extracted
4. Add more examples for inferred constraint extraction
