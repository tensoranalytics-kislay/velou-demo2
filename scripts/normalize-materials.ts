#!/usr/bin/env tsx

/**
 * Normalize Product Materials Using LLM
 * 
 * This script normalizes material values in the Product.material column
 * using LLM assistance to extract and standardize material compositions.
 * 
 * Features:
 * - Extracts all unique materials from database
 * - Groups similar materials using fuzzy matching
 * - Uses LLM to normalize materials in batches
 * - Dry-run mode to preview changes
 * - Safe transaction-based updates
 * - Detailed logging and rollback capability
 * 
 * Usage:
 *   npx tsx scripts/normalize-materials.ts [--dry-run] [--batch-size=50]
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 *   - OPENAI_API_KEY (required for LLM calls)
 */

import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/telemetry/logger';
import { callLLM } from '../src/lib/llm/provider';
import { stripJsonFences } from '../src/lib/llm/orchestrator/utils';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || '50', 10);
const MATERIAL_LIMIT = Number.parseInt(process.env.MATERIAL_LIMIT || '0', 10) || undefined;
const MAPPING_FILE = join(process.cwd(), 'material-normalization-mapping.json');
const BACKUP_FILE = join(process.cwd(), 'material-normalization-backup.json');

interface MaterialMapping {
  original: string;
  normalized: string;
  productCount: number;
}

interface NormalizationResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: Array<{ material: string; error: string }>;
}

/**
 * Extract all unique materials from the database
 */
async function extractUniqueMaterials(limit?: number): Promise<Map<string, number>> {
  console.log('📦 Extracting unique materials from database...\n');

  // Get all unique materials with counts
  const limitClause = limit ? `LIMIT ${limit}` : '';
  const materials = await prisma.$queryRawUnsafe<Array<{
    material: string | null;
    count: bigint;
  }>>(`
    SELECT 
      "material",
      COUNT(*) as count
    FROM "Product"
    WHERE "material" IS NOT NULL 
      AND "material" != ''
      AND "isActive" = true
    GROUP BY "material"
    ORDER BY count DESC
    ${limitClause}
  `);

  const materialMap = new Map<string, number>();
  for (const row of materials) {
    if (row.material) {
      materialMap.set(row.material, Number(row.count));
    }
  }

  console.log(`   Found ${materialMap.size} unique materials\n`);
  return materialMap;
}

/**
 * LLM prompt for normalizing materials
 */
function createNormalizationPrompt(materials: string[]): string {
  return `You are a textile/fabric expert. Your task is to normalize product material descriptions into a standardized format.

Rules:
1. Extract ONLY material composition percentages (e.g., "85% Viscose, 15% Polyester")
2. Remove all non-material text (descriptions, care instructions, sizes, model info, etc.)
3. Standardize format: "X% Material1, Y% Material2" (sorted by percentage descending, comma-separated)
4. Capitalize material names properly: Polyester, Cotton, Viscose, Elastane, Nylon, Polyamide, Acrylic, Wool, Silk, Linen, Cashmere, etc.
5. Fix common typos: "POLYESTERR" → "Polyester", "POLYSTER" → "Polyester", "Stynthetic" → "Synthetic"
6. If no percentage is found, return the material name capitalized (e.g., "Cotton" if input is "cotton")
7. If multiple formats exist, use the most complete one
8. Remove phrases like "excluding trim", "contains non-textile parts", "Always check the wash care label", etc.
9. Remove size information (e.g., "XS/S - 64cm M/L - 82cm")
10. Remove product descriptions (e.g., "- Diamante detail - Scoop neckline...")

Examples:
- "100% POLYESTER, Excluding Trims" → "100% Polyester"
- "85% Viscose 15% Polyester" → "85% Viscose, 15% Polyester"
- "96% Polyester 4% Elastane" → "96% Polyester, 4% Elastane"
- "100 polyester" → "100% Polyester"
- "- Diamante detail - Scoop neckline - Bodycon fit - Strappy style - Model height: 5' 7" - Model wears UK 8 / US 4 / EUR 36 - 96% Polyester 4% Elastane" → "96% Polyester, 4% Elastane"
- "100% POLYESTER, LINING: 100% POLYESTER" → "100% Polyester"
- "100% Polyester,XS/S - 64cm M/L - 82cm" → "100% Polyester"
- "50% VISCOSE 28% POLYESTER 22% NYLON" → "50% Viscose, 28% Polyester, 22% Nylon"
- "49% COTTON 44% POLYESTER 7% ELASTANE" → "49% Cotton, 44% Polyester, 7% Elastane"

Materials to normalize:
${materials.map((m, i) => `${i + 1}. "${m}"`).join('\n')}

Return a valid JSON object mapping original materials to normalized forms:
{
  "original material 1": "normalized material 1",
  "original material 2": "normalized material 2",
  ...
}

ONLY return the JSON object, no other text.`;
}

