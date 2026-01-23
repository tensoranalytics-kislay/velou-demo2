# LoveShackFancy Brand Boost Implementation

## Issue

LoveShackFancy products are not appearing in search results, even though:
- ✅ 1,082 LoveShackFancy products exist (3rd most common brand)
- ✅ 233 LoveShackFancy dresses exist
- ✅ Products are being retrieved (visible in logs)
- ❌ But they're not making it to the top 4 results

## Root Cause

1. **No Brand Preference**: All brands compete on equal footing
2. **Quiz Advantage**: Quiz has 5x more products (1,234 dresses vs 233), giving them more chances to score high
3. **Price Difference**: LoveShackFancy products are more expensive ($295-$795 vs $24.99-$54.99), but this shouldn't affect ranking
4. **Color Matching**: While color matching works, Quiz products might match other constraints better

## Solution Implemented

### 1. Added Brand-Based Boosting

**File**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts`

Added a **25% boost** to LoveShackFancy products in the constraint matching score:

```typescript
// Brand-based boosting: Boost LoveShackFancy products (this is a LoveShackFancy demo site)
const productBrand = enriched?.brand ?? 
                     ('brand' in product ? (product as any).brand : null) ??
                     (attrs as any)?.brand ?? 
                     null;
const brandLower = productBrand ? String(productBrand).toLowerCase() : '';
const isLoveShackFancy = brandLower === 'loveshackfancy' || 
                        brandLower === 'lsf' ||
                        (productTitle && productTitle.toLowerCase().includes('loveshackfancy'));

if (isLoveShackFancy) {
  // Add 25% boost to LoveShackFancy products
  const brandBoost = 0.25;
  finalScore = Math.min(1.0, finalScore + brandBoost);
}
```

### 2. Added Brand Field to Product Loading

**File**: `src/lib/loveshackfancy/orchestrator.ts`

- Added `brand: true` to the Prisma select query
- Added `brand: product.brand ?? null` to the product mapping

### 3. Added Brand to SearchResultItem Type

**File**: `src/lib/search/types.ts`

- Added `brand?: string | null;` to `SearchResultItem` type

## How It Works

1. **During Constraint Matching**: When calculating the constraint match score, the system checks if the product is a LoveShackFancy product
2. **Brand Detection**: Checks:
   - `enriched.brand` (from database column)
   - `product.brand` (from product object)
   - `attrs.brand` (from JSONB attributes)
   - Product title (contains "loveshackfancy")
3. **Boost Application**: If detected, adds 25% to the final constraint score
4. **Ranking**: Products with higher scores rank higher, so LoveShackFancy products should appear in top results

## Testing

After implementation, test with:
- "I want a blue dress" - Should show LoveShackFancy dresses
- "I am looking for women's dresses" - Should show LoveShackFancy dresses
- "suggest me a floral dress" - Should show LoveShackFancy dresses

## Expected Results

- LoveShackFancy products should appear in the top 4 results
- At least 1-2 LoveShackFancy products per query (depending on query specificity)
- Brand field should be visible in product cards (currently showing as "Unknown" - needs fix)

## Next Steps

1. ✅ Brand boost implemented (25%)
2. ⏳ Test with multiple queries to verify LoveShackFancy products appear
3. ⏳ Fix brand display in product cards (currently showing as "Unknown")
4. ⏳ Monitor logs to verify boost is being applied

## Notes

- The 25% boost should be sufficient to overcome Quiz's advantage
- If LoveShackFancy products still don't appear, consider:
  - Increasing boost to 30-40%
  - Adding brand-based filtering (only show LoveShackFancy products)
  - Checking if products are being filtered out before ranking
