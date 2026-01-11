# Column SQL Filtration Audit

## Executive Summary

**Total Columns Audited**: 88 columns from `enriched.csv`  
**Currently Used as Hard SQL Filters**: 8 columns  
**Recommended for Post-SQL Filtration**: 15 columns  
**Recommended for Future Consideration**: 10 columns  
**Not Recommended**: 55 columns (stored but not suitable for filtering)

---

## Column Categories

### Category 1: Always Hard Filters (Currently Implemented)

These columns are **always** applied as hard SQL filters in every query:

| Column | Database Column | Type | Current Usage | Notes |
|--------|----------------|------|---------------|-------|
| `merchantId` | `merchantId` | String | Always applied | Multi-tenant isolation |
| `isActive` | `isActive` | Boolean | Always applied | Only active products |
| `stockStatus` | `stockStatus` | Enum | Always applied | Default: `'in_stock'` |
| `category` | `category` | String | Hard filter | With subcategory OR matching |
| `subcategory` | `subcategory` | String? | Hard filter | Checked alongside category |
| `ageGroup` | `ageGroup` | String? | Hard filter | Column + JSONB fallback |
| `priceCents` | `priceCents` | Int | Hard filter | `priceMinCents`, `priceMaxCents` |

**Total**: 7 columns (always applied)

---

### Category 2: Hard Filters with Post-SQL Approach (Plan to Implement)

These columns should use **post-SQL filtration** (category-specific dictionaries):

| Column | Database Column | Type | Values | SQL Filter Complexity | Priority |
|--------|----------------|------|--------|----------------------|----------|
| **`colors`** (via `enrichedColor`) | `enrichedColor` | String (comma-separated) | "White, Bright White, Pure White" | High (needs parsing) | **P0** ✅ |
| **`lengths`** | `length` | String? | "Mini", "Midi", "Maxi", "Cropped" | Low (exact match) | **P0** ✅ |
| `sleeve` | `sleeve` | String? | "Short", "Long", "Sleeveless", "Three-Quarter", "Flutter" | Medium (normalization) | **P1** |
| `neckline` | `neckline` | String? | "Round", "V-Neck", "Scoop", "Square", "Boat" | Medium (normalization) | **P1** |
| `formalityLevel` | `formalityLevel` | String? | "Casual", "Semi-Formal", "Formal" | Low (exact match) | **P1** |
| `temperatureIntent` | `temperatureIntent` | String? | "Warm Weather", "Cool Weather", "All-Weather" | Low (exact match) | **P2** |
| `humidityFriendly` | `humidityFriendly` | Boolean? | true/false | Low (boolean) | **P2** |
| `occasionContext` | `occasionContext` | String[] | ["Daytime", "Wedding", "Vacation"] | Medium (GIN index, array overlap) | **P2** |
| `problemSolutions` | `problemSolutions` | String[] | ["Flattering", "Comfortable"] | Medium (GIN index, array overlap) | **P2** |
| `functionFeatures` | `functionFeatures` | String[] | ["Pockets", "Lightweight"] | Medium (GIN index, array overlap) | **P2** |
| `fabricFamily` | `fabricFamily` | String? | "Cotton", "Silk", "Wool", "Linen" | Low (exact match) | **P2** |
| `brand` | `brand` | String? | "LoveShackFancy" | Low (exact match) | **P2** |
| `colorShade` | `colorShade` | String? | "Light", "Medium", "Dark" | Low (exact match) | **P3** |
| `colorUndertone` | `colorUndertone` | String? | "Warm", "Cool", "Neutral" | Low (exact match) | **P3** |
| `multicolor` | `multicolor` | Boolean? | true/false | Low (boolean) | **P3** |
| `seasonalPalette` | `seasonalPalette` | String? | "Spring", "Summer", "Fall", "Winter" | Low (exact match) | **P3** |
| `silhouetteCut` | `silhouetteCut` | String? | "A-Line", "Empire", "Relaxed" | Low (exact match) | **P3** |
| `lined` | `lined` | Boolean? | true/false | Low (boolean) | **P3** |
| `warmthWeight` | `warmthWeight` | String? | "Lightweight", "Midweight", "Heavyweight" | Low (exact match) | **P3** |

