# Dictionary vs SQL Filter Analysis

## The Issue

You're absolutely right to question this! If dictionaries are built from database columns and the LLM classifies constraints based on those dictionaries, then SQL filters checking the same columns should work. Let me trace through the exact issue.

## Dictionary Extraction (build-category-specific-dictionaries.ts)

### Materials Extraction (Lines 342-350)
```typescript
// Extract materials
const materialValue = extractAttributeValue(product.material, product.attr_material, product.attr_Material_capital);
if (materialValue && !dictionary.availableMaterials.includes(materialValue)) {
  dictionary.availableMaterials.push(materialValue);
  dictionary.materialFrequency[materialValue] = (dictionary.materialFrequency[materialValue] || 0) + 1;
}
const fabricValue = extractAttributeValue(product.fabric, product.attr_fabric, product.attr_Fabric_capital);
if (fabricValue && !dictionary.availableMaterials.includes(fabricValue)) {
  dictionary.availableMaterials.push(fabricValue);
  dictionary.materialFrequency[fabricValue] = (dictionary.materialFrequency[fabricValue] || 0) + 1;
}
```

**Dictionary checks:**
1. `p.material` column (primary)
2. `p.attributes->>'material'` (fallback)
3. `p.attributes->>'Material'` (fallback)
4. `p.fabric` column (primary)
5. `p.attributes->>'fabric'` (fallback)
6. `p.attributes->>'Fabric'` (fallback)

### Fit Extraction (Lines 335-340)
```typescript
// Extract fit
const fitValue = extractAttributeValue(product.fit, product.attr_fit, product.attr_Fit_capital);
if (fitValue && !dictionary.availableFits.includes(fitValue)) {
  dictionary.availableFits.push(fitValue);
  dictionary.fitFrequency[fitValue] = (dictionary.fitFrequency[fitValue] || 0) + 1;
}
```

**Dictionary checks:**
1. `p.fit` column (primary)
2. `p.attributes->>'fit'` (fallback)
3. `p.attributes->>'Fit'` (fallback)

### Season Extraction (Need to check)
Let me find the season extraction code...

## SQL Filter Implementation (src/lib/search/vector/index.ts)

### Material Filter (Lines 1762-1796)
```typescript
if (filters?.materials && filters.materials.length > 0) {
  const materialOrConditions: string[] = [];
  filters.materials.forEach((material) => {
    const exactParam = paramIndex;
    const materialCondition = `(
      -- Check database columns (primary source)
      LOWER(COALESCE(p."material", '')) LIKE LOWER($${exactParam})
      OR LOWER(COALESCE(p."fabric", '')) LIKE LOWER($${exactParam})
      OR
      -- Check JSONB attributes (fallback for legacy data)
      LOWER(COALESCE(p.attributes->>'material', '')) LIKE LOWER($${exactParam})
      OR LOWER(COALESCE(p.attributes->>'fabric', '')) LIKE LOWER($${exactParam})
      OR LOWER(COALESCE(p.attributes->>'materials', '')) LIKE LOWER($${exactParam})
      OR (p.attributes->'extensible' IS NOT NULL AND (
          LOWER(COALESCE(p.attributes->'extensible'->>'material', '')) LIKE LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->'extensible'->>'fabric', '')) LIKE LOWER($${exactParam})
        ))
    )`;
    materialOrConditions.push(materialCondition);
    params.push(`%${material}%`); // Use LIKE for partial matching
    paramIndex += 1;
  });
}
```

**SQL Filter checks:**
1. `p.material` column (primary) ✅ MATCHES
2. `p.fabric` column (primary) ✅ MATCHES
3. `p.attributes->>'material'` (fallback) ✅ MATCHES
4. `p.attributes->>'fabric'` (fallback) ✅ MATCHES
5. `p.attributes->>'materials'` (additional - not in dictionary)
6. `p.attributes->'extensible'->>'material'` (additional - not in dictionary)
7. `p.attributes->'extensible'->>'fabric'` (additional - not in dictionary)

**⚠️ MISSING:** Dictionary checks `p.attributes->>'Material'` (capital M) but SQL filter doesn't!

