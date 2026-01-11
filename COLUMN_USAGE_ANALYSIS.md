# Enriched Dataset Column Usage Analysis

## Summary

**Total Columns in enriched 2.csv**: 90 columns
**Actively Used in Pipeline**: ~35 columns (39%)
**Stored but Underutilized**: ~25 columns (28%)
**Metadata/Internal Only**: ~30 columns (33%)

## Column Usage by Category

### ✅ Fully Utilized Columns (Used in Search, Ranking, Embeddings, or Filtering)

#### Core Identity & Commerce (12 columns)
- ✅ `id`, `item_group_id` → Product.id, Product.sourceId
- ✅ `title_clean` → Product.title (used in embeddings, search, ranking)
- ✅ `description_clean` → Product.description (used in embeddings, search, ranking)
- ✅ `image_link` → Product.imageUrl
- ✅ `link_base` → Product.productUrl
- ✅ `price`, `sale_price` → Product.priceCents, Product.salePriceCents (used in filtering, ranking)
- ✅ `availability` → Product.stockStatus (hard filter)
- ✅ `brand` → Product.brand (used in filtering, ranking)
- ✅ `color` → Product.color (used in filtering, ranking)
- ✅ `material` → Product.material (used in filtering, ranking)
- ✅ `variant_sizes`, `variant_colors` → Product.attributes (used in filtering)

#### Taxonomy (3 columns)
- ✅ `google_product_category` → Product.category (hard filter, embeddings)
- ✅ `product_type` → Product.subcategory (soft matching, embeddings)
- ✅ `taxonomy_path` → Used for category extraction

#### Enriched Indexed Columns - Actively Used (23 columns)
- ✅ `silhouette_cut` → Product.silhouetteCut (stored, available for future use)
- ✅ `length` → Product.length (used in embeddings, constraint matching)
- ✅ `sleeve` → Product.sleeve (stored, available for future use)
- ✅ `neckline` → Product.neckline (stored, available for future use)
- ✅ `closure_construction` → Product.closureConstruction (stored)
- ✅ `lined` → Product.lined (stored)
- ✅ `fit_preference` → Product.fitPreference (stored)
- ✅ `rise_waist` → Product.riseWaist (stored)
- ✅ `stretch_level` → Product.stretchLevel (stored)
- ✅ `body_intent` → Product.bodyIntent (stored)
- ✅ `comfort_intent` → Product.comfortIntent (stored)
- ✅ `fabric_family` → Product.fabricFamily (used in embeddings)
- ✅ `handfeel` → Product.handfeel (stored)
- ✅ `warmth_weight` → Product.warmthWeight (stored)
- ✅ `breathability` → Product.breathability (stored)
- ✅ `opacity` → Product.opacity (stored)
- ✅ `wrinkle_behavior` → Product.wrinkleBehavior (stored)
- ✅ `formality_level` → Product.formalityLevel (✅ **ACTIVELY USED** in embeddings, constraint matching, ranking)
- ✅ `occasion_context` → Product.occasionContext (✅ **ACTIVELY USED** in embeddings, constraint matching)
- ✅ `dress_code` → Product.dressCode (stored)
- ✅ `seasonal_cues` → Product.seasonalCues (stored, also mapped to Product.season)
- ✅ `temperature_intent` → Product.temperatureIntent (✅ **ACTIVELY USED** in embeddings, constraint matching, ranking)
- ✅ `humidity_friendly` → Product.humidityFriendly (✅ **ACTIVELY USED** in constraint matching, ranking)
- ✅ `movement_needs` → Product.movementNeeds (stored)
- ✅ `problem_solutions` → Product.problemSolutions (✅ **ACTIVELY USED** in embeddings, constraint matching, ranking)
- ✅ `function_features` → Product.functionFeatures (✅ **ACTIVELY USED** in embeddings, constraint matching, ranking)
- ✅ `color_shade` → Product.colorShade (✅ **ACTIVELY USED** in constraint matching, ranking)
- ✅ `color_undertone` → Product.colorUndertone (✅ **ACTIVELY USED** in constraint matching, ranking)
- ✅ `multicolor` → Product.multicolor (✅ **ACTIVELY USED** in constraint matching, ranking)
- ✅ `seasonal_palette` → Product.seasonalPalette (✅ **ACTIVELY USED** in embeddings, constraint matching)
- ✅ `inclusivity_sizing` → Product.inclusivitySizing (stored)
- ✅ `enriched_color` → Product.enrichedColor (✅ **ACTIVELY USED** in embeddings, color filtering)
- ✅ `age_group` → Product.ageGroup (✅ **ACTIVELY USED** in embeddings, age filtering)

### ⚠️ Stored but Underutilized (In Attributes JSON Only)

