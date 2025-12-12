# Retrieval System Audit - Detailed Step-by-Step Documentation

## Overview

This document provides a comprehensive, granular breakdown of the retrieval system used in the Velou Shopping Assistant. The system implements a **multi-view retrieval architecture** that combines three parallel search paths (lexical, semantic, and concept-based) to find relevant products.

**Architecture Principle**: "Make retrieval the hero, LLM the narrator"
- Retrieval = deterministic, fast, uses ALL product attributes
- LLM = classification + explanation only (single call)
- Rule-based/template reasons = no per-product LLM calls

---

## High-Level Flow

```
User Query
    ↓
1. Safety Check
    ↓
2. Query Classification (LLM)
    ↓
3. Multi-View Retrieval (Parallel)
    ├─ A. Lexical Search
    ├─ B. Semantic Search
    └─ C. Concept Search
    ↓
4. Product Loading & Filtering
    ↓
5. Ranking & Scoring
    ↓
6. Reply Generation (RAG)
    ↓
7. Product Card Building
    ↓
Final Response (4 products)
```

---

## Step 1: Safety Check

**Location**: `src/lib/loccitane/safety.ts::checkQuerySafety()`

**Purpose**: Rule-based filtering of unsafe/non-shopping queries before any processing.

**Process**:
1. Checks query against predefined unsafe patterns
2. Returns `{ safe: boolean, reason?: string }`
3. If unsafe, returns generic response without product search

**Time**: <1ms (in-memory rule matching)

---

## Step 2: Query Classification

**Location**: `src/lib/loccitane/classifier.ts::classifyQuery()`

**Purpose**: Extract query intent and constraints using LLM.

**Process**:
1. **LLM Call**: Uses `LOCCITANE_QUERY_CLASSIFIER_PROMPT` with user message
2. **Extracts**:
   - Query type: `symptom_concern`, `ingredient_exploration`, `direct_product_search`, `gift_or_vague`, `unrelated`
   - Constraints:
     - `concerns`: e.g., "anti-aging", "dryness"
     - `skinTypes`: e.g., "sensitive", "oily"
     - `applicationAreas`: e.g., "face", "body"
     - `mustHaveIngredients`: e.g., "almond oil", "shea butter"
     - `madeWithout`: e.g., "parabens", "sulfates"
     - `productTypes`: e.g., "Hand Cream", "Face Moisturizer"
     - `collections`: e.g., "Immortelle", "Verbena"
     - `priceMinCents` / `priceMaxCents`: budget constraints
     - `genders`, `ageGroups`: demographic filters
3. **Returns**: `QueryClassification` object with type and constraints

**Time**: ~1.5-2s (LLM API call)

**Key Files**:
- `src/lib/loccitane/classifier.ts`
- `src/lib/loccitane/prompts.ts` (LOCCITANE_QUERY_CLASSIFIER_PROMPT)

---

## Step 3: Multi-View Retrieval

**Location**: `src/lib/loccitane/retrieval.ts::multiViewRetrieval()`

**Purpose**: Retrieve candidate products using three parallel search paths.

**Architecture**: All three paths run in parallel using `Promise.allSettled()` for fault tolerance.

**Constants**:
- `LEXICAL_LIMIT = 150` (max products from lexical search)
- `SEMANTIC_LIMIT = 150` (max products from semantic search)
- `MAX_CANDIDATES = 400` (max merged candidates)

---

### 3A. Lexical Search Path

**Location**: `src/lib/search/index.ts::searchProducts()`

**Purpose**: Traditional keyword-based search using PostgreSQL full-text search.

**Process**:

#### 3A.1. Constraint Conversion
- Converts `QueryClassification` constraints to `SearchConstraints`
- Maps product types → category hints
- Adds collections to query text for keyword matching
- Sets `limit: 150`, `inStockOnly: true`

#### 3A.2. Build WHERE Filters
**Location**: `src/lib/search/query/buildFilters.ts::buildBroadWhereFilters()`

**Steps**:
1. **Stock Status**: Filters to `in_stock` or `low_stock` products
2. **Category Matching**: 
   - Uses canonical category mapping
   - Supports OR conditions for multiple categories
   - Checks both `category` and `subcategory` fields