**Total**: 19 columns (15 recommended + 2 already in plan + 2 already implemented)

**Priority Legend**:
- **P0**: Critical (colors, lengths) - Already in implementation plan
- **P1**: High value (sleeve, neckline, formalityLevel) - Implement in Phase 2
- **P2**: Medium value (temperature, occasion, fabric) - Implement in Phase 3
- **P3**: Lower value (niche attributes) - Implement if needed

---

### Category 3: Soft Ranking Only (Not Recommended for Hard Filtering)

These columns are **better suited for ranking** than hard filtering:

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `comfortIntent` | `comfortIntent` | String? | Subjective, better for ranking |
| `bodyIntent` | `bodyIntent` | String? | Subjective, better for ranking |
| `handfeel` | `handfeel` | String? | Too subjective, better for ranking |
| `fitPreference` | `fitPreference` | String? | Better for ranking/sizing info |
| `occasion` | `occasion` | String? (legacy) | Use `occasionContext` array instead |
| `season` | `season` | String? (legacy) | Use `seasonalPalette` instead |
| `fit` | `fit` | String? (legacy) | Too vague, use enriched alternatives |

**Total**: 7 columns (not recommended for hard filtering)

---

### Category 4: Too Specific (Not Recommended for Filtering)

These columns are **too specific** and rarely queried directly:

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `opacity` | `opacity` | String? | Too specific (Semi-Transparent, Opaque) |
| `wrinkleBehavior` | `wrinkleBehavior` | String? | Too specific (Wrinkles Easily) |
| `closureConstruction` | `closureConstruction` | String? | Too specific (Button, Zipper, etc.) |
| `riseWaist` | `riseWaist` | String? | Too specific (Natural Waist, Low Rise) |
| `stretchLevel` | `stretchLevel` | String? | Too specific (No Stretch, Moderate Stretch) |
| `necklineDepth` | `necklineDepth` | String? | Too specific (Moderate, Deep) |
| `waistStructure` | `waistStructure` | String? | Too specific (Defined Waist, No Waist) |
| `hemStyle` | `hemStyle` | String? | Too specific (Straight, Ruffled, Scalloped) |
| `collarType` | `collarType` | String? | Too specific (No Collar, Peter Pan, etc.) |
| `liningType` | `liningType` | String? | Too specific (Fully Lined, Partially Lined) |
| `braSolution` | `braSolution` | String? | Too specific (Bra-Friendly, Built-in) |
| `slit` | `slit` | String? | Too specific (No Slit, Has Slit) |
| `pockets` | `pockets` | String? | Too specific (No Pockets, Has Pockets) |
| `movementNeeds` | `movementNeeds` | String? | Too specific (Free Movement, etc.) |
| `travelFeatures` | `travelFeatures` | String[] | Too specific (rarely queried) |

**Total**: 15 columns (not recommended for hard filtering)

---

### Category 5: Commercial/Metadata (Not Suitable for Filtering)

These columns are **commercial metadata** and not suitable for product filtering:

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `price` | `priceCents` | Int | Already used (hard filter) |
| `sale_price` | `salePriceCents` | Int? | Used for ranking, not filtering |
| `price_band` | Not stored | String? | Commercial metadata |
| `deal_intent` | Not stored | String? | Commercial metadata |
| `value_framing` | Not stored | String? | Commercial metadata |
| `social_proof` | Not stored | String? | Commercial metadata (New, Popular) |
| `llm_confidence_overall` | Not stored | Float? | Metadata (LLM confidence) |
| `llm_evidence_json` | Not stored | Json? | Metadata (LLM evidence) |