These columns are stored in `Product.attributes` but **NOT actively used** in:
- Embedding generation
- Constraint matching
- Ranking/scoring
- SQL filtering

#### Style & Details (8 columns)
- ⚠️ `sizing_notes` → attributes.sizing_notes (not in embeddings, not in ranking)
- ⚠️ `care_requirements` → attributes.care_requirements (not in embeddings, not in ranking)
- ⚠️ `style_labels` → attributes.style_labels (✅ **PARTIALLY USED** - in embeddings via extractSearchableTextFromAttributes)
- ⚠️ `vibe_mood` → attributes.vibe_mood (✅ **PARTIALLY USED** - in embeddings)
- ⚠️ `pattern_print` → attributes.pattern_print (✅ **PARTIALLY USED** - in embeddings)
- ⚠️ `detailing` → attributes.detailing (✅ **PARTIALLY USED** - in embeddings via extractSearchableTextFromAttributes)
- ⚠️ `finish` → attributes.finish (not in embeddings, not in ranking)
- ⚠️ `modesty_cues` → attributes.modesty_cues (not in embeddings, not in ranking)

#### Weather & Travel (2 columns)
- ⚠️ `rain_wind` → attributes.rain_wind (not in embeddings, not in ranking)
- ⚠️ `travel_features` → attributes.travel_features (not in embeddings, not in ranking)

#### Construction Details (10 columns)
- ⚠️ `layering_intent` → attributes.layering_intent (not in embeddings, not in ranking)
- ⚠️ `pairing_intent` → attributes.pairing_intent (not in embeddings, not in ranking)
- ⚠️ `pockets` → attributes.pockets (✅ **PARTIALLY USED** - extracted from query via intent extraction, but not in embeddings)
- ⚠️ `lining_type` → attributes.lining_type (not in embeddings, not in ranking)
- ⚠️ `bra_solution` → attributes.bra_solution (not in embeddings, not in ranking)
- ⚠️ `slit` → attributes.slit (not in embeddings, not in ranking)
- ⚠️ `neckline_depth` → attributes.neckline_depth (not in embeddings, not in ranking)
- ⚠️ `waist_structure` → attributes.waist_structure (not in embeddings, not in ranking)
- ⚠️ `hem_style` → attributes.hem_style (not in embeddings, not in ranking)
- ⚠️ `collar_type` → attributes.collar_type (not in embeddings, not in ranking)

#### Commercial & Value (3 columns)
- ⚠️ `price_band` → attributes.price_band (not in embeddings, not in ranking)
- ⚠️ `deal_intent` → attributes.deal_intent (not in embeddings, not in ranking)
- ⚠️ `value_framing` → attributes.value_framing (not in embeddings, not in ranking)

#### Sustainability & Quality (4 columns)
- ⚠️ `eco_materials` → attributes.eco_materials (not in embeddings, not in ranking)
- ⚠️ `certifications` → attributes.certifications (not in embeddings, not in ranking)
- ⚠️ `origin` → attributes.origin (not in embeddings, not in ranking)
- ⚠️ `durability_notes` → attributes.durability_notes (not in embeddings, not in ranking)

#### Inclusivity (3 columns)
- ⚠️ `adaptive_features` → attributes.adaptive_features (not in embeddings, not in ranking)
- ⚠️ `sensory_friendly` → attributes.sensory_friendly (not in embeddings, not in ranking)
- ⚠️ `social_proof` → attributes.social_proof (not in embeddings, not in ranking)

#### Product Structure (2 columns)
- ⚠️ `set_vs_single` → attributes.set_vs_single (not in embeddings, not in ranking)
- ⚠️ `pack_size` → attributes.pack_size (not in embeddings, not in ranking)

### 📊 Metadata/Internal (Not Used in Search)

- `sku`, `mpn`, `gtin`, `merchant_item_id` → Internal identifiers
- `additional_image_links` → UI display only
- `domain` → Internal taxonomy
- `llm_confidence_overall`, `llm_evidence_json` → Quality metadata

## Current Usage Gaps

### 1. Embedding Generation (`buildIndexedText`)

**Currently Includes:**
- ✅ title, description, category, subcategory
- ✅ enrichedColor, ageGroup
- ✅ formalityLevel, temperatureIntent, occasionContext
- ✅ problemSolutions, functionFeatures, seasonalPalette, length
- ✅ fabric_family, material (from attributes)
- ✅ style_labels, vibe_mood, pattern_print (from attributes)

**Missing from Embeddings:**
- ❌ `sizing_notes` - Could help with fit queries
- ❌ `care_requirements` - Could help with care queries
- ❌ `finish` - Could help with texture/feel queries
- ❌ `rain_wind` - Could help with weather queries
- ❌ `travel_features` - Could help with travel queries
- ❌ `pockets`, `lining_type`, `bra_solution`, `slit` - Construction details
- ❌ `eco_materials`, `certifications` - Sustainability queries
- ❌ `adaptive_features`, `sensory_friendly` - Inclusivity queries

