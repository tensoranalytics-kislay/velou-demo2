# Post-SQL Filtration Plan

## Overview

Currently, the system applies all filters (category, color, length, etc.) simultaneously in a single SQL query. The proposed change is to implement a **two-stage filtration approach**:

1. **Stage 1 (SQL)**: Filter by category/subcategory only → Get candidate product set
2. **Stage 2 (Post-SQL)**: Build category-specific dictionaries for colors and lengths from the candidate set, then apply color/length filters using those dictionaries

This approach ensures that color and length filters only use values that actually exist in the category-filtered product set, preventing false negatives and improving relevance.

---

## Current Architecture Analysis

### Current Flow
```
User Query → Classification → All Constraints (colors, lengths, categories, ageGroups)
                                    ↓
                        Single SQL Query with all filters:
                        - category/subcategory (OR conditions)
                        - colors (enriched_color + legacy color)
                        - lengths (length column + JSONB attributes)
                        - ageGroups (ageGroup column + JSONB attributes)
                        - price (priceMinCents, priceMaxCents)
                                    ↓
                        Deduplication → Vector Search → Ranking
```

### Proposed Flow
```
User Query → Classification → Initial Constraints
                                    ↓
                        Stage 1: Category-only SQL Filter
                        - category/subcategory (OR conditions)
                        - ageGroups (hard filter - always applicable)
                        - price (if specified)
                        - stockStatus, isActive, merchantId (always)
                                    ↓
                        Category-Filtered Product Set
                        (N products, typically 50-500 for specific categories)
                                    ↓
                        Stage 2: Build Category-Specific Dictionaries
                        - Extract unique colors from candidate set
                        - Extract unique lengths from candidate set
                        - Build lookup maps: category → available colors/lengths
                                    ↓
                        Stage 3: Apply Color/Length Filters Using Category Dictionaries
                        - Filter candidate set by color (using category-specific color dictionary)
                        - Filter candidate set by length (using category-specific length dictionary)
                        - Handle case-insensitive matching
                        - Handle enriched_color comma-separated values
                                    ↓
                        Filtered Candidate Set
                                    ↓
                        Deduplication → Vector Search → Ranking
```

---

## Detailed Implementation Plan

### Phase 1: Category-Only SQL Filtering

**Location**: `src/lib/search/vector/index.ts` - `deduplicateProductsByCategory`

**Changes**:
1. Add a new parameter `postFilterMode?: boolean` (default: `false` for backward compatibility)
2. When `postFilterMode = true`, **skip** color and length filters in SQL
3. Only apply:
   - Category/subcategory filters (OR conditions)
   - Age group filters (hard filter - always applicable)
   - Price filters (if specified)
   - Always-applied filters (merchantId, isActive, stockStatus)

**New Function**: `deduplicateProductsByCategoryForPostFiltering`
```typescript
async function deduplicateProductsByCategoryForPostFiltering(
  filters?: { 
    categories?: string[];
    ageGroups?: string[];
    priceMinCents?: number;
    priceMaxCents?: number;
    merchantId?: string;
    inStockOnly?: boolean;
  },
  limit: number = 1500
): Promise<string[]>
```

**SQL Query Structure** (when `postFilterMode = true`):
```sql
SELECT p.id as "productId", ...
FROM "Product" p
WHERE p."isActive" = true 
  AND p."merchantId" = $1
  AND p."stockStatus" = 'in_stock'
  AND (
    -- Category/subcategory OR conditions (existing logic)
    (LOWER(p."category") = LOWER($2) OR LOWER(p."category") LIKE LOWER($3)
     OR LOWER(COALESCE(p."subcategory", '')) = LOWER($2) 
     OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($3))
    OR ...
  )
  AND (
    -- Age group filter (existing logic)
    ...
  )
  AND (
    -- Price filters (if specified)
    ...
  )
-- NOTE: Color and length filters are INTENTIONALLY OMITTED here
LIMIT $N
```

---

### Phase 2: Build Category-Specific Dictionaries

**Location**: New file `src/lib/search/filtering/category-dictionaries.ts`

**Function**: `buildCategorySpecificDictionaries`

```typescript
export type CategoryDictionary = {
  category: string;
  subcategory: string | null;
  availableColors: Set<string>; // Lowercase normalized colors
  availableLengths: Set<string>; // Lowercase normalized lengths
  productCount: number;
};

export type CategoryDictionaryMap = Map<string, CategoryDictionary>; // Key: "category|subcategory" or "category|"

async function buildCategorySpecificDictionaries(
  productIds: string[],
  merchantId: string
): Promise<CategoryDictionaryMap>
```

**Implementation Steps**:
1. Load products from database (only IDs, category, subcategory, enrichedColor, length)
2. Group products by `(category, subcategory)` combination
3. For each group:
   - Extract all unique colors from `enrichedColor` (split by comma, normalize)
   - Extract all unique colors from `color` column (fallback)
   - Extract all unique lengths from `length` column
   - Extract all unique lengths from `attributes->>'length'` or `attributes->>'Length'` (fallback)
   - Build normalized sets (lowercase, trimmed)
4. Return map: `"category|subcategory"` → `CategoryDictionary`

**SQL Query for Dictionary Building**:
```sql
SELECT 
  p.id,
  p."category",
  p."subcategory",
  p."enrichedColor",
  p."color",
  p."length",
  p.attributes->>'length' as attr_length,
  p.attributes->>'Length' as attr_Length_capital
FROM "Product" p
WHERE p.id = ANY(ARRAY[...]::text[])
  AND p."merchantId" = $1
  AND p."isActive" = true
```

**Color Extraction Logic**:
- Parse `enrichedColor`: Split by comma → trim → lowercase → deduplicate
- Parse `color` column: lowercase → deduplicate
- Combine into single set per category group
- Example: `"White, Bright White, Pure White"` → `["white", "bright white", "pure white"]`

**Length Extraction Logic**:
- Primary: `length` column (if not null)
- Fallback: `attributes->>'length'` or `attributes->>'Length'` (case-insensitive)
- Normalize: lowercase, trim
- Deduplicate per category group

---

### Phase 3: Post-SQL Color/Length Filtering

**Location**: New file `src/lib/search/filtering/post-filter.ts`

**Function**: `applyPostSQLFilters`

```typescript
export async function applyPostSQLFilters(
  productIds: string[],
  filters: {
    colors?: string[];
    lengths?: string[];
  },
  categoryDictionaries: CategoryDictionaryMap
): Promise<string[]>
```

**Filtering Logic**:

#### Color Filtering:
1. For each product ID:
   - Get product's category/subcategory
   - Look up category dictionary: `categoryDictionaries.get("category|subcategory")`
   - If dictionary exists:
     - Get product's colors (from `enrichedColor` + `color` column)
     - Normalize query colors (lowercase, trim)
     - Check if ANY query color matches ANY product color:
       - Exact match: `productColor === queryColor`
       - Partial match: `productColor.includes(queryColor)` OR `queryColor.includes(productColor)`
       - For enriched_color: Split by comma, check each term
   - If dictionary doesn't exist (fallback), use existing color matching logic
   - Keep product if color match found

