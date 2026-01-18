-- Optimize product lookup queries for faster data loading
-- This composite index helps with queries that filter by merchantId, isActive, and lookup by id

-- Composite index for common product lookup pattern: WHERE id IN (...) AND merchantId = ? AND isActive = true
-- While id is already the primary key, this composite index can help when combined with merchantId and isActive filters
CREATE INDEX IF NOT EXISTS "Product_merchantId_isActive_id_idx" 
ON "Product"("merchantId", "isActive", "id") 
WHERE "isActive" = true;

-- Note: The primary key index on id is already optimal for IN clause lookups
-- This composite index provides additional optimization for multi-tenant queries
-- that filter by merchantId and isActive while looking up multiple product IDs
