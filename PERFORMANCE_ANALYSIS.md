# Performance Analysis - Log Timing Breakdown

## Query Samples Analyzed

From the logs, I identified **4 complete queries**:

1. **"body care gift sets with shea butter"** (gift_or_vague)
2. **"recommend some body wash for hairy men"** (direct_product_search)
3. **"recommend me some body washes"** (direct_product_search)
4. **"show me some shampoos for dry skin"** (direct_product_search)

---

## Average Time Per Step

### Overall Average
- **Total Time**: **18.7 seconds** (18,745ms)
- **Range**: 9.7s - 29.1s

### Step-by-Step Breakdown

| Step | Average Time | % of Total | Range | Description |
|------|--------------|------------|-------|-------------|
| **1. Classification** | **1.6s** (1,641ms) | 8.8% | 1.4s - 1.8s | LLM call to classify query type & extract constraints |
| **2. Retrieval** | **11.4s** (11,443ms) | 61.0% | 4.5s - 20.3s | Multi-view retrieval (lexical + semantic + concept) |
| **3. Product Loading** | **3.4s** (3,416ms) | 18.2% | 1.1s - 5.8s | Load full product objects from DB + filtering |
| **4. Ranking** | **5ms** (5ms) | 0.03% | 1ms - 9ms | Score & sort products |
| **5. Reply Generation** | **2.2s** (2,235ms) | 11.9% | 2.0s - 2.4s | LLM call to generate reply with RAG |

---

## Detailed Breakdown by Query

### Query 1: "body care gift sets with shea butter"
- **Type**: gift_or_vague
- **Total**: 26.1s
  - Classification: 1.5s
  - Retrieval: 16.5s ⚠️ (SLOW)
  - Loading: 5.8s ⚠️ (SLOW)
  - Ranking: 9ms
  - Reply: 2.3s

### Query 2: "recommend some body wash for hairy men"
- **Type**: direct_product_search
- **Total**: 29.1s ⚠️ (SLOWEST)
  - Classification: 1.4s
  - Retrieval: 20.3s ⚠️ (SLOWEST)
  - Loading: 5.4s ⚠️ (SLOW)
  - Ranking: 6ms
  - Reply: 2.0s

### Query 3: "recommend me some body washes"
- **Type**: direct_product_search
- **Total**: 9.7s ✅ (FASTEST)
  - Classification: 1.8s
  - Retrieval: 4.5s ✅ (FASTEST)
  - Loading: 1.1s ✅ (FASTEST)
  - Ranking: 4ms
  - Reply: 2.2s

### Query 4: "show me some shampoos for dry skin"
- **Type**: direct_product_search
- **Total**: 10.1s ✅ (FAST)
  - Classification: 1.8s
  - Retrieval: 4.5s ✅ (FAST)
  - Loading: 1.3s ✅ (FAST)
  - Ranking: 1ms
  - Reply: 2.4s

---

## Key Findings

### 🔴 **CRITICAL BOTTLENECK: Retrieval (61% of total time)**
- **Average**: 11.4 seconds
- **Range**: 4.5s - 20.3s (4.5x variation!)
- **Why it varies**:
  - First query: 16.5s (likely concept index building)
  - Complex queries: 20.3s (multiple filters: hairTypes + productTypes + genders)
  - Simple queries: 4.5s (single productType filter)

**Retrieval sub-steps** (from logs):
- Lexical search: ~150 results (full-text PostgreSQL)
- Semantic search: ~150 results (vector similarity)
- Concept search: 0-124 results (concept index)
- Merging: 173-262 candidates

### 🟡 **SECONDARY BOTTLENECK: Product Loading (18% of total time)**
- **Average**: 3.4 seconds
- **Range**: 1.1s - 5.8s (5.3x variation!)
- **Correlates with retrieval**: More candidates = longer load time
- **Query 1**: 262 candidates → 5.8s load
- **Query 3**: 250 candidates → 1.1s load (inconsistent!)

**Load sub-steps**:
- Database query: `findMany` with up to 262 IDs
- Structured attribute filtering
- Product type filtering
- Avoid ingredients filtering

### 🟢 **Efficient Steps**
- **Classification**: 1.6s (consistent, single LLM call)
- **Ranking**: 5ms (in-memory sorting, very fast)
- **Reply Generation**: 2.2s (consistent, single LLM call with RAG)

---

## Performance Issues Identified

### 1. **Retrieval Time Variance (4.5x difference)**
- **Problem**: Complex queries take 4.5x longer than simple ones
- **Root Cause**: 
  - Multiple attribute filters (genders, hairTypes, productTypes) cause strict filtering
  - When filters are too strict → 0 results → relaxation → fallback to DB candidates (344 products)
  - See logs: `afterAttributeFilter: 0` → `wasRelaxed: true` → `dbCandidates: 344`

### 2. **Product Loading Inconsistency**
- **Problem**: Similar candidate counts (250-262) but 5x time difference (1.1s vs 5.8s)
- **Possible Causes**:
  - Database connection pooling issues
  - Query plan caching
  - Network latency spikes
  - Database load

### 3. **First Query Penalty**
- **Problem**: First query takes 16.5s retrieval (vs 4.5s average for others)
- **Root Cause**: Concept index cache miss (see log: `getConceptIndex: cache hit` on subsequent queries)

---

## Recommendations

### Immediate Optimizations

1. **Pre-warm concept index cache** on server startup
2. **Optimize attribute filtering** to avoid over-filtering → relaxation → fallback
3. **Add database query caching** for common product ID sets
4. **Parallelize product loading** with batch queries
5. **Reduce candidate count** before loading (currently loading 173-262, but only need top 20)

### Long-term Optimizations

1. **Move attribute filtering to SQL** (instead of in-memory)
2. **Add database indexes** on frequently filtered attributes
3. **Implement query result caching** for similar queries
4. **Use connection pooling** optimization
5. **Consider read replicas** for product queries

---

## Target Performance Goals

| Step | Current Avg | Target | Improvement |
|------|-------------|--------|-------------|
| Classification | 1.6s | 1.5s | 6% |
| Retrieval | 11.4s | 3-5s | 56-74% |
| Loading | 3.4s | 1-2s | 41-71% |
| Ranking | 5ms | 5ms | 0% |
| Reply | 2.2s | 2.0s | 9% |
| **Total** | **18.7s** | **8-10s** | **47-57%** |




