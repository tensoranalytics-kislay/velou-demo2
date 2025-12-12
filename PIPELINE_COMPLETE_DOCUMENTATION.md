# Complete Pipeline Documentation

This document describes the complete flow from user query input to final response, including all LLM queries, discovery logic, and card creation.

## Quick Comparison: Optimized vs Original Pipeline

| Feature | Optimized Pipeline | Original Pipeline |
|---------|-------------------|-------------------|
| **LLM Calls** | 1 | 4-5 |
| **Latency** | 1.5-3 seconds | 2.7-4.9 seconds |
| **Execution** | Parallel | Sequential |
| **Intent Extraction** | Rule-based (0ms) | LLM-based (600-1200ms) |
| **Card Reasons** | Template-based (50ms) | LLM batch (800-1500ms) |
| **Follow-up Detection** | Rule-based | LLM-based |
| **Use Case** | Single merchant (L'Occitane) | Multi-tenant, generic catalogs |
| **Configuration** | `USE_LOCCITANE_OPTIMIZED_PIPELINE=true` | Default (when flag disabled) |

**Optimized Pipeline is used when**:
- Feature flag enabled: `USE_LOCCITANE_OPTIMIZED_PIPELINE=true`
- Non-PDP pages (`pageType !== 'PDP'`)
- No product context (`productContextId` undefined)

**Original Pipeline is used for**:
- PDP pages
- Product Q&A queries
- When feature flag is disabled
- Multi-tenant or generic catalogs

## Table of Contents

1. [Quick Comparison: Optimized vs Original Pipeline](#quick-comparison-optimized-vs-original-pipeline)
2. [High-Level Overview](#high-level-overview)
3. [Entry Point: API Routes](#entry-point-api-routes)
4. [Optimized Pipeline Stages](#optimized-pipeline-stages)
   - [Stage 1: Rule-Based Intent Extraction](#stage-1-rule-based-intent-extraction-0ms)
   - [Stage 2: Parallel Execution](#stage-2-parallel-execution)
   - [Stage 3: Merge Results](#stage-3-merge-results)
   - [Stage 4: Product Card Creation](#stage-4-product-card-creation-template-based)
   - [Stage 5: Follow-up Text Generation](#stage-5-follow-up-text-generation-rule-based)
   - [Stage 6: Return Response](#stage-6-return-response)
5. [Pipeline Stages (Original Pipeline)](#pipeline-stages-original-pipeline)
   - [Stage 1: Context Loading & Pending Suggestions](#stage-1-context-loading--pending-suggestions)
   - [Stage 2: Intent & Constraints Extraction](#stage-2-intent--constraints-extraction)
   - [Stage 3: Discovery Flow](#stage-3-discovery-flow)
   - [Stage 4: Product Search](#stage-4-product-search)
   - [Stage 5: Product Evaluation & Card Creation](#stage-5-product-evaluation--card-creation)
   - [Stage 6: Response Generation](#stage-6-response-generation)
   - [Stage 7: Metrics & Return](#stage-7-metrics--return)

---

## High-Level Overview

The system supports **two pipelines** based on configuration and query type:

### Pipeline Selection Logic

```
User Query → POST /api/assistant
    ↓
Check: USE_LOCCITANE_OPTIMIZED_PIPELINE && !productContextId && pageType !== 'PDP'
    ↓
    ├─ YES → L'Occitane Optimized Pipeline (1 LLM call, 1.5-3s)
    └─ NO  → Original Pipeline (4-5 LLM calls, 2.7-4.9s)
```

### Optimized Pipeline Flow (L'Occitane)

**Performance**: 1.5-3 seconds | **LLM Calls**: 1 | **Execution**: Parallel

```
User Query
    ↓
POST /api/assistant
    ↓
Rate Limiting Check
    ↓
[PARALLEL EXECUTION]
    ├─→ Rule-Based Intent Extraction (0ms)
    │   ├─ Fast keyword matching
    │   ├─ Follow-up detection
    │   └─ Extract: productType, collection, concern, price
    │       ↓
    └─→ Search Products (200-500ms)
    │   ├─ DB Ranked Search
    │   ├─ Attribute Filtering
    │   └─ Constraint Relaxation (if needed)
    │       ↓
    └─→ Single LLM Call (800-1500ms)
        ├─ Combines: Intent + Reply Generation
        └─ Output: replyOpener, refined searchQuery
            ↓
    Merge Results
        ↓
    Template-Based Product Reasons (50ms)
        ↓
    Rule-Based Follow-up Text (50ms)
        ↓
Return Response (replyText + productCards[])
        ↓
Record ConversationEvent (Metrics)
```

### Original Pipeline Flow (Generic)

**Performance**: 2.7-4.9 seconds | **LLM Calls**: 4-5 | **Execution**: Sequential

```
User Query
    ↓
POST /api/assistant
    ↓
Rate Limiting Check
    ↓
handleAssistantQuery() [Orchestrator]
    ↓
[Context Gatekeeper LLM Query] ← Determines follow-up vs new search
    ↓
[Intent & Constraints LLM Query] ← Extracts search parameters
    ↓
runDiscoveryFlow()
    ↓
[Category Validation] → If invalid: [Out-of-Scope LLM Reply]
    ↓
searchProductsRelaxed()
    ├─ searchProducts() [Strict]
    │   ├─ DB Ranked Search
    │   ├─ Attribute Filtering
    │   └─ Constraint Relaxation (if needed)
    └─ Relaxation Steps (if no results)
    ↓
[Rescue Plan LLM Query] ← If still no results
    ↓
Product Evaluation & Scoring
    ↓
[Card Reasons LLM Query] ← Batched for all products
    ↓
[Discovery Reply Enhancement LLM Query] ← Optional
    ↓
[Follow-up Text LLM Query] ← Optional
    ↓
Return Response (replyText + productCards[])
    ↓
Record ConversationEvent (Metrics)
```

---

## Entry Point: API Routes

### POST /api/assistant

**File**: `src/app/api/assistant/route.ts`

**Endpoints**:
- `POST /api/assistant` - Standard JSON response
- `POST /api/assistant/stream` - Server-Sent Events (SSE) streaming with progress updates

**Request Body**:
```typescript
{
  sessionId: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pendingSuggestion?: {
    constraints: SearchConstraints;
    candidateIds: string[];
  };
  conversationContext?: ConversationContext;
}
```

**Process**:
1. Rate limiting check (`rateLimitLlm`)
2. **Pipeline Selection**:
   ```typescript
   if (env.useLoccitaneOptimizedPipeline && !body.productContextId && body.pageType !== 'PDP') {
     // Route to Optimized Pipeline
     const result = await handleLoccitaneQuery({ ... });
   } else {
     // Route to Original Pipeline
     const result = await handleAssistantQuery({ ... });
   }
   ```
3. Load conversation context from DB (for follow-up detection)
4. Execute selected pipeline
   - **Stream endpoint** (`/api/assistant/stream`): Sends progress updates via SSE (`understanding`, `searching`, `evaluating`, `generating`, `complete`)
   - **Standard endpoint** (`/api/assistant`): Returns final result after completion
5. Record `ConversationEvent` for metrics
6. Return response:
   - **Stream endpoint**: SSE stream with progress events and final result
   - **Standard endpoint**: JSON response

**Pipeline Selection Rules**:
- **Optimized Pipeline** used when:
  - `USE_LOCCITANE_OPTIMIZED_PIPELINE=true` (env var)
  - `pageType !== 'PDP'` (not product detail page)
  - `productContextId` is undefined (not product Q&A)
- **Original Pipeline** used when:
  - Feature flag is disabled, OR
  - PDP page queries, OR
  - Product Q&A queries (`productContextId` provided)

**Response**:
```typescript
{
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  intent?: AssistantIntent;
  resolvedConstraints?: SearchConstraints;
  usedFollowUpContext?: boolean;
  followupText?: string;
}
```

---

## Pipeline Stages

> **Note**: The following sections describe the **Original Pipeline** stages. For the **Optimized Pipeline**, see [Optimized Pipeline Stages](#optimized-pipeline-stages) below.

---

## Optimized Pipeline Stages

**File**: `src/lib/loccitane/orchestrator.ts` - `handleLoccitaneQuery()`

**Available in**: Both `/api/assistant` and `/api/assistant/stream` endpoints

The optimized pipeline reduces LLM calls from 4-5 to 1 by:
- Using rule-based intent extraction (no LLM)
- Combining intent + reply in a single LLM call
- Using template-based product reasons (no LLM per product)
- Running search and LLM in parallel

**Note**: The stream endpoint (`/api/assistant/stream`) provides progress updates for the optimized pipeline, but due to parallel execution and fast rule-based processing, progress stages may complete quickly.

### Stage 1: Rule-Based Intent Extraction (0ms)

**File**: `src/lib/loccitane/intent.ts` - `extractLoccitaneIntent()`

**Process**:
1. **Follow-up Detection** (rule-based):
   ```typescript
   detectFollowUp(message, lastConstraints)
   ```
   - Short messages (< 3 words) → follow-up
   - Refinement keywords: "make it", "also", "with", "more", "less", "only", "cheaper", "under"
   - Color/size/material refinements → follow-up
   - Category switching keywords ("instead", "switch", "change to") → NOT follow-up

2. **Extract Product Type**:
   - Matches against `LOCCITANE_ONTOLOGY.productTypes` (pre-computed)
   - Examples: "Hand Cream", "Body Lotion", "Face Serum", "Gift Set"

3. **Extract Collection**:
   - Matches against `LOCCITANE_ONTOLOGY.collections`
   - Examples: "Shea", "Almond", "Immortelle Divine", "Verbena"

4. **Extract Concern**:
   - Matches against `LOCCITANE_ONTOLOGY.concerns`
   - Examples: "dryness", "aging", "dullness", "sensitive skin"

5. **Extract Price**:
   - Rule-based price extraction using regex
   - Parses "under $50", "$50", "under 50 dollars"

6. **Build SearchConstraints**:
   ```typescript
   {
     category: productType, // e.g., "Hand Cream"
     query: message,
     priceMaxCents: priceMax * 100,
     inStockOnly: true,
   }
   ```

7. **Merge with Previous Constraints** (if follow-up):
   ```typescript
   mergeLoccitaneConstraints(lastConstraints, newConstraints, message)
   ```

### Stage 2: Parallel Execution

**Search + LLM run simultaneously** to minimize latency:

#### 2.1 Product Search (Parallel)

```typescript
const searchPromise = searchProducts(searchConstraints, input.message);
```

**Process**:
- Same as Stage 4 in Original Pipeline
- Uses `searchProducts()` from `src/lib/search/index.ts`
- Returns ranked products with relevance scores

#### 2.2 Single-Shot LLM Call (Parallel)

**File**: `src/lib/loccitane/orchestrator.ts` - `generateReplyWithIntent()`

**Prompt**: `LOCCITANE_SINGLE_SHOT_PROMPT`
- **Model**: Primary LLM (`gpt-4.1` by default)
- **Purpose**: `'final_reply'`
- **Schema**: `LOCCITANE_SINGLE_SHOT_SCHEMA`
- **Temperature**: 0.7

**Input**:
```typescript
{
  role: 'system',
  content: LOCCITANE_SINGLE_SHOT_PROMPT // Includes ontology: productTypes, collections, concerns, ingredients
},
{
  role: 'user',
  content: `User query: "${message}"\n\nExtract intent and generate a friendly reply.`
}
```

**Output**:
```typescript
{
  searchQuery: string; // Optimized search query
  productType: string | null; // Refined product type
  collection: string | null; // Detected collection
  concern: string | null; // Detected concern
  priceMax: number | null; // Extracted budget
  replyOpener: string; // Friendly 1-2 sentence introduction (< 40 words)
  isGiftSet: boolean; // Whether user wants gift sets
}
```

**Combines**:
- Intent extraction (product type, collection, concern, price)
- Reply generation (friendly opener)
- In a single LLM call (replaces 2-3 separate calls in original pipeline)

### Stage 3: Merge Results

```typescript
const [searchResult, llmResult] = await Promise.all([searchPromise, llmPromise]);
```

Both operations complete simultaneously, total time = `max(searchTime, llmTime)` instead of `searchTime + llmTime`.

### Stage 4: Product Card Creation (Template-Based)

**File**: `src/lib/loccitane/reasons.ts` - `buildProductReason()`

**Process** (NO LLM calls):

1. **Extract Key Attributes**:
   ```typescript
   const benefits = attributes.Benefits || attributes.benefits || [];
   const ingredients = attributes.FeaturedIngredients || attributes.featuredIngredients || [];
   const keyAttributes = [...benefits.slice(0, 3), ...ingredients.slice(0, 2)].slice(0, 5);
   ```

2. **Generate Reason** (template-based):
   - **Template 1**: Collection match
     - `"From our ${collection} collection with ${ingredient}"`
   - **Template 2**: Concern match
     - `"${benefit} with ${ingredient}"` (e.g., "Hydrating with shea butter")
   - **Template 3**: Benefit + ingredient
     - `"${benefit} formula with ${ingredient}"`
   - **Template 4**: Collection + benefit
     - `"From our ${collection} collection, ${benefit}"`
   - **Fallback**: `"${benefit || ingredient || 'Great option'} for your needs"`

3. **Build ProductCard**:
   ```typescript
   {
     id: product.id,
     title: product.title,
     priceCents: product.priceCents,
     salePriceCents: product.salePriceCents,
     currency: product.currency,
     imageUrl: product.imageUrl,
     productUrl: product.productUrl,
     keyAttributes: keyAttributes, // Benefits + ingredients
     reason: reason, // Template-generated
     queryChips: [],
     stockStatus: product.stockStatus,
   }
   ```

### Stage 5: Follow-up Text Generation (Rule-Based)

**File**: `src/lib/loccitane/orchestrator.ts` - `generateFollowupText()`

**Process** (NO LLM call):
- Rule-based text generation
- If 4+ products: `"I found ${count} great options. ${concern/collection context}. Would you like to see options for a specific concern or collection?"`
- If < 4 products: `"Here are the best matches I found. Would you like to refine your search or see different products?"`

### Stage 6: Return Response

```typescript
return {
  replyText: llmResult.replyOpener, // From single-shot LLM
  productCards: productCards, // Template-based reasons
  noExactMatch: searchResult.wasRelaxed || searchResult.products.length === 0,
  followupText: followupText, // Rule-based
};
```

**Performance**:
- **Total LLM Calls**: 1 (vs 4-5 in original)
- **Total Latency**: 1.5-3 seconds (vs 2.7-4.9 seconds)
- **Parallel Execution**: Reduces wait time by ~50%

---

## Pipeline Stages (Original Pipeline)

### Stage 1: Context Loading & Pending Suggestions

**File**: `src/lib/llm/orchestrator/index.ts` - `handleAssistantQuery()`

#### 1.1 Database Context Fallback

If `conversationContext` is missing, load last query from `ConversationEvent`:
```typescript
const lastEvent = await prisma.conversationEvent.findFirst({
  where: { sessionId: input.sessionId },
  orderBy: { createdAt: 'desc' },
  select: { userQuery: true, createdAt: true },
});
```

#### 1.2 Pending Suggestion Handling

If `pendingSuggestion` exists:

1. **VelouRouter LLM Query** - Decides how to handle pending suggestions
   - **Prompt**: `VELOU_ROUTER_PROMPT`
   - **Schema**: `VELOU_ROUTER_JSON_SCHEMA`
   - **Purpose**: `'intent'`
   - **Output**:
     ```typescript
     {
       action: 'confirm_pending_suggestion' | 'override_search' | 'refine_search' | 'non_product_chat';
       new_category?: string;
       keep_previous_constraints?: boolean;
       refinements: Partial<SearchConstraints>;
       reason: string;
     }
     ```

2. **Follow-up Detection** - Detects if user confirms suggestion
   ```typescript
   detectFollowUpType(message, previousConstraints, hasPendingSuggestion, ontology)
   ```

3. **Routes**:
   - If `action === 'confirm_pending_suggestion'` and `followUpType === 'CONFIRM_SUGGESTION'`:
     → `runPendingSuggestionFlow()` (shows confirmed products)
   - If `action === 'override_search'` or `'refine_search'`:
     → Merge router constraints and continue to intent extraction
   - If `action === 'non_product_chat'`:
     → `buildNonProductChatReply()` (dataset-aware LLM reply)

---

### Stage 2: Intent & Constraints Extraction

**File**: `src/lib/llm/orchestrator/intent.ts` - `inferIntentAndConstraints()`

#### 2.1 Context Gatekeeper LLM Query

**Purpose**: Determines if query is a follow-up or new search

**File**: `src/lib/llm/prompts.ts` - `CONTEXT_GATEKEEPER_PROMPT_V2`

**Input**:
```typescript
{
  currentMessage: string;
  previousUserMessages: string[];
  previousConstraints: SearchConstraints | null;
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  pendingSuggestion?: { summary: string } | null;
}
```

**LLM Call**:
- **Model**: Primary LLM (`gpt-4.1` by default)
- **Purpose**: `'intent'`
- **Schema**: `CONTEXT_GATEKEEPER_V2_JSON_SCHEMA`
- **Temperature**: 0.0 (deterministic)

**Output**:
```typescript
{
  threadType: 'follow_up' | 'new_search' | 'confirm_to_show';
  shouldUsePreviousContext: boolean;
  usedFollowUpContext: boolean;
  reasonBrief: string;
}
```

**Logic**:
- **Follow-up**: Short refinements, comparative tweaks, affirmatives
- **New search**: Category switches, reset language, topic jumps
- **Confirm to show**: Affirmative responses to pending suggestions

#### 2.2 Intent & Constraints LLM Query

**Purpose**: Extracts intent, constraints, and expanded keywords from user message

**File**: `src/lib/llm/prompts.ts` - `INTENT_AND_CONSTRAINTS_PROMPT_V2`

**Input**:
```typescript
{
  message: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  previousConstraints?: SearchConstraints | null;
  isFollowUp?: boolean;
  ontology: CatalogOntology;
  standaloneQuery?: string;
  constraintsDelta?: Partial<SearchConstraints>;
  datasetContext?: DatasetContext | null;
}
```

**LLM Call**:
- **Model**: Primary LLM (`gpt-4.1` by default)
- **Purpose**: `'intent'`
- **Schema**: `INTENT_AND_CONSTRAINTS_V2_JSON_SCHEMA`
- **Temperature**: 0.0 (deterministic)

**Prompt Includes**:
- Catalog ontology (categories, colors, materials, sizes, brands, genders, etc.)
- Dataset context hints (primary facets, vertical)
- Previous constraints (if follow-up)
- User message

**Output**:
```typescript
{
  intent: 'discovery' | 'compare' | 'qa' | 'other';
  constraints: SearchConstraints;
  expandedKeywords: string[];
  needsFollowUp?: boolean;
  missingSlots?: string[];
}
```

**SearchConstraints Fields**:
- `category` (string | string[])
- `priceMinCents`, `priceMaxCents` (number)
- `colors`, `sizes`, `materials`, `fabrics` (string[])
- `seasons`, `occasions`, `useCases`, `styleTags` (string[])
- `benefits`, `claims`, `compatibility` (string[])
- `genders`, `brands`, `ageGroups` (string[])
- `fit` (string)
- `query` (string)
- `expandedKeywords` (string[]) - Semantic synonyms for search

#### 2.3 Post-Processing

1. **Gender Detection** (Pre-LLM override):
   ```typescript
   const detectedGenderTokens = detectGenderTokens(message);
   if (detectedGenderTokens) {
     constraints.genders = detectedGenderTokens; // Overrides LLM output
   }
   ```

2. **Category Normalization**:
   ```typescript
   const normalizedCategory = normalizeCategoryFromMessage(message, category, ontology);
   ```

3. **Color/Material Mapping**:
   ```typescript
   constraints.colors = mapColorToCatalog(colors, ontology.colors);
   constraints.materials = mapMaterialToCatalog(materials);
   ```

4. **Constraint Merging** (if follow-up):
   ```typescript
   mergeConstraints(previousConstraints, newConstraints, message, contextAction);
   ```
   - Handles `carry`, `override`, `reset` actions
   - Preserves sticky keys (genders, inStockOnly)
   - Drops incompatible constraints on category switch

5. **Ontology Application**:
   ```typescript
   applyOntologyToConstraints(constraints, ontology);
   ```
   - Maps values to catalog ontology
   - Filters out non-existent brands/categories
   - Normalizes constraint arrays

---

### Stage 3: Discovery Flow

**File**: `src/lib/llm/orchestrator/flows/discovery.ts` - `runDiscoveryFlow()`

#### 3.1 Category Validation

Check if requested category exists in catalog:
```typescript
const ontology = await getCatalogOntology();
const requestedCategoryExists = categoryExistsInCatalog(constraints.category, ontology);
```

**If category doesn't exist and no catalog match**:
- **LLM Query**: Out-of-Scope Reply
  - **Prompt**: `buildOutOfScopeReplyPrompt(datasetContext)`
  - **Purpose**: `'final_reply'`
  - **Expect JSON**: false
  - Returns dataset-aware message explaining catalog limitations

#### 3.2 Hard Text Filter Extraction

Extract hard text filter keywords when category is missing:
```typescript
const hardTextFilters = !constraints.category
  ? extractHardTextFilterKeywords(userMessage, constraints.category)
  : constraints.hardTextFilters;
```

#### 3.3 Previous Products Exclusion

Exclude previously shown products for follow-up refinements:
```typescript
const excludeProductIds = shouldExcludePrevious
  ? [...constraints.excludeProductIds, ...lastShownProductIds]
  : constraints.excludeProductIds;
```

#### 3.4 Product Search

Call `searchProductsRelaxed()` (see Stage 4).

#### 3.5 No Results Handling

If `candidates.length === 0`:

1. **Rescue Plan LLM Query**:
   - **Prompt**: `CLOSEST_MATCH_RESCUE_PLAN_PROMPT`
   - **Schema**: `CLOSEST_MATCH_RESCUE_PLAN_JSON_SCHEMA`
   - **Purpose**: `'intent'`
   - **Output**:
     ```typescript
     {
       rescueSearches: Array<{
         queryText: string;
         keywords: string[];
         categoryHints: string[];
         hardConstraints: Partial<SearchConstraints>;
       }>;
       rescueSummary: string;
     }
     ```

2. **Execute Rescue Searches** (up to 3):
   ```typescript
   for (const rescueSearch of rescuePlan.rescueSearches.slice(0, 3)) {
     const rescueResult = await searchProductsRelaxed(rescueConstraints, 20, userMessage);
     closestCandidates.push(...rescueResult.candidates.slice(0, 10));
   }
   ```

3. **No Results Reply LLM Query**:
   - **Prompt**: `NO_RESULTS_REPLY_PROMPT_V2`
   - **Purpose**: `'final_reply'`
   - **Expect JSON**: false
   - **Input**: User message, constraints, top 5 closest candidates
   - Returns friendly response mentioning closest products with clarifying questions

#### 3.6 Relevance Check

Verify top products match core intent keywords:
```typescript
const coreIntentKeywords = expandedKeywords?.slice(0, 5) || queryTokens.filter(t => t.length > 3);
const relevantProducts = topProducts.filter(item => {
  const searchableText = `${item.title} ${item.description} ${item.category}`.toLowerCase();
  return coreIntentKeywords.some(keyword => searchableText.includes(keyword));
});
```

If less than 50% relevant:
- **LLM Query**: No Relevant Products Reply
  - **Function**: `buildNoRelevantProductsReply()`
  - Returns dataset-aware message with suggestions

---

### Stage 4: Product Search

**File**: `src/lib/search/index.ts` - `searchProducts()` and `searchProductsRelaxed()`

#### 4.1 Main Search Function: `searchProducts()`

**Process**:

1. **Build Filters**:
   ```typescript
   const broadFilters = await buildBroadWhereFilters(constraints, merchContext, userMessage);
   ```
   - Converts `SearchConstraints` to SQL WHERE filters
   - Applies merchandising rules (excluded categories, boosts)
   - Handles category canonicalization
   - Builds keyword filters from `expandedKeywords` and `query`

2. **Calculate Take**:
   ```typescript
   const take = calculateDynamicTake(broadFilters, limit);
   ```
   - Adjusts query limit based on filter selectivity
   - Accounts for attribute filtering overhead

3. **Database Ranked Search**:
   ```typescript
   const dbCandidates = await dbRankedSearch(
     broadFilters,
     constraints.query,
     merchContext.boostByCategory,
     take,
     keywordFilters,
     merchantId
   );
   ```
   - Full-text search on title, description, category
   - JSON attribute matching (gender, color, etc.)
   - Category boosting via merchandising rules
   - Gender filtering (mens/womens/unisex logic)
   - Returns ranked results with relevance scores

4. **Attribute Filtering**:
   ```typescript
   const filtered = dbCandidates.filter(product =>
     matchesAttributeFilters(product.attributes, constraints, categoryOr, ontology.colors, constraintMeta)
   );
   ```
   - Filters by colors, fabrics, materials, sizes, seasons, occasions
   - Handles generic facets (useCases, benefits, claims, compatibility)
   - Uses strict vs. fuzzy matching based on constraint type

5. **Constraint Relaxation** (if no results):
   - **Widening Tiers**:
     - Tier 1: Drop category, keep price/brand/stock
     - Tier 2: Drop brand, keep price/stock
     - Tier 3: Drop price, keep stock
     - Tier 4: Stock only
   - Each tier preserves gender filters
   - Re-executes search with relaxed filters

6. **Final Scoring**:
   ```typescript
   // Base score from category boost
   let score = merchContext.boostByCategory.get(category) ?? 0;
   
   // DB rank
   score += product.rank ?? 0;
   
   // Attribute matching bonus
   if (matchesColor) score += 0.3;
   if (matchesFabric) score += 0.3;
   // ...
   
   // Sort by score DESC, then updatedAt DESC
   ```

#### 4.2 Relaxed Search Function: `searchProductsRelaxed()`

**Process**:

1. Try strict search first
2. If no results, apply relaxation steps:
   - **Step 1**: `dropAttributeFilters()` - Remove colors, fabrics, materials, sizes, occasions, seasons
   - **Step 2**: `keepOnlyCategoryAndPrice()` - Drop all attributes, keep category + price
   - **Step 3**: `keepOnlyQuery()` - Drop category and price, keep only query
3. Return first successful result or empty array

---

### Stage 5: Product Evaluation & Card Creation

**File**: `src/lib/llm/orchestrator/flows/discovery.ts` - `runDiscoveryFlow()` (continued)

#### 5.1 Product Fit Evaluation

```typescript
const evaluated = candidates
  .map(item => evaluateProductFit(item, scoringConstraints, implicitPrefs, queryTokens))
  .sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.priceCents - b.item.priceCents;
  });
```

**Function**: `evaluateProductFit()`
- Scores products based on:
  - Constraint matches (category, price, attributes)
  - Implicit preferences (price sensitivity, style)
  - Query token matches
- Returns: `{ item, score, facts: string[] }`

#### 5.2 Deduplication & Diversity

1. **Deduplicate by ID**:
   ```typescript
   const uniqueEvaluated = evaluated.filter(entry => {
     if (seenIds.has(entry.item.id)) return false;
     seenIds.add(entry.item.id);
     return true;
   });
   ```

2. **Category Diversity** (interleave by category):
   ```typescript
   // Group by category
   const groupedByCategory = new Map<string, typeof uniqueEvaluated>();
   
   // Round-robin interleave for diversity
   const interleaved = [];
   for (let i = 0; i < maxLen && interleaved.length < strictLimit * 2; i++) {
     for (const group of groupedByCategory.values()) {
       if (group[i]) interleaved.push(group[i]);
     }
   }
   ```

3. **Final Deduplication** (by productUrl/canonicalSku):
   ```typescript
   const deduplicatedCards = deduplicateProductCards(strictCards, strictLimit);
   ```

#### 5.3 Card Reason Generation

**LLM Query**: Batched Card Reasons

**File**: `src/lib/llm/orchestrator/cards.ts` - `buildCardReasonsBatch()`

**Prompt**: `buildCardReasonMultiPrompt(requestedCategoryExists, requestedCategory)`

**Input**:
```typescript
{
  shopperQuery: string;
  products: Array<{
    index: number;
    title: string;
    description: string;
    attributes: ProductAttributes;
    intentNotes: string[];
    facts: string[];
  }>;
}
```

**LLM Call**:
- **Model**: Lightweight LLM (`gpt-4.1-mini` by default)
- **Purpose**: `'card_reason'`
- **Expect JSON**: false
- **Temperature**: 0.5

**Output Format**:
```
Reason for product 1
<<<END_REASON>>>
Reason for product 2
<<<END_REASON>>>
Reason for product 3
...
```

**Guidelines** (from prompt):
- Exactly 10-15 words per reason
- Vary openings (don't repeat same starter phrase)
- Reference actual product attributes (benefits, useCases, styleTags, etc.)
- Never mention requested category if it doesn't exist in catalog
- No markdown, bullets, or quotes

**Fallback**: If LLM fails, uses deterministic reason:
```typescript
buildDeterministicReason(item, facts, constraintLabels)
```

#### 5.4 Product Card Assembly

**File**: `src/lib/llm/orchestrator/cards.ts` - `buildProductCard()`

```typescript
const productCard: ProductCard = {
  id: item.id,
  title: item.title,
  priceCents: item.priceCents,
  salePriceCents: item.salePriceCents,
  currency: item.currency,
  keyAttributes: extractKeyAttributes(item.attributes), // Top 3-5 attributes
  reason: strictReasons[index], // LLM-generated or deterministic
  imageUrl: item.imageUrl,
  productUrl: item.productUrl,
  stockStatus: item.stockStatus,
  queryChips: buildQueryChips(constraints, implicitPrefs), // Visual chips for filters
};
```

**Key Attributes Extraction**:
- Priority order: `['fabric', 'fit', 'length', 'season', 'occasion', 'color']`
- Limited to 5 attributes
- Format: `"fabric: cotton"`, `"fit: slim"`, etc.

---

### Stage 6: Response Generation

**File**: `src/lib/llm/orchestrator/flows/discovery.ts` - `runDiscoveryFlow()` (continued)

#### 6.1 Base Reply Generation

**If relaxed search**:
```typescript
if (wasRelaxed) {
  if (categoryWasDropped) {
    baseReply = `I couldn't find **${category}** matching all your criteria.\n\nHere are some similar options:`;
  } else {
    baseReply = `Here are the closest matches I found.`;
  }
} else {
  baseReply = buildDiscoveryReply(constraints, shortlistedItems);
}
```

**Function**: `buildDiscoveryReply()`
- Rule-based reply generation
- Mentions constraint labels (e.g., "blue dresses under $100")

#### 6.2 Reply Enhancement (Optional LLM Query)

**File**: `src/lib/llm/orchestrator/brandVoice.ts` - `maybeEnhanceReplyWithLlm()`

**Conditions**:
- Not in mock mode
- Base reply is rule-based (not already LLM-generated)

**LLM Call**:
- **Model**: Primary LLM (`gpt-4.1` by default)
- **Purpose**: `'final_reply'`
- **Expect JSON**: false
- **Temperature**: 0.7

**Prompt**: Includes:
- Base reply
- User message
- Product summaries
- Constraints
- Dataset context
- Brand voice instructions (if configured)

**Output**: Enhanced, brand-aware reply text

#### 6.3 Brand Voice Application

```typescript
const reply = await applyBrandVoiceToReply(baseReply);
```

- Applies brand voice transformations if configured
- Default: no transformation

#### 6.4 Follow-up Text Generation (Optional LLM Query)

**File**: `src/lib/llm/orchestrator/helpers.ts` - `buildPostCardsFollowupText()`

**Conditions**:
- Not in mock mode
- Products were shown

**LLM Call**:
- **Model**: Lightweight LLM (`gpt-4.1-mini` by default)
- **Purpose**: `'final_reply'`
- **Expect JSON**: false

**Prompt**: Includes:
- User message
- Constraints
- Product summaries
- Dataset context
- Ontology

**Output**: 1-2 follow-up questions or suggestions (e.g., "Would you like to see more options in a different color?")

---

### Stage 7: Metrics & Return

**File**: `src/app/api/assistant/route.ts`

#### 7.1 Record Conversation Event

```typescript
await recordConversationEvent({
  merchantId: defaultMerchant.id,
  sessionId: body.sessionId,
  pageType: body.pageType,
  userQuery: body.message,
  assistantReply: result.replyText,
  productIds: result.productCards.map(card => card.id),
  hadExactMatch: !result.noExactMatch,
});
```

#### 7.2 Return Response

```typescript
return NextResponse.json({
  replyText: result.replyText,
  productCards: result.productCards,
  noExactMatch: result.noExactMatch,
  intent: result.intent,
  resolvedConstraints: result.resolvedConstraints,
  usedFollowUpContext: result.usedFollowUpContext,
  followupText: result.followupText,
});
```

---

## LLM Query Summary

### Optimized Pipeline (L'Occitane)

**Total LLM Calls**: 1 per query

#### Primary LLM (gpt-4.1)

1. **Single-Shot Intent + Reply** (`'final_reply'`)
   - **Purpose**: Combines intent extraction AND reply generation
   - **Prompt**: `LOCCITANE_SINGLE_SHOT_PROMPT`
   - **Schema**: `LOCCITANE_SINGLE_SHOT_SCHEMA`
   - **Temperature**: 0.7
   - **Output**:
     - `searchQuery`: Optimized search query
     - `productType`, `collection`, `concern`, `priceMax`: Extracted intent
     - `replyOpener`: Friendly introduction (1-2 sentences, < 40 words)
     - `isGiftSet`: Boolean flag
   - **Replaces**: Context Gatekeeper + Intent & Constraints + Reply Enhancement (3 calls → 1)

**No LLM Calls For**:
- Intent extraction (rule-based)
- Product card reasons (template-based)
- Follow-up text (rule-based)

### Original Pipeline (Generic)

**Total LLM Calls**: 4-5 per query

#### Primary LLM (gpt-4.1) - High-Stakes Queries

1. **Context Gatekeeper** (`'intent'`)
   - Determines follow-up vs new search
   - Temperature: 0.0

2. **Intent & Constraints** (`'intent'`)
   - Extracts search parameters
   - Temperature: 0.0

3. **VelouRouter** (`'intent'`)
   - Handles pending suggestions
   - Temperature: 0.0

4. **Rescue Plan** (`'intent'`)
   - Creates alternative search strategies when no results
   - Temperature: 0.0

5. **Out-of-Scope Reply** (`'final_reply'`)
   - Dataset-aware messages for invalid queries
   - Temperature: 0.7

6. **No Results Reply** (`'final_reply'`)
   - Friendly responses with closest products
   - Temperature: 0.7

7. **Reply Enhancement** (`'final_reply'`)
   - Brand-aware reply improvements
   - Temperature: 0.7

#### Lightweight LLM (gpt-4.1-mini) - Helper Queries

1. **Card Reasons Batch** (`'card_reason'`)
   - Generates "Chosen because..." reasons for product cards
   - Batched (single call for multiple products)
   - Temperature: 0.5

2. **Follow-up Text** (`'final_reply'`)
   - Generates clarifying questions
   - Temperature: 0.7

### Comparison

| Aspect | Optimized Pipeline | Original Pipeline |
|--------|-------------------|-------------------|
| **LLM Calls** | 1 | 4-5 |
| **Intent Extraction** | Rule-based (0ms) | LLM call (600-1200ms) |
| **Reply Generation** | Combined with intent (800-1500ms) | Separate LLM call (600-1000ms) |
| **Card Reasons** | Template-based (50ms) | LLM batch (800-1500ms) |
| **Follow-up Text** | Rule-based (50ms) | LLM call (600-1000ms) |
| **Execution** | Parallel (search + LLM) | Sequential |
| **Total Latency** | 1.5-3 seconds | 2.7-4.9 seconds |

---

## Key Data Structures

### SearchConstraints

```typescript
{
  category?: string | string[];
  priceMinCents?: number;
  priceMaxCents?: number;
  colors?: string[];
  sizes?: string[];
  materials?: string[];
  fabrics?: string[];
  seasons?: string[];
  occasions?: string[];
  useCases?: string[];
  styleTags?: string[];
  benefits?: string[];
  claims?: string[];
  compatibility?: string[];
  genders?: string[];
  brands?: string[];
  ageGroups?: string[];
  fit?: string;
  query?: string;
  expandedKeywords?: string[];
  inStockOnly?: boolean;
  excludeProductIds?: string[];
  limit?: number;
}
```

### ProductCard

```typescript
{
  id: string;
  title: string;
  priceCents: number;
  salePriceCents?: number | null;
  currency: string;
  imageUrl: string;
  productUrl: string;
  keyAttributes: string[]; // e.g., ["fabric: cotton", "fit: slim"]
  reason: string; // "Chosen because..." (10-15 words)
  queryChips?: Array<{ label: string; why: string }>;
  stockStatus?: 'in_stock' | 'out_of_stock' | 'low_stock';
}
```

### AssistantQueryResult

```typescript
{
  replyText: string;
  productCards: ProductCard[];
  noExactMatch: boolean;
  pendingSuggestion?: PendingSuggestionResult;
  intent?: AssistantIntent;
  resolvedConstraints?: SearchConstraints;
  usedFollowUpContext?: boolean;
  followupText?: string;
}
```

---

## Performance Targets

- **End-to-end response time**: < 4 seconds (excluding external LLM latency)
- **LLM call batching**: Card reasons are batched (single call for all products)
- **Parallel execution**: Search and reply generation can run in parallel (L'Occitane pipeline)
- **Caching**: Catalog ontology is cached in memory

---

## Error Handling

### LLM Failures

- **JSON parsing failures**: Falls back to rule-based extraction
- **Provider errors**: Returns user-friendly error message
- **Timeout**: Falls back to deterministic/reason-based responses

### Search Failures

- **No results**: Triggers rescue plan → no results reply
- **Database errors**: Returns empty results with error logging

### Overall Fallback

If any critical step fails:
```typescript
return {
  replyText: 'Our assistant is temporarily unavailable. Please try again or use the filters and search.',
  productCards: [],
  noExactMatch: true,
};
```

---

## Special Flows

### L'Occitane Optimized Pipeline

**When**: 
- `USE_LOCCITANE_OPTIMIZED_PIPELINE=true` (env var)
- `pageType !== 'PDP'` (not product detail page)
- `productContextId` is undefined (not product Q&A)

**Enabled By**: Set `USE_LOCCITANE_OPTIMIZED_PIPELINE=true` in `.env` file

**Key Optimizations**:
1. **Pre-computed Ontology** (`src/lib/loccitane/ontology.ts`)
   - Static knowledge base: collections, product types, concerns, ingredients
   - Eliminates dynamic DB queries for ontology building
   - Fast keyword matching

2. **Rule-Based Intent Extraction** (`src/lib/loccitane/intent.ts`)
   - Deterministic follow-up detection (no LLM call)
   - Fast keyword matching against L'Occitane taxonomy
   - Extracts: productType, collection, concern, price, isGiftSet

3. **Single-Shot LLM Prompt** (`src/lib/loccitane/prompts.ts`)
   - Combines intent extraction AND reply generation in ONE call
   - L'Occitane-specific prompt (smaller, faster than generic)
   - Replaces 2-3 separate LLM calls

4. **Template-Based Product Reasons** (`src/lib/loccitane/reasons.ts`)
   - Rule-based "Chosen because..." reasons (no LLM per product)
   - Uses product attributes + templates
   - Instant generation (50ms vs 800-1500ms per product)

5. **Parallel Execution** (`src/lib/loccitane/orchestrator.ts`)
   - Search runs in parallel with LLM reply generation
   - Reduces total latency by max(search_time, llm_time) instead of sum

**Performance**:
- **LLM Calls**: 1 (vs 4-5 in original)
- **Latency**: 1.5-3 seconds (vs 2.7-4.9 seconds)
- **77% reduction** in LLM calls
- **~50% faster** end-to-end

**Files**:
- `src/lib/loccitane/orchestrator.ts` - Main handler
- `src/lib/loccitane/intent.ts` - Rule-based intent
- `src/lib/loccitane/prompts.ts` - Single-shot prompt
- `src/lib/loccitane/reasons.ts` - Template reasons
- `src/lib/loccitane/ontology.ts` - Pre-computed knowledge

**Note**: PDP product Q&A still uses the original pipeline (optimized for that use case).

### Product Q&A Flow

**When**: `productContextId` is provided

**Process**:
1. Load product from database
2. **LLM Query**: Product Q&A Reply
   - **Prompt**: `PRODUCT_QA_PROMPT`
   - **Purpose**: `'final_reply'`
   - Returns text-only answer about the product
3. No product cards returned

**File**: `src/lib/llm/orchestrator/flows/productQa.ts`

### PDP Suitability Flow

**When**: `pageType === 'PDP'` and `productContextId` exists

**Process**:
1. Load context product
2. Extract suitability query constraints
3. Search related products (excludes context product)
4. Generate cards with pairing/suitability reasons

**File**: `src/lib/llm/orchestrator/flows/pdp.ts`

---

## File Reference

### Optimized Pipeline (L'Occitane)
- `src/lib/loccitane/orchestrator.ts` - Fast query handler
- `src/lib/loccitane/intent.ts` - Rule-based intent extraction
- `src/lib/loccitane/prompts.ts` - Single-shot LLM prompt
- `src/lib/loccitane/reasons.ts` - Template-based product reasons
- `src/lib/loccitane/ontology.ts` - Pre-computed L'Occitane knowledge
- `src/lib/loccitane/index.ts` - Module exports

### Core Orchestrator (Original Pipeline)
- `src/lib/llm/orchestrator/index.ts` - Main entry point
- `src/lib/llm/orchestrator/intent.ts` - Intent & constraints extraction
- `src/lib/llm/orchestrator/flows/discovery.ts` - Discovery flow
- `src/lib/llm/orchestrator/flows/pending.ts` - Pending suggestion flow
- `src/lib/llm/orchestrator/flows/pdp.ts` - PDP suitability flow
- `src/lib/llm/orchestrator/flows/productQa.ts` - Product Q&A flow

### Card Generation
- `src/lib/llm/orchestrator/cards.ts` - Card building and reason generation
- `src/lib/llm/orchestrator/brandVoice.ts` - Brand voice and reply enhancement

### Search
**Main Entry Point:**
- `src/lib/search/index.ts` - Main search functions (`searchProducts`, `searchProductsRelaxed`)

**Ranking Module** (`ranking/`):
- `src/lib/search/ranking/dbRankedSearch.ts` - Database-level ranked search
- `src/lib/search/ranking/relevance.ts` - Relevance scoring for Prisma fallback
- `src/lib/search/ranking/weights.ts` - Ranking weights configuration
- `src/lib/search/ranking/shopifyRanking.ts` - Optional Shopify boost calculation

**Filtering Module** (`filtering/`):
- `src/lib/search/filtering/attributes.ts` - Attribute filtering (`matchesAttributeFilters`, `deriveAttributeConstraintMeta`)
- `src/lib/search/filtering/category.ts` - Category matching utilities
- `src/lib/search/filtering/relaxation.ts` - Constraint relaxation (tier-based)
- `src/lib/search/filtering/types.ts` - Filtering types

**Query Module** (`query/`):
- `src/lib/search/query/buildFilters.ts` - Constraint to SQL filter conversion (`buildBroadWhereFilters`)
- `src/lib/search/query/calculateTake.ts` - Dynamic take calculation
- `src/lib/search/query/types.ts` - Query-related types

**Utilities:**
- `src/lib/search/utils.ts` - Shared utility functions

### LLM
- `src/lib/llm/provider.ts` - LLM provider abstraction
- `src/lib/llm/prompts.ts` - All prompt templates

### API Routes
- `src/app/api/assistant/route.ts` - Main assistant endpoint (JSON response)
  - Supports both optimized and original pipelines
  - Returns JSON response after completion
- `src/app/api/assistant/stream/route.ts` - Streaming variant (SSE)
  - Supports both optimized and original pipelines
  - Sends progress updates via Server-Sent Events
  - Progress stages: `understanding`, `searching`, `evaluating`, `generating`, `complete`

---

## Notes

### General Architecture
- All LLM calls go through `src/lib/llm/provider.ts` for consistency
- The orchestrator is the single source of truth for query handling
- Search functions never query Prisma directly - always go through `src/lib/search/index.ts`
- Card reasons are batched to minimize LLM calls (original pipeline)
- Gender filtering is preserved through all relaxation tiers
- Follow-up detection uses both LLM (gatekeeper) and rule-based (fallback) methods

### Search Module Architecture
- **Modular Structure**: The search module has been refactored into separate modules:
  - `ranking/` - Database ranking, relevance scoring, weights configuration
  - `filtering/` - Attribute filtering, category matching, constraint relaxation
  - `query/` - Filter building, dynamic take calculation
- **Raw SQL Search**: Enabled by default for faster PostgreSQL full-text search when `search_vector` is available
- **Prisma Fallback**: Falls back to Prisma queries with relevance ranking if raw SQL fails

### Pipeline Endpoints
- Both `/api/assistant` and `/api/assistant/stream` support the optimized pipeline
- Stream endpoint provides real-time progress updates via SSE
- Same pipeline selection logic applies to both endpoints
- Metrics recording works identically for both endpoints