3. **Keyword Filters**:
   - Extracts keywords from query text
   - Generates keyword combinations:
     - Priority 1: Exact phrases (e.g., "hand cream")
     - Priority 2: 2-word combinations (e.g., "hand cream" → "hand cream", "cream set")
     - Priority 3: Individual words
4. **Price Range**: Filters by `priceMinCents` and `priceMaxCents`
5. **Brand Filtering**: If specified
6. **Gender Filtering**: JSON path queries on attributes
7. **Merchandising Rules**: Applies `exclude_category` and `boost_category` rules

#### 3A.3. Dynamic Take Calculation
**Location**: `src/lib/search/query/calculateTake.ts::calculateDynamicTake()`

**Purpose**: Calculate how many products to fetch from database based on:
- Base limit (150)
- Number of keyword filters
- Category constraints
- Adaptive scaling for large catalogs

**Result**: Typically 150-2500 products fetched from DB

#### 3A.4. Database Ranked Search
**Location**: `src/lib/search/ranking/dbRankedSearch.ts::dbRankedSearch()`

**Process**:
1. **Build SQL WHERE Clause**:
   - Multi-tenant isolation (`merchantId`)
   - Stock status filtering
   - Category matching (ILIKE with subcategory support)
   - Keyword prefiltering (exact phrases > 2-word combos > individual words)
   - Price range filtering
   - Brand filtering
   - Gender filtering (JSON path)

2. **Full-Text Search Ranking**:
   - Uses PostgreSQL `ts_rank` or `ts_rank_cd` for relevance scoring
   - Keyword boosts:
     - Exact phrase matches: highest boost
     - 2-word combinations: medium boost
     - Individual words: lower boost
   - Category boosts from merchandising rules

3. **SQL Query Structure**:
   ```sql
   SELECT 
     p.*,
     ts_rank(...) as rank
   FROM "Product" p
   WHERE [filters]
   ORDER BY rank DESC, [category_boost], p."updatedAt" DESC
   LIMIT [dynamicTake]
   ```

4. **Returns**: Array of `RankedSearchResult` with relevance scores

**Time**: ~2-15s (depends on catalog size and query complexity)

#### 3A.5. In-Memory Attribute Filtering
**Location**: `src/lib/search/index.ts::matchesAttributeFilters()`

**Purpose**: Apply attribute-level filters that can't be done efficiently in SQL.

**Filters Applied**:
- **Colors**: Exact matching against color ontology
- **Fabrics/Materials**: JSON path queries
- **Seasons**: JSON path queries
- **Occasions**: JSON path queries
- **Sizes**: JSON path queries
- **Fit**: JSON path queries
- **Derived Facets**: Category bridges (e.g., "dress" → "Dresses" category)

**Process**:
1. Iterates through database candidates
2. Extracts attributes from JSON
3. Applies strict matching for hard constraints
4. Returns filtered products

**Time**: ~100-500ms (depends on candidate count)

#### 3A.6. Widening Fallback
**Location**: `src/lib/search/index.ts::buildWideningTiers()`

**Purpose**: If attribute filters eliminate all candidates, progressively relax constraints.

**Tiers**:
1. **Tier 1**: Remove least important attribute filters
2. **Tier 2**: Remove category constraint
3. **Tier 3**: Remove all attribute filters, keep only keyword matching

**Process**:
- Only activates if `filtered.length === 0 && dbCandidates.length > 0`
- Tries each tier until products are found
- Sets `wasRelaxed: true` flag

**Time**: Additional 1-3s if widening is needed

#### 3A.7. Final Lexical Results
- Returns up to 150 products
- Each product has:
  - `id`: Product ID
  - Relevance score (from database ranking)
  - All product fields needed for downstream processing

**Time Breakdown**:
- Constraint conversion: <1ms
- Filter building: ~10-50ms
- Database search: ~2-15s (main bottleneck)
- Attribute filtering: ~100-500ms
- **Total**: ~2-16s

---

### 3B. Semantic Search Path

**Location**: `src/lib/search/vector/index.ts`

**Purpose**: Vector similarity search using embeddings and pgvector.

**Process**:

#### 3B.1. Text Embedding
**Location**: `src/lib/search/vector/index.ts::embedText()`

**Process**:
1. **API Call**: Calls OpenAI Embeddings API
   - Endpoint: `https://api.openai.com/v1/embeddings`
   - Model: `text-embedding-3-small` (1536 dimensions)
   - Input: User query text
