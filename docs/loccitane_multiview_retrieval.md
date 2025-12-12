# L'Occitane Multi-View Retrieval Architecture

## Overview

This document outlines the design for upgrading the L'Occitane optimized pipeline from single-view lexical search to **multi-view retrieval** (lexical + semantic + attribute/concept-based) while maintaining <5s response times and high accuracy.

**Core Principle**: **"Make retrieval the hero, LLM the narrator"**

- Retrieval = deterministic, fast, uses ALL product attributes
- LLM = classification + explanation only (single call)
- Rule-based/template reasons = no per-product LLM calls

---

## Current Implementation Summary

### Current Pipeline: `handleLoccitaneQuery()`

**Location**: `src/lib/loccitane/orchestrator.ts`

**Current Flow** (Multi-View Retrieval Pipeline):
1. **Safety gate** - `src/lib/loccitane/safety.ts::checkQuerySafety()`
   - Rule-based filtering of unsafe/non-shopping queries

2. **Query classification** - `src/lib/loccitane/classifier.ts::classifyQuery()`
   - LLM-based classification using `LOCCITANE_QUERY_CLASSIFIER_PROMPT`
   - Extracts query type and constraints (concerns, skinTypes, ingredients, etc.)

3. **Multi-view retrieval** - `src/lib/loccitane/retrieval.ts::multiViewRetrieval()`
   - Parallel retrieval from:
     - Lexical: `src/lib/search/index.ts::searchProducts()`
     - Semantic: `src/lib/search/vector/index.ts::searchVectorIndex()`
     - Concept: `src/lib/search/concept/index.ts::searchConceptIndex()`
   - Merges candidate IDs (up to 400)

4. **Product loading** - Filters for L'Occitane products with structured attributes

5. **Ranking** - `src/lib/loccitane/ranking/ranker.ts::sortProductsByScore()`
   - Feature engineering: `src/lib/loccitane/ranking/features.ts::buildFeatures()`
   - Heuristic scoring with query-type-specific weights
   - Returns top 20 ranked products

6. **RAG reply generation** - `src/lib/loccitane/reply.ts::generateReplyWithRag()`
   - Uses `LOCCITANE_RAG_REPLY_PROMPT` with retrieved product facts
   - Generates concise reply (< 60 words) and optional follow-ups

7. **Card generation** (template-based, no LLM):
   - Template-based reasons from `src/lib/loccitane/reasons.ts::buildProductReason()`
   - Extracts key attributes from `StructuredLoccitaneAttributes`

**Current Limitations**:
- **Single retrieval method**: Only lexical search via `searchProducts()`
- **Attribute parsing incomplete**: `product_details` stored as key:value object but `velou_attribute:Key:Value` entries not fully structured
- **No semantic search**: No vector embeddings or similarity search
- **No concept-based retrieval**: Cannot directly match "dandruff" → `Concern: Dry Scalp` products
- **Limited attribute utilization**: Many product attributes from `velou_attribute` format not used for filtering/matching

---

## Proposed Multi-View Retrieval Architecture

### High-Level Flow

```
User Query
    ↓
[Step 1] Safety + Domain Gate (rules, no LLM)
    ↓
[Step 2] Query Classification + Slot Extraction (small LLM, ~200-400ms)
    ↓
[Step 3] Multi-View Retrieval (parallel, ~200-500ms)
    ├─→ Lexical Search (existing searchProducts)
    ├─→ Semantic Vector Search (pgvector)
    └─→ Concept/Attribute Index (inverted index)
    ↓
[Step 4] Candidate Merging & ML Re-ranking (~50-100ms)
    ↓
[Step 5] LLM Reply Generation with RAG (~600-1000ms)
    └─→ Feed top N products + constraints → generate explanation
    ↓
[Step 6] Template-Based Card Reasons (0ms)
    ↓
Return Response
```

**Target**: Sub-2s typical, <5s hard upper bound

---

## Implementation Plan

### Phase 1: Attribute Parsing & Indexing Infrastructure

#### 1.1 Parse `product_details` → Structured Attributes