**Total**: 8 columns (not suitable for filtering)

---

### Category 6: Inclusivity/Sustainability (Limited Use Cases)

These columns are **niche** and only relevant for specific queries:

| Column | Database Column | Type | Recommended | Notes |
|--------|----------------|------|-------------|-------|
| `inclusivitySizing` | `inclusivitySizing` | String? | Maybe | Only for inclusive sizing queries |
| `adaptiveFeatures` | `adaptiveFeatures` | String? | Maybe | Only for accessibility queries |
| `sensoryFriendly` | `sensoryFriendly` | String? | Maybe | Only for sensory needs queries |
| `ecoMaterials` | Not stored | String[] | Maybe | Only for sustainability queries |
| `certifications` | Not stored | String? | Maybe | Only for certification queries |
| `origin` | Not stored | String? | Maybe | Only for origin queries |
| `durabilityNotes` | Not stored | String? | No | Too specific |

**Total**: 7 columns (limited use cases, implement if needed)

---

### Category 7: Identity/Commerce (Not Filters)

These columns are **identity/commerce** fields, not filters:

| Column | Database Column | Type | Usage |
|--------|----------------|------|-------|
| `id` | `id` | String | Primary key |
| `title` | `title` | String | Search/ranking |
| `description` | `description` | String | Search/ranking |
| `imageUrl` | `imageUrl` | String | Display |
| `productUrl` | `productUrl` | String | Display |
| `currency` | `currency` | String | Commerce |
| `variant_sizes` | `attributes.variant_sizes` | String[] | Display |
| `variant_colors` | `attributes.variant_colors` | String[] | Display (not used for filtering) |

**Total**: 8 columns (not filters)

---

### Category 8: Taxonomy/Metadata (Used for Classification, Not Filtering)

| Column | Database Column | Type | Usage |
|--------|----------------|------|-------|
| `google_product_category` | Used for category extraction | String | Classification |
| `product_type` | `subcategory` | String? | Classification |
| `taxonomy_path` | Used for category extraction | String | Classification |
| `domain` | Not stored | String? | Metadata |

**Total**: 4 columns (used for classification, not filtering)

---

### Category 9: LLM-Generated Metadata (Not Suitable for Filtering)

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `style_labels` | Not stored | String[] | LLM-generated, better for ranking |
| `vibe_mood` | Not stored | String[] | LLM-generated, better for ranking |
| `pattern_print` | Not stored | String[] | LLM-generated, better for ranking |
| `detailing` | Not stored | String[] | LLM-generated, better for ranking |
| `finish` | Not stored | String? | LLM-generated, better for ranking |
| `dress_code` | `dressCode` | String? | LLM-generated, better for ranking |
| `modesty_cues` | Not stored | String[] | LLM-generated, better for ranking |
| `seasonal_cues` | `seasonalCues` | String? | LLM-generated, overlaps with `seasonalPalette` |
| `rain_wind` | Not stored | String? | LLM-generated, rarely queried |
| `layering_intent` | Not stored | String? | LLM-generated, better for ranking |
| `pairing_intent` | Not stored | String? | LLM-generated, better for ranking |
| `sizing_notes` | Not stored | String? | Display/ranking, not filtering |
| `care_requirements` | Not stored | String[] | Display only, not filtering |

**Total**: 13 columns (LLM-generated, better for ranking/display)

---

## Recommended Implementation Priority

### Phase 1: Critical (P0) - ✅ Already in Plan
1. ✅ **`colors`** (via `enrichedColor` + `color`) - Post-SQL filtration
2. ✅ **`lengths`** (via `length` column) - Post-SQL filtration

### Phase 2: High Value (P1) - Implement After Phase 1
3. **`sleeve`** - Post-SQL filtration (category-specific dictionary)
4. **`neckline`** - Post-SQL filtration (category-specific dictionary)
5. **`formalityLevel`** - Post-SQL filtration (category-specific dictionary)