2. **Response**: Returns 1536-dimensional vector array
3. **Validation**: Checks embedding dimensions match expected (1536)

**Time**: ~200-500ms (OpenAI API latency)

**Error Handling**:
- Throws `EmbeddingError` if API fails
- Falls back gracefully in multi-view retrieval (returns empty array)

#### 3B.2. Vector Similarity Search
**Location**: `src/lib/search/vector/index.ts::searchVectorIndex()`

**Process**:
1. **Build SQL Query**:
   ```sql
   SELECT 
     p.id as "productId",
     1 - (p.embedding <=> $1::vector) as similarity
   FROM "Product" p
   WHERE p.embedding IS NOT NULL
     AND p."isActive" = true
     AND [filters: merchantId, stockStatus]
   ORDER BY p.embedding <=> $1::vector
   LIMIT 150
   ```

2. **pgvector Operator**:
   - `<=>` = cosine distance operator
   - `1 - distance` = similarity score (0-1, higher = more similar)
   - Orders by distance (ascending = most similar first)

3. **Filters Applied**:
   - `merchantId`: Multi-tenant isolation
   - `inStockOnly`: Only in-stock products
   - `embedding IS NOT NULL`: Only products with embeddings

4. **Returns**: Array of `{ productId: string, similarity: number }`
   - Sorted by similarity (descending)
   - Up to 150 results

**Time**: ~500ms-2s (depends on database size and index)

**Prerequisites**:
- Products must have `embedding` column populated
- Requires `pgvector` extension in PostgreSQL
- Embeddings should be generated during catalog ingestion

**Time Breakdown**:
- Embedding generation: ~200-500ms
- Vector search: ~500ms-2s
- **Total**: ~700ms-2.5s

---

### 3C. Concept Search Path

**Location**: `src/lib/search/concept/index.ts`

**Purpose**: In-memory inverted index search for attribute-based matching.

**Process**:

#### 3C.1. Concept Index Retrieval
**Location**: `src/lib/search/concept/cache.ts::getConceptIndex()`

**Process**:
1. **Cache Check**:
   - Checks in-memory cache keyed by `merchantId` (or 'default')
   - Cache TTL: 5 minutes
   - If cached and not expired, returns immediately

2. **Index Building** (if cache miss):
   **Location**: `src/lib/search/concept/index.ts::buildConceptIndex()`

   **Steps**:
   a. **Database Query**:
      ```sql
      SELECT p.id, p.attributes
      FROM "Product" p
      WHERE p."isActive" = true
        AND p.attributes->'loccitaneStructured' IS NOT NULL
        [AND p."merchantId" = $1]
      ```
   
   b. **Inverted Index Construction**:
      - Iterates through all products
      - Extracts `loccitaneStructured` attributes
      - Builds 6 inverted index maps:
        - `concerns`: `Map<canonicalConcern, Set<productId>>`
        - `skinTypes`: `Map<skinType, Set<productId>>`
        - `applicationAreas`: `Map<applicationArea, Set<productId>>`
        - `ingredients`: `Map<canonicalIngredient, Set<productId>>`
        - `madeWithout`: `Map<madeWithout, Set<productId>>`
        - `productTypes`: `Map<productType, Set<productId>>`
   
   c. **Normalization**:
      - All keys normalized to lowercase and trimmed
      - Ensures consistent matching

3. **Cache Storage**:
   - Stores index in memory with timestamp
   - Key: `merchantId || 'default'`
   - Value: `{ index: ConceptIndex, builtAt: number }`

**Time**:
- Cache hit: <1ms
- Cache miss (first query): ~2-5s (depends on product count)
- Subsequent queries: <1ms (cached)

**Index Structure**:
```typescript
type ConceptIndex = {
  concerns: Map<string, Set<string>>;        // "anti_aging" → Set<productId>
  skinTypes: Map<string, Set<string>>;      // "sensitive" → Set<productId>
  applicationAreas: Map<string, Set<string>>; // "face" → Set<productId>
  ingredients: Map<string, Set<string>>;     // "almond_oil" → Set<productId>
  madeWithout: Map<string, Set<string>>;     // "parabens" → Set<productId>
  productTypes: Map<string, Set<string>>;    // "hand_cream" → Set<productId>
};
```

