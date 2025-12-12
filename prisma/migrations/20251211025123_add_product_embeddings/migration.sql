-- Add vector embeddings for semantic search
-- See: docs/loccitane_multiview_retrieval.md (Phase 1.2)

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to Product table
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create IVFFLAT index for fast approximate nearest neighbor search
-- Using cosine distance operator (<=>)
-- Lists parameter: 100 is a good default for small-medium catalogs (<100k products)
-- Adjust based on catalog size (rule of thumb: lists = rows / 1000)
CREATE INDEX IF NOT EXISTS idx_product_embedding 
  ON "Product" 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Note: Embeddings will be backfilled using the backfill utility
-- See: src/lib/search/vector/backfill.ts