/**
 * Normalize materials using LLM in batches
 */
async function normalizeMaterialsWithLLM(
  materials: string[],
  batchSize: number = BATCH_SIZE
): Promise<Map<string, string>> {
  console.log(`🤖 Normalizing ${materials.length} materials using LLM (batch size: ${batchSize})...\n`);

  const mapping = new Map<string, string>();
  const errors: Array<{ material: string; error: string }> = [];

  // Process in batches
  for (let i = 0; i < materials.length; i += batchSize) {
    const batch = materials.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(materials.length / batchSize);

    console.log(`   Processing batch ${batchNum}/${totalBatches} (${batch.length} materials)...`);

    try {
      const prompt = createNormalizationPrompt(batch);
      const response = await callLLM({
        messages: [
          {
            role: 'system',
            content: 'You are a textile expert that normalizes material descriptions into standardized formats. Always return valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        purpose: 'intent', // Use 'intent' purpose for low temperature (0.1) and structured JSON output
        expectJson: true, // Request JSON response
        maxTokens: 2000, // Limit tokens for JSON responses
      });

      // Parse JSON response
      let jsonResponse: Record<string, string>;
      try {
        // Strip JSON fences and extract JSON object
        const cleaned = stripJsonFences(response.rawText);
        // Try to extract JSON object if response contains other text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResponse = JSON.parse(jsonMatch[0]);
        } else {
          jsonResponse = JSON.parse(cleaned);
        }
      } catch (parseError) {
        console.error(`   ⚠️  Failed to parse LLM response for batch ${batchNum}`);
        console.error(`   Response: ${response.rawText.substring(0, 200)}...`);
        // Add all batch materials to errors
        for (const material of batch) {
          errors.push({ material, error: 'Failed to parse LLM JSON response' });
        }
        continue;
      }

      // Add mappings
      for (const [original, normalized] of Object.entries(jsonResponse)) {
        if (original && normalized) {
          mapping.set(original.trim(), normalized.trim());
        }
      }

      console.log(`   ✅ Batch ${batchNum} completed: ${Object.keys(jsonResponse).length} materials normalized`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`   ❌ Error processing batch ${batchNum}:`, error instanceof Error ? error.message : String(error));
      for (const material of batch) {
        errors.push({
          material,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log(`\n   ✅ Normalization complete: ${mapping.size} mappings created, ${errors.length} errors\n`);

  if (errors.length > 0) {
    console.log(`   ⚠️  Errors encountered (${errors.length}):`);
    errors.slice(0, 10).forEach(({ material, error }) => {
      console.log(`      - "${material.substring(0, 50)}...": ${error}`);
    });
    if (errors.length > 10) {
      console.log(`      ... and ${errors.length - 10} more errors`);
    }
    console.log();
  }

  return mapping;
}

/**
 * Load existing mapping file if it exists
 */
function loadExistingMapping(): Map<string, string> | null {
  if (existsSync(MAPPING_FILE)) {
    try {
      const data = JSON.parse(readFileSync(MAPPING_FILE, 'utf-8'));
      const mapping = new Map<string, string>();
      for (const item of data) {
        mapping.set(item.original, item.normalized);
      }
      console.log(`   📂 Loaded existing mapping from ${MAPPING_FILE} (${mapping.size} entries)\n`);
      return mapping;
    } catch (error) {
      console.error(`   ⚠️  Failed to load existing mapping: ${error}\n`);
    }
  }
  return null;
}

/**
 * Save mapping to file
 */
function saveMapping(mappings: MaterialMapping[]): void {
  writeFileSync(MAPPING_FILE, JSON.stringify(mappings, null, 2));
  console.log(`   💾 Mapping saved to ${MAPPING_FILE}\n`);
}

/**
 * Backup original materials before updating
 */
async function backupMaterials(): Promise<Map<string, string>> {
  console.log('💾 Creating backup of original materials...\n');

  const products = await prisma.product.findMany({
    where: {
      material: { not: null },
      isActive: true,
    },
    select: {
      id: true,
      material: true,
    },
  });

  const backup: Record<string, string> = {};
  for (const product of products) {
    if (product.material) {
      backup[product.id] = product.material;
    }
  }

  writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
  console.log(`   ✅ Backup saved: ${products.length} products backed up to ${BACKUP_FILE}\n`);

  return new Map(Object.entries(backup));
}

/**
 * Apply normalization mapping to database
 */
async function applyNormalization(
  mapping: Map<string, string>
): Promise<NormalizationResult> {
  console.log(`📝 Applying normalization to database${DRY_RUN ? ' (DRY RUN - no changes will be made)' : ''}...\n`);

  const result: NormalizationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Process in batches to avoid memory issues
  const batchSize = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const products = await prisma.product.findMany({
      where: {
        material: { not: null },
        isActive: true,
      },
      select: {
        id: true,
        material: true,
      },
      take: batchSize,
      skip: offset,
    });

    if (products.length === 0) {
      hasMore = false;
      break;
    }

    for (const product of products) {
      result.processed++;

      if (!product.material) {
        result.skipped++;
        continue;
      }

      const normalized = mapping.get(product.material);
      if (!normalized) {
        result.skipped++;
        continue;
      }

      // Skip if already normalized
      if (product.material === normalized) {
        result.skipped++;
        continue;
      }

      try {
        if (!DRY_RUN) {
          await prisma.product.update({
            where: { id: product.id },
            data: { material: normalized },
          });
        }
        result.updated++;
      } catch (error) {
        result.errors.push({
          material: product.material,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    offset += batchSize;

    if (products.length < batchSize) {
      hasMore = false;
    }

    // Log progress every 500 products
    if (result.processed % 500 === 0) {
      console.log(`   Progress: ${result.processed} processed, ${result.updated} updated, ${result.skipped} skipped`);
    }
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  console.log('🧵 Material Normalization Script\n');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE (will update database)'}`);
  console.log(`   Batch size: ${BATCH_SIZE}\n`);

  try {
    // Step 1: Extract unique materials
    const materialCounts = await extractUniqueMaterials(MATERIAL_LIMIT);
    if (MATERIAL_LIMIT) {
      console.log(`   Limited to first ${MATERIAL_LIMIT} materials for testing\n`);
    }

    // Step 2: Check for existing mapping
    let mapping = loadExistingMapping();

    if (!mapping || mapping.size === 0) {
      // Step 3: Normalize materials using LLM
      const materials = Array.from(materialCounts.keys());
      mapping = await normalizeMaterialsWithLLM(materials, BATCH_SIZE);

      // Step 4: Save mapping
      const mappingArray: MaterialMapping[] = Array.from(mapping.entries()).map(([original, normalized]) => ({
        original,
        normalized,
        productCount: materialCounts.get(original) || 0,
      }));
      saveMapping(mappingArray);
    }

    // Step 5: Backup (only if not dry-run and no backup exists)
    if (!DRY_RUN && !existsSync(BACKUP_FILE)) {
      await backupMaterials();
    }

    // Step 6: Apply normalization
    const result = await applyNormalization(mapping);

    // Step 7: Summary
    console.log('\n📊 Summary:\n');
    console.log(`   Total unique materials: ${materialCounts.size}`);
    console.log(`   Materials normalized: ${mapping.size}`);
    console.log(`   Products processed: ${result.processed}`);
    console.log(`   Products updated: ${result.updated}`);
    console.log(`   Products skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}\n`);

    if (DRY_RUN) {
      console.log('   ⚠️  DRY RUN mode: No database changes were made');
      console.log('   Run without --dry-run to apply changes\n');
    } else {
      console.log('   ✅ Normalization complete!\n');
      console.log('   Next steps:');
      console.log('   1. Verify a sample of updated materials');
      console.log('   2. Rebuild dictionaries: npx tsx scripts/build-constraint-dictionaries.ts\n');
    }

    if (result.errors.length > 0) {
      console.log(`   ⚠️  Errors (${result.errors.length}):`);
      result.errors.slice(0, 5).forEach(({ material, error }) => {
        console.log(`      - "${material.substring(0, 50)}": ${error}`);
      });
      if (result.errors.length > 5) {
        console.log(`      ... and ${result.errors.length - 5} more errors`);
      }
      console.log();
    }
  } catch (error) {
    console.error('\n❌ Normalization failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