**Current State**:
- `product_details` stored as `Record<string, string>` in `attributes.product_details`
- Format: `"velou_attribute:Concern:Dryness"`, `"velou_attribute:Skin Type:Dry"`, etc.
- **Not fully parsed** into structured fields like `concerns[]`, `skinTypes[]`, `applicationAreas[]`

**New Module**: `src/lib/loccitane/attributeParser.ts`

**Functions**:
```typescript
export type StructuredLoccitaneAttributes = {
  // Concerns (from "velou_attribute:Concern:*")
  concerns: string[];
  
  // Skin/Hair Types (from "velou_attribute:Skin Type:*", "velou_attribute:Hair Type:*")
  skinTypes: string[];
  hairTypes: string[];
  
  // Application Areas (from "velou_attribute:Application Area:*")
  applicationAreas: string[];
  
  // Product Type/Formula (from "velou_attribute:Type:*", "velou_attribute:Formula:*")
  productType: string | null;
  formula: string | null; // "Scrub", "Oil", "Cream", "Serum"
  
  // Ingredients (from "velou_attribute:Featured Ingredients:*", "velou_attribute:Ingredients:*")
  featuredIngredients: string[];
  allIngredients: string[];
  
  // Safety/Claims (from "velou_attribute:Made Without:*")
  madeWithout: string[]; // "Paraben Free", "Sulfate Free"
  
  // Demographics (from "velou_attribute:Age Group:*", "velou_attribute:Gender:*")
  ageGroups: string[];
  genders: string[];
  
  // Canonical normalized values
  canonicalConcerns: string[]; // Mapped/normalized concerns
  canonicalIngredients: string[]; // Canonicalized ingredient names
};

/**
 * Parse product_details (key:value pairs) into structured attributes
 * Handles "velou_attribute:Key:Value" format entries
 */
export function parseLoccitaneAttributes(
  productDetails: Record<string, string> | null | undefined,
  existingAttributes?: ProductAttributes
): StructuredLoccitaneAttributes;
```

**Canonicalization**:
- Map synonyms: "Dry Scalp" + "Scalp Discomfort" → `dandruff/dry_scalp` concept
- Normalize ingredients: "Shea Butter", "Shea", "Butyrospermum Parkii" → `shea_butter`
- Map concerns: "Fine Lines & Wrinkles" → `aging`

**Storage**:
- Store parsed attributes in `Product.attributes` as `attributes.loccitaneStructured`
- Or extend `ProductAttributes` type to include these fields
- **Offline job**: Parse all products during ingestion or via migration script

**Files to Create/Modify**:
- `src/lib/loccitane/attributeParser.ts` (NEW)
- `src/lib/catalog/ingestUnifiedCsv.ts` (MODIFY: add attribute parsing step)
- `src/lib/search/types.ts` (MODIFY: extend `ProductAttributes` type)

---

#### 1.2 Build Multi-View Indexes

**1.2.1 Full-Text Index (Lexical/BM25)** - **EXISTS**

**Location**: `src/lib/search/index.ts` → `searchProducts()`

**Current**: PostgreSQL FTS with `search_vector` column
- Indexes: title, description, category, subcategory
- Uses `extractSearchableTextFromAttributes()` for attribute text

**Action**: **Keep as-is**, enhance `extractSearchableTextFromAttributes()` to include parsed concerns, ingredients

**1.2.2 Vector Index (Semantic)** - **NEW**

**Technology**: PostgreSQL `pgvector` extension

**New Module**: `src/lib/search/vector/index.ts`

**Functions**:
```typescript
/**
 * Generate embedding for query/product text
 */
export async function embedText(text: string): Promise<number[]>;

/**
 * Vector similarity search
 * Returns top N product IDs with similarity scores
 */
export async function searchVectorIndex(
  queryEmbedding: number[],
  limit: number,
  filters?: { inStockOnly?: boolean; merchantId?: string }
): Promise<Array<{ productId: string; similarity: number }>>;
```

**Index Structure**:
- Add `embedding` column to `Product` table (vector type, 1536 dimensions for OpenAI)
- Or separate `ProductEmbedding` table if needed
- Build embeddings offline during ingestion

