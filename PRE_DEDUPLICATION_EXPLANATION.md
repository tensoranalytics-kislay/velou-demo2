# Pre-Deduplication Step: What It Is and Why It Exists

## What is Pre-Deduplication?

**Pre-deduplication** is a step in the search pipeline that:
1. **Filters products** by basic criteria (category, gender, age group, etc.)
2. **Removes duplicate variants** of the same product
3. **Returns a list of unique product IDs** to search within

## Why Does It Exist?

### The Problem: Product Variants

E-commerce databases often have **multiple records for the same product** with different:
- **Sizes** (S, M, L, XL)
- **Colors** (Red, Blue, Green)
- **Variants** (different SKUs for the same item)

**Example:**
```
Product ID: dress-123-red-s
Product ID: dress-123-red-m
Product ID: dress-123-red-l
Product ID: dress-123-blue-s
Product ID: dress-123-blue-m
```

These are all **variants of the same dress** (dress-123), just in different sizes and colors.

### Why This Is a Problem

If you search for "red dress" and the database has:
- 1 dress in 5 sizes × 3 colors = **15 product records**

The search would return **15 results** for what is essentially **1 product**!

### The Solution: Deduplication

**Deduplication** groups variants together and keeps only **one representative** from each group.

**Deduplication Key Logic:**
1. Extract `shopifyProductId` from product ID (e.g., `dress-123`)
2. Fallback to `parent_id` if available
3. Fallback to `related_id` if available
4. Fallback to `sourceId` pattern (removing size/color suffixes)
5. Fallback to product ID itself

**Result:** All variants of `dress-123` are grouped together, and only **one** is selected (usually the one with highest score or best match).

## How Pre-Deduplication Works

### Step 1: Filter by Basic Criteria

The pre-deduplication step (`deduplicateProductsByCategoryForPostFiltering`) filters products by:

**Hard SQL Filters (Always Applied):**
- ✅ **Category** (e.g., "Women's Dresses")
- ✅ **Gender** (e.g., "female", "unisex")
- ✅ **Age Group** (e.g., "Adult")
- ✅ **Inclusivity Sizing** (e.g., "Standard Sizing")
- ✅ **Set vs Single** (e.g., "Single" to exclude pack products)
- ✅ **Stock Status** (e.g., "in_stock")
- ✅ **Price Range** (if specified)

**Intentionally Omitted (Applied Later):**
- ❌ **Colors** (applied via post-SQL filtering)
- ❌ **Materials** (applied via post-SQL filtering)
- ❌ **Seasons** (applied via post-SQL filtering)
- ❌ **Fits** (applied via post-SQL filtering)
- ❌ **Patterns** (applied via post-SQL filtering)
- ❌ **Occasions** (applied via post-SQL filtering)
- ❌ **Sleeves** (applied via post-SQL filtering)
- ❌ **Necklines** (applied via post-SQL filtering)
- ❌ **Formality Level** (applied via post-SQL filtering)

### Step 2: Deduplicate Variants

After filtering, the function:
1. Groups products by deduplication key
2. Selects the best product from each group (highest score)
3. Returns a list of unique product IDs

### Step 3: Pass to Vector Search

The deduplicated product IDs are passed to `searchVectorIndexWithDeduplication`, which:
1. Searches only within those pre-filtered products
2. Applies additional filters (materials, seasons, colors, etc.)
3. Returns final results

## Why Pre-Deduplication is Needed

### 1. **Performance Optimization**

**Without pre-deduplication:**
- Vector search would need to process **all products** in the database
- Then deduplicate **after** vector search (slower)
- More expensive embedding comparisons

**With pre-deduplication:**
- Filter to relevant products **first** (faster SQL query)
- Deduplicate **before** vector search (fewer products to process)
- Only search within relevant, deduplicated products

### 2. **Accuracy**

**Without pre-deduplication:**
- Search might return 10 variants of the same dress
- User sees duplicate results
- Poor user experience

**With pre-deduplication:**
- Only one representative per product
- Cleaner results
- Better user experience

### 3. **Efficiency**

**Without pre-deduplication:**
- Vector search processes 10,000 products
- Deduplicates to 2,000 unique products
- Returns top 10

**With pre-deduplication:**
- SQL filter reduces to 1,000 products
- Deduplicates to 500 unique products
- Vector search processes only 500 products
- Returns top 10

**Result:** Much faster and more efficient!

## The Current Issue

### The Problem

The pre-deduplication step **only filters by basic criteria** (category, gender, age), but **doesn't filter by material, season, or color**.

**Example Flow:**
1. **Pre-deduplication:** Filters to 331 products (category: "Women's Dresses", gender: "female", age: "Adult")
2. **Vector search:** Tries to filter those 331 by material="Cotton", season="Summer", color="Light"
3. **Result:** 0 products (because the 331 products don't match material/season/color)

**But:** The full database has 234 products that match ALL constraints (category + material + season + color)!

### Why This Happens

The 234 products that match all constraints are **not included** in the 331 pre-deduplicated products because:
- They may be filtered out during deduplication (if they're variants of products already selected)
- They may not match the category filter exactly (subcategory issues)
- They may be excluded by other filters (inclusivity sizing, set vs single, etc.)

### The Solution

**Option 1:** Include material/season/color filters in pre-deduplication
- **Pros:** More accurate filtering
- **Cons:** Slower SQL query, more complex

**Option 2:** Apply material/season/color filters BEFORE pre-deduplication
- **Pros:** Ensures matching products are included
- **Cons:** May reduce performance

**Option 3:** Use a two-stage approach
- Stage 1: Pre-deduplicate with basic filters
- Stage 2: Apply material/season/color filters
- Stage 3: Re-deduplicate if needed
- **Pros:** Balance between performance and accuracy
- **Cons:** More complex logic

## Summary

**Pre-deduplication is:**
- A performance optimization step
- Removes duplicate product variants
- Filters by basic criteria (category, gender, age)
- Returns unique product IDs for vector search

**Why it exists:**
- Improves search performance
- Prevents duplicate results
- Reduces vector search computation

**Current issue:**
- Pre-deduplication doesn't include material/season/color filters
- Products matching all constraints may be excluded
- Vector search then finds 0 results even though products exist

**The fix needed:**
- Include material/season/color filters in pre-deduplication, OR
- Apply those filters before pre-deduplication, OR
- Use a two-stage filtering approach
