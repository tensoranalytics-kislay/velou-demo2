/**
 * Ingest Enriched CSV for LoveshackFancy
 * 
 * This script performs a FULL_REPLACE ingestion of the enriched.csv dataset.
 * It will:
 * 1. Delete all existing products for the merchant
 * 2. Ingest all products from enriched.csv
 * 3. Store sizes/colors in Product.attributes (no ProductVariant)
 * 
 * Usage:
 *   npx tsx scripts/ingest-enriched-lsf.ts
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 *   - ENRICHED_CSV_PATH (optional, defaults to ./enriched.csv)
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { IngestionMode } from '@prisma/client';
import { ingestEnrichedCsvStream } from '../src/lib/catalog/ingestEnrichedCsv';

const MERCHANT_ID = 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b'; // Default merchant from database
const VENDOR_ID = 'loveshackfancy_enriched';

async function main() {
  const csvPath = process.env.ENRICHED_CSV_PATH || path.resolve(process.cwd(), 'enriched.csv');
  
  console.log('📦 Starting enriched CSV ingestion...\n');
  console.log(`   CSV Path: ${csvPath}`);
  console.log(`   Merchant ID: ${MERCHANT_ID}`);
  console.log(`   Vendor ID: ${VENDOR_ID}`);
  console.log(`   Mode: FULL_REPLACE (will delete all existing products)\n`);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    process.exit(1);
  }

  const fileSize = fs.statSync(csvPath).size;
  console.log(`   File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB\n`);

  const fileContent = fs.readFileSync(csvPath);
  const stream = Readable.from(fileContent);

  try {
    console.log('🚀 Starting ingestion...\n');
    const summary = await ingestEnrichedCsvStream(stream, VENDOR_ID, MERCHANT_ID, {
      mode: IngestionMode.FULL_REPLACE,
    });

    console.log('\n✅ Ingestion complete!\n');
    console.log('Summary:');
    console.log(`   Total rows processed: ${summary.totalRows}`);
    console.log(`   Products inserted: ${summary.inserted}`);
    console.log(`   Products updated: ${summary.updated}`);
    console.log(`   Invalid rows: ${summary.invalidRows}`);
    console.log(`   Ingestion run ID: ${summary.runId}\n`);

    if (summary.invalidRows > 0) {
      console.log(`⚠️  Warning: ${summary.invalidRows} rows were invalid and skipped\n`);
    }
  } catch (error) {
    console.error('\n❌ Ingestion failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});




