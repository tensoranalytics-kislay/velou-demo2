#!/usr/bin/env tsx

/**
 * Normalize Product Categories Using LLM with Gender Detection
 * 
 * This script normalizes product categories into standard categories from category-tree.ts,
 * using LLM assistance to intelligently detect gender and non-apparel products.
 * 
 * Features:
 * - Extracts unique categories with sample product titles (5-10 per category)
 * - Uses LLM to normalize categories with intelligent gender detection
 * - Preserves unisex/non-apparel categories (Bedding, Tabletop, Home Decor)
 * - Separates Men's and Women's categories (never merges)
 * - Verification layer to ensure mappings are safe
 * - Dry-run mode with before/after preview
 * - Resume support from interruption
 * 
 * Usage:
 *   npx tsx scripts/normalize-categories.ts [--dry-run] [--batch-size=20]
 * 
 * Environment Variables:
 *   - DATABASE_URL (required)
 *   - OPENAI_API_KEY (required for LLM calls)
 *   - DRY_RUN=true (optional, for testing without database changes)
 */

import { prisma } from '../src/lib/db';
import { callLLM } from '../src/lib/llm/provider';
import { stripJsonFences } from '../src/lib/llm/orchestrator/utils';
import { CATEGORY_TREE } from '../src/lib/catalog/category-tree';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || '20', 10);
const LIMIT_CATEGORIES = Number.parseInt(process.env.LIMIT_CATEGORIES || '0', 10); // 0 = no limit
const MAPPING_FILE = join(process.cwd(), 'category-normalization-mapping.json');
const BACKUP_FILE = join(process.cwd(), 'category-normalization-backup.json');
const EXTRACTED_DATA_FILE = join(process.cwd(), 'category-extraction-checkpoint.json'); // For resuming extraction

interface CategoryData {
  category: string;
  productCount: number;
  sampleProducts: string[];
  vendorId?: string;
  genderDistribution: { female: number; male: number; unisex: number; null: number };
  ageGroupDistribution: { kids: number; adult: number; baby: number; unknown: number };
  dominantGender?: 'female' | 'male' | 'unisex' | null; // 95%+ threshold
  dominantAgeGroup?: 'kids' | 'adult' | 'baby' | null; // 95%+ threshold
}

interface CategoryMapping {
  original: string;
  normalized: {
    category: string;
    subcategory: string | null;
  };
  productCount: number;
  sampleProducts: string[];
  verified: boolean;
  reasoning?: string;
}

interface NormalizationResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: Array<{ productId: string; original: string; normalized: { category: string; subcategory: string | null }; error: string }>;
  verificationFailures: Array<{ original: string; normalized: { category: string; subcategory: string | null }; reason: string }>;
}

/**
 * Load extracted category data from checkpoint file if it exists
 */
function loadExtractedDataCheckpoint(): Map<string, CategoryData> | null {
  if (existsSync(EXTRACTED_DATA_FILE)) {
    try {
      const data = JSON.parse(readFileSync(EXTRACTED_DATA_FILE, 'utf-8')) as Array<[string, CategoryData]>;
      const map = new Map<string, CategoryData>(data);
      console.log(`   📂 Loaded extracted data checkpoint: ${map.size} categories\n`);
      return map;
    } catch (error) {
      console.error(`   ⚠️  Failed to load checkpoint: ${error}\n`);
    }
  }
  return null;
}

/**
 * Save extracted category data to checkpoint file
 */
function saveExtractedDataCheckpoint(categoryMap: Map<string, CategoryData>): void {
  try {
    const data = Array.from(categoryMap.entries());
    writeFileSync(EXTRACTED_DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`   ⚠️  Failed to save checkpoint: ${error}`);
  }
}

/**
 * Extract unique categories with sample product titles from database
 */