**Embedding Model**: 
- Use OpenAI `text-embedding-3-small` or `text-embedding-ada-002` (faster, cheaper)
- Or use local model via ONNX runtime (e.g., `all-MiniLM-L6-v2`)

**Embedded Text**:
```typescript
const indexedText = [
  product.title,
  product.description,
  product.category,
  product.subcategory,
  ...structuredAttrs.concerns,
  ...structuredAttrs.featuredIngredients,
  ...structuredAttrs.skinTypes,
  product.attributes.productHighlights,
  ...product.attributes.bulletHighlights,
].join(' ')
```

**Database Migration**:
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index
CREATE INDEX IF NOT EXISTS idx_product_embedding 
  ON "Product" USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100); -- Adjust based on catalog size
```

**Files to Create/Modify**:
- `src/lib/search/vector/index.ts` (NEW)
- `prisma/schema.prisma` (MODIFY: add `embedding` field)
- Migration: `prisma/migrations/XXXX_add_product_embeddings/migration.sql` (NEW)

**1.2.3 Attribute/Concept Inverted Index** - **NEW**

**Purpose**: Direct lookup for "I have dandruff" → all products with `Concern: Dry Scalp`

**New Module**: `src/lib/search/concept/index.ts`

**In-Memory Index** (built on startup):
```typescript
type ConceptIndex = {
  // Concerns
  concerns: Map<string, Set<string>>; // "dry_scalp" → Set of product_ids
  
  // Skin Types
  skinTypes: Map<string, Set<string>>; // "sensitive" → Set of product_ids
  
  // Application Areas
  applicationAreas: Map<string, Set<string>>; // "scalp" → Set of product_ids
  
  // Ingredients (canonical)
  ingredients: Map<string, Set<string>>; // "shea_butter" → Set of product_ids
  
  // Made Without
  madeWithout: Map<string, Set<string>>; // "paraben_free" → Set of product_ids
  
  // Product Types
  productTypes: Map<string, Set<string>>; // "shampoo" → Set of product_ids
};

/**
 * Load concept index from database (one-time on startup)
 */
export async function buildConceptIndex(merchantId?: string): Promise<ConceptIndex>;

/**
 * Search concept index by constraints
 * Returns union of product IDs matching any concept
 */
export function searchConceptIndex(
  index: ConceptIndex,
  constraints: {
    concerns?: string[];
    skinTypes?: string[];
    applicationAreas?: string[];
    ingredients?: string[];
    madeWithout?: string[];
    productTypes?: string[];
  }
): string[];
```

**Initialization**:
- Load on server startup or lazy-load on first query
- Cache in memory with periodic refresh (e.g., every 5 minutes)

**Alternative**: Store in PostgreSQL with JSONB indexes or separate junction tables

**Files to Create/Modify**:
- `src/lib/search/concept/index.ts` (NEW)
- `src/lib/config.ts` (MODIFY: add concept index cache)

**1.2.4 Behavior Signals** - **EXISTS (Partially)**

**Current**: 
- `Product.shopifyBestseller`, `Product.shopifyTrending`, `Product.shopifySalesRank`
- `AnalyticsEvent` model for clicks/views (but not aggregated)

**Enhancement Needed**:
- Aggregate popularity scores from `AnalyticsEvent`
- Store in `Product.attributes.popularityScore` or separate column

**Files to Modify**:
- `src/lib/telemetry/metrics.ts` (MODIFY: add popularity aggregation)
- Background job to update popularity scores

---

### Phase 2: Query Classification & Slot Extraction

#### 2.1 Safety & Domain Gate (Rules)

**New Module**: `src/lib/loccitane/safety.ts`

**Function**:
```typescript
export type SafetyCheckResult = 
  | { safe: true }
  | { safe: false; reason: 'unsafe' | 'non_shopping' };

