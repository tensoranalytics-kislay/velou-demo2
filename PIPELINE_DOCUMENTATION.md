# Velou Shopping Assistant - Pipeline Documentation

## CHANGELOG

### 2025-11-25 - OpenAI-Only LLM Stack & Dual-Model Routing

#### Summary
- Removed the dormant Perplexity provider path and standardized every LLM call on OpenAI with deterministic model routing.
- Added first-class config for `PRIMARY_LLM_MODEL` (defaults to `gpt-4.1`) and `LIGHT_LLM_MODEL` (defaults to `gpt-4.1-mini`) so high-stakes vs. helper flows can be tuned without code edits.
- Cleaned up admin surfaces, migrations, and suggestion helpers to reflect the OpenAI-only setup.

#### Technical Changes
- **`src/lib/config.ts`**
  - `LLMProvider` union is now `'openai' | 'mock'`.
  - Reads `PRIMARY_LLM_MODEL` / `LIGHT_LLM_MODEL` env vars and validates `OPENAI_API_KEY` when `LLM_PROVIDER=openai`.
- **`src/lib/llm/provider.ts`**
  - Removed `callPerplexity`.
  - Added `resolveModel()` + `PRIMARY_PURPOSES` + `TEMPERATURE_BY_PURPOSE` maps so:
    - `intent`, `final_reply`, and `pdp_suitability` always hit the primary model (e.g., `gpt-4.1`).
    - `card_reason` uses the lightweight model unless it is unset.
  - Maintains JSON schema support for `expectJson` calls.
- **`src/app/admin/llm/page.tsx` & `LLMConfigDisplay.tsx`**
  - UI now surfaces the active OpenAI models (primary vs. lightweight) instead of Perplexity toggles.
  - Merchant settings only reference an OpenAI key.
- **`src/app/api/suggestions/route.ts`**
  - Follow-up prompt generation commentary updated to explicitly reference the lightweight OpenAI helper rather than Perplexity.
- **Prisma schema & migration**
  - Dropped `merchantPerplexityKey` via migration `20251125120000_remove_perplexity_keys`.
- **Environment**
  - `.env` must include `OPENAI_API_KEY` plus optional overrides for `PRIMARY_LLM_MODEL` / `LIGHT_LLM_MODEL`.
  - `LLM_PROVIDER` now defaults to `openai`, with `mock` reserved for deterministic tests.

#### Testing / Ops Notes
- Run `npx prisma migrate deploy` to apply the Perplexity cleanup migration before booting the server.
- Restart the Next dev server whenever model env vars change so `env` picks up the new routing.
- Existing Vitest coverage for orchestrator/search remains valid; no behavior change in tests other than the provider being OpenAI-only.

### 2025-01-XX - Gender Filtering + Relevance Ranking Fixes

#### New Features

**Gender as Hard Filter**
- Added gender filtering at DB level using JSON path queries
- For `genders: ["mens"]`: matches products with `gender="mens"` OR `gender="unisex"`
- For `genders: ["womens"]`: matches products with `gender="womens"` OR `gender="unisex"`
- For `genders: ["unisex"]`: matches only products with `gender="unisex"` (strict)
- Gender filters preserved through widening tiers (Tier 1-4)
- Applied in both raw SQL and Prisma fallback modes

**Follow-up Gender Refinement**
- Updated `detectFollowUpType()` to detect gender refinements:
  - Patterns: "for men", "men's", "mens though", "for women", "women's", "unisex"
  - Returns `followUpType='REFINE'` with `detectedGender` set
  - Only triggers REFINE if no new category noun is present (avoids SWITCH)
- Updated intent resolution to add `genders` to constraints when gender detected in follow-up

**Fallback Relevance Ranking**
- Replaced recency-only sorting in Prisma fallback with relevance-based ranking
- Rank calculation includes:
  - Gender match boost: +2.0 for exact match, +1.0 for unisex match
  - Keyword/token matches: +0.75 per match in title/description/category (max 4 matches)
  - Category match boost: +1.5 if product category matches query
  - Recency tie-breaker: +0.2 max (normalized days since update)
- Results sorted by `rank DESC, updatedAt DESC` before returning
- Ensures men's queries don't return women's products even if newer

#### Technical Changes

- **`src/lib/search/index.ts`**:
  - Added `genders` field to `BroadWhereFilters` type
  - Added gender filter in `buildBroadWhereFilters()` 
  - Added gender filter in `dbRankedSearch()` (both raw SQL and Prisma fallback)
  - Updated `buildWideningTiers()` to preserve gender filters through all tiers
  - Implemented fallback relevance ranking in Prisma mode
- **`src/lib/llm/orchestrator/followup-detector.ts`**:
  - Added gender refinement pattern detection
  - Added `detectedGender` field to `FollowUpDetection` type
- **`src/lib/llm/orchestrator/intent.ts`**:
  - Updated to use `detectedGender` from follow-up detection
  - Adds `genders` to constraints when gender refinement detected

#### Prisma JSON Compatibility

- Gender filtering uses JSON path queries: `attributes->>'gender'`
- In raw SQL mode: Uses `Prisma.sql` with JSON path operators
- In Prisma fallback: Filters in-memory after fetch (fetches 2x take to account for filtering)
- **Note**: Prisma's native JSON path filtering (`attributes: { path: ['gender'], equals: 'mens' }`) may not be available in all Prisma versions, so we use in-memory filtering as fallback

#### Testing

- Added unit tests in `tests/gender_and_ranking.test.ts`:
  - Gender follow-up detection patterns
  - Gender matching logic (mens/womens/unisex rules)
  - Fallback relevance ranking prioritization
  - Widening tier gender preservation

#### Known Limitations

- Gender filtering in Prisma fallback requires in-memory filtering (fetches 2x take)
- Full JSON path filtering in Prisma would require Prisma version with native JSON support

---

### 2025-01-XX - Product Discovery Pipeline Rebuild

#### New Features

**A) Synonym Expansion Improvements**
- Added `generateSynonymVariants()` utility to auto-generate spaced/hyphen/concatenated variants
- Added `expandKeywordsForSearch()` for comprehensive keyword expansion
- Supports singular/plural forms and common abbreviations (tee, joggers, etc.)

**B) Column-Safe Constraint Extraction**
- Updated attribute filtering to use strict color matching (colors must be from catalog ontology)
- Added substring matching for materials/fabrics (e.g., "cotton" matches "75% Cotton 21% Polyester")
- Improved robustness of `matchesAttributeFilters()` function

**C) No-Results Rescue Stage**
- Implemented closest-match rescue search when strict search returns 0 results
- Calls `CLOSEST_MATCH_RESCUE_PLAN_PROMPT` to generate up to 3 broadened searches
- Executes rescue searches sequentially and collects top 5 closest candidates
- Calls `NO_RESULTS_REPLY_PROMPT_V2` to generate friendly response mentioning up to 3 closest products
- Asks 1-2 clarifying questions in brand voice

**D) Card Deduplication**
- Added `deduplicateProductCards()` function to remove duplicates by title (case-insensitive)
- Avoids near-duplicates (same title + same color + same price)
- Applied before returning product cards to UI

**E) New LLM Prompts**
- Added `ROOT_ASSISTANT_SYSTEM_PROMPT` (PROMPT 0) - global behavior + tool discipline
- Added `CONTEXT_GATEKEEPER_PROMPT_V2` (PROMPT 1) - supports `confirm_to_show` threadType
- Added `INTENT_AND_CONSTRAINTS_PROMPT_V2` (PROMPT 2) - column-safe constraints + expandedKeywords
- Added `CLOSEST_MATCH_RESCUE_PLAN_PROMPT` (PROMPT 3) - rescue search planning
- Added `NO_RESULTS_REPLY_PROMPT_V2` (PROMPT 4) - friendly no-results responses
- Added `CARD_SELECTOR_PROMPT_V2` (PROMPT 5) - card selection with de-dup

#### Technical Changes

- **`src/lib/search/canonicalize.ts`**: Added synonym variant generation utilities
- **`src/lib/search/index.ts`**: 
  - Enhanced `matchesAttributeFilters()` with material substring matching and strict color validation
  - Passes color ontology for validation
- **`src/lib/llm/orchestrator/cards.ts`**: Added `deduplicateProductCards()` function
- **`src/lib/llm/orchestrator/index.ts`**: 
  - Implemented rescue stage in `runDiscoveryFlow()`
  - Added card deduplication before returning results
- **`src/lib/llm/prompts.ts`**: Added all new prompts (PROMPT 0-5) with JSON schemas

#### Additional Features

**F) Confirm-to-Show Handling**
- Updated `CONTEXT_GATEKEEPER_PROMPT_V2` to support `confirm_to_show` threadType
- Updated `callContextGatekeeper()` to detect confirmations ("yes", "show", "anything", etc.)
- Updated `handleAssistantQuery()` to run pending suggestion flow when `confirm_to_show` detected

**G) Expanded Keywords Integration**
- Added `expandedKeywords` field to `SearchConstraints` type
- Updated `buildBroadWhereFilters()` to merge `expandedKeywords` with canonical synonyms
- Uses expanded keywords in SQL keyword filters for comprehensive recall