async function extractCategoriesWithSamples(): Promise<Map<string, CategoryData>> {
  console.log('📦 Extracting unique categories with sample products from database...\n');
  
  // Try to load existing checkpoint
  const existingData = loadExtractedDataCheckpoint();

  // Get unique categories with counts
  let limitClause = '';
  if (LIMIT_CATEGORIES > 0) {
    limitClause = `LIMIT ${LIMIT_CATEGORIES}`;
  }
  const categoryStats = await prisma.$queryRawUnsafe<Array<{
    category: string;
    count: bigint;
  }>>(`
    SELECT 
      "category",
      COUNT(*) as count
    FROM "Product"
    WHERE "category" IS NOT NULL 
      AND "category" != ''
      AND "isActive" = true
    GROUP BY "category"
    ORDER BY count DESC
    ${limitClause}
  `);

  console.log(`   Found ${categoryStats.length} unique categories\n`);

  // Start with existing checkpoint data if available
  const categoryMap = existingData || new Map<string, CategoryData>();
  
  if (existingData) {
    console.log(`   Resuming from checkpoint: ${existingData.size} categories already extracted\n`);
  }

  // Optimize: Process in batches and add connection retry logic
  const BATCH_EXTRACT_SIZE = 100;
  let processed = 0;
  
  // For each category, get sample product titles, gender, and age group distribution
  // Skip categories already in checkpoint
  for (let idx = 0; idx < categoryStats.length; idx++) {
    const stat = categoryStats[idx];
    if (!stat.category) continue;
    
    // Skip if already extracted in checkpoint
    if (categoryMap.has(stat.category)) {
      continue;
    }

    try {
      // Get sample products, gender, and age group in parallel where possible
      // Get sample products
      const samples = await prisma.$queryRawUnsafe<Array<{
        title: string;
        vendorId: string | null;
      }>>(`
        SELECT 
          "title",
          "vendorId"
        FROM "Product"
        WHERE "category" = $1
          AND "isActive" = true
        ORDER BY RANDOM()
        LIMIT 10
      `, stat.category);

      // Get gender distribution
      const genderStats = await prisma.$queryRawUnsafe<Array<{
        gender: string | null;
        count: bigint;
      }>>(`
        SELECT 
          "gender",
          COUNT(*) as count
        FROM "Product"
        WHERE "category" = $1
          AND "isActive" = true
        GROUP BY "gender"
      `, stat.category);

      // Get age group distribution (analyze ageGroup field to determine if kids/adult/baby)
      const ageGroupStats = await prisma.$queryRawUnsafe<Array<{
        ageGroup: string | null;
        count: bigint;
      }>>(`
        SELECT 
          "ageGroup",
          COUNT(*) as count
        FROM "Product"
        WHERE "category" = $1
          AND "isActive" = true
        GROUP BY "ageGroup"
      `, stat.category);

    const sampleProducts = samples.map(s => s.title);
    const vendorIds = samples.map(s => s.vendorId).filter(Boolean);
    const primaryVendorId = vendorIds.length > 0 ? vendorIds[0] : undefined;

    // Calculate gender distribution
    const genderDist = { female: 0, male: 0, unisex: 0, null: 0 };
    let totalGenderCount = 0;
    for (const g of genderStats) {
      const count = Number(g.count);
      totalGenderCount += count;
      if (g.gender === 'female') genderDist.female = count;
      else if (g.gender === 'male') genderDist.male = count;
      else if (g.gender === 'unisex') genderDist.unisex = count;
      else genderDist.null = count;
    }

    // Determine dominant gender (95%+ threshold)
    let dominantGender: 'female' | 'male' | 'unisex' | null | undefined = undefined;
    if (totalGenderCount > 0) {
      const femalePct = (genderDist.female / totalGenderCount) * 100;
      const malePct = (genderDist.male / totalGenderCount) * 100;
      const unisexPct = (genderDist.unisex / totalGenderCount) * 100;
      if (femalePct >= 95) dominantGender = 'female';
      else if (malePct >= 95) dominantGender = 'male';
      else if (unisexPct >= 95) dominantGender = 'unisex';
      else dominantGender = null; // Mixed or unclear
    }

    // Calculate age group distribution (determine kids vs adult based on ageGroup field)
    // Kids indicators: sizes like "4, 6, 8" or "10, 12" typically indicate kids
    // Adult indicators: sizes like "XS, S, M, L, XL" or larger numeric sizes "16, 18, 20, 22"
    // Baby indicators: "0-3 months", "3-6 months", etc.
    const ageDist = { kids: 0, adult: 0, baby: 0, unknown: 0 };
    let totalAgeCount = 0;
    for (const a of ageGroupStats) {
      const count = Number(a.count);
      totalAgeCount += count;
      if (!a.ageGroup) {
        ageDist.unknown += count;
      } else {
        const ageGroupLower = a.ageGroup.toLowerCase();
        // Check for baby/toddler indicators
        if (/0-3|3-6|6-12|12-18|18-24|months?|toddler|baby|infant/i.test(ageGroupLower)) {
          ageDist.baby += count;
        } 
        // Check for kids indicators (small sizes: 4, 6, 8, 10, 12, 14 are typically kids)
        // Kids sizes usually go up to 14-16
        else if (/^(\d+[,\s]*)+\d*$/.test(ageGroupLower)) {
          // Numeric sizes - check if mostly small sizes (kids)
          const sizes = ageGroupLower.match(/\d+/g)?.map(Number) || [];
          const maxSize = Math.max(...sizes, 0);
          // If max size is 16 or less, likely kids; if 18+, likely adult
          if (maxSize <= 16 && sizes.some(s => s <= 14)) {
            ageDist.kids += count;
          } else {
            ageDist.adult += count;
          }
        } else {
          ageDist.unknown += count;
        }
      }
    }

    // Determine dominant age group (95%+ threshold)
    let dominantAgeGroup: 'kids' | 'adult' | 'baby' | null | undefined = undefined;
    if (totalAgeCount > 0) {
      const kidsPct = (ageDist.kids / totalAgeCount) * 100;
      const adultPct = (ageDist.adult / totalAgeCount) * 100;
      const babyPct = (ageDist.baby / totalAgeCount) * 100;
      if (kidsPct >= 95) dominantAgeGroup = 'kids';
      else if (adultPct >= 95) dominantAgeGroup = 'adult';
      else if (babyPct >= 95) dominantAgeGroup = 'baby';
      else dominantAgeGroup = null; // Mixed or unclear
    }

      categoryMap.set(stat.category, {
        category: stat.category,
        productCount: Number(stat.count),
        sampleProducts,
        vendorId: primaryVendorId || undefined,
        genderDistribution: genderDist,
        ageGroupDistribution: ageDist,
        dominantGender,
        dominantAgeGroup,
      });

      processed++;
      
      // Log progress every 100 categories and save checkpoint
      if (processed % BATCH_EXTRACT_SIZE === 0) {
        console.log(`   Extracted data for ${categoryMap.size}/${categoryStats.length} categories...`);
        // Save checkpoint every 100 categories
        saveExtractedDataCheckpoint(categoryMap);
      }
    } catch (error) {
      // If connection error, try to reconnect and continue
      if (error instanceof Error && error.message.includes('connection')) {
        console.error(`   ⚠️  Connection error for category "${stat.category}", skipping...`);
        // Try to reconnect
        try {
          await prisma.$disconnect();
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Prisma will reconnect on next query
        } catch (reconnectError) {
          console.error(`   ❌ Reconnection failed, stopping extraction`);
          break;
        }
      } else {
        throw error;
      }
    }
  }

  console.log(`   Extracted samples for ${categoryMap.size} categories\n`);
  
  // Save final checkpoint
  saveExtractedDataCheckpoint(categoryMap);
  console.log(`   💾 Checkpoint saved to ${EXTRACTED_DATA_FILE}\n`);
  
  return categoryMap;
}

