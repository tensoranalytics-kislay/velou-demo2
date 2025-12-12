# Velou Shopping Assistant – Unified Catalog Demo

## 1. Project Overview

This repo implements the **Velou Shopping Assistant** as a fully functional **demo prototype** for a **single merchant ecommerce site** with an **industry-agnostic, unified catalog engine**.

The assistant is:
- A **ChatGPT/Grok/Gemini-style on-site chat UI** embedded on a **single-page placeholder website**.
- Powered by a **unified catalog schema** that works across multiple verticals (apparel, skincare, home goods, electronics, etc.) as long as data conforms to the unified CSV format.
- **Persistent chat sessions** that survive page reloads, tab closes, and browser restarts via localStorage with cross-tab synchronization.
- **Real-time progress tracking** via Server-Sent Events (SSE) showing query stages (understanding, searching, evaluating, generating).
- Able to answer:
  - "What should I buy?" – natural language product discovery.
  - "Is this right for me?" – PDP-context suitability questions via product-specific Q&A.
  - General questions with dataset-aware, LLM-driven responses.
- Always responds with:
  - A short conversational answer.
  - A **professionally-designed product carousel** (cards) showing product details + attribute tags.
  - Follow-up questions to refine the search.

The core engine is **industry-agnostic** and **schema-driven**:
- LLM prompts and search behavior adapt to the catalog's vertical and available attributes via `datasetContext`.
- The unified schema supports classification fields (category, vertical, taxon_path), descriptive fields (benefits, claims, sensory_profile), and experiential fields (usage_contexts, style_tags, compatibility) that work across industries.
- Search heuristics and canonicalization are vertical-aware, applying industry-specific logic only when the catalog profile suggests it (e.g., fashion-specific category mapping for apparel catalogs).
- **Sophisticated keyword search** with hierarchical ranking across product fields (identity, type, needs, specs, price/availability).

For this demo, you can import your own unified catalog CSV through the admin interface. The system automatically adapts to your catalog's vertical and attributes.

The goal is to **prove end-to-end feasibility and UX quality** for one real merchant, not to build a multi-tenant SaaS.

---

## 1.1 Unified Catalog Schema

The system uses a **unified CSV schema** (`UnifiedVendorCatalogRow`) that supports multiple verticals through industry-agnostic field groups. See `src/lib/catalog/unifiedSchemaConfig.ts` for the complete schema definition.

### Major Column Groups

- **Identity**: `product_id`, `product_url`, `image_url_primary`, `external_sku`, `barcode`, `parent_id`, `related_id`
- **Classification**: `vertical`, `category`, `subcategory`, `taxon_path`, `google_product_category`, `product_type`, `brand`
- **Commercial**: `price`, `sale_price`, `currency`, `availability`, `inventory`, `condition`
- **Descriptive**: `title`, `description`, `product_highlights`, `bullet_highlights`, `product_details` (JSON)
- **Experience**: `usage_contexts` (pipe-separated), `style_tags` (pipe-separated), `benefits` (pipe-separated), `claims` (pipe-separated), `sensory_profile`, `compatibility` (pipe-separated)
- **Media**: `image_url_primary`, `image_url_alt1`, `image_url_alt2`, `media_gallery` (JSON array)
- **Extensible**: `attribute_blob` (JSON) for vendor-specific custom fields

During CSV ingestion, these fields are mapped into the `Product` model:
- Direct fields (e.g., `title`, `category`, `priceCents`) are stored as Prisma columns.
- Unified attributes (e.g., `usage_contexts`, `benefits`, `sensory_profile`) are stored in `Product.attributes` JSON for flexible, industry-agnostic search and filtering.

