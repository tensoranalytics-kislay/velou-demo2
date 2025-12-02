-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "vendorId" TEXT,
ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "lastIngestBatchId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_vendorId_isActive_idx" ON "Product"("vendorId", "isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_vendorId_sourceId_idx" ON "Product"("vendorId", "sourceId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "CatalogIngestionRun" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL,
    "inserted" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER,

    CONSTRAINT "CatalogIngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatalogIngestionRun_vendorId_createdAt_idx" ON "CatalogIngestionRun"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatalogIngestionRun_createdAt_idx" ON "CatalogIngestionRun"("createdAt");



