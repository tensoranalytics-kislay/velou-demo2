/**
 * Backfill Enriched Embeddings
 * 
 * Generates embeddings for all products using enriched attributes.
 * This script should be run after ingesting enriched 2.csv to populate
 * embeddings with the new enriched attributes.
 * 
 * Usage:
 *   npx tsx scripts/backfill-enriched-embeddings.ts
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 *   - OPENAI_API_KEY (required)
 *   - MERCHANT_ID (optional, defaults to all merchants)
 */

import { backfillProductEmbeddings } from '../src/lib/search/vector/backfill';
import { logger } from '../src/lib/telemetry/logger';

async function main() {
  const merchantId = process.env.MERCHANT_ID;
  const dryRun = process.env.DRY_RUN === 'true';
  
  console.log('🔄 Starting enriched embeddings backfill...\n');
  console.log(`   Merchant ID: ${merchantId || 'all merchants'}`);
  console.log(`   Dry run: ${dryRun ? 'YES' : 'NO'}\n`);
  
  try {
    const result = await backfillProductEmbeddings({
      merchantId,
      batchSize: 50,
      dryRun,
    });
    
    console.log('\n✅ Backfill complete!\n');
    console.log('Summary:');
    console.log(`   Processed: ${result.processed}`);
    console.log(`   Succeeded: ${result.succeeded}`);
    console.log(`   Failed: ${result.failed}\n`);
    
    if (result.errors.length > 0) {
      console.log(`⚠️  Errors (${result.errors.length}):`);
      result.errors.slice(0, 10).forEach(({ productId, error }) => {
        console.log(`   - ${productId}: ${error}`);
      });
      if (result.errors.length > 10) {
        console.log(`   ... and ${result.errors.length - 10} more errors`);
      }
      console.log();
    }
    
    if (result.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logger.error('backfill-enriched-embeddings: fatal error', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});