### Phase 3: Medium Value (P2) - Implement If Needed
6. **`temperatureIntent`** - Post-SQL filtration
7. **`humidityFriendly`** - Post-SQL filtration (boolean, simple)
8. **`occasionContext`** - Post-SQL filtration (array, needs GIN index)
9. **`problemSolutions`** - Post-SQL filtration (array, needs GIN index)
10. **`functionFeatures`** - Post-SQL filtration (array, needs GIN index)
11. **`fabricFamily`** - Post-SQL filtration
12. **`brand`** - Post-SQL filtration (category-specific)

### Phase 4: Lower Value (P3) - Implement If Needed
13. **`colorShade`** - Post-SQL filtration (works with color filtering)
14. **`colorUndertone`** - Post-SQL filtration (works with color filtering)
15. **`multicolor`** - Post-SQL filtration (boolean, simple)
16. **`seasonalPalette`** - Post-SQL filtration
17. **`silhouetteCut`** - Post-SQL filtration (useful for dresses/tops)
18. **`lined`** - Post-SQL filtration (boolean, simple)
19. **`warmthWeight`** - Post-SQL filtration

---

## Summary Statistics

### By Category
- **Always Hard Filters**: 7 columns (always applied)
- **Post-SQL Filtration Candidates**: 19 columns (P0-P3 priorities)
- **Soft Ranking Only**: 7 columns (not recommended for filtering)
- **Too Specific**: 15 columns (not recommended)
- **Commercial/Metadata**: 8 columns (not suitable)
- **Inclusivity/Sustainability**: 7 columns (limited use cases)
- **Identity/Commerce**: 8 columns (not filters)
- **Taxonomy/Metadata**: 4 columns (classification only)
- **LLM-Generated Metadata**: 13 columns (ranking/display only)

### By Implementation Priority
- **P0 (Critical)**: 2 columns ✅ (already in plan)
- **P1 (High Value)**: 3 columns (implement in Phase 2)
- **P2 (Medium Value)**: 7 columns (implement in Phase 3)
- **P3 (Lower Value)**: 7 columns (implement if needed)

### By Data Type
- **String (simple)**: 12 columns (exact match, low complexity)
- **String (comma-separated)**: 1 column (`enrichedColor`, high complexity)
- **Boolean**: 3 columns (simple, low complexity)
- **String[] (array)**: 3 columns (GIN index, medium complexity)
- **Int**: 1 column (`priceCents`, simple)

---

## Recommendations

### Immediate Actions
1. ✅ **Implement post-SQL filtration for colors and lengths** (already in plan)
2. **Audit distinct values** for P1 columns (`sleeve`, `neckline`, `formalityLevel`)
3. **Build category-specific dictionaries** for colors and lengths
4. **Test performance** of dictionary building and post-filtering

### Future Enhancements
1. **Expand to P1 columns** (`sleeve`, `neckline`, `formalityLevel`) after Phase 1
2. **Add dictionary caching** to reduce latency
3. **Precompute dictionaries** during catalog ingestion
4. **Monitor dictionary effectiveness** and adjust priorities

### Not Recommended
1. **Do not implement** hard filtering for LLM-generated metadata (better for ranking)
2. **Do not implement** hard filtering for too-specific attributes (rarely queried)
3. **Do not implement** hard filtering for subjective attributes (better for ranking)

---

## Notes

1. **`variant_colors`** is explicitly **NOT used** for color filtering (per previous fix)
2. **`enrichedColor`** is the **primary source** for color filtering (comma-separated)
3. **Category-specific dictionaries** should be built **dynamically** from filtered product sets
4. **Dictionary building** should happen **after** category/subcategory filtering
5. **Post-SQL filtering** should use **normalized** (lowercase, trimmed) values for matching
6. **Fallback logic** should use **global dictionaries** if category-specific dictionary is empty



