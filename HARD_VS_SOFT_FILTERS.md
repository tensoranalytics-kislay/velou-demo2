# Hard Filters vs Soft Ranking - Column Usage

## Overview

The system uses two approaches for filtering products:
1. **Hard Filters (SQL-level)**: Applied in WHERE clauses - products that don't match are **excluded**
2. **Soft Ranking**: Applied in scoring/ranking - products get **boosted scores** but are not excluded

---

## Hard Filters (SQL WHERE Clauses)

These columns are used as **hard filters** - products must match or they are excluded from results:

### Always Hard Filters
1. **`merchantId`** - Multi-tenant isolation (always applied)
2. **`isActive`** - Only active products (always applied)
3. **`stockStatus`** - Stock status filter (default: `'in_stock'` only)
4. **`category`** - Category matching (tolerant with subcategory matching)

### Enriched Columns (Hard Filters)
These are **indexed columns** on the Product table, applied as SQL WHERE filters:

5. **`length`** - Dress length (Mini, Midi, Maxi, etc.)
   - SQL: `"length" = ANY(ARRAY[...]::text[])`

6. **`formalityLevel`** - Formality (Casual, Semi-Formal, Formal)
   - SQL: `"formalityLevel" = ANY(ARRAY[...]::text[])`

7. **`temperatureIntent`** - Weather intent (Warm Weather, Cool Weather, etc.)
   - SQL: `"temperatureIntent" = '...'`

8. **`humidityFriendly`** - Boolean flag for humidity-friendly products
   - SQL: `"humidityFriendly" = true/false`

9. **`occasionContext`** - Array of occasions (uses GIN index)
   - SQL: `"occasionContext" && ARRAY[...]::text[]` (array overlap)

10. **`problemSolutions`** - Array of problem solutions (uses GIN index)
    - SQL: `"problemSolutions" && ARRAY[...]::text[]`

11. **`functionFeatures`** - Array of function features (uses GIN index)
    - SQL: `"functionFeatures" && ARRAY[...]::text[]`

12. **`colorShade`** - Color shade (Light, Medium, Dark)
    - SQL: `"colorShade" = ANY(ARRAY[...]::text[])`

13. **`colorUndertone`** - Color undertone (Warm, Cool, Neutral)
    - SQL: `"colorUndertone" = ANY(ARRAY[...]::text[])`

14. **`multicolor`** - Boolean flag for multicolor products
    - SQL: `"multicolor" = true/false`

15. **`ageGroup`** - Age group (Kids, Adult, etc.)
    - SQL: Applied with category-based inference

### JSON Attributes (Hard Filters via SQL)
These are checked in SQL WHERE clauses using JSON path operators:

16. **`attributes->>'gender'`** - Gender filter (mens/womens/unisex)
    - SQL: `attributes->>'gender' = 'mens' OR attributes->>'gender' = 'unisex'`

17. **`attributes->'variant_colors'`** - Color array (primary source)
    - SQL: `EXISTS (SELECT 1 FROM jsonb_array_elements_text(attributes->'variant_colors') ...)`

18. **`attributes->>'enriched_color'`** - Color string (secondary source)
    - SQL: `LOWER(COALESCE(attributes->>'enriched_color', '')) LIKE LOWER('%color%')`

19. **`attributes->>'color'`** - Legacy color field (fallback)
    - SQL: `LOWER(COALESCE(attributes->>'color', '')) LIKE LOWER('%color%')`

20. **Price Range** - `priceCents` between min/max
    - SQL: `"priceCents" >= min AND "priceCents" <= max`

21. **Brands** - Brand filtering
    - SQL: `"brand" = ANY(ARRAY[...]::text[])`

22. **Excluded Categories/Products** - From merchandising rules
    - SQL: `"category" NOT IN (...) AND "id" NOT IN (...)`

---

## Soft Ranking (Scoring Only)

These attributes are used for **scoring/ranking** but do NOT exclude products:

### Constraint-Based Ranking
Applied in `calculateConstraintMatchScore()` function:

1. **Colors** - Weight: 1.0
   - Checks: `enriched_color`, `variant_colors`, `color` (legacy)
   - Score: 0.0 - 1.0 based on match quality
   - **Note**: Colors are ALSO hard filters in SQL, but ranking provides additional scoring

2. **Sizes** - Weight: 0.8
   - Checks: `attributes->>'sizes'` or `attributes->>'size'`
   - Score: 0.0 - 1.0 based on match

3. **Occasions** - Weight: 0.6
   - Checks: `attributes->>'occasion'` or `occasionContext` (enriched)
   - Score: 0.0 - 1.0 based on match

4. **Styles** - Weight: 0.4
   - Checks: `attributes->>'style'` or `attributes->>'Style'`
   - Score: 0.0 - 1.0 based on match

5. **Patterns** - Weight: 0.4
   - Checks: `attributes->>'pattern'` or `attributes->>'Pattern'`
   - Score: 0.0 - 1.0 based on match

6. **Materials/Fabrics** - Weight: 0.2
   - Checks: `attributes->>'material'`, `attributes->>'fabric'`
   - Score: 0.0 - 1.0 based on match

7. **Seasons** - Weight: 0.3
   - Checks: `attributes->>'season'` or `seasonalPalette` (enriched)
   - Score: 0.0 - 1.0 based on match

8. **Fits** - Weight: 0.2
   - Checks: `attributes->>'fit'`
   - Score: 0.0 - 1.0 based on match

9. **Lengths** - Weight: 0.4
   - Checks: `attributes->>'length'` or `length` (enriched)
   - **Note**: `length` (enriched) is ALSO a hard filter, but ranking provides additional scoring

10. **Age Groups** - Weight: 1.5 (highest priority)
    - Checks: `attributes->>'ageGroup'` or `ageGroup` (enriched)
    - Score: 0.0 - 1.0 based on match
    - **Note**: Can be hard filter if explicitly mentioned