#### Length Filtering:
1. For each product ID:
   - Get product's category/subcategory
   - Look up category dictionary
   - Get product's length (from `length` column or JSONB attributes)
   - Normalize query length (lowercase, trim)
   - Check if query length matches product length:
     - Exact match: `productLength === queryLength` (case-insensitive)
     - Use dictionary to validate that the query length exists in that category
   - Keep product if length match found

**Edge Cases**:
- If category dictionary is empty for a category → fall back to existing global matching
- If query color/length not found in dictionary → exclude product (strict filtering)
- Handle NULL values gracefully (skip NULL colors/lengths in dictionary building)

---

### Phase 4: Integration into Retrieval Pipeline

**Location**: `src/lib/loveshackfancy/retrieval.ts` - `multiViewRetrieval`

**Changes**:
1. Add feature flag: `USE_POST_SQL_FILTERING = process.env.ENABLE_POST_SQL_FILTERING === 'true'`
2. When enabled:
   - Call `deduplicateProductsByCategoryForPostFiltering` (skip colors/lengths in SQL)
   - Call `buildCategorySpecificDictionaries` with category-filtered product IDs
   - Call `applyPostSQLFilters` with colors/lengths constraints
   - Pass filtered product IDs to `searchVectorIndexWithDeduplication`
3. When disabled (default):
   - Use existing flow (all filters in SQL)

**New Function Signature**:
```typescript
export async function multiViewRetrievalWithPostFiltering(
  query: string,
  classification: QueryClassification,
  // ... existing params
  usePostSQLFiltering: boolean = false
): Promise<MultiViewRetrievalResult>
```

**Flow Integration**:
```typescript
// TIER 1: Strict filtering with post-SQL color/length filtering
if (expandedCategories && expandedCategories.length > 0) {
  // Stage 1: Category-only SQL filter
  const categoryFilteredIds = await deduplicateProductsByCategoryForPostFiltering({
    categories: expandedCategories,
    ageGroups: contextAware.sqlFilters.ageGroups,
    priceMinCents: contextAware.sqlFilters.priceMinCents,
    priceMaxCents: contextAware.sqlFilters.priceMaxCents,
    merchantId,
    inStockOnly: true,
  }, 1500);
  
  // Stage 2: Build category-specific dictionaries
  const categoryDictionaries = await buildCategorySpecificDictionaries(
    categoryFilteredIds,
    merchantId
  );
  
  // Stage 3: Apply post-SQL color/length filters
  const postFilteredIds = await applyPostSQLFilters(
    categoryFilteredIds,
    {
      colors: contextAware.sqlFilters.colors,
      lengths: contextAware.sqlFilters.lengths,
    },
    categoryDictionaries
  );
  
  // Stage 4: Vector search on post-filtered IDs
  if (postFilteredIds.length > 0) {
    result = await searchVectorIndexWithDeduplication(
      queryEmbedding,
      150,
      {
        inStockOnly: true,
        merchantId,
        categories: undefined, // Already filtered
        ageGroups: contextAware.sqlFilters.ageGroups, // Still apply age group filter
        // NOTE: colors and lengths are NOT in SQL filters anymore
      },
      undefined,
      postFilteredIds // Pre-filtered product IDs
    );
  }
}
```

---

## Column Audit: SQL Filtration Candidates

### ✅ Currently Used as Hard SQL Filters

1. **`merchantId`** - Always applied (multi-tenant)
2. **`isActive`** - Always applied
3. **`stockStatus`** - Always applied (default: `'in_stock'`)
4. **`category`** - Hard filter with subcategory matching
5. **`subcategory`** - Hard filter (checked alongside category)
6. **`ageGroup`** - Hard filter (column + JSONB fallback)
7. **`length`** - Hard filter (just implemented)
8. **`priceCents`** - Hard filter (priceMinCents, priceMaxCents)

### ✅ Currently Used as Soft Ranking (Should Consider for Hard Filtering)

9. **`formalityLevel`** - String (Casual, Semi-Formal, Formal)
   - **Candidate for Post-SQL**: Yes - category-specific dictionaries make sense
   - **Current Usage**: Soft ranking in `dbRankedSearch.ts`
   - **Values in Dataset**: Need to audit distinct values

10. **`temperatureIntent`** - String (Warm Weather, Cool Weather, etc.)
    - **Candidate for Post-SQL**: Yes - weather filters are category-specific
    - **Current Usage**: Soft ranking
    - **Values**: "Warm Weather", "Cool Weather", "All-Weather" (need audit)

11. **`humidityFriendly`** - Boolean
    - **Candidate for Post-SQL**: Yes - boolean filters are straightforward
    - **Current Usage**: Soft ranking
    - **Values**: true/false

12. **`occasionContext`** - String[] (array, uses GIN index)
    - **Candidate for Post-SQL**: Yes - occasions vary by category
    - **Current Usage**: Soft ranking with `&&` array overlap
    - **Values**: Need to audit distinct array values

13. **`problemSolutions`** - String[] (array, uses GIN index)
    - **Candidate for Post-SQL**: Yes - problem solutions are category-specific
    - **Current Usage**: Soft ranking with `&&` array overlap
    - **Values**: Need to audit distinct array values

14. **`functionFeatures`** - String[] (array, uses GIN index)
    - **Candidate for Post-SQL**: Yes - features vary by category
    - **Current Usage**: Soft ranking with `&&` array overlap
    - **Values**: Need to audit distinct array values

15. **`colorShade`** - String (Light, Medium, Dark)
    - **Candidate for Post-SQL**: Yes - should work with color filtering
    - **Current Usage**: Soft ranking
    - **Values**: "Light", "Medium", "Dark" (need audit)

16. **`colorUndertone`** - String (Warm, Cool, Neutral)
    - **Candidate for Post-SQL**: Yes - should work with color filtering
    - **Current Usage**: Soft ranking
    - **Values**: "Warm", "Cool", "Neutral" (need audit)

17. **`multicolor`** - Boolean
    - **Candidate for Post-SQL**: Yes - boolean filters are straightforward
    - **Current Usage**: Soft ranking
    - **Values**: true/false

### 🔍 Potential Candidates (Not Currently Used in SQL Filters)

18. **`enrichedColor`** - String (comma-separated)
    - **Already Used**: Yes - in color filtering logic
    - **Note**: Should be included in category-specific color dictionary

19. **`sleeve`** - String (Short, Long, Sleeveless, etc.)
    - **Candidate for Post-SQL**: Yes - sleeve types are category-specific
    - **Values in Dataset**: "Short", "Long", "Sleeveless", "Three-Quarter", "Flutter", etc.
    - **SQL Filter Complexity**: Medium (needs normalization)

20. **`neckline`** - String (Round, V-Neck, Scoop, etc.)
    - **Candidate for Post-SQL**: Yes - necklines are category-specific
    - **Values in Dataset**: "Round", "V-Neck", "Scoop", "Square", "Boat", etc.
    - **SQL Filter Complexity**: Medium (needs normalization)

21. **`silhouetteCut`** - String (A-Line, Empire, Relaxed, etc.)
    - **Candidate for Post-SQL**: Maybe - useful for dresses/tops
    - **Values**: Need to audit category distribution
    - **SQL Filter Complexity**: Low (simple string match)

22. **`fabricFamily`** - String (Cotton, Silk, Wool, etc.)
    - **Candidate for Post-SQL**: Yes - fabrics vary by category
    - **Current Usage**: Stored but not actively filtered
    - **Values**: Need to audit distinct values
    - **SQL Filter Complexity**: Low

