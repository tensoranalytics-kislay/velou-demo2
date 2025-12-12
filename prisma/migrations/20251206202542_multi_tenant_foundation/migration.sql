-- ============================================================================
-- Multi-Tenant Foundation Migration
-- ============================================================================
-- This migration transforms the single-merchant MVP into a multi-tenant SaaS:
-- 1. Creates Merchant table (replaces BrandConfig)
-- 2. Creates authentication tables (MerchantUser, ApiKey)
-- 3. Creates integration tables (ReviewConfig)
-- 4. Creates analytics table (AnalyticsEvent)
-- 5. Adds merchantId to all existing tables
-- 6. Migrates existing BrandConfig data to Merchant
-- 7. Links all existing data to default merchant
-- ============================================================================

-- ============================================================================
-- STEP 1: Create new tables
-- ============================================================================

-- Create Merchant table (replaces BrandConfig)
CREATE TABLE IF NOT EXISTS "Merchant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#e11d48',
    "accentColor" TEXT NOT NULL DEFAULT '#f97373',
    "backgroundColor" TEXT NOT NULL DEFAULT '#ffffff',
    "surfaceColor" TEXT NOT NULL DEFAULT '#fff7f7',
    "borderColor" TEXT NOT NULL DEFAULT '#ffe4e6',
    "logoUrl" TEXT,
    "voiceInstructions" TEXT NOT NULL,
    "toneFormal" INTEGER NOT NULL,
    "tonePlayful" INTEGER NOT NULL,
    "useMerchantKey" BOOLEAN NOT NULL DEFAULT false,
    "merchantOpenAIKey" TEXT,
    "datasetContext" JSONB,
    "shopifyStore" TEXT,
    "shopifyAccessToken" TEXT,
    "shopifySyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shopifySyncedAt" TIMESTAMP(3),
    "reviewProvider" TEXT,
    "reviewApiKey" TEXT,
    "reviewSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- Create MerchantUser table
CREATE TABLE IF NOT EXISTS "MerchantUser" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantUser_pkey" PRIMARY KEY ("id")
);

-- Create ApiKey table
CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "allowedOrigins" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- Create ReviewConfig table
CREATE TABLE IF NOT EXISTS "ReviewConfig" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiUrl" TEXT,
    "companyReviewScore" DOUBLE PRECISION,
    "companyReviewCount" INTEGER,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewConfig_pkey" PRIMARY KEY ("id")
);

-- Create AnalyticsEvent table
CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "userDevice" TEXT,
    "userPage" TEXT,
    "userReferer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- STEP 2: Add merchantId columns to existing tables
-- ============================================================================

-- Add merchantId to Product (nullable initially, will be populated)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "merchantId" TEXT;

-- Add Shopify fields to Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopifyProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopifyHandle" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopifyVariantIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopifyBestseller" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopifyTrending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopifySalesRank" INTEGER;

-- Add Review fields to Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reviewScore" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reviewCount" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reviewsJson" JSONB;

-- Add merchantId to MerchRule
ALTER TABLE "MerchRule" ADD COLUMN IF NOT EXISTS "merchantId" TEXT;

-- Add merchantId to ConversationEvent
ALTER TABLE "ConversationEvent" ADD COLUMN IF NOT EXISTS "merchantId" TEXT;

-- Add merchantId to CatalogIngestionRun
ALTER TABLE "CatalogIngestionRun" ADD COLUMN IF NOT EXISTS "merchantId" TEXT;

-- ============================================================================
-- STEP 3: Migrate BrandConfig data to Merchant
-- ============================================================================

-- Create default merchant from existing BrandConfig (if it exists)
DO $$
DECLARE
    default_merchant_id TEXT := 'default-merchant-' || gen_random_uuid()::TEXT;
    brand_config_exists BOOLEAN;
