# Product Search & Filtering Pipeline Stages

This document describes the complete stages of product search and filtering in the current pipeline, from user query to final results.

---

## Overview

The search pipeline consists of **6 main stages** that progressively filter and rank products:

1. **Intent Extraction & Constraint Building**
2. **Database-Level Ranked Search**
3. **In-Memory Attribute Filtering**
4. **Constraint Relaxation (Widening)**
5. **Final Scoring & Ranking**
6. **Result Limiting & Formatting**

---

## Stage 1: Intent Extraction & Constraint Building

**File**: `src/lib/search/index.ts` (lines 219-260)

### 1.1 Intent Constraint Extraction
- **Function**: `extractIntentConstraints()` from `src/lib/search/intent/extractIntent.ts`
- **Purpose**: Extracts enriched attributes from natural language queries
- **Examples**:
  - "hot humid day" → `temperatureIntent: "Warm Weather"`, `humidityFriendly: true`
  - "wedding dress" → `formalityLevel: ["Formal"]`, `occasionContext: ["Wedding"]`
  - "wrinkle-free" → `problemSolutions: ["Wrinkle-Free"]`

### 1.2 Merchandising Context Building
- **Function**: `buildMerchContext()`
- **Purpose**: Loads active merchandising rules from database
- **Output**:
  - `excludedCategories`: Categories to exclude (from MerchRules)
  - `boostByCategory`: Category boost weights (from MerchRules)
  - `hideOutOfStock`: Whether to hide out-of-stock products

### 1.3 Broad Filter Building
- **Function**: `buildBroadWhereFilters()` from `src/lib/search/query/buildFilters.ts`
- **Purpose**: Converts `SearchConstraints` into database WHERE filters
- **Filters Applied**:
  - **Stock Status**: Hard filter (default: in-stock only)
  - **Price Range**: `priceMinCents`, `priceMaxCents`
  - **Brands**: Array of brand names
  - **Genders**: Hard filter (mens/womens/unisex)
  - **Excluded Categories**: From merchandising rules
  - **Excluded Product IDs**: Explicit exclusions
  - **Enriched Indexed Filters** (SQL-level):
    - `length`: Dress/skirt lengths
    - `formalityLevel`: Casual/Semi-Formal/Formal
    - `temperatureIntent`: Warm Weather/Cool Weather
    - `humidityFriendly`: Boolean
    - `occasionContext`: Array overlap (GIN index)
    - `problemSolutions`: Array overlap (GIN index)
    - `functionFeatures`: Array overlap (GIN index)
    - `colorShade`: Light/Medium/Dark
    - `colorUndertone`: Warm/Cool/Neutral
    - `multicolor`: Boolean
  - **Category Matching**: Tolerant matching with canonicalization
    - Expands canonical categories to DB categories
    - Checks both `category` and `subcategory` fields
    - Supports multi-category queries (outfits)
  - **Keyword Filters**: Generated from canonical categories
    - Exact phrases (highest priority)
    - 2-word combinations
    - Individual words

### 1.4 Dynamic Take Calculation
- **Function**: `calculateDynamicTake()` from `src/lib/search/query/calculateTake.ts`
- **Purpose**: Determines how many products to fetch from database
- **Formula**:
  - Base: `limit * 50` (min 300, max 2500)
  - If broad query OR has hard text filters: `max(1500, take)`
  - Capped at `MAX_TAKE = 2500`

---

## Stage 2: Database-Level Ranked Search

**File**: `src/lib/search/ranking/dbRankedSearch.ts`

### 2.1 SQL Query Building
- **Mode**: Raw SQL (if `ENABLE_RAW_RANKED_SEARCH=true`) or Prisma fallback
- **WHERE Clause Filters** (applied at SQL level):
  - Multi-tenant isolation (`merchantId`)
  - Stock status (hard filter)
  - Category matching (tolerant, with subcategory)
  - Keyword filters (LIKE patterns in title/description/category)
  - Price range
  - Brands
  - Genders (JSON path filtering)
  - Excluded categories/products
  - **Enriched indexed columns** (all filters applied at SQL level for performance)

### 2.2 Ranking Expression
- **Components**:
  1. **Full-Text Search**: `ts_rank_cd(search_vector, query) * 5.0` (if enabled)
  2. **Category Boosts**: `CASE WHEN category = X THEN weight ELSE 0 END`
  3. **Keyword Ranking Boosts**:
     - Exact phrase match: +10.0
     - 2-word combination: +5.0
     - Individual word: +1.0
  4. **Enriched Attribute Boosts**:
     - Formality level match: +2.0
     - Temperature intent match: +2.5
     - Humidity friendly match: +1.5
     - Problem solutions match: +2.0 per matching solution
     - Function features match: +1.5 per matching feature
     - Color shade match: +1.0
     - Color undertone match: +1.0
  5. **Recency Boost**: `EXTRACT(EPOCH FROM (updatedAt - NOW())) / -86400.0 * 0.1`

