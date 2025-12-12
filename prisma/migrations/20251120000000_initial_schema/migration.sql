-- Initial schema migration
-- This migration creates the Product table and other base tables
-- that existed before migrations were tracked.

-- Note: This is a baseline migration. The actual database already has these tables.
-- This migration exists only to satisfy Prisma's shadow database validation.

-- Create enum types first (if they don't exist)
DO $$ BEGIN
    CREATE TYPE "StockStatus" AS ENUM ('in_stock', 'out_of_stock', 'low_stock');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "MerchRuleType" AS ENUM ('boost_category', 'exclude_category', 'hide_out_of_stock');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PageType" AS ENUM ('HOME', 'PLP', 'PDP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "IngestionMode" AS ENUM ('FULL_REPLACE', 'INCREMENTAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create Product table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "brand" TEXT,
    "attributes" JSONB NOT NULL,
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'in_stock',
    "vendorId" TEXT,
    "sourceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastIngestBatchId" TEXT,
    "shopifyProductId" TEXT,
    "shopifyHandle" TEXT,
    "shopifyVariantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shopifyBestseller" BOOLEAN NOT NULL DEFAULT false,
    "shopifyTrending" BOOLEAN NOT NULL DEFAULT false,
    "shopifySalesRank" INTEGER,
    "reviewScore" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "reviewsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- Create other base tables if they don't exist
CREATE TABLE IF NOT EXISTS "MerchRule" (
    "id" SERIAL NOT NULL,
    "merchantId" TEXT NOT NULL,
    "ruleType" "MerchRuleType" NOT NULL,
    "value" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConversationEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pageType" "PageType" NOT NULL,
    "productContextId" TEXT,
    "userQuery" VARCHAR(256) NOT NULL,
    "productIds" TEXT[] NOT NULL,
    "hadExactMatch" BOOLEAN NOT NULL DEFAULT false,
    "clickedProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assistantReplySnippet" VARCHAR(256),
    "clicked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConversationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CatalogIngestionRun" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL,
    "inserted" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER,
    "mode" "IngestionMode" NOT NULL,

    CONSTRAINT "CatalogIngestionRun_pkey" PRIMARY KEY ("id")
);

-- Create BrandConfig table (for backward compatibility, will be migrated to Merchant)
CREATE TABLE IF NOT EXISTS "BrandConfig" (
    "id" INTEGER NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandConfig_pkey" PRIMARY KEY ("id")
);