**H) Color and Material Mapping**
- Added `mapColorToCatalog()` - validates user colors against catalog ontology
- Added `mapMaterialToCatalog()` - returns material keywords for substring matching
- Invalid colors are dropped as hard filters (kept as preferences only)

#### Known Limitations

- `search_vector` column not created in database (requires migration for full-text ranking)
  - System works with Prisma fallback (`ENABLE_RAW_RANKED_SEARCH=false` by default)
  - Full-text ranking requires: `ALTER TABLE "Product" ADD COLUMN search_vector tsvector;` + GIN index

#### Testing Recommendations

- Test synonym expansion: "tees" should match "t-shirt", "t shirt", "tshirt" variants
- Test material substring matching: "cotton" should match "75% Cotton 21% Polyester"
- Test strict color matching: non-ontology colors should be dropped as hard filters
- Test rescue stage: strict search with 0 results should trigger rescue and show closest matches
- Test card de-dup: duplicate titles should only appear once
- Test near-duplicate detection: same title + color + price should be filtered

---

### 2025-11-28 - Unified Catalog Ingestion System

#### Summary
- Implemented industry-agnostic catalog ingestion system that accepts unified CSV format from any vendor
- Added LLM-powered dataset inspector to auto-detect vertical, facets, and data quality
- Created admin UI for catalog upload with validation feedback and dataset context display
- System is config-driven, streaming-based, and non-blocking

#### Technical Changes

**Catalog Ingestion Core**:
- **`src/lib/catalog/unifiedSchemaConfig.ts`**: Defines unified CSV schema with field definitions, required levels, and mapping rules
- **`src/lib/catalog/types.ts`**: TypeScript types for `UnifiedVendorCatalogRow`, validation issues, and ingestion summary
- **`src/lib/catalog/validation.ts`**: Row normalization, validation (hard/soft requirements), and stats accumulation
- **`src/lib/catalog/ingestUnifiedCsv.ts`**: Streaming CSV parser, product upsert logic, and ingestion orchestrator
  - `parseUnifiedCsv()`: Async generator for streaming CSV parsing
  - `upsertProductFromUnifiedRow()`: Maps unified row to Prisma `Product` model
  - `ingestUnifiedCsvStream()`: Orchestrates ingestion with validation and context inference

**Dataset Inspector**:
- **`src/lib/catalog/datasetInspector.ts`**: LLM-powered dataset context inference
  - `inferDatasetContextFromRows()`: Uses primary LLM model to infer vertical, currency, facets, search examples
  - Samples up to 50 rows from first 200 processed
  - Returns `DatasetContext` with vertical, currency, facets, quality notes
  - Handles LLM failures gracefully with fallback context

**Admin UI**:
- **`src/app/admin/catalog/page.tsx`**: Catalog upload page with form, progress, and results display
- **`src/app/api/admin/catalog/upload/route.ts`**: API endpoint for CSV upload and ingestion
  - Accepts `multipart/form-data` with CSV file and vendor ID
  - Optional admin hints: `vertical`, `currency`, `enableContextInference`
  - Returns `IngestionSummary` with metrics, validation issues, and dataset context

**Key Features**:
- **Streaming ingestion**: Processes large CSV files without loading entire file into memory
- **Config-driven mapping**: All field definitions and requirements in `UNIFIED_CATALOG_SCHEMA`
- **Industry-agnostic**: Unknown fields stored in `attributes.extensible` JSON
- **LLM-powered inspection**: Auto-detects dataset characteristics (vertical, facets, quality)
- **Validation-first**: Clear distinction between hard-required, recommended, and optional fields
- **Non-blocking**: Context inference runs after ingestion, doesn't block product upserts

#### Data Flow

1. **Admin uploads CSV** → `POST /api/admin/catalog/upload`
2. **Streaming parse** → `parseUnifiedCsv()` yields rows one-by-one
3. **Validate & normalize** → `validateUnifiedRow()` checks requirements
4. **Upsert products** → `upsertProductFromUnifiedRow()` maps to `Product` table
5. **Collect samples** → First 200 valid rows collected for context inference
6. **Infer context** → `inferDatasetContextFromRows()` uses LLM (non-blocking)
7. **Return summary** → `IngestionSummary` with metrics, issues, and context

#### Testing
- Unit tests in `tests/catalog/` for schema config, validation, and ingestion
- Admin page tests in `tests/admin/catalog-upload.test.tsx`
- All 59 catalog tests passing

---

# Velou Shopping Assistant - Pipeline Documentation

## Pipeline Map (file/function list)

### API Entrypoint
- **File**: `src/app/api/assistant/route.ts`
  - `POST()` - Main API handler
  - Receives: `sessionId`, `pageType`, `message`, `history`, `pendingSuggestion`, `conversationContext`
  - Returns: `replyText`, `productCards[]`, `noExactMatch`, `pendingSuggestion`

### Context Manager / Conversation Store
- **File**: `src/lib/llm/orchestrator/index.ts`
  - Type: `ConversationContext` (client-side state, not persisted to DB)
    - `lastIntent?: AssistantIntent | null`
    - `lastConstraints?: SearchConstraints | null`
    - `lastShownProductIds?: string[]`
    - `lastUserQuery?: string | null`
  - **Storage**: Client-side React state in `ChatPanel.tsx`, persisted to localStorage
  - **Lifetime**: Per session, cleared on page refresh

### Context Gatekeeper (threadType, follow-up detection)
- **File**: `src/lib/llm/orchestrator/intent.ts`
  - `callContextGatekeeper()` - LLM-based decision (or rule-based fallback)
  - Returns: `ContextGatekeeperResult` with `threadType: 'follow_up' | 'new_search'`
  - **Prompt**: `CONTEXT_GATEKEEPER_PROMPT` in `src/lib/llm/prompts.ts`
  - **Fallback**: Rule-based heuristics using `isFollowUpMessage()`, `looksLikeNewQuery()`

### Intent & Constraint Extraction
- **File**: `src/lib/llm/orchestrator/intent.ts`
  - `inferIntentAndConstraints()` - Main orchestrator
  - `inferIntentAndConstraintsWithLlm()` - LLM-based extraction
  - `inferIntentAndConstraintsRuleBased()` - Fallback rule-based extraction
  - **Prompt**: `INTENT_AND_CONSTRAINTS_PROMPT` in `src/lib/llm/prompts.ts`
  - **Schema**: `SEARCH_CONSTRAINTS_JSON_SCHEMA`

### Constraint Normalization / Schema Validation
- **File**: `src/lib/llm/orchestrator/utils.ts`
  - `normalizeConstraintValues()` - Converts null→undefined, removes empty strings/0
  - `normalizeConstraintArrays()` - Coerces arrays, removes empty values
  - `applyOntologyToConstraints()` - Maps values to valid ontology terms via fuzzy matching
  - `mergeConstraints()` - Merges base + updates with contextAction awareness

### Follow-up Detection
- **File**: `src/lib/llm/orchestrator/followup-detector.ts`
  - `detectFollowUpType()` - Heuristic-based detection
  - Returns: `FollowUpDetection` with `followUpType: 'REFINE' | 'SWITCH' | 'CONFIRM_SUGGESTION' | 'UNKNOWN'`

### Category Canonicalization
- **File**: `src/lib/search/canonicalize.ts`
  - `canonicalizeCategory()` - Maps user text to `CanonicalCategory` enum
  - `getExpandedLeafCategories()` - Gets DB category values for canonical
  - `getSynonymTerms()` - Gets product type synonyms
  - `getAllSynonyms()` - Combines all synonym arrays
- **File**: `src/lib/llm/orchestrator/utils.ts`
  - `normalizeCategoryFromMessage()` - Deterministic synonym mapping (pre-LLM)
  - `CATEGORY_SYNONYM_MAP` - Hard-coded synonym → category mapping

### Discovery Flow
- **File**: `src/lib/llm/orchestrator/index.ts`
  - `runDiscoveryFlow()` - Main discovery orchestrator
  - `runPendingSuggestionFlow()` - Handles pending suggestion confirmation
  - `runPdpFlow()` - PDP suitability flow

### Search Functions
- **File**: `src/lib/search/index.ts`
  - `searchProducts()` - Main search function with widening tiers
  - `searchProductsRelaxed()` - Wrapper with constraint relaxation steps
  - `dbRankedSearch()` - Database-level ranked search (raw SQL or Prisma fallback)
  - `buildBroadWhereFilters()` - Builds SQL/Prisma WHERE filters
  - `calculateDynamicTake()` - Adaptive take calculation (300-2500)
  - `buildWideningTiers()` - Generates relaxation tiers
  - `matchesAttributeFilters()` - In-memory JSON attribute filtering

### Keyword/Synonym Filters
- **File**: `src/lib/search/index.ts`
  - `buildBroadWhereFilters()` - Extracts `keywordFilters` from canonical synonyms
  - `dbRankedSearch()` - Applies keyword filters as SQL LIKE/ILIKE OR conditions
- **File**: `src/lib/llm/orchestrator/utils.ts`
  - `extractHardTextFilterKeywords()` - Extracts keywords when category missing

