# Constraint Usage Summary

## Overview

This document lists all constraints available in the dataset and how they are used:
- **Hard Filters (SQL)**: Applied in SQL WHERE clauses - products that don't match are **excluded**
- **Post-SQL Filters**: Applied after SQL using category-specific dictionaries - products that don't match are **excluded**
- **Soft Ranking**: Applied in scoring/ranking - products get **boosted scores** but are not excluded
- **Both**: Used for both filtering (excludes products) and ranking (scores products)

---

## All Constraints in FashionConstraints Type

### Core Clothing Constraints
1. **styles** - Style descriptors (Romantic, Feminine, Classic, etc.)
2. **lengths** - Dress/skirt lengths (Mini, Midi, Maxi, etc.)
3. **occasions** - Occasion types (Formal, Casual, Beach, etc.)
4. **seasons** - Seasonal appropriateness (Spring, Summer, Fall, Winter)
5. **materials** - Material types (Silk, Cotton, Linen, etc.)
6. **patterns** - Pattern types (Floral, Polka Dot, Striped, etc.)
7. **colors** - Color values (Red, Blue, Navy, etc.)
8. **sizes** - Size values (XS, S, M, L, XL, etc.)
9. **fits** - Fit types (Slim, Relaxed, Oversized, etc.)
10. **collections** - Collection names
11. **priceMinCents** - Minimum price in cents
12. **priceMaxCents** - Maximum price in cents
13. **embellishments** - Embellishment types (Lace, Beading, etc.)
14. **necklines** - Neckline types (V-Neck, Round, Square, etc.)
15. **sleeveLengths** - Sleeve types (Long Sleeve, Short Sleeve, Sleeveless, etc.)
16. **ageGroups** - Age groups (Kids, Adult, Baby, etc.)

### Enriched Fashion Facets
17. **formalityLevel** - Formality (Casual, Semi-Formal, Formal)
18. **temperatureIntent** - Weather intent (Warm Weather, Cool Weather, All-Weather)
19. **humidityFriendly** - Boolean flag for humidity-friendly products
20. **occasionContext** - Array of occasion contexts (uses GIN index)
21. **problemSolutions** - Array of problem solutions (uses GIN index)
22. **functionFeatures** - Array of function features (uses GIN index)
23. **colorShade** - Color shade (Light, Medium, Dark)
24. **colorUndertone** - Color undertone (Warm, Cool, Neutral)
25. **multicolor** - Boolean flag for multicolor products
26. **seasonalPalette** - Seasonal color palettes

### Additional Enriched Attributes
27. **careRequirements** - Care instructions (Machine Washable, Dry Clean Only, etc.)
28. **rainWind** - Weather resistance (Weather Resistant, Waterproof, etc.)
29. **travelFeatures** - Travel-friendly features (Packable, Wrinkle-Free, etc.)
30. **pockets** - Pocket presence (With Pockets, No Pockets)
31. **liningType** - Lining type (Lined, Unlined, Fully Lined, etc.)
32. **braSolution** - Bra compatibility (Bra Friendly, Built-in Bra, etc.)
33. **ecoMaterials** - Eco-friendly materials (Organic, Recycled, Sustainable, etc.)
34. **certifications** - Certifications (GOTS Certified, OEKO-TEX, etc.)
35. **origin** - Origin (Made in USA, Made in Italy, etc.)
36. **adaptiveFeatures** - Adaptive/inclusive features
37. **sensoryFriendly** - Sensory-friendly features (Tagless, Soft Textures, etc.)
38. **finish** - Finish/texture (Matte, Glossy, Satin Finish, etc.)
39. **modestyCues** - Modesty features (Modest, Coverage, Conservative, etc.)
40. **layeringIntent** - Layering intent (For Layering, Standalone, Base Layer)
41. **pairingIntent** - Pairing intent (Versatile, Matching Set, Coordinates)

### Category-Specific Constraints
42. **scents** - For Perfumes/Candles (Lavender, Vanilla, etc.)
43. **rooms** - For Home & Living (Bedroom, Bathroom, etc.)
44. **useCases** - Generic usage contexts (Travel, Office, Gift, etc.)
45. **benefits** - Generic product benefits (Durable, Lightweight, etc.)
46. **claims** - Generic certifications/claims (Organic, Vegan, etc.)
47. **sensoryProfile** - Generic experiential descriptors (Soft Feel, Citrus Scent, etc.)
48. **compatibility** - Generic compatibility requirements (Works with iOS, For Small Rooms, etc.)

