# Analysis: Ensuring "Curvy Women" Constraint Extraction Finds Curvy-Specific Products

## Problem Statement

When users search for "curvy mom" or "curvy women", the system needs to find products that are **specifically tagged for curvy women**. However, the current constraint extraction and normalization process may lose the "curvy" descriptor, making it impossible to find curvy-specific products.

---

## Current Pipeline Flow

### 1. Constraint Extraction

**Query**: "I am a curvy mom, suggest me a dress to wear"

**Extracted Constraints**:
```javascript
{
  ageGroups: ["Curvy Women"],  // Initial extraction from LLM classifier
  gender: "female",
  category: "Women's Dresses"
}
```

### 2. Age Group Normalization

**Location**: `src/lib/loveshackfancy/age-group-normalizer.ts` (lines 30-34)

The normalization function maps "curvy women" → "Adult":

```typescript
const AGE_GROUP_MAPPING: Record<string, string[]> = {
  'curvy women': ['Adult'],
  'curvy woman': ['Adult'],
  'curvy mom': ['Adult'],
  'curvy moms': ['Adult'],
  'curvy': ['Adult'], // When used as a descriptor for adult clothing
  // ...
};
```

**Result**: `["Curvy Women"]` → `normalizeAgeGroups()` → `["Adult"]`

**⚠️ PROBLEM**: The "curvy" descriptor is **lost during normalization**.

### 3. Dictionary Validation

**Location**: `src/lib/loveshackfancy/orchestrator.ts` (lines 2178-2179)

After normalization, constraints are validated against the ontology:

```typescript
const normalized = normalizeAgeGroups(ageGroupValues);
const validated = normalized.filter(ag => isCanonicalAgeGroup(ag));
```

**Ontology Check** (`src/lib/loveshackfancy/ontology.ts`, lines 662-684):

```typescript
ageGroups: [
  'Adult',
  'Kids',
  'Teen',
  'Tween',
  'Toddler',
  'Baby',
  // ... combinations like 'Kids, Teen'
]
```

**⚠️ PROBLEM**: `"Curvy Women"` is **NOT in the ontology**, so even if extracted, it would be filtered out during validation.

### 4. SQL Filtering

**Location**: `src/lib/search/query/buildFilters.ts` (line 95)

SQL filtering uses the normalized age group:

```typescript
genders: constraints.genders?.length ? constraints.genders : undefined,
```

For age groups, SQL queries check:
- Database column: `p."ageGroup" = 'Adult'`
- JSONB attributes: `p.attributes->>'ageGroup' = 'Adult'`

**⚠️ PROBLEM**: If products are stored with `ageGroup = "Curvy Women"`, they will **NOT match** `ageGroup = "Adult"` in SQL filtering.

### 5. Constraint Matching (Ranking)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (lines 708-860)

The constraint matcher uses **strict dictionary matching**:

```typescript
// STRICT DICTIONARY MATCHING ONLY - no synonyms, no hierarchical relationships
// Only matches exact canonical values from the dataset ontology
const normalizedQueryInput = normalizeAgeGroups(queryAgeGroups);
const productCanonical = LOVESHACKFANCY_ONTOLOGY.ageGroups.find(
  ag => ag.toLowerCase() === normalizedPag
);
if (!productCanonical) continue; // Skip if product age group is not in dictionary
```

**⚠️ PROBLEM**: Products with `ageGroup = "Curvy Women"` will **NOT match** queries normalized to `"Adult"` because they don't match the dictionary.

---

## Root Cause Analysis

### Issue 1: Normalization Strips "Curvy" Descriptor

**Problem**: `normalizeAgeGroups(["Curvy Women"])` → `["Adult"]` loses the "curvy" information.

**Why**: The `AGE_GROUP_MAPPING` explicitly maps "curvy women" → "Adult", treating "curvy" as a descriptor, not a distinct age group.

**Impact**: Even if products are tagged with `ageGroup = "Curvy Women"`, queries normalized to "Adult" won't match them.

### Issue 2: "Curvy Women" Not in Ontology

**Problem**: The `LOVESHACKFANCY_ONTOLOGY.ageGroups` list does NOT include `"Curvy Women"`.

**Current Ontology**:
```typescript
ageGroups: [
  'Adult',
  'Kids',
  'Teen',
  // ... NO "Curvy Women"
]
```

**Impact**: 
- Extracted "Curvy Women" values are filtered out during validation
- Products tagged with `ageGroup = "Curvy Women"` won't match dictionary checks

### Issue 3: Strict Dictionary Matching

**Problem**: The constraint matcher only matches exact canonical values from the ontology.

**Impact**: Even if both query and product have "Curvy Women", if it's not in the ontology, matching fails.

---

## Solution Options

### Option 1: Add "Curvy Women" to Ontology (Recommended)

**If products are stored with `ageGroup = "Curvy Women"` in the database:**

1. **Add to Ontology** (`src/lib/loveshackfancy/ontology.ts`):
   ```typescript
   ageGroups: [
     'Adult',
     'Curvy Women',  // ADD THIS
     'Kids',
     // ...
   ]
   ```

2. **Update Normalization** (`src/lib/loveshackfancy/age-group-normalizer.ts`):
   - **Option A**: Don't normalize "Curvy Women" → keep as-is
     ```typescript
     // Remove from AGE_GROUP_MAPPING or change mapping:
     'curvy women': ['Curvy Women'],  // Keep as "Curvy Women"
     'curvy woman': ['Curvy Women'],
     'curvy mom': ['Curvy Women'],
     ```
   - **Option B**: Keep normalization but allow both "Adult" and "Curvy Women"
     ```typescript
     'curvy women': ['Curvy Women', 'Adult'],  // Match both
     ```