### 2.3 Result Ordering
- **ORDER BY**: `rank DESC, updatedAt DESC`
- **LIMIT**: `take` (from dynamic calculation)

### 2.4 Prisma Fallback
- If raw SQL disabled or fails, uses Prisma with:
  - Same WHERE filters
  - In-memory relevance scoring via `applyRelevanceScoring()`
  - Same enriched attribute boosts applied

**Output**: Array of `RankedSearchResult` with `rank` scores

---

## Stage 3: In-Memory Attribute Filtering

**File**: `src/lib/search/filtering/attributes.ts`

### 3.1 Constraint Meta Derivation
- **Function**: `deriveAttributeConstraintMeta()`
- **Purpose**: Determines which constraints are "hard" (must match) vs "soft"
- **Hard Constraints**:
  - Colors (validated against ontology)
  - Fabrics/Materials
  - Sizes
  - Fit
  - Seasons
  - Occasions
  - Enriched attributes (formalityLevel, temperatureIntent, etc.)

### 3.2 Attribute Matching
- **Function**: `matchesAttributeFilters()`
- **Purpose**: Filters products that don't match hard constraints
- **Matching Logic**:
  - **Enriched Columns** (primary source):
    - Checks indexed columns first (`product.formalityLevel`, `product.temperatureIntent`, etc.)
    - Falls back to JSON attributes if enriched columns are null
  - **JSON Attributes** (fallback):
    - Colors: Validated against catalog ontology
    - Fabrics/Materials: Substring matching
    - Sizes: Array intersection
    - Fit: Exact match
    - Seasons/Occasions: Substring matching
  - **Category Bridging**: Best-effort matching via JSON `googleProductCategory` and `productType`

### 3.3 Filtering Process
- Iterates through `dbCandidates`
- For each product:
  1. Extracts enriched columns from product object
  2. Extracts JSON attributes
  3. Checks all hard constraints
  4. Returns `true` only if all hard constraints match

**Output**: Filtered array of products matching all hard constraints

---

## Stage 4: Constraint Relaxation (Widening)

**File**: `src/lib/search/index.ts` (lines 347-400)

### 4.1 Trigger Condition
- **Condition**: `attributeFilterEliminatedAll = true`
  - Hard attribute constraints exist
  - Filtered results = 0
  - DB candidates > 0

### 4.2 Widening Tiers
- **Function**: `buildWideningTiers()`
- **Purpose**: Progressively relax filters to ensure results
- **Tiers** (in order):
  1. **Drop Category**: Keep price/brand/stock/gender/keywords
  2. **Drop Brand**: Keep price/stock/gender/keywords
  3. **Drop Price**: Keep stock/gender/keywords
  4. **Stock Only**: Only stock filter (if required), keep gender

### 4.3 Widening Process
- For each tier:
  1. Re-run `dbRankedSearch()` with relaxed filters
  2. Apply attribute filtering (if still needed)
  3. If results found, use this tier and stop
- If no tier produces results, use original DB candidates (relaxed)

**Output**: `finalProducts` array (may be from relaxed filters)

---

## Stage 5: Final Scoring & Ranking

**File**: `src/lib/search/index.ts` (lines 409-466)

### 5.1 Score Components
- **Base Score**: Category boost from merchandising rules
- **DB Rank**: Rank score from database search
- **Attribute Score**: Soft matching (only when relaxed)
  - Color match: +0.3
  - Fabric match: +0.3
  - Material match: +0.3
  - Occasion match: +0.2
  - Season match: +0.2
  - Fit match: +0.2

### 5.2 Final Score Calculation
```typescript
finalScore = categoryBoost + dbRank + attributeScore
```

### 5.3 Sorting
- **Primary**: `score DESC` (highest score first)
- **Secondary**: `updatedAt DESC` (newer products first)

### 5.4 Limiting
- **Slice**: `slice(0, limit)` (default limit = 8)

**Output**: Sorted and limited array of products

---

## Stage 6: Result Formatting

**File**: `src/lib/search/index.ts` (line 466)

### 6.1 Product Conversion
- **Function**: `toResultItem()`
- **Purpose**: Converts database product to `SearchResultItem`
- **Fields Included**:
  - Basic: `id`, `title`, `description`, `imageUrl`, `productUrl`
  - Pricing: `priceCents`, `salePriceCents`, `currency`
  - Metadata: `category`, `stockStatus`
  - Attributes: `attributes` (JSON)
  - **Enriched Columns**: Included in `SearchResultItem` type