---

## Constraint Usage Breakdown

### ✅ Always Hard Filters (SQL WHERE - Always Applied)
These are **always** applied as hard filters in SQL WHERE clauses:

| Constraint | SQL Column | Notes |
|------------|------------|-------|
| `merchantId` | `merchantId` | Multi-tenant isolation (always applied) |
| `isActive` | `isActive` | Only active products (always applied) |
| `stockStatus` | `stockStatus` | Default: `'in_stock'` only (always applied) |
| `category` | `category` | Category matching with subcategory tolerance |

---

### ✅ Hard Filters (SQL WHERE - Conditional)
These are applied as hard filters in SQL WHERE clauses when specified:

| Constraint | SQL Column/Expression | Notes |
|------------|----------------------|-------|
| `priceMinCents` / `priceMaxCents` | `priceCents` | Price range filter: `priceCents >= min AND priceCents <= max` |
| `brand` | `brand` | Brand filter: `brand = ANY(ARRAY[...])` |
| `length` | `length` (enriched column) | `length = ANY(ARRAY[...])` |
| `formalityLevel` | `formalityLevel` (enriched) | `formalityLevel = ANY(ARRAY[...])` |
| `temperatureIntent` | `temperatureIntent` (enriched) | `temperatureIntent = '...'` |
| `humidityFriendly` | `humidityFriendly` (enriched) | `humidityFriendly = true/false` |
| `occasionContext` | `occasionContext` (enriched, array) | `occasionContext && ARRAY[...]` (array overlap) |
| `problemSolutions` | `problemSolutions` (enriched, array) | `problemSolutions && ARRAY[...]` (array overlap) |
| `functionFeatures` | `functionFeatures` (enriched, array) | `functionFeatures && ARRAY[...]` (array overlap) |
| `colorShade` | `colorShade` (enriched) | `colorShade = ANY(ARRAY[...])` |
| `colorUndertone` | `colorUndertone` (enriched) | `colorUndertone = ANY(ARRAY[...])` |
| `multicolor` | `multicolor` (enriched) | `multicolor = true/false` |
| `ageGroup` | `ageGroup` (enriched) | Applied when explicitly mentioned in query |
| `colors` | `attributes->'variant_colors'` OR `enrichedColor` OR `attributes->>'color'` | Multiple sources checked in SQL |
| `gender` | `attributes->>'gender'` | From JSONB attributes |

---

### ✅ Post-SQL Filters (Category Dictionary-Based)
These are applied **after** SQL retrieval using category-specific dictionaries. Products that don't match are **excluded**:

| Constraint | Source | Dictionary Key | Notes |
|------------|--------|-----------------|-------|
| `colors` | `enrichedColor` OR `color` column | `availableColors` | Also hard filter in SQL, but post-SQL provides category-specific validation |
| `lengths` | `length` column OR `attributes->>'length'` | `availableLengths` | Also hard filter in SQL, but post-SQL provides category-specific validation |
| `sleeveLengths` | `sleeve` column OR `attributes->>'sleeve'` | `availableSleeves` | Mapped from `sleeveLengths` constraint to `sleeves` for filtering |
| `necklines` | `neckline` column OR `attributes->>'neckline'` | `availableNecklines` | Category-specific dictionary validation |
| `formalityLevel` | `formalityLevel` column OR `attributes->>'formalityLevel'` | `availableFormalityLevels` | Also hard filter in SQL, but post-SQL provides category-specific validation |
| `colorShade` | `colorShade` column OR `attributes->>'colorShade'` | `availableColorShades` | Also hard filter in SQL, but post-SQL provides category-specific validation |

**Note**: Post-SQL filters use category-specific dictionaries to ensure only values that exist in the filtered category are used. This prevents false positives from partial matches on unrelated values.

---

### ✅ Soft Ranking Only (Scoring - No Exclusion)
These are used **only** for scoring/ranking. Products that don't match are **not excluded**, but they get lower scores:

| Constraint | Weight | Source | Notes |
|------------|--------|--------|-------|
| `sizes` | 0.8 | `attributes->>'sizes'` OR `attributes->>'size'` | Size matching for ranking only |
| `occasions` | 0.6 | `attributes->>'occasion'` | Note: `occasionContext` (enriched) is a hard filter, but `occasions` (from attributes) is ranking only |
| `styles` | 0.4 (dynamic) | `attributes->>'style'` OR `attributes->>'Style'` | Dynamic weight based on query context |
| `patterns` | 0.4 (dynamic) | `attributes->>'pattern'` OR `attributes->>'Pattern'` OR `attributes->>'pattern_print'` | Dynamic weight based on query context |
| `materials` | 0.2 (dynamic) | `material`/`fabric` columns OR `attributes->>'material'` OR `attributes->>'fabric'` | Dynamic weight based on query context |
| `seasons` | 0.3 (dynamic) | `season` column OR `attributes->>'season'` | Dynamic weight based on query context |
| `fits` | 0.2 (dynamic) | `attributes->>'fit'` | Dynamic weight based on query context |
| `ageGroups` | 1.5 (when not explicit) | `ageGroup` column OR `attributes->>'ageGroup'` | Highest priority when not used as hard filter |
| `collections` | Variable | `attributes->>'collection'` | Collection matching for ranking |
| `embellishments` | Variable | `attributes->>'embellishment'` | Embellishment matching for ranking |
| `sleeveLengths` | Variable | `sleeve` column OR `attributes->>'sleeve'` | Mapped to sleeves for filtering, but also ranked |
| `seasonalPalette` | Variable | `seasonalPalette` (enriched) | Seasonal palette matching |
| `careRequirements` | Variable | `attributes->>'careRequirements'` | Care requirements matching |
| `rainWind` | Variable | `attributes->>'rainWind'` | Weather resistance matching |
| `travelFeatures` | Variable | `attributes->>'travelFeatures'` | Travel features matching |
| `pockets` | Variable | `attributes->>'pockets'` | Pocket presence matching |
| `liningType` | Variable | `attributes->>'liningType'` | Lining type matching |
| `braSolution` | Variable | `attributes->>'braSolution'` | Bra compatibility matching |
| `ecoMaterials` | Variable | `attributes->>'ecoMaterials'` | Eco materials matching |
| `certifications` | Variable | `attributes->>'certifications'` | Certifications matching |
| `origin` | Variable | `attributes->>'origin'` | Origin matching |
| `adaptiveFeatures` | Variable | `attributes->>'adaptiveFeatures'` | Adaptive features matching |
| `sensoryFriendly` | Variable | `attributes->>'sensoryFriendly'` | Sensory-friendly matching |
| `finish` | Variable | `attributes->>'finish'` | Finish matching |
| `modestyCues` | Variable | `attributes->>'modestyCues'` | Modesty cues matching |
| `layeringIntent` | Variable | `attributes->>'layeringIntent'` | Layering intent matching |
| `pairingIntent` | Variable | `attributes->>'pairingIntent'` | Pairing intent matching |
| `scents` | Variable | `attributes->>'scents'` | For Perfumes/Candles |
| `rooms` | Variable | `attributes->>'rooms'` | For Home & Living |
| `useCases` | Variable | `attributes->>'useCases'` | Generic usage contexts |
| `benefits` | Variable | `attributes->>'benefits'` | Generic benefits |
| `claims` | Variable | `attributes->>'claims'` | Generic claims |
| `sensoryProfile` | Variable | `attributes->>'sensoryProfile'` | Generic sensory profile |
| `compatibility` | Variable | `attributes->>'compatibility'` | Generic compatibility |

**Note**: Dynamic weights adjust based on:
- Query context (explicit mention vs. inferred)
- Intent level (required, strong, preferred, excluded)
- Product category relevance

---

### ✅ Both Hard Filter AND Ranking
These constraints are used for **both** filtering (excludes products) and ranking (scores products):

