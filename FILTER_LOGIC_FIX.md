# Filter Logic Fix - OR vs AND Filters

## Issue
User requested that:
1. **Colors should be searched with OR logic** (products matching ANY color, not ALL colors)
2. **Everything except Adult, Gender, and Category should use OR filters** (constraints are OR'd together, not AND'd)

## Problem
Colors were being added to `whereConditions`, which are combined with `AND`. This meant:
- Colors were AND'd with other constraints
- Products had to match ALL colors (impossible) instead of ANY color

## Fix

### Changed: Colors from `whereConditions` to `constraintConditions`

**Before:**
```typescript
// Colors added to whereConditions (AND'd with everything)
if (colorOrConditions.length > 0) {
  whereConditions.push(`(${colorOrConditions.join(' OR ')})`);
}
```

**After:**
```typescript
// Colors added to constraintConditions (OR'd with other constraints)
if (colorOrConditions.length > 0) {
  constraintConditions.push(`(${colorOrConditions.join(' OR ')})`);
  logger.debug('searchVectorIndexWithDeduplication: color_filter_applied', {
    colors: filters.colors,
    colorCount: filters.colors.length,
    note: 'Color filter added to constraintConditions (OR'd with other constraints)',
  });
}
```

## Filter Logic Summary

### AND Filters (Hard Requirements)
These are combined with `AND` - products MUST match ALL of these:
- **Category** - Product must be in one of the specified categories
- **Gender** - Product must match the specified gender
- **AgeGroup** - Product must match the specified age group

### OR Filters (Flexible Matching)
These are combined with `OR` - products matching ANY of these will be included:
- **Colors** - Product matches ANY of the specified colors ✅ (FIXED)
- **Patterns** - Product matches ANY of the specified patterns
- **Occasions** - Product matches ANY of the specified occasions
- **Materials** - Product matches ANY of the specified materials
- **Sleeves** - Product matches ANY of the specified sleeve lengths
- **Necklines** - Product matches ANY of the specified necklines
- **Sizes** - Product matches ANY of the specified sizes
- **Fits** - Product matches ANY of the specified fits
- **Styles** - Product matches ANY of the specified styles
- **Collections** - Product matches ANY of the specified collections
- **Seasons** - Product matches ANY of the specified seasons
- **Rises** - Product matches ANY of the specified rises
- **Embellishments** - Product matches ANY of the specified embellishments
- **FormalityLevel** - Product matches ANY of the specified formality levels
- **ColorShade** - Product matches ANY of the specified color shades
- **ColorUndertone** - Product matches ANY of the specified color undertones
- **SeasonalPalette** - Product matches ANY of the specified seasonal palettes

## SQL Query Structure

The final WHERE clause structure is:
```sql
WHERE 
  -- AND filters (hard requirements)
  (category = 'X' OR category = 'Y') AND
  (gender = 'male' OR gender = 'female') AND
  (ageGroup = 'Adult' OR ageGroup = 'Kids') AND
  
  -- OR filters (flexible matching)
  (
    (color = 'White' OR color = 'Navy Blue' OR color = 'Black') OR
    (occasion = 'Work') OR
    (pattern = 'Floral') OR
    (material = 'Cotton') OR
    ...
  )
```

## Result

✅ **Colors are now OR'd with other constraints**
- Products matching ANY color will be included
- Products matching ANY occasion will be included
- Products matching ANY pattern will be included
- etc.

✅ **Only Category, Gender, and AgeGroup remain as AND filters**
- Products must match the specified category
- Products must match the specified gender
- Products must match the specified age group

## Testing

Run the office dress query to verify:
- Colors: `['White', 'Navy Blue', 'Black', 'Beige', 'Gray', 'Blush']` are OR'd
- Occasions: `['Work']` is OR'd with colors
- Category: `["Women's Dresses"]` is AND'd
- AgeGroup: `['Adult']` is AND'd

The query should now return products that:
- Match category "Women's Dresses" AND
- Match age group "Adult" AND
- Match (ANY color OR Work occasion)
