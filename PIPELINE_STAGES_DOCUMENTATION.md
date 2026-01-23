# Velou Shopping Assistant - Complete Pipeline Stages Documentation

## Overview

This document provides a comprehensive breakdown of all stages in the Velou Shopping Assistant pipeline, from user query to product recommendations.

**Pipeline Architecture**: Multi-stage fashion shopping assistant that combines LLM classification, multi-view retrieval, constraint-based filtering, and ranking to deliver personalized product recommendations.

---

## High-Level Pipeline Flow

```
User Query (POST /api/assistant)
    ↓
1. API Entry Point & Rate Limiting
    ↓
2. Assistant Service Wrapper
    ↓
3. Safety Check
    ↓
4. Follow-Up Detection & Constraint Merging (LLM) [If follow-up detected]
    ↓
5. Category Classification (LLM) [Uses merged query if follow-up]
    ↓
6. Query Classification (LLM) [Uses merged constraints if follow-up]
    ↓
7. Multi-View Retrieval
    ├─ 7a. Pre-Deduplication (SQL)
    ├─ 7b. Vector Search (Semantic)
    ├─ 7c. Lexical Search (Optional)
    └─ 7d. Concept Search (Optional)
    ↓
8. Post-SQL Filtering
    ↓
9. Product Loading & Attribute Extraction
    ↓
10. Constraint-Based Ranking
    ↓
11. Product Validation
    ↓
12. Reply Generation (LLM)
    ↓
13. Product Card Building
    ↓
14. Metrics Recording
    ↓
Final Response (JSON)
```

---

## Stage 1: API Entry Point & Rate Limiting

**File**: `src/app/api/assistant/route.ts`

**Purpose**: Entry point for all assistant queries, handles rate limiting and request validation.

**Process**:
1. **Rate Limiting**: Check if request exceeds rate limits (`rateLimitLlm`)
2. **Request Validation**: Validate request body structure
   - `sessionId`: Required string
   - `message`: Required string (user query)
   - `pageType`: Optional ('HOME' | 'PLP' | 'PDP')
   - `history`: Optional array of conversation history
   - `productContextId`: Optional (for PDP questions)
   - `conversationContext`: Optional (for follow-up context)
3. **Merchant Resolution**: Load default merchant from database
4. **Delegation**: Call `handleAssistantQuery()` from AssistantService

**Output**: 
- Validated request passed to AssistantService
- Rate limit errors returned immediately (429 status)

**Time**: <10ms (if rate limit passes)

---

## Stage 2: Assistant Service Wrapper

**File**: `src/lib/services/AssistantService.ts`

**Purpose**: Wraps the LoveShackFancy orchestrator with merchant-specific logic and conversation state management.

**Process**:
1. **Merchant Verification**: Verify merchant exists and load merchant data
   - `brandName`
   - `voiceInstructions`
   - `datasetContext`
   - `uiCopy`
   - `faq`
2. **Conversation State Loading**: Load conversation state from database
   - `shownProductIds`: Previously shown products
   - `lastQueryFingerprint`: Hash of last query
   - `lastRankedProductIds`: Last ranked product IDs
   - `lastRankCursor`: Position in last ranked list
   - `pendingActions`: Pending user actions
   - `memory`: Conversation memory (including `lastEnhancedQuery`)
3. **Action Handling**: Handle special action IDs (if provided)
4. **Orchestrator Call**: Call `handleLoveshackfancyQuery()` with:
   - Merchant ID
   - Conversation state
   - Last enhanced query (for follow-up context)
   - Merchant data
5. **State Update**: Update conversation state with results
   - Store `enhancedQuery` for next turn
   - Update shown products
   - Update ranked products

**Output**: 
- `AssistantQueryResult` with reply text, product cards, and metadata

**Time**: <50ms (mostly database reads)

---

## Stage 3: Safety Check

**File**: `src/lib/loveshackfancy/safety.ts`

**Purpose**: Rule-based filtering of unsafe or non-shopping queries before any processing.

**Process**:
1. **Pattern Matching**: Check query against predefined unsafe patterns
   - Self-harm keywords
   - Non-shopping queries
   - Offensive content
