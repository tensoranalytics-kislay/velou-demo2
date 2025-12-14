#!/usr/bin/env tsx
/**
 * CLI Script: Backfill Product Embeddings
 * 
 * Generates and stores embeddings for products that don't have them yet.
 * 
 * Usage:
 *   pnpm backfill:embeddings
 *   pnpm backfill:embeddings --merchant-id=<id>
 *   pnpm backfill:embeddings --merchant-id=<id> --batch-size=100
 *   pnpm backfill:embeddings --merchant-id=<id> --dry-run
 * 
 * Environment variables:
 *   MERCHANT_ID - Optional merchant ID to backfill (if not provided, backfills all)
 *   BATCH_SIZE - Batch size (default: 50)
 *   DRY_RUN - If "true", logs but doesn't write to database
 */

import { backfillProductEmbeddings } from '../src/lib/search/vector/backfill';
import { logger } from '../src/lib/telemetry/logger';

function parseArgs(): {
  merchantId?: string;
  batchSize?: number;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const result: {
    merchantId?: string;
    batchSize?: number;
    dryRun: boolean;
  } = {
    dryRun: false,
  };
  
  for (const arg of args) {
    if (arg.startsWith('--merchant-id=')) {
      result.merchantId = arg.split('=')[1];
    } else if (arg.startsWith('--batch-size=')) {
      result.batchSize = parseInt(arg.split('=')[1], 10);
      if (isNaN(result.batchSize) || result.batchSize <= 0) {
        console.error('Invalid batch size. Must be a positive number.');
        process.exit(1);
      }
    } else if (arg === '--dry-run' || arg === '--dry-run=true') {
      result.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: pnpm backfill:embeddings [options]

Options:
  --merchant-id=<id>    Backfill only for specified merchant ID
  --batch-size=<n>      Number of products to process per batch (default: 50)
  --dry-run             Log what would be done without writing to database
  --help, -h            Show this help message

Environment variables:
  MERCHANT_ID           Same as --merchant-id
  BATCH_SIZE            Same as --batch-size
  DRY_RUN               Same as --dry-run (set to "true")
      `);
      process.exit(0);
    }
  }
  
  // Override with environment variables if not provided via CLI
  if (!result.merchantId && process.env.MERCHANT_ID) {
    result.merchantId = process.env.MERCHANT_ID;
  }
  
  if (!result.batchSize && process.env.BATCH_SIZE) {
    result.batchSize = parseInt(process.env.BATCH_SIZE, 10);
    if (isNaN(result.batchSize) || result.batchSize <= 0) {
      console.error('Invalid BATCH_SIZE environment variable. Must be a positive number.');
      process.exit(1);
    }
  }
  
  if (!result.dryRun && process.env.DRY_RUN === 'true') {
    result.dryRun = true;
  }
  
  return result;
}

async function main() {
  try {
    const options = parseArgs();
    
    console.log('\n' + '='.repeat(60));
    console.log('🔄 Starting Product Embeddings Backfill');
    console.log('='.repeat(60));
    
    if (options.merchantId) {
      console.log(`Merchant ID: ${options.merchantId}`);
    } else {
      console.log('Merchant ID: All merchants');
    }
    
    console.log(`Batch Size: ${options.batchSize || 50}`);
    console.log(`Dry Run: ${options.dryRun ? 'Yes (no writes)' : 'No (will update database)'}`);
    console.log('');
    
    if (options.dryRun) {
      console.log('⚠️  DRY RUN MODE: No changes will be written to the database\n');
    }
    
    const result = await backfillProductEmbeddings({
      merchantId: options.merchantId,
      batchSize: options.batchSize,
      dryRun: options.dryRun,
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Backfill Complete');
    console.log('='.repeat(60));
    console.log(`Processed: ${result.processed}`);
    console.log(`Succeeded: ${result.succeeded}`);
    console.log(`Failed: ${result.failed}`);
    
    if (result.errors.length > 0) {
      console.log(`\nErrors (showing first 10 of ${result.errors.length}):`);
      result.errors.slice(0, 10).forEach((err, idx) => {
        console.log(`  ${idx + 1}. Product ${err.productId}: ${err.error}`);
      });
      if (result.errors.length > 10) {
        console.log(`  ... and ${result.errors.length - 10} more errors`);
      }
    }
    
    if (options.dryRun) {
      console.log('\n⚠️  This was a dry run. Run without --dry-run to update the database.');
    }
    
    console.log('');
    
    // Exit with error code if there were failures
    if (result.failed > 0 && result.succeeded === 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Backfill failed:', error instanceof Error ? error.message : String(error));
    logger.error('backfillProductEmbeddings script failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main();




