# Category Classification and First-Level SQL Filtering

## Overview

This document outlines all categories/subcategories used in category classification and the logic for first-level SQL filtering.

## Categories Classified in Category Classification (48 Total)

The category classifier maps user queries to **1-3 most relevant categories** from the following 48 categories:

### Kids Categories (8)
1. **Girls Tops** - Kids tops/outerwear (Girls Sweaters, Girls Jackets, named tops)
2. **Girls Bottoms** - Kids bottoms/skirts (Girls Skirts, Little Girls Skirts)
3. **Girls Dresses** - Kids dresses (dress-style names, titles start with "Girls … Dress")
4. **Girls Swimwear** - Kids swim (Bikinis, Swimsuits)
5. **Baby & Toddler Bottoms** - Baby/toddler bottoms (Pinafores, Bloomers, sizes in months)
6. **Tween Pants** - Tween pants (titles start with "Tween … Pant")
7. **Tween Sweaters** - Tween sweaters (title includes "Tween … Pullover")
8. **Tween Dresses** - Tween dresses (taxon_path: Apparel > Tween Dresses)

### Women's / Adult Apparel (21)
9. **Women's Dresses** - Adult dresses (subcategories: Mini Dresses, Midi Dresses, Maxi Dresses, Active Dresses, Tween Dresses)
10. **Tops** - Adult tops (Sleeveless Tops, Long Sleeve Tops, Short Sleeve Tops, Sweaters, Pullover, Hoodies, Jackets)
11. **Bottoms** - Adult bottoms (Pants, Trousers, Sweatpants, Leggings, Jeans, Shorts, Ski Pants)
12. **Skirts** - Adult skirts (Mini Skirts, Midi Skirts, Maxi Skirts, Tween Skirts, Crib Skirts)
13. **Skorts** - Adult skorts (Active Skorts)
14. **Activewear** - Adult activewear (Sports Bra)
15. **Swimsuits** - Adult swim (One-Piece Swimsuits)
16. **Bikini Sets** - Adult bikini products
17. **Swim Cover-ups** - Adult swim coverups (Pareos, sarong)
18. **Cold Weather Essentials** - Adult cold-weather accessories (Beanies, Gloves & Mittens, neck gaiter)
19. **Loungewear** - Adult lounge (Robes, Pants)
20. **Robes** - Single robe item (bath robe)
21. **Pajama Set** - Pajama set items
22. **Shoes** - Adult footwear (Sandals, Boots)
23. **Ski Jackets** - Single ski jacket item
24. **Ski Tops** - Single ski top/pullover item
25. **Ski Shoes** - Ski footwear (Boots, women's boots)
26. **Sweaters** - Two sweater items (cardigan/pullover)
27. **Mini Dress** - Mini dress items (standalone category)
28. **Maxi Dress** - Maxi dress items (standalone category)
29. **Tote Bags** - Single tote bag item ("Weekender")

### Accessories (7)
30. **Accessories** - Bag/utility accessories (Cosmetic Bags, Travel Bags, Tote Bags, Backpacks, Sunglasses, bow tie/duffle/fanny packs)
31. **Jewelry** - Jewelry items (Earrings, Necklaces, Bracelets)
32. **Hair Accessories** - Mostly Headbands (face wash beauty headband)
33. **Pocket Squares** - Pocket squares ("for Women")
34. **Phone Cases** - Single iPhone case item
35. **Soap Dispensers** - Single porcelain soap dispenser item
36. **Makeup Kit** - Single "makeup play kit" item

### Personal Care (1)
37. **Perfumes** - Fragrance products (Parfums, Hair & Body Mists, Travel Sprays)

### Home & Living (11)
38. **Bedding** - Home textiles (Blankets, Quilts, Pillows, Sheet Sets, Duvet Cover & Sham Sets)
39. **Bathroom** - Bathroom items (Bath Mats, Shower Curtains)
40. **Towels** - Hand Towels, Bath Towels, Beach Towels
41. **Tabletop** - Dining/table linens (Napkin Sets, Tablecloths, Tumbler, napkin rings)
42. **Kitchen & Dining** - Aprons
43. **Stationary** - Paper goods (Notebooks, Card & Envelope Sets, Wrapping Papers)
44. **Interiors** - Wallpapers
45. **Candle** - Candles (Harlem Candles)
46. **Decorative Dishes** - Single decorative dish item (ring dish)
47. **Fragrance Tray** - Single decorative tray item (Decorative Trays)
48. **Pets** - Pet item(s) (Dog Beds)

## Subcategories in Database (from CATEGORY_TREE)

The database contains many subcategories. Key examples:

### Girls Dresses (37 subcategories)
- Alejandra Bow Mini Dress, Banson Luna Rosa Fleur Dress, Caliora Stretch Pointelle Dress, Camira Stretch Sequin Dress, Cecil & Lou Smocked Christmas Tree Dress, Cilona Satin Maxi Dress, Decker Heritage Dress, Parker Tailored Bow Dress, Rhiannon Cotton Dress, Sydelia Linen Mini Dress, etc.

### Women's Dresses (5 subcategories)
- Active Dresses, Maxi Dresses, Midi Dresses, Mini Dresses, Tween Dresses

### Girls Tops (29 subcategories)
- Caspia Cotton Ruffle Top, Fabielle Cotton Top, Mini Rubin Cotton Tee, Girls Jackets, Girls Sweaters, Little Girls Jackets, etc.

### Tops (21 subcategories)
- Blazers, Coats, Hoodies, Jackets, Long Sleeve Tops, Short Sleeve Tops, Sleeveless Tops, Sweaters, T-Shirts, Tween Jackets, Tween Sweaters, Tween Tops, Laptop Case, etc.

### Accessories (13 subcategories)
- Backpacks, Bow Tie, Cosmetic Bags, Duffle Bags, Fanny Packs, Jewelry, Makeup Kit, Phone Cases, Pocket Squares, Soap Dispensers, Sunglasses, Tote Bags, Travel Bags

### Bottoms (10 subcategories)
- Active Shorts, Jeans, Leggings, Men's Shorts, Pants, Sami Jeans, Shorts, Ski Pants, Sweatpants, Trousers

### Skirts (5 subcategories)
- Crib Skirts, Maxi Skirts, Midi Skirts, Mini Skirts, Tween Skirts

### Bedding (5 subcategories)
- Blankets, Duvet Cover & Sham Sets, Pillows, Quilts, Sheet Sets

### Perfumes (3 subcategories)
- Hair & Body Mists, Parfums, Travel Sprays

### And many more...

**Note**: The CATEGORY_TREE contains **50+ categories** with their subcategories. However, the category classifier only classifies to the **48 primary categories** listed above. The SQL filter then uses both category AND subcategory fields to match products.

## First-Level SQL Filtering Logic

### Function: `deduplicateProductsByCategoryForPostFiltering`

**Location**: `src/lib/search/vector/index.ts` (lines 685-953)

**Purpose**: First-level SQL filtering that filters by category, age group, and price ONLY (omits post-filterable attributes like colors, lengths, sleeves, etc.)

### SQL Filtering Steps (Order of Application)

#### STEP 1: Category Filtering (FIRST - Most Restrictive)

**Applied to**: Top 3 categories from category classifier (after expansion via `expandCategoriesForOptimalCoverage`)

**SQL Logic**:
```sql
WHERE (
  -- For each category, check BOTH category AND subcategory fields:
  (
    LOWER(p."category") = LOWER($category)           -- Exact match on category field
    OR LOWER(p."category") LIKE LOWER($%category%)   -- Partial match on category field
    OR LOWER(COALESCE(p."subcategory", '')) = LOWER($category)      -- Exact match on subcategory field
    OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($%category%) -- Partial match on subcategory field
  )
  OR -- Repeat for each of the top 3 categories
  ...
)
```

**Key Points**:
1. **Case-insensitive matching**: All comparisons use `LOWER()`
2. **Both exact AND partial matching**: Uses `=` for exact match and `LIKE '%category%'` for partial match
3. **Checks BOTH category AND subcategory columns**: This ensures products are found whether they're stored in the `category` field or `subcategory` field
4. **Multiple categories with OR**: Top 3 categories are combined with `OR` conditions (at least one must match)
5. **Null-safe subcategory checking**: Uses `COALESCE(p."subcategory", '')` to handle null subcategories

**Example Query**: `["Women's Dresses", "Girls Dresses"]`
```sql
WHERE (
  (LOWER(p."category") = LOWER('Women''s Dresses') OR LOWER(p."category") LIKE '%women''s dresses%' OR LOWER(COALESCE(p."subcategory", '')) = LOWER('Women''s Dresses') OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women''s dresses%')
  OR
  (LOWER(p."category") = LOWER('Girls Dresses') OR LOWER(p."category") LIKE '%girls dresses%' OR LOWER(COALESCE(p."subcategory", '')) = LOWER('Girls Dresses') OR LOWER(COALESCE(p."subcategory", '')) LIKE '%girls dresses%')
)
```

**Result**: Matches products with:
- `category = "Women's Dresses"` OR `category LIKE "%Women's Dresses%"`
- `subcategory = "Women's Dresses"` OR `subcategory LIKE "%Women's Dresses%"`
- `category = "Girls Dresses"` OR `category LIKE "%Girls Dresses%"`
- `subcategory = "Girls Dresses"` OR `subcategory LIKE "%Girls Dresses%"`

This also matches products with `category = "Women's Dresses"` AND `subcategory = "Maxi Dresses"` because the partial match on category field catches it.

#### STEP 2: Age Group Filtering (SECOND - After Category)

**Applied to**: Age groups extracted from query (e.g., `["Kids"]`)

**SQL Logic**:
```sql
WHERE (
  -- Check database column first (ageGroup field):
  (
    LOWER(COALESCE(p."ageGroup", '')) = LOWER($ageGroup)
    OR LOWER(COALESCE(p."ageGroup", '')) LIKE LOWER($%ageGroup%)
  )
  -- Fallback to JSONB attributes:
  OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($ageGroup)
  OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($%ageGroup%)
  OR LOWER(COALESCE(p.attributes->>'age_group', '')) = LOWER($ageGroup)
  OR LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE LOWER($%ageGroup%)
  -- Also check extensible attributes:
  OR (p.attributes->'extensible' IS NOT NULL AND (
    LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($ageGroup)
    OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($%ageGroup%)
  ))
  -- Also check category/subcategory for age keywords:
  OR (LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR ...)
  OR (LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR ...)
)
-- Exclude adult categories when searching for kids:
AND NOT (
  LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', ...)
  OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' ...
)
```

**Key Points**:
1. **Database column priority**: Checks `p."ageGroup"` column first, then JSONB attributes
2. **Multiple fallbacks**: Checks `attributes->>'ageGroup'`, `attributes->>'age_group'`, and `extensible->>'ageGroup'`
3. **Category keyword matching**: Also matches category/subcategory names containing age keywords (e.g., "kids", "children", "child")
4. **Exclusion logic**: When searching for kids, explicitly excludes products with adult age groups or adult category names

#### STEP 3: Price Filtering (THIRD - Optional)

**Applied to**: `priceMinCents` and `priceMaxCents` if provided

**SQL Logic**:
```sql
WHERE (
  p."priceCents" >= $priceMinCents
  AND p."priceCents" <= $priceMaxCents
)
```

#### STEP 4: Stock Status Filtering (ALWAYS APPLIED)

**SQL Logic**:
```sql
WHERE p."stockStatus" = 'in_stock'
```

#### STEP 5: Active Status Filtering (ALWAYS APPLIED)

**SQL Logic**:
```sql
WHERE p."isActive" = true
```

#### STEP 6: Merchant Filtering (ALWAYS APPLIED)

**SQL Logic**:
```sql
WHERE p."merchantId" = $merchantId
```

### Category Expansion Logic (Before SQL Filtering)

**Function**: `expandCategoriesForOptimalCoverage`

**Location**: `src/lib/search/filtering/category.ts` (lines 77-270)

**Purpose**: Expands category names to maximize product coverage before SQL filtering

**Logic**:
1. **Always includes original categories**: Original categories from classifier are always included
2. **Handles specific dress types**: For "Maxi Dress", "Mini Dress", "Midi Dress":
   - **DO NOT** expand to parent "Women's Dresses" (too broad - would match Mini Dresses when searching for Maxi)
   - SQL filter already checks both `category` and `subcategory` fields, so it will naturally catch `category="Women's Dresses"` AND `subcategory="Maxi Dresses"` products
3. **Expands subcategories to parent**: For non-dress subcategories (e.g., "Sports Bra" → "Activewear"), expands to parent category
4. **Handles plural variations**: If category is singular (e.g., "Maxi Dress"), checks if plural form exists as subcategory (e.g., "Maxi Dresses" under "Women's Dresses")
5. **Removes broad parents when specific types exist**: If both "Maxi Dress" and "Women's Dresses" are present, removes "Women's Dresses" to avoid overly broad matching

**Example Expansions**:
- `["Maxi Dress"]` → `["Maxi Dress"]` (NO expansion to "Women's Dresses" - SQL subcategory check handles it)
- `["Sports Bra"]` → `["Sports Bra", "Activewear"]` (expands to parent)
- `["Women's Dresses"]` → `["Women's Dresses"]` (already parent, naturally covers subcategories via SQL LIKE)

### Post-Filterable Attributes (NOT Applied in First-Level SQL)

The following attributes are **intentionally omitted** from first-level SQL filtering and applied later in post-SQL filtering:

- **Colors**: `enrichedColor`, `color` columns (post-filtered using category-specific dictionaries)
- **Lengths**: `length` column (post-filtered using category-specific dictionaries)
- **Sleeves**: `sleeve` column (post-filtered using category-specific dictionaries)
- **Necklines**: `neckline` column (post-filtered using category-specific dictionaries)
- **Formality Level**: `formalityLevel` column (post-filtered using category-specific dictionaries)
- **Color Shade**: `colorShade` column (post-filtered using category-specific dictionaries)

**Reason**: These attributes use category-specific dictionaries for matching (e.g., "Maxi" means different things in "Girls Dresses" vs "Women's Dresses"), so they're filtered AFTER we know the category context.

### Function: `deduplicateProductsByCategory` (Legacy - Includes More Filters)

**Location**: `src/lib/search/vector/index.ts` (lines 209-672)

**Purpose**: Similar to above, but includes additional SQL filters for colors, lengths, and other attributes (used when post-SQL filtering is disabled)

**Additional Filters** (compared to `deduplicateProductsByCategoryForPostFiltering`):
- Color filtering (STEP 2)
- Length filtering (STEP 4)
- Age group filtering (STEP 3) - same logic as above

## Summary: SQL Filtering Order

1. **Merchant ID** (always applied)
2. **Active Status** (`isActive = true`) (always applied)
3. **Stock Status** (`stockStatus = 'in_stock'`) (always applied)
4. **Category Filtering** (FIRST - most restrictive):
   - Top 3 categories from classifier (after expansion)
   - Checks BOTH `category` AND `subcategory` columns
   - Case-insensitive exact + partial matching
   - Combined with OR (any one of top 3 categories matches)
5. **Age Group Filtering** (SECOND - if provided):
   - Checks `ageGroup` column first, then JSONB attributes
   - Also checks category/subcategory for age keywords
   - Excludes adult categories when searching for kids
6. **Price Filtering** (THIRD - optional):
   - `priceCents >= priceMinCents` AND `priceCents <= priceMaxCents`
7. **Post-Filterable Attributes** (applied AFTER SQL, not in SQL):
   - Colors, Lengths, Sleeves, Necklines, Formality Level, Color Shade
   - Filtered using category-specific dictionaries in `applyPostSQLFilters`

## Category vs Subcategory Classification

**Category Classifier**: Returns **primary categories only** (1-3 from the 48 list above)

**Subcategory Handling**: 
- Subcategories are **NOT** directly classified by the category classifier
- Instead, SQL filtering checks BOTH `category` AND `subcategory` columns
- This means if a product has `category="Women's Dresses"` AND `subcategory="Maxi Dresses"`, it will match a query for `category="Maxi Dress"` because the SQL filter checks the subcategory field

**Category Expansion**: 
- `expandCategoriesForOptimalCoverage` can expand specific subcategories to their parent categories (e.g., "Sports Bra" → "Activewear")
- However, for dress types (Maxi/Mini/Midi), it **does NOT** expand to "Women's Dresses" to avoid overly broad matching



## Overview

This document outlines all categories/subcategories used in category classification and the logic for first-level SQL filtering.

## Categories Classified in Category Classification (48 Total)

The category classifier maps user queries to **1-3 most relevant categories** from the following 48 categories:

### Kids Categories (8)
1. **Girls Tops** - Kids tops/outerwear (Girls Sweaters, Girls Jackets, named tops)
2. **Girls Bottoms** - Kids bottoms/skirts (Girls Skirts, Little Girls Skirts)
3. **Girls Dresses** - Kids dresses (dress-style names, titles start with "Girls … Dress")
4. **Girls Swimwear** - Kids swim (Bikinis, Swimsuits)
5. **Baby & Toddler Bottoms** - Baby/toddler bottoms (Pinafores, Bloomers, sizes in months)
6. **Tween Pants** - Tween pants (titles start with "Tween … Pant")
7. **Tween Sweaters** - Tween sweaters (title includes "Tween … Pullover")
8. **Tween Dresses** - Tween dresses (taxon_path: Apparel > Tween Dresses)

### Women's / Adult Apparel (21)
9. **Women's Dresses** - Adult dresses (subcategories: Mini Dresses, Midi Dresses, Maxi Dresses, Active Dresses, Tween Dresses)
10. **Tops** - Adult tops (Sleeveless Tops, Long Sleeve Tops, Short Sleeve Tops, Sweaters, Pullover, Hoodies, Jackets)
11. **Bottoms** - Adult bottoms (Pants, Trousers, Sweatpants, Leggings, Jeans, Shorts, Ski Pants)
12. **Skirts** - Adult skirts (Mini Skirts, Midi Skirts, Maxi Skirts, Tween Skirts, Crib Skirts)
13. **Skorts** - Adult skorts (Active Skorts)
14. **Activewear** - Adult activewear (Sports Bra)
15. **Swimsuits** - Adult swim (One-Piece Swimsuits)
16. **Bikini Sets** - Adult bikini products
17. **Swim Cover-ups** - Adult swim coverups (Pareos, sarong)
18. **Cold Weather Essentials** - Adult cold-weather accessories (Beanies, Gloves & Mittens, neck gaiter)
19. **Loungewear** - Adult lounge (Robes, Pants)
20. **Robes** - Single robe item (bath robe)
21. **Pajama Set** - Pajama set items
22. **Shoes** - Adult footwear (Sandals, Boots)
23. **Ski Jackets** - Single ski jacket item
24. **Ski Tops** - Single ski top/pullover item
25. **Ski Shoes** - Ski footwear (Boots, women's boots)
26. **Sweaters** - Two sweater items (cardigan/pullover)
27. **Mini Dress** - Mini dress items (standalone category)
28. **Maxi Dress** - Maxi dress items (standalone category)
29. **Tote Bags** - Single tote bag item ("Weekender")

### Accessories (7)
30. **Accessories** - Bag/utility accessories (Cosmetic Bags, Travel Bags, Tote Bags, Backpacks, Sunglasses, bow tie/duffle/fanny packs)
31. **Jewelry** - Jewelry items (Earrings, Necklaces, Bracelets)
32. **Hair Accessories** - Mostly Headbands (face wash beauty headband)
33. **Pocket Squares** - Pocket squares ("for Women")
34. **Phone Cases** - Single iPhone case item
35. **Soap Dispensers** - Single porcelain soap dispenser item
36. **Makeup Kit** - Single "makeup play kit" item

### Personal Care (1)
37. **Perfumes** - Fragrance products (Parfums, Hair & Body Mists, Travel Sprays)

### Home & Living (11)
38. **Bedding** - Home textiles (Blankets, Quilts, Pillows, Sheet Sets, Duvet Cover & Sham Sets)
39. **Bathroom** - Bathroom items (Bath Mats, Shower Curtains)
40. **Towels** - Hand Towels, Bath Towels, Beach Towels
41. **Tabletop** - Dining/table linens (Napkin Sets, Tablecloths, Tumbler, napkin rings)
42. **Kitchen & Dining** - Aprons
43. **Stationary** - Paper goods (Notebooks, Card & Envelope Sets, Wrapping Papers)
44. **Interiors** - Wallpapers
45. **Candle** - Candles (Harlem Candles)
46. **Decorative Dishes** - Single decorative dish item (ring dish)
47. **Fragrance Tray** - Single decorative tray item (Decorative Trays)
48. **Pets** - Pet item(s) (Dog Beds)

## Subcategories in Database (from CATEGORY_TREE)

The database contains many subcategories. Key examples:

### Girls Dresses (37 subcategories)
- Alejandra Bow Mini Dress, Banson Luna Rosa Fleur Dress, Caliora Stretch Pointelle Dress, Camira Stretch Sequin Dress, Cecil & Lou Smocked Christmas Tree Dress, Cilona Satin Maxi Dress, Decker Heritage Dress, Parker Tailored Bow Dress, Rhiannon Cotton Dress, Sydelia Linen Mini Dress, etc.

### Women's Dresses (5 subcategories)
- Active Dresses, Maxi Dresses, Midi Dresses, Mini Dresses, Tween Dresses

### Girls Tops (29 subcategories)
- Caspia Cotton Ruffle Top, Fabielle Cotton Top, Mini Rubin Cotton Tee, Girls Jackets, Girls Sweaters, Little Girls Jackets, etc.

### Tops (21 subcategories)
- Blazers, Coats, Hoodies, Jackets, Long Sleeve Tops, Short Sleeve Tops, Sleeveless Tops, Sweaters, T-Shirts, Tween Jackets, Tween Sweaters, Tween Tops, Laptop Case, etc.

### Accessories (13 subcategories)
- Backpacks, Bow Tie, Cosmetic Bags, Duffle Bags, Fanny Packs, Jewelry, Makeup Kit, Phone Cases, Pocket Squares, Soap Dispensers, Sunglasses, Tote Bags, Travel Bags

### Bottoms (10 subcategories)
- Active Shorts, Jeans, Leggings, Men's Shorts, Pants, Sami Jeans, Shorts, Ski Pants, Sweatpants, Trousers

### Skirts (5 subcategories)
- Crib Skirts, Maxi Skirts, Midi Skirts, Mini Skirts, Tween Skirts

### Bedding (5 subcategories)
- Blankets, Duvet Cover & Sham Sets, Pillows, Quilts, Sheet Sets

### Perfumes (3 subcategories)
- Hair & Body Mists, Parfums, Travel Sprays

### And many more...

**Note**: The CATEGORY_TREE contains **50+ categories** with their subcategories. However, the category classifier only classifies to the **48 primary categories** listed above. The SQL filter then uses both category AND subcategory fields to match products.

## First-Level SQL Filtering Logic

### Function: `deduplicateProductsByCategoryForPostFiltering`

**Location**: `src/lib/search/vector/index.ts` (lines 685-953)

**Purpose**: First-level SQL filtering that filters by category, age group, and price ONLY (omits post-filterable attributes like colors, lengths, sleeves, etc.)

### SQL Filtering Steps (Order of Application)

#### STEP 1: Category Filtering (FIRST - Most Restrictive)

**Applied to**: Top 3 categories from category classifier (after expansion via `expandCategoriesForOptimalCoverage`)

**SQL Logic**:
```sql
WHERE (
  -- For each category, check BOTH category AND subcategory fields:
  (
    LOWER(p."category") = LOWER($category)           -- Exact match on category field
    OR LOWER(p."category") LIKE LOWER($%category%)   -- Partial match on category field
    OR LOWER(COALESCE(p."subcategory", '')) = LOWER($category)      -- Exact match on subcategory field
    OR LOWER(COALESCE(p."subcategory", '')) LIKE LOWER($%category%) -- Partial match on subcategory field
  )
  OR -- Repeat for each of the top 3 categories
  ...
)
```

**Key Points**:
1. **Case-insensitive matching**: All comparisons use `LOWER()`
2. **Both exact AND partial matching**: Uses `=` for exact match and `LIKE '%category%'` for partial match
3. **Checks BOTH category AND subcategory columns**: This ensures products are found whether they're stored in the `category` field or `subcategory` field
4. **Multiple categories with OR**: Top 3 categories are combined with `OR` conditions (at least one must match)
5. **Null-safe subcategory checking**: Uses `COALESCE(p."subcategory", '')` to handle null subcategories

**Example Query**: `["Women's Dresses", "Girls Dresses"]`
```sql
WHERE (
  (LOWER(p."category") = LOWER('Women''s Dresses') OR LOWER(p."category") LIKE '%women''s dresses%' OR LOWER(COALESCE(p."subcategory", '')) = LOWER('Women''s Dresses') OR LOWER(COALESCE(p."subcategory", '')) LIKE '%women''s dresses%')
  OR
  (LOWER(p."category") = LOWER('Girls Dresses') OR LOWER(p."category") LIKE '%girls dresses%' OR LOWER(COALESCE(p."subcategory", '')) = LOWER('Girls Dresses') OR LOWER(COALESCE(p."subcategory", '')) LIKE '%girls dresses%')
)
```

**Result**: Matches products with:
- `category = "Women's Dresses"` OR `category LIKE "%Women's Dresses%"`
- `subcategory = "Women's Dresses"` OR `subcategory LIKE "%Women's Dresses%"`
- `category = "Girls Dresses"` OR `category LIKE "%Girls Dresses%"`
- `subcategory = "Girls Dresses"` OR `subcategory LIKE "%Girls Dresses%"`

This also matches products with `category = "Women's Dresses"` AND `subcategory = "Maxi Dresses"` because the partial match on category field catches it.

#### STEP 2: Age Group Filtering (SECOND - After Category)

**Applied to**: Age groups extracted from query (e.g., `["Kids"]`)

**SQL Logic**:
```sql
WHERE (
  -- Check database column first (ageGroup field):
  (
    LOWER(COALESCE(p."ageGroup", '')) = LOWER($ageGroup)
    OR LOWER(COALESCE(p."ageGroup", '')) LIKE LOWER($%ageGroup%)
  )
  -- Fallback to JSONB attributes:
  OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) = LOWER($ageGroup)
  OR LOWER(COALESCE(p.attributes->>'ageGroup', '')) LIKE LOWER($%ageGroup%)
  OR LOWER(COALESCE(p.attributes->>'age_group', '')) = LOWER($ageGroup)
  OR LOWER(COALESCE(p.attributes->>'age_group', '')) LIKE LOWER($%ageGroup%)
  -- Also check extensible attributes:
  OR (p.attributes->'extensible' IS NOT NULL AND (
    LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) = LOWER($ageGroup)
    OR LOWER(COALESCE(p.attributes->'extensible'->>'ageGroup', '')) LIKE LOWER($%ageGroup%)
  ))
  -- Also check category/subcategory for age keywords:
  OR (LOWER(p."category") LIKE '%kids%' OR LOWER(p."category") LIKE '%children%' OR ...)
  OR (LOWER(COALESCE(p."subcategory", '')) LIKE '%kids%' OR ...)
)
-- Exclude adult categories when searching for kids:
AND NOT (
  LOWER(COALESCE(p.attributes->>'ageGroup', '')) IN ('adult', 'adults', 'women', 'womens', 'men', 'mens', ...)
  OR LOWER(p."category") LIKE '%women%' OR LOWER(p."category") LIKE '%men%' ...
)
```

**Key Points**:
1. **Database column priority**: Checks `p."ageGroup"` column first, then JSONB attributes
2. **Multiple fallbacks**: Checks `attributes->>'ageGroup'`, `attributes->>'age_group'`, and `extensible->>'ageGroup'`
3. **Category keyword matching**: Also matches category/subcategory names containing age keywords (e.g., "kids", "children", "child")
4. **Exclusion logic**: When searching for kids, explicitly excludes products with adult age groups or adult category names

#### STEP 3: Price Filtering (THIRD - Optional)

**Applied to**: `priceMinCents` and `priceMaxCents` if provided

**SQL Logic**:
```sql
WHERE (
  p."priceCents" >= $priceMinCents
  AND p."priceCents" <= $priceMaxCents
)
```

#### STEP 4: Stock Status Filtering (ALWAYS APPLIED)

**SQL Logic**:
```sql
WHERE p."stockStatus" = 'in_stock'
```

#### STEP 5: Active Status Filtering (ALWAYS APPLIED)

**SQL Logic**:
```sql
WHERE p."isActive" = true
```

#### STEP 6: Merchant Filtering (ALWAYS APPLIED)

**SQL Logic**:
```sql
WHERE p."merchantId" = $merchantId
```

### Category Expansion Logic (Before SQL Filtering)

**Function**: `expandCategoriesForOptimalCoverage`

**Location**: `src/lib/search/filtering/category.ts` (lines 77-270)

**Purpose**: Expands category names to maximize product coverage before SQL filtering

**Logic**:
1. **Always includes original categories**: Original categories from classifier are always included
2. **Handles specific dress types**: For "Maxi Dress", "Mini Dress", "Midi Dress":
   - **DO NOT** expand to parent "Women's Dresses" (too broad - would match Mini Dresses when searching for Maxi)
   - SQL filter already checks both `category` and `subcategory` fields, so it will naturally catch `category="Women's Dresses"` AND `subcategory="Maxi Dresses"` products
3. **Expands subcategories to parent**: For non-dress subcategories (e.g., "Sports Bra" → "Activewear"), expands to parent category
4. **Handles plural variations**: If category is singular (e.g., "Maxi Dress"), checks if plural form exists as subcategory (e.g., "Maxi Dresses" under "Women's Dresses")
5. **Removes broad parents when specific types exist**: If both "Maxi Dress" and "Women's Dresses" are present, removes "Women's Dresses" to avoid overly broad matching

**Example Expansions**:
- `["Maxi Dress"]` → `["Maxi Dress"]` (NO expansion to "Women's Dresses" - SQL subcategory check handles it)
- `["Sports Bra"]` → `["Sports Bra", "Activewear"]` (expands to parent)
- `["Women's Dresses"]` → `["Women's Dresses"]` (already parent, naturally covers subcategories via SQL LIKE)

### Post-Filterable Attributes (NOT Applied in First-Level SQL)

The following attributes are **intentionally omitted** from first-level SQL filtering and applied later in post-SQL filtering:

- **Colors**: `enrichedColor`, `color` columns (post-filtered using category-specific dictionaries)
- **Lengths**: `length` column (post-filtered using category-specific dictionaries)
- **Sleeves**: `sleeve` column (post-filtered using category-specific dictionaries)
- **Necklines**: `neckline` column (post-filtered using category-specific dictionaries)
- **Formality Level**: `formalityLevel` column (post-filtered using category-specific dictionaries)
- **Color Shade**: `colorShade` column (post-filtered using category-specific dictionaries)

**Reason**: These attributes use category-specific dictionaries for matching (e.g., "Maxi" means different things in "Girls Dresses" vs "Women's Dresses"), so they're filtered AFTER we know the category context.

### Function: `deduplicateProductsByCategory` (Legacy - Includes More Filters)

**Location**: `src/lib/search/vector/index.ts` (lines 209-672)

**Purpose**: Similar to above, but includes additional SQL filters for colors, lengths, and other attributes (used when post-SQL filtering is disabled)

**Additional Filters** (compared to `deduplicateProductsByCategoryForPostFiltering`):
- Color filtering (STEP 2)
- Length filtering (STEP 4)
- Age group filtering (STEP 3) - same logic as above

## Summary: SQL Filtering Order

1. **Merchant ID** (always applied)
2. **Active Status** (`isActive = true`) (always applied)
3. **Stock Status** (`stockStatus = 'in_stock'`) (always applied)
4. **Category Filtering** (FIRST - most restrictive):
   - Top 3 categories from classifier (after expansion)
   - Checks BOTH `category` AND `subcategory` columns
   - Case-insensitive exact + partial matching
   - Combined with OR (any one of top 3 categories matches)
5. **Age Group Filtering** (SECOND - if provided):
   - Checks `ageGroup` column first, then JSONB attributes
   - Also checks category/subcategory for age keywords
   - Excludes adult categories when searching for kids
6. **Price Filtering** (THIRD - optional):
   - `priceCents >= priceMinCents` AND `priceCents <= priceMaxCents`
7. **Post-Filterable Attributes** (applied AFTER SQL, not in SQL):
   - Colors, Lengths, Sleeves, Necklines, Formality Level, Color Shade
   - Filtered using category-specific dictionaries in `applyPostSQLFilters`

## Category vs Subcategory Classification

**Category Classifier**: Returns **primary categories only** (1-3 from the 48 list above)

**Subcategory Handling**: 
- Subcategories are **NOT** directly classified by the category classifier
- Instead, SQL filtering checks BOTH `category` AND `subcategory` columns
- This means if a product has `category="Women's Dresses"` AND `subcategory="Maxi Dresses"`, it will match a query for `category="Maxi Dress"` because the SQL filter checks the subcategory field

**Category Expansion**: 
- `expandCategoriesForOptimalCoverage` can expand specific subcategories to their parent categories (e.g., "Sports Bra" → "Activewear")
- However, for dress types (Maxi/Mini/Midi), it **does NOT** expand to "Women's Dresses" to avoid overly broad matching


