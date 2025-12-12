# Velou Shopping Assistant – Productization Roadmap
## Transitioning from MVP to Enterprise SaaS Platform

**Document Version:** 1.0  
**Date:** December 2025  
**Status:** Architecture & Implementation Planning

---

## Executive Summary

This document outlines the comprehensive transformation of Velou from a single-merchant MVP to an **enterprise-ready SaaS platform** capable of serving multiple merchants with embeddable chat widgets, integrated data sources (Shopify, reviews), analytics, and secure admin authentication.

**Core Premise:** Transform from a single-page website with embedded chat → **white-label, embeddable widget** that works on any website (Shopify, WordPress, custom sites).

---

## Table of Contents

1. [Overview of Changes](#1-overview-of-changes)
2. [Architecture Redesign](#2-architecture-redesign)
3. [Change 1: Widget Separation & Embedding](#3-change-1-widget-separation--embedding)
4. [Change 2: Authentication & Security](#4-change-2-authentication--security)
5. [Change 3: Shopify Integration](#5-change-3-shopify-integration)
6. [Change 4: Dataset Schema & Shopify Ranking](#6-change-4-dataset-schema--shopify-ranking-integration)
7. [Change 5: Review Platform Integration](#7-change-5-review-platform-integration)
8. [Change 6: User Behavior Tracking & Analytics](#8-change-6-user-behavior-tracking--analytics)
9. [Implementation Phases](#9-implementation-phases)
10. [Migration Plan](#10-migration-plan)
11. [Data Flow Diagrams](#11-data-flow-diagrams)

---

## 1. Overview of Changes

### Current MVP Architecture (Single-Merchant)
- **Single-page site** with embedded chat widget
- **Hardcoded** brand configuration
- **No authentication** (demo purposes)
- **No external integrations**
- **Minimal analytics** (conversation counts, CTR)

### Productized Architecture (Multi-Merchant SaaS)
```
┌─────────────────────────────────────────────────────────────────┐
│                    VELOU CONTROL PLANE                          │
│  (Velou.ai/admin - Multi-Merchant Admin Portal)                 │
│  ├─ Authentication (Local + Optional OAuth2)                    │
│  ├─ Merchant Setup & Onboarding                                 │
│  ├─ Widget Configuration & Installation                         │
│  └─ Analytics Dashboard                                         │
└────────┬──────────────────────────────────────────────────────┬─┘
         │                                                        │
    ┌────▼────────────────┐                      ┌───────────────▼─────┐
    │  MERCHANT WEBSITES   │                      │  DATA INTEGRATIONS  │
    │  (Shopify, WP, etc)  │                      │  ├─ Shopify API     │
    │  ├─ Velou Widget JS  │◄─ SSE Connection ───┤  ├─ Review APIs     │
    │  └─ UI Host Site     │  ┌─────────────────►  ├─ CSV Upload       │
    └─────────────────────┘  │                      └─────────────────┘
                            │
                    ┌───────▼─────────────────┐
                    │  VELOU API GATEWAY      │
                    │  (Core Engine)          │
                    │  ├─ /api/widget/*       │
                    │  ├─ /api/admin/*        │
                    │  ├─ /api/integrations/* │
                    │  └─ /api/analytics/*    │
                    └───────┬─────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
    ┌───────▼─────┐  ┌──────▼──────┐  ┌────▼────────┐
    │  PostgreSQL │  │ Redis Cache │  │ File Storage│
    │  - Products │  │ - Sessions  │  │ - Logos    │
    │  - Merchants│  │ - Analytics │  │ - Images   │
    │  - Events   │  │             │  │            │
    └─────────────┘  └─────────────┘  └────────────┘
```

### Key Changes at a Glance

| Aspect | MVP | Productized |
|--------|-----|-------------|
| **Deployment** | Single merchant on Velou domain | Embeddable widget on client sites |
| **Installation** | N/A (one site) | Installation script for any website |
| **Authentication** | None | Local auth + JWT tokens for admins |
| **Data Sources** | CSV only | CSV + Shopify + Reviews APIs |
| **Ranking** | Catalog-based | Shopify ranking (bestseller, trending) |
| **Admin** | Basic config UI | Full multi-merchant dashboard |
| **Analytics** | Basic metrics | Comprehensive behavior tracking |
| **Scalability** | Single database | Multi-tenant isolation |
| **Security** | None | Secure API authentication, CORS |

---

## 2. Architecture Redesign

### 2.1 Monolithic → Modular Architecture

**Current Issue:** API routes tightly coupled to single merchant context

**Solution:** Introduce **multi-tenant context injection** throughout the application

```typescript
// Current (MVP):
POST /api/assistant/stream
  → handleAssistantQuery()
    → searchProducts()  // Which merchant?
    
// Productized:
POST /api/widget/{merchantId}/assistant/stream
  → requireWidgetAuth(merchantId)  // Verify widget token
    → getMerchantContext(merchantId)
      → handleAssistantQuery(merchantContext)
        → searchProducts({ merchantId, ...constraints })
```

### 2.2 Services Layer (Addressing Refactoring Needs)

The existing monolithic files need decomposition into service layer:

```typescript
// NEW: src/lib/services/ (Domain-specific services)
├── AssistantService.ts          // Orchestrator wrapper
├── CatalogService.ts            // Product management
├── SearchService.ts             // Search operations
├── WidgetService.ts             // Widget generation & config
├── IntegrationService.ts        // External APIs (Shopify, reviews)
├── AnalyticsService.ts          // Event tracking & insights
└── MerchantService.ts           // Merchant management

// UPDATED: src/lib/llm/
├── orchestrator/
│   ├── flows/                   // Split flows (current refactor)
│   │   ├── discovery.ts
│   │   ├── pdp.ts
│   │   ├── pending.ts
│   │   └── productQa.ts
│   ├── index.ts
│   └── helpers.ts
└── provider.ts

// UPDATED: src/lib/search/
├── index.ts
├── ranking/
│   ├── dbRankedSearch.ts
│   ├── shopifyRanking.ts        // NEW
│   ├── relevance.ts
│   └── weights.ts
├── filtering/
│   ├── attributes.ts
│   ├── category.ts
│   └── relaxation.ts
└── query/
    ├── buildFilters.ts
    └── calculateTake.ts

// NEW: src/lib/integrations/
├── shopify/
│   ├── client.ts                // Shopify API wrapper
│   ├── webhooks.ts              // Real-time updates
│   ├── rankingSync.ts           // Sync bestseller/trending
│   └── schema.ts
├── reviews/
│   ├── client.ts                // Multi-platform API
│   ├── providers.ts             // Trustpilot, Reviews.io, etc.
│   └── enrichment.ts            // Embed reviews in responses
└── csvImport.ts

// NEW: src/lib/analytics/
├── eventTracker.ts              // Client-side & server-side
├── behaviorAnalytics.ts         // User interaction patterns
├── sessionManager.ts            // Cross-domain sessions
└── insights.ts                  // Aggregated analytics
```

### 2.3 Database Schema - Multi-Tenant Model

**Current:** Single `BrandConfig` (hardcoded as id=1)

**Productized:** Full merchant isolation

```prisma
// Add multi-tenancy
model Merchant {
  id                    String      @id @default(cuid())
  
  // Identification
  slug                  String      @unique  // acme-corp
  name                  String
  
  // Branding
  brandName             String
  primaryColor          String      @default("#e11d48")
  accentColor           String      @default("#f97373")
  backgroundColor       String      @default("#ffffff")
  surfaceColor          String      @default("#fff7f7")
  borderColor           String      @default("#ffe4e6")
  logoUrl               String?
  voiceInstructions     String
  toneFormal            Int         // 0-10
  tonePlayful           Int         // 0-10
  
  // LLM Configuration
  useMerchantKey        Boolean     @default(false)
  merchantOpenAIKey     String?     @encrypted
  datasetContext        Json?
  
  // Shopify Integration (NEW)
  shopifyStore          String?     // acme.myshopify.com
  shopifyAccessToken    String?     @encrypted
  shopifySyncEnabled    Boolean     @default(false)
  shopifySyncedAt       DateTime?
  
  // Review Integration (NEW)
  reviewProvider        String?     // trustpilot, reviews.io, etc.
  reviewApiKey          String?     @encrypted
  reviewSyncEnabled     Boolean     @default(false)
  
  // Relations
  products              Product[]
  merchRules            MerchRule[]
  apiKeys               ApiKey[]
  users                 MerchantUser[]
  analyticsEvents       AnalyticsEvent[]
  
  createdAt             DateTime    @default(now())
  updatedAt             DateTime    @updatedAt
  
  @@index([slug])
}

// Authentication
model MerchantUser {
  id                    String      @id @default(cuid())
  merchantId            String
  merchant              Merchant    @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  
  email                 String
  passwordHash          String      @encrypted
  role                  UserRole    // admin, editor, viewer
  
  isActive              Boolean     @default(true)
  lastLogin             DateTime?
  
  createdAt             DateTime    @default(now())
  updatedAt             DateTime    @updatedAt
  
  @@unique([merchantId, email])
  @@index([merchantId])
}

// Widget Installation
model ApiKey {
  id                    String      @id @default(cuid())
  merchantId            String
  merchant              Merchant    @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  
  name                  String
  token                 String      @unique @db.Text
  allowedOrigins        String[]    // CORS whitelist
  
  isActive              Boolean     @default(true)
  createdAt             DateTime    @default(now())
  
  @@index([merchantId])
}

// Update Product model
model Product {
  // ... existing fields ...
  merchantId            String      // NEW - Required for all products
  merchant              Merchant    @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  
  // Shopify Integration (NEW)
  shopifyProductId      String?     // ID from Shopify API
  shopifyHandle         String?
  shopifyVariantIds     String[]    // Array of variant IDs
  shopifyBestseller     Boolean     @default(false)
  shopifyTrending       Boolean     @default(false)
  shopifySalesRank      Int?        // Position in bestsellers
  
  // Review Integration (NEW)
  reviewScore           Float?      // Aggregated review rating
  reviewCount           Int?
  reviewsJson           Json?       // Store review snippets
  
  @@index([merchantId])
  @@index([shopifyProductId])
}

// Analytics Events (NEW)
model AnalyticsEvent {
  id                    String      @id @default(cuid())
  merchantId            String
  merchant              Merchant    @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  
  sessionId             String      // Cross-domain session
  eventType             String      // message_sent, product_viewed, product_clicked, etc.
  payload               Json        // Dynamic event data
  
  // User Context (First-party data, non-PII)
  userDevice            String?     // mobile, tablet, desktop
  userPage              String?     // Merchant's page URL
  userReferer           String?     // Where user came from
  
  createdAt             DateTime    @default(now())
  
  @@index([merchantId, createdAt])
  @@index([sessionId])
}

enum UserRole {
  ADMIN
  EDITOR
  VIEWER
}
```

### 2.4 API Structure

```
/api/
├── widget/                    // PUBLIC (requires CORS + widget token)
│   ├── {merchantId}/
│   │   ├── assistant/stream   POST (SSE)
│   │   ├── chat/greeting      GET
│   │   ├── chat/placeholder   GET
│   │   ├── suggestions        GET
│   │   ├── analytics/event    POST (track events)
│   │   └── config             GET (widget config)
│
├── admin/                     // PRIVATE (requires auth)
│   ├── auth/
│   │   ├── login              POST
│   │   ├── logout             POST
│   │   ├── refresh            POST
│   │   └── me                 GET (current user)
│   │
│   ├── merchant/
│   │   ├── profile            GET, PATCH
│   │   ├── branding           GET, PATCH
│   │   ├── users              GET, POST, DELETE
│   │   └── apiKeys            GET, POST, DELETE
│   │
│   ├── catalog/
│   │   ├── import             POST (CSV upload)
│   │   ├── products           GET, PATCH
│   │   └── stats              GET
│   │
│   ├── integrations/
│   │   ├── shopify/
│   │   │   ├── connect        POST
│   │   │   ├── disconnect     DELETE
│   │   │   ├── status         GET
│   │   │   └── sync           POST
│   │   │
│   │   └── reviews/
│   │       ├── connect        POST
│   │       ├── disconnect     DELETE
│   │       ├── status         GET
│   │       └── sync           POST
│   │
│   ├── merch-rules            GET, POST, PATCH, DELETE
│   ├── llm-config             GET, PATCH
│   │
│   └── analytics/
│       ├── conversations      GET (list conversations)
│       ├── events             GET (raw events)
│       ├── dashboard          GET (aggregated metrics)
│       └── export             GET (CSV export)
│
└── integrations/              // WEBHOOKS (Shopify, review platforms)
    ├── shopify/webhook        POST
    └── reviews/webhook        POST
```

---

## 3. Change 1: Widget Separation & Embedding

### 3.1 Current State
- Single-page site with embedded chat
- Chat widget in `src/app/page.tsx` (tightly coupled)
- No way to embed on external sites

### 3.2 Solution: Embeddable Widget as NPM Package + CDN Script

#### Option A: NPM Package (for developers)
```bash
npm install @velou/widget
```

```javascript
// On any React/Next.js site
import { VeloutWidget } from '@velou/widget';

export default function App() {
  return (
    <>
      <h1>My Store</h1>
      <VeloutWidget
        merchantId="acme-corp"
        apiKey="pk_live_xxx"
        primaryColor="#e11d48"
      />
    </>
  );
}
```

#### Option B: CDN Script (for non-developers, Shopify, WordPress, Wix)
```html
<!-- On any website -->
<script src="https://cdn.velou.ai/widget.js" data-merchant-id="acme-corp" data-api-key="pk_live_xxx"></script>
```

This injects the widget into a target element (default: floating button) with zero dependencies.

#### Option C: Shopify App (for Shopify stores)
```
Install from Shopify App Store → Auto-embeds widget in Shopify theme
Admins configure via Shopify settings → Syncs with Velou dashboard
```

### 3.3 Implementation Details

#### Widget Package Structure
```
@velou/widget/
├── src/
│   ├── components/
│   │   ├── ChatWidget.tsx          // Main widget component (refactored from MVP)
│   │   ├── ChatPanel.tsx
│   │   ├── ProductCard.tsx
│   │   └── ProgressTracker.tsx
│   │
│   ├── hooks/
│   │   ├── useAssistantQuery.ts    // Moved from lib
│   │   ├── useChatPersistence.ts
│   │   └── useAnalytics.ts         // NEW
│   │
│   ├── services/
│   │   ├── apiClient.ts            // Widget-specific API calls
│   │   └── sessionManager.ts       // Cross-domain sessions
│   │
│   ├── styles/
│   │   └── widget.css              // Encapsulated styles (no Tailwind conflict)
│   │
│   ├── CDN/
│   │   └── loader.js               // Entry point for CDN script
│   │
│   └── index.ts                    // NPM package entry
```

#### Widget SDK API
```typescript
// Global window object for CDN script
window.VeloutWidget = {
  mount(config: WidgetConfig): void
  unmount(): void
  setMerchantId(id: string): void
  setUserId(id: string): void          // For behavior tracking
  track(event: string, data: any): void // Custom events
  getSessionId(): string
}

interface WidgetConfig {
  merchantId: string              // Required
  apiKey: string                  // Required (public key)
  primaryColor?: string           // Optional override
  position?: 'bottom-right' | 'bottom-left' | 'float'
  initialMessage?: string
  onReady?: () => void
  onMessage?: (msg: Message) => void
  onProductClick?: (product: Product) => void
  userId?: string                 // Optional, for tracking
}
```

#### API Call Flow with Widget Token
```typescript
// Widget runs on merchant's domain (e.g., acme.com)
// API runs on velou.ai

// 1. Widget sends request with API key (public, safe)
fetch('https://api.velou.ai/api/widget/acme-corp/assistant/stream', {
  headers: {
    'Authorization': 'Bearer pk_live_xxx',
    'X-Widget-Origin': 'acme.com',
    'X-Session-Id': 'sess_xxx'
  },
  body: { message: 'almond scrub' }
})

// 2. Backend validates:
//    - API key belongs to acme-corp
//    - Origin matches allowedOrigins
//    - Session is valid
// 3. Returns SSE stream
```

#### CORS & Security
```typescript
// API Gateway (src/middleware/cors.ts)
export function corsHeaders(req: Request, merchantId: string) {
  const apiKey = extractApiKey(req);
  const apiKeyRecord = await getApiKey(apiKey);
  
  if (!apiKeyRecord?.merchant?.id === merchantId) {
    throw new Error('Invalid API key');
  }
  
  const origin = req.headers.get('origin') || '';
  if (!apiKeyRecord.allowedOrigins.includes(origin)) {
    throw new Error('Origin not allowed');
  }
  
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
```

### 3.4 Installation Guide for Admins (Admin Page)

#### In Admin Dashboard

```
┌─ Integrations → Installation
│
├─ How to Add Velou to Your Site?
│
├─ Choose Your Platform:
│  ├─ [Tab] Shopify
│  ├─ [Tab] WordPress
│  ├─ [Tab] Custom Website
│  ├─ [Tab] Wix/Squarespace
│  └─ [Tab] Embed Code
│
├─ For WordPress:
│  ├─ Step 1: Install Velou plugin
│     └─ [Copy plugin code]
│  ├─ Step 2: Activate plugin
│  └─ Step 3: Enter API key below
│
├─ For Shopify:
│  ├─ [Click] Install Velou App
│  └─ Verify app installed: [✓ Connected]
│
├─ For Custom Website:
│  ├─ Step 1: Copy installation script
│  │  └─ <script src="..."></script>
│  ├─ Step 2: Add to your HTML before </body>
│  └─ Step 3: Test on your site
│
├─ API Configuration:
│  ├─ API Key (Copy): pk_live_xxx
│  ├─ Allowed Origins:
│  │  ├─ acme.com
│  │  ├─ www.acme.com
│  │  └─ [+ Add more]
│  └─ [Save]
│
└─ [Installation Status]
   ├─ Last detected: 2024-12-05 14:32
   └─ Widget health: [🟢 Connected]
```

---

## 4. Change 2: Authentication & Security

### 4.1 Current State
- No authentication (MVP demo)
- Admin console at `/admin/*` is open to anyone

### 4.2 Solution: Local JWT-Based Authentication

#### Auth Flow

```
┌─ User (Admin)
│
├─ [Login Page] → POST /api/admin/auth/login
│  └─ { email, password }
│
├─ [Backend]
│  ├─ Hash password
│  ├─ Compare with passwordHash
│  └─ If match, generate JWT
│
├─ [JWT Token]
│  └─ { sub: user.id, merchantId, role, exp: now+7d }
│
├─ [localStorage]
│  └─ accessToken, refreshToken
│
└─ [All API calls]
   └─ Authorization: Bearer {accessToken}
```

#### Implementation

```typescript
// src/lib/auth/jwt.ts
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET!;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;

export function generateTokens(userId: string, merchantId: string, role: UserRole) {
  const accessToken = jwt.sign(
    { sub: userId, merchantId, role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  const refreshToken = jwt.sign(
    { sub: userId, merchantId },
    REFRESH_TOKEN_SECRET,
    { expiresIn: '30d' }
  );
  
  return { accessToken, refreshToken };
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

// src/middleware/auth.ts
export async function requireAuth(req: Request) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  try {
    const payload = verifyToken(token);
    req.user = payload;
  } catch (err) {
    return new Response('Invalid token', { status: 401 });
  }
}

// src/app/api/admin/auth/login/route.ts
export async function POST(req: Request) {
  const { email, password } = await req.json();
  
  const user = await db.merchantUser.findUnique({
    where: { email },
    include: { merchant: true }
  });
  
  if (!user || !await verifyPassword(password, user.passwordHash)) {
    return new Response('Invalid credentials', { status: 401 });
  }
  
  if (!user.isActive) {
    return new Response('User is inactive', { status: 403 });
  }
  
  const { accessToken, refreshToken } = generateTokens(
    user.id,
    user.merchantId,
    user.role
  );
  
  // Update lastLogin
  await db.merchantUser.update({
    where: { id: user.id },
    data: { lastLogin: new Date() }
  });
  
  return new Response(JSON.stringify({
    accessToken,
    refreshToken,
    user: { email, role: user.role }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

#### Protected API Routes Pattern

```typescript
// src/app/api/admin/[merchantId]/catalog/route.ts
export async function GET(req: Request, { params }: { params: { merchantId: string } }) {
  // 1. Extract & verify JWT
  const user = await requireAuth(req);
  if (!user) return new Response('Unauthorized', { status: 401 });
  
  // 2. Verify user belongs to merchant
  if (user.merchantId !== params.merchantId) {
    return new Response('Forbidden', { status: 403 });
  }
  
  // 3. Check role permissions
  if (!['admin', 'editor'].includes(user.role)) {
    return new Response('Insufficient permissions', { status: 403 });
  }
  
  // 4. Proceed with request
  const products = await db.product.findMany({
    where: { merchantId: params.merchantId }
  });
  
  return new Response(JSON.stringify(products));
}
```

#### Admin UI - Login & Setup

```
┌─ /admin/login (Public)
│
├─ [Velou Logo]
├─ "Sign In to Your Admin Dashboard"
│
├─ [Input] Email
├─ [Input] Password
│
├─ [Button] Sign In
├─ [Link] Forgot password?
│
└─ Don't have an account?
   └─ [Link] Create merchant account
```

#### First-Time Setup

When a new merchant signs up:

```
1. Email verification
2. Create Merchant record
3. Assign first user as ADMIN
4. Prompt: "Setup your store"
   ├─ Brand name
   ├─ Vertical (apparel, skincare, etc.)
   ├─ Upload logo & colors
   └─ Upload initial CSV or connect Shopify
```

---

## 5. Change 3: Shopify Integration

### 5.1 Current State
- Only CSV import
- No real-time product sync
- No sales/popularity data

### 5.2 Solution: Shopify App + Real-Time Sync

#### Architecture

```
┌─ Shopify Store (acme.myshopify.com)
│
├─ Velou App (installed from Shopify App Store)
│  └─ Requests access scopes
│
├─ OAuth Flow
│  └─ User authorizes Velou
│
├─ Access Token stored (encrypted)
│  └─ Velou can call Shopify API
│
├─ Webhook Subscriptions
│  ├─ product.created
│  ├─ product.updated
│  ├─ product.deleted
│  └─ order.created (for bestseller data)
│
└─ Real-time Sync
   ├─ Changes to Shopify → POST to webhook → Update Velou DB
   └─ Order data → Aggregate for bestseller rankings
```

#### Shopify OAuth & Token Management

```typescript
// src/lib/integrations/shopify/oauth.ts
export async function initiateShopifyOAuth(merchantId: string) {
  const store = `${merchantId}.myshopify.com`;
  const redirectUri = `${process.env.APP_URL}/api/integrations/shopify/callback`;
  
  const scope = [
    'read_products',
    'read_orders',
    'read_inventory',
    'read_analytics',
    'write_products' // If enabling inventory sync back
  ];
  
  const authUrl = `https://${store}/admin/oauth/authorize?${new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID!,
    scope: scope.join(','),
    redirect_uri: redirectUri,
    state: generateRandomState(merchantId) // CSRF protection
  })}`;
  
  return authUrl;
}

// src/app/api/integrations/shopify/callback/route.ts
export async function GET(req: Request) {
  const { code, shop, state } = Object.fromEntries(new URL(req.url).searchParams);
  
  // Verify state token
  const merchantId = verifyStateToken(state);
  
  // Exchange code for access token
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code
    })
  });
  
  const { access_token } = await response.json();
  
  // Store encrypted token
  await db.merchant.update({
    where: { id: merchantId },
    data: {
      shopifyStore: shop,
      shopifyAccessToken: encrypt(access_token),
      shopifySyncEnabled: true
    }
  });
  
  // Trigger initial sync
  await syncShopifyProducts(merchantId);
  
  return new Response('Connected! Redirecting...', {
    status: 302,
    headers: { Location: `/admin/${merchantId}/integrations?shopify=success` }
  });
}
```

#### Shopify Product Sync

```typescript
// src/lib/integrations/shopify/productSync.ts
export async function syncShopifyProducts(merchantId: string) {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  
  if (!merchant?.shopifyAccessToken) {
    throw new Error('Shopify not connected');
  }
  
  const client = new ShopifyAPI(merchant.shopifyStore, decrypt(merchant.shopifyAccessToken));
  
  // Fetch all products
  const shopifyProducts = await client.fetchAllProducts();
  
  for (const shopifyProduct of shopifyProducts) {
    // Check if product exists
    const existingProduct = await db.product.findFirst({
      where: { shopifyProductId: shopifyProduct.id.toString() }
    });
    
    if (existingProduct) {
      // Update: Preserve attributes, update Shopify-specific fields
      await db.product.update({
        where: { id: existingProduct.id },
        data: {
          title: shopifyProduct.title,
          description: shopifyProduct.bodyHtml,
          priceCents: Math.round(shopifyProduct.variants[0]?.price * 100),
          imageUrl: shopifyProduct.image?.src,
          shopifyVariantIds: shopifyProduct.variants.map(v => v.id.toString()),
          // Preserve existing attributes & other fields
        }
      });
    } else {
      // Create: Auto-infer category from Shopify collection
      const category = await inferCategoryFromShopify(shopifyProduct);
      
      await db.product.create({
        data: {
          id: generateId(),
          merchantId,
          shopifyProductId: shopifyProduct.id.toString(),
          shopifyHandle: shopifyProduct.handle,
          title: shopifyProduct.title,
          description: shopifyProduct.bodyHtml,
          priceCents: Math.round(shopifyProduct.variants[0]?.price * 100),
          imageUrl: shopifyProduct.image?.src,
          category,
          attributes: {
            materials: extractMaterials(shopifyProduct),
            colors: shopifyProduct.options
              .find(o => o.name === 'Color')?.values || [],
            sizes: shopifyProduct.options
              .find(o => o.name === 'Size')?.values || []
          }
        }
      });
    }
  }
  
  // Update sync timestamp
  await db.merchant.update({
    where: { id: merchantId },
    data: { shopifySyncedAt: new Date() }
  });
}
```

#### Shopify Webhooks - Real-Time Updates

```typescript
// src/app/api/integrations/shopify/webhooks/route.ts
export async function POST(req: Request) {
  const signature = req.headers.get('X-Shopify-Hmac-SHA256') || '';
  const body = await req.text();
  
  // Verify webhook signature
  if (!verifyShopifyWebhook(signature, body)) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const event = JSON.parse(body);
  const topic = req.headers.get('X-Shopify-Topic') || '';
  
  switch (topic) {
    case 'products/create':
    case 'products/update':
      await syncSingleProduct(event.id);
      break;
      
    case 'products/delete':
      await db.product.updateMany({
        where: { shopifyProductId: event.id.toString() },
        data: { isActive: false }
      });
      break;
      
    case 'orders/create':
      // Aggregate for bestseller rankings
      await recordOrder(event);
      break;
  }
  
  return new Response('OK', { status: 200 });
}
```

#### Bestseller & Trending Ranking

```typescript
// src/lib/integrations/shopify/rankingSync.ts
export async function updateBestsellersAndTrending(merchantId: string) {
  // Bestsellers: Top products by order count (last 30 days)
  const bestsellers = await db.$queryRaw`
    SELECT shopifyProductId, COUNT(*) as orderCount
    FROM AnalyticsEvent
    WHERE merchantId = ${merchantId}
    AND eventType = 'order'
    AND createdAt > NOW() - INTERVAL 30 DAY
    GROUP BY shopifyProductId
    ORDER BY orderCount DESC
    LIMIT 50
  `;
  
  // Trending: Recently ordered products with acceleration
  const trending = await db.$queryRaw`
    SELECT shopifyProductId,
      COUNT(*) as orderCount,
      (COUNT(*) - LAG(COUNT(*)) OVER (
        PARTITION BY shopifyProductId ORDER BY DATE(createdAt)
      )) as orderAccel
    FROM AnalyticsEvent
    WHERE merchantId = ${merchantId}
    AND eventType = 'order'
    AND createdAt > NOW() - INTERVAL 7 DAY
    GROUP BY shopifyProductId, DATE(createdAt)
    ORDER BY orderAccel DESC, orderCount DESC
    LIMIT 30
  `;
  
  // Update Product.shopifyBestseller and shopifyTrending
  for (let i = 0; i < bestsellers.length; i++) {
    await db.product.updateMany({
      where: { shopifyProductId: bestsellers[i].shopifyProductId },
      data: { shopifyBestseller: true, shopifySalesRank: i + 1 }
    });
  }
  
  for (const product of trending) {
    await db.product.updateMany({
      where: { shopifyProductId: product.shopifyProductId },
      data: { shopifyTrending: true }
    });
  }
}

// Run daily (cron)
// 0 2 * * * /api/admin/jobs/update-shopify-rankings
```

#### Shopify Admin UI

```
┌─ Admin Dashboard → Integrations → Shopify
│
├─ [Status] Not Connected / Connected to: acme.myshopify.com
│
├─ [If Not Connected]
│  └─ [Button] Connect to Shopify
│      └─ Opens OAuth flow → user authorizes
│
├─ [If Connected]
│  ├─ [Section] Sync Settings
│  │  ├─ [Toggle] Auto-sync products
│  │  ├─ [Toggle] Use bestseller ranking
│  │  └─ [Dropdown] Bestseller period: Last 30 days
│  │
│  ├─ [Section] Last Sync
│  │  └─ "2024-12-05 14:32 UTC"
│  │
│  ├─ [Button] Sync Now
│  └─ [Button] Disconnect
│
└─ [Section] Mapped Products
   ├─ "5,432 products synced from Shopify"
   └─ [View] Products with bestseller badge
```

---

## 6. Change 4: Dataset Schema & Shopify Ranking Integration

### 6.1 Current State
- Fixed unified schema (CSV-based)
- No ranking data from Shopify
- Admins must manually set merchandising rules

### 6.2 Solution: Unified Schema + Auto-Ranking

#### Extended Schema

The existing unified schema remains, but now includes **optional Shopify ranking fields**:

```typescript
// src/lib/catalog/unifiedSchemaConfig.ts - EXTENDED

export interface UnifiedVendorCatalogRow {
  // ... EXISTING FIELDS ...
  
  // NEW OPTIONAL FIELDS (Shopify-synced or manually added)
  bestseller_badge?: string        // "true" | "false" | undefined
  bestseller_rank?: string         // "1" | "5" | "12" | undefined
  trending_badge?: string          // "true" | "false" | undefined
  trending_score?: string          // "0.95" | "0.42" | undefined
  sales_velocity?: string          // "15" (units sold per day) | undefined
}
```

#### Backward Compatibility

When importing CSV:
- Old CSV files still work (no new fields required)
- If Shopify is connected, rankings override CSV data
- If CSV has ranking fields, they're used as defaults

#### Admin UI - Unified Schema Config

```
┌─ Admin Dashboard → Catalog → Schema Mapping
│
├─ [Section] Data Source
│  ├─ (Radio) CSV Upload
│  ├─ (Radio) Shopify Connected (acme.myshopify.com)
│  └─ (Checkbox) Merge both sources
│
├─ [Section] Field Mapping (CSV)
│  ├─ [Dropdown] Product ID ← Column: product_id
│  ├─ [Dropdown] Title ← Column: title
│  ├─ [Dropdown] Price ← Column: price
│  ├─ [Dropdown] Category ← Column: category
│  ├─ [Dropdown] Bestseller Badge ← Column: bestseller_badge
│  │                                  OR (if Shopify connected)
│  │                                  ← Auto-sync from Shopify
│  └─ [Button] Continue
│
├─ [Section] Shopify Sync (if connected)
│  ├─ [Toggle] Use bestseller rankings
│  ├─ [Toggle] Use trending data
│  ├─ [Slider] Bestseller period: Last 30 days
│  │ └─ Or Last 7 days / Last 90 days
│  └─ [Info] "Rankings auto-update daily at 2 AM UTC"
│
├─ [Section] Ranking Rules (Admin can override)
│  ├─ When product is bestseller:
│  │  └─ [Dropdown] Boost in search results by: 40%
│  │
│  ├─ When product is trending:
│  │  └─ [Dropdown] Boost in search results by: 25%
│  │
│  └─ [Checkbox] Show bestseller/trending badges on product cards
│
└─ [Button] Save Configuration
```

#### Search Integration - Shopify Rankings

Update the search module to incorporate Shopify rankings:

```typescript
// src/lib/search/ranking/shopifyRanking.ts

export function calculateShopifyBoost(product: Product): number {
  let boost = 1.0;
  
  if (product.shopifyBestseller) {
    boost *= 1.4; // 40% boost
  }
  
  if (product.shopifyTrending) {
    boost *= 1.25; // 25% boost (multiplicative)
  }
  
  if (product.shopifySalesRank) {
    // Extra boost for top bestsellers
    const rankBoost = Math.max(1.5 - (product.shopifySalesRank / 50), 1.0);
    boost *= rankBoost;
  }
  
  return boost;
}

// src/lib/search/index.ts - UPDATED
export async function searchProducts(constraints: SearchConstraints) {
  // ... existing ranking logic ...
  
  // Apply Shopify boost
  for (const product of candidates) {
    product.relevanceScore *= calculateShopifyBoost(product);
  }
  
  // Re-sort by boosted score
  candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  return candidates;
}
```

#### Example: Impact on Search Results

**User Query:** "popular face wash"

**Without Shopify Ranking:**
1. Cleanser A (title match on "face wash")
2. Cream B (description match on "wash")
3. Mask C (has "popular" in reviews)

**With Shopify Ranking (bestseller boost):**
1. **Cleanser A** (bestseller) ← 40% boost applied
2. Cream B
3. Mask C (trending) ← 25% boost applied

---

## 7. Change 5: Review Platform Integration

### 7.1 Current State
- No customer reviews
- Responses don't reference user feedback
- No trust signals in product cards

### 7.2 Solution: Multi-Platform Review Aggregation

#### Supported Platforms

- **Trustpilot** – industry standard
- **Reviews.io** – e-commerce specific
- **Yotpo** – product reviews
- **SiteJabber** – general reviews
- **Custom/Embedded** – reviews you host yourself

#### Integration Architecture

```
┌─ Merchant's Review Platform (e.g., Trustpilot)
│
├─ Review Data (public API)
│  ├─ Company rating: 4.5/5 (from 2,345 reviews)
│  └─ Product-level ratings (if available)
│
├─ Velou Sync (scheduled + real-time)
│  └─ Fetch new reviews daily
│
├─ Store in DB
│  └─ Product.reviewsJson (review snippets + ratings)
│
└─ Enrich Assistant Responses
   └─ Include review quotes in product recommendations
```

#### Schema Addition

```prisma
model Product {
  // ... existing fields ...
  
  // Review Integration
  overallReviewScore    Float?          // 4.5
  reviewCount           Int?            // 2345
  reviewSummary         String?         // "Great for sensitive skin"
  topReviews            Json?           // Array of top 3 reviews
  reviewsLastSyncedAt   DateTime?
}

model ReviewConfig {
  id                    String          @id @default(cuid())
  merchantId            String          @unique
  merchant              Merchant        @relation(fields: [merchantId], references: [id])
  
  provider              ReviewProvider  // trustpilot, reviews.io, etc.
  businessId            String          // ID in review platform
  apiKey                String          @encrypted
  apiUrl                String
  
  companyReviewScore    Float?
  companyReviewCount    Int?
  
  syncEnabled           Boolean         @default(true)
  lastSyncedAt          DateTime?
  
  createdAt             DateTime        @default(now())
  updatedAt             DateTime        @updatedAt
}

enum ReviewProvider {
  TRUSTPILOT
  REVIEWS_IO
  YOTPO
  SITEJABBER
  CUSTOM
}
```

#### Admin UI - Review Setup

```
┌─ Admin Dashboard → Integrations → Customer Reviews
│
├─ [Section] Review Platform
│  ├─ (Radio) Trustpilot
│  ├─ (Radio) Reviews.io
│  ├─ (Radio) Yotpo
│  └─ (Radio) Other / Custom
│
├─ [Section] Connect Account
│  ├─ Step 1: Visit trustpilot.com
│  ├─ Step 2: Copy your Business ID
│  │  └─ [Input] Business ID: e.g., acme-corp-123
│  │
│  ├─ Step 3: Generate API key (in Trustpilot settings)
│  │  └─ [Input] API Key: [Password field]
│  │
│  └─ Step 4: [Button] Verify Connection
│      └─ Tests connection, fetches current rating
│
├─ [Section] Account Status
│  ├─ [✓] Connected to Trustpilot
│  ├─ Company Rating: ⭐ 4.5 / 5.0
│  ├─ Total Reviews: 2,345
│  └─ Last Synced: 2024-12-05 10:22 UTC
│
├─ [Section] Sync Settings
│  ├─ [Toggle] Enable review sync
│  ├─ [Toggle] Show reviews on product cards
│  ├─ [Toggle] Include review snippets in assistant responses
│  └─ [Dropdown] Sync frequency: Daily
│
├─ [Section] Review Display
│  ├─ [Preview] 
│  │  ┌─ ⭐ 4.5/5 (2,345 reviews)
│  │  └─ "Highly recommended by customers"
│  │
│  └─ [Checkbox] Show top review snippets
│      └─ "Great product, very effective!" – Maria S.
│
└─ [Button] Save Settings
   [Button] Disconnect
```

#### Review Sync & Enrichment

```typescript
// src/lib/integrations/reviews/trustpilotClient.ts

export async function syncTrustpilotReviews(merchantId: string) {
  const config = await db.reviewConfig.findUnique({
    where: { merchantId }
  });
  
  if (!config) throw new Error('Review config not found');
  
  // Fetch business reviews
  const response = await fetch(
    `https://api.trustpilot.com/v1/business-units/${config.businessId}/reviews`,
    { headers: { Authorization: `Bearer ${decrypt(config.apiKey)}` } }
  );
  
  const { businessUnit, reviews } = await response.json();
  
  // Update company rating
  await db.reviewConfig.update({
    where: { id: config.id },
    data: {
      companyReviewScore: businessUnit.rating,
      companyReviewCount: businessUnit.reviewCount,
      lastSyncedAt: new Date()
    }
  });
  
  // Store top reviews
  const topReviews = reviews
    .filter(r => r.rating >= 4)  // Only positive
    .slice(0, 3)
    .map(r => ({
      rating: r.rating,
      title: r.title,
      text: r.text,
      author: r.author?.name || 'Anonymous',
      date: r.createdAt
    }));
  
  // In a real scenario, you'd match Trustpilot reviews to products
  // For MVP, store company-level reviews
  console.log('Top reviews:', topReviews);
}

// Run daily
// 0 4 * * * /api/admin/jobs/sync-reviews
```

#### Review Enrichment in Responses

```typescript
// src/lib/llm/prompts/buildFinalResponsePrompt.ts - ENHANCED

export function buildFinalResponsePrompt(
  datasetContext: DatasetContext,
  products: Product[],
  userQuery: string,
  reviews?: ReviewData  // NEW
): string {
  const reviewSection = reviews ? `
Customer Reviews Summary:
- Overall Company Rating: ${reviews.companyScore}/5.0 (${reviews.reviewCount} reviews)
- Top feedback: "${reviews.topReviews[0]?.text.substring(0, 100)}..."

Leverage this review data to build trust in your recommendations. When relevant, 
mention positive review themes that match the user's needs.
  ` : '';
  
  return `
You are a helpful shopping assistant for ${datasetContext.vertical} products.

${reviewSection}

...rest of prompt
  `;
}
```

---

## 8. Change 6: User Behavior Tracking & Analytics

### 8.1 Current State
- Basic metrics (conversation count, CTR)
- No detailed behavior tracking
- Can't build recommendation engine

### 8.2 Solution: Comprehensive Analytics Layer

#### What to Track

Since the widget is embedded on merchant's site, we can only capture:

**✅ Can Track (Own Domain)**
- Messages sent / queries
- Products viewed (clicked from assistant response)
- Product cards displayed
- Refinement queries ("cheaper", "more colorful")
- Follow-up question interactions
- Session duration

**⚠️ Hard to Track (Merchant Domain)**
- User login status on merchant site
- Full purchase history (would need Shopify webhook)
- Browsing behavior outside chat (requires pixel)
- User identity (unless merchant provides)

**Solution:** Layered tracking with opt-in integrations

#### Tracking Architecture

```typescript
// src/lib/analytics/eventTracker.ts

export interface AnalyticsEvent {
  sessionId: string          // Cross-domain session ID
  eventType: string          // message_sent, product_viewed, etc.
  
  // Message-specific
  userQuery?: string
  intent?: 'discovery' | 'pdp_suitability' | 'other'
  resultCount?: number
  
  // Product-specific
  productId?: string
  productClickedPosition?: number // 1st card, 2nd card, etc.
  
  // Behavioral
  userDevice: string         // mobile, tablet, desktop
  userPage: string           // Merchant's page URL
  userReferer?: string       // Where user came from
  
  // Timing
  queryDurationMs?: number   // How long did search take?
  
  createdAt: Date
}

// Client-side tracking (embedded in widget)
export class WidgetAnalytics {
  constructor(merchantId: string, apiKey: string, userId?: string) {
    this.merchantId = merchantId;
    this.apiKey = apiKey;
    this.sessionId = this.getOrCreateSessionId();
    this.userId = userId; // Optional, from merchant
  }
  
  track(eventType: string, data: Record<string, any>) {
    const event = {
      sessionId: this.sessionId,
      eventType,
      ...data,
      userDevice: this.detectDevice(),
      userPage: window.location.href,
      userReferer: document.referrer,
      createdAt: new Date()
    };
    
    // Send to backend
    fetch(`https://api.velou.ai/api/widget/${this.merchantId}/analytics/event`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    }).catch(err => console.error('Analytics error:', err));
  }
  
  trackMessage(query: string, resultCount: number, durationMs: number) {
    this.track('message_sent', { query, resultCount, durationMs });
  }
  
  trackProductClick(productId: string, position: number) {
    this.track('product_clicked', { productId, position });
  }
  
  trackProductView(productId: string) {
    this.track('product_viewed', { productId });
  }
  
  private getOrCreateSessionId(): string {
    let sessionId = sessionStorage.getItem('velou_session_id');
    if (!sessionId) {
      sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('velou_session_id', sessionId);
    }
    return sessionId;
  }
  
  private detectDevice(): string {
    const ua = navigator.userAgent;
    if (/mobile/i.test(ua)) return 'mobile';
    if (/tablet|ipad/i.test(ua)) return 'tablet';
    return 'desktop';
  }
}
```

#### Server-Side Event Ingestion

```typescript
// src/app/api/widget/[merchantId]/analytics/event/route.ts

export async function POST(
  req: Request,
  { params }: { params: { merchantId: string } }
) {
  const event = await req.json();
  
  // Validate API key
  const user = await requireWidgetAuth(req, params.merchantId);
  
  // Store event
  await db.analyticsEvent.create({
    data: {
      merchantId: params.merchantId,
      sessionId: event.sessionId,
      eventType: event.eventType,
      payload: event,
      userDevice: event.userDevice,
      userPage: event.userPage,
      userReferer: event.userReferer,
      createdAt: new Date(event.createdAt)
    }
  });
  
  return new Response('OK');
}
```

#### Admin Dashboard - Analytics

```
┌─ Admin Dashboard → Analytics
│
├─ [Date Range Picker] Last 30 days
│
├─ [Section] Overview
│  ├─ Total Messages: 5,432
│  ├─ Total Users: 1,234
│  ├─ Avg Messages per User: 4.4
│  └─ Conversion Rate: 12.3% (users who clicked product)
│
├─ [Section] Message Breakdown
│  ├─ Discovery queries: 3,200 (59%)
│  ├─ Product Q&A: 1,600 (29%)
│  ├─ General questions: 632 (12%)
│  └─ [Chart] Trend over time (line chart)
│
├─ [Section] Top Products Viewed
│  ├─ 1. Cleanser A – 432 views
│  ├─ 2. Serum B – 401 views
│  ├─ 3. Mask C – 398 views
│  └─ [View More]
│
├─ [Section] Top Queries
│  ├─ "face wash for dry skin" – 234
│  ├─ "moisturizer under $50" – 156
│  ├─ "sensitive skin" – 142
│  └─ [View All Queries]
│
├─ [Section] Device Breakdown
│  ├─ Mobile: 65% (3,532)
│  ├─ Desktop: 30% (1,632)
│  └─ Tablet: 5% (272)
│
├─ [Section] Traffic Sources
│  ├─ Direct: 45%
│  ├─ Organic Search: 30%
│  ├─ Social Media: 15%
│  └─ Other: 10%
│
├─ [Button] Export as CSV
└─ [Button] Generate Report
```

#### Optional: Shopify Integration for Purchase Data

If merchant connects Shopify, we can track purchases:

```typescript
// src/lib/integrations/shopify/orderWebhook.ts

export async function handleShopifyOrderCreated(order: ShopifyOrder, merchantId: string) {
  // Extract products from order
  for (const item of order.line_items) {
    // Check if this product was shown in chat
    const sessionWithProduct = await db.analyticsEvent.findFirst({
      where: {
        merchantId,
        payload: { path: ['productId'], equals: item.product_id.toString() },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24h
      }
    });
    
    if (sessionWithProduct) {
      // Record conversion
      await db.analyticsEvent.create({
        data: {
          merchantId,
          sessionId: sessionWithProduct.sessionId,
          eventType: 'purchase',
          payload: {
            productId: item.product_id,
            amount: item.price * item.quantity,
            orderId: order.id
          }
        }
      });
    }
  }
}
```

#### User Identity Matching (Optional)

Merchants can optionally pass user ID to widget:

```javascript
// On merchant's website
window.VeloutWidget.mount({
  merchantId: 'acme-corp',
  apiKey: 'pk_live_xxx',
  userId: 'user_12345'  // From merchant's session
});
```

This allows tracking:
- Which logged-in users interacted with chat
- Purchase history linked to chat behavior
- Personalization over time

But requires merchant to pass this data - **no requirement for MVP**.

---

## 9. Implementation Phases

### Phase 0: Foundation (Weeks 1-2)
- [ ] Set up multi-tenant database schema
- [ ] Implement authentication (JWT, login UI)
- [ ] Create services layer architecture
- [ ] Refactor 1,678-line orchestrator (→ flows/)
- [ ] Refactor 1,815-line search module (→ ranking/, filtering/)

### Phase 1: Widget Separation (Weeks 3-4)
- [ ] Extract widget into standalone package (@velou/widget)
- [ ] Build CDN loader script
- [ ] Create widget configuration API
- [ ] Implement CORS & widget authentication
- [ ] Build installation guides for Shopify, WordPress, custom sites

### Phase 2: Admin Portal (Weeks 5-6)
- [ ] Build multi-merchant admin dashboard
- [ ] Implement catalog management (upload, import)
- [ ] Create integration setup pages (Shopify, reviews)
- [ ] Build merchant user management
- [ ] Implement basic analytics dashboard

### Phase 3: Shopify Integration (Weeks 7-8)
- [ ] Implement Shopify OAuth flow
- [ ] Build product sync (webhook + scheduled)
- [ ] Implement bestseller/trending ranking
- [ ] Create ranking boost calculation
- [ ] Add Shopify configuration UI

### Phase 4: Review Integration (Weeks 9-10)
- [ ] Implement Trustpilot/Reviews.io API clients
- [ ] Build review sync scheduler
- [ ] Integrate reviews into search ranking
- [ ] Add review enrichment to LLM prompts
- [ ] Create review platform configuration UI

### Phase 5: Analytics (Weeks 11-12)
- [ ] Implement event tracking in widget
- [ ] Build analytics dashboard
- [ ] Create event storage & querying
- [ ] Add event export (CSV)
- [ ] Implement analytics API for custom dashboards

### Phase 6: Polish & Testing (Weeks 13-14)
- [ ] End-to-end testing across all flows
- [ ] Security audit
- [ ] Performance optimization
- [ ] Documentation & deployment
- [ ] Beta launch with early partners

---

## 10. Migration Plan

### Step 1: Dual-Mode Operation (0 Downtime)

Keep existing MVP working while building productized version in parallel:

```typescript
// src/middleware/routeSelector.ts
export function selectRoute(req: Request) {
  const url = new URL(req.url);
  
  // Old MVP routes
  if (url.pathname === '/' || url.pathname.startsWith('/admin')) {
    return handleMVPRoute(req);  // Existing code
  }
  
  // New SaaS routes
  if (url.pathname.startsWith('/api/widget/')) {
    return handleSaaSRoute(req);  // New code
  }
}
```

### Step 2: Migrate Existing MVP Merchant

Once productized version is ready:

```sql
-- Create merchant record for existing data
INSERT INTO Merchant (
  id, slug, name, brandName, primaryColor, ...
) VALUES (
  'default-merchant', 'default', 'Default', 'Velou Demo', ...
);

-- Link existing products to merchant
UPDATE Product SET merchantId = 'default-merchant' WHERE merchantId IS NULL;

-- Create admin user
INSERT INTO MerchantUser (...) VALUES (...);

-- Create API key
INSERT INTO ApiKey (...) VALUES (...);
```

### Step 3: Gradual Rollout

```
Week 1: Internal testing with new dashboard
Week 2: Invite 3 beta partners
Week 3: Fix issues, improve UX
Week 4: Launch to public with clear docs
```

---

## 11. Data Flow Diagrams

### Discovery Query Flow (Productized)

```
┌─ User on merchant's website (acme.com)
│
├─ [Widget] User types: "almond scrub under $50"
│
├─ [Widget] Gathers context:
│  ├─ merchantId: "acme-corp"
│  ├─ apiKey: "pk_live_xxx"
│  ├─ sessionId: "sess_xxx"
│  ├─ userDevice: "mobile"
│  └─ userPage: "acme.com/skincare"
│
├─ [Widget Analytics] Track event:
│  └─ POST /api/widget/acme-corp/analytics/event
│     └─ { eventType: "message_sent", query: "..." }
│
├─ [Widget] Send query to API:
│  └─ POST /api/widget/acme-corp/assistant/stream
│     └─ Headers: Authorization: Bearer pk_live_xxx
│
├─ [API Gateway] Validate:
│  ├─ Verify API key belongs to acme-corp
│  ├─ Verify origin acme.com is in allowedOrigins
│  └─ Extract merchantId from context
│
├─ [AssistantService] Handle request:
│  ├─ Call IntentParser.parse()
│  │  └─ LLM: Parse intent + constraints
│  │
│  ├─ Call SearchService.search()
│  │  ├─ searchProducts({ merchantId, constraints })
│  │  ├─ Apply attribute filtering
│  │  ├─ Apply Shopify rankings (if synced)
│  │  └─ Sort by relevance score
│  │
│  ├─ Call RelevanceChecker.evaluate()
│  │  └─ Verify products match intent
│  │
│  ├─ Call ReviewEnricher.enrich() (optional)
│  │  └─ Add review data to products
│  │
│  ├─ Call LLMOrchestrator.generateResponse()
│  │  └─ Create final response + reasons
│  │
│  └─ Stream via SSE:
│     ├─ understanding → parsing intent
│     ├─ searching → found 12 products
│     ├─ evaluating → checking relevance
│     ├─ generating → creating response
│     └─ [Final] replyText, productCards, followupText
│
├─ [Widget] Receive and render:
│  ├─ Show animated assistant message
│  ├─ Show product cards
│  ├─ Persist to sessionStorage
│  └─ Track render event
│
└─ [Analytics] Store conversation:
   └─ ConversationEvent.create()
      └─ { merchantId, sessionId, userQuery, ... }
```

### Shopify Sync Flow

```
┌─ Shopify Store: acme.myshopify.com
│
├─ [Webhook] Product updated
│
├─ POST /api/integrations/shopify/webhook
│  └─ { event_type: "PRODUCT_UPDATE", ... }
│
├─ [Backend] Process webhook:
│  ├─ Verify signature
│  ├─ Extract product data
│  └─ Call ShopifyService.syncProduct()
│
├─ [ShopifyService] Update product:
│  ├─ Query Shopify API for full details
│  ├─ Match to local Product by shopifyProductId
│  ├─ Update: title, price, inventory, variants
│  ├─ Preserve: existing attributes, category, custom fields
│  └─ Save to DB
│
└─ [Scheduled Job] Daily bestseller update:
   ├─ Query orders from last 30 days
   ├─ Aggregate by product
   ├─ Calculate bestseller rank
   └─ Update Product.shopifyBestseller, shopifySalesRank
```

### Review Sync Flow

```
┌─ Trustpilot.com
│
├─ [Scheduled Job] Daily sync
│  └─ 4 AM UTC
│
├─ GET /api/v1/business-units/{id}/reviews
│  └─ Fetch top 100 reviews
│
├─ [Backend] Process reviews:
│  ├─ Store company rating
│  ├─ Extract top 3 positive reviews
│  └─ Update ReviewConfig.lastSyncedAt
│
└─ [LLM Prompts] Use in responses:
   ├─ buildFinalResponsePrompt() includes review context
   ├─ LLM mentions: "⭐ 4.5/5 from 2,345 customers"
   └─ Includes review snippets if relevant to user query
```

---

## Key Design Decisions & Rationale

### 1. Why Embeddable Widget vs. Multi-Domain Marketplace?

**Option A:** Embed widget on merchant sites (chosen)
- **Pros:** Better UX (no redirect), owned brand experience, easier onboarding
- **Cons:** Requires CORS handling, more complex widget isolation

**Option B:** Users visit Velou marketplace
- **Pros:** Simpler backend, unified analytics
- **Cons:** Poor UX, merchant loses brand control, harder sales story

**Decision:** Option A - aligns with product positioning ("add to your store")

### 2. Why Local Auth vs. OAuth2?

**Option A:** Local JWT (chosen for MVP)
- **Pros:** Simple, fast to implement, no third-party dependency
- **Cons:** Password management burden on us

**Option B:** OAuth2 (Google, GitHub)
- **Pros:** Better UX, federated identity
- **Cons:** More complex, not all merchants want SSO

**Decision:** Start with local, add OAuth2 in Phase 2

### 3. Why Shopify Webhooks + Scheduled Sync?

**Option A:** Webhooks only
- **Cons:** Miss products created before Velou connection

**Option B:** Scheduled sync only
- **Cons:** Lag between Shopify update and Velou

**Decision:** Both - webhooks for real-time, sync for catchup

### 4. Why App-Level Reviews vs. Product-Level?

**Option A:** Company-level reviews only (chosen for MVP)
- **Pros:** Works for all review platforms, easy setup
- **Cons:** Less specific

**Option B:** Product-level reviews (later)
- **Pros:** More relevant
- **Cons:** Requires platform-specific integrations

**Decision:** Start with company level, add product level after MVP

### 5. First-Party vs. Third-Party Analytics?

**Decision:** First-party only (no tracking pixels)
- **Cons:** Can't track merchant-site behavior
- **Pros:** Privacy-first, no cookie/tracking issues, simpler
- **Option:** Merchants can manually pass user IDs to widget

---

## Backwards Compatibility & Migration

### What Stays the Same
- Unified catalog schema (extended, not replaced)
- Search algorithm (enhanced with Shopify boost)
- Chat UX (same on widget)
- LLM prompts (better with reviews, same structure)

### What Changes
- Database model (multi-tenant)
- API routes (new `/api/widget/*` paths)
- Admin interface (multi-merchant dashboard)
- Deployment (same Next.js app, new routes)

### Migration Path for Existing Data
```sql
-- For existing MVP merchant:
1. Create Merchant("default")
2. CREATE TABLE IF NOT EXISTS MerchantUser
3. Link products: UPDATE Product SET merchantId = 'default'
4. Link analytics: UPDATE ConversationEvent SET merchantId = 'default'
5. Create API key for widget auth
```

**Result:** Existing merchant continues working with new infrastructure

---

## Security Considerations

### API Key Management
- Public keys (pk_live_*) – safe to expose in widget
- Secret keys (sk_live_*) – server-side only, for admin operations
- Rotate keys without downtime (old + new valid simultaneously)

### CORS & Cross-Origin
- Widget sends `Origin` header
- Backend verifies against `allowedOrigins` whitelist
- Prevents scraping from unauthorized sites

### Data Isolation
- Every query includes `merchantId`
- Database queries filtered: `WHERE merchantId = ?`
- No possibility of merchant A viewing merchant B's data

### Encryption
- Sensitive tokens encrypted at rest: `shopifyAccessToken`, `reviewApiKey`
- Use libsodium or similar for symmetric encryption
- Key rotation policy

### Rate Limiting
- Per-merchant rate limits (prevent abuse)
- Per-API-key limits (prevent scraping)
- DDoS protection on widget endpoints

---

## Deployment & DevOps

### Infrastructure Changes
```
Current:
  vercel.com (single Next.js app)
  neon.io (single PostgreSQL database)

Productized:
  vercel.com (same, multi-tenant)
  neon.io (same database, new schema)
  redis (for sessions, caching, webhook queues)
  s3 (for uploaded logos, images)
  cdn (for widget script distribution)
```

### Environment Variables

```env
# Existing
DATABASE_URL=...
OPENAI_API_KEY=...

# New - Auth
JWT_SECRET=...
REFRESH_TOKEN_SECRET=...

# New - Shopify
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...

# New - Reviews
TRUSTPILOT_CLIENT_ID=...

# New - Encryption
ENCRYPTION_KEY=...  # For sensitive tokens

# New - Storage
AWS_ACCESS_KEY=...
AWS_SECRET_KEY=...
AWS_S3_BUCKET=...

# New - Redis
REDIS_URL=...

# Feature Flags
FEATURE_SHOPIFY_ENABLED=true
FEATURE_REVIEWS_ENABLED=true
FEATURE_ANALYTICS_ENABLED=true
```

---

## Testing Strategy

### Unit Tests
- Auth flows (login, token refresh, permissions)
- Search ranking (Shopify boost calculation)
- Widget config validation
- Event tracking serialization

### Integration Tests
- End-to-end message flow (widget → API → response)
- Shopify sync (mock webhooks, verify products update)
- Review sync (mock API, verify enrichment)
- Multi-merchant isolation (can't cross-pollinate data)

### E2E Tests
- Merchant signup → initial CSV upload → widget on site
- Shopify connection → auto-sync → bestseller ranking
- Review platform connection → enriched responses
- Analytics tracking → dashboard display

### Performance Tests
- 1,000+ concurrent widget connections
- Search with 100k products
- Analytics event ingestion rate

---

## Cost & Scalability

### Current MVP Costs
- Vercel hosting: $20/month
- Neon PostgreSQL: $20/month
- OpenAI API: ~$100/month (demo usage)
- **Total:** ~$140/month

### Productized Costs (per merchant, estimate)
- **Fixed (Velou infrastructure):**
  - Vercel: $100/month (more compute)
  - Neon: $50/month (larger database)
  - Redis: $30/month
  - S3: $10/month
  - CDN: $20/month
  - **Subtotal: $210/month**

- **Variable (per merchant, 1,000 merchants):**
  - Vercel: +$0.25/merchant/month (auto-scaling)
  - Database: +$0.10/merchant/month (storage)
  - OpenAI: +$5-50/merchant/month (usage-based)
  - **Subtotal: ~$5.35/merchant/month**

### Pricing Strategy
```
Starter: $49/month
├─ Up to 10k products
├─ Up to 1,000 conversations/month
└─ No integrations

Professional: $149/month
├─ Up to 50k products
├─ Unlimited conversations
├─ Shopify sync
├─ Basic analytics
└─ Up to 3 admin users

Enterprise: Custom
├─ Unlimited products
├─ White-label widget
├─ Priority support
├─ Custom integrations
└─ SLA guarantees
```

**Breakeven:** ~4 Starter + 2 Professional customers

---

## Monitoring & Observability

### Key Metrics
- Widget load time (should be <2s)
- API response time (avg <1s)
- LLM API latency (avg <5s including streaming)
- Error rates by endpoint
- Webhook processing latency
- Database query performance

### Logging
```typescript
// Structured logging for observability
import logger from 'pino';

logger.info({
  msg: 'query_processed',
  merchantId,
  duration: 1234,
  resultCount: 8,
  intent: 'discovery',
  status: 'success'
});

logger.error({
  msg: 'shopify_sync_failed',
  merchantId,
  error: err.message,
  attempt: 2,
  retryAt: new Date(Date.now() + 5 * 60 * 1000)
});
```

### Alerts
- API error rate > 1%
- Response time p99 > 5s
- Shopify webhook processing failures
- Review sync failures
- Database slow queries

---

## Rollback & Disaster Recovery

### Database Backups
- Automated daily backups (Neon)
- Point-in-time recovery (PITR)
- Test restore process monthly

### Code Rollback
- Feature flags for new functionality
- Canary releases (5% traffic → 50% → 100%)
- Easy rollback via Vercel (previous deployment)

---

## Success Metrics & KPIs

### Product Adoption
- Merchants signed up: Target 50 by Month 3
- Monthly active merchants: Target 80% of sign-ups
- Average products per merchant: Target 5,000
- Average messages per merchant: Target 500/month

### Quality Metrics
- Widget load time: Target <1.5s
- API response time: Target <1s p95
- Search relevance: Target 85% user satisfaction
- LLM response quality: Target 4.2/5 in reviews

### Business Metrics
- MRR (Monthly Recurring Revenue): Target $1,000 by Month 6
- CAC (Customer Acquisition Cost): Target <$100
- LTV (Lifetime Value): Target $1,500+
- Churn rate: Target <5% monthly

---

## Conclusion

This productization roadmap transforms Velou from a single-merchant MVP into an enterprise-ready, multi-tenant SaaS platform. Key highlights:

✅ **Widget Separation:** Embed on any website (Shopify, WordPress, custom)  
✅ **Authentication:** Secure JWT-based admin access  
✅ **Shopify Integration:** Real-time product sync + bestseller ranking  
✅ **Review Enrichment:** Multi-platform review aggregation  
✅ **Analytics:** Comprehensive behavior tracking & insights  
✅ **Backward Compatible:** Existing data migrates smoothly  
✅ **Phased Approach:** 14-week implementation with zero downtime  

The architecture maintains the MVP's strengths (industry-agnostic schema, powerful search, dataset-aware LLM) while adding the enterprise features (multi-tenancy, integrations, analytics) needed for a real SaaS product.

---

**Document prepared by:** AI Architecture Review  
**Next steps:** 
1. Review with technical team
2. Prioritize Phase 0 tasks
3. Set up development environment for refactoring
4. Begin Phase 0 in Week 1
