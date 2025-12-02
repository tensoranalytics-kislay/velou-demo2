# Velou Shopping Assistant – Unified Catalog Demo

## 1. Project Overview

This repo implements the **Velou Shopping Assistant** as a fully functional **demo prototype** for a **single merchant ecommerce site** with an **industry-agnostic, unified catalog engine**.

The assistant is:
- A **ChatGPT/Grok/Gemini-style on-site chat UI** embedded on a **single-page placeholder website**.
- Powered by a **unified catalog schema** that works across multiple verticals (apparel, skincare, home goods, electronics, etc.) as long as data conforms to the unified CSV format.
- Able to answer:
  - "What should I buy?" – natural language product discovery.
  - "Is this right for me?" – PDP-context suitability questions.
- Always responds with:
  - A short conversational answer.
  - A **professionally-designed product carousel** (cards) showing product details + attribute tags.

The core engine is **industry-agnostic** and **schema-driven**:
- LLM prompts and search behavior adapt to the catalog's vertical and available attributes via `datasetContext`.
- The unified schema supports classification fields (category, vertical, taxon_path), descriptive fields (benefits, claims, sensory_profile), and experiential fields (usage_contexts, style_tags, compatibility) that work across industries.
- Search heuristics and canonicalization are vertical-aware, applying industry-specific logic only when the catalog profile suggests it (e.g., fashion-specific category mapping for apparel catalogs).

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
2. **Run the import script**:
   ```bash
   npm run seed:catalog
   ```
   This will:
   - Read from your CSV file (defaults to the path configured in the script).
   - Map columns to the unified schema.
   - Infer `datasetContext` (vertical, primary facets, sample categories) from your data.
   - Store products in PostgreSQL with attributes preserved in JSON.

3. **The system automatically adapts**:
   - LLM prompts use `datasetContext` to describe the catalog's vertical and available facets.
   - Search heuristics detect the catalog profile (e.g., "fashion" vs generic) and apply vertical-specific logic only when appropriate.
   - Attribute filtering works with any unified schema fields (useCases, benefits, styleTags, compatibility, etc.).

---

## 2. MVP Scope

### 2.1 In Scope (Demo)

- **Single-page site** (Next.js):
  - Hero section (brand feel).
  - Main panel with **chat assistant** and product card responses.
- **Chat assistant features:**
  - Free-form discovery queries:
    - e.g. "almond-scented body scrub under $50", "minimalist bathroom towels", "beach wedding dress under $200".
  - Refinement:
    - "cheaper", "more colorful", "only size M", "for sensitive skin".
  - PDP-style suitability questions (simulated via context):
    - "Is this good for humid weather?", "Will this work for dry skin?", "Is this suitable for a guest bathroom?"
  - Always:
    - short conversational reply.
    - 3–8 product cards with:
      - image
      - title
      - price
      - key attribute tags (chips)
      - one-line “Chosen because…” reason
      - CTA: “View product”.

- **Admin-style configuration (single-merchant, simple UI):**
  - Brand voice instructions (tone + style).
  - Tone sliders: formal/casual, playful/serious.
  - Simple merchandising rules:
    - hide out-of-stock items.
    - boost/exclude categories.
  - LLM configuration:
    - Provider: **OpenAI** (gpt-4.1 stack) or fully mocked for tests.
    - Toggle: “use Velou key” vs “use merchant key”.

- **Catalog ingestion:**
  - CSV upload through admin interface with automatic schema mapping and dataset context inference.
  - Each product includes:
    - ID, title, description, image URL (placeholder), price, currency.
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
  - # of “no exact match” responses.

### 2.2 Out of Scope (Demo)

- Multi-merchant support.
- Order tracking, returns, shipping/FAQ.
- Multi-language.
- External channels (WhatsApp/SMS/Email).
- Review integration.
- Deep personalization / CDP integration.

---

## 3. Tech Stack

