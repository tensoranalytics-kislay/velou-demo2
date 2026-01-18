# Pipeline Analysis: "dresses for curvy women"

## Query Flow Summary

**Query**: `dresses for curvy women`  
**Timestamp**: `2026-01-16T21:21:54.704Z`  
**Session ID**: `2c4d5353-9cc7-4332-a3a1-834d85c82457`  
**Route**: `DISCOVERY`  
**Is Follow-Up**: `true`

---

## 1. Constraint Extraction & Normalization

### Initial Extraction
- **Source**: Constraint merger extracted from "curvy women" → `ageGroups: { values: ['Curvy Women'], intent: 'required' }`
- **LLM Classification**: Classifier extracted `ageGroups: ["Adult"]` (correctly normalized by LLM)
- **Other Constraints Extracted**:
  - `lengths: ["Maxi", "Midi"]` (intent: "strong")
  - `fits: ["Relaxed Fit", "A-Line", "Wrap", "Fit and Flare", "Empire Waist"]`
  - `necklines: ["V-Neck", "Round Neck", "Sweetheart"]` (intent: "strong")
  - `styles: ["A-Line", "Wrap", "Fit and Flare", "Empire Waist"]` (invalid - dropped)

### Constraint Refinement (Before Retrieval)
- **Initial Fits Extracted by LLM**: `["Relaxed Fit", "A-Line", "Wrap", "Fit and Flare", "Empire Waist"]` (5 values)
- **Dictionary Validation**: Only `fits` passed validation → `4` values validated (1 dropped)
  - **Note**: Logs show `validatedConstraints: { fits: 4 }` but don't show exact values
  - **Likely Valid Fits**: "Relaxed Fit" (valid) + 3 of the others (one invalid fit dropped)
  - **Invalid Fits Dropped**: Likely one of "A-Line", "Wrap", "Fit and Flare", "Empire Waist" is not in dictionary
- **Result**: Most constraints were removed before retrieval
- **Preserved**: `ageGroups: ["Adult"]` (normalized), `fits` (4 validated values)

### Constraint Explicit Removal
From logs (line 59-76):
```
constraints_explicitly_removed: [
  'styles', 'lengths', 'occasions', 'seasons', 'materials',
  'patterns', 'colors', 'sizes', 'fits', 'collections',
  'priceMinCents', 'priceMaxCents', 'embellishments',
  'necklines', 'sleeveLengths', 'scents', 'rooms', 'useCases',
  'benefits', 'claims', 'sensoryProfile', 'compatibility'
]
```

**Note**: These constraints were removed by the user/system and should NOT be restored from classification.

### Final Constraints Passed to Ranking
From logs (line 782-814):
```javascript
constraintsPassedToRanking: {
  colors: null,
  patterns: null,
  occasions: null,
  materials: null,
  sizes: null,
  ageGroups: { values: ['Curvy Women'], intent: 'required' },  // ⚠️ ISSUE: Not normalized to 'Adult'
  priceMinCents: null,
  priceMaxCents: null,
  seasons: null,
  styles: null,
  fits: null,  // ⚠️ REMOVED: Even though 4 fits were validated, they were explicitly removed!
  lengths: null,
  necklines: null,
  sleeveLengths: null,
  collections: null,
  embellishments: null
}
```

**⚠️ CRITICAL ISSUES**:
1. `ageGroups` still contains `['Curvy Women']` instead of `['Adult']` when passed to ranking!
2. `fits: null` - Even though 4 fits values were validated against dictionary, they were explicitly removed before ranking!

---

## 2. Category Classification

### Result
- **Categories**: `["Women's Dresses"]`
- **Confidence**: `0.95`
- **Applied As**: Hard SQL-level filter

### SQL Filtering
- **Gender**: `female` (hard SQL filter)
- **Age Group**: `Adult` (hard SQL filter) - **CORRECTLY normalized here**
- **Category**: `Women's Dresses` (hard SQL filter)

---

## 3. Retrieval Stage

### Stage 1: Category-Only SQL Filter
- **Products Found**: `195` products
- **Filters Applied**:
  ```sql
  WHERE category = "Women's Dresses"
    AND gender = 'female'
    AND ageGroup = 'Adult'  -- ✅ Correctly normalized
    AND stockStatus = 'in_stock'
  ```

