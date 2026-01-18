/**
 * Ingest Enriched CSV for Quiz
 * 
 * This script performs an INCREMENTAL ingestion of the Quiz enriched CSV dataset.
 * It will:
 * 1. Keep all existing products (LSF, Mott & Bow, and others)
 * 2. Add/update Quiz products from quiz_enriched_with_colors copy.csv
 * 3. Store sizes/colors in Product.attributes
 * 4. Read gender from CSV column (all products are female)
 * 
 * Usage:
 *   npx tsx scripts/ingest-quiz.ts
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 *   - ENRICHED_CSV_PATH (optional, defaults to ./quiz_enriched_with_colors copy.csv)
 *   - MERCHANT_ID (optional, defaults to default merchant)
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { IngestionMode } from '@prisma/client';
import { ingestEnrichedCsvStream } from '../src/lib/catalog/ingestEnrichedCsv';

const MERCHANT_ID = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
const VENDOR_ID = 'quiz';

async function main() {
  const csvPath = process.env.ENRICHED_CSV_PATH || path.resolve(process.cwd(), 'quiz_enriched_with_colors copy.csv');
  
  console.log('📦 Starting Quiz enriched CSV ingestion...\n');
  console.log(`   CSV Path: ${csvPath}`);
  console.log(`   Merchant ID: ${MERCHANT_ID}`);
  console.log(`   Vendor ID: ${VENDOR_ID}`);
  console.log(`   Mode: INCREMENTAL (will keep existing products)\n`);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    console.error(`   Please ensure quiz_enriched_with_colors copy.csv is in the project root,`);
    console.error(`   or set ENRICHED_CSV_PATH environment variable.`);
    process.exit(1);
  }

  const fileSize = fs.statSync(csvPath).size;
  console.log(`   File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Expected products: ~3,115\n`);

  const fileContent = fs.readFileSync(csvPath);
  const stream = Readable.from(fileContent);

  try {
    console.log('🚀 Starting ingestion...\n');
    const startTime = Date.now();
    
    const summary = await ingestEnrichedCsvStream(stream, VENDOR_ID, MERCHANT_ID, {
      mode: IngestionMode.INCREMENTAL,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n✅ Quiz ingestion complete!\n');
    console.log('Summary:');
    console.log(`   Total rows processed: ${summary.totalRows}`);
    console.log(`   Products inserted: ${summary.inserted}`);
    console.log(`   Products updated: ${summary.updated}`);
    console.log(`   Invalid rows: ${summary.invalidRows}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Batch ID: ${summary.batchId}\n`);

    if (summary.invalidRows > 0) {
      console.log(`⚠️  Warning: ${summary.invalidRows} rows were invalid and skipped\n`);
    }

    console.log('Next steps:');
    console.log('1. Run: npx tsx scripts/backfill-enriched-embeddings.ts');
    console.log('   (This will generate embeddings for the new Quiz products)\n');
    console.log('2. Run: npx tsx scripts/build-constraint-dictionaries.ts');
    console.log('   (This will rebuild global dictionaries with Quiz constraint values)\n');
    console.log('3. Test queries like:');
    console.log('   - "casual dresses for summer" (should return Quiz products)');
    console.log('   - "elegant jumpsuits" (should return Quiz products)');
    console.log('   - "palazzo trousers" (should return Quiz products)\n');
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