2. **Safety Classification**: Return `{ safe: boolean, reason?: string }`
3. **Early Returns**:
   - **Self-harm**: Return compassionate response with crisis resources
   - **Unrelated**: Route to intelligent denial or redirect handler
   - **Unsafe**: Return generic safety response

**Output**:
- `safetyCheck.safe === true`: Continue to next stage
- `safetyCheck.safe === false`: Return early with appropriate response

**Time**: <1ms (in-memory rule matching)

---

## Stage 4: Follow-Up Detection & Constraint Merging (LLM) [If Follow-Up Detected]

**File**: `src/lib/loveshackfancy/constraint-merger.ts`

**Purpose**: Detect if query is a follow-up and intelligently merge constraints from previous query BEFORE category classification.

**Process**:
1. **Follow-Up Detection**: Check if query is a follow-up:
   - Check `lastEnhancedQuery` from conversation state
   - Use `isFollowUpRefinement()` to detect follow-up patterns
   - Patterns: "add", "remove", "instead", "also", "and", "or", etc.
2. **Constraint Merging**: If follow-up detected, use `mergeFollowUpConstraints()`:
   - **Input**:
     - Current query
     - Previous enhanced query
     - Previous constraints
     - Current constraints
   - **LLM Call**: Uses `CONSTRAINT_MERGER_PROMPT` to:
     - Detect merge action: `merge`, `replace`, `remove`, `exclude`, `new_search`
     - Merge constraints intelligently
     - Generate `enhancedQueryText` that preserves all previous context
   - **Output**:
     ```typescript
     {
       mergedConstraints: FashionConstraints,
       enhancedQueryText: string, // Cumulative query with all constraints (e.g., "pink dresses" from "dresses" + "in pink")
       mergeAction: 'merge' | 'replace' | 'remove' | 'exclude' | 'new_search',
       reason: string
     }
     ```
3. **Age Group Switch Detection**: Detect if user switched age groups (e.g., "for kids" after "for adults")
   - If detected, clear previous constraints and start fresh

**Output**:
- Merged constraints (if follow-up) or original constraints (if new search)
- Enhanced query text (for category classification and vector search)

**Time**: 1-3 seconds (if follow-up detected, otherwise skipped)

**Critical Note**: This happens BEFORE category classification so that category classification can use the complete merged query.

**Why This Order Matters**:
- **Problem if done after category classification**: If a user says "show me dresses" then follows up with "in pink", category classification would see only "in pink" (no product type) and fail to classify correctly.
- **Solution with correct order**: Follow-up merging happens first, creating "pink dresses" from "dresses" + "in pink", then category classification sees the complete query and correctly classifies as "Women's Dresses".
- **Example Flow**:
  1. User: "show me dresses" → Classifies as "Women's Dresses" ✓
  2. User: "in pink" → 
     - **Step 1 (Follow-Up Merging)**: Merges to "pink dresses" ✓
     - **Step 2 (Category Classification)**: Uses "pink dresses" → Classifies as "Women's Dresses" ✓
     - **Step 3 (Query Classification)**: Uses merged constraints → Extracts colors: ["Pink"] ✓

---

## Stage 5: Category Classification (LLM)

**File**: `src/lib/loveshackfancy/category-classifier.ts`

**Purpose**: Identify the most relevant product categories from the user query (or merged query if follow-up).

**Process**:
1. **Query Selection**: Use merged query if follow-up detected:
   ```typescript
   const queryForCategoryClassification = isFollowUp && enhancedQueryText 
     ? enhancedQueryText  // Use merged query (e.g., "pink dresses")
     : input.message;     // Use original query (e.g., "show me dresses")
   ```
2. **Gender Context**: Determine gender from:
   - Explicit gender in query classification
   - Product type gender association (e.g., "dresses" → female)
   - Category gender map
3. **Allowed Categories**: Build allowed categories list:
   - If gender is explicit: Include only matching gender categories
   - If gender is ambiguous but product type is explicit: Include all categories (male, female, unisex)
   - If gender is ambiguous and no product type: Include only strict majority categories
4. **LLM Classification**: Use `classifyQueryToCategoriesWithConfidence()`:
   - Query text (merged if follow-up)
   - Allowed categories list
   - Category dictionary (for validation)
5. **Top Categories**: Return top 3 categories with confidence scores:
   ```typescript
   {
     categories: [
       { category: "Women's Dresses", confidence: 0.95 },
       { category: "Tops", confidence: 0.60 },
       // ...
     ]
   }
   ```

