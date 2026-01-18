#!/usr/bin/env tsx

/**
 * Normalize Product Colors Using LLM with Verification
 * 
 * This script normalizes color values in both Product.color and Product.enrichedColor
 * columns using LLM assistance to standardize color names to title case.
 * 
 * Features:
 * - Extracts unique colors from both color and enrichedColor columns
 * - Uses LLM to normalize colors to title case format
 * - Filters quantity-based multi-pack descriptions
 * - VERIFICATION: Ensures old and new normalized colors match semantically
 * - Dry-run mode with before/after preview
 * - Detailed logging for safety
 * 
 * Usage:
 *   npx tsx scripts/normalize-colors.ts [--dry-run] [--batch-size=50]
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 *   - OPENAI_API_KEY (required for LLM calls)
 */

import { prisma } from '../src/lib/db';
import { callLLM } from '../src/lib/llm/provider';
import { stripJsonFences } from '../src/lib/llm/orchestrator/utils';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || '50', 10);
const MAPPING_FILE = join(process.cwd(), 'color-normalization-mapping.json');
const BACKUP_FILE = join(process.cwd(), 'color-normalization-backup.json');

interface ColorMapping {
  original: string;
  normalized: string | null;
  productCount: number;
  verified: boolean;
}

interface NormalizationResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: Array<{ productId: string; original: string; normalized: string | null; error: string }>;
  verificationFailures: Array<{ original: string; normalized: string | null; reason: string }>;
}

/**
 * Extract unique colors from database (both color and enrichedColor columns)
 */
async function extractUniqueColors(): Promise<Map<string, number>> {
  console.log('📦 Extracting unique colors from database...\n');

  // Get unique values from color column
  const colorColumn = await prisma.$queryRawUnsafe<Array<{
    color: string | null;
    count: bigint;
  }>>(`
    SELECT 
      "color",
      COUNT(*) as count
    FROM "Product"
    WHERE "color" IS NOT NULL 
      AND "color" != ''
      AND "isActive" = true
    GROUP BY "color"
    ORDER BY count DESC
  `);

  // Get unique values from enrichedColor column
  const enrichedColumn = await prisma.$queryRawUnsafe<Array<{
    enrichedColor: string | null;
    count: bigint;
  }>>(`
    SELECT 
      "enrichedColor",
      COUNT(*) as count
    FROM "Product"
    WHERE "enrichedColor" IS NOT NULL 
      AND "enrichedColor" != ''
      AND "isActive" = true
    GROUP BY "enrichedColor"
    ORDER BY count DESC
  `);

  const colorMap = new Map<string, number>();

  // Add color column values
  for (const row of colorColumn) {
    if (row.color) {
      const count = colorMap.get(row.color) || 0;
      colorMap.set(row.color, count + Number(row.count));
    }
  }

  // Add enrichedColor column values
  for (const row of enrichedColumn) {
    if (row.enrichedColor) {
      const count = colorMap.get(row.enrichedColor) || 0;
      colorMap.set(row.enrichedColor, count + Number(row.count));
    }
  }

  console.log(`   Found ${colorMap.size} unique color values\n`);
  return colorMap;
}

/**
 * Normalize a color part (handle slash/separator, case, grey/gray)
 */
function normalizeColorPart(part: string): string {
  const slashRegex = new RegExp('\\s*\\/\\s*', 'g');
  const greyRegex = /\b(grey)\b/gi;
  return part
    .toLowerCase()
    .trim()
    .replace(slashRegex, ',') // Normalize slash separators to comma-like
    .replace(greyRegex, 'gray') // Standardize grey → gray
    .trim();
}

/**
 * Normalize color string to comparable format (handle separators, case, grey/gray)
 */
function normalizeColorString(color: string): string[] {
  // Replace slashes with commas for consistent parsing
  const slashRegex = new RegExp('\\s*\\/\\s*', 'g');
  const normalized = color.replace(slashRegex, ',').toLowerCase().trim();
  // Split by comma and normalize each part
  return normalized
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizeColorPart)
    .sort(); // Sort for comparison
}

