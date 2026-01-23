# LoveShackFancy Products Not Appearing in Recommendations

## Issue Summary

LoveShackFancy products are not appearing in search results, even though:
- ✅ 1,082 LoveShackFancy products exist in the database (3rd most common brand)
- ✅ 233 LoveShackFancy dresses exist
- ✅ Products are being retrieved (visible in logs)
- ❌ But they're not making it to the top 4 results

## Root Cause Analysis

### 1. **Color Matching Issue**
- **Problem**: LoveShackFancy uses specific color names (e.g., "Coastline Blue", "Light Blue", "Icicle Blue") that may not match extracted color constraints (e.g., "Blue", "Medium Blue", "Denim Blue")
- **Evidence**: 
  - Query "I want a blue dress" extracts colors: `["Blue", "Medium Blue", "Denim Blue"]`
  - LoveShackFancy dress "Chessie Cotton Floral Maxi Dress for Women in Coastline Blue" has colors: `["White", "Light Blue", "Pink", "Floral"]`
  - "Light Blue" might not match "Blue" or "Medium Blue" in the constraint matching logic

### 2. **Price Difference**
- **LoveShackFancy**: $295-$795 per dress
- **Quiz**: $24.99-$54.99 per dress
- While there's no explicit price-based ranking, the constraint matching might favor Quiz products due to:
  - More products (5x more dresses = more chances to match)
  - Better color constraint matching

### 3. **No Brand-Based Boosting**
- There's no code that boosts LoveShackFancy products specifically
- All brands compete on equal footing based on:
  - Vector similarity score
  - Constraint matching score
  - No brand preference

### 4. **Vector Search Ranking**
- Vector search might be matching Quiz products better due to:
  - More training data (5x more products)
  - Better embeddings for common color names
  - Semantic similarity favoring Quiz's product descriptions

## Recommendations

### Option 1: Add Brand-Based Boosting (Recommended)
Add a boost for LoveShackFancy products in the ranking logic:

```typescript
// In constraint-matcher.ts or ranking logic
const brandBoost = product.brand?.toLowerCase() === 'loveshackfancy' || 
                   product.brand?.toLowerCase() === 'lsf' 
  ? 0.2  // 20% boost
  : 0;
```

### Option 2: Improve Color Matching
Make color matching more flexible to handle variations:
- "Light Blue" should match "Blue"
- "Coastline Blue" should match "Blue"
- "Icicle Blue" should match "Blue"

### Option 3: Add Brand Filtering Option
Allow users to filter by brand, or add a preference for LoveShackFancy products when the merchant is LoveShackFancy.

## Current State

- **Total Products**: 5,490
- **LoveShackFancy Products**: 1,082 (19.7%)
- **LoveShackFancy Dresses**: 233 (2nd most common brand after Quiz with 1,234)
- **Quiz Dresses**: 1,234 (most common)

## Test Results

Query: "I want a blue dress"
- **Products Returned**: 4
- **All Quiz Brand**: Yes
- **LoveShackFancy Products Retrieved**: Yes (visible in logs)
- **LoveShackFancy Products in Top 4**: No

## Next Steps

1. ✅ Verify LoveShackFancy products exist and are active
2. ✅ Check if they're being retrieved (they are)
3. ⏳ Check color matching logic for flexibility
4. ⏳ Consider adding brand-based boosting for LoveShackFancy
5. ⏳ Test with queries that explicitly mention LoveShackFancy
