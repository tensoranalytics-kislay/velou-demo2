# Multi-Tenant Foundation Migration

## Quick Start

1. **Review the migration**:
   ```bash
   cat prisma/migrations/20251206202542_multi_tenant_foundation/migration.sql
   ```

2. **Run the migration**:
   ```bash
   npx prisma migrate dev --name multi_tenant_foundation
   ```
   
   Or if you want to apply it directly:
   ```bash
   npx prisma migrate deploy
   ```

3. **Generate Prisma client**:
   ```bash
   npx prisma generate
   ```

4. **Set up default merchant** (optional):
   ```bash
   # First install bcryptjs
   npm install bcryptjs @types/bcryptjs
   
   # Then run setup script
   npx tsx scripts/setup-default-merchant.ts
   ```

## What This Migration Does

This migration transforms the Velou Shopping Assistant from a **single-merchant MVP** to a **multi-tenant SaaS foundation** by:

1. ✅ Creating `Merchant` table (replaces `BrandConfig`)
2. ✅ Creating authentication tables (`MerchantUser`, `ApiKey`)
3. ✅ Creating integration tables (`ReviewConfig`)
4. ✅ Creating analytics table (`AnalyticsEvent`)
5. ✅ Adding `merchantId` to all existing tables
6. ✅ Migrating existing `BrandConfig` data to `Merchant`
7. ✅ Linking all existing data to default merchant
8. ✅ Creating indexes for performance
9. ✅ Adding foreign key constraints

## Files in This Migration

- `migration.sql` - Main migration SQL script
- `MIGRATION_NOTES.md` - Detailed migration notes and post-migration tasks
- `SCHEMA_CHANGES.md` - Complete schema changes documentation
- `README.md` - This file

## New Models Created

1. **Merchant** - Replaces BrandConfig, represents each tenant
2. **MerchantUser** - Authentication and authorization
3. **ApiKey** - Widget embedding and public API access
4. **ReviewConfig** - Review platform integrations
5. **AnalyticsEvent** - Behavior tracking

## Updated Models

All existing models now include `merchantId`:
- `Product` - Added merchantId + Shopify/Review fields
- `MerchRule` - Added merchantId
- `ConversationEvent` - Added merchantId
- `CatalogIngestionRun` - Added merchantId

## Default Merchant

The migration creates a default merchant:
- **slug**: `"default"`
- **name**: `"Default Merchant"` (or from existing BrandConfig)
- All existing data is linked to this merchant

## Security Notes

### Encryption Required

The following fields must be encrypted at the application level:
- `Merchant.merchantOpenAIKey`
- `Merchant.shopifyAccessToken`
- `Merchant.reviewApiKey`
- `MerchantUser.passwordHash` (bcrypt hash)
- `ReviewConfig.apiKey`

Prisma does not support encryption directives - use libraries like `libsodium` or Node.js `crypto`.

## Post-Migration Checklist

- [ ] Migration runs successfully
- [ ] Default merchant created
- [ ] All existing data linked to default merchant
- [ ] Run `npx prisma generate` to update Prisma client
- [ ] Install bcryptjs: `npm install bcryptjs @types/bcryptjs`
- [ ] Run setup script: `npx tsx scripts/setup-default-merchant.ts`
- [ ] Update application code to use `Merchant` instead of `BrandConfig`
- [ ] Update all queries to include `merchantId` filters
- [ ] Implement encryption for sensitive fields
- [ ] Test multi-tenant data isolation
- [ ] Drop `BrandConfig` table in follow-up migration

## Rollback

If you need to rollback:
1. The `BrandConfig` table is NOT dropped (kept for safety)
2. You can restore data from `Merchant` back to `BrandConfig`
3. Remove `merchantId` columns (requires data cleanup)

## Next Steps

After this migration:
1. **Phase 0.2**: Implement JWT authentication
2. **Phase 0.3**: Refactor orchestrator and search modules
3. **Phase 1**: Widget separation and embedding

See `PRODUCTIZATION_ROADMAP.md` for full implementation plan.

## Support

For issues or questions:
1. Check `MIGRATION_NOTES.md` for detailed documentation
2. Check `SCHEMA_CHANGES.md` for schema reference
3. Review migration SQL for implementation details