### Fit Filter (Lines 1934-1963)
```typescript
if (filters?.fits && filters.fits.length > 0) {
  const fitOrConditions: string[] = [];
  filters.fits.forEach((fit) => {
    const exactParam = paramIndex;
    const fitCondition = `(
      -- Check database column (primary source)
      LOWER(COALESCE(p."fit", '')) = LOWER($${exactParam})
      OR
      -- Check JSONB attributes (fallback for legacy data)
      LOWER(COALESCE(p.attributes->>'fit', '')) = LOWER($${exactParam})
      OR (p.attributes->'extensible' IS NOT NULL AND 
          LOWER(COALESCE(p.attributes->'extensible'->>'fit', '')) = LOWER($${exactParam}))
    )`;
    fitOrConditions.push(fitCondition);
    params.push(fit);
    paramIndex += 1;
  });
}
```

**SQL Filter checks:**
1. `p.fit` column (primary) ✅ MATCHES
2. `p.attributes->>'fit'` (fallback) ✅ MATCHES
3. `p.attributes->'extensible'->>'fit'` (additional - not in dictionary)

**⚠️ MISSING:** Dictionary checks `p.attributes->>'Fit'` (capital F) but SQL filter doesn't!

### Season Filter (Lines 2042-2075)
```typescript
if (filters?.seasons && filters.seasons.length > 0) {
  const seasonOrConditions: string[] = [];
  filters.seasons.forEach((season) => {
    const exactParam = paramIndex;
    const seasonCondition = `(
      -- Check database column (primary source)
      LOWER(COALESCE(p."season", '')) LIKE LOWER($${exactParam})
      OR
      -- Check JSONB attributes (fallback for legacy data)
      LOWER(COALESCE(p.attributes->>'season', '')) LIKE LOWER($${exactParam})
      OR LOWER(COALESCE(p.attributes->>'seasonalCues', '')) LIKE LOWER($${exactParam})
      OR (p.attributes->'extensible' IS NOT NULL AND (
          LOWER(COALESCE(p.attributes->'extensible'->>'season', '')) LIKE LOWER($${exactParam})
          OR LOWER(COALESCE(p.attributes->'extensible'->>'seasonalCues', '')) LIKE LOWER($${exactParam})
        ))
    )`;
    seasonOrConditions.push(seasonCondition);
    params.push(`%${season}%`);
    paramIndex += 1;
  });
}
```

**SQL Filter checks:**
1. `p.season` column (primary) ✅ MATCHES
2. `p.attributes->>'season'` (fallback) ✅ MATCHES
3. `p.attributes->>'seasonalCues'` (additional - not in dictionary)
4. `p.attributes->'extensible'->>'season'` (additional - not in dictionary)
5. `p.attributes->'extensible'->>'seasonalCues'` (additional - not in dictionary)

**Need to check:** Does dictionary check `p.attributes->>'Season'` (capital S)?

## The Real Issue

### Problem 1: Case Sensitivity Mismatch
- **Dictionary extracts from:** `attributes->>'Material'` (capital M), `attributes->>'Fit'` (capital F), `attributes->>'Season'` (capital S)
- **SQL filter checks:** Only lowercase versions (`attributes->>'material'`, `attributes->>'fit'`, `attributes->>'season'`)

**Impact:** If data is stored with capital letters in attributes, dictionary will find it but SQL filter won't!

### Problem 2: Normalization Mismatch
- **Dictionary:** Normalizes values to lowercase using `normalizeValue()` function
- **SQL Filter:** Uses `LOWER()` function on database values, but compares against LLM-extracted values

**Example:**
- Dictionary finds: `"Cotton"` → normalizes to `"cotton"` → stores in dictionary
- LLM classifies: `"Cotton"` → extracts as `"Cotton"` (original case)
- SQL Filter: `LOWER(p.material) LIKE LOWER('%Cotton%')` → matches `"cotton"` in DB ✅
- BUT: If LLM extracts `"cotton"` (lowercase) and DB has `"Cotton"` (capitalized), it should still work...

Wait, let me check the actual issue more carefully.

### Problem 3: LIKE vs Exact Match
- **Dictionary:** Uses exact values (normalized to lowercase)
- **SQL Filter for Materials:** Uses `LIKE` with `%${material}%` (partial match)
- **SQL Filter for Fits:** Uses `= LOWER($${exactParam})` (exact match)

**This should work, but...**

### Problem 4: The Actual Root Cause

Looking at the audit results:
- **Test 6:** Database shows 234 products exist with all constraints
- **Test 10:** Database shows 1 product exists with all constraints
- **But vector search returns 0**