**Output**:
- Top 3 categories with confidence scores
- Used for SQL-level category filtering

**Time**: 1-3 seconds (LLM API call)

**Critical Note**: This uses the merged/enhanced query if it's a follow-up, ensuring category classification has full context (e.g., "pink dresses" → correctly classifies as "Women's Dresses" instead of failing because "in pink" alone has no product type).

---

## Stage 6: Query Classification (LLM)

**File**: `src/lib/loveshackfancy/classifier.ts`

**Purpose**: Extract query intent and constraints using LLM (uses merged constraints if follow-up).

**Process**:
1. **Input Selection**: Use merged constraints if follow-up was detected:
   ```typescript
   const constraintsForClassifier = isFollowUp && mergedConstraints
     ? mergedConstraints  // Use merged constraints from follow-up
     : null;              // Use original query for classification
   ```
2. **LLM Call**: Use `classifyQueryWithMetadata()` with:
   - User message (or enhanced query if follow-up)
   - Merged constraints (if follow-up) or null (if new search)
   - Enhanced query text (if follow-up)
   - Conversation history (last 10 messages)
   - Category dictionary (for constraint validation) - uses categories from Stage 5
   - Gender context (if available)
2. **Extract Constraints**: LLM returns structured constraints:
   ```typescript
   {
     type: 'discovery' | 'refinement' | 'unrelated',
     constraints: {
       colors?: ConstraintWithIntent,
       sizes?: ConstraintWithIntent,
       materials?: ConstraintWithIntent,
       occasions?: ConstraintWithIntent,
       seasons?: ConstraintWithIntent,
       styles?: ConstraintWithIntent,
       patterns?: ConstraintWithIntent,
       lengths?: ConstraintWithIntent,
       sleeveLengths?: ConstraintWithIntent,
       necklines?: ConstraintWithIntent,
       fits?: ConstraintWithIntent,
       rises?: ConstraintWithIntent,
       formalityLevel?: ConstraintWithIntent,
       // ... more constraint types
     },
     productTerms?: string, // Clean product type (e.g., "dresses", "tops")
     gender?: 'male' | 'female' | 'unisex' | null,
     ageGroups?: ConstraintWithIntent,
   }
   ```
3. **Intent Levels**: Each constraint has an `intent`:
   - `'required'`: Must match (hard SQL filter)
   - `'strong'`: Should match (hard SQL filter for occasions)
   - `'preferred'`: Nice to have (soft ranking boost)
   - `'excluded'`: Must not match (hard SQL filter)

**Output**:
- `QueryClassification` object with extracted constraints and intent

**Time**: 2-4 seconds (LLM API call)

---

## Stage 5: Category Classification (LLM)

**File**: `src/lib/loveshackfancy/category-classifier.ts`

**Purpose**: Identify the most relevant product categories from the user query.

**Process**:
1. **Gender Context**: Determine gender from:
   - Explicit gender in query classification
   - Product type gender association (e.g., "dresses" → female)
   - Category gender map
2. **Allowed Categories**: Build allowed categories list:
   - If gender is explicit: Include only matching gender categories
   - If gender is ambiguous but product type is explicit: Include all categories (male, female, unisex)
   - If gender is ambiguous and no product type: Include only strict majority categories
3. **LLM Classification**: Use `classifyQueryToCategoriesWithConfidence()`:
   - Query text
   - Allowed categories list
   - Category dictionary (for validation)
4. **Top Categories**: Return top 3 categories with confidence scores:
   ```typescript
   {
     categories: [
       { category: "Women's Dresses", confidence: 0.95 },
       { category: "Tops", confidence: 0.60 },
       // ...
     ]
   }
   ```

**Output**:
- Top 3 categories with confidence scores
- Used for SQL-level category filtering

**Time**: 1-3 seconds (LLM API call)

---


---

## Stage 7: Multi-View Retrieval

**File**: `src/lib/loveshackfancy/retrieval.ts`

**Purpose**: Retrieve candidate products using multiple search methods in parallel.

### Stage 7a: Pre-Deduplication (SQL)

**File**: `src/lib/search/vector/index.ts` - `deduplicateProductsByCategoryForPostFiltering()`

