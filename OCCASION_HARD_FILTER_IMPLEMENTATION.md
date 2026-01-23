# Occasion Hard Filter Implementation

## Summary

Updated the system to use occasions as **hard SQL filters** when extracted with "strong" or "required" intent, using an **OR filter** (multiple occasions = OR, not AND).

---

## Changes Made

### 1. `src/lib/loveshackfancy/retrieval.ts`

**Location**: `classificationToSearchConstraints` function (lines 1436-1451)

**Change**: Added logic to map `occasions` to `occasionContext` when intent is "strong" or "required"

```typescript
// Occasions: if intent is "strong" or "required", map to occasionContext for hard SQL filter (OR filter)
occasionContext: (() => {
  if (occasionIntent === 'excluded') {
    return undefined;
  }
  // Map occasions to occasionContext when intent is "strong" or "required" (hard SQL filter)
  if ((occasionIntent === 'strong' || occasionIntent === 'required') && occasionValues && occasionValues.length > 0) {
    logger.info('classificationToSearchConstraints_occasions_to_occasionContext', {
      occasions: occasionValues,
      intent: occasionIntent,
      note: 'Mapping occasions to occasionContext for hard SQL filter (OR filter)',
    });
    return occasionValues;
  }
  return undefined;
})(),
```

**Behavior**:
- When `occasionIntent === 'strong'` or `'required'` → Map `occasions` to `occasionContext` for hard SQL filtering
- When `occasionIntent === 'excluded'` → Do not apply filter
- When `occasionIntent === 'preferred'` or `undefined` → Do not apply as hard filter (used for ranking only)

---

### 2. `src/lib/search/query/buildFilters.ts`

**Location**: `buildBroadWhereFilters` function (lines 102-111)

**Change**: Added fallback to map `occasions` to `occasionContext` if `occasionContext` is not already set

```typescript
// Occasions: map from occasions to occasionContext if occasions is provided but occasionContext is not
// This handles cases where occasions are extracted but not yet mapped to occasionContext
occasionContext: (() => {
  // Prefer occasionContext if available
  if (constraints.occasionContext?.length) {
    return { hasSome: constraints.occasionContext };
  }
  // Fallback: map occasions to occasionContext (for hard SQL filter)
  if (constraints.occasions?.length) {
    return { hasSome: constraints.occasions };
  }
  return undefined;
})(),
```

**Behavior**:
- Prefer `occasionContext` if already set (from `classificationToSearchConstraints`)
- Fallback: Map `occasions` to `occasionContext` if `occasions` is provided
- Use `hasSome` operator which creates an **OR filter** (array overlap)

---

## How OR Filter Works

The `hasSome` operator in Prisma uses the SQL `&&` (array overlap) operator:

```sql
"occasionContext" && ARRAY['Work', 'Wedding']::text[]
```

This means: **If the product's `occasionContext` array has ANY value in common with the filter array, it matches.**

**Example**:
- Product has: `occasionContext = ['Work', 'Casual']`
- Filter: `['Work', 'Wedding']`
- Result: ✅ **Matches** (because both arrays contain "Work")

This is effectively an **OR filter**: products matching "Work" OR "Wedding" will be returned.

---

## SQL Implementation

The hard filter is applied in `src/lib/search/ranking/dbRankedSearch.ts` (lines 360-366):

```typescript
// Occasion context (array) - GIN && operator for array overlap
if (whereFilters.occasionContext && whereFilters.occasionContext.hasSome?.length) {
  const values = whereFilters.occasionContext.hasSome
    .map((v) => `'${v.replace(/'/g, "''")}'`)
    .join(', ');
  whereParts.push(Prisma.raw(`"occasionContext" && ARRAY[${values}]::text[]`));
}
```

**SQL Generated**:
```sql
"occasionContext" && ARRAY['Work', 'Wedding']::text[]
```

This uses the GIN index on `occasionContext` for efficient filtering.

---

## Example: "I am joining office next month, suggest me something to wear"

### Before This Change:
- **Occasions extracted**: `['Work']` with intent `'strong'`
- **Usage**: Soft ranking only (not applied as hard SQL filter)
- **Result**: All products considered, then ranked by occasion match

### After This Change:
- **Occasions extracted**: `['Work']` with intent `'strong'`
- **Usage**: ✅ **Hard SQL filter** (applied at database level)
- **SQL**: `"occasionContext" && ARRAY['Work']::text[]`
- **Result**: Only products with "Work" in `occasionContext` are returned

---

## Intent Levels

| Intent | Behavior | SQL Filter | Ranking |
|--------|----------|------------|---------|
| `'required'` | ✅ Hard SQL filter | Yes | Yes |
| `'strong'` | ✅ Hard SQL filter | Yes | Yes |
| `'preferred'` | ⚠️ Soft ranking only | No | Yes |
| `undefined` | ⚠️ Soft ranking only | No | Yes |
| `'excluded'` | ❌ Exclude from results | No | No |

---

## Testing

To test this change, run queries with occasion mentions:

1. **"attending a black tie wedding, suggest me a dress"**
   - Should extract: `occasions: ['Wedding']` with intent `'strong'`
   - Should apply: Hard SQL filter for "Wedding"

2. **"I am joining office next month, suggest me something to wear"**
   - Should extract: `occasions: ['Work']` with intent `'strong'`
   - Should apply: Hard SQL filter for "Work"

3. **"something for the beach"**
   - Should extract: `occasions: ['Beach', 'Vacation']` with intent `'strong'`
   - Should apply: Hard SQL filter (OR) - products matching "Beach" OR "Vacation"

---

## Notes

- **OR Filter**: Multiple occasions are combined with OR (not AND), so products matching any of the occasions will be returned
- **GIN Index**: The `occasionContext` column uses a GIN index for efficient array overlap queries
- **Backward Compatible**: If `occasionContext` is already set, it takes precedence over `occasions`
- **Logging**: Added logging to track when occasions are mapped to `occasionContext` for debugging
