# Search Failure Analysis

## Problem Summary

Query: **"I need a dress for a hot humid day in Miami. Something that won't make me sweat."**

**Result**: 0 products found across all search tiers (strict → relaxed → pure vector)

---

## Root Causes

### 1. Category Name Mismatch ❌

**Issue**: Category classifier returns `"Women's Dresses"` but database has:
- `"Mini Dresses"`
- `"Maxi Dresses"`
- `"Midi Dresses"`
- `"Decker Heritage Dress"`
- etc.

**Current Matching Logic** (in `deduplicateProductsByCategory`):
```sql
LOWER(p."category") = LOWER('Women\'s Dresses') 
OR LOWER(p."category") LIKE LOWER('%Women\'s Dresses%')
```

**Why It Fails**:
- `"Mini Dresses"` does NOT contain `"Women's Dresses"`
- `"Maxi Dresses"` does NOT contain `"Women's Dresses"`
- The LIKE pattern `%Women's Dresses%` requires the full phrase

**Evidence from Logs**:
```
categories: [ "Women's Dresses" ]
deduplicateProductsByCategory: results found, count: 0
```

**Evidence from Database**:
- 243 products match pattern `category LIKE '%Dress%'`
- 0 products match pattern `category LIKE '%Women's Dresses%'`

---

### 2. Enriched Attributes Not Used ❌

**Issue**: Query mentions "hot humid day" but enriched attributes are NOT filtered in `deduplicateProductsByCategory`.

**Expected Behavior**:
- `extractIntentConstraints()` should extract:
  - `temperatureIntent: "Warm Weather"`
  - `humidityFriendly: true`
- These should be passed to `deduplicateProductsByCategory` as SQL filters

**Current Behavior**:
- `extractIntentConstraints()` extracts enriched attributes ✅
- But `deduplicateProductsByCategory` only filters by:
  - Category
  - Stock status
  - Price
  - Colors (JSON attributes)
  - Age groups (JSON attributes)
- **NOT** by enriched indexed columns:
  - `temperatureIntent`
  - `humidityFriendly`
  - `formalityLevel`
  - `problemSolutions`
  - `functionFeatures`
  - etc.

**Code Location**:
- `src/lib/search/vector/index.ts` → `deduplicateProductsByCategory()`
- `src/lib/loveshackfancy/retrieval.ts` → `multiViewRetrieval()` → calls `deduplicateProductsByCategory()`

---

### 3. Category Expansion Not Applied ❌

**Issue**: The main search pipeline (`src/lib/search/index.ts`) has category expansion logic via `buildBroadWhereFilters()`, but the LoveShackFancy pipeline uses `deduplicateProductsByCategory()` which doesn't expand categories.

**Main Search Pipeline** (works correctly):
- Uses `expandCanonicalToDbCategories()` to map "Women's Dresses" → ["Mini Dresses", "Maxi Dresses", etc.]
- Uses `categoryOr` conditions for flexible matching

**LoveShackFancy Pipeline** (broken):
- Uses `deduplicateProductsByCategory()` directly with category name
- No category expansion
- No `categoryOr` conditions

---

## Solutions

### Solution 1: Fix Category Matching in `deduplicateProductsByCategory` ✅ (Recommended)

**Option A**: Split category name and match on individual words
```typescript
// If category is "Women's Dresses", split into ["Women", "Dress"]
// Match if category contains ANY of these words
const categoryWords = category.split(/[\s'-]+/).filter(w => w.length > 2);
// Match: category LIKE '%Women%' AND category LIKE '%Dress%'
```

**Option B**: Use category expansion (like main search pipeline)
```typescript
import { expandCanonicalToDbCategories } from '../category-mapping';
const expandedCategories = expandCanonicalToDbCategories(category, categoryProfile);
// Use expandedCategories for matching
```

**Option C**: More flexible LIKE matching
```sql
-- Match if category contains "Dress" (case-insensitive)
LOWER(p."category") LIKE '%dress%'
OR LOWER(p."subcategory") LIKE '%dress%'
```

---

### Solution 2: Add Enriched Attribute Filtering to `deduplicateProductsByCategory` ✅ (Critical)