- **Framework:** Next.js (App Router) + TypeScript.
- **Styling:** Tailwind CSS + modern UI patterns (glassmorphism, soft gradients).
- **DB:** PostgreSQL (e.g. Neon or similar) via Prisma.
- **LLM providers:**
  - Primary: **OpenAI API** (default `gpt-5` for highest quality tasks).
  - Reasoning: **OpenAI `o3-mini`** for complex logical analysis (intent parsing, suitability).
  - Lightweight: **OpenAI `gpt-4.1-mini`** for cost-effective simple tasks.
  - Optional local/mock provider for development.

- **Hosting (demo):**
  - Next.js app on Vercel or similar.
  - PostgreSQL as managed cloud DB.

### 3.1 LLM Configuration

The assistant supports two modes via the `LLM_PROVIDER` environment variable:

- **`openai`** (default): Uses OpenAI Chat Completions with a dual-model routing strategy.
- **`mock`**: Deterministic, rule-based parsing for development or automated tests (no API calls).

**Key environment variables:**
- `OPENAI_API_KEY` – required when `LLM_PROVIDER=openai`
- `PRIMARY_LLM_MODEL` – defaults to `gpt-5`, used for final replies and dataset analysis
- `REASONING_LLM_MODEL` – defaults to `o3-mini`, used for intent parsing and suitability analysis (complex reasoning)
- `LIGHT_LLM_MODEL` – defaults to `gpt-4.1-mini`, used for inexpensive helper tasks (card reasons, lightweight transforms)

See `docs/llm_model_selection.md` for detailed model selection strategy.

The system always falls back to rule-based parsing if LLM calls fail, ensuring the assistant remains functional even when external APIs are unavailable.

---

## 4. High-Level Architecture

### 4.1 Components

1. **Next.js App (Single Codebase)**
   - `/` – single-page placeholder website with:
     - brand hero section.
     - chat assistant panel.
   - `/admin/*` – simple admin console:
     - BrandVoice
     - Appearance
     - MerchRules
     - LLMConfig
     - Metrics

2. **Assistant API (Next.js API Route)**
   - `POST /api/assistant` – main chat endpoint:
     - Input: sessionId, pageType (HOME/PLP/PDP), productContextId (optional), message, brief history.
     - Output: replyText, productCards[], noExactMatch.
   - `POST /api/metrics/product-click` – track card → PDP clicks.
   - `GET /api/health` – health check.

3. **Search / Index Layer (Internal library)**
   - `searchProducts(constraints: SearchConstraints)`.
   - Backed by Prisma + PostgreSQL.
   - Supports unified schema attributes:
     - Classification: category, subcategory, vertical, price range.
     - Industry-agnostic facets: colors, sizes, materials, useCases, styleTags, benefits, compatibility, sensoryProfile.
     - Vertical-specific facets (when applicable): fabric, fit, occasion, season (for fashion), claims (for beauty).
   - Applies merchandising rules (boost/exclude).
   - Attribute filtering is schema-driven and vertical-aware via `datasetContext`.

4. **LLM Orchestration Layer**
   - All LLM calls go through a **single adapter**:
    - `src/lib/llm/provider.ts` (OpenAI adapter + mock fallback).
   - Orchestrator:
     - step 1: parse intent + constraints from user query and lightweight context (uses `datasetContext` to adapt prompts to catalog vertical).
     - step 2: call search module to get candidate products.
     - step 3: generate final conversational answer + "Chosen because…" reasons, grounded in product JSON (uses `datasetContext` to guide attribute explanations).
   - Prompts are **industry-agnostic** and **vertical-aware**:
     - `buildIntentAndConstraintsPrompt(datasetContext)` adapts examples and facet guidance based on the catalog's vertical.
     - `buildFinalResponsePrompt(datasetContext)` describes the assistant's role and available attributes based on the catalog profile.
   - Guardrails:
     - Only reference attributes from product JSON.
     - No invented discounts/stock/shipping claims.

