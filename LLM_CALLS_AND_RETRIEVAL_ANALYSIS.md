# LLM Calls and Retrieval/Filtering Performance Analysis

## LLM Calls Breakdown

### Total: **4 LLM Calls** for the query "dresses that go well with Dr. Martens high top chelsea shoes"

| # | Purpose | Model | Duration | Why This Model? | What It Does |
|---|---------|-------|----------|-----------------|--------------|
| 1 | **Query Categorizer** | `gpt-4.1-mini` (light) | 714ms | Fast, lightweight for simple categorization | Determines query type: `direct_search`, `refinement`, `clarification`, etc. |
| 2 | **Query Classification** | `gpt-4.1` (primary) | 4.35s | Primary model for accuracy in constraint extraction | Extracts constraints (styles, colors, lengths, necklines, etc.) from natural language |
| 3 | **Constraint Refinement** | `gpt-4.1` (primary) | 3.31s | Primary model for accuracy in validation | Validates extracted constraints against dictionaries, normalizes values |
| 4 | **Reply Generation** | `gpt-4.1` (primary) | 3.88s | Primary model for quality natural language | Generates conversational reply + emotional keywords for product cards |

### Model Selection Logic

From `src/lib/llm/provider.ts`:

```typescript
const PRIMARY_PURPOSES = {
  intent: true,        // Use primary (gpt-4.1) for constraint extraction
  final_reply: true,   // Use primary (gpt-4.1) for replies
  card_reason: false,  // Use light (gpt-4.1-mini) for keywords
  // ...
};
```

- **Primary Model (`gpt-4.1`)**: Used for `intent` and `final_reply` purposes
  - Why: Accurate constraint extraction is critical for product discovery
  - Why: High-quality natural language generation for user-facing replies

- **Light Model (`gpt-4.1-mini`)**: Used for `card_reason` and simple tasks
  - Why: Cost-effective for short product card keywords
  - Why: Fast for simple categorization tasks

### LLM Calls Not Used in This Query

These LLM calls are available but not triggered for this specific query:
- **Category Classifier**: Uses `gpt-4.1-mini` (light) - only runs if categorization needs category confidence
- **Emotional Keywords** (per product): Uses `gpt-4.1-mini` (light) - generates keywords for each product card
- **Constraint Merger**: Uses `gpt-4.1` (primary) - only runs on follow-up queries
- **Query Enhancer**: Uses `gpt-4.1-mini` (light) - only runs if query needs enhancement

### LLM Call Summary

- **Total LLM Time**: 11.54s (56.6% of total pipeline time)
  - Classification: 4.35s
  - Refinement: 3.31s
  - Reply: 3.88s

---

## Retrieval/Filtering Performance Analysis

### Total Retrieval Time: **7.18 seconds** (35.2% of total pipeline time)

### Stage-by-Stage Breakdown

#### Stage 1: Category-Only SQL Filter
- **Duration**: ~951ms
- **What Happens**:
  1. SQL query filters products by:
     - Gender (`female`)
     - Category (`Women's Dresses`)
     - Age Group (`Adult`)
     - Stock status (`inStockOnly = true`)
  2. Returns **195 product IDs** (category-filtered set)
  3. **No attribute filtering yet** (colors, lengths, necklines deferred to post-SQL)

- **Why Fast**: Single SQL query with indexed columns

#### Stage 2: Build Category-Specific Dictionaries
- **Duration**: ~702ms
- **What Happens**:
  1. Load all **195 products** from database (batch query)
  2. Extract attributes from each product:
     - Colors (from `enrichedColor`, `color` columns)
     - Lengths (from `length` column, `attributes->>'Length'`)
     - Sleeves (from `sleeve` column, `attributes->>'Sleeve Length'`)
     - Necklines (from `neckline` column, `attributes->>'Neckline'`)
     - Formality (from `formalityLevel` column)
     - Color Shades (from `colorShade` column)
  3. Group products by `(category, subcategory)` combination
  4. Build dictionaries: `"category|subcategory"` → unique attribute values for that category
  5. Result: **5 category dictionaries** (for 5 category/subcategory combinations)

- **Why It Takes Time**:
  - **Database query**: Loads 195 products with all attribute columns (`findMany` with `select`)
  - **Dictionary building**: Iterates through all products, extracts and normalizes attributes, groups by category
  - **JSONB parsing**: Extracts values from `attributes` JSONB column (slower than column access)

#### Stage 3: Post-SQL Filtering (SLOWEST)
- **Duration**: **~3.73 seconds** ⚠️
- **What Happens**:
  1. Load all **195 products** from database again (separate `findMany` call)
  2. For each product:
     - Look up category dictionary for product's `(category, subcategory)`
     - Apply intent-aware filtering:
       - **Hard filters** (if intent = `required` or `excluded`): Filter out non-matching products
       - **Soft filters** (if intent = `strong` or `preferred`): Skip filtering, use in ranking only
     - For each constraint type (lengths, sleeves, necklines):
       - Normalize product values and query values
       - Check dictionary for valid values
       - Match product values against query values (exact, partial, synonym matching)
       - Apply fashion synonym mappings (e.g., "full sleeve" → "long")
    3. Keep products that match ALL hard filters
    4. Result: **195 products** (0% reduction - all products matched filters)