## Executive Summary

**Total Columns Audited**: 88 columns from `enriched.csv`  
**Currently Used as Hard SQL Filters**: 8 columns  
**Recommended for Post-SQL Filtration**: 15 columns  
**Recommended for Future Consideration**: 10 columns  
**Not Recommended**: 55 columns (stored but not suitable for filtering)

---

## Column Categories

### Category 1: Always Hard Filters (Currently Implemented)

These columns are **always** applied as hard SQL filters in every query:

| Column | Database Column | Type | Current Usage | Notes |
|--------|----------------|------|---------------|-------|
| `merchantId` | `merchantId` | String | Always applied | Multi-tenant isolation |
| `isActive` | `isActive` | Boolean | Always applied | Only active products |
| `stockStatus` | `stockStatus` | Enum | Always applied | Default: `'in_stock'` |
| `category` | `category` | String | Hard filter | With subcategory OR matching |
| `subcategory` | `subcategory` | String? | Hard filter | Checked alongside category |
| `ageGroup` | `ageGroup` | String? | Hard filter | Column + JSONB fallback |
| `priceCents` | `priceCents` | Int | Hard filter | `priceMinCents`, `priceMaxCents` |

**Total**: 7 columns (always applied)

---

### Category 2: Hard Filters with Post-SQL Approach (Plan to Implement)

These columns should use **post-SQL filtration** (category-specific dictionaries):

| Column | Database Column | Type | Values | SQL Filter Complexity | Priority |
|--------|----------------|------|--------|----------------------|----------|
| **`colors`** (via `enrichedColor`) | `enrichedColor` | String (comma-separated) | "White, Bright White, Pure White" | High (needs parsing) | **P0** ✅ |
| **`lengths`** | `length` | String? | "Mini", "Midi", "Maxi", "Cropped" | Low (exact match) | **P0** ✅ |
| `sleeve` | `sleeve` | String? | "Short", "Long", "Sleeveless", "Three-Quarter", "Flutter" | Medium (normalization) | **P1** |
| `neckline` | `neckline` | String? | "Round", "V-Neck", "Scoop", "Square", "Boat" | Medium (normalization) | **P1** |
| `formalityLevel` | `formalityLevel` | String? | "Casual", "Semi-Formal", "Formal" | Low (exact match) | **P1** |
| `temperatureIntent` | `temperatureIntent` | String? | "Warm Weather", "Cool Weather", "All-Weather" | Low (exact match) | **P2** |
| `humidityFriendly` | `humidityFriendly` | Boolean? | true/false | Low (boolean) | **P2** |
| `occasionContext` | `occasionContext` | String[] | ["Daytime", "Wedding", "Vacation"] | Medium (GIN index, array overlap) | **P2** |
| `problemSolutions` | `problemSolutions` | String[] | ["Flattering", "Comfortable"] | Medium (GIN index, array overlap) | **P2** |
| `functionFeatures` | `functionFeatures` | String[] | ["Pockets", "Lightweight"] | Medium (GIN index, array overlap) | **P2** |
| `fabricFamily` | `fabricFamily` | String? | "Cotton", "Silk", "Wool", "Linen" | Low (exact match) | **P2** |
| `brand` | `brand` | String? | "LoveShackFancy" | Low (exact match) | **P2** |
| `colorShade` | `colorShade` | String? | "Light", "Medium", "Dark" | Low (exact match) | **P3** |
| `colorUndertone` | `colorUndertone` | String? | "Warm", "Cool", "Neutral" | Low (exact match) | **P3** |
| `multicolor` | `multicolor` | Boolean? | true/false | Low (boolean) | **P3** |
| `seasonalPalette` | `seasonalPalette` | String? | "Spring", "Summer", "Fall", "Winter" | Low (exact match) | **P3** |
| `silhouetteCut` | `silhouetteCut` | String? | "A-Line", "Empire", "Relaxed" | Low (exact match) | **P3** |
| `lined` | `lined` | Boolean? | true/false | Low (boolean) | **P3** |
| `warmthWeight` | `warmthWeight` | String? | "Lightweight", "Midweight", "Heavyweight" | Low (exact match) | **P3** |

