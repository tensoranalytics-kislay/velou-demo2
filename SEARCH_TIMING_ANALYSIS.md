# Search Timing Analysis - "Lavender scented hand care sets" Query

## Query Performance Breakdown

Based on the logs from the terminal selection (lines 688-1019), here's the detailed timing breakdown:

### Overall Performance
- **Total Query Time**: **18.4 seconds** (18,386ms)
- **API Response Time**: **21.2 seconds** (includes overhead)

### Step-by-Step Breakdown

| Step | Duration | % of Total | Status |
|------|----------|------------|--------|
| **1. Classification** | **8.8s** (8,785ms) | **47.8%** | 🔴 **CRITICAL BOTTLENECK** |
| **2. Search/Retrieval** | **4.5s** (4,560ms) | **24.8%** | 🟡 **Optimizable** |
| **3. Product Loading** | **2.7s** (2,704ms) | **14.7%** | 🟡 **Optimizable** |
| **4. Ranking** | **8ms** | **0.04%** | ✅ **Efficient** |
| **5. Reply Generation** | **2.3s** (2,326ms) | **12.5%** | ✅ **Acceptable** |

---

## Detailed Analysis

### 1. Classification: 8.8 seconds 🔴

**What it does**: Uses LLM to classify query type and extract constraints (productTypes, collections, etc.)

**Why it's slow**:
- **Using `o3-mini` reasoning model** (default for `intent` purpose)
- Reasoning models are **much slower** than lightweight models (5-10x slower)
- The code comment even acknowledges this: *"This will use reasoning model, but we can't override easily"*

**Expected time**: ~1.6s (based on PERFORMANCE_ANALYSIS.md)
**Actual time**: 8.8s (5.5x slower than expected!)

**Location**: `src/lib/loccitane/classifier.ts::classifyQuery()`
- Calls `callLLM()` with `purpose: 'intent'`
- `src/lib/llm/provider.ts` routes `intent` → `o3-mini` (reasoning model)

---

### 2. Search/Retrieval: 4.5 seconds 🟡

**What it does**: Multi-view retrieval combining semantic search (vector similarity)

**Sub-breakdown**:
- **Semantic Embedding Generation**: **1.6s** (1,558ms)
  - OpenAI API call to generate embedding vector
  - Model: `text-embedding-3-small` (1536 dimensions)
  - Network latency + API processing time
  
- **Vector Search**: **3.0s** (2,999ms)
  - PostgreSQL pgvector query using cosine similarity
  - Query: `SELECT p.id, 1 - (p.embedding <=> $1::vector) as similarity FROM "Product" p WHERE ... ORDER BY p.embedding <=> $1::vector LIMIT 150`
  - Returns 150 product IDs with similarity scores
  
- **Concept Search**: **2ms** (negligible)
  - In-memory inverted index lookup
  - Found 0 products (constraint "Gift Set" not in index)

**Total Retrieval**: 4.5 seconds
- Found: 150 products (semantic only)
- Merged: 150 unique products

**Why it's slow**:
1. **Embedding API latency**: 1.6s is typical for OpenAI embeddings API (network + processing)
2. **Vector search**: 3.0s suggests the pgvector index might need optimization
   - Current index: `ivfflat` with `lists = 100`
   - Could benefit from:
     - Tuning `lists` parameter based on catalog size
     - Using `hnsw` index type (faster, but more memory)
     - Checking if index is being used (EXPLAIN ANALYZE)

**Location**: `src/lib/loccitane/retrieval.ts::multiViewRetrieval()`

---

### 3. Product Loading: 2.7 seconds 🟡

**What it does**: Loads full product objects from database for the 150 candidate IDs

**Why it's slow**:
- Single `findMany` query with 150 IDs
- Database query: `SELECT ... FROM "Product" WHERE id IN ($1, $2, ..., $150)`
- After filtering: 93 products remain

**Optimization opportunities**:
- Batch loading in smaller chunks
- Parallel queries
- Reduce candidate count before loading (currently loading 150, but only need top 20)

**Location**: `src/lib/loccitane/retrieval.ts` → `loadLoccitaneProducts()`