| Constraint | Hard Filter | Ranking | Notes |
|------------|-------------|---------|-------|
| `colors` | ✅ SQL WHERE + Post-SQL | ✅ Weight: 1.0 | Ensures only matching colors are returned, but also ranks by match quality |
| `lengths` | ✅ SQL WHERE + Post-SQL | ✅ Weight: 0.4 (dynamic) | Hard filter ensures correct length, ranking provides additional scoring |
| `formalityLevel` | ✅ SQL WHERE + Post-SQL | ✅ SQL Boost: +2.0 | Hard filter + ranking boost in SQL |
| `temperatureIntent` | ✅ SQL WHERE | ✅ SQL Boost: +2.5 | Hard filter + ranking boost in SQL |
| `humidityFriendly` | ✅ SQL WHERE | ✅ SQL Boost: +1.5 | Hard filter + ranking boost in SQL |
| `occasionContext` | ✅ SQL WHERE (array overlap) | ✅ SQL Boost: Variable | Hard filter + ranking boost in SQL |
| `problemSolutions` | ✅ SQL WHERE (array overlap) | ✅ SQL Boost: +2.0 per match | Hard filter + ranking boost in SQL |
| `functionFeatures` | ✅ SQL WHERE (array overlap) | ✅ SQL Boost: +1.5 per match | Hard filter + ranking boost in SQL |
| `colorShade` | ✅ SQL WHERE + Post-SQL | ✅ SQL Boost: +1.0 | Hard filter + ranking boost in SQL |
| `colorUndertone` | ✅ SQL WHERE | ✅ SQL Boost: +1.0 | Hard filter + ranking boost in SQL |
| `ageGroup` | ✅ SQL WHERE (if explicit) | ✅ Weight: 1.5 (if not explicit) | Hard filter when explicitly mentioned, ranking otherwise |

---

## Summary Table

| Constraint | Hard Filter (SQL) | Post-SQL Filter | Soft Ranking | Notes |
|------------|------------------|----------------|--------------|-------|
| `merchantId` | ✅ Always | ❌ | ❌ | Multi-tenant isolation |
| `isActive` | ✅ Always | ❌ | ❌ | Only active products |
| `stockStatus` | ✅ Always | ❌ | ❌ | Default: in_stock only |
| `category` | ✅ Always | ❌ | ✅ | Category boosts in ranking |
| `priceMinCents` / `priceMaxCents` | ✅ | ❌ | ❌ | Price range filter |
| `brand` | ✅ | ❌ | ❌ | Brand filter |
| `colors` | ✅ | ✅ | ✅ | Hard filter + post-SQL + ranking (weight: 1.0) |
| `lengths` | ✅ | ✅ | ✅ | Hard filter + post-SQL + ranking (weight: 0.4 dynamic) |
| `sleeveLengths` | ❌ | ✅ (as `sleeves`) | ✅ | Mapped to `sleeves` for filtering |
| `necklines` | ❌ | ✅ | ✅ | Post-SQL filter + ranking |
| `formalityLevel` | ✅ | ✅ | ✅ | Hard filter + post-SQL + SQL boost (+2.0) |
| `temperatureIntent` | ✅ | ❌ | ✅ | Hard filter + SQL boost (+2.5) |
| `humidityFriendly` | ✅ | ❌ | ✅ | Hard filter + SQL boost (+1.5) |
| `occasionContext` | ✅ | ❌ | ✅ | Hard filter (array overlap) + SQL boost |
| `problemSolutions` | ✅ | ❌ | ✅ | Hard filter (array overlap) + SQL boost (+2.0 each) |
| `functionFeatures` | ✅ | ❌ | ✅ | Hard filter (array overlap) + SQL boost (+1.5 each) |
| `colorShade` | ✅ | ✅ | ✅ | Hard filter + post-SQL + SQL boost (+1.0) |
| `colorUndertone` | ✅ | ❌ | ✅ | Hard filter + SQL boost (+1.0) |
| `multicolor` | ✅ | ❌ | ❌ | Boolean filter only |
| `ageGroup` | ✅ (if explicit) | ❌ | ✅ (if not explicit) | Weight: 1.5 (highest when ranking) |
| `sizes` | ❌ | ❌ | ✅ | Weight: 0.8 |
| `occasions` | ❌ | ❌ | ✅ | Weight: 0.6 (note: different from `occasionContext`) |
| `styles` | ❌ | ❌ | ✅ | Weight: 0.4 (dynamic) |
| `patterns` | ❌ | ❌ | ✅ | Weight: 0.4 (dynamic) |
| `materials` | ❌ | ❌ | ✅ | Weight: 0.2 (dynamic) |
| `seasons` | ❌ | ❌ | ✅ | Weight: 0.3 (dynamic) |
| `fits` | ❌ | ❌ | ✅ | Weight: 0.2 (dynamic) |
| `collections` | ❌ | ❌ | ✅ | Variable weight |
| `embellishments` | ❌ | ❌ | ✅ | Variable weight |
| `seasonalPalette` | ❌ | ❌ | ✅ | Variable weight |
| `careRequirements` | ❌ | ❌ | ✅ | Variable weight |
| `rainWind` | ❌ | ❌ | ✅ | Variable weight |
| `travelFeatures` | ❌ | ❌ | ✅ | Variable weight |
| `pockets` | ❌ | ❌ | ✅ | Variable weight |
| `liningType` | ❌ | ❌ | ✅ | Variable weight |
| `braSolution` | ❌ | ❌ | ✅ | Variable weight |
| `ecoMaterials` | ❌ | ❌ | ✅ | Variable weight |
| `certifications` | ❌ | ❌ | ✅ | Variable weight |
| `origin` | ❌ | ❌ | ✅ | Variable weight |
| `adaptiveFeatures` | ❌ | ❌ | ✅ | Variable weight |
| `sensoryFriendly` | ❌ | ❌ | ✅ | Variable weight |
| `finish` | ❌ | ❌ | ✅ | Variable weight |
| `modestyCues` | ❌ | ❌ | ✅ | Variable weight |
| `layeringIntent` | ❌ | ❌ | ✅ | Variable weight |
| `pairingIntent` | ❌ | ❌ | ✅ | Variable weight |
| `scents` | ❌ | ❌ | ✅ | Variable weight (Perfumes/Candles) |
| `rooms` | ❌ | ❌ | ✅ | Variable weight (Home & Living) |
| `useCases` | ❌ | ❌ | ✅ | Variable weight |
| `benefits` | ❌ | ❌ | ✅ | Variable weight |
| `claims` | ❌ | ❌ | ✅ | Variable weight |
| `sensoryProfile` | ❌ | ❌ | ✅ | Variable weight |
| `compatibility` | ❌ | ❌ | ✅ | Variable weight |