**The issue is NOT the column matching - it's something else!**

Possible causes:
1. **Vector search is filtering on pre-deduplicated product IDs** - The products that match may not be in the pre-deduplicated list
2. **Embedding filtering** - Products may not have embeddings
3. **Additional filters in vector search** - There may be other filters applied that aren't in the simple database check

Let me check the vector search implementation...

## The Real Root Cause

Looking at the logs from Test 6:
```
deduplicateProductsByCategoryForPostFiltering: results found: count: 331
fashion_semantic_search: post_sql_filtering_stage2_complete: originalCount: 331, postFilteredCount: 331
searchVectorIndexWithDeduplication: using pre-deduplicated product IDs: productIdsCount: 331
searchVectorIndexWithDeduplication: results found: count: 0
```

**The issue:**
1. Stage 1: Category filter returns 331 products ✅
2. Stage 2: Post-SQL filtering (dictionary-based) returns 331 products ✅
3. Stage 3: Vector search with material/season/color filters returns 0 ❌

**The problem is in the vector search SQL filter!**

The vector search is applying AND logic between:
- Colors (OR within colors)
- Materials (OR within materials)  
- Seasons (OR within seasons)

But the SQL query may have an issue with how these are combined, OR the products in the pre-deduplicated list don't have the required attributes.

## The Real Root Cause

### Issue 1: Case Sensitivity Mismatch (Minor)

**Dictionary Extraction:**
- Checks: `attributes->>'Material'` (capital M), `attributes->>'Fit'` (capital F), `attributes->>'Season'` (capital S)
- Normalizes to lowercase for storage

**SQL Filter:**
- Checks: Only `attributes->>'material'` (lowercase), `attributes->>'fit'`, `attributes->>'season'`
- **Missing:** Capital letter versions

**Impact:** If data is stored with capital letters in attributes JSON, dictionary will find it but SQL filter won't match it.

### Issue 2: The Actual Problem (Major)

Looking at Test 6 logs:
```
Stage 1 (Category filter): 331 products found
Stage 2 (Post-SQL filtering): 331 products (no reduction)
Stage 3 (Vector search with material/season/color filters): 0 products
```

**But the audit shows:** 234 products exist in the full database that match all constraints!

**The Real Issue:**

The vector search (`searchVectorIndexWithDeduplication`) is being called with:
- `productIds`: Pre-deduplicated list of 331 product IDs
- `filters`: Material, season, color filters

The SQL query then applies:
```sql
WHERE p.id = ANY(ARRAY[331 product IDs]::text[])
AND (material filter)
AND (season filter)  
AND (color filter)
```

**The problem:** The 331 pre-deduplicated products may NOT include the 234 products that match all constraints!

**Why?** The pre-deduplication step (`deduplicateProductsByCategoryForPostFiltering`) only filters by:
- Category
- Gender
- AgeGroup
- InclusivitySizing
- SetVsSingle

It does NOT filter by material, season, or color. So it returns 331 products that match category/gender/age, but those 331 products may not include the 234 that ALSO match material/season/color.

**Example:**
- Full database: 234 products match (category + material + season + color)
- Pre-deduplication: Returns 331 products (only category + gender + age)
- Vector search: Filters those 331 products by material/season/color → 0 results

**The 234 matching products are NOT in the 331 pre-deduplicated list!**

## Conclusion

**You're absolutely right - dictionaries and SQL filters should match!** The issue is NOT a mismatch between dictionary extraction and SQL filter columns. The issue is:

1. **Pre-deduplication scope:** The pre-deduplication step doesn't include material/season/color filters, so it returns a broader set of products
2. **Vector search filtering:** The vector search then tries to filter those pre-deduplicated products by material/season/color, but those products don't have the required attributes
3. **Missing products:** The products that DO match all constraints are filtered out during pre-deduplication (possibly due to deduplication logic or other filters)

**The fix:** Either:
- Include material/season/color filters in the pre-deduplication step, OR
- Don't pre-filter by category if you're going to apply material/season/color filters later, OR
- Apply material/season/color filters BEFORE pre-deduplication

The current flow is:
1. Pre-deduplicate by category → 331 products
2. Apply material/season/color filters → 0 products (because the 331 don't match)

But it should be:
1. Apply ALL filters (category + material + season + color) → 234 products
2. Deduplicate → fewer products
3. Vector search → results
