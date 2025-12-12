#!/usr/bin/env tsx
/**
 * Backfill L'Occitane Structured Attributes
 * 
 * Parses product_details from Product.attributes and populates
 * attributes.loccitaneStructured for multi-view retrieval.
 * 
 * Usage:
 *   pnpm tsx scripts/backfillLoccitaneStructured.ts
 *   or: npx ts-node scripts/backfillLoccitaneStructured.ts
 * 
 * This script:
 * - Iterates over all active products (cursor-based pagination)
 * - Parses product_details using parseLoccitaneAttributes
 * - Updates attributes.loccitaneStructured (idempotent)
 * - Works in batches with transactions
 */

import { prisma } from '../src/lib/db';
import { parseLoccitaneAttributes } from '../src/lib/loccitane/attributeParser';
import type { ProductAttributes } from '../src/lib/search/types';
import { logger } from '../src/lib/telemetry/logger';

const BATCH_SIZE = 150;

/**
 * Extract product_details from attributes
 * Handles both product_details and productDetails keys
 * 
 * Handles multiple formats:
 * 1. Record with "velou_attribute" key containing comma-separated string
 * 2. Record<string, string> with parsed key-value pairs
 * 3. string[] array of "velou_attribute:Key:Value" entries
 */
function extractProductDetails(attributes: any): Record<string, string> | string[] | null | undefined {
  if (!attributes || typeof attributes !== 'object') {
    return null;
  }
  
  // Try product_details first (camelCase from ingestion)
  let productDetails = attributes.product_details;
  
  // Try productDetails (alternative naming)
  if (!productDetails && attributes.productDetails) {
    productDetails = attributes.productDetails;
  }
  
  if (!productDetails) {
    return null;
  }
  
  // Handle case where product_details is an object with "velou_attribute" key
  // containing a comma-separated string of entries
  // Format: { "velou_attribute": "Brand:L'Occitane,velou_attribute:Concern:Dryness,..." }
  if (typeof productDetails === 'object' && productDetails.velou_attribute) {
    const velouAttrString = productDetails.velou_attribute;
    if (typeof velouAttrString === 'string') {
      // Split comma-separated string into array of entries
      // Most entries are already "velou_attribute:Key:Value", some are "Key:Value"
      const entries: string[] = [];
      const parts = velouAttrString.split(',');
      
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) {
          // If it already starts with "velou_attribute:", use as-is
          if (trimmed.startsWith('velou_attribute:')) {
            entries.push(trimmed);
          } else if (trimmed.includes(':')) {
            // If it's just "Key:Value", prepend "velou_attribute:"
            entries.push(`velou_attribute:${trimmed}`);
          }
        }
      }
      
      return entries.length > 0 ? entries : null;
    }
  }
  
  // If it's already an array or Record, return as-is (parser handles both)
  return productDetails;
}

/**
 * Check if product already has loccitaneStructured
 */
function hasStructuredAttributes(attributes: any): boolean {
  if (!attributes || typeof attributes !== 'object') {
    return false;
  }
  
  const structured = attributes.loccitaneStructured;
  if (!structured || typeof structured !== 'object') {
    return false;
  }
  
  // Check if it has any actual data (not just empty arrays)
  return (
    (structured.concerns && structured.concerns.length > 0) ||
    (structured.skinTypes && structured.skinTypes.length > 0) ||
    (structured.hairTypes && structured.hairTypes.length > 0) ||
    (structured.applicationAreas && structured.applicationAreas.length > 0) ||
    structured.productType ||
    structured.formula ||
    (structured.featuredIngredients && structured.featuredIngredients.length > 0) ||
    (structured.allIngredients && structured.allIngredients.length > 0) ||
    (structured.madeWithout && structured.madeWithout.length > 0) ||
    (structured.ageGroups && structured.ageGroups.length > 0) ||
    (structured.genders && structured.genders.length > 0)
  );
}