**Add to function signature**:
```typescript
export async function deduplicateProductsByCategory(
  filters?: {
    // ... existing filters ...
    temperatureIntent?: string;
    humidityFriendly?: boolean;
    formalityLevel?: string[];
    problemSolutions?: string[];
    functionFeatures?: string[];
    // ... other enriched attributes ...
  },
  // ... rest of params ...
)
```

**Add to WHERE clause**:
```sql
-- Temperature intent
IF filters.temperatureIntent THEN
  WHERE p."temperatureIntent" = filters.temperatureIntent
END IF

-- Humidity friendly
IF filters.humidityFriendly IS NOT NULL THEN
  WHERE p."humidityFriendly" = filters.humidityFriendly
END IF

-- Problem solutions (array overlap)
IF filters.problemSolutions THEN
  WHERE p."problemSolutions" && filters.problemSolutions::text[]
END IF

-- Function features (array overlap)
IF filters.functionFeatures THEN
  WHERE p."functionFeatures" && filters.functionFeatures::text[]
END IF
```

**Update call site** in `src/lib/loveshackfancy/retrieval.ts`:
```typescript
const intentConstraints = extractIntentConstraints(query, searchConstraints);

const productIdsToSearch = await deduplicateProductsByCategory(
  {
    // ... existing filters ...
    temperatureIntent: intentConstraints.temperatureIntent,
    humidityFriendly: intentConstraints.humidityFriendly,
    formalityLevel: intentConstraints.formalityLevel,
    problemSolutions: intentConstraints.problemSolutions,
    functionFeatures: intentConstraints.functionFeatures,
    // ... other enriched attributes ...
  },
  // ... rest of params ...
);
```

---

### Solution 3: Use Main Search Pipeline Instead ✅ (Alternative)

**Option**: Instead of using `deduplicateProductsByCategory` + vector search, use the main `searchProducts()` function which:
- ✅ Has category expansion
- ✅ Uses enriched attributes (via `buildBroadWhereFilters`)
- ✅ Has proper constraint relaxation
- ✅ Uses `dbRankedSearch` with enriched attribute boosts

**Trade-off**: Would need to integrate vector search results with main search results.

---

## Recommended Fix Priority

1. **HIGH**: Fix category matching in `deduplicateProductsByCategory` (Solution 1)
   - This will immediately fix the 0 results issue
   - Quick fix: Use flexible word-based matching

2. **CRITICAL**: Add enriched attribute filtering (Solution 2)
   - This will enable filtering by "hot humid day" → `temperatureIntent` + `humidityFriendly`
   - Required for accurate product discovery

3. **MEDIUM**: Consider using main search pipeline (Solution 3)
   - Would unify search logic
   - More complex refactoring

---

## Verification Steps

After fixes, verify:

1. **Category Matching**:
   ```typescript
   // Query: "I need a dress"
   // Should find products in "Mini Dresses", "Maxi Dresses", etc.
   ```

2. **Enriched Attributes**:
   ```typescript
   // Query: "hot humid day"
   // Should filter by temperatureIntent = "Warm Weather" AND humidityFriendly = true
   ```

3. **Combined**:
   ```typescript
   // Query: "I need a dress for a hot humid day"
   // Should find dresses with:
   //   - Category contains "Dress"
   //   - temperatureIntent = "Warm Weather"
   //   - humidityFriendly = true
   ```

---

## Current Database State

- **Total products**: 1,101
- **In-stock products**: 1,100
- **Products with enriched data**: 1,071
- **Dress-related products**: 243 (when matching `category LIKE '%Dress%'`)
- **Products matching "Women's Dresses"**: 0 (exact phrase doesn't exist)

---

## Related Files

- `src/lib/search/vector/index.ts` - `deduplicateProductsByCategory()`
- `src/lib/loveshackfancy/retrieval.ts` - `multiViewRetrieval()`
- `src/lib/search/intent/extractIntent.ts` - `extractIntentConstraints()`
- `src/lib/search/query/buildFilters.ts` - Category expansion (main pipeline)
- `src/lib/search/index.ts` - Main search pipeline (works correctly)




