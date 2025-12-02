-- Add full-text search support for product search
-- This enables database-level ranking that considers all products

-- Add search_vector column for full-text search
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "Product_search_vector_idx" ON "Product" USING GIN ("search_vector");

-- Create function to update search_vector
CREATE OR REPLACE FUNCTION update_product_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update search_vector
DROP TRIGGER IF EXISTS product_search_vector_update ON "Product";
CREATE TRIGGER product_search_vector_update
  BEFORE INSERT OR UPDATE ON "Product"
  FOR EACH ROW
  EXECUTE FUNCTION update_product_search_vector();

-- Update existing products
UPDATE "Product" SET
  search_vector = setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
                  setweight(to_tsvector('english', COALESCE(description, '')), 'B')
WHERE search_vector IS NULL;

-- Add index on priceCents for price range queries
CREATE INDEX IF NOT EXISTS "Product_priceCents_idx" ON "Product"("priceCents");

-- Add index on brand for brand filtering
CREATE INDEX IF NOT EXISTS "Product_brand_idx" ON "Product"("brand") WHERE "brand" IS NOT NULL;