### 6.2 Return Value
```typescript
{
  products: SearchResultItem[],
  wasRelaxed: boolean
}
```

---

## Complete Flow Diagram

```
User Query
    ↓
[Stage 1] Intent Extraction & Constraint Building
    ├─ Extract enriched attributes from query
    ├─ Load merchandising rules
    ├─ Build broad WHERE filters (SQL-level)
    ├─ Calculate dynamic take
    └─ Generate keyword filters
    ↓
[Stage 2] Database-Level Ranked Search
    ├─ Build SQL WHERE clause (enriched filters applied)
    ├─ Calculate ranking expression (enriched boosts)
    ├─ Execute query with ORDER BY rank DESC
    └─ Return ranked candidates (up to 2500)
    ↓
[Stage 3] In-Memory Attribute Filtering
    ├─ Derive constraint meta (hard vs soft)
    ├─ Filter by enriched columns (primary)
    ├─ Filter by JSON attributes (fallback)
    └─ Return filtered products
    ↓
[Stage 4] Constraint Relaxation (if needed)
    ├─ Check if all candidates eliminated
    ├─ Build widening tiers
    ├─ Re-run search with relaxed filters
    └─ Return relaxed results
    ↓
[Stage 5] Final Scoring & Ranking
    ├─ Calculate final score (category + DB rank + attributes)
    ├─ Sort by score DESC, updatedAt DESC
    └─ Limit to requested count
    ↓
[Stage 6] Result Formatting
    ├─ Convert to SearchResultItem
    └─ Return { products, wasRelaxed }
```

---

## Key Features

### Enriched Attributes Integration
- **Stage 1**: Extracted from user query via `extractIntentConstraints()`
- **Stage 2**: Filtered at SQL level using indexed columns
- **Stage 2**: Boosted in ranking expression
- **Stage 3**: Checked first (before JSON fallback) in attribute filtering
- **Stage 6**: Included in final `SearchResultItem` type

### Performance Optimizations
1. **SQL-Level Filtering**: Enriched columns filtered at database level (indexed)
2. **Dynamic Take**: Fetches only needed products (300-2500)
3. **Early Filtering**: Hard constraints applied before ranking
4. **Indexed Columns**: All enriched attributes have database indexes

### Fallback Mechanisms
1. **Prisma Fallback**: If raw SQL fails, uses Prisma with same logic
2. **JSON Fallback**: If enriched columns null, checks JSON attributes
3. **Constraint Relaxation**: If no results, progressively relaxes filters
4. **Soft Matching**: When relaxed, uses soft attribute matching for scoring

---

## Filtering Hierarchy

### Hard Filters (Must Match)
1. **Stock Status**: In-stock only (default)
2. **Genders**: Exact match (mens/womens/unisex)
3. **Enriched Attributes**: Exact/array matches (formalityLevel, temperatureIntent, etc.)
4. **Colors**: Validated against ontology
5. **Sizes**: Array intersection
6. **Price Range**: Within min/max bounds

### Soft Filters (Scoring Boost)
- Applied only when constraints are relaxed
- Color/Fabric/Material/Occasion/Season/Fit matches add to score
- Doesn't eliminate products, just boosts ranking

### Progressive Relaxation
1. Keep all filters → Drop category → Drop brand → Drop price → Stock only
2. Each tier re-runs database search
3. Stops at first tier that produces results

---

## Example: "Hot Humid Day Dress" Query

### Stage 1: Constraint Building
- `extractIntentConstraints()` extracts:
  - `temperatureIntent: "Warm Weather"`
  - `humidityFriendly: true`
- `buildBroadWhereFilters()` creates:
  - SQL filter: `temperatureIntent = 'Warm Weather'`
  - SQL filter: `humidityFriendly = true`

### Stage 2: Database Search
- SQL WHERE includes enriched filters
- Ranking boosts:
  - Temperature intent match: +2.5
  - Humidity friendly match: +1.5
- Returns products ranked by relevance

### Stage 3: Attribute Filtering
- Checks `product.temperatureIntent === "Warm Weather"`
- Checks `product.humidityFriendly === true`
- Filters out products that don't match

### Stage 4: Relaxation
- If no results, widens to drop category/brand filters
- Re-runs search with relaxed filters

### Stage 5: Final Scoring
- Category boost (if applicable)
- DB rank (includes enriched boosts)
- Attribute score (if relaxed)

### Stage 6: Results
- Returns top 8 products matching hot/humid criteria
- Includes enriched columns in response

---

## Notes

- All enriched attributes are **indexed** in the database for fast filtering
- Enriched columns are **primary source**, JSON attributes are **fallback**
- Ranking boosts for enriched attributes ensure matching products rank higher
- Constraint relaxation ensures users always get results (even if relaxed)
- Multi-tenant isolation applied at every stage




