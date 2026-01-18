# Constraint-to-Column Mapping Verification

This document verifies that all extracted constraints are correctly mapped to the database columns they were extracted from, ensuring consistency between dictionary extraction, filtering, and ranking.

## Dictionary Extraction Sources

Based on `scripts/build-constraint-dictionaries.ts`, constraints are extracted from:

### ✅ Styles
- **Sources**:
  1. `product.silhouetteCut` column (primary: A-Line, Wrap, Fit and Flare, Empire, etc.)
  2. `attributes.style_labels` or `attributes.styleLabels`
  3. `attributes.style` or `attributes.Style`
- **Ranking/Filtering**: 
  - ✅ **Fixed**: Now checks `enrichedColumns.silhouetteCut` first (matches extraction)
  - ✅ Then checks `attributes.style_labels`
  - ✅ Then checks `attributes.style`

### ✅ Necklines
- **Sources**:
  1. `product.neckline` column (primary)
  2. `attributes.neckline` or `attributes.Neckline` or `attributes.neckline_depth` or `attributes.necklineDepth`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.neckline` first (matches extraction)
  - ✅ Falls back to `attributes.neckline`

### ✅ SleeveLengths
- **Sources**:
  1. `product.sleeve` column (primary)
  2. `attributes.sleeve` or `attributes.Sleeve` or `attributes.sleeveLength` or `attributes.sleeve_length`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.sleeve` first (matches extraction)
  - ✅ Falls back to `attributes.sleeve`

### ✅ Lengths
- **Sources**:
  1. `product.length` column (primary)
  2. `attributes.length` or `attributes.Length`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.length` first (matches extraction)
  - ✅ Falls back to `attributes.length`

### ✅ Fits
- **Sources**:
  1. `product.fit` column (primary)
  2. `product.fitPreference` column
  3. `attributes.fit` or `attributes.Fit` or `attributes.fit_preference` or `attributes.fitPreference`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.fit` first (matches extraction)
  - ✅ Falls back to `attributes.fit`

### ✅ Seasons
- **Sources**:
  1. `product.season` column (primary)
  2. `product.seasonalCues` column
  3. `attributes.season` or `attributes.Season` or `attributes.seasonal_cues` or `attributes.seasonalCues`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.season` first (matches extraction)
  - ✅ Falls back to `attributes.season`

### ✅ Materials
- **Sources**:
  1. `product.material` column (primary)
  2. `product.fabric` column
  3. `attributes.material` or `attributes.Material` or `attributes.fabric` or `attributes.Fabric`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.material` and `enrichedColumns.fabric` first (matches extraction)
  - ✅ Falls back to `attributes.material` or `attributes.fabric`

### ✅ Colors
- **Sources**:
  1. `product.enrichedColor` column (comma-separated, primary)
  2. `product.color` column
  3. `attributes.color` or `attributes.Color`
- **Ranking/Filtering**: 
  - ✅ Uses `enrichedColumns.color` and `enrichedColumns.enrichedColor` (matches extraction)

### ✅ Patterns
- **Sources**:
  1. `attributes.pattern` or `attributes.Pattern` or `attributes.pattern_print` or `attributes.patternPrint`
- **Ranking/Filtering**: 
  - ✅ Checks `attributes.pattern` with multiple variations (matches extraction)

### ✅ Occasions
- **Sources**:
  1. `product.occasion` column (primary)
  2. `product.occasionContext` column (array)
  3. `attributes.occasion` or `attributes.Occasion`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.occasionContext` and `enrichedColumns.occasion` first (matches extraction)
  - ✅ Falls back to `attributes.occasion`

### ✅ FormalityLevel
- **Sources**:
  1. `product.formalityLevel` column (primary)
  2. `attributes.formalityLevel` or `attributes.FormalityLevel`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.formalityLevel` first (matches extraction)
  - ✅ Falls back to `attributes.formalityLevel`

### ✅ Rises
- **Sources**:
  1. `product.riseWaist` column (primary)
  2. `attributes.rise` or `attributes.Rise` or `attributes.rise_waist` or `attributes.riseWaist`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.riseWaist` first (matches extraction)
  - ✅ Falls back to `attributes.rise`

### ✅ ColorShade
- **Sources**:
  1. `product.colorShade` column (primary)
  2. `attributes.colorShade` or `attributes.color_shade` or `attributes.ColorShade`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.colorShade` first (matches extraction)
  - ✅ Falls back to `attributes.colorShade`

### ✅ ColorUndertone
- **Sources**:
  1. `product.colorUndertone` column (primary)
  2. `attributes.colorUndertone` or `attributes.color_undertone` or `attributes.ColorUndertone`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.colorUndertone` first (matches extraction)
  - ✅ Falls back to `attributes.colorUndertone`

### ✅ SeasonalPalette
- **Sources**:
  1. `product.seasonalPalette` column (primary)
  2. `attributes.seasonalPalette` or `attributes.SeasonalPalette`
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.seasonalPalette` first (matches extraction)
  - ✅ Falls back to `attributes.seasonalPalette`

### ✅ Embellishments
- **Sources**:
  1. `attributes.embellishments` or `attributes.embellishment` or `attributes.detailing` or `attributes.Detailing`
- **Ranking/Filtering**: 
  - ✅ Checks `attributes.embellishments` with multiple variations (matches extraction)

### ✅ Collections
- **Sources**:
  1. `attributes.collection` or `attributes.collections` or `attributes.Collection` or `attributes.Collections`
- **Ranking/Filtering**: 
  - ✅ Checks `attributes.collection` with multiple variations (matches extraction)

### ✅ Sizes
- **Sources**:
  1. `attributes.sizes` or `attributes.size` or `attributes.Sizes` or `attributes.Size`
- **Ranking/Filtering**: 
  - ✅ Checks `attributes.sizes` (matches extraction)

### ✅ AgeGroups
- **Sources**:
  1. `product.ageGroup` column (primary)
  2. Inferred from product metadata (title, description)
- **Ranking/Filtering**: 
  - ✅ Checks `enrichedColumns.ageGroup` first (matches extraction)
  - ✅ Falls back to inference from metadata

## Summary of Changes Made

### Fixed: Styles Constraint Mapping
**Problem**: `matchStyle` function only checked `attributes.style`, missing:
- `product.silhouetteCut` column (primary extraction source)
- `attributes.style_labels` attribute (secondary extraction source)

**Fix**:
1. ✅ Added `silhouetteCut` to `EnrichedColumnValues` type
2. ✅ Updated `matchStyle` to check `enrichedColumns.silhouetteCut` first (priority 1)
3. ✅ Updated `matchStyle` to check `attributes.style_labels` second (priority 2)
4. ✅ Updated `calculateConstraintMatchScore` to extract `silhouetteCut` and `style_labels` before matching
5. ✅ Updated `constraint-ranker.ts` to include `silhouetteCut` in `enrichedColumns`
6. ✅ Updated `search/index.ts` to include `silhouetteCut` in `enrichedColumns`

### All Other Constraints: Already Correct ✅
- Necklines, SleeveLengths, Lengths, Fits, Seasons, Materials, Colors, etc. were already correctly mapped to their extraction sources

## Verification

All constraints now correctly map to the database columns/attributes they were extracted from:

1. ✅ Dictionary extraction sources match filtering/ranking sources
2. ✅ Priority order (database column → JSONB attributes) is consistent
3. ✅ All enriched columns are properly extracted and passed to constraint matchers