#### 3C.2. Concept Index Search
**Location**: `src/lib/search/concept/index.ts::searchConceptIndex()`

**Process**:
1. **Constraint Mapping**:
   - Maps classification constraints to concept index lookups:
     - `concerns` → `index.concerns`
     - `skinTypes` → `index.skinTypes`
     - `applicationAreas` → `index.applicationAreas`
     - `mustHaveIngredients` → `index.ingredients`
     - `madeWithout` → `index.madeWithout`
     - `productTypes` → `index.productTypes`

2. **Union Operation**:
   - For each constraint value, looks up in appropriate map
   - Collects all matching product IDs into a Set
   - Returns union of all matches (OR logic: product matches if it has ANY constraint)

3. **Normalization**:
   - Normalizes constraint values to lowercase/trimmed
   - Ensures consistent matching with index keys

4. **Returns**: Sorted array of product IDs (deterministic order)

**Time**: <10ms (in-memory Set operations)

**Example**:
```
Query: "anti-aging face cream with almond oil"
Constraints:
  - concerns: ["anti-aging"]
  - applicationAreas: ["face"]
  - ingredients: ["almond oil"]
  - productTypes: ["Face Cream"]

Process:
  1. Look up "anti-aging" in concerns map → Set{id1, id2, id3}
  2. Look up "face" in applicationAreas map → Set{id2, id4, id5}
  3. Look up "almond oil" in ingredients map → Set{id1, id2, id6}
  4. Look up "face cream" in productTypes map → Set{id2, id7}
  5. Union: {id1, id2, id3, id4, id5, id6, id7}
  6. Return sorted array
```

**Time Breakdown**:
- Index retrieval (cache hit): <1ms
- Index retrieval (cache miss): ~2-5s
- Concept search: <10ms
- **Total (cached)**: <10ms
- **Total (first query)**: ~2-5s

---

### 3D. Result Merging & Score Maps

**Location**: `src/lib/loccitane/retrieval.ts::multiViewRetrieval()`

**Process**:

#### 3D.1. Extract Results from Promise.allSettled
- Handles errors gracefully (each path can fail independently)
- Extracts:
  - `lexicalProducts`: Array of products from lexical search
  - `semanticResults`: Array of `{ productId, similarity }` from semantic search
  - `conceptProductIds`: Array of product IDs from concept search
  - `conceptIndex`: The concept index (for match tracking)

#### 3D.2. Build Score Maps

**Lexical Scores**:
- For each product in lexical results:
  - Positional score: `1.0 - (index / length) * 0.5`
  - First product gets 1.0, last gets ~0.5
  - Stored in `Map<productId, score>`

**Semantic Scores**:
- For each semantic result:
  - Uses similarity score directly from vector search (0-1)
  - Stored in `Map<productId, similarity>`

**Concept Matches**:
- Tracks which concepts matched which products
- Format: `Map<conceptValue, Set<productId>>`
- Used for ranking features (not scoring directly)

#### 3D.3. Merge Candidate IDs
1. **Union Operation**:
   - Creates a Set to deduplicate product IDs
   - Adds all lexical product IDs
   - Adds all semantic product IDs
   - Adds all concept product IDs

2. **Sorting & Limiting**:
   - Converts Set to sorted array (deterministic order)
   - Limits to `MAX_CANDIDATES = 400` products

3. **Returns**:
   ```typescript
   {
     candidateIds: string[];           // Up to 400 unique product IDs
     lexicalScores: Map<string, number>; // Positional scores
     semanticScores: Map<string, number>; // Similarity scores
     conceptMatches: Map<string, Set<string>>; // Concept → product IDs
   }
   ```

**Time**: ~10-50ms (Set operations and sorting)

**Total Multi-View Retrieval Time**:
- Parallel execution: max(lexical, semantic, concept)
- Typical: 2-16s (dominated by lexical search)
- First query: 4-20s (if concept index needs building)

---

## Step 4: Product Loading & Filtering

**Location**: `src/lib/loccitane/orchestrator.ts::loadLoccitaneProducts()`

**Purpose**: Load full product objects from database and filter for L'Occitane products with structured attributes.

**Process**:

#### 4.1. Database Query
```typescript
prisma.product.findMany({
  where: {
    id: { in: candidateIds },  // Up to 400 IDs
    isActive: true,
    merchantId: merchantId,     // Optional multi-tenant filter
  },
  select: {
    id, title, description, imageUrl, productUrl,
    priceCents, salePriceCents, currency,
    category, subcategory, stockStatus,
    attributes,              // JSON field with loccitaneStructured
    shopifyBestseller, shopifySalesRank, // Popularity fields
  },
})
```

**Time**: ~500ms-4s (depends on candidate count and database performance)

#### 4.2. Structured Attribute Filtering
- Iterates through loaded products
- Extracts `attributes.loccitaneStructured`
- **Filters out** products without structured attributes
- Converts to `ProductWithLoccitaneAttributes` type

**Time**: ~10-100ms (in-memory filtering)

#### 4.3. Exclude Previously Shown Products
- If `input.lastShownProductIds` provided:
  - Filters out products already shown to user
  - Prevents showing same products in follow-up queries

**Time**: <10ms

#### 4.4. Product Type Filter (for direct_product_search)
- If query type is `direct_product_search` and `productTypes` specified:
  - Normalizes requested product types
  - Filters products to match requested types
  - Uses fuzzy matching (includes/contains logic)
  - **Fallback**: If filter removes all products, reverts to unfiltered list

**Time**: ~10-50ms

#### 4.5. Avoid Ingredients Filter
- If `avoidIngredients` specified:
  - Normalizes avoid terms
  - Checks all ingredient fields:
    - `allIngredients`
    - `featuredIngredients`
    - `canonicalIngredients`
    - Top-level `ingredients` (fallback)
  - Excludes products containing ANY avoid term (substring match)
  - **Fallback**: If filter removes all products, reverts to previous filtered list

**Time**: ~10-100ms

**Total Loading & Filtering Time**: ~600ms-4.5s

---

## Step 5: Ranking & Scoring

**Location**: `src/lib/loccitane/ranking/ranker.ts::sortProductsByScore()`

**Purpose**: Score and rank products using heuristic-based scoring (can be replaced with ML model).

**Process**:

#### 5.1. Feature Engineering
**Location**: `src/lib/loccitane/ranking/features.ts::buildFeatures()`

**For each product**, builds a feature vector:

**Query-Product Match Features**:
- `lexicalScore`: From lexical search positional score (0-1)
- `semanticSimilarity`: From semantic search similarity (0-1)
- `exactTitleMatch`: Boolean (all query tokens in title)
- `titleTokenOverlap`: Jaccard similarity of query/title tokens (0-1)
- `highlightsTokenOverlap`: Jaccard similarity of query/highlights tokens (0-1)

**Attribute Match Features**:
- `concernsOverlap`: Count of matching canonical concerns
- `skinTypeMatch`: 1.0 if any match, 0.0 otherwise
- `applicationAreaMatch`: 1.0 if any match, 0.0 otherwise
- `productTypeMatch`: 1.0 if match (with fuzzy matching for gift queries)
- `ingredientMatchCount`: Count of matching canonical ingredients
- `madeWithoutMatchCount`: Count of matching madeWithout values

**Price & Merchandising Features**:
- `priceDistance`: Distance from budget range (0 = in range, 1 = very far)
- `popularityScore`: Normalized from `shopifySalesRank` (0-1, 1 = most popular)
- `isBestseller`: Boolean flag
- `inventoryStatus`: 1.0 in_stock, 0.5 low_stock, 0.0 out_of_stock

**Time**: ~1-5ms per product (for 400 products: ~400ms-2s)

#### 5.2. Scoring
**Location**: `src/lib/loccitane/ranking/ranker.ts::scoreProduct()`

**Query-Type-Specific Weights**:

**symptom_concern**:
- `concernWeight = 15.0`
- `skinTypeWeight = 12.0`
- `applicationAreaWeight = 10.0`
- `ingredientWeight = 4.0`

**ingredient_exploration**:
- `ingredientWeight = 15.0`
- `concernWeight = 5.0`
- `productTypeWeight = 6.0`

**direct_product_search**:
- `titleMatchWeight = 12.0`
- `productTypeWeight = 10.0`
- `lexicalWeight = 8.0`
- `semanticWeight = 8.0`