### Enriched Column Boosts (SQL Ranking)
Applied in SQL ranking expressions (adds to score, doesn't exclude):

11. **`formalityLevel`** - Boost: +2.0 per match
    - SQL: `CASE WHEN "formalityLevel" = '...' THEN 2.0 ELSE 0 END`

12. **`temperatureIntent`** - Boost: +2.5 per match
    - SQL: `CASE WHEN "temperatureIntent" = '...' THEN 2.5 ELSE 0 END`

13. **`humidityFriendly`** - Boost: +1.5 per match
    - SQL: `CASE WHEN "humidityFriendly" = true THEN 1.5 ELSE 0 END`

14. **`problemSolutions`** - Boost: +2.0 per matching solution
    - SQL: Array overlap check with boost calculation

15. **`functionFeatures`** - Boost: +1.5 per matching feature
    - SQL: Array overlap check with boost calculation

16. **`colorShade`** - Boost: +1.0 per match
    - SQL: `CASE WHEN "colorShade" = '...' THEN 1.0 ELSE 0 END`

17. **`colorUndertone`** - Boost: +1.0 per match
    - SQL: `CASE WHEN "colorUndertone" = '...' THEN 1.0 ELSE 0 END`

### Other Ranking Factors

18. **Full-Text Search** - Boost: `ts_rank_cd(search_vector, query) * 5.0`
19. **Category Boosts** - From merchandising rules
20. **Recency** - Boost: `EXTRACT(EPOCH FROM (updatedAt - NOW())) / -86400.0 * 0.1`
21. **Vector Similarity** - Cosine similarity score (0.0 - 1.0)

---

## Special Cases

### Colors: Both Hard Filter AND Ranking
- **Hard Filter**: Applied in SQL WHERE clause (excludes non-matching products)
- **Ranking**: Also scored in `calculateConstraintMatchScore()` for ordering
- **Reason**: Ensures only matching colors are returned, but also ranks them by match quality

### Age Groups: Can Be Hard Filter OR Ranking
- **Hard Filter**: When explicitly mentioned in query (e.g., "kids dresses")
- **Ranking**: When inferred or not explicitly mentioned
- **Reason**: Critical for separating kids vs adult products when explicitly requested

### Enriched Columns: Both Hard Filter AND Ranking
- **Hard Filter**: Applied in SQL WHERE clause (excludes non-matching products)
- **Ranking**: Also boosted in SQL ranking expression (adds to score)
- **Reason**: Fast SQL-level filtering with additional scoring for better ordering

---

## Summary Table

| Column/Attribute | Hard Filter (SQL) | Soft Ranking | Notes |
|-----------------|-------------------|--------------|-------|
| `merchantId` | ✅ Always | ❌ | Multi-tenant isolation |
| `isActive` | ✅ Always | ❌ | Only active products |
| `stockStatus` | ✅ Always | ❌ | Default: in_stock only |
| `category` | ✅ Always | ✅ | Category boosts in ranking |
| `priceCents` | ✅ | ❌ | Price range filter |
| `brand` | ✅ | ❌ | Brand filter |
| `length` (enriched) | ✅ | ✅ | Hard filter + ranking boost |
| `formalityLevel` | ✅ | ✅ | Hard filter + ranking boost (+2.0) |
| `temperatureIntent` | ✅ | ✅ | Hard filter + ranking boost (+2.5) |
| `humidityFriendly` | ✅ | ✅ | Hard filter + ranking boost (+1.5) |
| `occasionContext` | ✅ | ✅ | Hard filter + ranking boost |
| `problemSolutions` | ✅ | ✅ | Hard filter + ranking boost (+2.0 each) |
| `functionFeatures` | ✅ | ✅ | Hard filter + ranking boost (+1.5 each) |
| `colorShade` | ✅ | ✅ | Hard filter + ranking boost (+1.0) |
| `colorUndertone` | ✅ | ✅ | Hard filter + ranking boost (+1.0) |
| `multicolor` | ✅ | ❌ | Boolean filter only |
| `ageGroup` | ✅ (if explicit) | ✅ | Weight: 1.5 (highest) |
| `attributes->>'gender'` | ✅ | ❌ | Gender filter |
| `attributes->'variant_colors'` | ✅ | ✅ | Hard filter + ranking (weight: 1.0) |
| `attributes->>'enriched_color'` | ✅ | ✅ | Hard filter + ranking (weight: 1.0) |
| `attributes->>'color'` | ✅ | ✅ | Hard filter + ranking (weight: 1.0) |
| `attributes->>'sizes'` | ❌ | ✅ | Weight: 0.8 |
| `attributes->>'occasions'` | ❌ | ✅ | Weight: 0.6 |
| `attributes->>'styles'` | ❌ | ✅ | Weight: 0.4 |
| `attributes->>'patterns'` | ❌ | ✅ | Weight: 0.4 |
| `attributes->>'materials'` | ❌ | ✅ | Weight: 0.2 |
| `attributes->>'fabrics'` | ❌ | ✅ | Weight: 0.2 |
| `attributes->>'seasons'` | ❌ | ✅ | Weight: 0.3 |
| `attributes->>'fits'` | ❌ | ✅ | Weight: 0.2 |
| Vector similarity | ❌ | ✅ | Cosine similarity (0.0 - 1.0) |
| Full-text search | ❌ | ✅ | `ts_rank_cd(...) * 5.0` |
| Recency | ❌ | ✅ | Time-based boost |

---

## Key Files

- **Hard Filters (SQL)**: `src/lib/search/vector/index.ts`, `src/lib/search/ranking/dbRankedSearch.ts`
- **Soft Ranking**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts`
- **Attribute Filtering Logic**: `src/lib/search/filtering/attributes.ts`