**Purpose**: Filter products by basic criteria AND ALL required constraints, then remove duplicate variants before expensive vector search.

**Process**:
1. **SQL Filtering**: Apply hard SQL filters:
   - **Primary Filters**:
     - `category`: Top 3 categories (OR logic)
     - `gender`: Extracted gender (if explicit)
     - `ageGroup`: Extracted age groups (hard filter)
     - `inclusivitySizing`: Plus Size, Petite, etc. (if specified)
     - `setVsSingle`: Set vs Single products (default: ["Single"])
     - `priceMinCents` / `priceMaxCents`: Price range (if specified)
     - `stockStatus`: 'in_stock' (if `inStockOnly === true`)
     - `isActive`: true
     - `merchantId`: Merchant ID
   - **Required Constraint Filters** (intent="required" or occasions with "strong" intent):
     - `colors`: Check `enrichedColor`, `color` columns (OR logic for multiple colors)
     - `materials`: Check `material`, `fabric` columns (OR logic)
     - `seasons`: Check `season` column
     - `occasions`: Check `occasionContext` array (array overlap `&&`) and `occasion` column
     - `fits`: Check `fit` column
     - `styles`: Check `silhouetteCut` column (PRIMARY) and attributes
     - `sleeves`: Check `sleeve` column
     - `necklines`: Check `neckline` column
     - `lengths`: Check `length` column
     - `rises`: Check `riseWaist` column
     - `patterns`: Check `attributes->>'pattern'` and Pattern JSON arrays
     - `formalityLevel`: Check `formalityLevel` column
     - `colorShade`: Check `colorShade` column
     - `sizes`: Check `attributes->>'size'` (JSONB array)
     - `collections`: Check `attributes->>'collection'`
     - `embellishments`: Check `attributes->>'embellishments'`
     - `colorUndertone`: Check `colorUndertone` column
     - `seasonalPalette`: Check `seasonalPalette` column
   - **Filter Logic**: 
     - AND logic between different constraint types (product must match all specified required constraints)
     - OR logic for multiple values within the same constraint type (e.g., multiple colors)
2. **Deduplication**: Remove duplicate variants using deduplication key:
   - Priority: `shopifyProductId` (extracted from product ID) > `parent_id` > `related_id` > `sourceId` pattern (removing size/color suffixes) > product ID
   - Keep only the best product (highest `selection_score`) from each group
3. **Limit**: Return top N deduplicated product IDs (default: 1500)

**Output**:
- Array of deduplicated product IDs (typically 50-1500 products) that match ALL required constraints

**Time**: 100-500ms (SQL query execution, may be slightly longer with multiple constraint filters)

**Critical Note**: This ensures products matching all required constraints are included before vector search, preventing the exclusion issue where products matching all constraints were filtered out in previous implementations.

---

### Stage 7b: Vector Search (Semantic)

**File**: `src/lib/search/vector/index.ts` - `searchVectorIndexWithDeduplication()`

**Purpose**: Find products semantically similar to the query using vector embeddings.

**Process**:
1. **Query Embedding**: Generate embedding for enhanced query text:
   - Use OpenAI `text-embedding-3-small` model (1536 dimensions)
   - Query text includes: original query + formatted constraints
2. **SQL Filtering**: Apply constraint filters at SQL level (conditional based on POST_SQL_FILTERING mode):
   - **Primary Filters** (always applied, AND logic):
     - `category`: Top 3 categories (OR within categories)
     - `gender`: Extracted gender (if explicit)
     - `ageGroup`: Extracted age groups
   - **Constraint Filters** (conditionally applied based on mode):
     - **POST_SQL_FILTERING Mode** (`USE_POST_SQL_FILTERING === true`):
       - Required constraint filters are **NOT applied** here (already filtered in pre-deduplication)
       - Only non-required constraints (if any) are applied
       - This eliminates redundant SQL filtering and improves performance
     - **EXISTING Mode** (`USE_POST_SQL_FILTERING === false`):
       - **Constraint Filters** (AND logic between types, OR within types):
         - `colors`: Check `enrichedColor`, `color` columns (OR logic for multiple colors)
         - `occasions`: Check `occasionContext` array (array overlap `&&`)
         - `materials`: Check `material`, `fabric` columns
         - `seasons`: Check `season` column
         - `fits`: Check `fit` column
         - `styles`: Check `silhouetteCut` column
         - `sleeves`: Check `sleeve` column
         - `necklines`: Check `neckline` column
         - `lengths`: Check `length` column
         - `rises`: Check `riseWaist` column
         - `patterns`: Check `attributes->>'pattern'`
         - `formalityLevel`: Check `formalityLevel` column
       - **Required Intent Filters**: Only constraints with `'required'` or `'strong'` intent are applied as hard SQL filters