export function checkQuerySafety(message: string): SafetyCheckResult;
```

**Rules**:
- Unsafe: self-harm, medical advice, explicit content, hate
- Non-shopping: "write me a poem", general questions
- Return early with appropriate response

**Files to Create**:
- `src/lib/loccitane/safety.ts` (NEW)

---

#### 2.2 Query Classifier (Small LLM)

**Replace**: Current combined intent + reply LLM call

**New Module**: `src/lib/loccitane/classifier.ts`

**Function**:
```typescript
export type QueryClassification = {
  type: 'direct_product_search' | 'symptom_concern' | 'ingredient_exploration' | 'gift_or_vague' | 'unrelated';
  constraints: {
    concerns?: string[];
    skinTypes?: string[];
    hairTypes?: string[];
    applicationAreas?: string[];
    productTypes?: string[];
    collections?: string[];
    priceMinCents?: number;
    priceMaxCents?: number;
    mustHaveIngredients?: string[];
    avoidIngredients?: string[];
    madeWithout?: string[];
    ageGroups?: string[];
    genders?: string[];
  };
};

export async function classifyQuery(
  message: string,
  history?: ChatTurn[]
): Promise<QueryClassification>;
```

**LLM Call**:
- **Model**: `gpt-4.1-mini` (lightweight, fast)
- **Purpose**: `'intent'`
- **Schema**: Tight JSON schema (query type + constraints only)
- **Temperature**: 0.0 (deterministic)

**Prompt**: `src/lib/loccitane/prompts.ts` → `LOCCITANE_QUERY_CLASSIFIER_PROMPT`

**Examples**:
- "Immortelle Reset serum for my mom under $30" → `direct_product_search` + constraints
- "I have dandruff and sensitive scalp" → `symptom_concern` + `concerns:["dry_scalp"]`, `skinTypes:["sensitive"]`
- "shea butter" → `ingredient_exploration` + `mustHaveIngredients:["shea_butter"]`

**Files to Create/Modify**:
- `src/lib/loccitane/classifier.ts` (NEW)
- `src/lib/loccitane/prompts.ts` (MODIFY: add classifier prompt + schema)

---

### Phase 3: Multi-View Retrieval

#### 3.1 Parallel Multi-View Search

**Module**: `src/lib/loccitane/retrieval.ts` ✅ **IMPLEMENTED**

**Function**:
```typescript
export async function multiViewRetrieval(
  query: string,
  classification: QueryClassification,
  merchantId?: string
): Promise<{
  candidateIds: string[];
  lexicalScores: Map<string, number>;
  semanticScores: Map<string, number>;
  conceptMatches: Map<string, Set<string>>; // concept → matched product IDs
}>;
```

**Process** (parallel execution):
```typescript
const [lexicalResult, semanticResult, conceptResult] = await Promise.all([
  // A. Lexical/BM25
  searchProducts({
    query: classification.constraints.productTypes?.[0] || query,
    // ... other constraints
    limit: 150,
  }),
  
  // B. Vector search
  searchVectorIndex(await embedText(query), 150),
  
  // C. Concept index
  searchConceptIndex(conceptIndex, classification.constraints),
]);

// Merge candidate IDs
const candidateIds = uniq([
  ...lexicalResult.products.map(p => p.id),
  ...semanticResult.map(r => r.productId),
  ...conceptResult,
]).slice(0, 400);
```

**Files to Create/Modify**:
- `src/lib/loccitane/retrieval.ts` (NEW)
- Uses: `src/lib/search/index.ts` (existing), `src/lib/search/vector/index.ts` (new), `src/lib/search/concept/index.ts` (new)

---

#### 3.2 ML Re-ranking

**Module**: `src/lib/loccitane/ranking/features.ts` and `src/lib/loccitane/ranking/ranker.ts` ✅ **IMPLEMENTED**

**Feature Engineering**:
```typescript
export type RankingFeatures = {
  // Query-product match
  lexicalScore: number;
  semanticSimilarity: number;
  exactTitleMatch: boolean;
  titleTokenOverlap: number; // Jaccard
  highlightsTokenOverlap: number;
  
  // Attribute matches
  concernsOverlap: number; // |constraints.concerns ∩ product.concerns|
  skinTypeMatch: number;
  applicationAreaMatch: number;
  productTypeMatch: number;
  ingredientMatchCount: number;
  madeWithoutMatchCount: number;
  
  // Price & merch
  priceDistance: number; // Distance from budget range
  popularityScore: number;
  isBestseller: boolean;
  inventoryStatus: number; // in_stock = 1.0, low_stock = 0.5, out_of_stock = 0.0
};