23. **`material`** - String (legacy column, indexed)
    - **Candidate for Post-SQL**: Yes - similar to fabricFamily
    - **Current Usage**: Stored, available for filtering
    - **Note**: May overlap with `fabricFamily` - need consolidation strategy

24. **`brand`** - String (indexed)
    - **Candidate for Post-SQL**: Yes - brands are category-specific
    - **Current Usage**: Stored, available for filtering
    - **SQL Filter Complexity**: Low (exact match)

25. **`seasonalPalette`** - String (Spring, Summer, Fall, Winter)
    - **Candidate for Post-SQL**: Yes - seasonal filters make sense
    - **Current Usage**: Soft ranking
    - **Values**: Need to audit distinct values

26. **`fitPreference`** - String (Runs Large, Runs Small, Regular)
    - **Candidate for Post-SQL**: Maybe - more relevant for ranking than filtering
    - **SQL Filter Complexity**: Low

27. **`lined`** - Boolean
    - **Candidate for Post-SQL**: Yes - boolean filters are straightforward
    - **Current Usage**: Stored but not filtered
    - **Values**: true/false

28. **`breathability`** - String (Highly Breathable, Breathable, etc.)
    - **Candidate for Post-SQL**: Maybe - useful for weather/comfort queries
    - **SQL Filter Complexity**: Medium (needs value mapping)

29. **`warmthWeight`** - String (Lightweight, Midweight, Heavyweight)
    - **Candidate for Post-SQL**: Yes - useful for temperature intent
    - **SQL Filter Complexity**: Low

30. **`seasonalCues`** - String (Spring, Summer, Fall, Winter)
    - **Candidate for Post-SQL**: Yes - similar to seasonalPalette
    - **Note**: May overlap with `seasonalPalette` - need consolidation strategy

### ❌ Not Recommended for SQL Filtration (Soft Ranking Only)

31. **`occasion`** - String (legacy column, indexed but sparse)
    - **Reason**: Use `occasionContext` array instead (more comprehensive)

32. **`season`** - String (legacy column, indexed but sparse)
    - **Reason**: Use `seasonalPalette` or `seasonalCues` instead

33. **`fit`** - String (legacy column, indexed but sparse)
    - **Reason**: Too vague, use `fitPreference` or `bodyIntent` instead

34. **`comfortIntent`** - String
    - **Reason**: Subjective, better for ranking than filtering

35. **`bodyIntent`** - String
    - **Reason**: Subjective, better for ranking than filtering

36. **`handfeel`** - String
    - **Reason**: Too subjective, better for ranking

37. **`opacity`** - String
    - **Reason**: Too specific, rarely queried directly

38. **`wrinkleBehavior`** - String
    - **Reason**: Too specific, rarely queried directly

39. **`closureConstruction`** - String
    - **Reason**: Too specific, rarely queried directly

---

## Category-Specific Dictionary Requirements

### Dictionary Keys
- **Primary Key**: `"${category}|${subcategory}"` (e.g., `"Women's Dresses|Maxi Dresses"`)
- **Fallback Key**: `"${category}|"` (when subcategory is null, e.g., `"Women's Dresses|"`)
- **Wildcard Key**: `"*|*"` (global fallback if category-specific dictionary is empty)

### Dictionary Values Structure
```typescript
type CategoryDictionary = {
  category: string;
  subcategory: string | null;
  
  // Color dictionary (normalized lowercase)
  availableColors: Set<string>; // e.g., {"white", "ivory", "cream", "blue", "navy"}
  colorFrequency: Map<string, number>; // Count how many products have each color
  
  // Length dictionary (normalized lowercase)
  availableLengths: Set<string>; // e.g., {"mini", "midi", "maxi", "cropped"}
  lengthFrequency: Map<string, number>; // Count how many products have each length
  
  // Additional attributes (for future expansion)
  availableSleeves?: Set<string>;
  availableNecklines?: Set<string>;
  availableFormalityLevels?: Set<string>;
  availableTemperatureIntents?: Set<string>;
  
  productCount: number; // Total products in this category group
};
```

### Dictionary Building Optimization
- **Caching**: Cache dictionaries per category/subcategory combination
- **Cache Key**: `"category-dict-${merchantId}-${category}-${subcategory}-${timestamp}"`
- **Cache TTL**: 1 hour (or until catalog ingestion runs)
- **Invalidation**: On catalog ingestion completion

### Dictionary Size Considerations
- For large categories (e.g., "Women's Dresses" with 500+ products):
  - Dictionary building may be expensive
  - Consider limiting to top 1000 products per category
  - Use sampling if category has >1000 products (sample 1000, build dictionary)
- For small categories (<50 products):
  - Dictionary building is cheap
  - Build full dictionary

---

## Edge Cases and Special Handling

### Case 1: Multiple Categories with Same Subcategory
**Example**: "Women's Dresses|Maxi Dresses" AND "Girls Dresses|Maxi Dresses"
- **Solution**: Build separate dictionaries for each category
- **Matching**: Use category-aware dictionary lookup

### Case 2: Query Specifies Multiple Categories
**Example**: Query classified as ["Women's Dresses", "Girls Dresses", "Tween Dresses"]
- **Solution**: Build dictionaries for each category
- **Filtering**: Apply color/length filters using UNION of all category dictionaries
- **Logic**: Product matches if it matches color/length in ANY of its category dictionaries

### Case 3: Category Has No Products After Stage 1 Filter
**Example**: "Maxi Dresses" category returns 0 products
- **Solution**: Return empty dictionary for that category
- **Behavior**: Post-filtering will return empty result (correct behavior)

### Case 4: Query Color/Length Not Found in Category Dictionary
**Example**: User searches for "purple maxi dresses" but category only has "blue, white, pink"
- **Solution**: Exclude product (strict filtering)
- **Alternative**: Could fall back to soft ranking if no strict matches found

### Case 5: Product Has NULL category or subcategory
**Example**: Product.category = "Women's Dresses", Product.subcategory = NULL
- **Solution**: Use key `"Women's Dresses|"` for dictionary lookup
- **Fallback**: If dictionary not found, use global fallback

### Case 6: Enriched Color Contains Multiple Terms
**Example**: `enrichedColor = "Royal Blue, Whisper Blue, Blue"`
- **Solution**: Split by comma, normalize each term, add all to dictionary
- **Matching**: If query is "blue", match if ANY term contains "blue" (exact or partial)
- **Scoring**: Products with more "blue" mentions get higher priority (already implemented)

### Case 7: Category Expansion (Maxi Dress → Women's Dresses)
**Example**: Query classified as "Maxi Dress" but expanded to ["Maxi Dress", "Women's Dresses"]
- **Solution**: Build dictionaries for both categories
- **Filtering**: For products in "Women's Dresses" category, check if they match "Maxi" length in that category's dictionary
- **Logic**: Category expansion should happen BEFORE dictionary building

---

## Performance Considerations

### Dictionary Building Performance
- **Expected Time**: 50-200ms for 500 products (single query)
- **Optimization**: Use `SELECT id, category, subcategory, enrichedColor, color, length, attributes` in single query
- **Memory**: ~1-5MB per category dictionary (for 500 products)

### Post-Filtering Performance
- **Expected Time**: 10-50ms for 500 products (in-memory filtering)
- **Optimization**: Use Set lookups (O(1) average case)
- **Memory**: Minimal (product IDs only)