**Total**: 19 columns (15 recommended + 2 already in plan + 2 already implemented)

**Priority Legend**:
- **P0**: Critical (colors, lengths) - Already in implementation plan
- **P1**: High value (sleeve, neckline, formalityLevel) - Implement in Phase 2
- **P2**: Medium value (temperature, occasion, fabric) - Implement in Phase 3
- **P3**: Lower value (niche attributes) - Implement if needed

---

### Category 3: Soft Ranking Only (Not Recommended for Hard Filtering)

These columns are **better suited for ranking** than hard filtering:

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `comfortIntent` | `comfortIntent` | String? | Subjective, better for ranking |
| `bodyIntent` | `bodyIntent` | String? | Subjective, better for ranking |
| `handfeel` | `handfeel` | String? | Too subjective, better for ranking |
| `fitPreference` | `fitPreference` | String? | Better for ranking/sizing info |
| `occasion` | `occasion` | String? (legacy) | Use `occasionContext` array instead |
| `season` | `season` | String? (legacy) | Use `seasonalPalette` instead |
| `fit` | `fit` | String? (legacy) | Too vague, use enriched alternatives |

**Total**: 7 columns (not recommended for hard filtering)

---

### Category 4: Too Specific (Not Recommended for Filtering)

These columns are **too specific** and rarely queried directly:

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `opacity` | `opacity` | String? | Too specific (Semi-Transparent, Opaque) |
| `wrinkleBehavior` | `wrinkleBehavior` | String? | Too specific (Wrinkles Easily) |
| `closureConstruction` | `closureConstruction` | String? | Too specific (Button, Zipper, etc.) |
| `riseWaist` | `riseWaist` | String? | Too specific (Natural Waist, Low Rise) |
| `stretchLevel` | `stretchLevel` | String? | Too specific (No Stretch, Moderate Stretch) |
| `necklineDepth` | `necklineDepth` | String? | Too specific (Moderate, Deep) |
| `waistStructure` | `waistStructure` | String? | Too specific (Defined Waist, No Waist) |
| `hemStyle` | `hemStyle` | String? | Too specific (Straight, Ruffled, Scalloped) |
| `collarType` | `collarType` | String? | Too specific (No Collar, Peter Pan, etc.) |
| `liningType` | `liningType` | String? | Too specific (Fully Lined, Partially Lined) |
| `braSolution` | `braSolution` | String? | Too specific (Bra-Friendly, Built-in) |
| `slit` | `slit` | String? | Too specific (No Slit, Has Slit) |
| `pockets` | `pockets` | String? | Too specific (No Pockets, Has Pockets) |
| `movementNeeds` | `movementNeeds` | String? | Too specific (Free Movement, etc.) |
| `travelFeatures` | `travelFeatures` | String[] | Too specific (rarely queried) |

**Total**: 15 columns (not recommended for hard filtering)

---

### Category 5: Commercial/Metadata (Not Suitable for Filtering)

These columns are **commercial metadata** and not suitable for product filtering:

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `price` | `priceCents` | Int | Already used (hard filter) |
| `sale_price` | `salePriceCents` | Int? | Used for ranking, not filtering |
| `price_band` | Not stored | String? | Commercial metadata |
| `deal_intent` | Not stored | String? | Commercial metadata |
| `value_framing` | Not stored | String? | Commercial metadata |
| `social_proof` | Not stored | String? | Commercial metadata (New, Popular) |
| `llm_confidence_overall` | Not stored | Float? | Metadata (LLM confidence) |
| `llm_evidence_json` | Not stored | Json? | Metadata (LLM evidence) |

**Total**: 8 columns (not suitable for filtering)