The schema is designed to accommodate:
- **Apparel**: Uses `style_tags`, `usage_contexts` (e.g., "beach wedding", "office"), materials, fit, occasion, season.
- **Skincare/Beauty**: Uses `benefits`, `claims`, `sensory_profile`, `compatibility` (e.g., "dry skin", "sensitive skin"), `usage_contexts` (e.g., "night routine", "before bed").
- **Home Goods**: Uses `style_tags`, `usage_contexts` (e.g., "bathroom", "guest bathroom"), materials, `compatibility`.
- **Electronics**: Uses `compatibility`, `benefits`, `claims`, `usage_contexts`.

---

## 1.2 Using Your Own Unified Catalog CSV

To import your own catalog:

1. **Format your CSV** according to the unified schema (see `src/lib/catalog/unifiedSchemaConfig.ts`).
2. **Upload via Admin Interface**:
   - Navigate to `/admin/catalog`
   - Click "Upload CSV" and select your file
   - The system will:
     - Map columns to the unified schema
     - Infer `datasetContext` (vertical, primary facets, sample categories) from your data
     - Store products in PostgreSQL with attributes preserved in JSON
     - Display ingestion progress and results

3. **The system automatically adapts**:
   - LLM prompts use `datasetContext` to describe the catalog's vertical and available facets
   - Search heuristics detect the catalog profile (e.g., "fashion" vs generic) and apply vertical-specific logic only when appropriate
   - Attribute filtering works with any unified schema fields (useCases, benefits, styleTags, compatibility, etc.)
   - Chat greeting, placeholder text, and suggested prompts become dataset-aware

---

## 2. MVP Scope

### 2.1 In Scope (Demo)

- **Single-page site** (Next.js):
  - Hero section (brand feel, dataset-aware).
  - Main panel with **chat assistant** and product card responses.
  - Floating chat widget with animated bot avatar.

- **Chat assistant features:**
  - **Persistent sessions**: Chat history, conversation context, and session ID persist across page reloads, tab closes, and browser restarts via localStorage with cross-tab synchronization.
  - **Real-time progress tracking**: Visual progress bar showing query stages (understanding → searching → evaluating → generating).
  - **Free-form discovery queries**:
    - e.g. "almond-scented body scrub under $50", "minimalist bathroom towels", "beach wedding dress under $200".
  - **Refinement**:
    - "cheaper", "more colorful", "only size M", "for sensitive skin".
    - Follow-up queries exclude previously shown products.
  - **PDP-style suitability questions** (via product context):
    - Click "Ask about product" on any card to ask questions specific to that product.
    - "Is this good for humid weather?", "Will this work for dry skin?", "Is this suitable for a guest bathroom?"
  - **Non-product queries**:
    - Dataset-aware, LLM-driven responses for general questions.
    - Handles sensitive topics appropriately.
  - **Always**:
    - short conversational reply.
    - 3–8 product cards with:
      - image
      - title
      - price
      - key attribute tags (chips)
      - one-line "Chosen because…" reason
      - CTA: "View product" and "Ask about product"
    - Follow-up questions to refine search.

- **Admin-style configuration (single-merchant, simple UI):**
  - **Brand voice** instructions (tone + style).
  - Tone sliders: formal/casual, playful/serious.
  - **Appearance customization**:
    - Logo upload
    - Brand colors (primary, accent, background, surface, border)
  - Simple merchandising rules:
    - hide out-of-stock items.
    - boost/exclude categories.
  - **LLM configuration**:
    - Provider: **OpenAI** (gpt-4.1, o3-mini, gpt-4.1-mini) or fully mocked for tests.
    - Toggle: "use Velou key" vs "use merchant key".

- **Catalog ingestion:**
  - CSV upload through admin interface with automatic schema mapping and dataset context inference.
  - Progress tracking during ingestion.
  - Full replace or incremental update modes.
  - Catalog clearing functionality.
  - Each product includes:
    - ID, title, description, image URL, price, currency.
    - Category/subcategory/brand/vertical.
    - Attributes JSON using unified schema fields:
      - For apparel: fabric, fit, length, pattern, season, occasion, style_tags, usage_contexts.
      - For skincare: benefits, claims, sensory_profile, compatibility, usage_contexts.
      - For home: style_tags, usage_contexts, materials, compatibility.
    - Stock status.