/**
 * Create LLM prompt for category normalization
 */
function createNormalizationPrompt(categories: Array<CategoryData>): string {
  const categoriesText = categories.map((cat, i) => {
    const samples = cat.sampleProducts.slice(0, 8).join('", "'); // Up to 8 samples per category
    const genderInfo = cat.dominantGender 
      ? `Gender: ${cat.dominantGender} (95%+ of products)`
      : `Gender: Mixed (Female: ${cat.genderDistribution.female}, Male: ${cat.genderDistribution.male}, Unisex: ${cat.genderDistribution.unisex})`;
    const ageInfo = cat.dominantAgeGroup
      ? `Age Group: ${cat.dominantAgeGroup} (95%+ of products)`
      : `Age Group: Mixed (Kids: ${cat.ageGroupDistribution.kids}, Adult: ${cat.ageGroupDistribution.adult}, Baby: ${cat.ageGroupDistribution.baby})`;
    return `${i + 1}. Original Category: "${cat.category}"
   Sample Products: ["${samples}"]
   ${genderInfo}
   ${ageInfo}`;
  }).join('\n\n');

  return `Normalize the product categories below into standard category/subcategory format using gender and age group detection. Process ALL ${categories.length} categories in this batch.

**CRITICAL RULES:**

1. **GENDER SEPARATION (Keep Men's and Women's SEPARATE):**
   - Men's products → Use "Mens-*" prefix: "Mens-jeans", "Mens-tees", "Mens-pants"
   - Women's products → Use "Womens-*" OR standard names: "Womens-jeans", "Women's Dresses", "Tops", "Bottoms"
   - NEVER merge Men's and Women's into the same category

2. **UNISEX/NON-APPAREL DETECTION (CRITICAL):**
   - **Home products** → NEVER genderify: "Bedding", "Tabletop", "Home Decor", "Interiors", "Towels"
   - **Functional accessories** → Can be unisex: "Accessories", "Phone Cases", "Tote Bags", "Wallets"
   - **Pet products** → NEVER genderify: "Pets"
   - **Some jewelry** → Can be unisex, but analyze sample products
   - **Shoes** → Typically gendered for fashion, but analyze context

3. **GENDER INFERENCE FROM PRODUCTS:**
   - Analyze sample product titles to infer gender
   - "Men's Jeans" in titles → "Mens-jeans"
   - "Women's Dress" in titles → "Women's Dresses"
   - If titles show mixed gender → Consider unisex or split
   - If titles show only one gender → Use that gender category

**STANDARD CATEGORIES:**

MEN'S (use "Mens-*" prefix):
- Mens-jeans, Mens-tees, Mens-pants, Mens-shorts, Mens-underwear, Mens-pajamas, Mens-sweaters, Mens-jackets, Mens-swims

WOMEN'S (use "Womens-*" or standard names):
- Women's Dresses, Womens-jeans, Womens-tees, Womens-pants, Womens-lounge, Womens-pajamas, Womens-sweaters
- Tops, Bottoms, Skirts, Activewear, Swimsuits, Bikini Sets, Swim Cover-ups, Loungewear, Shoes

GIRLS/KIDS:
- Girls Tops, Girls Bottoms, Girls Dresses, Girls Swimwear
- Tween Pants, Tween Sweaters, Tween Dresses
- Baby & Toddler Bottoms

UNISEX/NON-GENDERED:
- Accessories (for bags, wallets, phone cases if unisex)
- Jewelry (if unisex from samples)
- Bedding, Tabletop, Home Decor, Interiors, Pets (never gendered)
- Tote Bags, Phone Cases, Soap Dispensers (functional items)
- Perfumes, Candle, Stationary, Gift Wrapping

**NORMALIZATION PROCESS:**

1. **Parse category string:**
   - Remove price markers: "£15 and under", "£20 and under"
   - Remove attributes: "Concert Looks", "Date Nights", "Day Glam"
   - Extract product type keywords: dress, top, pants, shoes, bag, etc.

2. **Analyze sample products:**
   - Look for gender markers in titles: "Men's", "Women's", "Ladies", "Girls"
   - Identify product type: "Dress", "Jeans", "Bag", "Bedding", etc.
   - Check if products are clearly one gender or mixed

3. **Determine category assignment based on 95%+ rule:**
   - **CRITICAL: Check dominant gender and age group from distribution data above**
   - **If 95%+ kids age group**: Use kids categories (Girls Tops, Girls Bottoms, Girls Dresses, Baby & Toddler Bottoms, etc.)
   - **If 95%+ adult age group AND 95%+ male gender**: Use Mens-* category
   - **If 95%+ adult age group AND 95%+ female gender**: Use Womens-* or standard women's category
   - **If 95%+ adult age group AND unisex or mixed gender**: Use unisex category (Accessories, etc.) OR standard women's if ambiguous (current dataset is mostly women's)
   - **If home/non-apparel**: Use unisex category (Bedding, Tabletop, etc.) regardless of age/gender
   - **If 95%+ baby age group**: Use Baby & Toddler categories

4. **Extract subcategory:**
   - Length indicators: "Mini", "Midi", "Maxi" → Use as subcategory (e.g., "Midi Dresses")
   - Style indicators: "Bodycon", "Cami" → Can be part of subcategory
   - Otherwise: null

**EXAMPLES:**

Input: "Playsuit | £15 and under | Concert Looks | Date Nights"
Samples: ["Floral Playsuit", "Denim Playsuit", "Linen Playsuit"]
Analysis: Playsuits are typically women's one-piece outfits
Output: { category: "Tops", subcategory: null, reasoning: "Playsuits are women's apparel, categorized as Tops" }

Input: "Midi | £20... | Bodycon Dresses | Cami Dresses..."
Samples: ["Midi Bodycon Dress", "Cami Midi Dress"]
Analysis: Dresses are women's, "Midi" is length
Output: { category: "Women's Dresses", subcategory: "Midi Dresses", reasoning: "Dresses are women's, Midi is length subcategory" }

Input: "Bedding | Sheet Sets | Pillows"
Samples: ["Cotton Sheet Set", "Memory Foam Pillow"]
Analysis: Home product, not apparel, never gendered
Output: { category: "Bedding", subcategory: null, reasoning: "Home product, not gendered" }

**Categories:**

${categoriesText}

**Return a JSON array with ${categories.length} objects (one per category):**
[
  {
    "original": "original category string",
    "normalized": {
      "category": "standard category name",
      "subcategory": "subcategory name or null"
    },
    "reasoning": "brief explanation of gender/non-apparel detection"
  },
  {
    "original": "next category string",
    "normalized": {
      "category": "standard category name",
      "subcategory": null
    },
    "reasoning": "explanation"
  }
  ... (continue for ALL ${categories.length} categories)
]

Use the gender/age distributions shown above. Return only the JSON array, no other text.`;

}