### Overall Impact
- **Stage 1 (Category SQL)**: ~20-100ms (similar to current)
- **Stage 2 (Dictionary Building)**: ~50-200ms (NEW - one-time per category)
- **Stage 3 (Post-Filtering)**: ~10-50ms (NEW - per query)
- **Stage 4 (Vector Search)**: ~50-200ms (same as current, but on fewer products)

**Total Additional Latency**: ~60-250ms per query (acceptable for improved accuracy)

### Caching Strategy
- **Cache Dictionaries**: Store in Redis/memory cache with 1-hour TTL
- **Cache Key Format**: `"category-dict:${merchantId}:${category}:${subcategory}"`
- **Cache Invalidation**: On catalog ingestion, or manual refresh endpoint
- **Cache Warming**: Pre-build dictionaries for top 10 categories on startup

---

## Testing Strategy

### Unit Tests
1. **Dictionary Building**:
   - Test with products having various `enrichedColor` formats
   - Test with NULL values
   - Test with multiple categories/subcategories
   - Test with empty product sets

2. **Post-Filtering**:
   - Test color matching (exact, partial, comma-separated)
   - Test length matching (exact, case-insensitive)
   - Test category dictionary lookup (exact match, fallback)
   - Test edge cases (NULL values, missing dictionaries)

### Integration Tests
1. **End-to-End Flow**:
   - Query: "blue maxi dresses for kids"
   - Verify: Stage 1 returns category-filtered products
   - Verify: Dictionary contains only colors/lengths from category
   - Verify: Post-filtering excludes products not matching color/length
   - Verify: Final results match expected products

2. **Category-Specific Queries**:
   - "red cardigans" (Tops category)
   - "white mini dresses" (Dresses category)
   - "black maxi skirts" (Bottoms category)
   - Verify: Each category uses its own dictionary

### Performance Tests
1. **Large Category Test**:
   - Category with 1000+ products
   - Measure dictionary building time
   - Measure post-filtering time
   - Verify: Total time < 300ms

2. **Multiple Category Test**:
   - Query with 3 categories
   - Build 3 dictionaries
   - Measure total time
   - Verify: Parallel dictionary building (if possible)

---

## Rollout Plan

### Phase 1: Implementation (Week 1)
- [ ] Implement `deduplicateProductsByCategoryForPostFiltering`
- [ ] Implement `buildCategorySpecificDictionaries`
- [ ] Implement `applyPostSQLFilters`
- [ ] Add unit tests

### Phase 2: Integration (Week 1)
- [ ] Integrate into `multiViewRetrieval`
- [ ] Add feature flag `ENABLE_POST_SQL_FILTERING`
- [ ] Add integration tests
- [ ] Add logging for dictionary building and post-filtering

### Phase 3: Testing (Week 2)
- [ ] Test with real queries on staging
- [ ] Performance benchmarking
- [ ] Compare results with/without post-SQL filtering
- [ ] Fix edge cases

### Phase 4: Gradual Rollout (Week 2-3)
- [ ] Enable for 10% of queries (A/B test)
- [ ] Monitor performance and accuracy
- [ ] Enable for 50% of queries
- [ ] Enable for 100% of queries

### Phase 5: Optimization (Week 3-4)
- [ ] Implement dictionary caching
- [ ] Optimize dictionary building queries
- [ ] Add cache warming on startup
- [ ] Monitor cache hit rates

---

## Additional Columns Audit Summary

### Recommended for Post-SQL Filtration (Priority Order)

#### Tier 1 (High Priority - Already Have Data)
1. **`colors`** (via `enrichedColor` + `color`) - ✅ Implemented in plan
2. **`lengths`** (via `length` column) - ✅ Implemented in plan
3. **`sleeve`** - High value for tops/dresses queries
4. **`neckline`** - High value for tops/dresses queries
5. **`formalityLevel`** - High value for occasion-based queries

#### Tier 2 (Medium Priority - Good Coverage)
6. **`temperatureIntent`** - Useful for weather queries
7. **`humidityFriendly`** - Boolean, easy to filter
8. **`occasionContext`** - Array, needs GIN index handling
9. **`fabricFamily`** - Useful for material queries
10. **`brand`** - Useful for brand-specific queries

#### Tier 3 (Lower Priority - Niche Use Cases)
11. **`silhouetteCut`** - Useful for dresses/tops
12. **`colorShade`** - Useful for color refinement
13. **`colorUndertone`** - Useful for color refinement
14. **`seasonalPalette`** - Useful for seasonal queries
15. **`lined`** - Boolean, easy but rarely queried

### Not Recommended for Post-SQL Filtration
- **Subjective attributes** (`comfortIntent`, `bodyIntent`, `handfeel`) - Better for ranking
- **Very specific attributes** (`opacity`, `wrinkleBehavior`, `closureConstruction`) - Rarely queried directly
- **Legacy sparse columns** (`occasion`, `season`, `fit`) - Use enriched alternatives instead

---

## Future Enhancements

### Phase 2: Expand to Additional Attributes
- Implement post-SQL filtering for `sleeve`, `neckline`, `formalityLevel`
- Implement dictionary building for these attributes
- Update `CategoryDictionary` type to include new attributes

### Phase 3: Dictionary Precomputation
- Precompute dictionaries during catalog ingestion
- Store dictionaries in database table: `CategoryDictionary`
- Refresh dictionaries on catalog update

### Phase 4: Dictionary Analytics
- Track dictionary usage (which categories are queried most)
- Track dictionary effectiveness (how often dictionaries reduce result sets)
- Optimize dictionary building based on usage patterns

---

## Risk Assessment

### Risks
1. **Performance Degradation**: Additional 60-250ms latency per query
   - **Mitigation**: Implement caching, optimize queries, monitor performance

2. **Dictionary Building Failures**: If dictionary building fails, fall back to existing flow
   - **Mitigation**: Add try-catch, fallback to global filtering

3. **Category Dictionary Misses**: If category has no dictionary, products may be incorrectly filtered
   - **Mitigation**: Always build fallback global dictionary, log misses

4. **Memory Usage**: Large dictionaries for big categories
   - **Mitigation**: Limit dictionary size, use sampling for large categories

### Benefits
1. **Improved Accuracy**: Color/length filters only use values that exist in category
2. **Reduced False Negatives**: Products won't be excluded due to global dictionary mismatches
3. **Better Relevance**: Category-specific filtering ensures more relevant results
4. **Scalability**: Can extend to other attributes (sleeve, neckline, etc.)

---

## Questions to Resolve

1. **Dictionary Caching**: Should we cache dictionaries in Redis or in-memory?
   - **Recommendation**: Start with in-memory cache, move to Redis if needed

2. **Dictionary Refresh Frequency**: How often should dictionaries be rebuilt?
   - **Recommendation**: On catalog ingestion + 1-hour TTL

3. **Fallback Strategy**: If dictionary building fails, use global filtering or return empty results?
   - **Recommendation**: Fall back to global filtering with logging

4. **Multiple Category Handling**: Should we build separate dictionaries or merge?
   - **Recommendation**: Build separate dictionaries, apply filters using UNION logic

5. **Dictionary Size Limits**: Should we limit dictionary size for large categories?
   - **Recommendation**: Yes, sample 1000 products for categories with >1000 products



