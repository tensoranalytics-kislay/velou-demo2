# Set vs Single Filter Implementation

## Summary

Implemented filtering to **hide pack/set products by default** and only show them when explicitly requested in the query. The system now defaults to showing only "Single" products unless the user explicitly mentions pack-related terms.

---

## Changes Made

### 1. Type Definitions

#### `FashionConstraints` (`src/lib/loveshackfancy/classifier.ts`)
- Added: `setVsSingle?: string | ConstraintWithIntent | null;`
- Values: `"Set"` (pack products) or `"Single"` (individual items)

#### `SearchConstraints` (`src/lib/search/types.ts`)
- Added: `setVsSingle?: string[];`
- Used for SQL filtering

#### `BroadWhereFilters` (`src/lib/search/query/types.ts`)
- Added: `setVsSingle?: string[];`
- Used for database-level filtering

---

### 2. Constraint Dictionaries

#### `constraint-dictionaries.json`
- Added: `"setVsSingle": ["Set", "Single"]`

#### `constraint-dictionaries.ts`
- Added `setVsSingle` to `ConstraintDictionary` type
- Added `setVsSingle` to `getDictionaryForConstraintType`, `valueExistsInDictionary`, and `findExactDictionaryValue` functions

#### `category-constraint-dictionaries.ts`
- Added `setVsSingle` to `CategoryConstraintDictionary` interface
- Added `setVsSingle` to merge and format functions

---

### 3. LLM Prompt Updates

#### Schema (`src/lib/loveshackfancy/prompts.ts`)
- Added `setVsSingle` to `LOVESHACKFANCY_QUERY_CLASSIFIER_SCHEMA`
- Supports both string and `ConstraintWithIntent` format

#### Prompt Instructions
- Added **SET VS SINGLE** section to dictionary display
- Added extraction rules:
  - Extract "Set" ONLY when user explicitly mentions pack-related terms:
    - "pack", "bundle", "set", "multi", "pair"
    - "3-pack", "4-pack", "5-pack", "6-pack"
    - "multi-pack", "value pack", "starter pack"
  - If not mentioned, do NOT extract (system defaults to "Single")

---

### 4. Constraint Extraction

#### `classifier.ts`
- Added extraction logic for `setVsSingle`:
  - Handles both string and `ConstraintWithIntent` formats
  - Extracts first value from array if object format

#### `retrieval.ts`
- Added extraction from `FashionConstraints` to `SearchConstraints`
- **Default Logic**: 
  - If LLM extracts `"Set"` → use `["Set"]`
  - Otherwise → default to `["Single"]` (excludes pack products)
- Added logging for extraction and final value

---

### 5. SQL Filtering

#### `buildBroadWhereFilters.ts`
- Added `setVsSingle` to filter mapping
- Defaults to `["Single"]` if not specified in constraints

#### `dbRankedSearch.ts`
- Added SQL WHERE clause:
  ```sql
  attributes->>'set_vs_single' = ANY(ARRAY['Single']::text[])
  ```
- Filters at database level using JSONB attribute

#### `vector/index.ts` (`deduplicateProductsByCategoryForPostFiltering`)
- Added `setVsSingle` to filters parameter
- Added SQL WHERE clause:
  ```sql
  p.attributes->>'set_vs_single' = ANY(ARRAY['Single']::text[])
  ```
- Updated call in `retrieval.ts` to pass `setVsSingle` filter

---

## Default Behavior

### Default: Show Only Single Products
- **When**: User query does NOT mention pack-related terms
- **Filter Applied**: `setVsSingle = ["Single"]`
- **Result**: Only individual products shown (pack products excluded)

### Explicit Request: Show Pack Products
- **When**: User query mentions pack-related terms (e.g., "3-pack", "bundle", "set")
- **Filter Applied**: `setVsSingle = ["Set"]`
- **Result**: Only pack products shown

---

## Example Queries

### Query 1: "I want a blue dress"
- **Extracted**: `setVsSingle: null` (not extracted)
- **Default Applied**: `setVsSingle: ["Single"]`
- **Result**: Only single blue dresses shown (no pack products)

### Query 2: "I want a 3-pack of t-shirts"
- **Extracted**: `setVsSingle: { values: ["Set"], intent: "required" }`
- **Filter Applied**: `setVsSingle: ["Set"]`
- **Result**: Only pack products shown (3-pack t-shirts)

### Query 3: "show me t-shirt bundles"
- **Extracted**: `setVsSingle: { values: ["Set"], intent: "required" }`
- **Filter Applied**: `setVsSingle: ["Set"]`
- **Result**: Only pack products shown (bundles)

---

## SQL Implementation

### Database Query
```sql
SELECT * FROM "Product"
WHERE attributes->>'set_vs_single' = ANY(ARRAY['Single']::text[])
  AND "isActive" = true
  AND "merchantId" = $1
```

### Filter Locations
1. **`dbRankedSearch.ts`**: Applied in ranked search queries
2. **`vector/index.ts`**: Applied in vector search pre-filtering
3. **`buildBroadWhereFilters.ts`**: Mapped from `SearchConstraints` to `BroadWhereFilters`

---

## Testing

To test the implementation:

1. **Normal Query** (should exclude pack products):
   - Query: "I want a blue dress"
   - Expected: Only single dresses shown
   - Filter: `setVsSingle = ["Single"]`

2. **Pack Query** (should show pack products):
   - Query: "I want a 3-pack of t-shirts"
   - Expected: Only pack products shown
   - Filter: `setVsSingle = ["Set"]`

---

## Notes

- **Default Behavior**: System defaults to `["Single"]` to exclude pack products unless explicitly requested
- **Hard SQL Filter**: Applied at database level for efficiency
- **Dictionary-Based**: LLM uses dictionary values ("Set", "Single") for extraction
- **Intent Support**: Supports "required", "strong", "preferred", "excluded" intents
- **Logging**: Added comprehensive logging for extraction and filtering

---

**Status**: ✅ Implementation Complete
