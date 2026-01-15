/**
 * Ingest Enriched CSV for Mott & Bow
 * 
 * This script performs an INCREMENTAL ingestion of the Mott & Bow enriched CSV dataset.
 * It will:
 * 1. Keep all existing products (LSF and others)
 * 2. Add/update Mott & Bow products from mott_bow_enriched_with_colors.csv
 * 3. Store sizes/colors in Product.attributes
 * 4. Read gender from CSV column (male/female/unisex)
 * 
 * Usage:
 *   npx tsx scripts/ingest-mott-bow.ts
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 *   - ENRICHED_CSV_PATH (optional, defaults to ./mott_bow_enriched_with_colors.csv)
 *   - MERCHANT_ID (optional, defaults to default merchant)
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { IngestionMode } from '@prisma/client';
import { ingestEnrichedCsvStream } from '../src/lib/catalog/ingestEnrichedCsv';

const MERCHANT_ID = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
const VENDOR_ID = 'mott_bow';

async function main() {
  const csvPath = process.env.ENRICHED_CSV_PATH || path.resolve(process.cwd(), 'mott_bow_enriched_with_colors.csv');
  
  console.log('📦 Starting Mott & Bow enriched CSV ingestion...\n');
  console.log(`   CSV Path: ${csvPath}`);
  console.log(`   Merchant ID: ${MERCHANT_ID}`);
  console.log(`   Vendor ID: ${VENDOR_ID}`);
  console.log(`   Mode: INCREMENTAL (will keep existing LSF products)\n`);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    console.error(`   Please ensure mott_bow_enriched_with_colors.csv is in the project root,`);
    console.error(`   or set ENRICHED_CSV_PATH environment variable.`);
    process.exit(1);
  }

  const fileSize = fs.statSync(csvPath).size;
  console.log(`   File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Expected products: ~1,600\n`);

  const fileContent = fs.readFileSync(csvPath);
  const stream = Readable.from(fileContent);

  try {
    console.log('🚀 Starting ingestion...\n');
    const startTime = Date.now();
    
    const summary = await ingestEnrichedCsvStream(stream, VENDOR_ID, MERCHANT_ID, {
      mode: IngestionMode.INCREMENTAL,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n✅ Mott & Bow ingestion complete!\n');
    console.log('Summary:');
    console.log(`   Total rows processed: ${summary.totalRows}`);
    console.log(`   Products inserted: ${summary.inserted}`);
    console.log(`   Products updated: ${summary.updated}`);
    console.log(`   Invalid rows: ${summary.invalidRows}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Ingestion run ID: ${summary.runId}\n`);

    if (summary.invalidRows > 0) {
      console.log(`⚠️  Warning: ${summary.invalidRows} rows were invalid and skipped\n`);
    }

    console.log('Next steps:');
    console.log('1. Run: npx tsx scripts/backfill-product-embeddings.ts');
    console.log('   (This will generate embeddings for the new Mott & Bow products)\n');
    console.log('2. Test queries like:');
    console.log('   - "slim black jeans for work" (should return men\'s jeans)');
    console.log('   - "comfortable t-shirts" (should ask for gender clarification)');
    console.log('   - "men\'s boxer briefs" (should return men\'s underwear)\n');
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
