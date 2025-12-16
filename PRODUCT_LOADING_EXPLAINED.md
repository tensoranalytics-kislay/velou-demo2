# How Product Loading Works - Search vs Loading

## Overview

**Search and product loading are TWO SEPARATE phases:**

1. **SEARCH PHASE** (searches entire database) → Returns candidate IDs
2. **PRODUCT LOADING PHASE** (loads only top candidates) → Loads full product data

---

## Phase 1: Search (Searches Entire Database)

The search happens **FIRST** and searches the **entire database**:

### Multi-View Retrieval (`multiViewRetrieval`)

Searches **ALL products** in the database using three parallel methods:

1. **Semantic Search** (Vector similarity)
   - Searches ALL products with embeddings
   - Returns top 150 most similar products
   - Uses vector similarity search: `ORDER BY embedding <=> query_vector LIMIT 150`

2. **Concept Search** (Structured attribute index)
   - Searches ALL products in the concept index
   - Matches on ingredients, concerns, product types, etc.
   - Returns products matching the constraints

3. **Lexical Search** (Text/keyword search)
   - Searches ALL products for keyword matches
   - Returns top 150 matches
   - Uses PostgreSQL full-text search

### Result:
- Returns up to **400 merged candidate product IDs** (with deduplication)
- These are just **IDs** - no product data loaded yet
- The search has **already found the best matches** from the entire database

---

## Phase 2: Product Loading (Only Top Candidates)

**AFTER** search completes, we load full product objects:

```typescript
// From orchestrator.ts line 1033-1044
const MAX_PRODUCTS_TO_LOAD = 75;  // Currently loads top 75
const candidateIdsToLoad = retrievalResult.candidateIds.slice(0, MAX_PRODUCTS_TO_LOAD);

candidateProducts = await loadLoccitaneProducts(
  candidateIdsToLoad,  // Only loads top 75 IDs
  input.merchantId
);
```

### What happens:
1. Takes the **top 75 candidate IDs** from search results
2. Loads full product objects with all attributes from database
3. This is where the bottleneck is (13.9 seconds)

---

## Phase 3: Ranking & Display

After loading products:

1. **Ranking**: Sorts the loaded products by relevance score
2. **Display**: Shows only **top 4 products** to the user
3. **Store**: Saves top 20 ranked IDs for "show more" functionality

---

## Does Loading Fewer Products Affect Search Quality?

**NO!** Loading fewer products does NOT affect search quality because:

1. ✅ **Search already happened** - we've already found the best matches from the entire database
2. ✅ **We only need top 20** - ranking only uses the top products anyway
3. ✅ **We only show top 4** - user only sees 4 products

### Current Flow:
```
Search entire DB → 150-400 candidate IDs
                    ↓
Load top 75 products (13.9s bottleneck) ⚠️
                    ↓
Rank top 75 → Keep top 20
                    ↓
Show top 4 to user
```

### Optimized Flow:
```
Search entire DB → 150-400 candidate IDs
                    ↓
Load top 40-50 products (6-7s) ✅
                    ↓
Rank top 40-50 → Keep top 20
                    ↓
Show top 4 to user
```

---

## Why 75 Products Currently?

Looking at the code comment (line 1031-1032):

```typescript
// OPTIMIZATION: Only load top candidates to reduce database load time
// We only need ~20-30 products for ranking (top 4 shown), but load a bit more
// to account for filtering out previously shown products
```

The reasoning:
- Need top 20 after ranking (for "show more")
- Need buffer for filtering out previously shown products
- Loads 75 as a "safe" number

---

## Optimization Opportunity

**We can safely reduce from 75 to 40-50 products because:**

1. ✅ Search quality unchanged (searches entire DB first)
2. ✅ Still enough for ranking (only need top 20)
3. ✅ Still buffer for filtering (40-50 is plenty)
4. ✅ Would reduce load time from ~14s to ~6-7s
5. ✅ No impact on final results (still showing same top 4)

---

## Summary

| Phase | Searches/Processes | Current Count | Can Reduce? |
|-------|-------------------|---------------|-------------|
| **Search** | Entire database | All products | ❌ No - must search all |
| **Loading** | Top candidates only | 75 products | ✅ Yes - can reduce to 40-50 |
| **Ranking** | Loaded products | Up to 75 | N/A (depends on loading) |
| **Display** | Ranked products | Top 4 | ❌ No - this is fixed |

**Bottom line:** Product loading is a **performance optimization**, not a search limitation. The search already found the best matches from the entire database. Loading fewer products just reduces the time spent loading data we won't use.