- **Metrics (MVP-level):**
  - # of conversations.
  - # of messages.
  - CTR from assistant → product (card click).
  - # of "no exact match" responses.
  - **Product click analytics**: Track and display how many times each product has been clicked, with filtering and sorting options.

### 2.2 Out of Scope (Demo)

- Multi-merchant support.
- Order tracking, returns, shipping/FAQ.
- Multi-language.
- External channels (WhatsApp/SMS/Email).
- Review integration.
- Deep personalization / CDP integration.

---

## 3. Tech Stack

- **Framework:** Next.js 16.0.7 (App Router) + TypeScript.
- **React:** 19.2.1 (patched for CVE-2025-55182).
- **Styling:** Tailwind CSS + modern UI patterns (glassmorphism, soft gradients).
- **DB:** PostgreSQL (e.g. Neon or similar) via Prisma 5.19.1.
- **LLM providers:**
  - Primary: **OpenAI API** (default `gpt-4.1` for highest quality tasks).
  - Reasoning: **OpenAI `o3-mini`** for complex logical analysis (intent parsing, suitability).
  - Lightweight: **OpenAI `gpt-4.1-mini`** for cost-effective simple tasks.
  - Optional mock provider for development.
- **Real-time:** Server-Sent Events (SSE) for progress tracking.
- **Persistence:** localStorage for chat sessions with cross-tab synchronization.

- **Hosting (demo):**
  - Next.js app on Vercel or similar.
  - PostgreSQL as managed cloud DB.

### 3.1 LLM Configuration

The assistant supports two modes via the `LLM_PROVIDER` environment variable:

- **`openai`** (default): Uses OpenAI Chat Completions with a multi-model routing strategy.
- **`mock`**: Deterministic, rule-based parsing for development or automated tests (no API calls).

**Key environment variables:**
- `OPENAI_API_KEY` – required when `LLM_PROVIDER=openai`
- `PRIMARY_LLM_MODEL` – defaults to `gpt-4.1`, used for final replies and dataset analysis
- `REASONING_LLM_MODEL` – defaults to `o3-mini`, used for intent parsing and suitability analysis (complex reasoning)
- `LIGHT_LLM_MODEL` – defaults to `gpt-4.1-mini`, used for inexpensive helper tasks (card reasons, lightweight transforms)

The system always falls back to rule-based parsing if LLM calls fail, ensuring the assistant remains functional even when external APIs are unavailable.

---

## 4. High-Level Architecture

### 4.1 Components

1. **Next.js App (Single Codebase)**
   - `/` – single-page placeholder website with:
     - brand hero section (dataset-aware).
     - floating chat widget with animated bot avatar.
     - product grid.
   - `/admin/*` – simple admin console:
     - Brand Voice
     - Appearance (logo, colors)
     - Catalog (upload, clear)
     - MerchRules
     - LLMConfig
     - Metrics (conversations, product clicks)

2. **Assistant API (Next.js API Routes)**
   - `POST /api/assistant/stream` – main chat endpoint with SSE progress tracking:
     - Input: sessionId, pageType (HOME/PLP/PDP), productContextId (optional), message, brief history, conversationContext.
     - Output: Streaming progress events + final result (replyText, productCards[], noExactMatch, followupText).
   - `POST /api/assistant` – legacy non-streaming endpoint (redirects to stream).
   - `POST /api/metrics/product-click` – track card → PDP clicks.
   - `GET /api/chat/greeting` – dataset-aware initial greeting.
   - `GET /api/chat/placeholder` – dataset-aware chat input placeholder.
   - `GET /api/suggestions` – context-aware suggested prompts.
   - `GET /api/health` – health check.