/**
 * Normalize categories using LLM in batches
 */
async function normalizeCategoriesWithLLM(
  categories: CategoryData[],
  batchSize: number = BATCH_SIZE
): Promise<Map<string, { category: string; subcategory: string | null; reasoning?: string }>> {
  console.log(`🤖 Normalizing ${categories.length} categories using LLM (batch size: ${batchSize})...\n`);

  const mapping = new Map<string, { category: string; subcategory: string | null; reasoning?: string }>();
  const errors: Array<{ category: string; error: string }> = [];

  for (let i = 0; i < categories.length; i += batchSize) {
    const batch = categories.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(categories.length / batchSize);

    console.log(`   Processing batch ${batchNum}/${totalBatches} (${batch.length} categories)...`);

    try {
      const prompt = createNormalizationPrompt(batch);

      const response = await callLLM({
        messages: [
          {
            role: 'system',
            content: 'You normalize product categories. Return a JSON array with normalization results. Process all categories provided.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        purpose: 'intent',
        expectJson: true,
        maxTokens: 4000,
      });

      let jsonResponse: Array<{
        original: string;
        normalized: { category: string; subcategory: string | null };
        reasoning?: string;
      }> = [];

      try {
        const cleaned = stripJsonFences(response.rawText);
        let parsed: any;
        
        // Try multiple parsing strategies
        // Strategy 1: Try to find and parse JSON array directly
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            parsed = JSON.parse(arrayMatch[0]);
          } catch {
            // Fall through to next strategy
          }
        }
        
        // Strategy 2: Try parsing the whole cleaned string
        if (!parsed) {
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            // Fall through to next strategy
          }
        }
        
        // Strategy 3: Try to extract JSON from code blocks or other wrappers
        if (!parsed) {
          const jsonInBackticks = cleaned.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
          if (jsonInBackticks) {
            try {
              parsed = JSON.parse(jsonInBackticks[1]);
            } catch {
              // Continue to error handling
            }
          }
        }
        
        if (!parsed) {
          throw new Error('Could not parse JSON from response');
        }
        
        // Ensure it's an array
        if (Array.isArray(parsed)) {
          jsonResponse = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
          const objectKeys = Object.keys(parsed);
          
          // Check if this is a single category object (has 'original' and 'normalized' keys)
          // OR if it looks like an error response with those keys
          if ((parsed.original && parsed.normalized) || 
              (objectKeys.length <= 5 && (objectKeys.includes('original') || objectKeys.includes('normalized') || objectKeys.includes('reasoning')))) {
            // Single category object - wrap it in an array
            console.log(`   ℹ️  LLM returned single category object for batch ${batchNum}, wrapping in array`);
            jsonResponse = [{
              original: String(parsed.original).trim(),
              normalized: {
                category: String(parsed.normalized.category || parsed.normalized).trim(),
                subcategory: parsed.normalized.subcategory ? String(parsed.normalized.subcategory).trim() : null,
              },
              reasoning: parsed.reasoning,
            }];
          } else {
            // Object mapping category names -> values
            console.log(`   ⚠️  LLM returned object format for batch ${batchNum}, converting to array format (${Object.keys(parsed).length} entries)`);
            console.log(`   Debug - Object keys: ${Object.keys(parsed).join(', ')}`);
            
            // If object has structure like {original: "...", normalized: {...}}, treat as single item
            if (objectKeys.includes('original') && objectKeys.includes('normalized') && objectKeys.length <= 4) {
              console.log(`   ℹ️  Detected single category object structure, converting`);
              jsonResponse = [{
                original: String(parsed.original || '').trim(),
                normalized: typeof parsed.normalized === 'object' ? {
                  category: String(parsed.normalized.category || '').trim(),
                  subcategory: parsed.normalized.subcategory ? String(parsed.normalized.subcategory).trim() : null,
                } : { category: String(parsed.normalized || '').trim(), subcategory: null },
                reasoning: parsed.reasoning,
              }];
            } else {
              const entries = Object.entries(parsed);
              jsonResponse = [];
              
              for (const [original, value]: [string, any] of entries) {
                // Check if this is an error response
                if (original === 'error') {
                  console.error(`      ❌ LLM returned error: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
                  // Try to continue with other entries, but log the error
                  continue;
                }
                
                // Skip non-category keys that aren't actual category names
                if (original === 'reasoning' || original === 'normalized' || original === 'original') {
                  continue;
                }
              
              let normalized: { category: string; subcategory: string | null };
              let reasoning: string | undefined;
              
              if (typeof value === 'object' && value !== null) {
                // Check if value has nested normalized structure
                if (value.normalized && typeof value.normalized === 'object') {
                  normalized = {
                    category: String(value.normalized.category || value.category || '').trim(),
                    subcategory: value.normalized.subcategory || value.subcategory ? String(value.normalized.subcategory || value.subcategory).trim() : null,
                  };
                  reasoning = value.reasoning;
                } else if (value.category) {
                  // Direct category structure
                  normalized = {
                    category: String(value.category).trim(),
                    subcategory: value.subcategory ? String(value.subcategory).trim() : null,
                  };
                  reasoning = value.reasoning;
                } else {
                  // Skip invalid entries
                  console.log(`      Skipping invalid entry: "${original}" - value is not in expected format`);
                  continue;
                }
              } else if (typeof value === 'string') {
                // Simple string mapping
                normalized = { category: value.trim(), subcategory: null };
              } else {
                // Skip invalid entries
                console.log(`      Skipping invalid entry: "${original}" - value type: ${typeof value}`);
                continue;
              }
              
              if (!normalized.category) {
                console.log(`      Skipping entry with empty category: "${original}"`);
                continue;
              }
              
              jsonResponse.push({
                original: original.trim(),
                normalized,
                reasoning,
              });
              }
            }
            
            console.log(`      Converted ${jsonResponse.length} entries from object format`);
          }
        } else {
          throw new Error('Response is not an array or object');
        }
        
        // Validate array structure
        if (!Array.isArray(jsonResponse)) {
          throw new Error('Failed to convert response to array format');
        }
      } catch (parseError) {
        console.error(`   ⚠️  Failed to parse LLM response for batch ${batchNum}:`, parseError instanceof Error ? parseError.message : String(parseError));
        console.error(`   Response preview (first 1000 chars): ${response.rawText.substring(0, 1000)}...`);
        console.error(`   Full response length: ${response.rawText.length} chars`);
        for (const cat of batch) {
          errors.push({ category: cat.category, error: `Failed to parse LLM JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}` });
        }
        continue;
      }
      
      // Debug: Log parsed structure and raw response if mismatch
      if (jsonResponse.length !== batch.length) {
        console.log(`   ⚠️  Warning: Expected ${batch.length} mappings but got ${jsonResponse.length}`);
        console.log(`   Batch categories: ${batch.map(c => c.category).join(', ')}`);
        console.log(`   Parsed categories: ${jsonResponse.map(r => r.original).join(', ')}`);
        
        // Log the actual parsed object structure for debugging
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          console.log(`   Debug - Object keys: ${Object.keys(parsed).slice(0, 10).join(', ')}`);
          console.log(`   Debug - First entry sample: ${JSON.stringify(Object.entries(parsed)[0]?.slice(0, 2)).substring(0, 200)}`);
        }
      }

      for (const item of jsonResponse) {
        if (item && item.original && item.normalized) {
          mapping.set(item.original.trim(), {
            category: item.normalized.category.trim(),
            subcategory: item.normalized.subcategory ? item.normalized.subcategory.trim() : null,
            reasoning: item.reasoning,
          });
        }
      }

      const normalizedCount = jsonResponse.length;
      console.log(`   ✅ Batch ${batchNum} completed: ${normalizedCount} normalized`);

      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
    } catch (error) {
      console.error(`   ❌ Error processing batch ${batchNum}:`, error instanceof Error ? error.message : String(error));
      for (const cat of batch) {
        errors.push({
          category: cat.category,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log(`\n   ✅ Normalization complete: ${mapping.size} mappings created, ${errors.length} errors\n`);

  if (errors.length > 0) {
    console.log('   ⚠️  Errors encountered:');
    errors.slice(0, 10).forEach(({ category, error }) => {
      console.log(`      - "${category}": ${error}`);
    });
    if (errors.length > 10) {
      console.log(`      ... and ${errors.length - 10} more errors`);
    }
    console.log();
  }

  return mapping;
}

/**
 * Get all standard categories from CATEGORY_TREE
 */
function getStandardCategories(): Set<string> {
  const standard = new Set<string>();
  for (const category of Object.keys(CATEGORY_TREE)) {
    standard.add(category);
  }
  return standard;
}

/**
 * Verify category mapping
 */
function verifyCategoryMapping(
  original: string,
  normalized: { category: string; subcategory: string | null },
  categoryData: CategoryData,
  standardCategories: Set<string>
): { valid: boolean; reason?: string } {
  const sampleProducts = categoryData.sampleProducts;
  // 1. Check category exists in standard list
  if (!standardCategories.has(normalized.category)) {
    return { valid: false, reason: 'Category not in standard category tree' };
  }

  // 2. Verify gender consistency
  const normalizedLower = normalized.category.toLowerCase();
  const isMens = normalizedLower.startsWith('mens-');
  const isWomens = normalizedLower.startsWith('womens-') || normalized.category === "Women's Dresses";
  
  // Check sample products for gender markers
  const hasMensProducts = sampleProducts.some(p => {
    const lower = p.toLowerCase();
    return /men'?s?|male|mens/i.test(lower) && !/women|ladies|womens|girls/i.test(lower);
  });
  const hasWomensProducts = sampleProducts.some(p => {
    const lower = p.toLowerCase();
    return /women'?s?|ladies|womens|girls/i.test(lower) && !/men'?s?|male|mens/i.test(lower);
  });
  
  if (isMens && hasWomensProducts && !hasMensProducts) {
    return { valid: false, reason: 'Men\'s category assigned but products are women\'s' };
  }
  
  if ((isWomens || normalized.category === "Tops" || normalized.category === "Bottoms" || normalized.category === "Skirts") && 
      hasMensProducts && !hasWomensProducts && 
      !/bedding|tabletop|home|pet|interior|accessor/i.test(normalized.category)) {
    return { valid: false, reason: 'Women\'s category assigned but products are men\'s' };
  }

  // 3. Verify non-apparel isn't gendered
  const nonApparelCategories = ['Bedding', 'Tabletop', 'Home Decor', 'Interiors', 'Pets', 'Towels', 'Stationary', 'Gift Wrapping'];
  const isNonApparel = nonApparelCategories.includes(normalized.category);
  if (isNonApparel && (isMens || isWomens)) {
    return { valid: false, reason: 'Non-apparel category incorrectly gendered' };
  }

  // 4. Verify age group consistency (95%+ rule)
  const kidsCategories = ['Girls Tops', 'Girls Bottoms', 'Girls Dresses', 'Girls Swimwear', 'Baby & Toddler Bottoms'];
  const isKidsCategory = kidsCategories.includes(normalized.category);
  
  if (isKidsCategory && categoryData.dominantAgeGroup !== 'kids' && categoryData.dominantAgeGroup !== 'baby') {
    // Allow if kids count is significant even if not 95%+
    const totalRelevant = categoryData.ageGroupDistribution.kids + categoryData.ageGroupDistribution.adult + categoryData.ageGroupDistribution.baby;
    const kidsPct = totalRelevant > 0 
      ? (categoryData.ageGroupDistribution.kids / totalRelevant) * 100
      : 0;
    if (kidsPct < 80 && totalRelevant > 0) { // More lenient threshold for kids (80% instead of 95%)
      return { valid: false, reason: `Kids category assigned but only ${kidsPct.toFixed(0)}% are kids products` };
    }
  }

  // 5. Verify gender consistency with 95%+ rule
  if (categoryData.dominantGender === 'male' && !isMens && !isNonApparel && !isKidsCategory) {
    return { valid: false, reason: '95%+ male products but assigned to non-men\'s category' };
  }
  if (categoryData.dominantGender === 'female' && (isMens || normalized.category === "Mens-jeans" || normalized.category === "Mens-tees")) {
    return { valid: false, reason: '95%+ female products but assigned to men\'s category' };
  }

  return { valid: true };
}

/**
 * Verify all category mappings
 */
function verifyCategoryMappings(
  mappings: Map<string, { category: string; subcategory: string | null; reasoning?: string }>,
  categoryData: Map<string, CategoryData>,
  standardCategories: Set<string>
): {
  verified: Map<string, { category: string; subcategory: string | null; reasoning?: string }>;
  failures: Array<{ original: string; normalized: { category: string; subcategory: string | null }; reason: string }>;
} {
  console.log('🔍 Verifying category mappings for safety...\n');

  const verified = new Map<string, { category: string; subcategory: string | null; reasoning?: string }>();
  const failures: Array<{ original: string; normalized: { category: string; subcategory: string | null }; reason: string }> = [];

  for (const [original, normalized] of mappings.entries()) {
    const data = categoryData.get(original);
    if (!data) continue;

    const verification = verifyCategoryMapping(original, normalized, data, standardCategories);
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
      console.log(`      - "${original}" → "${normalized.category}": ${reason}`);
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
function loadExistingMapping(): Map<string, { category: string; subcategory: string | null; reasoning?: string }> | null {
  if (existsSync(MAPPING_FILE)) {
    try {
      const data = JSON.parse(readFileSync(MAPPING_FILE, 'utf-8')) as CategoryMapping[];
      const mapping = new Map<string, { category: string; subcategory: string | null; reasoning?: string }>();
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
 * Backup current categories before update
 */
async function backupCategories(): Promise<Map<string, { category: string; subcategory: string | null }>> {
  console.log('💾 Creating backup of original categories...\n');
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, category: true, subcategory: true },
  });

  const backup: Record<string, { category: string; subcategory: string | null }> = {};
  for (const product of products) {
    if (product.category) {
      backup[product.id] = {
        category: product.category,
        subcategory: product.subcategory || null,
      };
    }
  }

  writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
  console.log(`   ✅ Backup saved: ${products.length} products backed up to ${BACKUP_FILE}\n`);
  return new Map(Object.entries(backup));
}

/**
 * Update categories in database
 */
async function updateCategoriesInDatabase(
  mappings: Map<string, { category: string; subcategory: string | null }>
): Promise<NormalizationResult> {
  console.log(`📝 Updating categories in database${DRY_RUN ? ' (DRY RUN - no changes will be made)' : ''}...\n`);

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
        isActive: true,
        category: { in: Array.from(mappings.keys()) },
      },
      select: {
        id: true,
        category: true,
        subcategory: true,
      },
      take: batchSize,
      skip: offset,
    });

    if (products.length === 0) {
      hasMore = false;
      break;
    }

    for (const product of products) {
      if (!product.category) {
        result.skipped++;
        continue;
      }

      const mapping = mappings.get(product.category);
      if (!mapping) {
        result.skipped++;
        continue;
      }

      result.processed++;

      // Skip if already normalized (avoid unnecessary updates)
      if (product.category === mapping.category && product.subcategory === mapping.subcategory) {
        result.skipped++;
        continue;
      }

      try {
        if (!DRY_RUN) {
          await prisma.product.update({
            where: { id: product.id },
            data: {
              category: mapping.category,
              subcategory: mapping.subcategory,
            },
          });
        }
        result.updated++;
      } catch (error) {
        result.errors.push({
          productId: product.id,
          original: product.category,
          normalized: mapping,
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
 * Main function
 */
async function main() {
  console.log('🎯 Category Normalization Script\n');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE (will update database)'}\n`);

  try {
    // Step 1: Load existing mapping or extract categories
    let mappings: Map<string, { category: string; subcategory: string | null; reasoning?: string }>;
    let categoryData: Map<string, CategoryData>;

    const existingMapping = loadExistingMapping();
    if (existingMapping && existingMapping.size > 0) {
      console.log('   📂 Resuming with existing mapping...\n');
      mappings = existingMapping;
      // Still need category data for verification
      categoryData = await extractCategoriesWithSamples();
    } else {
      // Step 2: Extract categories with samples
      categoryData = await extractCategoriesWithSamples();

      // Step 3: Normalize with LLM
      const categoriesArray = Array.from(categoryData.values());
      mappings = await normalizeCategoriesWithLLM(categoriesArray);

      // Save mapping
      const mappingArray: CategoryMapping[] = Array.from(mappings.entries()).map(([original, normalized]) => {
        const data = categoryData.get(original);
        return {
          original,
          normalized,
          productCount: data?.productCount || 0,
          sampleProducts: data?.sampleProducts || [],
          verified: false,
          reasoning: normalized.reasoning,
        };
      });
      writeFileSync(MAPPING_FILE, JSON.stringify(mappingArray, null, 2));
      console.log(`   💾 Mapping saved to ${MAPPING_FILE}\n`);
    }

    // Step 4: Verify mappings
    const standardCategories = getStandardCategories();
    const { verified, failures } = verifyCategoryMappings(mappings, categoryData, standardCategories);

    // Update mapping file with verification status
    const mappingArray: CategoryMapping[] = Array.from(verified.entries()).map(([original, normalized]) => {
      const data = categoryData.get(original);
      return {
        original,
        normalized,
        productCount: data?.productCount || 0,
        sampleProducts: data?.sampleProducts || [],
        verified: true,
        reasoning: normalized.reasoning,
      };
    });
    writeFileSync(MAPPING_FILE, JSON.stringify(mappingArray, null, 2));

    // Step 5: Backup and update database
    if (!DRY_RUN && !existsSync(BACKUP_FILE)) {
      await backupCategories();
    }

    const updateResult = await updateCategoriesInDatabase(verified);

    // Step 6: Summary
    console.log('\n📊 Summary:\n');
    console.log(`   Categories processed: ${mappings.size}`);
    console.log(`   Verified mappings: ${verified.size}`);
    console.log(`   Verification failures: ${failures.length}`);
    console.log(`   Products processed: ${updateResult.processed}`);
    console.log(`   Products updated: ${updateResult.updated}`);
    console.log(`   Products skipped: ${updateResult.skipped}`);
    console.log(`   Errors: ${updateResult.errors.length}\n`);

    if (DRY_RUN) {
      console.log('   ⚠️  DRY RUN mode: No database changes were made');
      console.log('   Run without --dry-run to apply changes\n');
    } else {
      console.log('   ✅ Normalization complete!\n');
      console.log('   Next steps:');
      console.log('   1. Verify a sample of updated products');
      console.log('   2. Check category count: SELECT COUNT(DISTINCT "category") FROM "Product" WHERE "isActive" = true\n');
    }

    if (updateResult.errors.length > 0) {
      console.log(`   ⚠️  Update errors (${updateResult.errors.length}):`);
      updateResult.errors.slice(0, 5).forEach(({ productId, error }) => {
        console.log(`      - Product ${productId}: ${error}`);
      });
      if (updateResult.errors.length > 5) {
        console.log(`      ... and ${updateResult.errors.length - 5} more errors`);
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