**gift_or_vague**:
- `popularityWeight = 8.0`
- `productTypeWeight = 8.0`
- `lexicalWeight = 6.0`
- `semanticWeight = 6.0`

**Scoring Formula**:
```typescript
score = 0.0
score += lexicalScore * lexicalWeight
score += semanticSimilarity * semanticWeight
score += (exactTitleMatch ? 1.0 : 0.0) * titleMatchWeight
score += titleTokenOverlap * (titleMatchWeight * 0.5)
score += highlightsTokenOverlap * 2.0
score += concernsOverlap * concernWeight
score += skinTypeMatch * skinTypeWeight
score += applicationAreaMatch * applicationAreaWeight
score += productTypeMatch * productTypeWeight
score += ingredientMatchCount * ingredientWeight
score += madeWithoutMatchCount * madeWithoutWeight
score -= priceDistance * 5.0  // Penalty for out-of-budget
score += popularityScore * popularityWeight
score += (isBestseller ? 1.0 : 0.0) * 2.0
score += inventoryStatus * 5.0
```

**Time**: <1ms per product (for 400 products: ~400ms)

#### 5.3. Sorting
- Sorts products by score (descending)
- Returns top 20 products

**Time**: ~1-10ms (sorting 400 products)

**Total Ranking Time**: ~1-3s (for 400 products)

---

## Step 6: Reply Generation (RAG)

**Location**: `src/lib/loccitane/reply.ts::generateReplyWithRag()`

**Purpose**: Generate natural language reply using LLM with retrieved product context.

**Process**:

#### 6.1. Product Serialization
- Serializes top 4 products for LLM prompt
- Includes: title, description, key attributes, price
- Uses `serializeProductForRag()` helper

#### 6.2. LLM Call
- **System Prompt**: `LOCCITANE_RAG_REPLY_PROMPT`
- **User Content**:
  ```
  User query: "[query]"
  Query classification: [JSON]
  Retrieved products (only reference these): [JSON array]
  Generate a helpful reply that references only the products above.
  ```
- **Purpose**: `final_reply`
- **Expects JSON**: `{ replyText: string, followupText?: string }`

#### 6.3. Response Parsing
- Strips JSON fences
- Validates required fields
- Falls back to template-based reply if parsing fails

**Time**: ~1.5-2.5s (LLM API call)

**Key Constraint**: LLM can only reference the 4 products provided (no hallucination)

---

## Step 7: Product Card Building

**Location**: `src/lib/loccitane/orchestrator.ts` (Step 7)

**Purpose**: Build product cards for display (using top 4 products).

**Process**:

#### 7.1. Select Top 4 Products
- Takes first 4 products from ranked list
- Ensures consistency with reply generation (same 4 products)

#### 7.2. Build Product Cards
For each product:
1. **Reason Generation**:
   - Uses `buildProductReason()` (template-based)
   - Includes: product type, concerns, ingredients, application area
   - Format: "Chosen because [reason]"

2. **Key Attributes Extraction**:
   - Top 2 canonical concerns
   - Top 2 canonical ingredients
   - Top 1 application area
   - Limited to 5 total attributes

3. **Card Structure**:
   ```typescript
   {
     id: string;
     title: string;
     imageUrl: string;
     productUrl: string;
     priceCents: number;
     salePriceCents: number | null;
     currency: string;
     reason: string;              // "Chosen because..."
     keyAttributes: string[];     // Top 5 attributes
     queryChips: [];              // Empty for L'Occitane
     stockStatus: string;
   }
   ```

**Time**: ~10-50ms (for 4 products)

---

## Complete Timing Breakdown

Based on logs from actual queries:

### Query: "new arrivals"
- **Total**: 21,669ms (21.7s)
- Classification: 1,770ms (8.2%)
- **Retrieval: 13,767ms (63.5%)** ← Main bottleneck
  - Lexical: ~13s
  - Semantic: ~1s
  - Concept: ~0.5s (cache miss on first query)
- Load: 4,186ms (19.3%)
- Ranking: 6ms (<0.1%)
- Reply: 1,936ms (8.9%)

### Query: "find me some hand creams"
- **Total**: 8,959ms (9.0s)
- Classification: 1,380ms (15.4%)
- **Retrieval: 4,052ms (45.2%)** ← Main bottleneck
- Load: 1,015ms (11.3%)
- Ranking: 2ms (<0.1%)
- Reply: 2,505ms (27.9%)