3. **Vector Similarity**: Calculate cosine similarity between query embedding and product embeddings:
   ```sql
   similarity = 1 - (p.embedding <=> $1::vector)
   ```
4. **Deduplication**: If pre-deduplication IDs not provided, deduplicate at SQL level using same key logic
5. **Ranking**: Order by similarity (descending)
6. **Limit**: Return top N products (default: 150)

**Output**:
- Array of `{ productId: string, similarity: number }` sorted by similarity

**Time**: 200-800ms (SQL query with vector similarity calculation, faster in POST_SQL_FILTERING mode due to reduced filtering)

**Critical Note**: In POST_SQL_FILTERING mode, required constraints are already filtered in pre-deduplication, so they're conditionally excluded here to avoid redundant filtering. This improves performance and ensures consistency.

---

### Stage 7c: Lexical Search (Optional)

**File**: `src/lib/search/vector/index.ts` - `searchProductsByKeyword()`

**Purpose**: Full-text keyword search using PostgreSQL full-text search.

**Process**:
1. **Keyword Extraction**: Extract keywords from query
2. **Full-Text Search**: Use PostgreSQL `tsvector` and `tsquery`:
   ```sql
   WHERE to_tsvector('english', p.title || ' ' || p.description) @@ to_tsquery('english', $1)
   ```
3. **Ranking**: Order by relevance score
4. **Limit**: Return top N products

**Note**: Lexical search is **disabled by default** (`lexical: false`) as vector search is more effective.

**Output**:
- Array of product IDs with keyword match scores

**Time**: 50-200ms (if enabled)

---

### Stage 7d: Concept Search (Optional)

**File**: `src/lib/search/concept/index.ts`

**Purpose**: Structured attribute index search using pre-built concept indices.

**Process**:
1. **Concept Index Loading**: Load concept index from cache (pre-built from product attributes)
2. **Attribute Matching**: Match query constraints against concept index:
   - Colors
   - Materials
   - Occasions
   - Seasons
   - Styles
   - Patterns
3. **Product Lookup**: Find products matching concept attributes
4. **Ranking**: Order by concept match score

**Note**: Concept search is **disabled by default** (`concept: false`) as attributes aren't fully structured in this dataset.

**Output**:
- Map of product IDs to matched concept attributes

**Time**: 50-200ms (if enabled)

---

### Stage 7e: Multi-View Combination

**Process**:
1. **Score Normalization**: Normalize scores from different search methods (0-1 range)
2. **Score Combination**: Combine scores using weighted average:
   - Semantic: 70% weight (primary)
   - Lexical: 20% weight (if enabled)
   - Concept: 10% weight (if enabled)
3. **Deduplication**: Remove duplicate products across search methods
4. **Top Candidates**: Select top N candidate product IDs (default: 150)

**Output**:
- `MultiViewRetrievalResult`:
  ```typescript
  {
    candidateIds: string[],
    lexicalScores: Map<string, number>,
    semanticScores: Map<string, number>,
    conceptMatches: Map<string, Set<string>>,
    categoryDictionaries?: CategoryDictionaryMap
  }
  ```

**Time**: 50-100ms (score combination and deduplication)

---

## Stage 8: Post-SQL Filtering

**File**: `src/lib/search/filtering/post-filter.ts`

**Purpose**: Apply additional filters using category-specific dictionaries (for constraints not applied at SQL level).

**Process**:
1. **Category Dictionary Building**: Build category-specific dictionaries from candidate products:
   - Extract unique values for each constraint type from candidate set
   - Build lookup maps: `category → available values`
   - Example: `{ "Women's Dresses": { colors: ["Red", "Blue", ...], lengths: ["Mini", "Midi", ...] } }`
