-- Enhance search_vector to include subcategory and productType-related fields
-- This improves gift query matching (Duo, Trio, Gift Set) via full-text search

-- Update function to include subcategory and product type information
CREATE OR REPLACE FUNCTION update_product_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.subcategory, '')), 'C') ||
    -- Extract productType from attributes JSON if available
    setweight(to_tsvector('english', COALESCE(
      CASE 
        WHEN NEW.attributes::jsonb->'loccitaneStructured'->>'productType' IS NOT NULL
        THEN NEW.attributes::jsonb->'loccitaneStructured'->>'productType'
        WHEN NEW.attributes::jsonb->>'productType' IS NOT NULL
        THEN NEW.attributes::jsonb->>'productType'
        ELSE ''
      END, ''
    )), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rebuild search_vector for existing products
UPDATE "Product" SET
  search_vector = setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
                  setweight(to_tsvector('english', COALESCE(description, '')), 'B') ||
                  setweight(to_tsvector('english', COALESCE(subcategory, '')), 'C') ||
                  setweight(to_tsvector('english', COALESCE(
                    CASE 
                      WHEN attributes::jsonb->'loccitaneStructured'->>'productType' IS NOT NULL
                      THEN attributes::jsonb->'loccitaneStructured'->>'productType'
                      WHEN attributes::jsonb->>'productType' IS NOT NULL
                      THEN attributes::jsonb->>'productType'
                      ELSE ''
                    END, ''
                  )), 'C')
WHERE search_vector IS NOT NULL;



