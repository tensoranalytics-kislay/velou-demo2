-- Remove legacy Perplexity merchant key column now that the stack is OpenAI-only
ALTER TABLE "BrandConfig" DROP COLUMN IF EXISTS "merchantPerplexityKey";




