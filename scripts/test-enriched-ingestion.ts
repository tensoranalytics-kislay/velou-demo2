import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { IngestionMode } from '@prisma/client';
import { ingestEnrichedCsvStream } from '../src/lib/catalog/ingestEnrichedCsv';

async function main() {
  // Use enriched 2.csv by default
  const csvPath = process.env.ENRICHED_CSV_PATH || path.resolve(process.cwd(), 'enriched 2.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found at ${csvPath}`);
    process.exit(1);
  }

  console.log(`Ingesting from: ${csvPath}`);
  
  // Use the default merchant ID that exists in the database
  const MERCHANT_ID = process.env.MERCHANT_ID || 'default-merchant-db0515e3-9e87-42d5-8a55-bc7559ffab0b';
  const VENDOR_ID = 'loveshackfancy_enriched';
  
  console.log(`Merchant ID: ${MERCHANT_ID}`);
  console.log(`Vendor ID: ${VENDOR_ID}`);
  console.log(`Mode: FULL_REPLACE (will delete all existing products for this merchant)\n`);
  
  const stream = Readable.from(fs.readFileSync(csvPath));
  const summary = await ingestEnrichedCsvStream(stream, VENDOR_ID, MERCHANT_ID, {
    mode: IngestionMode.FULL_REPLACE, // Replace all existing products for this merchant
  });

  console.log('Enriched ingestion summary:', summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});



