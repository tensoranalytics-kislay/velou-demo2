# Comprehensive Codebase Audit & Documentation

**Generated:** 2025-01-XX  
**Purpose:** Complete technical documentation for developers to understand the entire Velou Shopping Assistant application

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Directory Structure](#directory-structure)
3. [Tech Stack](#tech-stack)
4. [Architecture Overview](#architecture-overview)
5. [Discovery & Prompting Pipeline](#discovery--prompting-pipeline)
6. [LLM Integration](#llm-integration)
7. [API Routes](#api-routes)
8. [Search & Retrieval System](#search--retrieval-system)
9. [Database Schema](#database-schema)
10. [Services Layer](#services-layer)
11. [Frontend Components](#frontend-components)
12. [What's Used vs Unused](#whats-used-vs-unused)
13. [Key Workflows](#key-workflows)

---

## Project Overview

**Velou Shopping Assistant** is a single-merchant demo for a fashion/apparel ecommerce site with an AI-powered shopping assistant. The system provides:

- **ChatGPT-style conversational interface** for product discovery
- **Multi-view retrieval** (lexical, semantic, concept-based search)
- **LLM-powered intent classification** and response generation
- **Real-time progress tracking** via Server-Sent Events (SSE)
- **Persistent chat sessions** with cross-tab synchronization
- **Admin dashboard** for brand configuration, catalog management, and analytics
- **Widget embedding** for third-party integration

The application is built as a **Next.js 16** application using the App Router, with a PostgreSQL database and OpenAI LLM integration.

---

## Directory Structure

### Root Level

```
velou-shopping-assistant/
├── src/                    # Main application source code
├── prisma/                 # Database schema and migrations
├── scripts/                # Utility scripts (catalog import, backfills)
├── tests/                  # Test files (Vitest)
├── packages/               # Widget package (@velou/widget)
├── public/                 # Static assets
├── docs/                   # Documentation files
├── node_modules/           # Dependencies
├── package.json            # Project dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── next.config.ts          # Next.js configuration
├── vitest.config.ts        # Test configuration
└── .cursorrules            # Cursor IDE rules
```

### `/src` Directory Structure

```
src/
├── app/                    # Next.js App Router pages and API routes
│   ├── page.tsx           # Main landing page
│   ├── layout.tsx         # Root layout
│   ├── globals.css        # Global styles
│   ├── admin/             # Admin dashboard routes
│   │   ├── layout.tsx     # Admin layout with auth
│   │   ├── login/         # Login page
│   │   ├── brand-voice/   # Brand voice configuration
│   │   ├── appearance/    # Appearance customization
│   │   ├── catalog/       # Catalog management
│   │   ├── merch-rules/   # Merchandising rules
│   │   ├── llm/           # LLM configuration display
│   │   ├── metrics/       # Analytics dashboard
│   │   └── integrations/  # Widget installation guide
│   └── api/               # API routes
│       ├── assistant/     # Main assistant endpoint
│       ├── chat/          # Chat utilities (greeting, placeholder)
│       ├── metrics/       # Analytics endpoints
│       ├── health/        # Health check
│       ├── admin/         # Admin API routes (auth, config, catalog)
│       └── widget/        # Widget API routes (multi-tenant)
│
├── components/            # React components
│   ├── Chat/              # Chat UI components
│   │   ├── ChatPanel.tsx
│   │   ├── ChatWidget.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageInput.tsx
│   │   ├── QueryProgressBar.tsx
│   │   └── SuggestedPrompts.tsx
│   ├── ProductCarousel/  # Product card components
│   ├── Site/             # Landing page components
│   └── admin/             # Admin UI components
│
├── lib/                   # Core business logic
│   ├── db.ts             # Prisma client
│   ├── config.ts         # Environment configuration
│   ├── llm/              # LLM integration
│   │   ├── provider.ts   # LLM provider abstraction
│   │   ├── prompts.ts    # All prompt templates
│   │   ├── types.ts      # LLM types
│   │   └── orchestrator/ # Legacy orchestrator (unused)
│   ├── loccitane/        # L'Occitane-optimized pipeline (ACTIVE)
│   │   ├── orchestrator.ts    # Main query handler
│   │   ├── classifier.ts      # Query classification
│   │   ├── retrieval.ts        # Multi-view retrieval
│   │   ├── ranking/            # ML ranking
│   │   ├── reply.ts            # RAG reply generation
│   │   ├── reasons.ts          # Product card reasons
│   │   ├── safety.ts           # Query safety checks
│   │   └── prompts.ts          # L'Occitane-specific prompts
│   ├── search/            # Search engine
│   │   ├── index.ts       # Main search entry point
│   │   ├── ontology.ts   # Catalog ontology
│   │   ├── query/         # Query building
│   │   ├── filtering/     # Attribute filtering
│   │   ├── ranking/       # Search ranking
│   │   ├── vector/        # Vector/semantic search
│   │   └── concept/       # Concept-based search
│   ├── services/          # Services layer (business logic)
│   │   ├── AssistantService.ts
│   │   ├── SearchService.ts
│   │   ├── CatalogService.ts
│   │   ├── MerchantService.ts
│   │   ├── AnalyticsService.ts
│   │   └── IntegrationService.ts
│   ├── catalog/           # Catalog ingestion
│   ├── chat/              # Chat persistence
│   ├── auth/              # JWT authentication
│   ├── telemetry/         # Logging and metrics
│   └── rateLimit.ts       # Rate limiting
│
└── middleware/            # Next.js middleware
    ├── auth.ts            # Authentication middleware
    ├── requireRole.ts     # Role-based access control
    ├── widgetAuth.ts      # Widget authentication
    └── widgetCors.ts      # Widget CORS handling
```

---

## Tech Stack

### Core Framework
- **Next.js 16.0.10** (App Router)
- **React 19.2.1** (patched for CVE-2025-55182)
- **TypeScript 5**

### Styling
- **Tailwind CSS 4** (PostCSS)
- Custom CSS modules for specific components

### Database
- **PostgreSQL** (via Prisma)
- **Prisma 5.19.1** (ORM)
- **pgvector** extension for vector embeddings

### LLM & AI
- **OpenAI API** (primary provider)
  - `gpt-4.1` (primary model for high-quality responses)
  - `gpt-4.1-mini` (lightweight model for classification)
  - `text-embedding-3-small` (embeddings)
- **Mock provider** for testing (no API calls)

### Authentication
- **JWT** (jose library for Edge Runtime compatibility)
- **bcryptjs** for password hashing

### Rate Limiting
- **@upstash/ratelimit** with Redis (Upstash)

### Testing
- **Vitest 4.0.13**
- **@testing-library/react**
- **jsdom** for DOM testing

### Other Dependencies
- **csv-parse** for CSV catalog ingestion
- **jsonwebtoken** (legacy, being phased out in favor of jose)

---

## Architecture Overview

### High-Level Flow

```
User Query
    ↓
[API Route] /api/assistant/stream
    ↓
[AssistantService] handleAssistantQuery()
    ↓
[L'Occitane Orchestrator] handleLoccitaneQuery()
    ↓
[Pipeline Stages]
    1. Safety Check
    2. Query Classification (LLM)
    3. Multi-View Retrieval
       - Lexical Search
       - Semantic Search (Vector)
       - Concept Search
    4. Product Loading & Filtering
    5. ML Ranking
    6. RAG Reply Generation (LLM)
    7. Product Card Generation
    ↓
[Response] replyText + productCards + followupText
```

### Multi-Tenant Architecture

The application supports **multi-tenant isolation** via `merchantId`:

- All database queries are scoped to `merchantId`
- Each merchant has:
  - Brand configuration (colors, logo, voice)
  - Catalog (products)
  - Merchandising rules
  - Analytics events
  - API keys (for widget embedding)
  - Users (with role-based access)

### Services Layer Pattern

Business logic is abstracted into services:

- **AssistantService**: Wraps orchestrator with merchant scoping
- **SearchService**: Product search with merchant isolation
- **CatalogService**: Catalog ingestion and management
- **MerchantService**: Merchant CRUD operations
- **AnalyticsService**: Event tracking and metrics
- **IntegrationService**: Widget configuration and API keys

---

## Discovery & Prompting Pipeline

### Active Pipeline: L'Occitane Optimized

**Location:** `src/lib/loccitane/orchestrator.ts`

This is the **primary pipeline** used for all queries. It's optimized for L'Occitane's catalog but works for any merchant.

#### Stage 1: Safety Check
**File:** `src/lib/loccitane/safety.ts`

- Rule-based detection of unsafe/non-shopping queries
- Handles self-harm, violence, and unrelated topics
- Returns appropriate responses without LLM calls

#### Stage 2: Query Classification
**File:** `src/lib/loccitane/classifier.ts`

- **LLM Call** (lightweight model: `gpt-4.1-mini`)
- Classifies query type:
  - `direct_product_search`: "shampoo for dandruff"
  - `symptom_concern`: "I have dry skin"
  - `gift_or_vague`: "gift for mom"
  - `unrelated`: Non-shopping queries
- Extracts structured constraints:
  - `concerns` (e.g., "dryness", "dandruff")
  - `skinTypes` (e.g., "sensitive", "oily")
  - `productTypes` (e.g., "shampoo", "cream")
  - `ingredients` (e.g., "shea butter", "almond oil")
  - `madeWithout` (e.g., "parabens", "sulfates")
  - `collections` (e.g., "Immortelle", "Shea Butter")
  - `priceMinCents` / `priceMaxCents`
  - `genders` / `ageGroups`

**Prompt Template:** `src/lib/loccitane/prompts.ts` → `CLASSIFIER_PROMPT`

#### Stage 3: Multi-View Retrieval
**File:** `src/lib/loccitane/retrieval.ts`

Runs **three parallel retrieval methods**:

1. **Lexical Search** (`src/lib/search/index.ts`)
   - Full-text search using PostgreSQL `tsvector`
   - Keyword matching in title, description, attributes
   - Category/subcategory filtering
   - Price/gender/stock filtering

2. **Semantic Search** (`src/lib/search/vector/index.ts`)
   - Vector similarity search using `pgvector`
   - Embeds query using `text-embedding-3-small`
   - Cosine similarity ranking
   - Returns top 150 candidates

3. **Concept Search** (`src/lib/search/concept/index.ts`)
   - In-memory index mapping concepts → product IDs
   - Concepts: concerns, skinTypes, ingredients, madeWithout, productTypes
   - Fast set intersection for multi-concept queries
   - Returns products matching ALL specified concepts

**Merging:** Union of all three result sets (up to 400 candidates)

#### Stage 4: Product Loading & Filtering
**File:** `src/lib/loccitane/orchestrator.ts` (lines 419-572)

- Loads full product objects from database
- Filters for products with structured L'Occitane attributes
- Applies `productType` filter (if specified)
- Applies `avoidIngredients` filter (excludes products with specified ingredients)
- Excludes previously shown products

#### Stage 5: ML Ranking
**File:** `src/lib/loccitane/ranking/ranker.ts`

- Combines scores from:
  - Lexical relevance (position-based)
  - Semantic similarity (vector distance)
  - Concept matches (exact concept matches)
  - Shopify signals (bestseller, sales rank)
  - Heuristic features (price, stock status)
- Returns top 20 products

#### Stage 6: RAG Reply Generation
**File:** `src/lib/loccitane/reply.ts`

- **LLM Call** (primary model: `gpt-4.1`)
- Generates conversational reply using:
  - User query
  - Classification constraints
  - Top 4 products (full attributes)
  - Brand voice instructions
  - Dataset context
- Returns:
  - `replyText`: Opening message (2-4 sentences)
  - `followupText`: Conclusion + follow-up questions (2 paragraphs)

**Prompt Template:** `src/lib/loccitane/prompts.ts` → `REPLY_PROMPT`

#### Stage 7: Product Card Generation
**File:** `src/lib/loccitane/orchestrator.ts` (lines 636-691)

- Builds product cards for top 4 products
- Generates "Chosen because..." reasons using template-based logic
- Extracts key attributes (concerns, ingredients, application areas)
- Returns `ProductCard[]` with:
  - `id`, `title`, `imageUrl`, `productUrl`
  - `priceCents`, `salePriceCents`, `currency`
  - `reason` (10-15 words)
  - `keyAttributes` (top 5 attributes as chips)
  - `stockStatus`

### Legacy Pipeline (Unused)

**Location:** `src/lib/llm/orchestrator/` (flows directory is empty)

The legacy orchestrator is **not used** in the current implementation. All queries go through the L'Occitane pipeline.

---

## LLM Integration

### Provider Abstraction

**File:** `src/lib/llm/provider.ts`

Single entry point for all LLM calls:

```typescript
callLLM(options: LlmCallOptions): Promise<LlmCallResult>
```

### Model Selection Strategy

Models are selected based on `purpose`:

- **`intent`**: `gpt-4.1-mini` (fast classification)
- **`final_reply`**: `gpt-4.1` (high-quality responses)
- **`card_reason`**: `gpt-4.1-mini` (cost-effective)
- **`greeting`**: `gpt-4.1-mini` (lightweight)
- **`pdp_suitability`**: `gpt-4.1` (analysis)

### Temperature Settings

- **`intent`**: 0.1 (deterministic)
- **`final_reply`**: 0.7 (creative)
- **`pdp_suitability`**: 0.4 (balanced)
- **`card_reason`**: 0.55 (moderate)

### LLM Calls in Pipeline

1. **Query Classification** (`classifyQuery`)
   - Model: `gpt-4.1-mini`
   - Purpose: `intent`
   - Output: JSON with query type and constraints
   - Schema: `CLASSIFIER_JSON_SCHEMA`

2. **RAG Reply Generation** (`generateReplyWithRag`)
   - Model: `gpt-4.1`
   - Purpose: `final_reply`
   - Output: Plain text (markdown)
   - No schema (free-form text)

3. **Product Q&A** (product-specific queries)
   - Model: `gpt-4.1`
   - Purpose: `pdp_suitability`
   - Output: Plain text answer
   - Uses product attributes only

### Prompt Templates

**Location:** `src/lib/loccitane/prompts.ts`

- `CLASSIFIER_PROMPT`: Query classification
- `REPLY_PROMPT`: RAG reply generation
- `PRODUCT_QA_PROMPT`: Product-specific Q&A

All prompts are **dataset-aware** and adapt to:
- Catalog vertical (e.g., "beauty", "apparel")
- Available attributes (e.g., concerns, ingredients)
- Brand voice instructions

---

## API Routes

### Public API Routes

#### `/api/assistant/stream` (POST)
**File:** `src/app/api/assistant/stream/route.ts`

**Main assistant endpoint** with Server-Sent Events (SSE) streaming.

**Input:**
```typescript
{
  sessionId: string;
  pageType: 'HOME' | 'PLP' | 'PDP';
  productContextId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationContext?: ConversationContext;
  searchMethods?: {
    lexical: boolean;
    semantic: boolean;
    concept: boolean;
  };
}
```

**Output:** SSE stream with:
- Progress events: `classifying`, `retrieving`, `ranking`, `generating_reply`
- Final result: `replyText`, `productCards[]`, `noExactMatch`, `followupText`

**Flow:**
1. Rate limiting check
2. Call `AssistantService.handleAssistantQuery()`
3. Stream progress updates
4. Return final result

#### `/api/assistant` (POST)
**File:** `src/app/api/assistant/route.ts`

**Legacy non-streaming endpoint** (still used by some clients).

- Same input/output as `/stream`
- No progress tracking
- Direct JSON response

#### `/api/chat/greeting` (GET)
**File:** `src/app/api/chat/greeting/route.ts`

Returns dataset-aware initial greeting.

#### `/api/chat/placeholder` (GET)
**File:** `src/app/api/chat/placeholder/route.ts`

Returns LLM-generated placeholder text for chat input.

#### `/api/suggestions` (GET)
**File:** `src/app/api/suggestions/route.ts`

Returns context-aware suggested prompts.

#### `/api/metrics/product-click` (POST)
**File:** `src/app/api/metrics/product-click/route.ts`

Tracks product card clicks.

#### `/api/health` (GET)
**File:** `src/app/api/health/route.ts`

Health check endpoint.

### Admin API Routes

**Base Path:** `/api/admin/*`

All admin routes require JWT authentication.

#### `/api/admin/auth/login` (POST)
**File:** `src/app/api/admin/auth/login/route.ts`

- Validates email/password
- Returns JWT access token + refresh token

#### `/api/admin/auth/logout` (POST)
**File:** `src/app/api/admin/auth/logout/route.ts`

- Invalidates refresh token

#### `/api/admin/auth/refresh` (POST)
**File:** `src/app/api/admin/auth/refresh/route.ts`

- Refreshes access token using refresh token

#### `/api/admin/auth/me` (GET)
**File:** `src/app/api/admin/auth/me/route.ts`

- Returns current user info

#### `/api/admin/brand-config` (GET/PUT)
**File:** `src/app/api/admin/brand-config/route.ts`

- Get/update brand configuration

#### `/api/admin/catalog/upload` (POST)
**File:** `src/app/api/admin/catalog/upload/route.ts`

- Upload CSV catalog file
- Returns ingestion progress

#### `/api/admin/catalog/clear` (POST)
**File:** `src/app/api/admin/catalog/clear/route.ts`

- Clear all products for merchant

#### `/api/admin/merch-rules` (GET/POST)
**File:** `src/app/api/admin/merch-rules/route.ts`

- List/create merchandising rules

#### `/api/admin/merch-rules/[id]` (PUT/DELETE)
**File:** `src/app/api/admin/merch-rules/[id]/route.ts`

- Update/delete merchandising rule

#### `/api/admin/metrics/product-clicks` (GET)
**File:** `src/app/api/admin/metrics/product-clicks/route.ts`

- Get product click analytics

### Widget API Routes

**Base Path:** `/api/widget/[merchantId]/*`

Widget routes use API key authentication (not JWT).

#### `/api/widget/[merchantId]/assistant/stream` (POST)
**File:** `src/app/api/widget/[merchantId]/assistant/stream/route.ts`

- Same as `/api/assistant/stream` but with API key auth
- Multi-tenant isolation via `merchantId`

#### `/api/widget/[merchantId]/config` (GET)
**File:** `src/app/api/widget/[merchantId]/config/route.ts`

- Returns widget configuration (brand colors, logo)

#### `/api/widget/[merchantId]/suggestions` (GET)
**File:** `src/app/api/widget/[merchantId]/suggestions/route.ts`

- Returns suggested prompts for widget

#### `/api/widget/[merchantId]/analytics/event` (POST)
**File:** `src/app/api/widget/[merchantId]/analytics/event/route.ts`

- Tracks widget analytics events

---

## Search & Retrieval System

### Main Search Entry Point

**File:** `src/lib/search/index.ts`

**Function:** `searchProducts(constraints, userMessage?, merchantId?)`

**Pipeline:**

1. **Build Filters** (`query/buildFilters.ts`)
   - Converts `SearchConstraints` to Prisma `where` clause
   - Handles category canonicalization
   - Applies merchandising rules (excluded categories, boosts)

2. **Calculate Take** (`query/calculateTake.ts`)
   - Dynamic limit based on query complexity
   - Default: 8 products
   - Max: 2500 products

3. **Database Ranked Search** (`ranking/dbRankedSearch.ts`)
   - Full-text search using PostgreSQL `tsvector`
   - Hierarchical ranking:
     - Title/brand (very high)
     - Category/subcategory (high)
     - Description/benefits (high)
     - Attributes (medium-high)
     - Price/availability (medium)
   - Returns candidates with relevance scores

4. **Attribute Filtering** (`filtering/attributes.ts`)
   - In-memory filtering for attributes not in SQL
   - Handles: colors, fabrics, materials, seasons, occasions, fit
   - Canonical category matching (JSON attributes)

5. **Constraint Relaxation** (`filtering/relaxation.ts`)
   - If no results, progressively relax constraints:
     - Drop attribute filters
     - Drop category
     - Drop price
     - Keep only query text

6. **Final Scoring** (`ranking/relevance.ts`)
   - Combines database rank + category boost + attribute match score
   - Returns top N products

### Vector Search

**File:** `src/lib/search/vector/index.ts`

- **Embedding Model:** `text-embedding-3-small`
- **Storage:** PostgreSQL `pgvector` extension
- **Function:** `searchVectorIndex(embedding, limit, filters)`
- **Similarity:** Cosine similarity
- **Backfill:** `scripts/backfillProductEmbeddings.ts`

### Concept Search

**File:** `src/lib/search/concept/index.ts`

- **Index:** In-memory maps (concept → Set<productId>)
- **Concepts:** concerns, skinTypes, ingredients, madeWithout, productTypes
- **Function:** `searchConceptIndex(index, constraints)`
- **Cache:** `src/lib/search/concept/cache.ts` (loads on first use)

### Catalog Ontology

**File:** `src/lib/search/ontology.ts`

- Extracts unique values from catalog:
  - Categories, subcategories
  - Colors, sizes, materials
  - Brands, genders, age groups
  - Seasons, occasions
- Used for:
  - Constraint validation
  - Category canonicalization
  - Attribute normalization

---

## Database Schema

### Core Models

#### `Merchant`
Multi-tenant root entity:
- `id`, `slug`, `name`, `brandName`
- `primaryColor`, `accentColor`, `backgroundColor`, `surfaceColor`, `borderColor`
- `logoUrl`
- `voiceInstructions` (brand voice)
- `toneFormal`, `tonePlayful` (0-10)
- `useMerchantKey`, `merchantOpenAIKey` (LLM key override)
- `datasetContext` (JSON: vertical, primaryFacets, sampleCategories)
- `shopifyStore`, `shopifyAccessToken` (Shopify integration)
- `reviewProvider`, `reviewApiKey` (review integration)

#### `Product`
Product catalog:
- `id` (primary key)
- `merchantId` (foreign key)
- `title`, `description`, `imageUrl`, `productUrl`
- `priceCents`, `salePriceCents`, `currency`
- `category`, `subcategory`, `brand`
- `attributes` (JSON: unified schema attributes)
- `stockStatus` (in_stock | out_of_stock | low_stock)
- `search_vector` (tsvector for full-text search)
- `embedding` (vector for semantic search)
- `shopifyProductId`, `shopifyHandle`, `shopifyVariantIds`
- `shopifyBestseller`, `shopifyTrending`, `shopifySalesRank`
- `reviewScore`, `reviewCount`, `reviewsJson`

**Indexes:**
- `merchantId`, `category`, `stockStatus`
- `search_vector` (GIN index)
- `embedding` (vector index)

#### `MerchantUser`
Admin users:
- `id`, `merchantId`, `email`, `passwordHash`
- `role` (ADMIN | EDITOR | VIEWER)
- `isActive`, `lastLogin`

#### `ApiKey`
Widget API keys:
- `id`, `merchantId`, `name`, `token`
- `allowedOrigins` (CORS)
- `isActive`

#### `MerchRule`
Merchandising rules:
- `id`, `merchantId`
- `ruleType` (boost_category | exclude_category | hide_out_of_stock)
- `value` (category name)
- `weight` (for boosting)
- `isActive`

#### `ConversationEvent`
Chat analytics:
- `id`, `merchantId`, `sessionId`
- `pageType` (HOME | PLP | PDP)
- `productContextId` (optional)
- `userQuery`, `assistantReplySnippet`
- `productIds[]`, `clickedProductId`
- `hadExactMatch`, `clicked`

#### `AnalyticsEvent`
General analytics:
- `id`, `merchantId`, `sessionId`
- `eventType`, `payload` (JSON)
- `userDevice`, `userPage`, `userReferer`

#### `CatalogIngestionRun`
Catalog import tracking:
- `id`, `merchantId`, `vendorId`
- `totalRows`, `inserted`, `updated`, `invalidRows`
- `mode` (FULL_REPLACE | INCREMENTAL)

---

## Services Layer

### AssistantService

**File:** `src/lib/services/AssistantService.ts`

**Function:** `handleAssistantQuery(merchantId, input)`

- Wraps `handleLoccitaneQuery()` with merchant scoping
- Verifies merchant exists
- Loads dataset context
- Returns standardized result format

### SearchService

**File:** `src/lib/services/SearchService.ts`

- Wraps `searchProducts()` with merchant scoping
- Applies merchant-specific filters

### CatalogService

**File:** `src/lib/services/CatalogService.ts`

- `ingestCatalog(merchantId, file)`: CSV ingestion
- `clearCatalog(merchantId)`: Clear all products
- `getIngestionRuns(merchantId)`: List ingestion history

### MerchantService

**File:** `src/lib/services/MerchantService.ts`

- `getMerchant(merchantId)`: Get merchant config
- `updateMerchant(merchantId, data)`: Update config
- `getDatasetContext(merchantId)`: Get dataset context

### AnalyticsService

**File:** `src/lib/services/AnalyticsService.ts`

- `recordConversationEvent(data)`: Track chat events
- `recordProductClick(merchantId, sessionId, productId)`: Track clicks
- `getProductClicks(merchantId, filters)`: Get analytics

### IntegrationService

**File:** `src/lib/services/IntegrationService.ts`

- `createApiKey(merchantId, name, origins)`: Create widget API key
- `listApiKeys(merchantId)`: List API keys
- `regenerateApiKey(merchantId, keyId)`: Regenerate key
- `updateAllowedOrigins(merchantId, keyId, origins)`: Update CORS

---

## Frontend Components

### Chat Components

**Location:** `src/components/Chat/`

- **`ChatPanel.tsx`**: Main chat interface
- **`ChatWidget.tsx`**: Floating widget
- **`MessageList.tsx`**: Message rendering
- **`MessageInput.tsx`**: Input with suggestions
- **`QueryProgressBar.tsx`**: Progress indicator
- **`SuggestedPrompts.tsx`**: Context-aware suggestions

### Product Components

**Location:** `src/components/ProductCarousel/`

- **`ProductCarousel.tsx`**: Product card carousel/grid

### Admin Components

**Location:** `src/components/admin/`

- **`Installation/`**: Widget installation guide
- Admin forms in respective route directories

---

## What's Used vs Unused

### ✅ Active Components

1. **L'Occitane Pipeline** (`src/lib/loccitane/`)
   - ✅ `orchestrator.ts` - Main query handler
   - ✅ `classifier.ts` - Query classification
   - ✅ `retrieval.ts` - Multi-view retrieval
   - ✅ `ranking/ranker.ts` - ML ranking
   - ✅ `reply.ts` - RAG reply generation
   - ✅ `reasons.ts` - Product card reasons
   - ✅ `safety.ts` - Safety checks
   - ✅ `prompts.ts` - Prompt templates

2. **Search System** (`src/lib/search/`)
   - ✅ `index.ts` - Main search entry
   - ✅ `query/buildFilters.ts` - Query building
   - ✅ `query/calculateTake.ts` - Dynamic limits
   - ✅ `ranking/dbRankedSearch.ts` - Database search
   - ✅ `filtering/attributes.ts` - Attribute filtering
   - ✅ `filtering/relaxation.ts` - Constraint relaxation
   - ✅ `vector/index.ts` - Vector search
   - ✅ `concept/index.ts` - Concept search
   - ✅ `ontology.ts` - Catalog ontology

3. **Services Layer** (`src/lib/services/`)
   - ✅ All services are active and used

4. **API Routes**
   - ✅ `/api/assistant/stream` - Main endpoint
   - ✅ `/api/assistant` - Legacy endpoint (still used)
   - ✅ All admin routes
   - ✅ All widget routes

### ❌ Unused/Deprecated Components

1. **Legacy Orchestrator** (`src/lib/llm/orchestrator/`)
   - ❌ `flows/` directory is empty
   - ❌ Legacy orchestrator code is not called
   - ⚠️ Some utility functions in `utils.ts` may be used elsewhere

2. **Old Intent Extraction** (`src/lib/loccitane/intent.ts`)
   - ❌ `extractLoccitaneIntent()` - Not used (replaced by classifier)
   - ❌ `mergeLoccitaneConstraints()` - Not used
   - ⚠️ Kept for reference, can be removed

3. **Unused Components**
   - ❌ `src/components/Chat/PageTypeSimulator.tsx` - Not imported
   - ❌ `src/components/Admin/` - Empty directory

4. **Historical Documentation**
   - Many `.md` files in root are historical (see `UNUSED_FILES_AUDIT.md`)

### ⚠️ Partially Used

1. **Legacy Prompts** (`src/lib/llm/prompts.ts`)
   - Some prompts are used by legacy code paths
   - Most prompts are replaced by L'Occitane-specific prompts
   - ⚠️ Review before removing

2. **Widget Package** (`packages/@velou/widget/`)
   - ✅ Active for widget embedding
   - ⚠️ Some files may be unused (needs audit)

---

## Key Workflows

### 1. User Query Flow

```
User types message
    ↓
Frontend: ChatPanel.tsx
    ↓
POST /api/assistant/stream
    ↓
AssistantService.handleAssistantQuery()
    ↓
handleLoccitaneQuery()
    ↓
[Pipeline Stages]
    ↓
SSE Stream: Progress updates
    ↓
Final Response: JSON
    ↓
Frontend: Render message + product cards
```

### 2. Catalog Ingestion Flow

```
Admin uploads CSV
    ↓
POST /api/admin/catalog/upload
    ↓
CatalogService.ingestCatalog()
    ↓
Parse CSV → Validate → Map to schema
    ↓
Infer datasetContext
    ↓
Batch insert to database
    ↓
Backfill embeddings (async)
    ↓
Return ingestion results
```

### 3. Widget Embedding Flow

```
Merchant creates API key
    ↓
Widget installed on third-party site
    ↓
Widget loads: GET /api/widget/[merchantId]/config
    ↓
User queries: POST /api/widget/[merchantId]/assistant/stream
    ↓
API key authentication
    ↓
Same pipeline as main assistant
    ↓
Response returned to widget
```

### 4. Authentication Flow

```
User logs in: POST /api/admin/auth/login
    ↓
Validate email/password
    ↓
Generate JWT (access + refresh)
    ↓
Set cookies
    ↓
Middleware validates JWT on admin routes
    ↓
Refresh token: POST /api/admin/auth/refresh
```

---

## Environment Variables

### Required

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: JWT signing secret (min 32 chars)
- `REFRESH_TOKEN_SECRET`: Refresh token secret (min 32 chars)

### Optional

- `LLM_PROVIDER`: `openai` (default) or `mock`
- `OPENAI_API_KEY`: Required if `LLM_PROVIDER=openai`
- `PRIMARY_LLM_MODEL`: Default `gpt-4.1`
- `LIGHT_LLM_MODEL`: Default `gpt-4.1-mini`
- `EMBEDDING_MODEL`: Default `text-embedding-3-small`
- `USE_LOCCITANE_OPTIMIZED_PIPELINE`: `true` (always enabled)

### Upstash Redis (for rate limiting)

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

---

## Testing

### Test Structure

**Location:** `tests/`

- **Unit tests**: Individual function testing
- **Integration tests**: API route testing
- **E2E tests**: Full pipeline testing

### Key Test Files

- `tests/discovery_pipeline_v2.test.ts`: Discovery pipeline
- `tests/loccitane/*.ts`: L'Occitane-specific tests
- `tests/search/*.ts`: Search functionality
- `tests/services/*.ts`: Services layer

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:ui       # Vitest UI
```

---

## Performance Considerations

### Optimization Strategies

1. **Multi-View Retrieval**: Parallel execution of lexical, semantic, and concept search
2. **Dynamic Take**: Adaptive result limits based on query complexity
3. **Caching**: Concept index cached in memory
4. **Database Indexes**: GIN indexes for full-text search, vector indexes for embeddings
5. **Rate Limiting**: Upstash Redis for API rate limiting

### Target Performance

- **End-to-end latency**: < 4 seconds (typical query)
- **Retrieval latency**: < 1 second (parallel execution)
- **LLM latency**: < 2 seconds (classification + reply)

---

## Security

### Authentication

- **JWT**: Edge Runtime compatible (jose library)
- **Password Hashing**: bcryptjs
- **API Keys**: Secure token generation for widgets

### Input Validation

- All API routes validate input payloads
- SQL injection prevention via Prisma
- XSS prevention via React escaping

### Rate Limiting

- LLM endpoints: Rate limited via Upstash
- Admin routes: JWT required
- Widget routes: API key required

---

## Deployment

### Prerequisites

1. PostgreSQL database with `pgvector` extension
2. Upstash Redis (for rate limiting)
3. OpenAI API key (for LLM features)

### Steps

1. Set environment variables
2. Run migrations: `npx prisma migrate deploy`
3. Generate Prisma client: `npx prisma generate`
4. Build: `npm run build`
5. Start: `npm start`

### Backfill Scripts

- `npm run backfill:embeddings`: Backfill vector embeddings
- `npm run backfill:loccitane-structured`: Backfill structured attributes

---

## Conclusion

This codebase implements a sophisticated AI-powered shopping assistant with:

- **Multi-view retrieval** (lexical, semantic, concept)
- **LLM-powered classification and reply generation**
- **Multi-tenant architecture** with merchant isolation
- **Real-time progress tracking** via SSE
- **Comprehensive admin dashboard**
- **Widget embedding** for third-party integration

The system is optimized for L'Occitane's catalog but works for any merchant with a unified catalog schema.

---

**Last Updated:** 2025-01-XX  
**Maintained By:** Development Team