async function main() {
  const startTime = Date.now();
  
  logger.info('backfillLoccitaneStructured: starting', {
    batchSize: BATCH_SIZE,
  });
  
  let totalScanned = 0;
  let totalUpdated = 0;
  let batchNumber = 0;
  let lastId: string | null = null;
  let hasMore = true;
  
  try {
    while (hasMore) {
      batchNumber++;
      
      // Fetch batch using cursor-based pagination
      const where: any = {
        isActive: true,
      };
      
      // Use cursor for pagination (more efficient than OFFSET)
      if (lastId) {
        where.id = {
          gt: lastId, // Greater than last ID for cursor-based pagination
        };
      }
      
      const products = await prisma.product.findMany({
        where,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          attributes: true,
        },
      });
      
      if (products.length === 0) {
        hasMore = false;
        break;
      }
      
      logger.info('backfillLoccitaneStructured: processing batch', {
        batchNumber,
        batchSize: products.length,
        firstId: products[0]?.id,
        lastId: products[products.length - 1]?.id,
      });
      
      totalScanned += products.length;
      
      // Collect updates for this batch
      const updates: Array<{
        productId: string;
        newAttributes: Record<string, unknown>;
      }> = [];
      
      for (const product of products) {
        try {
          const attrs = product.attributes as ProductAttributes | null;
          
          // Skip if already has structured attributes
          if (hasStructuredAttributes(attrs)) {
            continue;
          }
          
          // Extract product_details
          const productDetails = extractProductDetails(attrs);
          
          if (!productDetails) {
            // No product_details to parse
            continue;
          }
          
          // Parse structured attributes
          const structured = parseLoccitaneAttributes(productDetails, attrs);
          
          // Check if we got any meaningful structured data
          const hasData = (
            structured.concerns.length > 0 ||
            structured.skinTypes.length > 0 ||
            structured.hairTypes.length > 0 ||
            structured.applicationAreas.length > 0 ||
            structured.productType ||
            structured.formula ||
            structured.featuredIngredients.length > 0 ||
            structured.allIngredients.length > 0 ||
            structured.madeWithout.length > 0 ||
            structured.ageGroups.length > 0 ||
            structured.genders.length > 0
          );
          
          if (!hasData) {
            // No structured data found, skip
            continue;
          }
          
          // Build new attributes object
          const newAttributes: Record<string, unknown> = {
            ...(attrs || {}),
            loccitaneStructured: structured,
          };
          
          updates.push({
            productId: product.id,
            newAttributes,
          });
        } catch (error) {
          logger.error('backfillLoccitaneStructured: error processing product', {
            productId: product.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with other products
        }
      }
      
      // Update batch in transaction
      if (updates.length > 0) {
        try {
          await prisma.$transaction(
            updates.map((update) =>
              prisma.product.update({
                where: { id: update.productId },
                data: { attributes: update.newAttributes as any },
              })
            )
          );
          
          totalUpdated += updates.length;
          
          logger.info('backfillLoccitaneStructured: batch updated', {
            batchNumber,
            updated: updates.length,
            totalUpdated,
          });
        } catch (error) {
          logger.error('backfillLoccitaneStructured: batch update failed', {
            batchNumber,
            error: error instanceof Error ? error.message : String(error),
            updateCount: updates.length,
          });
          
          // Fall back to individual updates
          let succeeded = 0;
          for (const update of updates) {
            try {
              await prisma.product.update({
                where: { id: update.productId },
                data: { attributes: update.newAttributes as any },
              });
              succeeded++;
            } catch (err) {
              logger.error('backfillLoccitaneStructured: individual update failed', {
                productId: update.productId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          
          totalUpdated += succeeded;
          logger.info('backfillLoccitaneStructured: fallback updates complete', {
            batchNumber,
            succeeded,
            failed: updates.length - succeeded,
          });
        }
      } else {
        logger.debug('backfillLoccitaneStructured: batch skipped (no updates needed)', {
          batchNumber,
        });
      }
      
      // Update cursor for next batch
      lastId = products[products.length - 1]?.id || null;
      hasMore = products.length === BATCH_SIZE;
    }
    
    const duration = Date.now() - startTime;
    
    logger.info('backfillLoccitaneStructured: complete', {
      totalScanned,
      totalUpdated,
      duration,
      batchesProcessed: batchNumber,
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Backfill Complete');
    console.log('='.repeat(60));
    console.log(`Products scanned: ${totalScanned}`);
    console.log(`Products updated: ${totalUpdated}`);
    console.log(`Batches processed: ${batchNumber}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log('');
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('backfillLoccitaneStructured: fatal error', {
      error: error instanceof Error ? error.message : String(error),
      duration,
      totalScanned,
      totalUpdated,
    });
    
    console.error('\n❌ Backfill failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