2. **Filter Application**: Apply filters using category dictionaries:
   - **Colors**: Check `enrichedColor`, `color` columns (case-insensitive, partial match)
   - **Lengths**: Check `length` column and title (case-insensitive, partial match)
   - **Sleeves**: Check `sleeve` column (case-insensitive)
   - **Necklines**: Check `neckline` column (case-insensitive)
   - **FormalityLevel**: Check `formalityLevel` column (case-insensitive)
   - **ColorShade**: Check `colorShade` column (case-insensitive)
3. **Filter Intent Handling**: Respect constraint intent:
   - `'required'` or `'excluded'`: Hard filter (remove non-matching products)
   - `'preferred'` or `'strong'`: Soft filter (keep but may affect ranking)
4. **Skip Logic**: Skip filtering if constraint was already applied at SQL level (to avoid double-filtering)

**Output**:
- Filtered candidate product IDs (products that match all required constraints)

**Time**: 50-200ms (dictionary building + filtering)

---

## Stage 9: Product Loading & Attribute Extraction

**File**: `src/lib/loveshackfancy/orchestrator.ts` - `loadFashionProducts()`

**Purpose**: Load full product data from database with all fashion attributes.

**Process**:
1. **Batch Loading**: Load products in parallel batches (100 products per batch) for performance
2. **Attribute Selection**: Select all relevant columns:
   - Core: `id`, `title`, `description`, `imageUrl`, `productUrl`, `priceCents`, `salePriceCents`, `currency`, `category`, `stockStatus`
   - Fashion Attributes: `color`, `fabric`, `material`, `occasion`, `season`, `fit`, `length`, `sleeve`, `formalityLevel`, `temperatureIntent`, `humidityFriendly`, `occasionContext`, `problemSolutions`, `functionFeatures`, `colorShade`, `colorUndertone`, `seasonalPalette`, `silhouetteCut`, `neckline`, `riseWaist`
   - Metadata: `attributes` (JSONB), `brand`, `merchantId`
3. **Attribute Extraction**: Extract attributes from columns and JSONB fallback:
   - Primary: Database column (e.g., `p.color`)
   - Fallback: JSONB attributes (e.g., `p.attributes->>'color'`)
   - Extensible: Extensible attributes (e.g., `p.attributes->'extensible'->>'color'`)

**Output**:
- Array of `SearchResultItem` with full product data and fashion attributes

**Time**: 100-300ms (parallel batch loading)

---

## Stage 10: Constraint-Based Ranking

**File**: `src/lib/loveshackfancy/ranking/constraint-ranker.ts`

**Purpose**: Rank products by how well they match the extracted constraints.

**Process**:
1. **Constraint Matching**: For each product, calculate match scores for each constraint type:
   - **Colors**: `matchColor()` - Check `enrichedColor`, `color` columns (exact + partial match)
   - **Styles**: `matchStyle()` - Check `silhouetteCut` column (exact + partial match)
   - **Materials**: `matchMaterial()` - Check `material`, `fabric` columns (exact + partial match)
   - **Occasions**: `matchOccasion()` - Check `occasionContext` array (array overlap)
   - **Seasons**: `matchSeason()` - Check `season` column (exact match)
   - **Fits**: `matchFit()` - Check `fit` column (exact match)
   - **Sleeves**: `matchSleeve()` - Check `sleeve` column (exact match)
   - **Necklines**: `matchNeckline()` - Check `neckline` column (exact match)
   - **Lengths**: `matchLength()` - Check `length` column and title (exact + partial match)
   - **Patterns**: `matchPattern()` - Check `attributes->>'pattern'` and title (exact + partial match)
   - **FormalityLevel**: `matchFormalityLevel()` - Check `formalityLevel` column (exact match)
2. **Score Calculation**: Calculate weighted constraint score:
   ```typescript
   constraintScore = (
     colorScore * colorWeight +
     styleScore * styleWeight +
     materialScore * materialWeight +
     // ... more constraint scores
   ) / totalWeight
   ```
3. **Intent-Based Weighting**: Adjust weights based on constraint intent:
   - `'required'`: High weight (must match)
   - `'strong'`: Medium-high weight (should match)
   - `'preferred'`: Medium weight (nice to have)
   - `'excluded'`: Negative weight (penalty if matches)