export function buildFeatures(
  query: string,
  classification: QueryClassification,
  product: ProductWithLoccitaneAttributes, // Requires structured attributes
  scores: { lexical: number; semantic: number }
): RankingFeatures;
```

**Ranker** (Phase 1: Rule-based, Phase 2: ML model):
```typescript
// Phase 1: Simple rule-based scorer
export function scoreProduct(features: RankingFeatures): number;

// Phase 2: ML model (XGBoost/LightGBM via ONNX)
// export function scoreProductML(features: RankingFeatures, model: Model): number;
```

**Files to Create**:
- `src/lib/loccitane/ranking/features.ts` (NEW)
- `src/lib/loccitane/ranking/ranker.ts` (NEW)

---

### Phase 4: LLM Reply Generation (RAG)

#### 4.1 Single LLM Call for Reply

**Replace**: Current `generateReplyWithIntent()` (which combines intent + reply)

**New Module**: `src/lib/loccitane/reply.ts`

**Function**:
```typescript
export async function generateReplyWithRag(
  query: string,
  classification: QueryClassification,
  topProducts: ProductWithLoccitaneAttributes[], // Top 10-20 after ranking
  merchantId?: string
): Promise<LocciReplyResult>;
```

**LLM Call**:
- **Model**: `gpt-4.1-mini` (lightweight)
- **Purpose**: `'final_reply'`
- **Temperature**: 0.7

**Prompt**: `LOCCITANE_RAG_REPLY_PROMPT`

**Input** (RAG context):
```json
{
  "query": "I have dandruff and sensitive scalp",
  "queryType": "symptom_concern",
  "constraints": { ... },
  "products": [
    {
      "title": "...",
      "category": "Hair Care",
      "subcategory": "Shampoo",
      "collection": "Aromachologie",
      "concerns": ["Dry Scalp", "Scalp Discomfort"],
      "skinTypes": ["Sensitive"],
      "applicationAreas": ["Scalp"],
      "featuredIngredients": ["Essential Oils", "Panthenol"],
      "madeWithout": ["Sulfate Free"],
      "priceCents": 2100,
      "whyHighScore": [
        "matches concerns dry scalp / scalp discomfort",
        "suited for sensitive skin",
        "sulfate-free formula"
      ]
    },
    ...
  ]
}
```

**Output**:
- Friendly explanation of why these products match
- 1-2 follow-up questions if needed

**Files to Create/Modify**:
- `src/lib/loccitane/reply.ts` (NEW)
- `src/lib/loccitane/prompts.ts` (MODIFY: add RAG reply prompt)

---

### Phase 5: Updated Orchestrator

#### 5.1 Modified `handleLoccitaneQuery()`

**File**: `src/lib/loccitane/orchestrator.ts`

**New Flow**:
```typescript
export async function handleLoccitaneQuery(
  input: LoccitaneQueryInput,
): Promise<LoccitaneQueryResult> {
  // Step 1: Safety check
  const safety = checkQuerySafety(input.message);
  if (!safety.safe) {
    return safeResponse(safety.reason);
  }
  
  // Step 2: Query classification (small LLM)
  const classification = await classifyQuery(input.message, input.history);
  
  if (classification.type === 'unrelated') {
    return genericAssistantResponse(input.message);
  }
  
  // Step 3: Multi-view retrieval (parallel)
  const retrievalResult = await multiViewRetrieval(
    input.message,
    classification,
    input.merchantId
  );
  
  // Load candidate products
  const candidates = await loadProducts(retrievalResult.candidateIds);
  
  // Step 4: ML re-ranking
  const scored = candidates.map(product => ({
    product,
    score: scoreProduct(
      buildFeatures(input.message, classification, product, {
        lexical: retrievalResult.lexicalScores.get(product.id) ?? 0,
        semantic: retrievalResult.semanticScores.get(product.id) ?? 0,
      })
    ),
  }));
  
  const ranked = scored.sort((a, b) => b.score - a.score);
  const topProducts = ranked.slice(0, 20).map(r => r.product);
  
  // Step 5: LLM reply with RAG (single call)
  const replyResult = await generateReplyWithRag(
    input.message,
    classification,
    topProducts
  );
  
  // Step 6: Template-based card reasons (existing)
  const productCards = topProducts.slice(0, 8).map(product => ({
    ...buildProductCard(product),
    reason: buildProductReason(product, input.message, classification),
  }));
  
  return {
    replyText: replyResult.replyText,
    productCards,
    noExactMatch: topProducts.length === 0,
    followupText: replyResult.followupText,
  };
}
```

**Key Changes**:
- Replace single combined LLM call with separate classifier + RAG reply calls
- Replace single lexical search with multi-view retrieval
- Add re-ranking step

**Files to Modify**:
- `src/lib/loccitane/orchestrator.ts` (MODIFY: major refactor)

---

## File Structure Summary

### New Files to Create

```
src/lib/loccitane/
  ├── attributeParser.ts          # Parse velou_attribute entries → structured
  ├── safety.ts                   # Safety/domain gate (rules)
  ├── classifier.ts               # Query classification (small LLM)
  ├── retrieval.ts                # Multi-view retrieval orchestration
  ├── reply.ts                    # RAG-based reply generation
  └── ranking/
      ├── features.ts             # Feature engineering
      └── ranker.ts               # ML re-ranker (rule-based → ML)

