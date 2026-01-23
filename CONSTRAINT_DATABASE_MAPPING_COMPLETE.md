# Complete Constraint-to-Database Mapping Verification

This document provides a comprehensive mapping of all constraints from dictionary extraction → LLM extraction → database queries → ranking/filtering.

## Mapping Structure

For each constraint type, we document:
1. **Dictionary Extraction Sources**: Which database columns/attributes are used to build the dictionary
2. **LLM Extraction**: What the LLM extracts (dictionary values)
3. **Database Query Mapping**: How constraints are applied in SQL queries (hard filters)
4. **Ranking/Filtering Matching**: How constraints are matched in memory (soft filters/ranking)

---

## 1. Colors

### Dictionary Extraction Sources ✅
- `product.enrichedColor` (comma-separated, primary: "White, Bright White, Pure White")
- `product.color` (single value, fallback)
- `attributes.color` or `attributes.Color` (JSONB fallback)

### LLM Extraction ✅
- Extracts color values from dictionary (e.g., "Blue", "Red", "Navy Blue")
- Uses intent format: `{ values: ["Blue"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (colors are matched in memory for ranking)
- Colors are post-SQL filtered using dictionary matching

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.enrichedColor` (database column, primary)
2. `enrichedColumns.color` (database column, fallback)
3. `attributes.color` or `attributes.Color` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchColor()`

---

## 2. Materials

### Dictionary Extraction Sources ✅
- `product.material` (primary)
- `product.fabric` (alternative)
- `product.fabricFamily` (alternative)
- `attributes.material` or `attributes.Material` or `attributes.fabric` or `attributes.Fabric` (JSONB fallback)

### LLM Extraction ✅
- Extracts material values from dictionary (e.g., "Cotton", "Silk", "Linen")
- Uses intent format: `{ values: ["Cotton"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (materials are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.material` (database column, primary)
2. `enrichedColumns.fabric` (database column, alternative)
3. `attributes.material` or `attributes.Material` or `attributes.fabric` or `attributes.Fabric` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchMaterial()`

---

## 3. Styles

### Dictionary Extraction Sources ✅
- `product.silhouetteCut` (primary: A-Line, Wrap, Fit and Flare, Empire, etc.)
- `attributes.style_labels` or `attributes.styleLabels` (secondary)
- `attributes.style` or `attributes.Style` (fallback)

### LLM Extraction ✅
- Extracts style values from dictionary (e.g., "A-Line", "Wrap", "Empire Waist", "Fit and Flare")
- Uses intent format: `{ values: ["A-Line"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (styles are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.silhouetteCut` (database column, primary)
2. `attributes.style_labels` or `attributes.styleLabels` (JSONB, secondary)
3. `attributes.style` or `attributes.Style` (JSONB, fallback)
4. Inference from product metadata (title, description, collection)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchStyle()`

---

## 4. Patterns

### Dictionary Extraction Sources ✅
- `attributes.pattern` or `attributes.Pattern` or `attributes.pattern_print` or `attributes.patternPrint` (JSONB only)

### LLM Extraction ✅
- Extracts pattern values from dictionary (e.g., "Floral", "Polka Dot", "Striped")
- Uses intent format: `{ values: ["Floral"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter** in vector search: `p.attributes->>'pattern_print'` (exact match OR LIKE match)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `attributes.pattern` or `attributes.Pattern` or `attributes.pattern_print` or `attributes.patternPrint` (JSONB)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchPattern()`

**SQL Filter Location**: `src/lib/search/vector/index.ts` (pattern filter in WHERE clause)

---

## 5. Occasions

### Dictionary Extraction Sources ✅
- `product.occasion` (primary, comma-separated string: "Daytime, Vacation")
- `product.occasionContext` (primary, array: ["Daytime", "Vacation"])
- `attributes.occasion` or `attributes.Occasion` (JSONB fallback)

### LLM Extraction ✅
- Extracts occasion values from dictionary (e.g., "Wedding", "Beach", "Office")
- Uses intent format: `{ values: ["Wedding"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter** when intent is "strong" or "required":
  - Maps to `occasionContext` column (array, GIN indexed): `occasionContext @> ARRAY['Wedding']::text[]`
  - OR filter: products matching ANY value in the array

**Location**: `src/lib/search/query/buildFilters.ts` (maps `occasions` to `occasionContext`)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.occasionContext` (database column, array, primary)
2. `enrichedColumns.occasion` (database column, comma-separated string, primary)
3. `attributes.occasion` or `attributes.Occasion` (JSONB fallback)
4. Inference from product metadata (title, description, category)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchOccasion()`

---

## 6. Lengths

### Dictionary Extraction Sources ✅
- `product.length` (primary: "Maxi", "Mini", "Midi", etc.)
- `attributes.length` or `attributes.Length` (JSONB fallback)

### LLM Extraction ✅
- Extracts length values from dictionary (e.g., "Maxi", "Mini", "Midi")
- Uses intent format: `{ values: ["Maxi"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter**: `length IN ('Maxi', 'Mini', ...)`

**Location**: `src/lib/search/query/buildFilters.ts` (maps to `length` column)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.length` (database column, primary)
2. `attributes.length` or `attributes.Length` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.length`)

---

## 7. SleeveLengths

### Dictionary Extraction Sources ✅
- `product.sleeve` (primary: "Long Sleeve", "Short Sleeve", "Sleeveless", etc.)
- `attributes.sleeve` or `attributes.Sleeve` or `attributes.sleeveLength` or `attributes.sleeve_length` (JSONB fallback)

### LLM Extraction ✅
- Extracts sleeve length values from dictionary (e.g., "Long Sleeve", "Short Sleeve", "Cap Sleeve")
- Uses intent format: `{ values: ["Long Sleeve"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter** in vector search: `p.sleeve IN ('Long Sleeve', ...)`

**Location**: `src/lib/search/vector/index.ts` (sleeve filter in WHERE clause)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.sleeve` (database column, primary)
2. `attributes.sleeve` or `attributes.Sleeve` or `attributes.sleeveLength` or `attributes.sleeve_length` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.sleeve`)

---

## 8. Necklines

### Dictionary Extraction Sources ✅
- `product.neckline` (primary: "V-Neck", "Round", "Scoop", etc.)
- `attributes.neckline` or `attributes.Neckline` or `attributes.neckline_depth` or `attributes.necklineDepth` (JSONB fallback)

### LLM Extraction ✅
- Extracts neckline values from dictionary (e.g., "V-Neck", "Round", "Scoop")
- Uses intent format: `{ values: ["V-Neck"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (necklines are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.neckline` (database column, primary)
2. `attributes.neckline` or `attributes.Neckline` or `attributes.neckline_depth` or `attributes.necklineDepth` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.neckline`)

---

## 9. Fits

### Dictionary Extraction Sources ✅
- `product.fit` (primary)
- `product.fitPreference` (alternative)
- `attributes.fit` or `attributes.Fit` or `attributes.fit_preference` or `attributes.fitPreference` (JSONB fallback)

### LLM Extraction ✅
- Extracts fit values from dictionary (e.g., "Slim Fit", "Relaxed Fit", "Skinny")
- Uses intent format: `{ values: ["Slim Fit"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (fits are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.fit` (database column, primary)
2. `attributes.fit` or `attributes.Fit` or `attributes.fit_preference` or `attributes.fitPreference` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.fit`)

---

## 10. Rises

### Dictionary Extraction Sources ✅
- `product.riseWaist` (primary: "High Rise", "Mid Rise", "Low Rise")
- `attributes.rise` or `attributes.Rise` or `attributes.rise_waist` or `attributes.riseWaist` (JSONB fallback)

### LLM Extraction ✅
- Extracts rise values from dictionary (e.g., "High Rise", "Mid Rise", "Low Rise")
- Uses intent format: `{ values: ["High Rise"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (rises are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.riseWaist` (database column, primary)
2. `attributes.rise` or `attributes.Rise` or `attributes.rise_waist` or `attributes.riseWaist` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.riseWaist`)

---

## 11. Seasons

### Dictionary Extraction Sources ✅
- `product.season` (primary)
- `product.seasonalCues` (alternative, comma-separated: "Fall, Spring")
- `product.seasonalPalette` (separate constraint)
- `attributes.season` or `attributes.Season` or `attributes.seasonal_cues` or `attributes.seasonalCues` (JSONB fallback)

### LLM Extraction ✅
- Extracts season values from dictionary (e.g., "Summer", "Winter", "Spring", "Fall")
- Uses intent format: `{ values: ["Summer"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (seasons are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.season` (database column, primary)
2. `enrichedColumns.seasonalCues` (database column, alternative)
3. `attributes.season` or `attributes.Season` or `attributes.seasonal_cues` or `attributes.seasonalCues` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchSeason()`

---

## 12. FormalityLevel

### Dictionary Extraction Sources ✅
- `product.formalityLevel` (primary: "Formal", "Semi-Formal", "Casual")
- `attributes.formalityLevel` or `attributes.FormalityLevel` (JSONB fallback)

### LLM Extraction ✅
- Extracts formality level values from dictionary (e.g., "Formal", "Semi-Formal", "Casual")
- Uses intent format: `{ values: ["Formal"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter**: `formalityLevel IN ('Formal', 'Semi-Formal', ...)`

**Location**: `src/lib/search/query/buildFilters.ts` (maps to `formalityLevel` column)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.formalityLevel` (database column, primary)
2. `attributes.formalityLevel` or `attributes.FormalityLevel` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.formalityLevel`)

---

## 13. ColorShade

### Dictionary Extraction Sources ✅
- `product.colorShade` (primary: "Light", "Dark", "Medium")
- `attributes.colorShade` or `attributes.color_shade` or `attributes.ColorShade` (JSONB fallback)

### LLM Extraction ✅
- Extracts color shade values from dictionary (e.g., "Light", "Dark", "Medium")
- Uses intent format: `{ values: ["Light"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter**: `colorShade IN ('Light', 'Dark', ...)`

**Location**: `src/lib/search/query/buildFilters.ts` (maps to `colorShade` column)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.colorShade` (database column, primary)
2. `attributes.colorShade` or `attributes.color_shade` or `attributes.ColorShade` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.colorShade`)

---

## 14. ColorUndertone

### Dictionary Extraction Sources ✅
- `product.colorUndertone` (primary: "Warm", "Cool", "Neutral")
- `attributes.colorUndertone` or `attributes.color_undertone` or `attributes.ColorUndertone` (JSONB fallback)

### LLM Extraction ✅
- Extracts color undertone values from dictionary (e.g., "Warm", "Cool", "Neutral")
- Uses intent format: `{ values: ["Warm"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter**: `colorUndertone IN ('Warm', 'Cool', ...)`

**Location**: `src/lib/search/query/buildFilters.ts` (maps to `colorUndertone` column)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.colorUndertone` (database column, primary)
2. `attributes.colorUndertone` or `attributes.color_undertone` or `attributes.ColorUndertone` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.colorUndertone`)

---

## 15. SeasonalPalette

### Dictionary Extraction Sources ✅
- `product.seasonalPalette` (primary)
- `attributes.seasonalPalette` or `attributes.SeasonalPalette` (JSONB fallback)

### LLM Extraction ✅
- Extracts seasonal palette values from dictionary
- Uses intent format: `{ values: [...], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (seasonal palette is matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.seasonalPalette` (database column, primary)
2. `attributes.seasonalPalette` or `attributes.SeasonalPalette` (JSONB fallback)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.seasonalPalette`)

---

## 16. Embellishments

### Dictionary Extraction Sources ✅
- `attributes.embellishments` or `attributes.embellishment` or `attributes.detailing` or `attributes.Detailing` (JSONB only)

### LLM Extraction ✅
- Extracts embellishment values from dictionary (e.g., "Lace", "Sequins", "Embroidery")
- Uses intent format: `{ values: ["Lace"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (embellishments are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `attributes.embellishments` or `attributes.embellishment` or `attributes.detailing` or `attributes.Detailing` (JSONB)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchEmbellishment()`

---

## 17. Collections

### Dictionary Extraction Sources ✅
- `attributes.collection` or `attributes.collections` or `attributes.Collection` or `attributes.Collections` (JSONB only)

### LLM Extraction ✅
- Extracts collection values from dictionary (e.g., "Spring Collection", "Wedding Collection")
- Uses intent format: `{ values: ["Spring Collection"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (collections are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `attributes.collection` or `attributes.collections` or `attributes.Collection` or `attributes.Collections` (JSONB)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchCollection()`

---

## 18. Sizes

### Dictionary Extraction Sources ✅
- `attributes.sizes` or `attributes.size` or `attributes.Sizes` or `attributes.Size` (JSONB only)

### LLM Extraction ✅
- Extracts size values from dictionary (e.g., "4", "6", "S", "M", "L")
- Uses intent format: `{ values: ["4"], intent: "required" }`

### Database Query Mapping ✅
- **NOT applied as hard SQL filter** (sizes are matched in memory for ranking)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `attributes.sizes` or `attributes.size` or `attributes.Sizes` or `attributes.Size` (JSONB)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts::matchSize()`

---

## 19. AgeGroups

### Dictionary Extraction Sources ✅
- `product.ageGroup` (primary: "Adult", "Kids", "Baby, Toddler")
- Inferred from product metadata (title, description) as fallback

### LLM Extraction ✅
- Extracts age group values from dictionary (e.g., "Adult", "Kids", "Baby")
- Uses intent format: `{ values: ["Adult"], intent: "required" }`

### Database Query Mapping ✅
- **Applied as hard SQL filter**: `ageGroup = 'Adult'` (exact match)

**Location**: `src/lib/search/query/buildFilters.ts` (maps to `ageGroup` column)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.ageGroup` (database column, primary)
2. Inference from product metadata (title, description)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.ageGroup`)

---

## 20. InclusivitySizing

### Dictionary Extraction Sources ✅
- `product.inclusivitySizing` (primary: "Plus Size", "Petite", "Tall", "Extended Sizes", "Standard Sizing")

### LLM Extraction ✅
- Extracts inclusivity sizing values from dictionary (e.g., "Plus Size", "Petite", "Tall")
- Uses intent format: `{ values: ["Plus Size"], intent: "required" }`
- **Default**: If not extracted, defaults to `["Standard Sizing"]`

### Database Query Mapping ✅
- **Applied as hard SQL filter**: `inclusivitySizing IN ('Plus Size', 'Petite', ...)` (OR filter)
- **Default**: `inclusivitySizing = 'Standard Sizing'` if not extracted

**Location**: 
- `src/lib/search/query/buildFilters.ts` (maps to `inclusivitySizing` column)
- `src/lib/search/vector/index.ts` (inclusivitySizing filter in WHERE clause)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `enrichedColumns.inclusivitySizing` (database column, primary)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `enrichedColumns.inclusivitySizing`)

---

## 21. SetVsSingle

### Dictionary Extraction Sources ✅
- `attributes.set_vs_single` or `attributes.setVsSingle` (JSONB only: "Set" or "Single")

### LLM Extraction ✅
- Extracts set vs single values from dictionary (e.g., "Set", "Single")
- Uses intent format: `{ values: ["Set"], intent: "required" }`
- **Default**: If not extracted, defaults to `["Single"]` (excludes pack products)

### Database Query Mapping ✅
- **Applied as hard SQL filter**: `attributes->>'set_vs_single' = ANY(ARRAY['Set']::text[])` or `= ANY(ARRAY['Single']::text[])`
- **Default**: `attributes->>'set_vs_single' = 'Single'` if not extracted

**Location**: 
- `src/lib/search/query/buildFilters.ts` (maps to `setVsSingle` column)
- `src/lib/search/vector/index.ts` (setVsSingle filter in WHERE clause)
- `src/lib/search/ranking/dbRankedSearch.ts` (setVsSingle filter in WHERE clause)

### Ranking/Filtering Matching ✅
**Priority Order** (matches dictionary extraction):
1. `attributes.set_vs_single` or `attributes.setVsSingle` (JSONB)

**Location**: `src/lib/loveshackfancy/ranking/constraint-matcher.ts` (uses `attributes.set_vs_single`)

---

## Summary: All Constraints Verified ✅

### Hard SQL Filters (Applied at Database Level)
1. ✅ **lengths** → `length` column
2. ✅ **formalityLevel** → `formalityLevel` column
3. ✅ **occasionContext** (from occasions) → `occasionContext` array column (GIN indexed)
4. ✅ **colorShade** → `colorShade` column
5. ✅ **colorUndertone** → `colorUndertone` column
6. ✅ **ageGroups** → `ageGroup` column
7. ✅ **inclusivitySizing** → `inclusivitySizing` column
8. ✅ **setVsSingle** → `attributes->>'set_vs_single'` JSONB field
9. ✅ **patterns** → `attributes->>'pattern_print'` JSONB field (in vector search)
10. ✅ **sleeveLengths** → `sleeve` column (in vector search)

### Soft Filters/Ranking (Applied in Memory)
1. ✅ **colors** → `enrichedColor` column → `color` column → `attributes.color`
2. ✅ **materials** → `material` column → `fabric` column → `attributes.material`
3. ✅ **styles** → `silhouetteCut` column → `attributes.style_labels` → `attributes.style`
4. ✅ **occasions** → `occasionContext` array → `occasion` column → `attributes.occasion`
5. ✅ **seasons** → `season` column → `seasonalCues` column → `attributes.season`
6. ✅ **necklines** → `neckline` column → `attributes.neckline`
7. ✅ **fits** → `fit` column → `attributes.fit`
8. ✅ **rises** → `riseWaist` column → `attributes.rise`
9. ✅ **seasonalPalette** → `seasonalPalette` column → `attributes.seasonalPalette`
10. ✅ **embellishments** → `attributes.embellishments`
11. ✅ **collections** → `attributes.collection`
12. ✅ **sizes** → `attributes.sizes`

### Verification Status: ✅ ALL CONSTRAINTS CORRECTLY MAPPED

All constraints are correctly mapped from dictionary extraction sources to database queries and ranking/filtering logic. The priority order (database column → JSONB attributes) is consistent across all constraint types.