---

### Category 6: Inclusivity/Sustainability (Limited Use Cases)

These columns are **niche** and only relevant for specific queries:

| Column | Database Column | Type | Recommended | Notes |
|--------|----------------|------|-------------|-------|
| `inclusivitySizing` | `inclusivitySizing` | String? | Maybe | Only for inclusive sizing queries |
| `adaptiveFeatures` | `adaptiveFeatures` | String? | Maybe | Only for accessibility queries |
| `sensoryFriendly` | `sensoryFriendly` | String? | Maybe | Only for sensory needs queries |
| `ecoMaterials` | Not stored | String[] | Maybe | Only for sustainability queries |
| `certifications` | Not stored | String? | Maybe | Only for certification queries |
| `origin` | Not stored | String? | Maybe | Only for origin queries |
| `durabilityNotes` | Not stored | String? | No | Too specific |

**Total**: 7 columns (limited use cases, implement if needed)

---

### Category 7: Identity/Commerce (Not Filters)

These columns are **identity/commerce** fields, not filters:

| Column | Database Column | Type | Usage |
|--------|----------------|------|-------|
| `id` | `id` | String | Primary key |
| `title` | `title` | String | Search/ranking |
| `description` | `description` | String | Search/ranking |
| `imageUrl` | `imageUrl` | String | Display |
| `productUrl` | `productUrl` | String | Display |
| `currency` | `currency` | String | Commerce |
| `variant_sizes` | `attributes.variant_sizes` | String[] | Display |
| `variant_colors` | `attributes.variant_colors` | String[] | Display (not used for filtering) |

**Total**: 8 columns (not filters)

---

### Category 8: Taxonomy/Metadata (Used for Classification, Not Filtering)

| Column | Database Column | Type | Usage |
|--------|----------------|------|-------|
| `google_product_category` | Used for category extraction | String | Classification |
| `product_type` | `subcategory` | String? | Classification |
| `taxonomy_path` | Used for category extraction | String | Classification |
| `domain` | Not stored | String? | Metadata |

**Total**: 4 columns (used for classification, not filtering)

---

### Category 9: LLM-Generated Metadata (Not Suitable for Filtering)

| Column | Database Column | Type | Reason |
|--------|----------------|------|--------|
| `style_labels` | Not stored | String[] | LLM-generated, better for ranking |
| `vibe_mood` | Not stored | String[] | LLM-generated, better for ranking |
| `pattern_print` | Not stored | String[] | LLM-generated, better for ranking |
| `detailing` | Not stored | String[] | LLM-generated, better for ranking |
| `finish` | Not stored | String? | LLM-generated, better for ranking |
| `dress_code` | `dressCode` | String? | LLM-generated, better for ranking |
| `modesty_cues` | Not stored | String[] | LLM-generated, better for ranking |
| `seasonal_cues` | `seasonalCues` | String? | LLM-generated, overlaps with `seasonalPalette` |
| `rain_wind` | Not stored | String? | LLM-generated, rarely queried |
| `layering_intent` | Not stored | String? | LLM-generated, better for ranking |
| `pairing_intent` | Not stored | String? | LLM-generated, better for ranking |
| `sizing_notes` | Not stored | String? | Display/ranking, not filtering |
| `care_requirements` | Not stored | String[] | Display only, not filtering |

**Total**: 13 columns (LLM-generated, better for ranking/display)

---

## Recommended Implementation Priority

### Phase 1: Critical (P0) - ✅ Already in Plan
1. ✅ **`colors`** (via `enrichedColor` + `color`) - Post-SQL filtration
2. ✅ **`lengths`** (via `length` column) - Post-SQL filtration

### Phase 2: High Value (P1) - Implement After Phase 1
3. **`sleeve`** - Post-SQL filtration (category-specific dictionary)
4. **`neckline`** - Post-SQL filtration (category-specific dictionary)
5. **`formalityLevel`** - Post-SQL filtration (category-specific dictionary)