### Attribute Filters (JSON attrs)
- **File**: `src/lib/search/index.ts`
  - `matchesAttributeFilters()` - Filters products by JSON `attributes` field
  - Checks: color, fabric, material, fit, season, occasion, sizes, useCases, productType, googleProductCategory, etc.

### Scoring + Ranking
- **File**: `src/lib/search/index.ts`
  - `dbRankedSearch()` - Database-level ranking (if `ENABLE_RAW_RANKED_SEARCH=true`)
    - Full-text search: `ts_rank_cd("search_vector", ...) * 5.0`
    - Category boost: `CASE WHEN category = X THEN weight ELSE 0 END`
    - Recency: `EXTRACT(EPOCH FROM (updatedAt - NOW())) / -86400.0 * 0.1`
  - In-memory scoring in `searchProducts()`:
    - Base: `merchContext.boostByCategory.get(category) ?? 0`
    - DB rank: `product.rank ?? 0`
    - Attribute score (when relaxed): +0.3 per matching color/fabric/material, +0.2 per occasion/season/fit
- **File**: `src/lib/llm/orchestrator/cards.ts`
  - `evaluateProductFit()` - Final card-level scoring
    - Category match: +3
    - Price within budget: +2 (else -2)
    - Attribute matches: +1.5 each
    - Implicit preference matches: +1.5 each
    - Keyword matches in title/description: +0.75 per token (max 4 tokens)

### Product Card Rendering
- **File**: `src/lib/llm/orchestrator/cards.ts`
  - `buildProductCard()` - Creates `ProductCard` object
  - **Required fields**: `id`, `title`, `priceCents`, `currency`, `keyAttributes[]`, `reason`, `imageUrl`, `productUrl`
  - `keyAttributes` extracted from `attributes` JSON: `['fabric', 'fit', 'length', 'season', 'occasion', 'color']`
  - `reason` generated by `buildCardReason()` (LLM or rule-based)

### Catalog Ingestion System
- **File**: `src/lib/catalog/unifiedSchemaConfig.ts`
  - `UNIFIED_CATALOG_SCHEMA` - Config-driven field definitions with required levels and mappings
  - `getFieldDefinition()` - Lookup field by name
  - `getFieldsByGroup()` - Get fields by group (identity, classification, commercial, etc.)
- **File**: `src/lib/catalog/types.ts`
  - `UnifiedVendorCatalogRow` - Type for normalized CSV row
  - `CatalogValidationIssue` - Error/warning with level, field, message, rowIndex
  - `DatasetCoreStats` - Coverage stats (rows with price, images, descriptions, etc.)
  - `IngestionSummary` - Final ingestion result with metrics, issues, stats, and dataset context
- **File**: `src/lib/catalog/validation.ts`
  - `normalizeUnifiedRow()` - Normalizes raw CSV row (trim, lowercase, parse pipe-lists)
  - `validateUnifiedRow()` - Validates row against schema (hard requirements, warnings)
  - `updateDatasetCoreStats()` - Accumulates coverage statistics
- **File**: `src/lib/catalog/ingestUnifiedCsv.ts`
  - `parseUnifiedCsv()` - Async generator for streaming CSV parsing
  - `upsertProductFromUnifiedRow()` - Maps unified row to Prisma `Product` model
  - `ingestUnifiedCsvStream()` - Orchestrates ingestion with validation and context inference
- **File**: `src/lib/catalog/datasetInspector.ts`
  - `inferDatasetContextFromRows()` - LLM-powered dataset context inference
  - `buildSampleView()` - Creates compact JSON view of sample rows for LLM
  - Returns `DatasetContext` with vertical, currency, facets, search examples, quality notes
- **File**: `src/app/api/admin/catalog/upload/route.ts`
  - `POST()` - Handles CSV file upload, triggers ingestion
  - Accepts: `file`, `vendorId`, optional `vertical`, `currency`, `enableContextInference`
  - Returns: `IngestionSummary` with truncated issues (first 100)
- **File**: `src/app/admin/catalog/page.tsx`
  - Admin UI for catalog upload with form, progress, and results display
  - Shows summary metrics, data coverage, validation issues table, and dataset context card

---

## Step-by-Step Execution Trace

### Catalog Ingestion Flow

#### 1. Admin Uploads CSV (`POST /api/admin/catalog/upload`)
**Inputs**:
- `file: File` (CSV file)
- `vendorId: string`
- `vertical?: string` (optional admin hint)
- `currency?: string` (optional admin hint)
- `enableContextInference?: boolean` (defaults to `true`)

**Process**:
1. Validates file is CSV
2. Converts `File` to Node.js `ReadableStream`
3. Calls `ingestUnifiedCsvStream(stream, vendorId, options)`
4. Truncates issues to first 100 for response
5. Returns `IngestionSummary` JSON

**Logs**: `Starting catalog ingestion` (INFO), `dataset_context_inferred` (INFO)

**Outputs**: `IngestionSummary` with `totalRows`, `inserted`, `updated`, `invalidRows`, `issues[]`, `coreStats`, `datasetContext?`

---

#### 2. Streaming CSV Parse (`parseUnifiedCsv()`)
**File**: `src/lib/catalog/ingestUnifiedCsv.ts`

**Process**:
1. Creates CSV parser with `csv-parse` library
2. Validates header row matches expected columns (case-insensitive)
3. Yields rows one-by-one as async generator:
   - `{ rowIndex, normalized: UnifiedVendorCatalogRow, validation: CatalogRowValidationResult }`
4. Normalizes each row: trims strings, parses pipe-delimited lists, handles empty values
5. Validates each row against `UNIFIED_CATALOG_SCHEMA`

**Outputs**: Async generator yielding normalized rows with validation results

---

#### 3. Row Validation (`validateUnifiedRow()`)
**File**: `src/lib/catalog/validation.ts`

**Process**:
1. Checks hard requirements:
   - `product_id` must be present and non-empty
   - `title` OR `short_title` must be present
   - `product_url` must be present
2. Generates warnings for recommended fields:
   - `price` recommended if `currency` present
   - `image_url_primary` recommended for visual catalogs
   - `category` recommended if classification missing
3. Updates `DatasetCoreStats`:
   - Tracks rows with core identity, price, images, descriptions, categories, brands
4. Returns `CatalogRowValidationResult` with `isValid`, `errors[]`, `warnings[]`

**Outputs**: Validation result with errors and warnings

---

#### 4. Product Upsert (`upsertProductFromUnifiedRow()`)
**File**: `src/lib/catalog/ingestUnifiedCsv.ts`

**Process**:
1. Generates product ID: `{vendorId}_{product_id}`
2. Maps unified row to Prisma `Product` model:
   - Core fields: `title`, `description`, `imageUrl`, `productUrl`, `category`, `subcategory`, `brand`
   - Price: Parses `price` string to `priceCents` (handles "$19.99", "19.99 USD", etc.)
   - Stock: Normalizes `stock_status` to `'in_stock' | 'low_stock' | 'out_of_stock'`
   - Attributes: Parses `attribute_blob` (pipe-delimited `key:value` pairs) into JSON
   - Extensible: Unknown columns stored in `attributes.extensible`
3. Upserts to database using `prisma.product.upsert()`:
   - `where: { id: generatedId }`
   - `update: { ...mappedFields }`
   - `create: { ...mappedFields }`
4. Returns `{ created: boolean }`

**Outputs**: Upsert result indicating if product was created or updated

---

#### 5. Dataset Context Inference (`inferDatasetContextFromRows()`)
**File**: `src/lib/catalog/datasetInspector.ts`

**Trigger**: After processing first 200 rows (if `enableContextInference=true`)

**Process**:
1. Collects up to 50 sample rows from first 200 processed (only valid rows)
2. Builds compact JSON view of sample rows via `buildSampleView()`:
   - Extracts key fields: `product_id`, `title`, `category`, `price`, `currency`, `description`, `image_url_primary`
   - Limits to essential data for LLM prompt
3. Calls LLM with primary model (`purpose: 'intent'`):
   - System prompt: Instructs LLM to infer dataset characteristics
   - User prompt: Sample rows JSON + current stats
   - JSON schema: Enforces `DatasetContext` structure
4. Parses LLM response using `safeParseLlmJson()`
5. Applies admin hints (if provided):
   - `adminHints.vertical` overrides LLM `vertical`
   - `adminHints.currency` overrides LLM `dominantPriceCurrency`
6. Returns `DatasetContext`:
   - `vertical?: string` (e.g., "apparel", "furniture", "skincare")
   - `dominantPriceCurrency?: string` (e.g., "USD", "EUR")
   - `hasPriceData: boolean`
   - `hasImages: boolean`
   - `sampleCategories: string[]`
   - `primaryFacets: string[]` (e.g., ["size", "color", "fit"])
   - `recommendedSearchExamples: string[]` (e.g., ["show me casual t-shirts"])
   - `qualityNotes: string[]`

**Error Handling**:
- If LLM fails: Returns fallback context with basic stats and quality notes
- Ingestion continues even if context inference fails (non-blocking)

**Logs**: `dataset_context_inferred` (INFO) with key metrics

**Outputs**: `DatasetContext` added to `IngestionSummary`

---