### 2. Constraint Matching (`calculateConstraintMatchScore`)

**Currently Matches:**
- ✅ colors, sizes, occasions, styles, patterns, seasons, materials, fits
- ✅ lengths, necklines, sleeveLengths
- ✅ formalityLevel, temperatureIntent, humidityFriendly
- ✅ problemSolutions, functionFeatures
- ✅ colorShade, colorUndertone, multicolor, seasonalPalette
- ✅ ageGroups

**Missing Constraint Matching:**
- ❌ `pockets` - Only extracted from query, not matched in scoring
- ❌ `care_requirements` - No matching for care queries
- ❌ `rain_wind` - No weather resistance matching
- ❌ `travel_features` - No travel feature matching
- ❌ `eco_materials`, `certifications` - No sustainability matching
- ❌ `adaptive_features`, `sensory_friendly` - No inclusivity matching

### 3. SQL-Level Filtering

**Currently Filtered at SQL Level:**
- ✅ category, subcategory (hard filter)
- ✅ stockStatus (hard filter)
- ✅ price range (hard filter)
- ✅ brand (hard filter)
- ✅ length, formalityLevel, temperatureIntent, humidityFriendly (enriched columns)

**Could Be Added as SQL Filters:**
- ⚠️ `pockets` - High-value filter (users often ask "with pockets")
- ⚠️ `rain_wind` - Weather resistance filter
- ⚠️ `eco_materials` - Sustainability filter
- ⚠️ `certifications` - Certification filter

## Recommendations

### High Priority (Immediate Impact)

1. **Add `pockets` to Embeddings & Constraint Matching**
   - Users frequently ask "with pockets"
   - Currently extracted from query but not matched in scoring
   - Add to `buildIndexedText()` and `calculateConstraintMatchScore()`

2. **Add `care_requirements` to Embeddings**
   - Users ask about care (e.g., "machine washable", "dry clean only")
   - Add to `buildIndexedText()` for semantic search

3. **Add `rain_wind` to Weather Queries**
   - Users ask about weather resistance
   - Add to embeddings and constraint matching for weather queries

4. **Add `travel_features` to Embeddings**
   - Users ask about travel-friendly features
   - Add to `buildIndexedText()` for semantic search

### Medium Priority (Better Coverage)

5. **Add Construction Details to Embeddings**
   - `lining_type`, `bra_solution`, `slit`, `neckline_depth`, `waist_structure`, `hem_style`, `collar_type`
   - These are specific details users might ask about

6. **Add Sustainability Attributes to Embeddings**
   - `eco_materials`, `certifications`, `origin`
   - Growing importance for eco-conscious shoppers

7. **Add Inclusivity Attributes to Embeddings**
   - `adaptive_features`, `sensory_friendly`
   - Important for inclusive shopping

### Low Priority (Nice to Have)

8. **Add Commercial Attributes**
   - `price_band`, `deal_intent`, `value_framing`
   - Could be used for value-based queries

9. **Add Style Details**
   - `finish`, `modesty_cues`
   - Less frequently queried but could improve specificity

## Implementation Priority

### Phase 1: High-Value Quick Wins
1. Add `pockets` to constraint matching (already extracted from query)
2. Add `care_requirements` to embeddings
3. Add `rain_wind` to embeddings and weather constraint matching

### Phase 2: Enhanced Coverage
4. Add `travel_features` to embeddings
5. Add construction details (`lining_type`, `bra_solution`, etc.) to embeddings
6. Add sustainability attributes to embeddings

### Phase 3: Complete Coverage
7. Add inclusivity attributes
8. Add commercial attributes
9. Add remaining style details

## Current Pipeline Efficiency

**Overall Assessment**: The pipeline uses **~39% of available columns** effectively. The most important columns (formality, temperature, occasion, problem solutions, function features) are well-integrated. However, there are opportunities to improve coverage for:
- Care queries (care_requirements)
- Weather queries (rain_wind)
- Travel queries (travel_features)
- Pockets queries (pockets - partially implemented)
- Sustainability queries (eco_materials, certifications)
- Inclusivity queries (adaptive_features, sensory_friendly)

## Conclusion

The pipeline is **logically using the most important columns** for fashion/apparel search:
- ✅ Core product info (title, description, price, category)
- ✅ Key enriched attributes (formality, temperature, occasion, problem solutions)
- ✅ Color and size filtering
- ✅ Age group filtering

However, **~25 columns are underutilized** and could improve search quality for specific query types (care, weather, travel, sustainability, inclusivity).