src/lib/search/
  ├── vector/
  │   └── index.ts                # Vector search (pgvector)
  └── concept/
      └── index.ts                # Concept inverted index

prisma/migrations/
  └── XXXX_add_product_embeddings/
      └── migration.sql           # Add embedding column + index
```

### Existing Files to Modify

```
src/lib/loccitane/
  ├── orchestrator.ts             # MAJOR: Replace flow with multi-view retrieval
  ├── prompts.ts                  # ADD: Classifier prompt, RAG reply prompt
  ├── reasons.ts                  # MINOR: Enhance to use structured attributes
  └── intent.ts                   # DEPRECATE or keep for fallback

src/lib/catalog/
  └── ingestUnifiedCsv.ts         # MODIFY: Parse attributes during ingestion

src/lib/search/
  ├── index.ts                    # MINOR: Enhance extractSearchableTextFromAttributes()
  └── types.ts                    # MODIFY: Extend ProductAttributes type

prisma/
  └── schema.prisma               # MODIFY: Add embedding field to Product
```

### Implementation Status (✅ = Complete)

**Phase 1: Attribute Parsing & Indexing**
- ✅ `src/lib/loccitane/attributeParser.ts` - Parses `product_details` → `StructuredLoccitaneAttributes`
- ✅ `src/lib/search/concept/index.ts` - In-memory concept index
- ✅ `src/lib/search/concept/cache.ts` - Concept index caching
- ✅ `src/lib/search/vector/index.ts` - Vector search with pgvector
- ✅ `src/lib/search/vector/backfill.ts` - Embedding backfill utility
- ✅ `prisma/schema.prisma` - Added `embedding` column to Product
- ✅ `prisma/migrations/..._add_product_embeddings/` - Migration for vector column

**Phase 2: Safety & Classification**
- ✅ `src/lib/loccitane/safety.ts` - Rule-based safety gate
- ✅ `src/lib/loccitane/classifier.ts` - LLM-based query classifier
- ✅ `src/lib/loccitane/prompts.ts` - Classifier prompt + schema

**Phase 3: Multi-View Retrieval**
- ✅ `src/lib/loccitane/retrieval.ts` - Parallel multi-view retrieval orchestration
- ✅ `src/lib/loccitane/ranking/features.ts` - Feature engineering
- ✅ `src/lib/loccitane/ranking/ranker.ts` - Heuristic-based ranking

**Phase 4: RAG Reply**
- ✅ `src/lib/loccitane/reply.ts` - RAG-based reply generation
- ✅ `src/lib/loccitane/prompts.ts` - RAG reply prompt + schema

**Phase 5: Orchestration**
- ✅ `src/lib/loccitane/orchestrator.ts` - Complete pipeline integration

**Tests**
- ✅ `tests/loccitane/attributeParser.test.ts`
- ✅ `tests/loccitane/safety.test.ts`
- ✅ `tests/loccitane/classifier.test.ts`
- ✅ `tests/loccitane/retrieval.test.ts`
- ✅ `tests/loccitane/ranking/features.test.ts`
- ✅ `tests/loccitane/ranking/ranker.test.ts`
- ✅ `tests/loccitane/reply.test.ts`
- ✅ `tests/loccitane/orchestrator.test.ts`
- ✅ `tests/loccitane/orchestrator.integration.test.ts`

**Configuration**
- ✅ `src/lib/config.ts` - Added `embeddingModel` and `useLoccitaneOptimizedPipeline`

### Files to Keep Intact (Original Pipeline)

```
src/lib/llm/orchestrator/         # UNTOUCHED: Original pipeline
src/lib/llm/orchestrator/flows/   # UNTOUCHED: Original flows
src/lib/search/                   # MOSTLY UNTOUCHED: Original search (lexical only)
src/app/api/assistant/route.ts    # MINOR: Keep routing logic as-is (gating unchanged)
```

---

## Routing Logic Preservation

**Current Routing** (in `src/app/api/assistant/route.ts`):
```typescript
if (env.useLoccitaneOptimizedPipeline && !body.productContextId && body.pageType !== 'PDP') {
  // Route to L'Occitane optimized pipeline
  const result = await handleLoccitaneQuery({ ... });
} else {
  // Route to original pipeline
  const result = await handleAssistantQuery({ ... });
}
```

**Action**: **Keep as-is**. The modified `handleLoccitaneQuery()` will maintain the same signature and return type.

---

## Migration Strategy

### Phase 1: Attribute Parsing (No Behavior Change)
- Parse attributes during ingestion
- Store structured attributes in `Product.attributes`
- Build concept index (can run in background)
- **No impact on query flow yet**

### Phase 2: Vector Search Infrastructure
- Add `embedding` column to Product
- Generate embeddings for all products (background job)
- Create vector index
- Add vector search module
- **Not yet used in query flow**

### Phase 3: Query Classifier
- Add classifier module
- Test classification accuracy
- **Can run in parallel with existing flow for validation**

### Phase 4: Multi-View Retrieval
- Implement retrieval orchestration
- Test retrieval quality vs. current
- **Can A/B test against current flow**

### Phase 5: Re-ranking
- Implement feature engineering
- Start with rule-based scorer
- **Can compare ranking quality**

### Phase 6: RAG Reply
- Replace combined LLM call with separate classifier + RAG calls
- **Final integration step**

### Phase 7: Full Cutover
- Enable multi-view retrieval in production
- Monitor performance (<5s target)
- Monitor quality metrics

---

## Performance Targets

| Component | Target Latency | Notes |
|-----------|---------------|-------|
| Safety check | <10ms | Rule-based, instant |
| Query classification | 200-400ms | Small LLM (`gpt-4.1-mini`) |
| Multi-view retrieval (parallel) | 200-500ms | Max(lexical, vector, concept) |
| Re-ranking (400 candidates) | 50-100ms | Feature building + scoring |
| LLM RAG reply | 600-1000ms | Lightweight model |
| Card reasons | <50ms | Template-based |
| **Total** | **1.1-2.0s typical** | **<5s hard bound** |

---

## Integration Points with Existing Code

### 1. Search Module (`src/lib/search/index.ts`)

**Current**: `searchProducts()` - lexical search only

**Integration**:
- Keep `searchProducts()` for lexical retrieval (one of three views)
- Add new `multiViewRetrieval()` in `src/lib/loccitane/retrieval.ts` that calls:
  - `searchProducts()` (lexical)
  - `searchVectorIndex()` (semantic)  
  - `searchConceptIndex()` (concept)

**No breaking changes** to existing search module.

---

### 2. LLM Provider (`src/lib/llm/provider.ts`)

**Current**: Single provider abstraction

**Integration**:
- Use `callLLM()` for:
  - Query classification (new)
  - RAG reply generation (new)
- Same provider, same error handling, same rate limiting

**No changes needed** to provider abstraction.

---

### 3. Product Attributes (`ProductAttributes` type)

**Current**: Flexible JSON structure

**Integration**:
- Extend `ProductAttributes` to include:
  ```typescript
  loccitaneStructured?: StructuredLoccitaneAttributes;
  ```
- Or store parsed attributes alongside existing fields
- Backward compatible: existing attributes still work

**Files**:
- `src/lib/search/types.ts` - extend type
- `src/lib/catalog/ingestUnifiedCsv.ts` - populate during ingestion

---

### 4. API Routes (`src/app/api/assistant/route.ts`)

**Current**: Routes to `handleLoccitaneQuery()` when flag enabled

**Integration**:
- **No changes** to routing logic
- `handleLoccitaneQuery()` signature stays the same
- Return type (`LoccitaneQueryResult`) stays the same
- Internal implementation changes only

---

## Testing Strategy

### Unit Tests
- Attribute parser: Parse various `velou_attribute` formats
- Concept index: Build index, search by concept
- Vector search: Embedding generation, similarity search
- Feature engineering: Build features from products
- Ranker: Score products with rule-based ranker

### Integration Tests
- Multi-view retrieval: End-to-end retrieval with all three views
- Query classifier: Classification accuracy on sample queries
- RAG reply: Generate replies with product context

### Performance Tests
- Measure latency of each component
- Ensure <5s total time even with slow LLM
- Test with 1000+ concurrent queries

### A/B Testing
- Compare new pipeline vs. current pipeline
- Metrics: latency, accuracy, click-through rate
- Gradual rollout (10% → 50% → 100%)

---

## Rollback Plan

**If issues arise**:
1. **Immediate**: Disable via `USE_LOCCITANE_OPTIMIZED_PIPELINE=false`
   - Falls back to original pipeline (unchanged)
2. **Partial rollback**: Keep attribute parsing, disable multi-view retrieval
   - Use single lexical search with enhanced attributes
3. **Feature flags**: Add granular flags:
   - `USE_MULTIVIEW_RETRIEVAL=true`
   - `USE_VECTOR_SEARCH=true`
   - `USE_CONCEPT_INDEX=true`

---

## Open Questions / Decisions Needed

1. **Embedding Model**:
   - Use OpenAI embeddings (API calls, cost) or local model (ONNX)?
   - **Recommendation**: Start with OpenAI for accuracy, migrate to local later

2. **Concept Index Storage**:
   - In-memory (fast, but memory usage) or PostgreSQL (slower, but scalable)?
   - **Recommendation**: In-memory for <50k products, PostgreSQL for larger

3. **Re-ranker Model**:
   - Rule-based initially or ML model from day 1?
   - **Recommendation**: Rule-based Phase 1, train ML model Phase 2

4. **Attribute Parsing Timing**:
   - During ingestion (slower ingestion) or background job (faster ingestion)?
   - **Recommendation**: Background job for existing catalog, during ingestion for new products

5. **Vector Index Refresh**:
   - When products updated, regenerate embeddings?
   - **Recommendation**: Background job with queue

---

## Success Metrics

**Performance**:
- ✅ <5s response time (hard bound)
- ✅ <2s typical response time
- ✅ <10% p95 latency increase vs. current

**Quality**:
- ✅ Higher recall (more relevant products found)
- ✅ Better ranking (top products more relevant)
- ✅ Improved click-through rate
- ✅ Better match for concern-based queries ("I have dandruff")

**Cost**:
- ✅ LLM cost per query similar or lower (2 small calls vs. 1 combined call)
- ✅ Infrastructure cost acceptable (pgvector, embedding storage)

---

## Next Steps

1. **Review this design doc** with team
2. **Create Phase 1 tickets** (attribute parsing)
3. **Set up development branch** (`feature/loccitane-multiview-retrieval`)
4. **Start with attribute parser** (lowest risk, immediate value)
5. **Iterate on each phase** with testing and validation

---

## References

- Current pipeline documentation: `PIPELINE_COMPLETE_DOCUMENTATION.md`
- L'Occitane optimization: `LOCCITANE_OPTIMIZATION_README.md`
- Search module structure: `src/lib/search/REFACTORING_COMPLETE.md`
- Catalog ingestion: `src/lib/catalog/ingestUnifiedCsv.ts`
