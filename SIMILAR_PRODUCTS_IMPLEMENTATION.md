# Similar Products Feature Implementation

## Overview
Implemented the "find similar products" feature that recommends products matching specific criteria when a user clicks the "find similar" button on a product card.

## Requirements Implemented

### 1. Deduplication of Already Shown Products
- ✅ Collects all product IDs shown in the conversation (from messages and conversation context)
- ✅ Passes `excludeProductIds` as a query parameter to the API
- ✅ Excludes these products from similar products results

### 2. Matching Criteria (Hard Filters)
Products must match ALL of the following:
- ✅ **Category**: Exact match with the original product
- ✅ **Gender**: Exact match (if product has gender, otherwise matches null/unisex)
- ✅ **AgeGroup**: Exact match (if product has ageGroup, otherwise matches null)
- ✅ **SetVsSingle**: Exact match from attributes JSON (if product has setVsSingle, otherwise defaults to "Single")
- ✅ **Price**: Within 20% range of original product price (±20%)
- ✅ **Stock**: Must be `in_stock`
- ✅ **Active**: Must be `isActive = true`
- ✅ **MerchantId**: Must match the same merchant
- ✅ **InclusivitySizing**: Exact match (if product has inclusivitySizing, otherwise matches null)

### 3. Color Matching (OR Logic)
- ✅ Extracts colors from `enrichedColor` column (preferred) or `color` column (fallback)
- ✅ Handles comma-separated colors in `enrichedColor`
- ✅ Matches products with **ANY one or more** of the product's colors (OR logic)
- ✅ Checks multiple sources:
  - `enrichedColor` column (comma-separated, split and checked individually)
  - `color` column
  - `attributes->>'Color'` or `attributes->>'color'` (JSON fallback)
- ✅ Products matching colors rank higher in results

### 4. Product Deduplication
- ✅ Uses the same deduplication logic as product discovery
- ✅ Excludes all variants of the original product (using dedup_key)
- ✅ Returns only unique products (one per dedup_key)

## Implementation Details

### API Endpoint
**Route**: `GET /api/products/[productId]/similar`

**Query Parameters**:
- `excludeProductIds` (optional): Comma-separated list of product IDs to exclude

### Frontend Integration
**File**: `src/components/Chat/ChatPanel.tsx`
- `handleProductFindSimilar` function collects shown product IDs from:
  - All messages in the conversation
  - `conversationContext.lastShownProductIds`
- Passes them as `excludeProductIds` query parameter

### Backend Implementation
**File**: `src/app/api/products/[productId]/similar/route.ts`

#### Product Data Extraction
Extracts the following from the original product:
- `category`, `gender`, `ageGroup`, `inclusivitySizing`, `priceCents`
- `setVsSingle` (from attributes JSON)
- `color` and `enrichedColor` (for color matching)
- `embedding` (optional, for ranking)

#### SQL Query Structure
```sql
WITH ranked_products AS (
  SELECT 
    p.id as "productId",
    similarity,  -- From embedding (if available) or 0.5
    color_match_score,  -- 1 if matches any color, 0 otherwise
    dedup_key
  FROM "Product" p
  WHERE 
    -- Hard filters (AND logic)
    p."merchantId" = $1
    AND p.category = $2
    AND p.gender = $3 (or IS NULL/unisex)
    AND p."ageGroup" = $4 (or IS NULL)
    AND p."inclusivitySizing" = $5 (or IS NULL)
    AND COALESCE(p.attributes->>'setVsSingle', 'Single') = $6
    AND p."stockStatus" = 'in_stock'
    AND p."isActive" = true
    AND p."priceCents" >= $7 AND p."priceCents" <= $8
    AND p.id != $9  -- Exclude original product
    AND p.id != ALL($10::text[])  -- Exclude shown products
    AND (
      -- Color matching (OR logic - matches ANY color)
      EXISTS (SELECT 1 FROM unnest(string_to_array(LOWER(p."enrichedColor"), ',')) WHERE TRIM(...) = ANY($11::text[]))
      OR LOWER(p.color) = ANY($11::text[])
      OR LOWER(p.attributes->>'Color') = ANY($11::text[])
    )
  ORDER BY color_match_score DESC, similarity DESC
  LIMIT 50
),
deduplicated AS (
  SELECT ..., ROW_NUMBER() OVER (PARTITION BY dedup_key ORDER BY ...) as dedup_rank
  FROM ranked_products
)
SELECT "productId", similarity
FROM deduplicated
WHERE dedup_rank = 1
  AND dedup_key != $12  -- Exclude original product variants
ORDER BY color_match_score DESC, similarity DESC
LIMIT 4
```

#### Ranking Priority
1. **Color Match Score** (1 if matches any color, 0 otherwise)
2. **Embedding Similarity** (if embedding exists) or **Price** (ascending, if no embedding)

## Key Features

### Color Extraction
- **Primary Source**: `enrichedColor` column (can be comma-separated)
- **Fallback**: `color` column
- **Additional Fallback**: `attributes->>'Color'` or `attributes->>'color'` (JSON)
- **Normalization**: All colors converted to lowercase for matching

### Color Matching Logic
- **OR Logic**: Products match if they have **ANY** of the product's colors
- **Individual Treatment**: Each color in the product is treated separately
- **Example**: If product has colors ["Red", "Blue", "Green"], matches products with Red OR Blue OR Green

### Price Matching
- **Tolerance**: ±20% of original product price
- **Calculation**: `priceMin = priceCents - (priceCents * 0.2)`, `priceMax = priceCents + (priceCents * 0.2)`

### Null Handling
- **Gender**: If null, matches products with `gender IS NULL OR gender = 'unisex'`
- **AgeGroup**: If null, matches products with `ageGroup IS NULL`
- **InclusivitySizing**: If null, matches products with `inclusivitySizing IS NULL`
- **SetVsSingle**: If null, defaults to "Single" and matches products with "Single"

## Testing Recommendations

1. **Test with products that have multiple colors**: Verify OR logic works correctly
2. **Test with products missing optional fields**: Verify null handling
3. **Test with excludeProductIds**: Verify already shown products are excluded
4. **Test price range**: Verify products within ±20% price range are returned
5. **Test deduplication**: Verify variants of the original product are excluded
6. **Test with/without embedding**: Verify ranking works in both cases

## Logging
The implementation includes comprehensive logging:
- Product extraction details
- Matching criteria used
- Excluded product IDs count
- Results count and categories
- Ranking priority used