## Overview

Currently, the system applies all filters (category, color, length, etc.) simultaneously in a single SQL query. The proposed change is to implement a **two-stage filtration approach**:

1. **Stage 1 (SQL)**: Filter by category/subcategory only → Get candidate product set
2. **Stage 2 (Post-SQL)**: Build category-specific dictionaries for colors and lengths from the candidate set, then apply color/length filters using those dictionaries

This approach ensures that color and length filters only use values that actually exist in the category-filtered product set, preventing false negatives and improving relevance.

---

## Current Architecture Analysis

### Current Flow
```
User Query → Classification → All Constraints (colors, lengths, categories, ageGroups)
                                    ↓
                        Single SQL Query with all filters:
                        - category/subcategory (OR conditions)
                        - colors (enriched_color + legacy color)
                        - lengths (length column + JSONB attributes)
                        - ageGroups (ageGroup column + JSONB attributes)
                        - price (priceMinCents, priceMaxCents)
                                    ↓
                        Deduplication → Vector Search → Ranking
```

### Proposed Flow
```
User Query → Classification → Initial Constraints
                                    ↓
                        Stage 1: Category-only SQL Filter
                        - category/subcategory (OR conditions)
                        - ageGroups (hard filter - always applicable)
                        - price (if specified)
                        - stockStatus, isActive, merchantId (always)
                                    ↓
                        Category-Filtered Product Set
                        (N products, typically 50-500 for specific categories)
                                    ↓
                        Stage 2: Build Category-Specific Dictionaries
                        - Extract unique colors from candidate set
                        - Extract unique lengths from candidate set
                        - Build lookup maps: category → available colors/lengths
                                    ↓
                        Stage 3: Apply Color/Length Filters Using Category Dictionaries
                        - Filter candidate set by color (using category-specific color dictionary)
                        - Filter candidate set by length (using category-specific length dictionary)
                        - Handle case-insensitive matching
                        - Handle enriched_color comma-separated values
                                    ↓
                        Filtered Candidate Set
                                    ↓
                        Deduplication → Vector Search → Ranking
```

---

## Detailed Implementation Plan

### Phase 1: Category-Only SQL Filtering

**Location**: `src/lib/search/vector/index.ts` - `deduplicateProductsByCategory`

**Changes**:
1. Add a new parameter `postFilterMode?: boolean` (default: `false` for backward compatibility)
2. When `postFilterMode = true`, **skip** color and length filters in SQL
3. Only apply:
   - Category/subcategory filters (OR conditions)
   - Age group filters (hard filter - always applicable)
   - Price filters (if specified)
   - Always-applied filters (merchantId, isActive, stockStatus)

**New Function**: `deduplicateProductsByCategoryForPostFiltering`
```typescript
async function deduplicateProductsByCategoryForPostFiltering(
  filters?: { 
    categories?: string[];
    ageGroups?: string[];
    priceMinCents?: number;
    priceMaxCents?: number;
    merchantId?: string;
    inStockOnly?: boolean;
  },
  limit: number = 1500
): Promise<string[]>
```

**SQL Query Structure** (when `postFilterMode = true`):
```sql
SELECT p.id as "productId", ...
FROM "Product" p
WHERE p."isActive" = true 
  AND p."merchantId" = $1
  AND p."stockStatus" = 'in_stock'
  AND (
    -- Category/subcategory OR conditions (existing logic)
    (LOWER(p."category") = LOWER($2) OR LOWER(p."category") LIKE LOWER($3)
     OR LOWER(COALESCE(p."subcategory", '')) = LOWER($2) 
     OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($3))
    OR ...
  )
  AND (
    -- Age group filter (existing logic)
    ...
  )
  AND (
    -- Price filters (if specified)
    ...
  )
-- NOTE: Color and length filters are INTENTIONALLY OMITTED here
LIMIT $N
```

---

### Phase 2: Build Category-Specific Dictionaries

**Location**: New file `src/lib/search/filtering/category-dictionaries.ts`

**Function**: `buildCategorySpecificDictionaries`

```typescript
export type CategoryDictionary = {
  category: string;
  subcategory: string | null;
  availableColors: Set<string>; // Lowercase normalized colors
  availableLengths: Set<string>; // Lowercase normalized lengths
  productCount: number;
};

export type CategoryDictionaryMap = Map<string, CategoryDictionary>; // Key: "category|subcategory" or "category|"

async function buildCategorySpecificDictionaries(
  productIds: string[],
  merchantId: string
): Promise<CategoryDictionaryMap>
```

**Implementation Steps**:
1. Load products from database (only IDs, category, subcategory, enrichedColor, length)
2. Group products by `(category, subcategory)` combination
3. For each group:
   - Extract all unique colors from `enrichedColor` (split by comma, normalize)
   - Extract all unique colors from `color` column (fallback)
   - Extract all unique lengths from `length` column
   - Extract all unique lengths from `attributes->>'length'` or `attributes->>'Length'` (fallback)
   - Build normalized sets (lowercase, trimmed)
4. Return map: `"category|subcategory"` → `CategoryDictionary`

**SQL Query for Dictionary Building**:
```sql
SELECT 
  p.id,
  p."category",
  p."subcategory",
  p."enrichedColor",
  p."color",
  p."length",
  p.attributes->>'length' as attr_length,
  p.attributes->>'Length' as attr_Length_capital
FROM "Product" p
WHERE p.id = ANY(ARRAY[...]::text[])
  AND p."merchantId" = $1
  AND p."isActive" = true
```

**Color Extraction Logic**:
- Parse `enrichedColor`: Split by comma → trim → lowercase → deduplicate
- Parse `color` column: lowercase → deduplicate
- Combine into single set per category group
- Example: `"White, Bright White, Pure White"` → `["white", "bright white", "pure white"]`

**Length Extraction Logic**:
- Primary: `length` column (if not null)
- Fallback: `attributes->>'length'` or `attributes->>'Length'` (case-insensitive)
- Normalize: lowercase, trim
- Deduplicate per category group

---

### Phase 3: Post-SQL Color/Length Filtering

**Location**: New file `src/lib/search/filtering/post-filter.ts`

**Function**: `applyPostSQLFilters`

```typescript
export async function applyPostSQLFilters(
  productIds: string[],
  filters: {
    colors?: string[];
    lengths?: string[];
  },
  categoryDictionaries: CategoryDictionaryMap
): Promise<string[]>
```

**Filtering Logic**:

#### Color Filtering:
1. For each product ID:
   - Get product's category/subcategory
   - Look up category dictionary: `categoryDictionaries.get("category|subcategory")`
   - If dictionary exists:
     - Get product's colors (from `enrichedColor` + `color` column)
     - Normalize query colors (lowercase, trim)
     - Check if ANY query color matches ANY product color:
       - Exact match: `productColor === queryColor`
       - Partial match: `productColor.includes(queryColor)` OR `queryColor.includes(productColor)`
       - For enriched_color: Split by comma, check each term
   - If dictionary doesn't exist (fallback), use existing color matching logic
   - Keep product if color match found

#### Length Filtering:
1. For each product ID:
   - Get product's category/subcategory
   - Look up category dictionary
   - Get product's length (from `length` column or JSONB attributes)
   - Normalize query length (lowercase, trim)
   - Check if query length matches product length:
     - Exact match: `productLength === queryLength` (case-insensitive)
     - Use dictionary to validate that the query length exists in that category
   - Keep product if length match found