BEGIN
    -- Check if BrandConfig exists and has data
    SELECT EXISTS(SELECT 1 FROM "BrandConfig" WHERE "id" = 1) INTO brand_config_exists;
    
    IF brand_config_exists THEN
        -- Migrate BrandConfig to Merchant
        INSERT INTO "Merchant" (
            "id",
            "slug",
            "name",
            "brandName",
            "primaryColor",
            "accentColor",
            "backgroundColor",
            "surfaceColor",
            "borderColor",
            "logoUrl",
            "voiceInstructions",
            "toneFormal",
            "tonePlayful",
            "useMerchantKey",
            "merchantOpenAIKey",
            "datasetContext",
            "createdAt",
            "updatedAt"
        )
        SELECT
            default_merchant_id,
            'default',
            COALESCE("brandName", 'Default Merchant'),
            COALESCE("brandName", 'Default Merchant'),
            COALESCE("primaryColor", '#e11d48'),
            COALESCE("accentColor", '#f97373'),
            COALESCE("backgroundColor", '#ffffff'),
            COALESCE("surfaceColor", '#fff7f7'),
            COALESCE("borderColor", '#ffe4e6'),
            "logoUrl",
            COALESCE("voiceInstructions", ''),
            COALESCE("toneFormal", 5),
            COALESCE("tonePlayful", 5),
            COALESCE("useMerchantKey", false),
            "merchantOpenAIKey",
            "datasetContext",
            COALESCE("createdAt", CURRENT_TIMESTAMP),
            COALESCE("updatedAt", CURRENT_TIMESTAMP)
        FROM "BrandConfig"
        WHERE "id" = 1
        ON CONFLICT DO NOTHING;
    ELSE
        -- Create default merchant if no BrandConfig exists
        INSERT INTO "Merchant" (
            "id",
            "slug",
            "name",
            "brandName",
            "voiceInstructions",
            "toneFormal",
            "tonePlayful",
            "createdAt",
            "updatedAt"
        )
        VALUES (
            default_merchant_id,
            'default',
            'Default Merchant',
            'Default Merchant',
            'You are a helpful shopping assistant.',
            5,
            5,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Link existing data to default merchant
-- ============================================================================

-- Link all existing Products to default merchant
UPDATE "Product"
SET "merchantId" = (SELECT "id" FROM "Merchant" WHERE "slug" = 'default' LIMIT 1)
WHERE "merchantId" IS NULL;

-- Link all existing MerchRules to default merchant
UPDATE "MerchRule"
SET "merchantId" = (SELECT "id" FROM "Merchant" WHERE "slug" = 'default' LIMIT 1)
WHERE "merchantId" IS NULL;

-- Link all existing ConversationEvents to default merchant
UPDATE "ConversationEvent"
SET "merchantId" = (SELECT "id" FROM "Merchant" WHERE "slug" = 'default' LIMIT 1)
WHERE "merchantId" IS NULL;

-- Link all existing CatalogIngestionRuns to default merchant
UPDATE "CatalogIngestionRun"
SET "merchantId" = (SELECT "id" FROM "Merchant" WHERE "slug" = 'default' LIMIT 1)
WHERE "merchantId" IS NULL;

-- ============================================================================
-- STEP 5: Add foreign key constraints
-- ============================================================================

-- Add foreign keys after data migration
ALTER TABLE "Product" 
    ADD CONSTRAINT "Product_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

ALTER TABLE "MerchRule" 
    ADD CONSTRAINT "MerchRule_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

ALTER TABLE "ConversationEvent" 
    ADD CONSTRAINT "ConversationEvent_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

ALTER TABLE "CatalogIngestionRun" 
    ADD CONSTRAINT "CatalogIngestionRun_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

ALTER TABLE "MerchantUser" 
    ADD CONSTRAINT "MerchantUser_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

ALTER TABLE "ApiKey" 
    ADD CONSTRAINT "ApiKey_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

ALTER TABLE "ReviewConfig" 
    ADD CONSTRAINT "ReviewConfig_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

ALTER TABLE "AnalyticsEvent" 
    ADD CONSTRAINT "AnalyticsEvent_merchantId_fkey" 
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE;

-- ============================================================================
-- STEP 6: Make merchantId required (NOT NULL) after data migration
-- ============================================================================

-- Make merchantId required on all tables
ALTER TABLE "Product" ALTER COLUMN "merchantId" SET NOT NULL;
ALTER TABLE "MerchRule" ALTER COLUMN "merchantId" SET NOT NULL;
ALTER TABLE "ConversationEvent" ALTER COLUMN "merchantId" SET NOT NULL;
ALTER TABLE "CatalogIngestionRun" ALTER COLUMN "merchantId" SET NOT NULL;

-- ============================================================================
-- STEP 7: Create indexes for performance
-- ============================================================================

-- Merchant indexes
CREATE UNIQUE INDEX IF NOT EXISTS "Merchant_slug_key" ON "Merchant"("slug");
CREATE INDEX IF NOT EXISTS "Merchant_slug_idx" ON "Merchant"("slug");
CREATE INDEX IF NOT EXISTS "Merchant_createdAt_idx" ON "Merchant"("createdAt");

-- MerchantUser indexes
CREATE UNIQUE INDEX IF NOT EXISTS "MerchantUser_merchantId_email_key" ON "MerchantUser"("merchantId", "email");
CREATE INDEX IF NOT EXISTS "MerchantUser_merchantId_idx" ON "MerchantUser"("merchantId");
CREATE INDEX IF NOT EXISTS "MerchantUser_email_idx" ON "MerchantUser"("email");

-- ApiKey indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_token_key" ON "ApiKey"("token");
CREATE INDEX IF NOT EXISTS "ApiKey_merchantId_idx" ON "ApiKey"("merchantId");
CREATE INDEX IF NOT EXISTS "ApiKey_token_idx" ON "ApiKey"("token");

-- ReviewConfig indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewConfig_merchantId_key" ON "ReviewConfig"("merchantId");
CREATE INDEX IF NOT EXISTS "ReviewConfig_merchantId_idx" ON "ReviewConfig"("merchantId");

-- AnalyticsEvent indexes
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_merchantId_idx" ON "AnalyticsEvent"("merchantId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_merchantId_createdAt_idx" ON "AnalyticsEvent"("merchantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_merchantId_eventType_idx" ON "AnalyticsEvent"("merchantId", "eventType");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent"("sessionId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- Product indexes (new multi-tenant indexes)
CREATE INDEX IF NOT EXISTS "Product_merchantId_idx" ON "Product"("merchantId");
CREATE INDEX IF NOT EXISTS "Product_merchantId_category_idx" ON "Product"("merchantId", "category");
CREATE INDEX IF NOT EXISTS "Product_merchantId_stockStatus_idx" ON "Product"("merchantId", "stockStatus");
CREATE INDEX IF NOT EXISTS "Product_merchantId_isActive_idx" ON "Product"("merchantId", "isActive");
CREATE INDEX IF NOT EXISTS "Product_shopifyProductId_idx" ON "Product"("shopifyProductId");
CREATE INDEX IF NOT EXISTS "Product_shopifyBestseller_idx" ON "Product"("shopifyBestseller");
CREATE INDEX IF NOT EXISTS "Product_shopifyTrending_idx" ON "Product"("shopifyTrending");

-- MerchRule indexes
CREATE INDEX IF NOT EXISTS "MerchRule_merchantId_idx" ON "MerchRule"("merchantId");
CREATE INDEX IF NOT EXISTS "MerchRule_merchantId_ruleType_idx" ON "MerchRule"("merchantId", "ruleType");
CREATE INDEX IF NOT EXISTS "MerchRule_merchantId_isActive_idx" ON "MerchRule"("merchantId", "isActive");

-- ConversationEvent indexes
CREATE INDEX IF NOT EXISTS "ConversationEvent_merchantId_idx" ON "ConversationEvent"("merchantId");
CREATE INDEX IF NOT EXISTS "ConversationEvent_merchantId_createdAt_idx" ON "ConversationEvent"("merchantId", "createdAt");

-- CatalogIngestionRun indexes
CREATE INDEX IF NOT EXISTS "CatalogIngestionRun_merchantId_idx" ON "CatalogIngestionRun"("merchantId");
CREATE INDEX IF NOT EXISTS "CatalogIngestionRun_merchantId_createdAt_idx" ON "CatalogIngestionRun"("merchantId", "createdAt");

-- ============================================================================
-- STEP 8: Add unique constraints
-- ============================================================================

-- Ensure slug uniqueness (already handled by unique index, but adding constraint for clarity)
-- Note: The unique index above already enforces this

-- ============================================================================
-- STEP 9: Drop BrandConfig table (after migration is complete)
-- ============================================================================
-- NOTE: We keep BrandConfig for now to allow gradual migration of code
-- Drop it in a follow-up migration after all code is updated:
-- DROP TABLE IF EXISTS "BrandConfig";


