# Office Wear Query - Complete Constraint Analysis

## Query: "I am joining office next month, suggest me something to wear"

---

## Executive Summary

**Query Type**: `gift_or_vague` (indirect search)  
**Category Classification**: Skipped (no categories identified)  
**Result**: Clarification triggered (0 products returned)  
**Reason**: No product categories identified - system needs clarification on product type

---

## All Constraints Extracted

### 1. Colors ✅
- **Values**: `['White', 'Navy', 'Gray', 'Beige', 'Black', 'Blush']`
- **Intent**: `'strong'`
- **Source**: Inferred from "office" context (professional/neutral colors)
- **Format**: Array with intent object
- **Usage**: ⚠️ **Soft Filter / Ranking** (not hard SQL filter)

### 2. Occasions ✅
- **Values**: `['Work']`
- **Intent**: `'strong'`
- **Source**: Explicitly mentioned "office" → inferred "Work" occasion
- **Format**: Array with intent object
- **Usage**: ⚠️ **Soft Ranking** (occasions not in SQL filters, used for ranking only)

### 3. Age Groups ✅
- **Values**: `['Adult']`
- **Intent**: `'strong'`
- **Source**: Default + context inference
- **Format**: Array with intent object
- **Usage**: ✅ **Hard SQL Filter** (always applied at database level)

### 4. Fits ✅
- **Values**: `['Relaxed', 'Regular', 'Fitted']`
- **Intent**: Not specified (array format, no intent object)
- **Source**: Inferred from "office" context (professional fits)
- **Format**: Plain array
- **Usage**: ⚠️ **Soft Ranking** (fits not in SQL filters, used for ranking only)

### 5. Necklines ✅
- **Values**: `['Round', 'V-Neck', 'Collar']`
- **Intent**: Not specified (array format, no intent object)
- **Source**: Inferred from "office" context (professional necklines)
- **Format**: Plain array
- **Usage**: ⚠️ **Post-SQL Filtering** (soft filter, applied after SQL query)

### 6. Sleeve Lengths ✅
- **Values**: `['Long Sleeve', 'Three-Quarter Sleeve', 'Short Sleeve']`
- **Intent**: Not specified (array format, no intent object)
- **Source**: Inferred from "office" context (professional sleeves)
- **Format**: Plain array
- **Usage**: ⚠️ **Post-SQL Filtering** (soft filter, applied after SQL query)

### 7. Inclusivity Sizing ✅
- **Values**: Not extracted by LLM
- **Default Applied**: `['Standard Sizing']` ✅
- **Source**: Default behavior (no body type mentioned)
- **Usage**: ✅ **Hard SQL Filter** (always applied at database level)

### 8. Gender
- **Values**: `null` (not extracted)
- **Source**: Query is gender-ambiguous
- **Usage**: No gender filter applied

### 9. Categories
- **Values**: `[]` (none classified)
- **Source**: Query too vague - no specific product type mentioned
- **Usage**: No category filter applied
- **Impact**: ⚠️ **This caused clarification to be triggered**

---

## Hard Filters vs Soft Ranking

### ✅ Hard SQL Filters (Applied at Database Level)

These filters are applied directly in the SQL WHERE clause and **never relaxed**:

1. **Age Groups**: `['Adult']`
   - SQL: `p."ageGroup" = 'Adult'`
   - Intent: `'strong'` (but age groups are always hard filters regardless of intent)

2. **Inclusivity Sizing**: `['Standard Sizing']` (default)
   - SQL: `p."inclusivitySizing" = ANY(ARRAY['Standard Sizing']::text[])`
   - Always hard filter (default behavior)

**Total Hard Filters**: 2

---

### ⚠️ Soft Filters / Ranking (Applied After SQL)

These constraints are used for **post-SQL filtering** and **ranking**, not as hard SQL filters:

1. **Colors**: `['White', 'Navy', 'Gray', 'Beige', 'Black', 'Blush']`
   - Intent: `'strong'`
   - Usage: Post-SQL filtering + ranking
   - **Not applied in SQL WHERE clause**

2. **Occasions**: `['Work']`
   - Intent: `'strong'`
   - Usage: Ranking only (occasions not in SQL filters)
   - **Not applied in SQL WHERE clause**

3. **Fits**: `['Relaxed', 'Regular', 'Fitted']`
   - Usage: Ranking only
   - **Not applied in SQL WHERE clause**

4. **Necklines**: `['Round', 'V-Neck', 'Collar']`
   - Usage: Post-SQL filtering (soft filter)
   - **Not applied in SQL WHERE clause**

5. **Sleeve Lengths**: `['Long Sleeve', 'Three-Quarter Sleeve', 'Short Sleeve']`
   - Usage: Post-SQL filtering (soft filter)
   - **Not applied in SQL WHERE clause**

**Total Soft Filters**: 5

---

## Why No Products Were Returned

### Root Cause: No Categories Classified

1. **Query Classification**: `indirect_search` (vague query)
2. **Category Classification**: Skipped (indirect_search without follow-up)
3. **Result**: `topCategories = []` (empty)
4. **Clarification Triggered**: "Are you looking for dresses, tops, or something else?"

### If Categories Were Provided

If the user had specified a category (e.g., "dresses" or "tops"), the pipeline would have:

1. **Applied Hard Filters**:
   - Age Groups: `['Adult']`
   - Inclusivity Sizing: `['Standard Sizing']`
   - Categories: (e.g., `["Women's Dresses"]`)

2. **Applied Soft Filters**:
   - Colors: `['White', 'Navy', 'Gray', 'Beige', 'Black', 'Blush']`
   - Occasions: `['Work']` (for ranking)
   - Fits: `['Relaxed', 'Regular', 'Fitted']` (for ranking)
   - Necklines: `['Round', 'V-Neck', 'Collar']` (post-SQL filtering)
   - Sleeve Lengths: `['Long Sleeve', 'Three-Quarter Sleeve', 'Short Sleeve']` (post-SQL filtering)

3. **Returned Products**: Office-appropriate products matching the constraints

---

## Constraint Summary Table

| Constraint | Values | Intent | Hard Filter | Soft Filter/Ranking |
|------------|--------|--------|-------------|---------------------|
| **Colors** | 6 values | `strong` | ❌ No | ✅ Yes |
| **Occasions** | `['Work']` | `strong` | ❌ No | ✅ Yes (ranking) |
| **Age Groups** | `['Adult']` | `strong` | ✅ Yes | ❌ No |
| **Fits** | 3 values | None | ❌ No | ✅ Yes (ranking) |
| **Necklines** | 3 values | None | ❌ No | ✅ Yes (post-SQL) |
| **Sleeve Lengths** | 3 values | None | ❌ No | ✅ Yes (post-SQL) |
| **Inclusivity Sizing** | `['Standard Sizing']` | Default | ✅ Yes | ❌ No |
| **Categories** | `[]` | N/A | ❌ No | ❌ No |

---

## Key Insights

1. **LLM Extraction**: Successfully extracted 7 constraint types from vague "office" query
2. **Intent Assignment**: Most constraints marked as `'strong'` (inferred from context)
3. **Default Behavior**: Inclusivity Sizing correctly defaulted to "Standard Sizing"
4. **Hard Filters**: Only 2 hard filters (Age Groups, Inclusivity Sizing)
5. **Soft Filters**: 5 constraints used for ranking/post-SQL filtering
6. **Missing Category**: Query too vague - no product type specified → clarification needed

---

## Products Recommended

**Products Returned**: 0

**Reason**: Clarification triggered due to no categories identified

**If categories were provided**, the system would have returned office-appropriate products matching:
- Hard filters: Adult, Standard Sizing, specified category
- Soft filters: Professional colors, Work occasion, professional fits/necklines/sleeves