3. **Search / Index Layer (Internal library)**
   - `searchProducts(constraints: SearchConstraints)`.
   - Backed by Prisma + PostgreSQL.
   - **Sophisticated keyword search** with hierarchical ranking:
     - Primary identity (title, brand, product_id) – very high importance
     - Type & category (category, subcategory, vertical) – high importance
     - Needs & benefits (description, benefits, claims, usage_contexts) – high importance
     - Specs & ingredients (ingredients, materials, dimensions) – medium-high importance
     - Price & availability (filters & tie-breakers) – medium importance
   - Supports unified schema attributes:
     - Classification: category, subcategory, vertical, price range.
     - Industry-agnostic facets: colors, sizes, materials, useCases, styleTags, benefits, compatibility, sensoryProfile.
     - Vertical-specific facets (when applicable): fabric, fit, occasion, season (for fashion), claims (for beauty).
   - Applies merchandising rules (boost/exclude).
   - Attribute filtering is schema-driven and vertical-aware via `datasetContext`.
   - Hard filter for in-stock products (configurable).

4. **LLM Orchestration Layer**
   - All LLM calls go through a **single adapter**:
    - `src/lib/llm/provider.ts` (OpenAI adapter + mock fallback).
   - Orchestrator:
     - step 1: parse intent + constraints from user query and lightweight context (uses `datasetContext` to adapt prompts to catalog vertical).
     - step 2: call search module to get candidate products.
     - step 3: evaluate product relevance and filter if needed.
     - step 4: generate final conversational answer + "Chosen because…" reasons, grounded in product JSON (uses `datasetContext` to guide attribute explanations).
     - step 5: generate follow-up questions based on shown products.
   - Prompts are **industry-agnostic** and **vertical-aware**:
     - `buildIntentAndConstraintsPrompt(datasetContext)` adapts examples and facet guidance based on the catalog's vertical.
     - `buildFinalResponsePrompt(datasetContext)` describes the assistant's role and available attributes based on the catalog profile.
     - `buildPostCardsFollowupPrompt(datasetContext)` generates contextual follow-up questions.
   - Guardrails:
     - Only reference attributes from product JSON.
     - No invented discounts/stock/shipping claims.
     - Handles out-of-catalog queries with dataset-aware responses.
     - Relevance checking to prevent force-fitting irrelevant products.

5. **CSV Catalog Importer**
   - Admin interface (`/admin/catalog`) for CSV upload with progress tracking.
   - Ingests unified catalog CSV files conforming to the unified schema and writes normalized products into Postgres with all attributes preserved for intent/search.
   - During import, the system infers `datasetContext` (vertical, primary facets, sample categories, recommended search examples) from the data to parameterize LLM prompts and search heuristics.
   - Supports full replace and incremental update modes.

6. **Chat Persistence Layer**
   - `src/lib/chat/persistence.ts` – localStorage-based persistence:
     - Chat messages (including productCards, followupText, noExactMatch flags)
     - Session ID (consistent across reloads/tabs)
     - Conversation context (lastIntent, lastConstraints, lastShownProductIds, lastUserQuery)
     - Pending suggestions
   - Cross-tab synchronization via storage events.
   - Auto-saves messages with debouncing (300ms).
   - Clears only when user explicitly clicks "Clear chat".

---

## 5. Data Model (Summary)

Using Prisma-style notation:

```ts
model Product {
  id                String      @id
  title             String
  description       String
  imageUrl          String
  productUrl        String
  priceCents        Int
  salePriceCents    Int?
  currency          String
  category          String
  subcategory       String?
  brand             String?
  attributes        Json        // unified schema attrs: usage_contexts, style_tags, benefits, claims, sensory_profile, compatibility, materials, colors, sizes, etc. (industry-agnostic)
  stockStatus       StockStatus @default(in_stock)
  vendorId          String?
  sourceId          String?
  isActive          Boolean     @default(true)
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
}

model BrandConfig {
  id                Int      @id @default(1)
  brandName         String
  primaryColor      String   @default("#e11d48")
  accentColor       String   @default("#f97373")
  backgroundColor   String   @default("#ffffff")
  surfaceColor      String   @default("#fff7f7")
  borderColor       String   @default("#ffe4e6")
  logoUrl           String?
  voiceInstructions String
  toneFormal        Int      // 0-10
  tonePlayful       Int      // 0-10
  useMerchantKey     Boolean  @default(false)
  merchantOpenAIKey  String?
  datasetContext     Json?   // vertical, primaryFacets, sampleCategories, recommendedSearchExamples, etc.
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

model MerchRule {
  id        Int           @id @default(autoincrement())
  ruleType  MerchRuleType // 'boost_category' | 'exclude_category' | 'hide_out_of_stock'
  value     String
  weight    Int           @default(0)
  isActive  Boolean       @default(true)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
}

model ConversationEvent {
  id                    String   @id
  sessionId             String
  pageType              PageType // 'HOME' | 'PLP' | 'PDP'
  productContextId      String?
  userQuery             String   @db.VarChar(256)
  productIds            String[]
  hadExactMatch         Boolean  @default(false)
  clickedProductId      String?
  assistantReplySnippet String?  @db.VarChar(256)
  clicked               Boolean  @default(false)
  createdAt             DateTime @default(now())

  @@index([createdAt])
  @@index([sessionId])
}

model CatalogIngestionRun {
  id          String        @id
  vendorId    String
  createdAt   DateTime      @default(now())
  totalRows   Int
  inserted    Int
  updated     Int
  invalidRows Int           @default(0)
  deactivated Int?
  mode        IngestionMode // 'FULL_REPLACE' | 'INCREMENTAL'

  @@index([createdAt])
  @@index([vendorId, createdAt])
}
```

### CSV Catalog Import

- Upload via `/admin/catalog` interface.
- Column mapping follows the unified schema:
  - **Identity fields**: `product_id` → `id`, `product_url` → `productUrl`, `image_url_primary` → `imageUrl`.
  - **Commercial fields**: `price` → `priceCents`, `sale_price` → `salePriceCents`, `availability` + `inventory` → `stockStatus`.
  - **Classification fields**: `category`, `subcategory`, `vertical`, `brand`, `google_product_category`, `product_type` → direct columns or `attributes`.
  - **Unified attributes**: `usage_contexts`, `style_tags`, `benefits`, `claims`, `sensory_profile`, `compatibility`, `materials`, `colors`, `sizes`, etc. → stored in `attributes` JSON for flexible, industry-agnostic search.
- The importer:
  - Supports full replace and incremental update modes.
  - Inserts rows in batches with progress tracking.
  - Infers `datasetContext` (vertical, primary facets, sample categories, recommended search examples) from the imported data to parameterize LLM prompts and search behavior.
  - Validates and sanitizes data to prevent schema errors.

---

## 6. Assistant Behaviour (End-to-End Flow)

1. **User sends a message from the single-page UI**

   The frontend supplies:

   - `sessionId` (persisted in localStorage, consistent across reloads/tabs)
   - `pageType` (for the demo, mostly `HOME`; `PDP` / `PLP` can be simulated)
   - `productContextId` (if asking about a specific product)
   - `message`
   - brief `history` array (last 5 messages)
   - `conversationContext` (lastIntent, lastConstraints, lastShownProductIds, lastUserQuery)

2. **Backend – Intent & Constraints Extraction**

   Call LLM with:

   - user query
   - minimal context (pageType, productContext summary)
   - `datasetContext` (vertical, primary facets, sample categories) to adapt the prompt to the catalog's profile

   LLM returns JSON with:

   - `intent`: `"discovery"`, `"pdp_suitability"`, or `"other"`
   - `constraints`: normalized `SearchConstraints` (using unified schema fields: useCases, benefits, styleTags, compatibility, etc.)
   - `expandedKeywords`: semantic synonyms and related searchable terms

3. **Backend – Search**

   - Call `searchProducts(constraints)`.
   - Apply:
     - sophisticated keyword ranking (identity → type → needs → specs → price)
     - merchandising rules
     - stock filters (hard filter for in-stock)
     - attribute filtering (schema-driven, vertical-aware)
   - If no results, relax constraints in tiers (drop attributes → drop category/price → drop brand).

