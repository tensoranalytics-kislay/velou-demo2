# Query Timing Analysis

## Latest Query: "dresses that go well with Dr. Martens high top chelsea shoes"

### Pipeline Stage Timings (from logs):

| Stage | Duration | Details |
|-------|----------|---------|
| **Query Categorizer** | **714ms** (0.71s) | Query categorization |
| **Category Classification** | **1001ms** (1.00s) | Category classification with confidence |
| **Classification (LLM)** | **4351ms** (4.35s) | Constraint extraction |
|   - LLM call | 4344ms (4.34s) | Main LLM processing |
| **Constraint Refinement** | **3307ms** (3.31s) | Dictionary validation |
| **Retrieval** | **7177ms** (7.18s) | Multi-view search + filtering |
|   - Category SQL filter | ~951ms | Stage 1: Category-only SQL |
|   - Dictionary building | ~702ms | Stage 2: Category dictionaries |
|   - Post-SQL filtering | ~3731ms | Stage 3: Dictionary-based filtering |
|   - Concept search | 2273ms | Concept index search |
| **Product Loading** | **943ms** (0.94s) | Loading 40 products from DB |
| **Ranking** | **13ms** (0.01s) | Constraint-based ranking |
| **Reply Generation** | **3883ms** (3.88s) | LLM reply + emotional keywords |
|   - LLM call | 3882ms (3.88s) | Main LLM processing |

### Total Pipeline Time: ~20.0 seconds

**Breakdown:**
- **Pre-Retrieval**: 9.37s (Classification + Refinement)
- **Retrieval**: 7.18s (Search + Filtering)
- **Post-Retrieval**: 4.84s (Loading + Ranking + Reply)

### Performance Analysis:

✅ **Within Target**: Total time is ~20s, which is reasonable for a complex query with:
- Multiple LLM calls (classification, refinement, reply)
- Multi-view retrieval (semantic, concept, lexical)
- Post-SQL filtering with category dictionaries
- Constraint-based ranking

### Bottlenecks:
1. **Retrieval (7.18s)**: Largest component
   - Post-SQL filtering: 3.73s (processing 195 products)
   - Concept search: 2.27s
   - Category SQL: 0.95s

2. **Classification + Refinement (9.37s)**: Second largest
   - Classification LLM: 4.35s
   - Refinement LLM: 3.31s
   - Category classification: 1.00s

3. **Reply Generation (3.88s)**: Third largest
   - LLM reply generation

### Fast Components:
- **Ranking (0.01s)**: Very fast constraint matching
- **Query Categorizer (0.71s)**: Quick categorization
