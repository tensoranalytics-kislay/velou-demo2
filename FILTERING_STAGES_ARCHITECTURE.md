# Why Filtering is Split Across Multiple Stages

## Current Architecture

The pipeline applies filters in **three separate stages**:

1. **Pre-Deduplication (SQL)**: Category, gender, age group, price, stock
2. **Vector Search (SQL)**: All required constraints (colors, materials, seasons, etc.)
3. **Post-SQL Filtering (In-Memory)**: Category-specific dictionary-based filtering

## Why This Architecture Exists

### 1. **Category-Specific Dictionary Matching** (Primary Reason)

**The Problem:**
Some constraint values mean different things in different categories:
- **"Maxi"** in "Girls Dresses" = different length than "Maxi" in "Women's Dresses"
- **"Long"** sleeve in "Tops" = different than "Long" sleeve in "Dresses"
- **"Formal"** in "Dresses" = different formality level than "Formal" in "Tops"

**The Solution:**
Post-SQL filtering uses **category-specific dictionaries** built from the actual products in each category. This allows:
- **Fuzzy matching**: "Maxi" matches "Maxi Length" in the dictionary
- **Synonym matching**: "Full sleeve" matches "Long" in the dictionary
- **Dictionary validation**: Only matches values that actually exist in that category

**Why Not in SQL?**
- SQL can't easily do fuzzy/synonym matching without complex CASE statements
- Dictionary validation requires knowing what values exist in each category
- Category-specific dictionaries are built dynamically from the filtered product set

### 2. **Performance Optimization** (Secondary Reason)

**The Goal:**
- Pre-deduplication should be **fast** (100-500ms) to reduce candidate set
- Vector search is **expensive** (200-800ms), so we want fewer products
- Post-SQL filtering is **flexible** but slower (in-memory processing)

**The Trade-off:**
- Fast pre-filtering (category only) → More products to process later
- Slow pre-filtering (all constraints) → Fewer products, but slower SQL query

**Current Approach:**
- Fast pre-filtering (category, gender, age) → ~1500 products
- Vector search filters by all constraints → ~150 products
- Post-SQL filtering refines with dictionaries → Final results

### 3. **Vector Search Needs Reasonable Candidate Set**

**The Problem:**
- Vector search calculates cosine similarity for each product
- More products = more computation = slower search

**The Solution:**
- Pre-deduplication reduces from 10,000+ products to ~1,500
- Vector search then processes only those 1,500 products
- Post-SQL filtering refines the final ~150 products

## The Current Problem

### Issue: Products Matching All Constraints May Be Excluded

**Example Flow:**
1. **Pre-deduplication**: Filters to 331 products (category: "Women's Dresses", gender: "female", age: "Adult")
2. **Vector search**: Tries to filter those 331 by material="Cotton", season="Summer", color="Light"
3. **Result**: 0 products (because the 331 products don't match material/season/color)

**But:** The full database has **234 products** that match ALL constraints!

**Why This Happens:**
- The 234 products matching all constraints are **not included** in the 331 pre-deduplicated products
- They may be filtered out during deduplication (variants of products already selected)
- They may not match the category filter exactly (subcategory issues)
- They may be excluded by other filters (inclusivity sizing, set vs single, etc.)

## Should We Consolidate Filtering Stages?

### Option 1: Apply ALL Required Constraints in Pre-Deduplication

**Pros:**
- ✅ Ensures products matching all constraints are included
- ✅ Single SQL query (simpler logic)
- ✅ Faster overall (one filtering stage instead of three)

**Cons:**
- ❌ Slower pre-deduplication SQL query (more complex WHERE clause)
- ❌ Can't use category-specific dictionaries (no fuzzy/synonym matching)
- ❌ Less flexible (harder to adjust matching logic)

**Implementation:**
```sql
-- Apply ALL required constraints in one SQL query
WHERE p."category" IN ('Women\'s Dresses')
  AND p."gender" = 'female'
  AND p."ageGroup" = 'Adult'
  AND (
    -- Material filter
    (LOWER(p."material") LIKE '%cotton%' OR LOWER(p."fabric") LIKE '%cotton%')
  )
  AND (
    -- Season filter
    LOWER(p."season") = 'summer'
  )
  AND (
    -- Color filter
    (LOWER(p."enrichedColor") LIKE '%light%' OR LOWER(p."color") LIKE '%light%')
  )
```

### Option 2: Apply ALL Required Constraints in Vector Search (Current Partial Implementation)

**Pros:**
- ✅ Already partially implemented (vector search applies required constraints)
- ✅ Can use SQL indexes for filtering
- ✅ Flexible (can adjust matching logic)

**Cons:**
- ❌ Still has the pre-deduplication problem (products may be excluded)
- ❌ Vector search SQL query becomes more complex
- ❌ Can't use category-specific dictionaries (no fuzzy/synonym matching)

**Current Implementation:**
```sql
-- Vector search already applies required constraints
WHERE p."category" IN ('Women\'s Dresses')
  AND p."gender" = 'female'
  AND (
    -- Material filter (OR logic)
    (LOWER(p."material") LIKE '%cotton%' OR LOWER(p."fabric") LIKE '%cotton%')
  )
  AND (
    -- Season filter
    LOWER(p."season") = 'summer'
  )
  AND (
    -- Color filter (OR logic for multiple colors)
    (LOWER(p."enrichedColor") LIKE '%light%' OR LOWER(p."color") LIKE '%light%')
  )
```

### Option 3: Keep Current Architecture But Fix Pre-Deduplication

**Pros:**
- ✅ Maintains category-specific dictionary matching (fuzzy/synonym)
- ✅ Fast pre-deduplication (category only)
- ✅ Flexible post-SQL filtering

**Cons:**
- ❌ Still has the pre-deduplication problem (products may be excluded)
- ❌ More complex architecture (three filtering stages)
- ❌ Slower overall (multiple filtering stages)

**Fix Needed:**
- Include material/season/color filters in pre-deduplication **OR**
- Apply those filters **before** pre-deduplication **OR**
- Use a two-stage approach (pre-filter → deduplicate → post-filter)

## Recommendation

### **Hybrid Approach: Apply Required Constraints in Pre-Deduplication**

**Why:**
1. **Fixes the exclusion problem**: Products matching all constraints will be included
2. **Maintains performance**: SQL filtering is still fast (indexed columns)
3. **Simplifies architecture**: One filtering stage instead of three

**Implementation:**
1. **Pre-deduplication**: Apply ALL required constraints (category, gender, age, material, season, color, etc.)
2. **Vector search**: Only apply semantic similarity (no additional filtering)
3. **Post-SQL filtering**: Use for soft constraints (preferred/excluded) with dictionary matching

**Trade-off:**
- Lose category-specific dictionary matching for required constraints
- But gain accuracy (products matching all constraints are included)
- Can still use dictionaries for soft constraints (preferred/excluded)

## Summary

**Current Architecture:**
- Pre-deduplication: Fast, but may exclude products matching all constraints
- Vector search: Applies required constraints, but works on pre-filtered set
- Post-SQL filtering: Uses dictionaries for fuzzy/synonym matching

**The Problem:**
- Products matching all constraints may be excluded from pre-deduplication
- Leads to 0 results even when products exist

**The Solution:**
- Apply ALL required constraints in pre-deduplication
- Use post-SQL filtering only for soft constraints (preferred/excluded) with dictionary matching
- Maintains performance while fixing the exclusion problem
