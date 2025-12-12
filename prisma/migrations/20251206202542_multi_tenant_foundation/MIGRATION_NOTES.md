# Multi-Tenant Foundation Migration Notes

## Overview

This migration transforms the Velou Shopping Assistant from a single-merchant MVP to a multi-tenant SaaS foundation. It introduces:

1. **Merchant table** - Replaces `BrandConfig`, represents each tenant
2. **MerchantUser table** - Authentication and authorization
3. **ApiKey table** - Widget embedding and public API access
4. **ReviewConfig table** - Review platform integrations
5. **AnalyticsEvent table** - Behavior tracking
6. **Multi-tenant fields** - Adds `merchantId` to all existing tables

## Migration Steps

The migration SQL performs the following operations in order:

### 1. Create New Tables
- Creates all new tables with proper structure
- Includes all fields from `BrandConfig` → `Merchant`
- Adds new integration fields (Shopify, Reviews)

### 2. Add merchantId Columns
- Adds `merchantId` to `Product`, `MerchRule`, `ConversationEvent`, `CatalogIngestionRun`
- Initially nullable to allow data migration

### 3. Migrate BrandConfig Data
- Creates default merchant from existing `BrandConfig` (id=1)
- If no `BrandConfig` exists, creates a default merchant
- Preserves all branding, voice, and configuration data

### 4. Link Existing Data
- Links all existing products to default merchant
- Links all existing rules, events, and ingestion runs to default merchant

### 5. Add Foreign Keys
- Creates foreign key constraints after data migration
- Ensures referential integrity
- Uses `ON DELETE CASCADE` for automatic cleanup

### 6. Make merchantId Required
- Sets `merchantId` to `NOT NULL` after all data is linked
- Ensures data integrity going forward

### 7. Create Indexes
- Creates performance indexes for all new fields
- Includes composite indexes for common query patterns

## Default Merchant

The migration creates a default merchant with:
- **slug**: `"default"`
- **name**: `"Default Merchant"` (or from existing BrandConfig.brandName)
- **id**: Generated UUID-based ID

All existing data is linked to this default merchant.

## Security Notes

### Encryption
Fields marked as "ENCRYPTED" in the schema comments should be encrypted at the application level:
- `Merchant.merchantOpenAIKey`
- `Merchant.shopifyAccessToken`
- `Merchant.reviewApiKey`
- `MerchantUser.passwordHash`
- `ReviewConfig.apiKey`

Prisma does not support encryption directives - encryption must be handled in application code using libraries like `libsodium` or `crypto`.

### API Keys
- `ApiKey.token` stores public API keys (pk_live_xxx) - these are safe to expose in widgets
- Secret keys (sk_live_xxx) should be stored separately if needed

## Data Migration Safety

The migration is designed to be safe:
- Uses `IF NOT EXISTS` for all table/column creation
- Uses `ON CONFLICT DO NOTHING` for merchant creation
- Preserves all existing data
- Does NOT drop `BrandConfig` table (done in follow-up migration)

## Rollback Plan

If rollback is needed:
1. Keep `BrandConfig` table (not dropped in this migration)
2. Can restore data from `Merchant` back to `BrandConfig`
3. Remove `merchantId` columns (requires data cleanup first)

## Post-Migration Tasks

After running this migration:

1. **Update Application Code**
   - Replace all `BrandConfig` queries with `Merchant` queries
   - Update all queries to include `merchantId` filters
   - Implement encryption for sensitive fields

2. **Create Default Admin User**
   ```sql
   INSERT INTO "MerchantUser" (id, merchantId, email, passwordHash, role)
   VALUES (
     gen_random_uuid()::TEXT,
     (SELECT id FROM "Merchant" WHERE slug = 'default'),
     'admin@example.com',
     '$2b$10$...', -- bcrypt hash
     'ADMIN'
   );
   ```

3. **Create Default API Key**
   ```sql
   INSERT INTO "ApiKey" (id, merchantId, name, token, allowedOrigins, isActive)
   VALUES (
     gen_random_uuid()::TEXT,
     (SELECT id FROM "Merchant" WHERE slug = 'default'),
     'Default Widget Key',
     'pk_live_' || gen_random_uuid()::TEXT,
     ARRAY['localhost:3000'],
     true
   );
   ```

4. **Test Multi-Tenant Isolation**
   - Verify queries filter by `merchantId`
   - Test that merchants cannot access each other's data
   - Verify foreign key constraints work correctly

5. **Drop BrandConfig Table** (in follow-up migration)
   ```sql
   DROP TABLE IF EXISTS "BrandConfig";
   ```

## Indexes Created

### Merchant
- `Merchant_slug_key` (unique)
- `Merchant_slug_idx`
- `Merchant_createdAt_idx`

### MerchantUser
- `MerchantUser_merchantId_email_key` (unique)
- `MerchantUser_merchantId_idx`
- `MerchantUser_email_idx`

### ApiKey
- `ApiKey_token_key` (unique)
- `ApiKey_merchantId_idx`
- `ApiKey_token_idx`

### ReviewConfig
- `ReviewConfig_merchantId_key` (unique)
- `ReviewConfig_merchantId_idx`

### AnalyticsEvent
- `AnalyticsEvent_merchantId_idx`
- `AnalyticsEvent_merchantId_createdAt_idx`
- `AnalyticsEvent_merchantId_eventType_idx`
- `AnalyticsEvent_sessionId_idx`
- `AnalyticsEvent_createdAt_idx`

### Product (new indexes)
- `Product_merchantId_idx`
- `Product_merchantId_category_idx`
- `Product_merchantId_stockStatus_idx`
- `Product_merchantId_isActive_idx`
- `Product_shopifyProductId_idx`
- `Product_shopifyBestseller_idx`
- `Product_shopifyTrending_idx`

### MerchRule (new indexes)
- `MerchRule_merchantId_idx`
- `MerchRule_merchantId_ruleType_idx`
- `MerchRule_merchantId_isActive_idx`

### ConversationEvent (new indexes)
- `ConversationEvent_merchantId_idx`
- `ConversationEvent_merchantId_createdAt_idx`

### CatalogIngestionRun (new indexes)
- `CatalogIngestionRun_merchantId_idx`
- `CatalogIngestionRun_merchantId_createdAt_idx`

## Performance Considerations

- All queries should include `merchantId` in WHERE clauses
- Composite indexes support common query patterns
- Foreign keys ensure referential integrity
- Consider partitioning by `merchantId` for very large datasets (future optimization)

## Testing Checklist

- [ ] Migration runs without errors
- [ ] Default merchant created successfully
- [ ] All existing products linked to default merchant
- [ ] All existing rules linked to default merchant
- [ ] All existing events linked to default merchant
- [ ] Foreign keys work correctly
- [ ] Indexes are created
- [ ] Can query products by merchantId
- [ ] Can create new merchant
- [ ] Can create merchant user
- [ ] Can create API key
- [ ] Data isolation works (merchant A cannot see merchant B's data)