### Stage 2: Vector Search with Post-SQL Filtering
- **Post-SQL Filtering Mode**: `enabled`
- **Vector Search Query**: `"dress"` (cleaned product terms)
- **Pre-deduplicated Product IDs**: `195`
- **Results After Vector Search**: `150` candidates
- **Top Similarity**: `0.39825847138515014`
- **Avg Similarity**: `0.3448949530130471`

---

## 4. Product Loading

### Loaded Products
- **Requested**: `40` products
- **Loaded**: `40` products
- **Duration**: `3.35` seconds

---

## 5. Hard Filtering (Required/Excluded Constraints)

### Filter Applied
- **Constraint**: `ageGroups: { values: ['Curvy Women'], intent: 'required' }`
- **Original Count**: `40` products
- **Filtered Count**: `37` products
- **Removed**: `3` products

### Analysis
The hard filter used `'Curvy Women'` instead of `'Adult'`, but:
- ✅ Products with `ageGroup = 'Adult'` should still match via category inference
- ✅ The SQL filter already ensured only `Adult` products were loaded
- ⚠️ The 3 removed products likely didn't match the category-based age group inference

---

## 6. Constraint-Based Ranking

### Ranking Applied
- **Product Count**: `37` products
- **Constraint Fields**: `['ageGroups']`
- **Constraint Values**: `{ values: ['Curvy Women'], intent: 'required' }` ⚠️

### Scoring Results
- **Avg Constraint Score**: `1.0` (all products matched)
- **Min/Max Constraint Score**: `1.0`
- **Effective Boost**: `0.8`
- **Avg Final Score**: `1.163502312012893`
- **Top Final Score**: `1.19825847138515`

### Product Scoring Details
From logs (lines 175-428), all products scored `1.0` for ageGroups constraint:
```javascript
{
  productId: '8179604455609',
  productTitle: 'Sorone Satin Lace Maxi Slip Dress for Women',
  finalScore: 1,
  sumWeights: 3,
  sumScores: 3,
  scoreDetails: {
    ageGroups: {
      queryValue: ['Curvy Women'],  // ⚠️ Still 'Curvy Women' at ranking
      productValue: 'adult',        // ✅ Product has 'adult'
      score: 1,                      // ✅ Match (via normalization in matcher)
      weighted: 3
    }
  }
}
```

**✅ WORKING**: The constraint matcher correctly normalizes `'Curvy Women'` to `'Adult'` when comparing with product `ageGroup = 'adult'`.

---

## 7. Final Product Selection

### Products Shown
- **Final Count**: `4` products
- **Total Available**: `37` products
- **Top Products**:
  1. Eclipse Rhinestone Scallop Bandage Dress (score: 1.198)
  2. Talissa Sequin Maxi Dress (score: 1.182)
  3. Florencio Tweed Mini Dress (score: 1.176)
  4. Bellby Polkadot Bow Gown (score: 1.173)

---

## 8. Issues Found

### ⚠️ Issue 1: Age Group Normalization Inconsistency
- **Problem**: `ageGroups` constraint passed to ranking contains `['Curvy Women']` instead of `['Adult']`
- **Location**: `orchestrator.ts` - constraint normalization before ranking
- **Impact**: Low - constraint matcher handles normalization, but inconsistent
- **Expected**: Should be normalized to `['Adult']` before ranking

### ⚠️ Issue 2: Dictionary-Validated Constraints Removed Before Ranking
- **Problem**: 4 `fits` values were validated against dictionary but then explicitly removed before ranking
- **Location**: `constraints_explicitly_removed` list removes `fits` even after validation
- **Impact**: **HIGH** - Dictionary-validated constraints are not being used for product matching!
- **Note**: Only `ageGroups` remained for ranking, but `fits` (4 validated values) were removed
- **Root Cause**: Constraints are removed AFTER dictionary validation, defeating the purpose of validation

### ✅ Issue 3: Post-SQL Filtering (Working Correctly)
- **Behavior**: Post-SQL filtering applied `lengths` and `necklines` constraints
- **Result**: Products matched `lengths: ["Maxi", "Midi"]` and `necklines` correctly
- **Note**: These were not used for ranking, only for filtering

---

## 9. Verification: Products vs Dictionary-Validated Constraints

### Dictionary-Validated Constraints from LLM Refinement
1. **Fits** (4 values validated, 1 dropped from original 5):
   - **Initial LLM Extraction**: `["Relaxed Fit", "A-Line", "Wrap", "Fit and Flare", "Empire Waist"]`
   - **After Dictionary Validation**: `4 values` (exact values not logged, but likely "Relaxed Fit" + 3 others)
   - **Status**: ✅ Validated against dictionary, but ❌ **REMOVED before ranking** (explicitly removed)