---

## Key Files

- **Hard Filters (SQL)**: 
  - `src/lib/search/vector/index.ts`
  - `src/lib/search/ranking/dbRankedSearch.ts`
  - `src/lib/loveshackfancy/ranking/sql-ranker.ts`

- **Post-SQL Filters**: 
  - `src/lib/search/filtering/post-filter.ts`
  - `src/lib/search/filtering/category-dictionaries.ts`

- **Soft Ranking**: 
  - `src/lib/loveshackfancy/ranking/constraint-matcher.ts`
  - `src/lib/loveshackfancy/ranking/constraint-ranker.ts`

- **Constraint Definitions**: 
  - `src/lib/loveshackfancy/classifier.ts` (FashionConstraints type)
  - `src/lib/search/types.ts` (SearchConstraints type)

---

## Notes

1. **Dynamic Weights**: Many ranking constraints use dynamic weights that adjust based on:
   - Query context (explicit mention vs. inferred)
   - Intent level (required, strong, preferred, excluded)
   - Product category relevance

2. **Category-Specific Dictionaries**: Post-SQL filters use category-specific dictionaries to ensure only values that exist in the filtered category are used. This prevents false positives from partial matches on unrelated values.

3. **Enriched Columns**: Many constraints have both:
   - **Enriched columns** (indexed database columns) - used for hard filtering and SQL-level ranking boosts
   - **JSONB attributes** (fallback) - used for ranking when enriched columns don't exist

4. **Array Constraints**: Some constraints are stored as arrays (e.g., `occasionContext`, `problemSolutions`, `functionFeatures`) and use PostgreSQL array overlap operators (`&&`) for filtering.

5. **Intent-Based Constraints**: Constraints can have intent levels (required, strong, preferred, excluded) which affect both filtering strictness and ranking weights.