4. **Vector Similarity Integration**: Combine constraint score with vector similarity:
   ```typescript
   finalScore = (constraintScore * 0.6) + (vectorSimilarity * 0.4)
   ```
5. **Hard Filtering**: Remove products that don't match required constraints:
   - If constraint has `'required'` intent and product doesn't match: Remove
   - If constraint has `'excluded'` intent and product matches: Remove
6. **Relevance Threshold**: Filter out products below relevance threshold (default: 0.3)

**Output**:
- Array of products sorted by final score (descending)

**Time**: 50-200ms (constraint matching and scoring)

---

## Stage 11: Product Validation

**File**: `src/lib/loveshackfancy/validation/category-validator.ts`

**Purpose**: Validate that products match the classified categories.

**Process**:
1. **Category Keyword Extraction**: Extract category keywords from product titles and descriptions
2. **Category Matching**: Check if product category matches classified categories:
   - Exact match: Product category in classified categories
   - Keyword match: Product title/description contains category keywords
3. **Filtering**: Remove products that don't match any classified category

**Output**:
- Validated product list (only products matching classified categories)

**Time**: 20-50ms (keyword extraction and matching)

---

## Stage 12: Reply Generation (LLM)

**File**: `src/lib/loveshackfancy/reply.ts`

**Purpose**: Generate natural language reply explaining the product recommendations.

**Process**:
1. **Reply Context Building**: Build context for LLM:
   - Query text (original and enhanced)
   - Classified constraints
   - Product data (top 4-8 products)
   - Conversation history
   - Merchant brand voice
2. **LLM Call**: Use `generateReply()` with:
   - Reply prompt template
   - Product data
   - Constraint information
   - Brand voice instructions
3. **Reply Formatting**: Format reply text:
   - 2-4 sentences explaining recommendations
   - Natural, conversational tone
   - Brand-appropriate voice
4. **Product Type Mismatch Handling**: If products don't match query product type:
   - Acknowledge mismatch in reply
   - Explain why different products are shown
   - Suggest alternatives

**Output**:
- `ReplyResult`:
  ```typescript
  {
    replyText: string, // Main reply text
    replyTextAfter?: string, // Optional text after product cards
    productReasons?: Map<string, string> // Per-product reasons (if generated)
  }
  ```

**Time**: 2-5 seconds (LLM API call)

---

## Stage 13: Product Card Building

**File**: `src/lib/loveshackfancy/orchestrator.ts` - `buildProductCards()`

**Purpose**: Build product cards with attributes, reasons, and metadata.

**Process**:
1. **Product Selection**: Select top 4 products from ranked list
2. **Attribute Extraction**: Extract key attributes for each product:
   - Color
   - Material
   - Fit
   - Length
   - Sleeve length
   - Neckline
   - Style
   - Occasion
   - Season
3. **Reason Generation**: Generate "Chosen because..." reason for each product:
   - Use `buildProductReason()` from `reasons.ts`
   - Rule-based reason generation (no LLM call per product)
   - Format: "Chosen because [attribute1], [attribute2], and [attribute3]"
4. **Card Building**: Build `ProductCard` objects:
   ```typescript
   {
     id: string,
     title: string,
     imageUrl: string,
     productUrl: string,
     priceCents: number,
     salePriceCents?: number,
     currency: string,
     reason: string, // "Chosen because..."
     attributes: {
       color?: string,
       material?: string,
       fit?: string,
       length?: string,
       sleeve?: string,
       neckline?: string,
       style?: string,
       occasion?: string,
       season?: string
     }
   }
   ```

**Output**:
- Array of `ProductCard` objects (top 4 products)

**Time**: 20-50ms (attribute extraction and reason generation)

---

## Stage 14: Metrics Recording

**File**: `src/lib/telemetry/metrics.ts`

**Purpose**: Record conversation events for analytics and metrics.

**Process**:
1. **Event Building**: Build `ConversationEvent`:
   ```typescript
   {
     merchantId: string,
     sessionId: string,
     pageType: 'HOME' | 'PLP' | 'PDP',
     userQuery: string,
     assistantReply: string,
     productIds: string[],
     hadExactMatch: boolean
   }
   ```
2. **Database Insert**: Insert event into `ConversationEvent` table (fire-and-forget, non-blocking)
3. **Error Handling**: Log errors but don't fail request if metrics recording fails