**Edge Cases**:
- If category dictionary is empty for a category → fall back to existing global matching
- If query color/length not found in dictionary → exclude product (strict filtering)
- Handle NULL values gracefully (skip NULL colors/lengths in dictionary building)

---

### Phase 4: Integration into Retrieval Pipeline

**Location**: `src/lib/loveshackfancy/retrieval.ts` - `multiViewRetrieval`

**Changes**:
1. Add feature flag: `USE_POST_SQL_FILTERING = process.env.ENABLE_POST_SQL_FILTERING === 'true'`
2. When enabled:
   - Call `deduplicateProductsByCategoryForPostFiltering` (skip colors/lengths in SQL)
   - Call `buildCategorySpecificDictionaries` with category-filtered product IDs
   - Call `applyPostSQLFilters` with colors/lengths constraints
   - Pass filtered product IDs to `searchVectorIndexWithDeduplication`
3. When disabled (default):
   - Use existing flow (all filters in SQL)

**New Function Signature**:
```typescript
export async function multiViewRetrievalWithPostFiltering(
  query: string,
  classification: QueryClassification,
  // ... existing params
  usePostSQLFiltering: boolean = false
): Promise<MultiViewRetrievalResult>
```

**Flow Integration**:
```typescript
// TIER 1: Strict filtering with post-SQL color/length filtering
if (expandedCategories && expandedCategories.length > 0) {
  // Stage 1: Category-only SQL filter
  const categoryFilteredIds = await deduplicateProductsByCategoryForPostFiltering({
    categories: expandedCategories,
    ageGroups: contextAware.sqlFilters.ageGroups,
    priceMinCents: contextAware.sqlFilters.priceMinCents,
    priceMaxCents: contextAware.sqlFilters.priceMaxCents,
    merchantId,
    inStockOnly: true,
  }, 1500);
  
  // Stage 2: Build category-specific dictionaries
  const categoryDictionaries = await buildCategorySpecificDictionaries(
    categoryFilteredIds,
    merchantId
  );
  
  // Stage 3: Apply post-SQL color/length filters
  const postFilteredIds = await applyPostSQLFilters(
    categoryFilteredIds,
    {
      colors: contextAware.sqlFilters.colors,
      lengths: contextAware.sqlFilters.lengths,
    },
    categoryDictionaries
  );
  
  // Stage 4: Vector search on post-filtered IDs
  if (postFilteredIds.length > 0) {
    result = await searchVectorIndexWithDeduplication(
      queryEmbedding,
      150,
      {
        inStockOnly: true,
        merchantId,
        categories: undefined, // Already filtered
        ageGroups: contextAware.sqlFilters.ageGroups, // Still apply age group filter
        // NOTE: colors and lengths are NOT in SQL filters anymore
      },
      undefined,
      postFilteredIds // Pre-filtered product IDs
    );
  }
}
```

---

## Column Audit: SQL Filtration Candidates

### ✅ Currently Used as Hard SQL Filters

1. **`merchantId`** - Always applied (multi-tenant)
2. **`isActive`** - Always applied
3. **`stockStatus`** - Always applied (default: `'in_stock'`)
4. **`category`** - Hard filter with subcategory matching
5. **`subcategory`** - Hard filter (checked alongside category)
6. **`ageGroup`** - Hard filter (column + JSONB fallback)
7. **`length`** - Hard filter (just implemented)
8. **`priceCents`** - Hard filter (priceMinCents, priceMaxCents)

### ✅ Currently Used as Soft Ranking (Should Consider for Hard Filtering)

9. **`formalityLevel`** - String (Casual, Semi-Formal, Formal)
   - **Candidate for Post-SQL**: Yes - category-specific dictionaries make sense
   - **Current Usage**: Soft ranking in `dbRankedSearch.ts`
   - **Values in Dataset**: Need to audit distinct values

10. **`temperatureIntent`** - String (Warm Weather, Cool Weather, etc.)
    - **Candidate for Post-SQL**: Yes - weather filters are category-specific
    - **Current Usage**: Soft ranking
    - **Values**: "Warm Weather", "Cool Weather", "All-Weather" (need audit)

11. **`humidityFriendly`** - Boolean
    - **Candidate for Post-SQL**: Yes - boolean filters are straightforward
    - **Current Usage**: Soft ranking
    - **Values**: true/false

12. **`occasionContext`** - String[] (array, uses GIN index)
    - **Candidate for Post-SQL**: Yes - occasions vary by category
    - **Current Usage**: Soft ranking with `&&` array overlap
    - **Values**: Need to audit distinct array values

13. **`problemSolutions`** - String[] (array, uses GIN index)
    - **Candidate for Post-SQL**: Yes - problem solutions are category-specific
    - **Current Usage**: Soft ranking with `&&` array overlap
    - **Values**: Need to audit distinct array values

14. **`functionFeatures`** - String[] (array, uses GIN index)
    - **Candidate for Post-SQL**: Yes - features vary by category
    - **Current Usage**: Soft ranking with `&&` array overlap
    - **Values**: Need to audit distinct array values

15. **`colorShade`** - String (Light, Medium, Dark)
    - **Candidate for Post-SQL**: Yes - should work with color filtering
    - **Current Usage**: Soft ranking
    - **Values**: "Light", "Medium", "Dark" (need audit)

16. **`colorUndertone`** - String (Warm, Cool, Neutral)
    - **Candidate for Post-SQL**: Yes - should work with color filtering
    - **Current Usage**: Soft ranking
    - **Values**: "Warm", "Cool", "Neutral" (need audit)

17. **`multicolor`** - Boolean
    - **Candidate for Post-SQL**: Yes - boolean filters are straightforward
    - **Current Usage**: Soft ranking
    - **Values**: true/false

### 🔍 Potential Candidates (Not Currently Used in SQL Filters)

18. **`enrichedColor`** - String (comma-separated)
    - **Already Used**: Yes - in color filtering logic
    - **Note**: Should be included in category-specific color dictionary

19. **`sleeve`** - String (Short, Long, Sleeveless, etc.)
    - **Candidate for Post-SQL**: Yes - sleeve types are category-specific
    - **Values in Dataset**: "Short", "Long", "Sleeveless", "Three-Quarter", "Flutter", etc.
    - **SQL Filter Complexity**: Medium (needs normalization)

20. **`neckline`** - String (Round, V-Neck, Scoop, etc.)
    - **Candidate for Post-SQL**: Yes - necklines are category-specific
    - **Values in Dataset**: "Round", "V-Neck", "Scoop", "Square", "Boat", etc.
    - **SQL Filter Complexity**: Medium (needs normalization)

21. **`silhouetteCut`** - String (A-Line, Empire, Relaxed, etc.)
    - **Candidate for Post-SQL**: Maybe - useful for dresses/tops
    - **Values**: Need to audit category distribution
    - **SQL Filter Complexity**: Low (simple string match)

22. **`fabricFamily`** - String (Cotton, Silk, Wool, etc.)
    - **Candidate for Post-SQL**: Yes - fabrics vary by category
    - **Current Usage**: Stored but not actively filtered
    - **Values**: Need to audit distinct values
    - **SQL Filter Complexity**: Low