4. **Backend – Product Evaluation & Relevance Check**

   - Evaluate product fit using attribute matching and keyword relevance.
   - Check if top products actually match the user's core intent keywords.
   - If less than 50% relevant, return "no relevant products" response (LLM-driven, dataset-aware).

5. **Backend – Final Response**

   Call LLM with:

   - user query
   - brand voice instructions
   - structured constraints
   - candidate products (title, price, attributes, `imageUrl`)
   - `datasetContext` to guide attribute explanations based on the catalog's vertical and available facets

   LLM produces:

   - `replyText` (industry-agnostic, vertical-aware, opener style)
   - reasons per product (`"Chosen because..."`), grounded in unified schema attributes only
   - `followupText` (two paragraphs: conclusion + follow-up questions)

6. **Backend – Response & Logging**

   - Stream progress updates via SSE (understanding → searching → evaluating → generating).
   - Persist `ConversationEvent`.
   - Return:
     - `replyText`
     - `productCards` (`id`, `title`, `priceLabel`, `keyAttributes[]`, `reason`, `url`)
     - `noExactMatch` boolean
     - `followupText`
     - `intent`

7. **Frontend – Render**

   - Append assistant message bubble with animated avatar.
   - Render product cards in a modern carousel layout (responsive, like ChatGPT Plugins / Gemini cards):
     - large product image
     - title + price
     - horizontal attribute tag chips
     - CTA buttons: **"View product"** and **"Ask about product"**
   - Display follow-up text below cards.
   - Auto-scroll to bottom.
   - Persist all messages to localStorage.

---

## 7. UI/UX Features

1. **Overall look & feel**

   - Light theme with soft gradients and rose accents.
   - Rounded corners, subtle shadows.
   - Minimalist typography similar in feel to ChatGPT / Grok / Gemini.
   - Smooth transitions and hover states.
   - Customizable brand colors via admin interface.

2. **Chat panel**

   - **Persistent sessions**: Chat history persists across reloads, tab closes, and browser restarts.
   - **Cross-tab sync**: Changes in one tab automatically sync to other tabs.
   - Message bubbles:
     - user (right-aligned), assistant (left-aligned with animated avatar)
     - clearly distinguish roles
   - **Progress tracking**: Visual progress bar showing current query stage.
   - **Suggested prompts**: Context-aware prompt suggestions above input (disappear when chat opens).
   - **Product context**: When asking about a product, shows product thumbnail and title above input.
   - **Dynamic placeholder**: LLM-generated, dataset-aware placeholder text.

3. **Product cards**

   - Grid/Carousel layout (horizontal scroll on smaller screens).
   - Each card:
     - product image at the top
     - title + price
     - row of attribute tags (top 3–5 relevant attributes from unified schema: e.g., benefits, useCases, styleTags, materials, colors, compatibility)
     - reason text: small, muted, starting with **"Chosen because…"**
     - primary CTA button: "View product"
     - secondary CTA: "Ask about product" (floating icon)

4. **Floating chat widget**

   - Animated bot avatar (synchronized across all instances).
   - Draggable and resizable window.
   - Position and size persist in localStorage.
   - Vertical suggestion pills when closed.

5. **Single-page site**

   - Simple hero section with brand name and dataset-aware tagline.
   - Product grid showing featured products.
   - The assistant panel anchored in the main content on desktop; full-screen overlay on mobile.

---

## 8. Setup & Development

### 8.1 Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (local or cloud, e.g., Neon)
- OpenAI API key (optional, for LLM features)