### Query: "rose hand cream"
- **Total**: 23,584ms (23.6s)
- Classification: 1,515ms (6.4%)
- **Retrieval: 15,733ms (66.7%)** ← Main bottleneck
- Load: 4,613ms (19.6%)
- Ranking: 2ms (<0.1%)
- Reply: 1,720ms (7.3%)

---

## Performance Optimization Opportunities

### 1. Retrieval Optimization (Biggest Impact)
- **Concept Index Caching**: Already implemented (5min TTL)
  - **Recommendation**: Pre-warm on startup or increase TTL
- **Lexical Search**: Database query is slowest part
  - **Recommendation**: Add database indexes on frequently queried fields
  - **Recommendation**: Consider materialized views for common queries
- **Semantic Search**: Vector search is relatively fast
  - **Recommendation**: Ensure `embedding` column is indexed with pgvector
  - **Recommendation**: Consider HNSW index for faster similarity search

### 2. Load Optimization
- **Batch Loading**: Already loads in batches (up to 400)
  - **Recommendation**: Consider pagination or streaming for very large result sets
- **Attribute Filtering**: In-memory filtering is fast
  - **Recommendation**: Consider moving some filters to SQL if possible

### 3. Ranking Optimization
- **Feature Caching**: Features are computed fresh each time
  - **Recommendation**: Cache computed features for products (with TTL)
- **ML Model**: Currently uses heuristic scoring
  - **Recommendation**: Train ML model (XGBoost/LightGBM) for better ranking

### 4. Parallelization
- **Multi-View Retrieval**: Already parallelized ✅
- **Load + Ranking**: Could potentially parallelize some steps
  - **Recommendation**: Load products while still ranking (if possible)

---

## File Structure Reference

```
src/lib/loccitane/
├── orchestrator.ts          # Main entry point, orchestrates all steps
├── safety.ts                # Step 1: Safety check
├── classifier.ts            # Step 2: Query classification
├── retrieval.ts             # Step 3: Multi-view retrieval orchestration
├── reply.ts                 # Step 6: RAG reply generation
├── reasons.ts               # Step 7: Product reason templates
└── ranking/
    ├── ranker.ts            # Step 5: Scoring and sorting
    └── features.ts          # Step 5: Feature engineering

src/lib/search/
├── index.ts                 # Step 3A: Lexical search main function
├── query/
│   ├── buildFilters.ts     # Step 3A.2: WHERE filter building
│   └── calculateTake.ts    # Step 3A.3: Dynamic take calculation
├── ranking/
│   ├── dbRankedSearch.ts   # Step 3A.4: Database ranked search
│   └── relevance.ts        # Step 3A.4: Relevance scoring
├── vector/
│   └── index.ts            # Step 3B: Semantic search
└── concept/
    ├── index.ts            # Step 3C: Concept index building & search
    └── cache.ts            # Step 3C.1: Concept index caching
```

---

## Key Design Decisions

1. **Parallel Retrieval**: Three paths run simultaneously for speed
2. **Fault Tolerance**: Each path can fail independently (Promise.allSettled)
3. **Score Preservation**: Scores from retrieval preserved for ranking
4. **Deterministic Ordering**: Concept search returns sorted IDs for consistency
5. **Progressive Filtering**: Filters applied in order (DB → attributes → product type → avoid ingredients)
6. **Fallback Logic**: If filters remove all products, reverts to previous filtered list
7. **Limit Enforcement**: Hard limit of 4 products for display (reduces choice confusion)

---

## Conclusion

The retrieval system is well-architected with clear separation of concerns. The main performance bottleneck is the **lexical search database query** (2-15s), which dominates total retrieval time. The system is designed for fault tolerance and handles errors gracefully at each step.

**Current Performance**:
- Best case: ~9s (cached concept index, simple query)
- Typical case: ~15-20s (first query, complex query)
- Worst case: ~25s (first query, very complex query with concept index build)

**Optimization Priority**:
1. **High**: Optimize lexical search database queries (indexes, query optimization)
2. **Medium**: Pre-warm concept index on startup
3. **Medium**: Cache computed ranking features
4. **Low**: Consider ML model for ranking (future enhancement)


