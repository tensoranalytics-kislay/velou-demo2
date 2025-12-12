# Schema Changes Summary

## New Models

### 1. Merchant (replaces BrandConfig)

**Purpose**: Represents a single merchant/tenant in the multi-tenant system.

**Key Fields**:
- `id` (String, cuid) - Primary key
- `slug` (String, unique) - URL-friendly identifier: "acme-corp"
- `name` (String) - Display name: "Acme Corporation"
- `brandName` (String) - Brand name for assistant
- All branding fields (colors, logo) migrated from BrandConfig
- Voice & tone fields (voiceInstructions, toneFormal, tonePlayful)
- LLM configuration (useMerchantKey, merchantOpenAIKey)
- Shopify integration fields (shopifyStore, shopifyAccessToken, etc.)
- Review integration fields (reviewProvider, reviewApiKey, etc.)
- `datasetContext` (Json) - Vertical, primaryFacets, sampleCategories

**Relations**:
- `products` - One-to-many with Product
- `merchRules` - One-to-many with MerchRule
- `apiKeys` - One-to-many with ApiKey
- `users` - One-to-many with MerchantUser
- `reviewConfig` - One-to-one with ReviewConfig
- `analyticsEvents` - One-to-many with AnalyticsEvent
- `conversationEvents` - One-to-many with ConversationEvent
- `catalogIngestionRuns` - One-to-many with CatalogIngestionRun

### 2. MerchantUser

**Purpose**: Authentication and authorization for merchant admins.

**Key Fields**:
- `id` (String, cuid) - Primary key
- `merchantId` (String, FK) - Links to Merchant
- `email` (String) - User email (unique per merchant)
- `passwordHash` (String) - **ENCRYPTED** bcrypt hash
- `role` (UserRole enum) - ADMIN | EDITOR | VIEWER
- `isActive` (Boolean) - Account status
- `lastLogin` (DateTime?) - Last login timestamp

**Constraints**:
- Unique constraint on `[merchantId, email]`
- Indexes on `merchantId` and `email`

### 3. ApiKey

**Purpose**: Public API keys for widget embedding and API access.

**Key Fields**:
- `id` (String, cuid) - Primary key
- `merchantId` (String, FK) - Links to Merchant
- `name` (String) - Human-readable name
- `token` (String, unique, Text) - Public API key (pk_live_xxx)
- `allowedOrigins` (String[]) - CORS whitelist
- `isActive` (Boolean) - Key status

**Constraints**:
- Unique constraint on `token`
- Indexes on `merchantId` and `token`

### 4. ReviewConfig

**Purpose**: Configuration for review platform integrations.

**Key Fields**:
- `id` (String, cuid) - Primary key
- `merchantId` (String, unique FK) - One-to-one with Merchant
- `provider` (ReviewProvider enum) - TRUSTPILOT | REVIEWS_IO | YOTPO | SITEJABBER | CUSTOM
- `businessId` (String) - Business ID in review platform
- `apiKey` (String) - **ENCRYPTED** Review platform API key
- `apiUrl` (String?) - Custom API URL (for CUSTOM provider)
- `companyReviewScore` (Float?) - Aggregated company rating
- `companyReviewCount` (Int?) - Total review count
- `syncEnabled` (Boolean) - Sync status
- `lastSyncedAt` (DateTime?) - Last sync timestamp

**Constraints**:
- Unique constraint on `merchantId` (one-to-one relationship)

### 5. AnalyticsEvent

**Purpose**: Comprehensive behavior tracking and analytics.

**Key Fields**:
- `id` (String, cuid) - Primary key
- `merchantId` (String, FK) - Links to Merchant
- `sessionId` (String) - Cross-domain session identifier
- `eventType` (String) - "message_sent" | "product_viewed" | "product_clicked" | "purchase" | etc.
- `payload` (Json) - Dynamic event data
- `userDevice` (String?) - "mobile" | "tablet" | "desktop"
- `userPage` (String?) - Merchant's page URL
- `userReferer` (String?) - Referrer URL
- `createdAt` (DateTime) - Event timestamp

**Indexes**:
- Composite indexes for common query patterns
- Index on `sessionId` for session tracking