#### 6. Ingestion Summary Generation
**File**: `src/lib/catalog/ingestUnifiedCsv.ts` → `ingestUnifiedCsvStream()`

**Process**:
1. Accumulates stats during ingestion:
   - `totalRows`: Total rows processed
   - `inserted`: New products created
   - `updated`: Existing products updated
   - `invalidRows`: Rows with hard validation errors
   - `issues[]`: All errors and warnings (truncated to 100 in API response)
   - `coreStats`: Coverage statistics
2. Calls `inferDatasetContextFromRows()` after processing (non-blocking)
3. Returns `IngestionSummary` with all metrics and context

**Outputs**: Complete ingestion summary

---

### Single Request Flow (Assistant Query)

#### 1. API Entrypoint (`POST /api/assistant`)
**Inputs**:
- `sessionId: string`
- `pageType: 'HOME' | 'PLP' | 'PDP'`
- `message: string` (user's text)
- `history?: Array<{role, content}>` (last 5 messages)
- `pendingSuggestion?: {constraints, candidateIds}`
- `conversationContext?: ConversationContext`

**Logs**: `assistant_api_request` (INFO)

**Outputs**: Passes to `handleAssistantQuery()`

---

#### 2. Main Orchestrator (`handleAssistantQuery()`)
**File**: `src/lib/llm/orchestrator/index.ts`

**Flow**:
- If `pendingSuggestion` exists:
  - Calls `callVelouRouter()` (LLM) to decide: confirm vs override vs refine
  - If `confirm_pending_suggestion` AND `followUpType === 'CONFIRM_SUGGESTION'`:
    - Calls `runPendingSuggestionFlow()` → returns early
  - If `override_search` or `refine_search`:
    - Builds `routerConstraints` from router result
    - Merges with `conversationContext.lastConstraints` if `keep_previous_constraints=true`
    - Falls through to normal LLM flow

- Normal flow (no pending suggestion or override):
  - Calls `inferIntentAndConstraints()`

**Logs**: `handleAssistantQuery start` (DEBUG), `velou_router_result` (DEBUG), `pending_suggestion_confirmed` (DEBUG)

---

#### 3. Context Gatekeeper (`callContextGatekeeper()`)
**File**: `src/lib/llm/orchestrator/intent.ts`

**Inputs**:
- `currentMessage: string`
- `previousUserMessages: string[]` (last 5)
- `previousConstraints: SearchConstraints | null`
- `pageType`, `productContextId`

**Process**:
- LLM call with `CONTEXT_GATEKEEPER_PROMPT` (or rule-based fallback)
- Decides: `threadType: 'follow_up' | 'new_search'`
- Returns: `shouldUsePreviousContext: boolean`, `standaloneQuery: string`, `constraintsDelta: Partial<SearchConstraints>`

**Logs**: `context_gatekeeper_result` (DEBUG)

**Outputs**: `ContextGatekeeperResult` passed to `inferIntentAndConstraintsWithLlm()`

---

#### 4. Intent & Constraint Extraction (`inferIntentAndConstraints()`)
**File**: `src/lib/llm/orchestrator/intent.ts`

**Inputs**:
- `message: string`
- `pageType`, `productContextId`
- `conversationContext?: ConversationContext`
- `history?: Array<{role, content}>`

**Process**:
1. Extracts `previousConstraints` from `conversationContext?.lastConstraints`
2. Extracts `previousUserMessages` from history (last 5 user messages)
3. Calls `callContextGatekeeper()` → gets `gatekeeperResult`
4. Sets `effectivePreviousConstraints = shouldUsePreviousContext ? previousConstraints : null`
5. Calls `detectFollowUpType()` → gets `followUpDetection`
6. Calls `inferIntentAndConstraintsWithLlm()` with:
   - `previousConstraints: effectivePreviousConstraints`
   - `isFollowUp: shouldUsePreviousContext`
   - `standaloneQuery: gatekeeperResult.standaloneQuery`
   - `constraintsDelta: gatekeeperResult.constraintsDelta`
7. LLM returns JSON with `intent`, `contextAction`, `constraints`, `query`
8. **Normalization**:
   - Converts `null` → `undefined` for `priceMinCents`/`priceMaxCents`
   - Calls `normalizeConstraintArrays()` → coerces arrays
   - Calls `normalizeConstraintValues()` → removes empty strings, nulls, 0s
9. **Category Canonicalization** (Fix A):
   - Calls `normalizeCategoryFromMessage()` → deterministic synonym mapping
   - Updates `constraints.category` if normalized differs
10. **Hard Text Filters** (Fix C):
    - If category still missing, calls `extractHardTextFilterKeywords()`
    - Stores in `(constraints as any).hardTextFilters`
11. **Merging** (if `usedFollowUpContext`):
    - If `followUpType === 'SWITCH'`: calls `mergeConstraints()` with `contextAction='override'`
    - If `followUpType === 'REFINE'`: calls `mergeConstraints()` with `contextAction='carry'`
    - Else: calls `mergeConstraints()` with `contextAction` from LLM
12. **Ontology Mapping**:
    - Calls `applyOntologyToConstraints()` → fuzzy matches to valid ontology terms
    - Drops invalid terms, adds to `query` text

**Logs**: `inferIntentAndConstraintsWithLlm` (DEBUG), `normalizeCategoryFromMessage` (DEBUG), `extractHardTextFilterKeywords` (DEBUG), `mergeConstraints` (DEBUG)

**Outputs**: `IntentResolution & {usedFollowUpContext: boolean}` with normalized `constraints`

---

#### 5. Discovery Flow (`runDiscoveryFlow()`)
**File**: `src/lib/llm/orchestrator/index.ts`

**Inputs**:
- `constraints: SearchConstraints`
- `userMessage: string`
- `intent: AssistantIntent`

**Process**:
1. Checks `shouldShowCards()` → if false, returns clarifying reply
2. Extracts `hardTextFilters` from constraints (if category missing)
3. Sets `strictLimit = Math.max(constraints.limit ?? 4, 3)`
4. Calls `searchProductsRelaxed(constraintsWithHardFilters, strictLimit, userMessage)`
5. If `candidates.length === 0`:
   - Returns "no products" reply with `noExactMatch: true`
6. **Scoring**:
   - Calls `inferImplicitPreferences(userMessage)` → extracts implicit prefs
   - Calls `tokenize(userMessage)` → extracts query tokens
   - Calls `evaluateProductFit()` for each candidate → scores + facts
   - Sorts by score (desc), then price (asc)
   - Takes top `strictLimit`
7. **Card Building**:
   - Calls `buildProductCard()` for each top candidate
   - Calls `buildCardReason()` (LLM or rule-based) for each
   - Calls `buildQueryChips()` for constraint labels
8. **Pending Suggestion Logic**:
   - If `wasRelaxed && hasManyCandidates (>=8) && !categoryWasDropped`:
     - Creates `pendingSuggestion` with `candidateIds` and `summary`
     - Returns reply asking for confirmation, `productCards: []`, `noExactMatch: true`
   - Else:
     - Returns reply with `productCards`, `noExactMatch: wasRelaxed`

**Logs**: `runDiscoveryFlow start` (DEBUG), `runDiscoveryFlow hardTextFilters` (DEBUG), `runDiscoveryFlow no products found` (WARN)

**Outputs**: `AssistantQueryResult` with `replyText`, `productCards[]`, `noExactMatch`, optional `pendingSuggestion`

---

#### 6. Search Products (`searchProducts()`)
**File**: `src/lib/search/index.ts`

**Inputs**:
- `constraints: SearchConstraints`
- `userMessage?: string`

**Process**:
1. Calls `buildMerchContext()` → loads `MerchRule` records (excluded categories, boosts, hide out of stock)
2. Calls `buildBroadWhereFilters(constraints, merchContext, userMessage)`:
   - Canonicalizes category via `canonicalizeCategory(userMessage || constraints.category)`
   - If canonical found: builds `categoryOr` array with expanded leaf categories, GPC terms, product type synonyms
   - Extracts `keywordFilters` from synonym terms (top 10)
   - Converts `null` → `undefined` for price fields
3. Calculates `dynamicTake = calculateDynamicTake(constraints, limit, keywordFilters)`:
   - Base: `limit * 50` (min 300, max 2500)
   - If broad query (no category/brand/price) OR has hard text filters: `take = max(1500, take)`
4. Calls `dbRankedSearch(broadFilters, constraints.query, boostByCategory, dynamicTake, keywordFilters)`:
   - **If `ENABLE_RAW_RANKED_SEARCH=true`**:
     - Builds raw SQL with `Prisma.sql`
     - WHERE: stock status, category (OR conditions), keyword filters (LIKE), price, brands, exclusions
     - Ranking: `ts_rank_cd(search_vector, ...) * 5.0` + category boosts + recency
     - ORDER BY: rank DESC, updatedAt DESC
     - LIMIT: `take`
     - Falls back to Prisma on error
   - **Else (default)**:
     - Builds `Prisma.ProductWhereInput`
     - Category: `categoryOr` → `OR: [{category: {contains: ...}}]` OR exact match
     - Keyword filters: `AND: [{OR: [{title: {contains}}, {description: {contains}}, {category: {contains}}]}]`
     - Text search: splits `queryText` into words (length >= 3), adds to `OR` conditions
     - ORDER BY: `updatedAt DESC, createdAt DESC`
     - Returns with `rank: 0` (dummy)
5. **In-memory attribute filtering**:
   - Filters `dbCandidates` via `matchesAttributeFilters(attrs, constraints, categoryOr)`
   - Checks: colors, fabrics, materials, fit, seasons, occasions, sizes, useCases, productTypes, googleCategories, etc.
   - Also checks `categoryOr` against JSON `attributes.googleProductCategory` and `attributes.productType`
6. **Widening tiers** (if `filtered.length < limit`):
   - Calls `buildWideningTiers()` → generates tiers:
     - Tier 1: Drop category, keep price/brand/stock + keywordFilters
     - Tier 2: Drop brand, keep price/stock + keywordFilters
     - Tier 3: Drop price, keep stock + keywordFilters
     - Tier 4: Stock only
   - For each tier:
     - Calls `dbRankedSearch()` with relaxed filters
     - Filters by `matchesAttributeFilters()`
     - If `tierFiltered.length > filtered.length`: uses tier results, sets `wasRelaxed=true`, breaks
   - If still no results and `dbCandidates.length > 0`:
     - Uses `dbCandidates` directly (no attribute filtering), sets `wasRelaxed=true`
7. **Final scoring** (if `wasRelaxed`):
   - Base score: `merchContext.boostByCategory.get(category) ?? 0`
   - DB rank: `product.rank ?? 0`
   - Attribute score: +0.3 per matching color/fabric/material, +0.2 per occasion/season/fit
   - Sorts by score (desc), then `updatedAt` (desc)
8. Returns top `limit` products

**Logs**: `searchProducts constraints` (DEBUG), `searchProducts canonicalCategory` (DEBUG), `searchProducts dbRankedSearch` (DEBUG), `searchProducts afterAttributeFilter` (DEBUG), `searchProducts widened` (DEBUG), `searchProducts relaxed` (DEBUG), `searchProducts return` (DEBUG)

**Outputs**: `ProductSearchResult` with `products: SearchResultItem[]`, `wasRelaxed: boolean`

---

#### 7. Search Products Relaxed (`searchProductsRelaxed()`)
**File**: `src/lib/search/index.ts`

**Inputs**:
- `constraints: SearchConstraints`
- `limit: number`
- `userMessage?: string`

**Process**:
1. Calls `searchProducts(constraints, userMessage)` → gets `strictResult`
2. If `strictResult.products.length > 0`: returns early with `wasRelaxed: false`
3. **Relaxation steps** (in order):
   - Step 1: `dropAttributeFilters()` → removes colors, fabrics, materials, sizes, occasions, seasons, useCases, etc.
   - Step 2: `keepOnlyCategoryAndPrice()` → keeps only category, price, query, inStockOnly
   - Step 3: `keepOnlyQuery()` → keeps only query, inStockOnly
4. For each step:
   - Calls `searchProducts(relaxedConstraints, userMessage)`
   - If results found: returns with `wasRelaxed: true`
5. If all steps fail: returns empty `candidates[]` with `wasRelaxed: true`

**Outputs**: `RelaxedSearchResult` with `candidates: SearchResultItem[]`, `relaxedConstraints: SearchConstraints`, `wasRelaxed: boolean`

---

#### 8. Product Card Building (`buildProductCard()`)
**File**: `src/lib/llm/orchestrator/cards.ts`

**Inputs**:
- `item: SearchResultItem`
- `options?: {reason?: string, queryChips?: QueryChip[]}`

**Process**:
1. Extracts `keyAttributes` from `item.attributes`:
   - Order: `['fabric', 'fit', 'length', 'season', 'occasion', 'color']`
   - Format: `"fabric: cotton"`, `"fit: relaxed"`, etc.
   - Takes first 5 non-empty
2. Uses `reason` from options, or generates default:
   - `"Chosen because the {fabric} {fit} fit {occasion} feel right for {occasion}."`
3. Returns `ProductCard` object

**Outputs**: `ProductCard` with all required fields

---

#### 9. API Response
**File**: `src/app/api/assistant/route.ts`

**Process**:
1. Receives `AssistantQueryResult` from `handleAssistantQuery()`
2. Calls `recordConversationEvent()`:
   - Stores to `ConversationEvent` table
   - `hadExactMatch = !result.noExactMatch`
   - `productIds = result.productCards.map(card => card.id)`
3. Returns JSON response

**Logs**: `assistant_api_response` (INFO), `assistant_api_error` (ERROR)

**Outputs**: JSON with `replyText`, `productCards[]`, `noExactMatch`, optional `pendingSuggestion`

---

### Constraint Object End-to-End

**Type**: `SearchConstraints` (from `src/lib/search/types.ts`)

```typescript
{
  query?: string;                    // Soft-scoring text query
  category?: string;                  // Exact taxonomy category (e.g., "t shirt", "skirts")
  priceMinCents?: number;            // Minimum price in cents (undefined, not null)
  priceMaxCents?: number;            // Maximum price in cents (undefined, not null)
  colors?: string[];                 // Array of color strings
  sizes?: string[];                  // Array of size strings (e.g., ["M", "L"])
  fabrics?: string[];                // Array of fabric strings
  fit?: string;                      // Single fit value (e.g., "relaxed", "slim")
  seasons?: string[];                // Array of season strings
  occasions?: string[];               // Array of occasion strings
  useCases?: string[];               // Array of use case strings
  brands?: string[];                 // Array of brand strings
  genders?: string[];                // Array: ["mens", "womens", "unisex"]
  materials?: string[];               // Array of material strings
  productTypes?: string[];           // Array of product type strings
  googleCategories?: string[];      // Array of Google Product Category strings
  customLabels4?: string[];          // Array of custom label 4 strings
  conditions?: string[];             // Array of condition strings
  ageGroups?: string[];              // Array of age group strings
  inStockOnly?: boolean;             // Default: true
  excludeProductIds?: string[];      // Array of product IDs to exclude
  limit?: number;                    // Result limit (default: 8)
}
```

**Defaulting Rules**:
- **LLM returns `null`** for missing optional fields (per JSON schema)
- **Normalization converts**:
  - `null` → `undefined` for `priceMinCents`, `priceMaxCents`, `category`, `fit`
  - `0` → `undefined` for price fields
  - Empty strings `""` → `undefined` for scalar fields
  - Empty arrays `[]` → `undefined` for array fields
  - Arrays with empty strings filtered out
- **Prisma requires `undefined`** (omit field), not `null` (would throw validation error)
- **Default values**:
  - `inStockOnly: true` (if not specified)
  - `limit: 8` (if not specified)

**State Storage**:
- **Client-side**: `ConversationContext` in React state (`ChatPanel.tsx`)
  - Persisted to localStorage
  - Cleared on page refresh
- **Server-side**: `ConversationEvent` table (read-only, for metrics)
  - Stores: `sessionId`, `userQuery`, `productIds`, `hadExactMatch`, `clickedProductId`
  - Not used for context retrieval (context is client-managed)

---

## Category Canonicalization Logic

### Two-Stage Process

#### Stage 1: Pre-LLM Deterministic Mapping
**File**: `src/lib/llm/orchestrator/utils.ts`
- Function: `normalizeCategoryFromMessage(message, llmCategory, ontology)`
- Uses: `CATEGORY_SYNONYM_MAP` (hard-coded dictionary)
- Process:
  1. If LLM already returned valid category (exists in ontology): use it
  2. Otherwise, scan message for synonym matches using word boundaries
  3. Map synonym → category (e.g., "tshirt" → "t shirt")
  4. Verify mapped category exists in ontology (fuzzy match)
  5. Return normalized category or original LLM category

**Example**: "just tees" → synonym "tee" → maps to "t shirt" → verified in ontology → returns "t shirt"

#### Stage 2: Post-LLM Canonical Expansion
**File**: `src/lib/search/canonicalize.ts`
- Function: `canonicalizeCategory(userText, ontology)`
- Process:
  1. Normalizes user text to lowercase
  2. Checks each `CanonicalCategory` enum value (TSHIRT, SKIRT, JEANS, etc.)
  3. For each canonical, checks `synonyms[]` array for matches
  4. Uses word boundary regex for exact matches (confidence 0.7-0.9)
  5. Uses substring matching for partial matches (confidence 0.5)
  6. Returns best match with highest confidence
  7. If ontology provided, boosts confidence if DB has matching category

**Example**: "graphic tee" → matches "graphic tee" in TSHIRT.synonyms → returns `{canonical: 'TSHIRT', confidence: 0.9}`

### Synonym Expansion for Search
**File**: `src/lib/search/index.ts` → `buildBroadWhereFilters()`

When canonical category found:
1. Gets `expandedLeafCats` via `getExpandedLeafCategories(canonical, ontology)`
   - Returns: `['t shirt', 'graphic t shirt', 'short sleeve shirt', ...]`
2. Gets `gpcTerms` via `getParentGpcTerms(canonical)`
   - Returns: `['Shirts & Tops', 'Apparel & Accessories > Clothing > Shirts & Tops']`
3. Gets `synonymTerms` via `getSynonymTerms(canonical)`
   - Returns: `['tshirt', 't-shirt', 'tee', 'graphic tee', 'tank']`
4. Builds `categoryOr` array:
   - `{category: "t shirt"}`, `{category: "graphic t shirt"}`, etc. (for DB category field)
   - `{googleCategory: "Shirts & Tops"}` (for JSON attributes)
   - `{productType: "tshirt"}` (for JSON attributes)
5. Stores `keywordFilters = synonymTerms.slice(0, 10)` for SQL text matching

### Query Text Keyword Extraction
**File**: `src/lib/search/index.ts` → `dbRankedSearch()` (Prisma fallback)

When `queryText` exists but no `keywordFilters`:
1. Splits `queryText` by whitespace/punctuation
2. Filters: length >= 3, not stopwords (`['the', 'and', 'for', 'you', 'with', 'that', 'this']`)
3. Takes first 5 words
4. Builds Prisma `OR` conditions:
   - `{title: {contains: word, mode: 'insensitive'}}`
   - `{description: {contains: word, mode: 'insensitive'}}`

---

## Search Tiers / Widening Strategy

### What Counts as "Strict"

**Strict search** = all constraints applied:
- Category: exact match OR `categoryOr` conditions
- Price: `priceMinCents` AND `priceMaxCents` (if specified)
- Brand: exact match in `brands[]`
- Stock: `in_stock` OR `low_stock` (if `inStockOnly=true`)
- Attributes: all specified attributes match JSON `attributes` field
- Exclusions: `excludeProductIds`, `excludedCategories`

### Widening Tiers (in `searchProducts()`)

**Trigger**: `filtered.length < limit` after strict search + attribute filtering

**Tier 1: Drop Category, Keep Price/Brand/Stock**
- Removes: `category`, `categoryOr`
- Keeps: `priceMinCents`, `priceMaxCents`, `brands`, `stockStatus`, `keywordFilters`
- Take: `MAX_TAKE` (2500)
- Description: `'drop_category'`

**Tier 2: Drop Brand, Keep Price/Stock**
- Removes: `category`, `categoryOr`, `brands`
- Keeps: `priceMinCents`, `priceMaxCents`, `stockStatus`, `keywordFilters`
- Take: `MAX_TAKE` (2500)
- Description: `'drop_brand'`

**Tier 3: Drop Price, Keep Stock**
- Removes: `category`, `categoryOr`, `brands`, `priceMinCents`, `priceMaxCents`
- Keeps: `stockStatus`, `keywordFilters`
- Take: `MAX_TAKE` (2500)
- Description: `'drop_price'`

**Tier 4: Stock Only**
- Removes: everything except `stockStatus`, `excludedCategories`, `excludeProductIds`
- Keeps: `keywordFilters` (if present)
- Take: `MAX_TAKE` (2500)
- Description: `'stock_only'`

**Final Fallback**: If all tiers yield 0 results but `dbCandidates.length > 0`:
- Uses `dbCandidates` directly (no attribute filtering)
- Sets `wasRelaxed: true`

### Constraint Relaxation (in `searchProductsRelaxed()`)

**Trigger**: `searchProducts()` returns 0 products

**Step 1: Drop Attribute Filters**
- Removes: `colors`, `fabrics`, `materials`, `sizes`, `occasions`, `seasons`, `useCases`, `productTypes`, `googleCategories`, `customLabels4`, `conditions`, `ageGroups`, `genders`, `brands`, `fit`
- Keeps: `category`, `priceMinCents`, `priceMaxCents`, `query`, `inStockOnly`

**Step 2: Keep Only Category and Price**
- Removes: all attributes, `query`
- Keeps: `category`, `priceMinCents`, `priceMaxCents`, `inStockOnly`

**Step 3: Keep Only Query**
- Removes: `category`, `priceMinCents`, `priceMaxCents`, all attributes
- Keeps: `query`, `inStockOnly`

**Note**: `keywordFilters` are preserved through all tiers (Fix F)

### Adaptive Take Logic

**Function**: `calculateDynamicTake(constraints, limit, hardTextFilters)`

**Base calculation**:
- `base = limit * 50` (e.g., limit=8 → base=400)
- `take = Math.max(base, MIN_TAKE)` where `MIN_TAKE = 300`
- `take = Math.min(take, MAX_TAKE)` where `MAX_TAKE = 2500`

**Broad query detection**:
```typescript
const isBroadQuery =
  !constraints.category &&
  !constraints.brands?.length &&
  !constraints.priceMinCents &&
  !constraints.priceMaxCents &&
  (!constraints.query || constraints.query.trim().length < 10);
```

**Take increase**:
- If `isBroadQuery` OR `needsWiderSearch` (category missing OR has hard text filters):
  - `take = Math.min(MAX_TAKE, Math.max(take, 1500))` (at least 1500)
- Else (specific category):
  - `take = Math.min(take, MAX_TAKE)` (capped at 2500)

**Rationale**: Broad queries need larger slices to ensure recall across ~13k catalog. Specific categories can use tighter takes.

---

## Ranking and Scoring Rules

### Database-Level Ranking (if `ENABLE_RAW_RANKED_SEARCH=true`)

**SQL Query** (from `dbRankedSearch()`):
```sql
SELECT 
  *,
  (
    COALESCE(ts_rank_cd("search_vector", plainto_tsquery('english', $queryText)), 0) * 5.0 +
    (CASE WHEN "category" = $cat1 THEN $weight1 ELSE 0 END) + ... +
    EXTRACT(EPOCH FROM ("updatedAt" - NOW())) / -86400.0 * 0.1
  ) AS rank
FROM "Product"
WHERE [filters]
ORDER BY rank DESC, "updatedAt" DESC
LIMIT $take
```

**Ranking components**:
1. **Full-text search**: `ts_rank_cd(search_vector, query) * 5.0`
   - Weight: 5.0x
   - Requires: `search_vector` tsvector column (migration needed)
   - Default: disabled (feature flag)
2. **Category boost**: `CASE WHEN category = X THEN weight ELSE 0 END`
   - Weight: from `MerchRule.boost_category` (default: 1)
   - Summed across all boosted categories
3. **Recency boost**: `EXTRACT(EPOCH FROM (updatedAt - NOW())) / -86400.0 * 0.1`
   - Weight: 0.1x per day (newer = higher)
   - Formula: `(seconds_since_now / -86400) * 0.1` (negative because newer = less negative)

**Indexes** (from `prisma/schema.prisma`):
- `@@index([category])` - B-tree index
- `@@index([stockStatus])` - B-tree index
- `search_vector` GIN index (if migration run)

### Prisma Fallback Ranking (default)

**Query** (from `dbRankedSearch()` fallback):
```typescript
prisma.product.findMany({
  where: { /* filters */ },
  orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  take: take,
})
```

**Ranking**: Recency only (`updatedAt DESC, createdAt DESC`)
- No full-text search ranking
- No category boost (applied in-memory later)
- Returns `rank: 0` (dummy value)

**Text search**: ILIKE OR conditions on `title`, `description`, `category`
- Keywords from `keywordFilters` OR `queryText` split into words
- Case-insensitive matching

### In-Memory Scoring (in `searchProducts()`)

**Applied after** database fetch + attribute filtering

**Base score**:
- `merchContext.boostByCategory.get(product.category) ?? 0`
- From `MerchRule.boost_category` records

**DB rank**:
- `product.rank ?? 0` (from raw SQL, or 0 if Prisma fallback)

**Attribute score** (only if `wasRelaxed === true`):
- Color match: +0.3
- Fabric match: +0.3
- Material match: +0.3
- Occasion match: +0.2
- Season match: +0.2
- Fit match: +0.2

**Final sort**:
1. By `score` (descending): `baseScore + dbRank + attributeScore`
2. By `updatedAt` (descending): tie-breaker

### Card-Level Scoring (in `evaluateProductFit()`)

**Applied in** `runDiscoveryFlow()` after `searchProductsRelaxed()`

**Scoring weights**:
- Category match: +3
- Price within budget: +2 (else -2)
- Attribute match (color/fabric/material/season/occasion/useCase/size): +1.5 each
- Implicit preference match (fabric/material/season/fit/useCase/category): +1.5 each
- Fit match: +1.5
- Keyword matches in title/description: +0.75 per token (max 4 tokens = +3.0)

**Sort**:
1. By `score` (descending)
2. By `priceCents` (ascending): tie-breaker

---

## Follow-Up / Context Retention Logic

### ThreadType Decision (`callContextGatekeeper()`)

**LLM-based** (default):
- Prompt: `CONTEXT_GATEKEEPER_PROMPT`
- Inputs: `currentMessage`, `previousUserMessages[]`, `previousConstraints`, `pageType`, `productContextId`
- Outputs: `threadType: 'follow_up' | 'new_search'`

**Rule-based fallback** (if LLM fails or `LLM_PROVIDER=mock`):
```typescript
const isFollowUp = Boolean(
  previousConstraints &&
  isFollowUpMessage(currentMessage) &&
  !looksLikeNewQuery(currentMessage)
);
```

**Heuristics**:
- `isFollowUpMessage()`: word count <= 6, starts with refinement prefixes, contains comparative keywords
- `looksLikeNewQuery()`: contains new query keywords (`['new search', 'something else', 'different item']`)

### ContextAction Values

**From LLM** (`inferIntentAndConstraintsWithLlm()`):
- `"carry"` - Merge with previous constraints (default)
- `"override"` - Drop incompatible constraints when category changes
- `"reset"` - Start fresh, ignore previous constraints

**Hard rules** (in `mergeConstraints()`):
- If message contains `/\b(only|just|instead|show me|switch to|not that|forget previous|reset)\b/i`:
  - Treated as `override` (even if LLM said `carry`)

### Follow-Up Detection (`detectFollowUpType()`)

**Heuristic-based** (no LLM call)

**SWITCH detection**:
- Patterns: `/\b(only|just|instead|show me|switch to|not that|forget previous|reset)\s+([a-z\s]+)/i`
- If category extracted after switch keyword: `followUpType = 'SWITCH'`, `overrideCategory = canonical`
- If new category detected and different from previous: `followUpType = 'SWITCH'`
- `carryOver.vibe = false`, `carryOver.hardFilters = false` (drops all)

**REFINE detection**:
- Patterns: `/\b(black|white|red|...)\s+(ones?|those|them)\b/i`, `/\b(cheaper|smaller|bigger)\b/i`, `/\b(ones?|those|them|like that|same style)\b/i`
- `followUpType = 'REFINE'`
- `carryOver.vibe = true`, `carryOver.hardFilters = true` (keeps all)

**CONFIRM_SUGGESTION detection**:
- Only if `hasPendingSuggestion === true`
- Patterns: `/\b(yes|yeah|ok|okay|sure|go ahead|show me|show them|that works|more like that|continue)\b/i`
- Only if NO new category noun present
- `followUpType = 'CONFIRM_SUGGESTION'`
- `carryOver.vibe = true`, `carryOver.hardFilters = true`

**UNKNOWN** (default):
- `isFollowUp = false`
- `carryOver.vibe = false`, `carryOver.hardFilters = false`

### Truth Table / Heuristic Rules

| User Message Pattern | threadType | contextAction | followUpType | Constraint Merging |
|----------------------|------------|---------------|--------------|-------------------|
| "only tshirts" | new_search | override | SWITCH | Drop all previous, set category=tshirts |
| "just tees" | new_search | override | SWITCH | Drop all previous, set category=t shirt |
| "black ones" | follow_up | carry | REFINE | Keep category, add color=black |
| "cheaper" | follow_up | carry | REFINE | Keep all, add priceMaxCents |
| "yes show me" (pending exists) | follow_up | carry | CONFIRM_SUGGESTION | Use pending suggestion constraints |
| "show me skirts instead" | new_search | override | SWITCH | Drop all previous, set category=skirts |
| "smart casual outfit" (first message) | new_search | reset | UNKNOWN | Start fresh |

### Context Survival

**Client-side state** (`ConversationContext`):
- Stored in React state (`ChatPanel.tsx`)
- Persisted to localStorage (key: `velou_chat_history`)
- **Lifetime**: Per browser session, cleared on page refresh
- **Fields**:
  - `lastIntent`: Last intent (`'discovery' | 'pdp_suitability'`)
  - `lastConstraints`: Last resolved `SearchConstraints`
  - `lastShownProductIds`: Array of product IDs from last response
  - `lastUserQuery`: Last user message string

**When context is cleared**:
- Page refresh (localStorage persists, but new session = new `sessionId`)
- Explicit reset (user says "new search", "something else")
- `threadType = 'new_search'` from gatekeeper

**When context is used**:
- `threadType = 'follow_up'` from gatekeeper
- `shouldUsePreviousContext = true`
- `effectivePreviousConstraints = previousConstraints` (not null)

---

## noExactMatch + Pending Suggestion Logic

### How `hadExactMatch` and `noExactMatch` are Computed

**In API route** (`src/app/api/assistant/route.ts`):
```typescript
hadExactMatch = !result.noExactMatch
```

**In `runDiscoveryFlow()`**:
- `noExactMatch = wasRelaxed` (if constraints were relaxed, it's not an exact match)
- If `candidates.length === 0`: `noExactMatch = true`
- If pending suggestion created: `noExactMatch = true` (even if products found)

**In `searchProducts()`**:
- `wasRelaxed = true` if:
  - Widening tiers were used (category/brand/price dropped)
  - Attribute filters were dropped (used `dbCandidates` directly)
- `wasRelaxed = false` if strict search + attribute filtering yielded results

### What Triggers `hasPendingSuggestion`

**In `runDiscoveryFlow()`**:
```typescript
const hasManyCandidates = candidates.length >= 8;
const categoryWasDropped = wasRelaxed && constraints.category && !relaxedConstraints.category;

if (!wasRelaxed || !hasManyCandidates || categoryWasDropped) {
  // Show products directly
} else {
  // Create pending suggestion
  pendingSuggestion = {
    constraints: relaxedConstraints,
    candidateIds: candidates.map(item => item.id),
    summary: buildPendingSummary(relaxedConstraints, candidates.length),
  };
  // Return with productCards: [], noExactMatch: true
}
```

**Conditions for pending suggestion**:
1. `wasRelaxed === true` (constraints were relaxed)
2. `candidates.length >= 8` (many candidates found)
3. `categoryWasDropped === false` (category was NOT dropped during relaxation)

**If any condition false**: Products shown directly, no pending suggestion

### What "Pending Suggestions" Are

**Definition**: A set of candidate products that match relaxed constraints, but the user hasn't confirmed they want to see them.

**Structure**:
```typescript
{
  constraints: SearchConstraints,  // Relaxed constraints used
  candidateIds: string[],          // Product IDs (up to 8+)
  summary: string                 // Human-readable summary (e.g., "8 relaxed-fit jeans under $100")
}
```

**Resolution**:
- **Confirm**: User says "yes", "show me", "go ahead" → `runPendingSuggestionFlow()` → shows products
- **Override**: User says "only tshirts" → `followUpType = 'SWITCH'` → runs new discovery, ignores pending
- **Refine**: User says "black ones" → `followUpType = 'REFINE'` → merges constraints, runs discovery

**Gating logic** (in `handleAssistantQuery()`):
- Pending suggestion confirmed ONLY if:
  - `routerResult.action === 'confirm_pending_suggestion'` (from VelouRouter LLM)
  - AND `followUpDetection.followUpType === 'CONFIRM_SUGGESTION'` (from heuristic detector)
- If user includes canonical category noun: always runs discovery, overrides pending

---

## End-to-End Data Flow

### Complete System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CATALOG INGESTION FLOW                       │
└─────────────────────────────────────────────────────────────────┘

1. Admin uploads CSV via /admin/catalog
   ↓
2. POST /api/admin/catalog/upload
   ↓
3. Streaming CSV parse (parseUnifiedCsv)
   ↓
4. For each row:
   ├─ Normalize (trim, parse pipe-lists)
   ├─ Validate (hard requirements, warnings)
   ├─ Update stats (coverage tracking)
   ├─ Upsert to Product table
   └─ Collect samples (first 200 rows)
   ↓
5. Infer dataset context (LLM, non-blocking)
   ↓
6. Return IngestionSummary to admin UI
   ↓
7. Products available in search/assistant

┌─────────────────────────────────────────────────────────────────┐
│                    ASSISTANT QUERY FLOW                         │
└─────────────────────────────────────────────────────────────────┘

1. User sends message via chat UI
   ↓
2. POST /api/assistant
   ↓
3. handleAssistantQuery()
   ├─ Check pending suggestion
   ├─ Infer intent & constraints (LLM)
   └─ Route to discovery/PDP flow
   ↓
4. runDiscoveryFlow()
   ├─ searchProductsRelaxed()
   │  ├─ searchProducts() with widening tiers
   │  ├─ Attribute filtering (JSON attributes)
   │  └─ Scoring & ranking
   ├─ evaluateProductFit() (card-level scoring)
   ├─ buildProductCard() (extract key attributes)
   └─ buildCardReason() (LLM or rule-based)
   ↓
5. Return replyText + productCards[]
   ↓
6. Record ConversationEvent (metrics)
   ↓
7. UI renders cards and reply

┌─────────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                                 │
└─────────────────────────────────────────────────────────────────┘

Product Table (PostgreSQL):
├─ Core fields: id, title, description, category, priceCents, etc.
└─ attributes JSON: Flexible storage for industry-agnostic data
   ├─ Standard attributes: color, fabric, fit, season, occasion, etc.
   └─ Extensible attributes: Unknown fields from vendor CSV

Search Stack:
├─ Filters on DB fields: category, brand, price, stockStatus
├─ Filters on JSON attributes: colors, fabrics, materials, sizes, etc.
└─ Keyword matching: title, description, category (ILIKE)

LLM Integration:
├─ Reasoning model (o3-mini): Intent parsing, PDP suitability analysis
├─ Primary model (gpt-5): Final replies, dataset inspection
├─ Lightweight model (gpt-4.1-mini): Card reasons, keyword expansion

See `docs/llm_model_selection.md` for detailed model selection strategy.
└─ JSON schema enforcement for structured outputs
```

---

## Data Model + Retrieval Fields

### Prisma Schema (`prisma/schema.prisma`)

**Product Model**:
```prisma
model Product {
  id             String      @id
  title          String
  description    String
  imageUrl       String
  priceCents     Int
  currency       String
  category       String      // Indexed: @@index([category])
  subcategory    String?
  brand          String?
  attributes     Json        // JSON field with ProductAttributes
  stockStatus    StockStatus @default(in_stock)  // Indexed: @@index([stockStatus])
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  productUrl     String
  salePriceCents Int?
  // search_vector tsvector   // Added by migration (if run)
}
```

**Indexes**:
- `category` - B-tree index
- `stockStatus` - B-tree index
- `search_vector` - GIN index (if migration run)

### Category Values in Real Data

**From ontology** (`getCatalogOntology()`):
- Scans `Product.category` field (distinct values, limit 80)
- Examples (from prompts): `"t shirt"`, `"shirt"`, `"jeans"`, `"pants"`, `"shorts"`, `"skirts"`, `"dresses"`, `"sweaters"`, `"outerwear"`, `"blazer"`, `"bags"`, `"belts"`, `"hats"`, `"shoes"`

**Leaf categories** (from prompts): `"graphic t shirt"`, `"solid t shirts"`, `"short sleeve shirt"`, `"long sleeve shirt"`, `"sleeveless shirt"`, `"skinny jeans"`, `"straight leg jeans"`, `"bootcut jeans"`, `"wide leg jeans"`, `"mini dress"`, `"midi dress"`, `"maxi dress"`, etc.

### JSON Attributes Structure

**Type**: `ProductAttributes` (from `src/lib/search/types.ts`)

**Example**:
```json
{
  "fabric": "cotton",
  "fit": "relaxed",
  "length": "regular",
  "pattern": "solid",
  "season": "summer",
  "occasion": "casual",
  "color": "navy blue",
  "useCases": ["beach wedding", "casual weekend"],
  "sizes": ["S", "M", "L", "XL"],
  "care": "machine wash",
  "material": "cotton",
  "productType": "graphic tee",
  "googleProductCategory": "Apparel & Accessories > Clothing > Shirts & Tops",
  "customLabel4": "summer collection",
  "condition": "new",
  "ageGroup": "adult",
  "gender": "unisex",
  "brand": "Lucky Brand"
}
```

**Fields used in filtering**:
- `color` - String (matched via `valueMatches()` - substring contains)
- `fabric` - String (matched via `valueMatches()`)
- `material` - String (matched via `valueMatches()`)
- `fit` - String (matched via exact lowercase comparison)
- `season` - String (matched via `valueMatches()`)
- `occasion` - String (matched via `valueMatches()`)
- `sizes` - String[] (matched via `arrayIncludes()` - all constraint sizes must be in product sizes)
- `useCases` - String[] (matched via `arrayIncludes()`)
- `productType` - String (matched via `valueMatches()`)
- `googleProductCategory` - String (matched via `valueMatches()`)
- `customLabel4` - String (matched via `valueMatches()`)
- `condition` - String (matched via `valueMatches()`)
- `ageGroup` - String (matched via `valueMatches()`)
- `gender` - String (matched via `valueMatches()`)
- `brand` - String (matched via `valueMatches()`)

**Note**: All matching is case-insensitive, substring-based (except `fit` which is exact).

---

## Observed Failure Points / Gaps

### 1. Null vs Undefined in Prisma
**Issue**: LLM returns `null` for missing price fields, but Prisma requires `undefined` (omit field).
**Status**: ✅ **FIXED** - `normalizeConstraintValues()` converts `null` → `undefined` for price fields.
**Location**: `src/lib/llm/orchestrator/utils.ts:48-52`, `src/lib/llm/orchestrator/intent.ts:631-640`, `src/lib/search/index.ts:177-178`

### 2. Missing `search_vector` Column
**Issue**: Raw SQL query references `search_vector` tsvector column which doesn't exist (migration not run).
**Status**: ✅ **FIXED** - Feature-flagged with `ENABLE_RAW_RANKED_SEARCH` env var (defaults to `false`).
**Location**: `src/lib/search/index.ts:416, 453`
**Fallback**: Prisma ILIKE OR conditions (no full-text ranking).

### 3. Synonym Gaps from Real Catalog Terms
**Issue**: Canonical synonyms may not match actual product titles (e.g., "tee" vs "graphic tee" vs "crewneck tee").
**Status**: ⚠️ **PARTIALLY ADDRESSED** - Expanded synonym dictionary in `canonicalize.ts`, but may still miss edge cases.
**Location**: `src/lib/search/canonicalize.ts` (TSHIRT synonyms expanded)
**Risk**: Products with titles like "crewneck tee" may not match if only "tee" synonym used.

### 4. Attribute Filter Over-Strictness
**Issue**: `matchesAttributeFilters()` uses strict matching - if JSON attributes are sparse or missing, products are dropped.
**Status**: ⚠️ **PARTIALLY ADDRESSED** - Widening tiers drop attribute filters, but initial strict filtering may drop valid products.
**Location**: `src/lib/search/index.ts:88-134`
**Risk**: Products with incomplete JSON attributes may be filtered out even if they match category/price.

### 5. Context Mis-Classification
**Issue**: `callContextGatekeeper()` (LLM) may mis-classify follow-ups as new searches or vice versa.
**Status**: ⚠️ **PARTIALLY ADDRESSED** - Heuristic `detectFollowUpType()` provides fallback, but LLM decision is primary.
**Location**: `src/lib/llm/orchestrator/intent.ts:384-472` (gatekeeper), `src/lib/llm/orchestrator/followup-detector.ts` (heuristics)
**Risk**: User says "black ones" but gatekeeper says `new_search` → context lost.

### 6. Keyword Filter Logic
**Issue**: `keywordFilters` are extracted from canonical synonyms, but may not match actual product titles.
**Status**: ⚠️ **PARTIALLY ADDRESSED** - `extractHardTextFilterKeywords()` provides fallback, but limited to hard-coded patterns.
**Location**: `src/lib/llm/orchestrator/utils.ts:265-305`
**Risk**: User says "crewneck" but synonym map only has "tee" → keyword filter misses.

### 7. Pending Suggestion Gating
**Issue**: Pending suggestions may be confirmed when user explicitly wants new category.
**Status**: ✅ **FIXED** - `detectFollowUpType()` checks for canonical category nouns, overrides pending.
**Location**: `src/lib/llm/orchestrator/index.ts:494-523`

### 8. Relaxation Drops Category Too Early
**Issue**: Widening tiers drop category in Tier 1, but should keep keyword filters.
**Status**: ✅ **FIXED** - `keywordFilters` preserved through all tiers (Fix F).
**Location**: `src/lib/search/index.ts:608-619`

### 9. Adaptive Take May Still Cap Early
**Issue**: For broad queries, `take=1500` may still miss products if catalog is large.
**Status**: ⚠️ **ACCEPTABLE** - `MAX_TAKE=2500` is safe for ~13k catalog, but may need tuning for larger catalogs.
**Location**: `src/lib/search/index.ts:255-285`

### 10. No Clarification Loop
**Issue**: When `noExactMatch=true`, system doesn't ask clarifying questions.
**Status**: ❌ **NOT IMPLEMENTED** - No clarification loop exists.
**Location**: N/A (feature missing)
**Impact**: User gets "no products" message instead of being asked to refine.

---

## Open Questions

1. **How long does conversation context persist?**
   - Answer: Per browser session (localStorage), cleared on page refresh. Not persisted server-side.

2. **What happens if `search_vector` migration is never run?**
   - Answer: System uses Prisma fallback (ILIKE OR conditions) with recency-only ranking. No full-text search ranking.

3. **How are invalid ontology terms handled?**
   - Answer: `applyOntologyToConstraints()` uses fuzzy matching - if no match found, term is dropped and added to `query` text for soft scoring.

4. **What is the maximum number of products in a pending suggestion?**
   - Answer: All candidates from relaxed search (no explicit limit, but typically 8+).

5. **How are product cards sorted when `wasRelaxed=false`?**
   - Answer: By `evaluateProductFit()` score (desc), then price (asc). Database ranking is not used in final sort (only for initial fetch).

6. **How does catalog ingestion work?**
   - Answer: Admin uploads CSV via `/admin/catalog` → API parses streaming CSV → validates each row → upserts to `Product` table → infers dataset context via LLM → returns summary with metrics and context. Products immediately available for search/assistant.

7. **What is the unified catalog schema?**
   - Answer: Standardized CSV format with config-driven field definitions. Required fields: `product_id`, `title`/`short_title`, `product_url`. All other fields optional but improve search. Unknown fields stored in `attributes.extensible` JSON.

8. **How does dataset context inference work?**
   - Answer: After processing first 200 rows, system samples up to 50 valid rows and sends to primary LLM model. LLM infers vertical, currency, primary facets, and recommended search examples. Admin hints override LLM values. Non-blocking (ingestion continues even if LLM fails).

