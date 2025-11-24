# Velou Shopping Assistant – Demo Prototype (Single Merchant, Apparel)

## 1. Project Overview

This repo implements the **Velou Shopping Assistant** as a fully functional **demo prototype** for a **single fashion/apparel ecommerce site**.

The assistant is:
- A **ChatGPT/Grok/Gemini-style on-site chat UI** embedded on a **single-page placeholder website**.
- Powered by **Velou-style enriched apparel catalog data** stored in PostgreSQL.
- Able to answer:
  - “What should I buy?” – natural language product discovery.
  - “Is this right for me?” – PDP-context suitability questions.
- Always responds with:
  - A short conversational answer.
  - A **professionally-designed product carousel** (cards) showing product details + attribute tags.

For this demo, the catalog is sourced from the provided Lucky Brand CSV feed (`products_2025-11-20_10:52:20.csv`). The importer preserves all rich apparel attributes (fabric, fit, length, occasion, pattern, season, etc.) so the assistant can reason about outfits in a grounded way.

The goal is to **prove end-to-end feasibility and UX quality** for one real merchant, not to build a multi-tenant SaaS.

---

## 2. MVP Scope

### 2.1 In Scope (Demo)

- **Single-page site** (Next.js):
  - Hero section (brand feel).
  - Main panel with **chat assistant** and product card responses.
- **Chat assistant features:**
  - Free-form discovery queries:
    - e.g. “beach wedding dress under $200, not bodycon, pastel color”.
  - Refinement:
    - “cheaper”, “more colorful”, “only size M”.
  - PDP-style suitability questions (simulated via context):
    - “Is this good for humid weather?”
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
    - Provider: **Perplexity** if configured, otherwise **OpenAI**.
    - Toggle: “use Velou key” vs “use merchant key”.

- **Mock catalog data generation:**
  - Script to generate a **mock, enriched apparel catalog** (tops, dresses, pants, outerwear, etc.).
  - Each product includes:
    - ID, title, description, image URL (placeholder), price, currency.
    - Category/subcategory/brand.
    - Attributes JSON:
      - fabric
      - fit
      - length
      - pattern
      - season
      - occasion
      - use-cases (e.g. “beach wedding”, “office”, “casual weekend”)
      - color
      - size options.
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
  - Primary: **Perplexity API** (if `LLM_PROVIDER=perplexity` and keys provided).
  - Fallback: **OpenAI API** (if `LLM_PROVIDER=openai`).
  - Optional local/mock provider for development.

- **Hosting (demo):**
  - Next.js app on Vercel or similar.
  - PostgreSQL as managed cloud DB.

### 3.1 LLM Configuration

The assistant supports three modes via the `LLM_PROVIDER` environment variable:

- **`mock`** (default): Uses deterministic rule-based parsing for intent/constraints and reply generation. Fully functional without any API keys. This is the recommended mode for development and demos.

- **`openai`**: Uses OpenAI's Chat Completions API for enhanced intent parsing and reply text generation. Requires `OPENAI_API_KEY` to be set. Falls back to rule-based logic if the API call fails.

- **`perplexity`**: Reserved for future Perplexity API integration. Currently throws a clear "not implemented" error if selected.

**Required keys:**
- `LLM_PROVIDER=openai` → `OPENAI_API_KEY` must be set
- `LLM_PROVIDER=perplexity` → `PERPLEXITY_API_KEY` must be set (when implemented)
- `LLM_PROVIDER=mock` → No keys required

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
   - Supports:
     - category, subcategory, price range.
     - size, color, fabric, fit, season, occasion, use-cases.
     - stock filtering.
   - Applies merchandising rules (boost/exclude).

4. **LLM Orchestration Layer**
   - All LLM calls go through a **single adapter**:
     - `src/lib/llm/provider.ts` (Perplexity/OpenAI).
   - Orchestrator:
     - step 1: parse intent + constraints from user query and lightweight context.
     - step 2: call search module to get candidate products.
     - step 3: generate final conversational answer + “Chosen because…” reasons, grounded in product JSON.
   - Guardrails:
     - Only reference attributes from product JSON.
     - No invented discounts/stock/shipping claims.

5. **CSV Catalog Importer**
   - Script (`scripts/importCatalogFromCsv.ts`) ingests the Lucky Brand CSV feed (~13k rows) and writes the normalized apparel catalog into Postgres with all rich attributes preserved for intent/search.

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
  attributes   Json     // enriched attrs: fabric, fit, length, pattern, season, occasion, useCase, color, sizes, etc.
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

- `npm run seed:catalog` ingests `/mnt/data/products_2025-11-20_10:52:20.csv` (falls back to the repo copy if the mounted path is unavailable).
- Column mapping highlights:
  - `title`, `description`, `image link`, `link`, `brand`, `google product category`, `product type`, `custom label 4`.
  - `price` → `priceCents` (USD) plus the raw string stored in `attributes.price`.
  - `sale price` → optional `salePriceCents` plus the raw string stored in `attributes.salePrice`.
  - `link` → `productUrl` (used for “View product”).
  - `availability` + `inventory` → `stockStatus` (`in_stock`, `low_stock`, `out_of_stock`).
  - Remaining feed columns (`condition`, `age group`, `gender`, `material`, etc.) are preserved in `attributes` using camelCase keys so search + LLM prompts can reference them directly.
- The importer clears the `Product` table first, then inserts rows in batches of 500 until all ~13k products are written.

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

   LLM returns JSON with:

   - `intent`: `"discovery"` or `"pdp_suitability"`
   - `constraints`: normalized `SearchConstraints`

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

   LLM produces:

   - `replyText`
   - reasons per product (`"Chosen because..."`), grounded in attributes only

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
     - row of attribute tags (fabric, fit, occasion, color)
     - reason text: small, muted, starting with **“Chosen because…”**
     - primary CTA button

4. **Single-page site**

   - Simple hero section with brand name and a tagline.
   - The assistant panel anchored in the main content on desktop; full-screen overlay on mobile.

---

### 8. Mock Data Generation

Implement a script, e.g. `scripts/generateMockCatalog.ts`, that:

- Uses predefined lists for:

  - `categories`: `["Dresses", "Tops", "Pants", "Outerwear", "Skirts"]`
  - `fabrics`: `["cotton", "linen", "silk", "polyester blend", "wool blend"]`
  - `fits`: `["regular", "slim", "relaxed", "oversized", "bodycon"]`
  - `lengths`: `["mini", "midi", "maxi", "waist-length", "ankle-length"]`
  - `patterns`: `["solid", "floral", "striped", "checked", "abstract"]`
  - `seasons`: `["summer", "winter", "spring", "autumn", "all-season"]`
  - `occasions`: `["beach wedding", "office", "casual weekend", "formal event", "date night"]`
  - `colors`: `["black", "white", "navy", "pastel pink", "sage", "beige", "bright red"]`
  - `sizes`: `["XS", "S", "M", "L", "XL"]`

- Randomly composes products with coherent combinations (e.g. `linen + summer + beach wedding`).
- Adds realistic price ranges.
- Populates `attributes` JSON and `stockStatus`.

No LLM is required for mock data (to keep it free); fallback to static templates is fine for the demo.

---

### 9. LLM Provider Strategy

- **Environment variables:**
  - `LLM_PROVIDER`: `"perplexity"` | `"openai"` | `"mock"`
  - `PERPLEXITY_API_KEY`: optional
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

2. **Phase 2 – Mock Catalog & Search**

   - Implement mock catalog generator and import.
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
   - Seed realistic apparel data and test end-to-end demo scenarios.