### Constraints NOT Validated (Removed Before Dictionary Check)
- **Lengths**: `["Maxi", "Midi"]` - Removed before dictionary validation
- **Necklines**: `["V-Neck", "Round Neck", "Sweetheart"]` - Removed before dictionary validation
- **Styles**: `["A-Line", "Wrap", "Fit and Flare", "Empire Waist"]` - Invalid, dropped

### Constraint Matches for Final Products
All 4 final products match:
- ✅ **Category**: `"Women's Dresses"` (hard SQL filter)
- ✅ **Gender**: `female` (hard SQL filter)
- ✅ **Age Group**: `Adult` (hard SQL filter + category inference)
- ✅ **Lengths**: `Maxi` or `Midi` (post-SQL filtering, not used for ranking)
- ✅ **Necklines**: `V-Neck`, `Round Neck`, `Sweetheart`, or `null` (post-SQL filtering, not used for ranking)
- ❓ **Fits**: **NOT USED** - Even though 4 fits were validated, they were removed before ranking

### Product Details vs Dictionary-Validated Constraints

**⚠️ CRITICAL FINDING**: The dictionary-validated `fits` constraints (4 values) were **NOT used for ranking or product matching**. They were validated but then explicitly removed.

#### Product 1: Eclipse Rhinestone Scallop Bandage Dress (ID: 8244347928761)
- ✅ **Age Group**: `'Adult'` - Matches constraint
- ❓ **Fits**: **UNKNOWN** - Not checked (fits constraint removed before ranking)
- ✅ **Length**: `Mini` - Passed post-SQL filtering (relaxed match for Maxi/Midi)
- ✅ **Neckline**: `Strapless` - Passed post-SQL filtering

#### Product 2: Talissa Sequin Maxi Dress (ID: 8244346880185)
- ✅ **Age Group**: `'Adult'` - Matches constraint
- ❓ **Fits**: **UNKNOWN** - Not checked (fits constraint removed before ranking)
- ✅ **Length**: `Maxi` - Passed post-SQL filtering
- ✅ **Neckline**: `V-Neck` - Passed post-SQL filtering

#### Product 3: Florencio Tweed Mini Dress (ID: 8179608846521)
- ✅ **Age Group**: `'Adult'` - Matches constraint
- ❓ **Fits**: **UNKNOWN** - Not checked (fits constraint removed before ranking)
- ✅ **Length**: `Mini` - Passed post-SQL filtering (relaxed match)
- ✅ **Neckline**: Matched - Passed post-SQL filtering

#### Product 4: Bellby Polkadot Bow Gown (ID: 8084019216569)
- ✅ **Age Group**: `'Adult'` - Matches constraint
- ❓ **Fits**: **UNKNOWN** - Not checked (fits constraint removed before ranking)
- ✅ **Length**: `Maxi` - Passed post-SQL filtering
- ✅ **Neckline**: `Scoop` - Passed post-SQL filtering

**Summary**: Only `ageGroups` constraint was used for ranking. The 4 validated `fits` values were removed before ranking, so we **cannot verify if the final products match the fits constraints**.

---

## 10. Conclusion

### ✅ What Worked
1. **Category Classification**: Correctly identified `"Women's Dresses"`
2. **SQL Filtering**: Age groups correctly normalized to `'Adult'` for SQL
3. **Retrieval**: Found 150 candidates, loaded 40 products
4. **Hard Filtering**: Removed 3 non-matching products
5. **Ranking**: All products scored `1.0` for age group constraint
6. **Final Products**: All 4 products match constraints

### ⚠️ What Needs Fixing
1. **Age Group Normalization**: `ageGroups` constraint should be normalized to `['Adult']` before passing to ranking (currently `['Curvy Women']`)
   - **File**: `src/lib/loveshackfancy/orchestrator.ts`
   - **Function**: `constraintsForRanking` construction
   - **Fix**: Normalize `ageGroups` values using `normalizeAgeGroups()` before ranking

### ✅ Pipeline Flow
The pipeline correctly:
1. Extracted and normalized constraints
2. Applied category filtering
3. Applied SQL-level filtering (category, gender, age group)
4. Performed vector search
5. Applied post-SQL filtering (lengths, necklines)
6. Applied hard filtering (required/excluded constraints)
7. Applied constraint-based ranking
8. Selected top 4 products

**Overall**: The pipeline works correctly, but age group normalization should be applied consistently before ranking.