- **Why It Takes So Long** ⚠️:
  1. **Duplicate Database Query**: Loads 195 products twice (once in Stage 2, once in Stage 3)
     - Stage 2: Loads products for dictionary building
     - Stage 3: Loads products again for filtering
     - **Optimization Opportunity**: Cache products loaded in Stage 2
  
  2. **In-Memory Processing**: Iterates through all 195 products sequentially
     - For each product: Look up dictionary, normalize values, match against multiple constraints
     - Multiple constraint types checked per product (lengths, sleeves, necklines, etc.)
     - Complex matching logic (exact, partial, synonym, dictionary validation)
  
  3. **JSONB Attribute Parsing**: Extracts attributes from JSONB column for each product
     - `attributes->>'Length'`, `attributes->>'Sleeve Length'`, `attributes->>'Neckline'`
     - JSONB parsing is slower than direct column access
  
  4. **Dictionary Lookups**: For each product, look up category dictionary
     - Map lookup: `categoryDictionaries.get(categoryKey)`
     - Dictionary validation for each attribute value
  
  5. **No Early Exit**: Processes all 195 products even if filters are very restrictive
     - Could short-circuit if enough products found, but doesn't

#### Stage 4: Concept Search (Parallel)
- **Duration**: 2.27s (runs in parallel with post-SQL filtering)
- **What Happens**:
  1. Searches concept index for products matching constraint keywords
  2. Uses JSONB attribute queries with LIKE patterns
  3. Returns 0 results (no matches found)

- **Why It Takes Time**:
   - Complex SQL queries with JSONB `LIKE` patterns
   - Multiple OR conditions for each constraint value
   - Searches through concept index

#### Stage 5: Vector Search (After Filtering)
- **Duration**: Included in retrieval time but not separately logged
- **What Happens**:
  1. Vector similarity search on filtered product IDs (195 products)
  2. Returns top 150 candidates by vector similarity

### Why Retrieval/Filtering Takes 7.18s Total

| Stage | Duration | % of Retrieval | Bottleneck |
|-------|----------|----------------|------------|
| Category SQL Filter | 951ms | 13.2% | Fast - indexed SQL |
| Dictionary Building | 702ms | 9.8% | Database query + JSONB parsing |
| **Post-SQL Filtering** | **3.73s** | **52.0%** | ⚠️ **Main bottleneck** |
| Concept Search | 2.27s | 31.6% | JSONB queries (runs in parallel) |
| Vector Search | ~500ms (estimated) | 7.0% | Fast - indexed vectors |

### Optimization Opportunities

1. **Cache Product Data** (Biggest Impact):
   - Load products once in Stage 2
   - Reuse loaded products in Stage 3 instead of querying again
   - **Estimated savings**: ~700ms (one database query eliminated)

2. **Batch Dictionary Building**:
   - Use SQL aggregation to build dictionaries instead of loading all products
   - **Estimated savings**: ~300ms

3. **Early Exit for Strict Filters**:
   - Stop processing once enough products match (if filtering is very restrictive)
   - **Estimated savings**: Variable (0-500ms depending on filter strictness)

4. **Parallel Processing**:
   - Process multiple products in parallel during post-SQL filtering
   - **Estimated savings**: ~1-2s (if parallelized with 4-8 workers)

5. **Reduce JSONB Parsing**:
   - Extract JSONB attributes once and cache
   - Use database columns where possible instead of JSONB

### Current Performance

- **Total Pipeline**: 20.40s
- **Retrieval/Filtering**: 7.18s (35.2%)
- **LLM Calls**: 11.54s (56.6%)
- **Other**: 1.68s (8.2%)

### Conclusion

**Why Retrieval Takes So Long**:
1. **Post-SQL filtering (3.73s)** is the main bottleneck:
   - Duplicate database queries (products loaded twice)
   - In-memory processing of 195 products
   - Complex matching logic with dictionary validation
   - JSONB attribute parsing

2. **Concept search (2.27s)** adds overhead:
   - Complex JSONB queries with LIKE patterns
   - Runs in parallel, so doesn't block, but still adds to total time

**Optimization Priority**:
1. **Cache product data** (eliminate duplicate query) - **~700ms savings**
2. **Parallelize post-SQL filtering** - **~1-2s savings**
3. **Use SQL aggregation for dictionary building** - **~300ms savings**

**Total Potential Savings**: **~2-3 seconds** (28-42% reduction in retrieval time)