### Phase 3: Medium Value (P2) - Implement If Needed
6. **`temperatureIntent`** - Post-SQL filtration
7. **`humidityFriendly`** - Post-SQL filtration (boolean, simple)
8. **`occasionContext`** - Post-SQL filtration (array, needs GIN index)
9. **`problemSolutions`** - Post-SQL filtration (array, needs GIN index)
10. **`functionFeatures`** - Post-SQL filtration (array, needs GIN index)
11. **`fabricFamily`** - Post-SQL filtration
12. **`brand`** - Post-SQL filtration (category-specific)

### Phase 4: Lower Value (P3) - Implement If Needed
13. **`colorShade`** - Post-SQL filtration (works with color filtering)
14. **`colorUndertone`** - Post-SQL filtration (works with color filtering)
15. **`multicolor`** - Post-SQL filtration (boolean, simple)
16. **`seasonalPalette`** - Post-SQL filtration
17. **`silhouetteCut`** - Post-SQL filtration (useful for dresses/tops)
18. **`lined`** - Post-SQL filtration (boolean, simple)
19. **`warmthWeight`** - Post-SQL filtration

---

## Summary Statistics

### By Category
- **Always Hard Filters**: 7 columns (always applied)
- **Post-SQL Filtration Candidates**: 19 columns (P0-P3 priorities)
- **Soft Ranking Only**: 7 columns (not recommended for filtering)
- **Too Specific**: 15 columns (not recommended)
- **Commercial/Metadata**: 8 columns (not suitable)
- **Inclusivity/Sustainability**: 7 columns (limited use cases)
- **Identity/Commerce**: 8 columns (not filters)
- **Taxonomy/Metadata**: 4 columns (classification only)
- **LLM-Generated Metadata**: 13 columns (ranking/display only)

### By Implementation Priority
- **P0 (Critical)**: 2 columns ✅ (already in plan)
- **P1 (High Value)**: 3 columns (implement in Phase 2)
- **P2 (Medium Value)**: 7 columns (implement in Phase 3)
- **P3 (Lower Value)**: 7 columns (implement if needed)

### By Data Type
- **String (simple)**: 12 columns (exact match, low complexity)
- **String (comma-separated)**: 1 column (`enrichedColor`, high complexity)
- **Boolean**: 3 columns (simple, low complexity)
- **String[] (array)**: 3 columns (GIN index, medium complexity)
- **Int**: 1 column (`priceCents`, simple)

---

## Recommendations

### Immediate Actions
1. ✅ **Implement post-SQL filtration for colors and lengths** (already in plan)
2. **Audit distinct values** for P1 columns (`sleeve`, `neckline`, `formalityLevel`)
3. **Build category-specific dictionaries** for colors and lengths
4. **Test performance** of dictionary building and post-filtering

### Future Enhancements
1. **Expand to P1 columns** (`sleeve`, `neckline`, `formalityLevel`) after Phase 1
2. **Add dictionary caching** to reduce latency
3. **Precompute dictionaries** during catalog ingestion
4. **Monitor dictionary effectiveness** and adjust priorities

### Not Recommended
1. **Do not implement** hard filtering for LLM-generated metadata (better for ranking)
2. **Do not implement** hard filtering for too-specific attributes (rarely queried)
3. **Do not implement** hard filtering for subjective attributes (better for ranking)

---

## Notes

1. **`variant_colors`** is explicitly **NOT used** for color filtering (per previous fix)
2. **`enrichedColor`** is the **primary source** for color filtering (comma-separated)
3. **Category-specific dictionaries** should be built **dynamically** from filtered product sets
4. **Dictionary building** should happen **after** category/subcategory filtering
5. **Post-SQL filtering** should use **normalized** (lowercase, trimmed) values for matching
6. **Fallback logic** should use **global dictionaries** if category-specific dictionary is empty