## Updated Models

### Product

**New Fields**:
- `merchantId` (String, required FK) - Multi-tenant isolation
- `shopifyProductId` (String?) - Shopify product ID
- `shopifyHandle` (String?) - Shopify product handle
- `shopifyVariantIds` (String[]) - Array of variant IDs
- `shopifyBestseller` (Boolean) - Bestseller flag
- `shopifyTrending` (Boolean) - Trending flag
- `shopifySalesRank` (Int?) - Bestseller rank
- `reviewScore` (Float?) - Aggregated review rating
- `reviewCount` (Int?) - Review count
- `reviewsJson` (Json?) - Review snippets

**New Indexes**:
- `Product_merchantId_idx`
- `Product_merchantId_category_idx`
- `Product_merchantId_stockStatus_idx`
- `Product_merchantId_isActive_idx`
- `Product_shopifyProductId_idx`
- `Product_shopifyBestseller_idx`
- `Product_shopifyTrending_idx`

### MerchRule

**New Fields**:
- `merchantId` (String, required FK) - Multi-tenant isolation

**New Indexes**:
- `MerchRule_merchantId_idx`
- `MerchRule_merchantId_ruleType_idx`
- `MerchRule_merchantId_isActive_idx`

### ConversationEvent

**New Fields**:
- `merchantId` (String, required FK) - Multi-tenant isolation

**New Indexes**:
- `ConversationEvent_merchantId_idx`
- `ConversationEvent_merchantId_createdAt_idx`

### CatalogIngestionRun

**New Fields**:
- `merchantId` (String, required FK) - Multi-tenant isolation

**New Indexes**:
- `CatalogIngestionRun_merchantId_idx`
- `CatalogIngestionRun_merchantId_createdAt_idx`

## New Enums

### UserRole
```prisma
enum UserRole {
  ADMIN
  EDITOR
  VIEWER
}
```

### ReviewProvider
```prisma
enum ReviewProvider {
  TRUSTPILOT
  REVIEWS_IO
  YOTPO
  SITEJABBER
  CUSTOM
}
```

## Removed Models

### BrandConfig (deprecated, not dropped)

**Status**: Table is kept for now to allow gradual code migration. Will be dropped in a follow-up migration after all code is updated.

**Migration Path**: All data migrated to `Merchant` table with `slug = 'default'`.

## Security Considerations

### Encryption

The following fields should be encrypted at the application level (Prisma does not support encryption directives):

1. **Merchant.merchantOpenAIKey** - Merchant's OpenAI API key
2. **Merchant.shopifyAccessToken** - Shopify OAuth token
3. **Merchant.reviewApiKey** - Review platform API key
4. **MerchantUser.passwordHash** - bcrypt hashed password (already hashed, but should be stored securely)
5. **ReviewConfig.apiKey** - Review platform API key

### API Keys

- `ApiKey.token` stores **public** API keys (pk_live_xxx) - safe to expose in widgets
- Secret keys (sk_live_xxx) should be stored separately if needed

## Data Migration

All existing data is linked to a default merchant:
- **slug**: `"default"`
- **name**: `"Default Merchant"` (or from existing BrandConfig.brandName)
- All products, rules, events, and ingestion runs are linked to this merchant

## Query Patterns

### Before (Single-Merchant)
```typescript
const products = await prisma.product.findMany({
  where: { category: 'skincare' }
});
```

### After (Multi-Tenant)
```typescript
const products = await prisma.product.findMany({
  where: {
    merchantId: currentMerchantId,
    category: 'skincare'
  }
});
```

**Important**: All queries must now include `merchantId` in WHERE clauses to ensure data isolation.

## Index Strategy

All new indexes are designed to support:
1. **Multi-tenant isolation** - Fast filtering by `merchantId`
2. **Common query patterns** - Composite indexes for merchantId + other fields
3. **Performance** - Indexes on frequently queried fields

## Foreign Key Strategy

All foreign keys use `ON DELETE CASCADE`:
- When a merchant is deleted, all related data is automatically deleted
- Ensures data integrity and prevents orphaned records
- Simplifies cleanup operations


