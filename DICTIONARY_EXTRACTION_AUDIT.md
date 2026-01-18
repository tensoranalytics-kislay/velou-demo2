# Dictionary Extraction Audit Report

## All Constraint-Related Columns in Database Schema

### Currently Extracted Columns

| Constraint Type | Database Columns | Attributes JSON Fields | Status |
|----------------|------------------|------------------------|--------|
| **colors** | `color`, `enrichedColor` | `attrs.color`, `attrs.Color` | ✅ Extracted |
| **materials** | `material`, `fabric` | `attrs.material`, `attrs.Material`, `attrs.fabric`, `attrs.Fabric` | ✅ Extracted |
| **occasions** | `occasion`, `occasionContext[]` | `attrs.occasion`, `attrs.Occasion` | ✅ Extracted |
| **styles** | - | `attrs.style`, `attrs.Style`, `attrs.style_labels`, `attrs.styleLabels` | ✅ Extracted |
| **patterns** | - | `attrs.pattern`, `attrs.Pattern`, `attrs.pattern_print`, `attrs.patternPrint` | ✅ Extracted |
| **sizes** | - | `attrs.sizes`, `attrs.size`, `attrs.Sizes`, `attrs.Size` | ✅ Extracted |
| **lengths** | `length` | `attrs.length`, `attrs.Length` | ✅ Extracted |
| **formalityLevel** | `formalityLevel` | `attrs.formalityLevel`, `attrs.FormalityLevel` | ✅ Extracted |
| **fits** | `fit`, `fitPreference` | `attrs.fit`, `attrs.Fit`, `attrs.fit_preference`, `attrs.fitPreference` | ✅ Extracted |
| **rises** | `riseWaist` | `attrs.rise`, `attrs.Rise`, `attrs.rise_waist`, `attrs.riseWaist` | ✅ Extracted |
| **necklines** | `neckline` | `attrs.neckline`, `attrs.Neckline`, `attrs.neckline_depth`, `attrs.necklineDepth` | ✅ Extracted |
| **sleeveLengths** | `sleeve` | `attrs.sleeve`, `attrs.Sleeve`, `attrs.sleeveLength`, `attrs.sleeve_length` | ✅ Extracted |
| **seasons** | `season` | `attrs.season`, `attrs.Season`, `attrs.seasonal_cues`, `attrs.seasonalCues` | ✅ Extracted |
| **colorShade** | `colorShade` | `attrs.colorShade`, `attrs.color_shade`, `attrs.ColorShade` | ✅ Extracted |
| **embellishments** | - | `attrs.embellishments`, `attrs.embellishment`, `attrs.detailing`, `attrs.Detailing` | ✅ Extracted |
| **collections** | - | `attrs.collection`, `attrs.collections`, `attrs.Collection`, `attrs.Collections` | ✅ Extracted |

### Missing/Not Extracted Columns

| Column | Type | Potential Dictionary | Issue |
|--------|------|---------------------|-------|
| `silhouetteCut` | String | Could map to **styles** | ❌ NOT extracted - contains silhouette/style info |
| `colorUndertone` | String | **colorUndertone** (separate) | ❌ NOT extracted - separate constraint type |
| `seasonalPalette` | String | **seasonalPalette** (separate) | ❌ NOT extracted - different from seasons |
| `seasonalCues` | String (column) | Currently extracted from `attrs.seasonal_cues` | ⚠️ Column exists but not used (we use attributes version) |
| `fabricFamily` | String | Could be in **materials** or separate | ⚠️ Column selected but values added to materials |
| `neckline` vs `attrs.neckline_depth` | String | Both in **necklines** | ✅ Both extracted, but `neckline_depth` complements main `neckline` |

## Critical Findings

### 1. **silhouetteCut Column** - MISSING from styles dictionary

**Problem**: The `silhouetteCut` column contains values like "Relaxed", "Straight", "A-Line", "Wrap", "Fit and Flare" - these are style-related terms that could populate the styles dictionary!

**Impact**: Terms like "A-Line", "Wrap", "Fit and Flare" that LLM infers might actually exist in `silhouetteCut` but aren't being extracted.

**Fix Needed**: Add extraction of `product.silhouetteCut` to styles dictionary.

### 2. **colorUndertone** - Missing separate constraint dictionary

**Problem**: `colorUndertone` column exists with values like "Warm", "Cool", "Neutral" but has no dictionary.

**Impact**: Users can't filter by undertone, and LLM can't validate undertone constraints.

**Fix Needed**: Add `colorUndertone` as separate constraint type OR add to existing color constraint handling.

### 3. **seasonalPalette** - Missing constraint

**Problem**: `seasonalPalette` exists but isn't extracted.

**Impact**: Users mentioning seasonal color palettes can't be matched.

**Fix Needed**: Extract `seasonalPalette` - could be in seasons or separate constraint.

### 4. **fabricFamily vs fabric**

**Current**: `fabricFamily` values are added to materials dictionary.

**Question**: Should `fabricFamily` be separate or merged? (e.g., "Cotton" in fabricFamily vs specific fabric types)

## Recommendations

### High Priority

1. **Add `silhouetteCut` extraction to styles dictionary**
   - This could solve the "A-Line", "Wrap", "Fit and Flare" missing values issue
   - Code: Add `if (product.silhouetteCut) { dictionaries.styles.add(normalizeValue(product.silhouetteCut)); }`

2. **Extract `colorUndertone` as separate constraint**
   - Add to dictionary generation
   - Add to classification prompt dictionaries
   - Add to refinement prompt dictionaries

### Medium Priority

3. **Extract `seasonalPalette`**
   - Decide if it belongs in seasons dictionary or separate
   - Add to extraction script

4. **Clarify `fabricFamily` vs `fabric`**
   - Currently both go to materials
   - Verify this is correct or separate them

### Low Priority

5. **Use `seasonalCues` column directly**
   - Currently we extract from `attrs.seasonal_cues`
   - Consider also using `product.seasonalCues` column

## Current Extraction Coverage

- ✅ **16 constraint types** extracted
- ❌ **3 constraint-related columns** not extracted (`silhouetteCut`, `colorUndertone`, `seasonalPalette`)
- ⚠️ **1 column** extracted but maybe incorrectly (`fabricFamily` in materials)

## Next Steps

1. Add `silhouetteCut` to styles extraction
2. Add `colorUndertone` as new constraint type
3. Rebuild dictionaries
4. Update classification/refinement prompts to include new constraints
