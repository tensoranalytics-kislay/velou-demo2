# Fix: inclusivitySizing Not Being Extracted

## Problem

The LLM was not extracting `inclusivitySizing` for queries like "I am a curvy mom/woman, suggest me a dress" because:

1. **Category-specific dictionaries were missing `inclusivitySizing`**: The `category-constraint-dictionaries.json` file didn't include `inclusivitySizing` values for any categories, so when the prompt tried to show dictionary values to the LLM, it showed an empty list or "No inclusivitySizing found".

2. **Build script didn't extract it**: The `build-category-constraint-dictionaries.ts` script was missing:
   - `inclusivitySizing` in the database `select` query
   - `inclusivitySizing` in the `constraintSets` initialization
   - Extraction logic for `inclusivitySizing` from products
   - `inclusivitySizing` in the output dictionary

## Solution

Updated `scripts/build-category-constraint-dictionaries.ts` to:

1. ✅ Added `inclusivitySizing: true` to the database select query
2. ✅ Added `inclusivitySizing: new Set<string>()` to `constraintSets`
3. ✅ Added extraction logic for `inclusivitySizing` from:
   - `product.inclusivitySizing` column (handles comma-separated values)
   - `attributes.inclusivitySizing` JSONB field
4. ✅ Added `inclusivitySizing: Array.from(constraintSets.inclusivitySizing).sort()` to output dictionary
5. ✅ Updated `CategoryConstraintDictionary` interface to include `inclusivitySizing: string[]`

## Result

After rebuilding the dictionaries:
- ✅ `category-constraint-dictionaries.json` now includes `inclusivitySizing` for all categories
- ✅ "Women's Dresses" now has: `["Extended Sizes", "Plus Size", "Standard Sizing"]`
- ✅ The LLM prompt will now show these values, allowing it to extract `inclusivitySizing` from queries like "curvy mom"

## Next Steps

1. ✅ Rebuild dictionaries (done)
2. Test query "I am a curvy mom/woman, suggest me a dress" again
3. Verify `inclusivitySizing: ["Plus Size"]` is extracted with `intent: "required"`