---

### 4. Ranking: 8ms ✅

**What it does**: Scores and sorts products by relevance

**Status**: Very fast, no optimization needed

---

### 5. Reply Generation: 2.3 seconds ✅

**What it does**: LLM call to generate conversational reply with RAG context

**Status**: Acceptable performance for LLM call

---

## Key Findings

### 🔴 **CRITICAL ISSUE: Classification Using Slow Reasoning Model**

The classification step is taking **8.8 seconds** (47.8% of total time) because it's using `o3-mini`, a reasoning model that's 5-10x slower than lightweight models.

**Evidence**:
- Code comment in `classifier.ts:217`: *"This will use reasoning model, but we can't override easily"*
- `provider.ts:47`: `intent: true` in `REASONING_PURPOSES` → routes to `o3-mini`
- Expected time: ~1.6s, Actual: 8.8s (5.5x slower)

**Impact**: If classification were optimized to 1.6s, total query time would drop from **18.4s → 11.2s** (39% improvement).

---

### 🟡 **Search Performance: 4.5 seconds**

The search itself is reasonable but has optimization opportunities:

1. **Embedding generation (1.6s)**: 
   - This is typical for OpenAI API latency
   - Could cache embeddings for common queries (but query variations make this less effective)

2. **Vector search (3.0s)**:
   - This is slower than expected for 150 results
   - Should investigate:
     - Is the pgvector index being used? (Run `EXPLAIN ANALYZE`)
     - Is `ivfflat` index properly tuned? (`lists = 100` might not be optimal)
     - Consider `hnsw` index type for faster searches (more memory, but faster)

---

## Recommendations

### Immediate (High Impact)

1. **Switch classification to lightweight model** ⚡
   - **Impact**: Reduce classification from 8.8s → ~1.6s
   - **Total time improvement**: 18.4s → 11.2s (39% faster)
   - **Action**: Modify `src/lib/llm/provider.ts` to allow classification to use `lightLlmModel` instead of `reasoningLlmModel`
   - **Trade-off**: Slightly less accurate classification, but likely acceptable for this use case

2. **Optimize vector search index** ⚡
   - **Impact**: Potentially reduce vector search from 3.0s → 1.0-1.5s
   - **Action**: 
     - Run `EXPLAIN ANALYZE` on the vector search query
     - Check if index is being used
     - Consider tuning `ivfflat` parameters or switching to `hnsw`

### Medium Priority

3. **Reduce candidate count before loading**
   - Currently loading 150 products, but only need top 20
   - **Impact**: Reduce product loading time
   - **Action**: Limit retrieval to top 50-100 candidates before loading full objects

4. **Parallelize product loading**
   - Split 150 IDs into batches and load in parallel
   - **Impact**: Reduce loading time from 2.7s → ~1.5s

### Long-term

5. **Cache embeddings for common queries**
   - Cache query → embedding mapping
   - **Impact**: Eliminate 1.6s embedding generation for cached queries
   - **Challenge**: Query variations make cache hit rate low

6. **Pre-warm concept index cache**
   - Already implemented, but ensure it's working
   - **Impact**: Eliminate first-query penalty

---

## Target Performance Goals

| Step | Current | Target | Improvement |
|------|---------|--------|--------------|
| Classification | 8.8s | 1.6s | **82% faster** |
| Search/Retrieval | 4.5s | 2.5s | **44% faster** |
| Product Loading | 2.7s | 1.5s | **44% faster** |
| Ranking | 8ms | 8ms | No change |
| Reply Generation | 2.3s | 2.0s | **13% faster** |
| **Total** | **18.4s** | **7.6s** | **59% faster** |

---

## Summary

**The search itself took 4.5 seconds**, which is reasonable but optimizable. However, **the classification step took 8.8 seconds** (almost 2x longer than the search!) because it's using a slow reasoning model (`o3-mini`) instead of a lightweight model.

**Primary bottleneck**: Classification using reasoning model (8.8s)
**Secondary bottleneck**: Vector search performance (3.0s)

**Quick win**: Switch classification to lightweight model → **~7 seconds improvement** (39% faster overall).




