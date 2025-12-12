/**
 * Ingest L'Occitane Unified Catalog CSV
 * 
 * Usage:
 *   npx tsx scripts/ingestLoccitaneCatalog.ts
 * 
 * This script will:
 * 1. Find the default merchant
 * 2. Read loccitane_unified_catalog.csv
 * 3. Ingest all products into the database
 * 4. Show ingestion summary
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'stream';
import { prisma } from '../src/lib/db';
import { ingestUnifiedCsvStream } from '../src/lib/catalog/ingestUnifiedCsv';
import { IngestionMode } from '@prisma/client';
import { logger } from '../src/lib/telemetry/logger';

const CSV_FILE_PATH = path.resolve(process.cwd(), 'loccitane_unified_catalog.csv');
const VENDOR_ID = 'loccitane';

async function ingestCatalog() {
  try {
    console.log('🚀 Starting L\'Occitane catalog ingestion...\n');

    // Check if CSV file exists
    if (!fs.existsSync(CSV_FILE_PATH)) {
      throw new Error(`CSV file not found at: ${CSV_FILE_PATH}`);
    }

    console.log(`📄 CSV file: ${CSV_FILE_PATH}`);
    console.log(`📦 Vendor ID: ${VENDOR_ID}\n`);

    // Get default merchant
    const defaultMerchant = await prisma.merchant.findUnique({
      where: { slug: 'default' },
    });

    if (!defaultMerchant) {
      throw new Error(
        'Default merchant not found. Please run the migration first or create a default merchant.'
      );
    }

    console.log(`✅ Found merchant: ${defaultMerchant.name} (${defaultMerchant.id})\n`);

    // Read CSV file and create stream
    const csvBuffer = fs.readFileSync(CSV_FILE_PATH);
    const csvStream = Readable.from(csvBuffer);

    console.log('📊 Starting ingestion...\n');

    // Ingest the CSV
    const summary = await ingestUnifiedCsvStream(
      csvStream,
      VENDOR_ID,
      defaultMerchant.id,
      {
        mode: IngestionMode.FULL_REPLACE,
        enableContextInference: true,
        adminHints: {
          vertical: 'beauty',
          currency: 'USD',
        },
      }
    );

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📈 INGESTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total rows processed: ${summary.totalRows}`);
    console.log(`✅ Products inserted: ${summary.inserted}`);
    console.log(`🔄 Products updated: ${summary.updated}`);
    console.log(`❌ Invalid rows: ${summary.invalidRows}`);
    
    if (summary.deactivated) {
      console.log(`🚫 Products deactivated: ${summary.deactivated}`);
    }

    console.log('\n' + '-'.repeat(60));
    console.log('📊 DATA COVERAGE STATS');
    console.log('-'.repeat(60));
    const stats = summary.coreStats;
    console.log(`Rows with price: ${stats.hasPriceCount} (${((stats.hasPriceCount / summary.totalRows) * 100).toFixed(1)}%)`);
    console.log(`Rows with images: ${stats.hasImageCount} (${((stats.hasImageCount / summary.totalRows) * 100).toFixed(1)}%)`);
    console.log(`Rows with descriptions: ${stats.hasDescriptionCount} (${((stats.hasDescriptionCount / summary.totalRows) * 100).toFixed(1)}%)`);
    console.log(`Rows with categories: ${stats.hasCategoryCount} (${((stats.hasCategoryCount / summary.totalRows) * 100).toFixed(1)}%)`);

    if (summary.datasetContext) {
      console.log('\n' + '-'.repeat(60));
      console.log('🎯 DATASET CONTEXT');
      console.log('-'.repeat(60));
      if (summary.datasetContext.vertical) {
        console.log(`Vertical: ${summary.datasetContext.vertical}`);
      }
      if (summary.datasetContext.sampleCategories?.length) {
        console.log(`Sample categories: ${summary.datasetContext.sampleCategories.slice(0, 10).join(', ')}`);
      }
      if (summary.datasetContext.primaryFacets?.length) {
        console.log(`Primary facets: ${summary.datasetContext.primaryFacets.slice(0, 10).join(', ')}`);
      }
    }

    if (summary.issues.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log(`⚠️  VALIDATION ISSUES (showing first 20 of ${summary.issues.length})`);
      console.log('-'.repeat(60));
      const errors = summary.issues.filter(i => i.level === 'error').slice(0, 10);
      const warnings = summary.issues.filter(i => i.level === 'warning').slice(0, 10);

      if (errors.length > 0) {
        console.log('\n❌ Errors:');
        errors.forEach((issue, idx) => {
          console.log(`  ${idx + 1}. Row ${issue.rowIndex}: ${issue.field} - ${issue.message}`);
        });
      }

      if (warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        warnings.forEach((issue, idx) => {
          console.log(`  ${idx + 1}. Row ${issue.rowIndex}: ${issue.field} - ${issue.message}`);
        });
      }

      if (summary.issues.length > 20) {
        console.log(`\n... and ${summary.issues.length - 20} more issues`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Ingestion complete!');
    console.log('='.repeat(60));

    // Update merchant datasetContext if inferred
    if (summary.datasetContext) {
      await prisma.merchant.update({
        where: { id: defaultMerchant.id },
        data: {
          datasetContext: summary.datasetContext as any,
        },
      });
      console.log('\n✅ Dataset context saved to merchant record');
    }

    // Update search_vector for all products
    console.log('\n🔍 Setting up search optimization...');
    await prisma.$executeRaw`
      UPDATE "Product" 
      SET "search_vector" = to_tsvector('english', 
        COALESCE(title, '') || ' ' || 
        COALESCE(description, '') || ' ' || 
        COALESCE(category, '') || ' ' || 
        COALESCE("subcategory", '')
      )
      WHERE "merchantId" = ${defaultMerchant.id};
    `;
    console.log('✅ Search vectors populated');

  } catch (error) {
    console.error('\n❌ Ingestion failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

ingestCatalog();