### 8.2 Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/tensoranalytics-kislay/Velou-shopping-assistant.git
   cd velou-shopping-assistant
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/velou"
   LLM_PROVIDER="openai"
   OPENAI_API_KEY="your-openai-api-key"
   PRIMARY_LLM_MODEL="gpt-4.1"
   REASONING_LLM_MODEL="o3-mini"
   LIGHT_LLM_MODEL="gpt-4.1-mini"
   ```

4. **Set up the database**:
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

5. **Run the development server**:
   ```bash
   npm run dev
   ```

6. **Access the application**:
   - Main site: http://localhost:3000
   - Admin: http://localhost:3000/admin

### 8.3 Uploading Your Catalog

1. Navigate to `/admin/catalog`
2. Click "Upload CSV"
3. Select your CSV file (must conform to unified schema)
4. Choose ingestion mode (Full Replace or Incremental)
5. Monitor progress and review results

### 8.4 Development Scripts

- `npm run dev` – Start development server
- `npm run build` – Build for production
- `npm run start` – Start production server
- `npm run lint` – Run ESLint
- `npm test` – Run tests
- `npm run test:watch` – Run tests in watch mode
- `npx prisma migrate dev` – Create and apply migrations
- `npx prisma generate` – Generate Prisma client

---

## 9. Key Features

### 9.1 Chat Persistence

- **Session persistence**: Chat messages, conversation context, and session ID are stored in localStorage.
- **Cross-tab synchronization**: Changes in one tab automatically sync to other tabs via storage events.
- **Auto-save**: Messages are automatically saved with 300ms debouncing.
- **Clear chat**: User can explicitly clear all persisted data via "Clear chat" button.

### 9.2 Real-Time Progress Tracking

- **Server-Sent Events (SSE)**: Streaming API provides real-time progress updates.
- **Visual progress bar**: Shows current query stage (understanding → searching → evaluating → generating).
- **Stage-specific labels**: Different labels for discovery, product Q&A, and non-contextual queries.

### 9.3 Product Q&A

- **Product-specific questions**: Click "Ask about product" on any card to ask questions about that specific product.
- **Text-only responses**: Product Q&A returns text-only answers (no product cards).
- **Context-aware**: Uses product attributes, highlights, and description to answer questions.

### 9.4 Sophisticated Keyword Search

- **Hierarchical ranking**: Products are ranked based on field importance:
  - Primary identity (title, brand, product_id) – very high
  - Type & category (category, subcategory) – high
  - Needs & benefits (description, benefits, claims) – high
  - Specs & ingredients (ingredients, materials) – medium-high
  - Price & availability – medium (filters & tie-breakers)
- **Multi-word keyword expansion**: Preserves multi-word phrases, expands to combinations and individual words.
- **Category/subcategory matching**: Checks both category and subcategory fields for broader matching.

### 9.5 Dataset-Aware Prompts

- **Dynamic greetings**: Initial greeting adapts to catalog vertical and available facets.
- **Context-aware suggestions**: Suggested prompts are generated based on last user message and catalog context.
- **Dynamic placeholder**: Chat input placeholder is LLM-generated and dataset-aware.
- **Vertical-specific language**: All prompts adapt to the catalog's vertical (skincare, apparel, home, etc.).

### 9.6 Appearance Customization

- **Brand logo**: Upload custom logo via admin interface.
- **Brand colors**: Customize primary, accent, background, surface, and border colors.
- **Live preview**: See color changes in real-time.

---

## 10. Security & Performance

- **React Server Components**: Using patched versions (React 19.2.1, Next.js 16.0.7) to address CVE-2025-55182.
- **Input validation**: All API endpoints validate input payloads.
- **Error handling**: Graceful fallbacks if LLM calls fail.
- **Connection pooling**: Prisma manages database connections efficiently.
- **Debounced persistence**: Chat messages are saved with 300ms debouncing to reduce localStorage writes.

---

## 11. Testing

- **Test framework**: Vitest
- **Test files**: Located in `tests/` directory
- **Run tests**: `npm test` or `npm run test:watch`
- **Test UI**: `npm run test:ui`

---

## 12. License

Private project – All rights reserved.

---

## 13. Support

For issues, questions, or contributions, please contact the development team.