3. **Benefits**:
   - ✅ Products tagged `ageGroup = "Curvy Women"` will match queries with "curvy women"
   - ✅ SQL filtering will work correctly
   - ✅ Constraint matching will work correctly
   - ✅ Maintains strict dictionary matching

4. **Trade-offs**:
   - ⚠️ Need to verify products are actually stored with `ageGroup = "Curvy Women"`
   - ⚠️ May need to update product data if they're stored differently

---

### Option 2: Use Separate Body Type Attribute

**If "curvy" is a body type descriptor, not an age group:**

1. **Extract as Separate Constraint**:
   - Add `bodyType: ["Curvy"]` or `fit: ["Curvy"]` or `styles: ["Curvy"]` (depending on how products are tagged)
   - Keep `ageGroups: ["Adult"]` (normalized)

2. **Product Matching**:
   - Products would be matched on `ageGroup = "Adult"` (SQL filter)
   - AND `bodyType/fit/styles` contains "Curvy" (ranking/soft filter)

3. **Benefits**:
   - ✅ Separates age group from body type (semantically cleaner)
   - ✅ Can support other body types (petite, tall, plus-size, etc.)

4. **Trade-offs**:
   - ⚠️ Requires products to have a separate `bodyType`/`fit`/`styles` field
   - ⚠️ Need to update constraint extraction to extract body type separately

---

### Option 3: Hierarchical Age Group Matching

**Allow "Curvy Women" to match "Adult" products:**

1. **Update Matching Logic** (`src/lib/loveshackfancy/ranking/constraint-matcher.ts`):
   ```typescript
   // Allow "Curvy Women" to match "Adult" (hierarchical relationship)
   if (queryCanonicalLower === 'curvy women' && productCanonicalLower === 'adult') {
     return 1.0; // Match
   }
   if (queryCanonicalLower === 'adult' && productCanonicalLower === 'curvy women') {
     return 1.0; // Match
   }
   ```

2. **Benefits**:
   - ✅ Works even if "Curvy Women" is not in ontology
   - ✅ "Adult" queries can still match "Curvy Women" products

3. **Trade-offs**:
   - ⚠️ Breaks strict dictionary matching (requires special-case logic)
   - ⚠️ Still need to handle SQL filtering (may need both "Adult" and "Curvy Women" in WHERE clause)

---

## Recommended Solution: Option 1 (Add to Ontology)

**If your products are stored with `ageGroup = "Curvy Women"`**, the recommended solution is:

1. ✅ **Add "Curvy Women" to the ontology** (`src/lib/loveshackfancy/ontology.ts`)
2. ✅ **Update normalization** to preserve "Curvy Women" (don't normalize to "Adult")
3. ✅ **Verify products** are tagged with `ageGroup = "Curvy Women"` in the database

**Steps to Implement**:

1. **Check Database**:
   ```sql
   SELECT DISTINCT "ageGroup" FROM "Product" WHERE "ageGroup" LIKE '%curvy%' OR "ageGroup" LIKE '%Curvy%';
   ```
   - If products exist with `ageGroup = "Curvy Women"`, proceed with Option 1.
   - If not, consider Option 2 (separate body type attribute).

2. **Update Ontology** (`src/lib/loveshackfancy/ontology.ts`):
   ```typescript
   ageGroups: [
     'Adult',
     'Curvy Women',  // ADD THIS
     'Kids',
     // ...
   ]
   ```

3. **Update Normalization** (`src/lib/loveshackfancy/age-group-normalizer.ts`):
   ```typescript
   'curvy women': ['Curvy Women'],  // Preserve as "Curvy Women"
   'curvy woman': ['Curvy Women'],
   'curvy mom': ['Curvy Women'],
   'curvy moms': ['Curvy Women'],
   ```

4. **Test**:
   - Query: "I am a curvy mom, suggest me a dress"
   - Verify: `ageGroups: ["Curvy Women"]` is extracted and NOT normalized to "Adult"
   - Verify: SQL filtering uses `ageGroup = "Curvy Women"`
   - Verify: Products with `ageGroup = "Curvy Women"` are matched

---

## Verification Checklist

To ensure curvy-specific products are found:

- [ ] **Check Database**: Products are tagged with `ageGroup = "Curvy Women"` (or similar)
- [ ] **Ontology**: "Curvy Women" is added to `LOVESHACKFANCY_ONTOLOGY.ageGroups`
- [ ] **Normalization**: "curvy women" → "Curvy Women" (preserved, not normalized to "Adult")
- [ ] **SQL Filtering**: SQL WHERE clause uses `ageGroup = "Curvy Women"` when query contains "curvy women"
- [ ] **Constraint Matching**: Products with `ageGroup = "Curvy Women"` match queries with `ageGroups: ["Curvy Women"]`
- [ ] **Test Query**: "I am a curvy mom, suggest me a dress" returns curvy-specific products

---

## Summary

**Current Issue**: 
- "curvy women" queries → normalized to "Adult" → loses "curvy" descriptor
- Products tagged `ageGroup = "Curvy Women"` won't match "Adult" queries
- "Curvy Women" not in ontology → filtered out during validation

**Solution**: 
- Add "Curvy Women" to ontology
- Update normalization to preserve "Curvy Women"
- Ensure products are tagged correctly in database

**Key Files to Check**:
- `src/lib/loveshackfancy/ontology.ts` - Add "Curvy Women" to `ageGroups`
- `src/lib/loveshackfancy/age-group-normalizer.ts` - Update mapping to preserve "Curvy Women"
- Database schema (`prisma/schema.prisma`) - Verify `ageGroup` column supports "Curvy Women"
- Product data - Verify products are tagged with `ageGroup = "Curvy Women"`