/**
 * Check if two colors are semantically equivalent (case-insensitive, handles separators)
 */
function areColorsSemanticallyEquivalent(original: string, normalized: string | null): boolean {
  if (normalized === null) {
    return false; // Filtered out colors are not equivalent
  }

  // Normalize both to comparable format (handle slashes, commas, case, grey/gray)
  const origParts = normalizeColorString(original);
  const normParts = normalizeColorString(normalized);

  // Must have same number of parts
  if (origParts.length !== normParts.length) {
    return false;
  }

  // All parts must match (already sorted)
  for (let i = 0; i < origParts.length; i++) {
    if (origParts[i] !== normParts[i]) {
      // Allow grey ↔ gray equivalence
      const origClean = origParts[i].replace(/gray$/, 'grey');
      const normClean = normParts[i].replace(/gray$/, 'grey');
      if (origClean !== normClean) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Verify color mapping is safe (no semantic changes)
 */
function verifyColorMapping(original: string, normalized: string | null): { valid: boolean; reason?: string } {
  // Null normalization means filtered (multi-pack description)
  if (normalized === null) {
    // Check if it's actually a multi-pack description
    const quantityPattern = /^\d+\s+/;
    const hasSlashWithNumbers = /\d+\s+\w+\s*\/\s*\d+\s+\w/.test(original);
    if (quantityPattern.test(original) || hasSlashWithNumbers) {
      return { valid: true }; // Valid to filter out multi-pack descriptions
    }
    return { valid: false, reason: 'Normalized to null but not a multi-pack description' };
  }

  // Check semantic equivalence
  if (!areColorsSemanticallyEquivalent(original, normalized)) {
    return { valid: false, reason: 'Colors are not semantically equivalent' };
  }

  return { valid: true };
}

/**
 * LLM prompt for normalizing colors
 */
function createNormalizationPrompt(colors: string[]): string {
  return `You are a color naming expert. Your task is to normalize product color names into standardized title case format.

Rules:
1. Convert to title case: "black" → "Black", "bright blue" → "Bright Blue"
2. Preserve multi-word colors: "light blue" → "Light Blue", "dark navy" → "Dark Navy"
3. Handle specific color names: "aegean blue" → "Aegean Blue", "antique white" → "Antique White"
4. Standardize color variations:
   - "grey" → "Gray" (prefer "Gray" over "Grey")
   - "navy blue" → "Navy" (prefer single-word where standard)
   - But preserve descriptive modifiers: "light blue", "dark blue", "bright red"
5. For comma-separated values (e.g., "black, white"), normalize each color separately
   Return as: "Black, White" (title case, comma-separated)
6. FILTER OUT quantity-based multi-pack descriptions like:
   - "2 White/1 Black" → return null (these are product descriptions, not colors)
   - "3 Black/3 White/3 Heather Gray" → return null
7. Remove any non-color text (descriptions, care instructions, etc.)
8. If input is clearly not a color (product description, quantity info), return null
9. **CRITICAL**: Only change case and formatting. DO NOT change the actual color name.
   - "black" → "Black" ✅
   - "black" → "Blue" ❌ WRONG
   - "light blue" → "Light Blue" ✅
   - "light blue" → "Dark Blue" ❌ WRONG

Examples:
- "black" → "Black"
- "Black" → "Black" (already correct)
- "bright blue" → "Bright Blue"
- "Bright Blue" → "Bright Blue" (already correct)
- "light pink" → "Light Pink"
- "aegean blue" → "Aegean Blue"
- "antique white" → "Antique White"
- "black, white" → "Black, White"
- "2 White/1 Black" → null (multi-pack description)
- "3 Black/3 White" → null (multi-pack description)
- "Assorted" → "Assorted" (keep as-is if it's a valid color category)

Colors to normalize:
${colors.map((c, i) => `${i + 1}. "${c}"`).join('\n')}

Return a valid JSON object mapping original colors to normalized forms (or null if should be filtered):
{
  "original color 1": "normalized color 1",
  "original color 2": null,
  "original color 3": "Normalized Color 3",
  ...
}

ONLY return the JSON object, no other text.`;
}

/**
 * Normalize colors using LLM in batches
 */
async function normalizeColorsWithLLM(
  colors: string[],
  batchSize: number = BATCH_SIZE
): Promise<Map<string, string | null>> {
  console.log(`🤖 Normalizing ${colors.length} colors using LLM (batch size: ${batchSize})...\n`);

  const mapping = new Map<string, string | null>();
  const errors: Array<{ color: string; error: string }> = [];

  for (let i = 0; i < colors.length; i += batchSize) {
    const batch = colors.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(colors.length / batchSize);

    console.log(`   Processing batch ${batchNum}/${totalBatches} (${batch.length} colors)...`);

    try {
      const prompt = createNormalizationPrompt(batch);
      const response = await callLLM({
        messages: [
          {
            role: 'system',
            content: 'You are a color naming expert that normalizes color names to title case. Always return valid JSON. Return null for non-color values like multi-pack descriptions. NEVER change the actual color name, only case and formatting.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        purpose: 'intent',
        expectJson: true,
        maxTokens: 2000,
      });

      let jsonResponse: Record<string, string | null>;
      try {
        const cleaned = stripJsonFences(response.rawText);
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResponse = JSON.parse(jsonMatch[0]);
        } else {
          jsonResponse = JSON.parse(cleaned);
        }
      } catch (parseError) {
        console.error(`   ⚠️  Failed to parse LLM response for batch ${batchNum}`);
        for (const color of batch) {
          errors.push({ color, error: 'Failed to parse LLM JSON response' });
        }
        continue;
      }

      for (const [original, normalized] of Object.entries(jsonResponse)) {
        mapping.set(original.trim(), normalized === null ? null : normalized.trim());
      }

      const normalizedCount = Object.values(jsonResponse).filter(v => v !== null).length;
      const filteredCount = Object.values(jsonResponse).filter(v => v === null).length;
      console.log(`   ✅ Batch ${batchNum} completed: ${normalizedCount} normalized, ${filteredCount} filtered`);

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`   ❌ Error processing batch ${batchNum}:`, error instanceof Error ? error.message : String(error));
      for (const color of batch) {
        errors.push({
          color,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log(`\n   ✅ Normalization complete: ${mapping.size} mappings created, ${errors.length} errors\n`);

  return mapping;
}

/**
 * Verify all color mappings are safe
 */
function verifyColorMappings(mapping: Map<string, string | null>): {
  verified: Map<string, string | null>;
  failures: Array<{ original: string; normalized: string | null; reason: string }>;
} {
  console.log('🔍 Verifying color mappings for safety...\n');

  const verified = new Map<string, string | null>();
  const failures: Array<{ original: string; normalized: string | null; reason: string }> = [];

  for (const [original, normalized] of mapping.entries()) {
    const verification = verifyColorMapping(original, normalized);
    if (verification.valid) {
      verified.set(original, normalized);
    } else {
      failures.push({
        original,
        normalized,
        reason: verification.reason || 'Unknown verification failure',
      });
    }
  }

  console.log(`   ✅ Verified: ${verified.size} safe mappings`);
  console.log(`   ⚠️  Failed verification: ${failures.length} mappings\n`);

  if (failures.length > 0) {
    console.log('   ⚠️  Verification failures (these will be skipped):');
    failures.slice(0, 10).forEach(({ original, normalized, reason }) => {
      console.log(`      - "${original}" → "${normalized}": ${reason}`);
    });
    if (failures.length > 10) {
      console.log(`      ... and ${failures.length - 10} more failures`);
    }
    console.log();
  }

  return { verified, failures };
}

/**
 * Load existing mapping file if it exists
 */
function loadExistingMapping(): Map<string, string | null> | null {
  if (existsSync(MAPPING_FILE)) {
    try {
      const data = JSON.parse(readFileSync(MAPPING_FILE, 'utf-8')) as ColorMapping[];
      const mapping = new Map<string, string | null>();
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
function saveMapping(mappings: ColorMapping[]): void {
  writeFileSync(MAPPING_FILE, JSON.stringify(mappings, null, 2));
  console.log(`   💾 Mapping saved to ${MAPPING_FILE}\n`);
}

/**
 * Backup original colors before updating
 */
async function backupColors(): Promise<Map<string, { color: string | null; enrichedColor: string | null }>> {
  console.log('💾 Creating backup of original colors...\n');

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { color: { not: null } },
        { enrichedColor: { not: null } },
      ],
      isActive: true,
    },
    select: {
      id: true,
      color: true,
      enrichedColor: true,
    },
  });

  const backup: Record<string, { color: string | null; enrichedColor: string | null }> = {};
  for (const product of products) {
    backup[product.id] = {
      color: product.color,
      enrichedColor: product.enrichedColor,
    };
  }

  writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
  console.log(`   ✅ Backup saved: ${products.length} products backed up to ${BACKUP_FILE}\n`);

  return new Map(Object.entries(backup));
}

/**
 * Apply normalization mapping to database with verification
 */
async function applyNormalization(
  mapping: Map<string, string | null>
): Promise<NormalizationResult> {
  console.log(`📝 Applying normalization to database${DRY_RUN ? ' (DRY RUN - no changes will be made)' : ''}...\n`);

  const result: NormalizationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    verificationFailures: [],
  };

  const batchSize = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { color: { not: null } },
          { enrichedColor: { not: null } },
        ],
        isActive: true,
      },
      select: {
        id: true,
        color: true,
        enrichedColor: true,
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

      let needsUpdate = false;
      const updates: { color?: string | null; enrichedColor?: string | null } = {};

      // Normalize color column
      if (product.color) {
        const normalized = mapping.get(product.color);
        if (normalized !== undefined) {
          // Verify before updating
          const verification = verifyColorMapping(product.color, normalized);
          if (!verification.valid) {
            result.verificationFailures.push({
              original: product.color,
              normalized,
              reason: verification.reason || 'Verification failed',
            });
            // Don't skip the whole product, just skip this column
            continue;
          }

          if (normalized !== product.color) {
            needsUpdate = true;
            updates.color = normalized;
          }
        }
      }

      // Normalize enrichedColor column
      if (product.enrichedColor) {
        const normalized = mapping.get(product.enrichedColor);
        if (normalized !== undefined) {
          // Verify before updating
          const verification = verifyColorMapping(product.enrichedColor, normalized);
          if (!verification.valid) {
            result.verificationFailures.push({
              original: product.enrichedColor,
              normalized,
              reason: verification.reason || 'Verification failed',
            });
            // Don't skip the whole product, just skip this column
            continue;
          }

          if (normalized !== product.enrichedColor) {
            needsUpdate = true;
            updates.enrichedColor = normalized;
          }
        }
      }

      if (!needsUpdate) {
        result.skipped++;
        continue;
      }

      try {
        if (!DRY_RUN) {
          await prisma.product.update({
            where: { id: product.id },
            data: updates,
          });
        }
        result.updated++;
      } catch (error) {
        result.errors.push({
          productId: product.id,
          original: product.color || product.enrichedColor || '',
          normalized: updates.color || updates.enrichedColor || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    offset += batchSize;

    if (products.length < batchSize) {
      hasMore = false;
    }

    if (result.processed % 500 === 0) {
      console.log(`   Progress: ${result.processed} processed, ${result.updated} updated, ${result.skipped} skipped`);
    }
  }

  return result;
}

/**
 * Show sample verification results
 */
function showSampleMappings(
  mapping: Map<string, string | null>,
  colorCounts: Map<string, number>,
  limit: number = 20
): void {
  console.log('📋 Sample color mappings (before/after):\n');
  
  const sortedEntries = Array.from(mapping.entries())
    .map(([original, normalized]) => ({
      original,
      normalized,
      count: colorCounts.get(original) || 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  sortedEntries.forEach(({ original, normalized, count }, i) => {
    if (normalized === null) {
      console.log(`   ${String(i + 1).padStart(2)}. "${original}" → [FILTERED] (${count} products)`);
    } else if (original.toLowerCase() === normalized.toLowerCase()) {
      console.log(`   ${String(i + 1).padStart(2)}. "${original}" → "${normalized}" (already correct, ${count} products)`);
    } else {
      console.log(`   ${String(i + 1).padStart(2)}. "${original}" → "${normalized}" (${count} products)`);
    }
  });
  console.log();
}

/**
 * Main function
 */
async function main() {
  console.log('🎨 Color Normalization Script with Verification\n');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE (will update database)'}`);
  console.log(`   Batch size: ${BATCH_SIZE}\n`);

  try {
    // Step 1: Extract unique colors
    const colorCounts = await extractUniqueColors();

    // Step 2: Check for existing mapping
    let mapping = loadExistingMapping();

    if (!mapping || mapping.size === 0) {
      // Step 3: Normalize colors using LLM
      const colors = Array.from(colorCounts.keys());
      mapping = await normalizeColorsWithLLM(colors, BATCH_SIZE);

      // Step 4: Verify mappings
      const { verified, failures } = verifyColorMappings(mapping);
      mapping = verified;

      // Step 5: Save mapping
      const mappingArray: ColorMapping[] = Array.from(mapping.entries()).map(([original, normalized]) => ({
        original,
        normalized,
        productCount: colorCounts.get(original) || 0,
        verified: true,
      }));
      saveMapping(mappingArray);
    } else {
      // Re-verify existing mapping
      const { verified } = verifyColorMappings(mapping);
      mapping = verified;
    }

    // Step 6: Show sample mappings
    showSampleMappings(mapping, colorCounts, 30);

    // Step 7: Backup (only if not dry-run and no backup exists)
    if (!DRY_RUN && !existsSync(BACKUP_FILE)) {
      await backupColors();
    }

    // Step 8: Apply normalization
    const result = await applyNormalization(mapping);

    // Step 9: Summary
    console.log('\n📊 Summary:\n');
    console.log(`   Total unique colors: ${colorCounts.size}`);
    console.log(`   Colors normalized: ${mapping.size}`);
    console.log(`   Products processed: ${result.processed}`);
    console.log(`   Products updated: ${result.updated}`);
    console.log(`   Products skipped: ${result.skipped}`);
    console.log(`   Errors: ${result.errors.length}`);
    console.log(`   Verification failures: ${result.verificationFailures.length}\n`);

    if (DRY_RUN) {
      console.log('   ⚠️  DRY RUN mode: No database changes were made');
      console.log('   Run without --dry-run to apply changes\n');
    } else {
      console.log('   ✅ Normalization complete!\n');
      console.log('   Next steps:');
      console.log('   1. Verify a sample of updated products');
      console.log('   2. Rebuild dictionaries: npx tsx scripts/build-constraint-dictionaries.ts\n');
    }

    if (result.errors.length > 0) {
      console.log(`   ⚠️  Errors (${result.errors.length}):`);
      result.errors.slice(0, 5).forEach(({ productId, original, error }) => {
        console.log(`      - Product ${productId} ("${original.substring(0, 30)}..."): ${error}`);
      });
      if (result.errors.length > 5) {
        console.log(`      ... and ${result.errors.length - 5} more errors`);
      }
      console.log();
    }

    if (result.verificationFailures.length > 0) {
      console.log(`   ⚠️  Verification failures (${result.verificationFailures.length} mappings skipped for safety):`);
      result.verificationFailures.slice(0, 5).forEach(({ original, normalized, reason }) => {
        console.log(`      - "${original}" → "${normalized}": ${reason}`);
      });
      if (result.verificationFailures.length > 5) {
        console.log(`      ... and ${result.verificationFailures.length - 5} more failures`);
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
