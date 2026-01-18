# Corrected Analysis: Ensuring "Curvy" Constraint Extraction Finds Curvy-Specific Products

## The Problem (Corrected)

You're absolutely right - "curvy" is **NOT an age group**. It's a **body type/size descriptor**. Adding "Curvy Women" to age groups would be semantically incorrect.

The correct approach is to extract "curvy" as a **body type/fit/style constraint**, not an age group.

---

## Current System: How "Curvy" Should Be Handled

### 1. Age Group Extraction (Correct)
- **Query**: "I am a curvy mom, suggest me a dress"
- **Age Group**: `["Adult"]` ✅ **CORRECT** - "curvy mom" → normalized to "Adult"
- **Location**: `src/lib/loveshackfancy/age-group-normalizer.ts` (lines 30-34)
- **Mapping**: `'curvy mom': ['Adult']` ✅ This is correct!

### 2. Body Type/Style Extraction (Should Happen)
- **Query**: "dresses for curvy women"
- **Expected Extraction**: `styles: ["A-Line", "Wrap", "Fit and Flare", "Empire"]` ✅
- **Location**: `src/lib/loveshackfancy/prompts.ts` (lines 459-464)

The prompt **already has logic** to extract "curvy" as styles:
```typescript
3. **CONTEXTUAL INFERENCE**: For queries like "dresses for curvy women", infer constraints from context and map to dictionary:
   - "curvy" → fits: ["Fitted", "Relaxed", "Loose", "Regular"] (map "curvy" to dictionary fit values that work for curvy body types)
   - Body type contexts should map to styles dictionary: ["A-Line", "Wrap", "Fit and Flare", "Empire"] (styles that flatter curvy figures)

4. **STYLE INFERENCE RULES**: When inferring styles for body types/occasions:
   - "curvy women", "plus size" → styles: ["A-Line", "Wrap", "Fit and Flare", "Empire"] (from styles dictionary)
```

---

## Database Schema: Where "Curvy" Products Are Tagged

### Option 1: `inclusivitySizing` Column (Most Appropriate)
**Location**: `prisma/schema.prisma` (line 184)

Products can be tagged with `inclusivitySizing`:
- `"Plus Size"` - for plus-size/curvy-specific products
- `"Extended Sizes"` - for extended size ranges
- `"Petite"` - for petite sizes
- `"Tall"` - for tall sizes
- `"Standard Sizing"` - for standard sizes
- `"Inclusive Range"` - for inclusive size ranges

**If products are tagged with `inclusivitySizing = "Plus Size"`, extract "curvy" as `inclusivitySizing` constraint.**

### Option 2: `silhouetteCut` Column (Style-Based)
**Location**: `prisma/schema.prisma` (line 154)

Products can be tagged with curvy-friendly styles in `silhouetteCut`:
- `"A-Line"` - flattering for curvy figures
- `"Wrap"` - adjustable fit for curvy figures
- `"Fit and Flare"` - accentuates waist, flatters curves
- `"Empire Waist"` - elongates silhouette, flattering

**If products are tagged with curvy-friendly `silhouetteCut` values, extract "curvy" as `styles` constraint.**

### Option 3: `fit` Column
**Location**: `prisma/schema.prisma` (line 153)

Products can be tagged with curvy-friendly fits:
- `"Fitted"` - tailored to curves
- `"Relaxed"` - comfortable for curvy figures
- `"Plus Size"` - explicitly for plus-size/curvy

---

## Corrected Solution: Extract "Curvy" as Body Type/Fit/Style

### Step 1: Check How Products Are Tagged

**Check Database**:
```sql
-- Check if products are tagged with inclusivitySizing
SELECT DISTINCT "inclusivitySizing" FROM "Product" WHERE "inclusivitySizing" IS NOT NULL;

-- Check if products are tagged with curvy-friendly styles
SELECT DISTINCT "silhouetteCut" FROM "Product" WHERE "silhouetteCut" IN ('A-Line', 'Wrap', 'Fit and Flare', 'Empire Waist');

-- Check if products mention "curvy" in title/description
SELECT id, title FROM "Product" WHERE LOWER(title) LIKE '%curvy%' OR LOWER(description) LIKE '%curvy%' LIMIT 10;
```

### Step 2: Update Constraint Extraction (Based on Tagging)

**If products use `inclusivitySizing = "Plus Size"`**:

1. **Extract `inclusivitySizing` constraint**:
   - Query: "curvy mom" → `inclusivitySizing: ["Plus Size"]` (if "Plus Size" is in the dictionary)
   - Keep `ageGroups: ["Adult"]` (correct)

2. **Update Prompt** (`src/lib/loveshackfancy/prompts.ts`):
   - Add instruction to extract "curvy", "plus size", "curvy women" → `inclusivitySizing: ["Plus Size"]`
   - Keep style inference as fallback (styles: ["A-Line", "Wrap", etc.])

**If products use `silhouetteCut` (styles)**:

1. **Extract `styles` constraint** (already in prompt):
   - Query: "curvy women" → `styles: ["A-Line", "Wrap", "Fit and Flare", "Empire"]`
   - This is **already implemented** in the prompt (lines 459-464)!

2. **Verify LLM is extracting styles**:
   - Check classifier output for `styles` constraint when query contains "curvy"
   - If not extracting, strengthen the prompt examples

### Step 3: Update Constraint Matching

**If using `inclusivitySizing`**:

1. **SQL Filtering** (`src/lib/search/query/buildFilters.ts`):
   - Add `inclusivitySizing` to `BroadWhereFilters` type
   - Filter SQL WHERE clause: `p."inclusivitySizing" = 'Plus Size'`

2. **Constraint Matching** (`src/lib/loveshackfancy/ranking/constraint-matcher.ts`):
   - Add `inclusivitySizing` matching logic
   - Score products with `inclusivitySizing = "Plus Size"` higher when constraint is present

**If using `styles` (already supported)**:

1. **SQL Filtering**: Check if `silhouetteCut` is filtered (likely not - styles are usually soft filters)
2. **Constraint Matching**: Already supported via `matchStyles()` or similar functions
3. **Ranking**: Products matching `styles: ["A-Line", "Wrap", "Fit and Flare", "Empire"]` get higher scores

---

## Recommendation: Use `inclusivitySizing` If Available

### Why `inclusivitySizing` is Better

1. **Semantic Clarity**: "Plus Size" is the correct term for curvy/plus-size products
2. **Indexed Column**: `inclusivitySizing` is an indexed column in the schema (line 184)
3. **SQL Filtering**: Can filter at SQL level for efficiency
4. **Precise Matching**: Explicitly tags products for curvy/plus-size customers

### Implementation Steps

1. **Check Database**: Verify products are tagged with `inclusivitySizing = "Plus Size"`

2. **Update Ontology/Dictionary** (if needed):
   - Ensure `inclusivitySizing` values are in constraint dictionaries
   - Add "Plus Size" to allowed values if not present

3. **Update Constraint Extraction** (`src/lib/loveshackfancy/prompts.ts`):
   ```typescript
   // Add to prompt examples:
   - "curvy women", "curvy mom", "plus size" → inclusivitySizing: ["Plus Size"] (if in dictionary)
   - "petite" → inclusivitySizing: ["Petite"]
   - "tall" → inclusivitySizing: ["Tall"]
   ```

4. **Update SQL Filtering** (`src/lib/search/query/buildFilters.ts`):
   - Add `inclusivitySizing` to `BroadWhereFilters`
   - Add WHERE clause: `p."inclusivitySizing" = $X`

5. **Update Constraint Matching** (`src/lib/loveshackfancy/ranking/constraint-matcher.ts`):
   - Add `matchInclusivitySizing()` function
   - Score products matching `inclusivitySizing` constraint

---

## Fallback: Use Styles (Already Implemented)

If `inclusivitySizing` is not used, the system **already extracts "curvy" as styles**:

- **Query**: "dresses for curvy women"
- **Extracted**: `styles: ["A-Line", "Wrap", "Fit and Flare", "Empire"]`
- **Location**: `src/lib/loveshackfancy/prompts.ts` (lines 464)

**Verify it's working**:
- Check classifier output for "curvy women" query
- Ensure `styles` constraint is extracted
- Ensure products with `silhouetteCut = "A-Line"` etc. match these styles

---

## Summary

✅ **DO**: Extract "curvy" as:
- `inclusivitySizing: ["Plus Size"]` (if products are tagged this way)
- OR `styles: ["A-Line", "Wrap", "Fit and Flare", "Empire"]` (already implemented)

✅ **DO**: Keep `ageGroups: ["Adult"]` - this is correct!

❌ **DON'T**: Add "Curvy Women" to age groups - semantically incorrect

**Key Insight**: "Curvy" describes **body shape/size**, not age. It should be extracted as a **body type/size/fit/style constraint**, not an age group constraint.