**Output**:
- Event recorded in database (async, non-blocking)

**Time**: <10ms (async database insert)

---

## Final Response

**Response Format**:
```typescript
{
  replyText: string, // Main reply text
  replyTextAfter?: string, // Optional text after product cards
  productCards: ProductCard[], // Top 4 products
  noExactMatch: boolean, // True if no exact matches found
  followupText?: string, // Optional follow-up questions
  actions?: ActionProposal[], // Optional action buttons
  intent?: string, // Query intent
  resolvedConstraints?: SearchConstraints, // Extracted constraints
  usedFollowUpContext?: boolean, // True if follow-up was detected
  enhancedQuery?: string // Enhanced query text (for next turn)
}
```

**Total Pipeline Time**: 4-8 seconds (typical)
- LLM calls: 3-6 seconds (classification, category, follow-up merging, reply)
- Database queries: 500ms-1.5s (pre-deduplication, vector search, product loading)
- Processing: 200-500ms (filtering, ranking, card building)

---

## Key Design Decisions

### 1. Pre-Deduplication Architecture
- **Why**: Reduces products before expensive vector search
- **Implementation**: Filters by category/gender/age AND ALL required constraints (intent="required" or occasions with "strong" intent)
- **Impact**: Ensures products matching all required constraints are included before vector search, preventing exclusion issues
- **Performance**: Slightly longer SQL query execution (100-500ms) but eliminates redundant filtering in vector search stage

### 2. Multi-View Retrieval
- **Why**: Combines semantic (vector) and lexical (keyword) search for better coverage
- **Trade-off**: More complex, but better results
- **Impact**: Better recall, but requires score normalization

### 3. Post-SQL Filtering
- **Why**: Applies filters using category-specific dictionaries (more flexible than SQL)
- **Trade-off**: Additional processing step, but handles edge cases better
- **Impact**: Better constraint matching, but adds latency

### 4. Constraint Intent Levels
- **Why**: Distinguishes between required, preferred, and excluded constraints
- **Trade-off**: More complex logic, but better user experience
- **Impact**: More accurate results, but requires careful intent assignment

### 5. Follow-Up Constraint Merging
- **Why**: Preserves context across conversation turns
- **Trade-off**: Additional LLM call, but better multi-turn conversations
- **Impact**: Better follow-up handling, but adds latency

---

## Performance Optimization

### Parallel Execution
- Multi-view retrieval runs in parallel (semantic, lexical, concept)
- Reply generation and product card building run in parallel
- Batch product loading (100 products per batch)

### Caching
- Category dictionaries cached in memory
- Concept indices cached in memory
- Embeddings cached (if same query)

### Database Optimization
- Indexed columns: `category`, `gender`, `ageGroup`, `color`, `material`, `season`, `fit`, `sleeve`, `neckline`, `occasionContext`
- Vector index on `embedding` column (pgvector)
- Full-text index on `title` and `description` (for lexical search)

---

## Error Handling

### LLM Failures
- Fallback to rule-based classification
- Generic error message to user
- Log errors for debugging

### Database Failures
- Retry logic for transient errors
- Fallback to cached data (if available)
- Generic error message to user

### Constraint Extraction Failures
- Fallback to keyword-based extraction
- Default to broad search (no constraints)
- Log errors for debugging

---

## Future Improvements

1. ~~**Pre-Deduplication Scope**: Include material/season/color filters in pre-deduplication~~ ✅ **COMPLETED**: All required constraints are now filtered in pre-deduplication
2. **Caching**: Cache LLM responses for common queries
3. **Streaming**: Stream reply generation for better UX
4. **A/B Testing**: Test different ranking algorithms
5. **Personalization**: Use user history for better recommendations
6. **Performance Optimization**: Further optimize SQL queries with multiple constraint filters (index tuning, query plan analysis)

---

## Related Documentation

- `RETRIEVAL_AUDIT.md`: Detailed retrieval system documentation
- `PRE_DEDUPLICATION_EXPLANATION.md`: Pre-deduplication step explanation
- `CONSTRAINT_MAPPING_FIX_SUMMARY.md`: Constraint mapping documentation
- `TEST_RESULTS_AFTER_BUILD.md`: Test results and analysis