23. **`material`** - String (legacy column, indexed)
    - **Candidate for Post-SQL**: Yes - similar to fabricFamily
    - **Current Usage**: Stored, available for filtering
    - **Note**: May overlap with `fabricFamily` - need consolidation strategy

24. **`brand`** - String (indexed)
    - **Candidate for Post-SQL**: Yes - brands are category-specific
    - **Current Usage**: Stored, available for filtering
    - **SQL Filter Complexity**: Low (exact match)

25. **`seasonalPalette`** - String (Spring, Summer, Fall, Winter)
    - **Candidate for Post-SQL**: Yes - seasonal filters make sense
    - **Current Usage**: Soft ranking
    - **Values**: Need to audit distinct values

26. **`fitPreference`** - String (Runs Large, Runs Small, Regular)
    - **Candidate for Post-SQL**: Maybe - more relevant for ranking than filtering
    - **SQL Filter Complexity**: Low

27. **`lined`** - Boolean
    - **Candidate for Post-SQL**: Yes - boolean filters are straightforward
    - **Current Usage**: Stored but not filtered
    - **Values**: true/false

28. **`breathability`** - String (Highly Breathable, Breathable, etc.)
    - **Candidate for Post-SQL**: Maybe - useful for weather/comfort queries
    - **SQL Filter Complexity**: Medium (needs value mapping)

29. **`warmthWeight`** - String (Lightweight, Midweight, Heavyweight)
    - **Candidate for Post-SQL**: Yes - useful for temperature intent
    - **SQL Filter Complexity**: Low

30. **`seasonalCues`** - String (Spring, Summer, Fall, Winter)
    - **Candidate for Post-SQL**: Yes - similar to seasonalPalette
    - **Note**: May overlap with `seasonalPalette` - need consolidation strategy

### ❌ Not Recommended for SQL Filtration (Soft Ranking Only)

31. **`occasion`** - String (legacy column, indexed but sparse)
    - **Reason**: Use `occasionContext` array instead (more comprehensive)

32. **`season`** - String (legacy column, indexed but sparse)
    - **Reason**: Use `seasonalPalette` or `seasonalCues` instead

33. **`fit`** - String (legacy column, indexed but sparse)
    - **Reason**: Too vague, use `fitPreference` or `bodyIntent` instead

34. **`comfortIntent`** - String
    - **Reason**: Subjective, better for ranking than filtering

35. **`bodyIntent`** - String
    - **Reason**: Subjective, better for ranking than filtering

36. **`handfeel`** - String
    - **Reason**: Too subjective, better for ranking

37. **`opacity`** - String
    - **Reason**: Too specific, rarely queried directly

38. **`wrinkleBehavior`** - String
    - **Reason**: Too specific, rarely queried directly

39. **`closureConstruction`** - String
    - **Reason**: Too specific, rarely queried directly

---

## Category-Specific Dictionary Requirements

### Dictionary Keys
- **Primary Key**: `"${category}|${subcategory}"` (e.g., `"Women's Dresses|Maxi Dresses"`)
- **Fallback Key**: `"${category}|"` (when subcategory is null, e.g., `"Women's Dresses|"`)
- **Wildcard Key**: `"*|*"` (global fallback if category-specific dictionary is empty)

### Dictionary Values Structure
```typescript
type CategoryDictionary = {
  category: string;
  subcategory: string | null;
  
  // Color dictionary (normalized lowercase)
  availableColors: Set<string>; // e.g., {"white", "ivory", "cream", "blue", "navy"}
  colorFrequency: Map<string, number>; // Count how many products have each color
  
  // Length dictionary (normalized lowercase)
  availableLengths: Set<string>; // e.g., {"mini", "midi", "maxi", "cropped"}
  lengthFrequency: Map<string, number>; // Count how many products have each length
  
  // Additional attributes (for future expansion)
  availableSleeves?: Set<string>;
  availableNecklines?: Set<string>;
  availableFormalityLevels?: Set<string>;
  availableTemperatureIntents?: Set<string>;
  
  productCount: number; // Total products in this category group
};
```

### Dictionary Building Optimization
- **Caching**: Cache dictionaries per category/subcategory combination
- **Cache Key**: `"category-dict-${merchantId}-${category}-${subcategory}-${timestamp}"`
- **Cache TTL**: 1 hour (or until catalog ingestion runs)
- **Invalidation**: On catalog ingestion completion

### Dictionary Size Considerations
- For large categories (e.g., "Women's Dresses" with 500+ products):
  - Dictionary building may be expensive
  - Consider limiting to top 1000 products per category
  - Use sampling if category has >1000 products (sample 1000, build dictionary)
- For small categories (<50 products):
  - Dictionary building is cheap
  - Build full dictionary

---

## Edge Cases and Special Handling

### Case 1: Multiple Categories with Same Subcategory
**Example**: "Women's Dresses|Maxi Dresses" AND "Girls Dresses|Maxi Dresses"
- **Solution**: Build separate dictionaries for each category
- **Matching**: Use category-aware dictionary lookup

### Case 2: Query Specifies Multiple Categories
**Example**: Query classified as ["Women's Dresses", "Girls Dresses", "Tween Dresses"]
- **Solution**: Build dictionaries for each category
- **Filtering**: Apply color/length filters using UNION of all category dictionaries
- **Logic**: Product matches if it matches color/length in ANY of its category dictionaries

### Case 3: Category Has No Products After Stage 1 Filter
**Example**: "Maxi Dresses" category returns 0 products
- **Solution**: Return empty dictionary for that category
- **Behavior**: Post-filtering will return empty result (correct behavior)

### Case 4: Query Color/Length Not Found in Category Dictionary
**Example**: User searches for "purple maxi dresses" but category only has "blue, white, pink"
- **Solution**: Exclude product (strict filtering)
- **Alternative**: Could fall back to soft ranking if no strict matches found

### Case 5: Product Has NULL category or subcategory
**Example**: Product.category = "Women's Dresses", Product.subcategory = NULL
- **Solution**: Use key `"Women's Dresses|"` for dictionary lookup
- **Fallback**: If dictionary not found, use global fallback

### Case 6: Enriched Color Contains Multiple Terms
**Example**: `enrichedColor = "Royal Blue, Whisper Blue, Blue"`
- **Solution**: Split by comma, normalize each term, add all to dictionary
- **Matching**: If query is "blue", match if ANY term contains "blue" (exact or partial)
- **Scoring**: Products with more "blue" mentions get higher priority (already implemented)

### Case 7: Category Expansion (Maxi Dress → Women's Dresses)
**Example**: Query classified as "Maxi Dress" but expanded to ["Maxi Dress", "Women's Dresses"]
- **Solution**: Build dictionaries for both categories
- **Filtering**: For products in "Women's Dresses" category, check if they match "Maxi" length in that category's dictionary
- **Logic**: Category expansion should happen BEFORE dictionary building

---

## Performance Considerations

### Dictionary Building Performance
- **Expected Time**: 50-200ms for 500 products (single query)
- **Optimization**: Use `SELECT id, category, subcategory, enrichedColor, color, length, attributes` in single query
- **Memory**: ~1-5MB per category dictionary (for 500 products)

### Post-Filtering Performance
- **Expected Time**: 10-50ms for 500 products (in-memory filtering)
- **Optimization**: Use Set lookups (O(1) average case)
- **Memory**: Minimal (product IDs only)