5. **CSV Catalog Importer**
   - Script (`scripts/importCatalogFromCsv.ts`) ingests unified catalog CSV files conforming to the unified schema and writes normalized products into Postgres with all attributes preserved for intent/search.
   - During import, the system infers `datasetContext` (vertical, primary facets, sample categories) from the data to parameterize LLM prompts and search heuristics.

---

## 5. Data Model (Summary)

Using Prisma-style notation:

```ts
model Product {
  id           String   @id
  title        String
  description  String
  imageUrl     String
  productUrl   String
  priceCents   Int
  salePriceCents Int?
  currency     String
  category     String
  subcategory  String?
  brand        String?
  attributes   Json     // unified schema attrs: usage_contexts, style_tags, benefits, claims, sensory_profile, compatibility, materials, colors, sizes, etc. (industry-agnostic)
  stockStatus  String   // 'in_stock' | 'out_of_stock' | 'low_stock'
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model BrandConfig {
  id                Int      @id @default(1)
  brandName         String
  primaryColor      String
  accentColor       String
  voiceInstructions String
  toneFormal        Int      // 0-10
  tonePlayful       Int      // 0-10
  useMerchantKey    Boolean  @default(false)
  merchantOpenAIKey String?
}

model MerchRule {
  id       Int    @id @default(autoincrement())
  ruleType String // 'boost_category' | 'exclude_category' | 'hide_out_of_stock'
  value    String // category or tag
  weight   Int
  isActive Boolean @default(true)
}

model ConversationEvent {
  id               String   @id @default(cuid())
  sessionId        String
  pageType         String   // 'HOME' | 'PLP' | 'PDP'
  productContextId String?
  userQuery        String
  assistantReply   String?
  productIds       String[]
  hadExactMatch    Boolean?
  clickedProductId String?
  createdAt        DateTime @default(now())
}

### CSV Catalog Import

- `npm run seed:catalog` ingests unified catalog CSV files conforming to the schema defined in `src/lib/catalog/unifiedSchemaConfig.ts`.
- Column mapping follows the unified schema:
  - **Identity fields**: `product_id` → `id`, `product_url` → `productUrl`, `image_url_primary` → `imageUrl`.
  - **Commercial fields**: `price` → `priceCents`, `sale_price` → `salePriceCents`, `availability` + `inventory` → `stockStatus`.
  - **Classification fields**: `category`, `subcategory`, `vertical`, `brand`, `google_product_category`, `product_type` → direct columns or `attributes`.
  - **Unified attributes**: `usage_contexts`, `style_tags`, `benefits`, `claims`, `sensory_profile`, `compatibility`, `materials`, `colors`, `sizes`, etc. → stored in `attributes` JSON for flexible, industry-agnostic search.
- The importer:
  - Clears the `Product` table first.
  - Inserts rows in batches of 500.
  - Infers `datasetContext` (vertical, primary facets, sample categories) from the imported data to parameterize LLM prompts and search behavior.

### 6. Assistant Behaviour (End-to-End Flow)

1. **User sends a message from the single-page UI**

   The frontend supplies:

   - `sessionId`
   - `pageType` (for the demo, mostly `HOME`; `PDP` / `PLP` can be simulated)
   - `productContextId` (if simulating PDP)
   - `message`
   - brief `history` array

2. **Backend – Intent & Constraints Extraction**

   Call LLM with:

   - user query
   - minimal context (pageType, productContext summary)
   - `datasetContext` (vertical, primary facets, sample categories) to adapt the prompt to the catalog's profile

   LLM returns JSON with:

   - `intent`: `"discovery"` or `"pdp_suitability"`
   - `constraints`: normalized `SearchConstraints` (using unified schema fields: useCases, benefits, styleTags, compatibility, etc.)

3. **Backend – Search**

   - Call `searchProducts(constraints)`.
   - Apply:
     - merchandising rules
     - stock filters

4. **Backend – Final Response**

   Call LLM with:

   - user query
   - brand voice instructions
   - structured constraints
   - candidate products (title, price, attributes, `imageUrl`)
   - `datasetContext` to guide attribute explanations based on the catalog's vertical and available facets

   LLM produces:

   - `replyText` (industry-agnostic, vertical-aware)
   - reasons per product (`"Chosen because..."`), grounded in unified schema attributes only

5. **Backend – Response & Logging**

   - Persist `ConversationEvent`.
   - Return:
     - `replyText`
     - `productCards` (`id`, `title`, `priceLabel`, `keyAttributes[]`, `reason`, `url`)
     - `noExactMatch` boolean

6. **Frontend – Render**

   - Append assistant message bubble.
   - Render product cards in a modern carousel layout (responsive, like ChatGPT Plugins / Gemini cards):
     - large product image
     - title + price
     - horizontal attribute tag chips
     - CTA button **“View product”**

---

### 7. UI/UX Requirements

1. **Overall look & feel**

   - Dark or light theme with soft gradients.
   - Rounded corners, subtle shadows.
   - Minimalist typography similar in feel to ChatGPT / Grok / Gemini.
   - Smooth transitions and hover states.

2. **Chat panel**

   - Message bubbles:
     - user (right-aligned), assistant (left-aligned)
     - clearly distinguish roles
   - Loading state:
     - skeleton or animated “thinking” indicator

3. **Product cards**

   - Grid/Carousel layout (horizontal scroll on smaller screens).
   - Each card:
     - product image at the top
     - title + price
     - row of attribute tags (top 3–5 relevant attributes from unified schema: e.g., benefits, useCases, styleTags, materials, colors, compatibility)
     - reason text: small, muted, starting with **"Chosen because…"**
     - primary CTA button

4. **Single-page site**

   - Simple hero section with brand name and a tagline.
   - The assistant panel anchored in the main content on desktop; full-screen overlay on mobile.

---

### 9. LLM Provider Strategy

- **Environment variables:**
- `LLM_PROVIDER`: `"openai"` | `"mock"`
- `PRIMARY_LLM_MODEL`: defaults to `gpt-4.1`
- `LIGHT_LLM_MODEL`: defaults to `gpt-4.1-mini`
  - `OPENAI_API_KEY`: optional

- **Single adapter module:**

  - `src/lib/llm/provider.ts`:
    - `callLLM(options): Promise<LLMResult>`

  - Switch implementation based on `LLM_PROVIDER` and merchant config.

- **Behavior:**

  - If merchant config says **“use my key”** and key is valid → use that.
  - Else → use Velou key for selected provider.
  - If provider/API key missing → return a graceful error that the assistant can render as **“temporarily unavailable.”**

---

### 10. Development Phases (Recommended)

1. **Phase 1 – Setup & Schema**

   - Next.js + Tailwind + Prisma + PostgreSQL.
   - Schema defined and migrated.
   - Health check endpoint.

2. **Phase 2 – Catalog Ingestion & Search**

   - Implement CSV catalog ingestion and import.
   - Implement search module with simple filters + merchandising rules.
   - Build a dev-only `/debug/catalog` view.

3. **Phase 3 – LLM Orchestration & API**

   - Implement LLM provider adapter.
   - Implement:
     - intent + constraints call
     - discovery and PDP-like flows
     - final reply generation
   - Wire `/api/assistant`.

4. **Phase 4 – Chat UI & Product Cards**

   - Implement single-page UI with:
     - hero section
     - chat panel
     - modern product cards
   - Connect to `/api/assistant`.

5. **Phase 5 – Admin & Metrics**

   - Implement simple admin layout and forms.
   - Wire `BrandConfig`, `MerchRule`, `LLMConfig`.
   - Track `ConversationEvent` + product click metrics.

6. **Phase 6 – Polish & Demo Script**

   - UX polishing (animations, transitions).
   - Seed realistic unified catalog data across multiple verticals and test end-to-end demo scenarios.