### Overall Impact
- **Stage 1 (Category SQL)**: ~20-100ms (similar to current)
- **Stage 2 (Dictionary Building)**: ~50-200ms (NEW - one-time per category)
- **Stage 3 (Post-Filtering)**: ~10-50ms (NEW - per query)
- **Stage 4 (Vector Search)**: ~50-200ms (same as current, but on fewer products)

**Total Additional Latency**: ~60-250ms per query (acceptable for improved accuracy)

### Caching Strategy
- **Cache Dictionaries**: Store in Redis/memory cache with 1-hour TTL
- **Cache Key Format**: `"category-dict:${merchantId}:${category}:${subcategory}"`
- **Cache Invalidation**: On catalog ingestion, or manual refresh endpoint
- **Cache Warming**: Pre-build dictionaries for top 10 categories on startup

---

## Testing Strategy

### Unit Tests
1. **Dictionary Building**:
   - Test with products having various `enrichedColor` formats
   - Test with NULL values
   - Test with multiple categories/subcategories
   - Test with empty product sets

2. **Post-Filtering**:
   - Test color matching (exact, partial, comma-separated)
   - Test length matching (exact, case-insensitive)
   - Test category dictionary lookup (exact match, fallback)
   - Test edge cases (NULL values, missing dictionaries)

### Integration Tests
1. **End-to-End Flow**:
   - Query: "blue maxi dresses for kids"
   - Verify: Stage 1 returns category-filtered products
   - Verify: Dictionary contains only colors/lengths from category
   - Verify: Post-filtering excludes products not matching color/length
   - Verify: Final results match expected products

2. **Category-Specific Queries**:
   - "red cardigans" (Tops category)
   - "white mini dresses" (Dresses category)
   - "black maxi skirts" (Bottoms category)
   - Verify: Each category uses its own dictionary

### Performance Tests
1. **Large Category Test**:
   - Category with 1000+ products
   - Measure dictionary building time
   - Measure post-filtering time
   - Verify: Total time < 300ms

2. **Multiple Category Test**:
   - Query with 3 categories
   - Build 3 dictionaries
   - Measure total time
   - Verify: Parallel dictionary building (if possible)

---

## Rollout Plan

### Phase 1: Implementation (Week 1)
- [ ] Implement `deduplicateProductsByCategoryForPostFiltering`
- [ ] Implement `buildCategorySpecificDictionaries`
- [ ] Implement `applyPostSQLFilters`
- [ ] Add unit tests

### Phase 2: Integration (Week 1)
- [ ] Integrate into `multiViewRetrieval`
- [ ] Add feature flag `ENABLE_POST_SQL_FILTERING`
- [ ] Add integration tests
- [ ] Add logging for dictionary building and post-filtering

### Phase 3: Testing (Week 2)
- [ ] Test with real queries on staging
- [ ] Performance benchmarking
- [ ] Compare results with/without post-SQL filtering
- [ ] Fix edge cases

### Phase 4: Gradual Rollout (Week 2-3)
- [ ] Enable for 10% of queries (A/B test)
- [ ] Monitor performance and accuracy
- [ ] Enable for 50% of queries
- [ ] Enable for 100% of queries

### Phase 5: Optimization (Week 3-4)
- [ ] Implement dictionary caching
- [ ] Optimize dictionary building queries
- [ ] Add cache warming on startup
- [ ] Monitor cache hit rates

---

## Additional Columns Audit Summary

### Recommended for Post-SQL Filtration (Priority Order)

#### Tier 1 (High Priority - Already Have Data)
1. **`colors`** (via `enrichedColor` + `color`) - ✅ Implemented in plan
2. **`lengths`** (via `length` column) - ✅ Implemented in plan
3. **`sleeve`** - High value for tops/dresses queries
4. **`neckline`** - High value for tops/dresses queries
5. **`formalityLevel`** - High value for occasion-based queries

#### Tier 2 (Medium Priority - Good Coverage)
6. **`temperatureIntent`** - Useful for weather queries
7. **`humidityFriendly`** - Boolean, easy to filter
8. **`occasionContext`** - Array, needs GIN index handling
9. **`fabricFamily`** - Useful for material queries
10. **`brand`** - Useful for brand-specific queries

#### Tier 3 (Lower Priority - Niche Use Cases)
11. **`silhouetteCut`** - Useful for dresses/tops
12. **`colorShade`** - Useful for color refinement
13. **`colorUndertone`** - Useful for color refinement
14. **`seasonalPalette`** - Useful for seasonal queries
15. **`lined`** - Boolean, easy but rarely queried

### Not Recommended for Post-SQL Filtration
- **Subjective attributes** (`comfortIntent`, `bodyIntent`, `handfeel`) - Better for ranking
- **Very specific attributes** (`opacity`, `wrinkleBehavior`, `closureConstruction`) - Rarely queried directly
- **Legacy sparse columns** (`occasion`, `season`, `fit`) - Use enriched alternatives instead

---

## Future Enhancements

### Phase 2: Expand to Additional Attributes
- Implement post-SQL filtering for `sleeve`, `neckline`, `formalityLevel`
- Implement dictionary building for these attributes
- Update `CategoryDictionary` type to include new attributes

### Phase 3: Dictionary Precomputation
- Precompute dictionaries during catalog ingestion
- Store dictionaries in database table: `CategoryDictionary`
- Refresh dictionaries on catalog update

### Phase 4: Dictionary Analytics
- Track dictionary usage (which categories are queried most)
- Track dictionary effectiveness (how often dictionaries reduce result sets)
- Optimize dictionary building based on usage patterns

---

## Risk Assessment

### Risks
1. **Performance Degradation**: Additional 60-250ms latency per query
   - **Mitigation**: Implement caching, optimize queries, monitor performance

2. **Dictionary Building Failures**: If dictionary building fails, fall back to existing flow
   - **Mitigation**: Add try-catch, fallback to global filtering

3. **Category Dictionary Misses**: If category has no dictionary, products may be incorrectly filtered
   - **Mitigation**: Always build fallback global dictionary, log misses

4. **Memory Usage**: Large dictionaries for big categories
   - **Mitigation**: Limit dictionary size, use sampling for large categories

### Benefits
1. **Improved Accuracy**: Color/length filters only use values that exist in category
2. **Reduced False Negatives**: Products won't be excluded due to global dictionary mismatches
3. **Better Relevance**: Category-specific filtering ensures more relevant results
4. **Scalability**: Can extend to other attributes (sleeve, neckline, etc.)

---

## Questions to Resolve

1. **Dictionary Caching**: Should we cache dictionaries in Redis or in-memory?
   - **Recommendation**: Start with in-memory cache, move to Redis if needed

2. **Dictionary Refresh Frequency**: How often should dictionaries be rebuilt?
   - **Recommendation**: On catalog ingestion + 1-hour TTL

3. **Fallback Strategy**: If dictionary building fails, use global filtering or return empty results?
   - **Recommendation**: Fall back to global filtering with logging

4. **Multiple Category Handling**: Should we build separate dictionaries or merge?
   - **Recommendation**: Build separate dictionaries, apply filters using UNION logic

5. **Dictionary Size Limits**: Should we limit dictionary size for large categories?
   - **Recommendation**: Yes, sample 1000 products for categories with >1000 products


