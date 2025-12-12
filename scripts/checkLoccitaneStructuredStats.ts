#!/usr/bin/env tsx
/**
 * Check L'Occitane Structured Attributes Status
 * 
 * Quick diagnostic script to check how many products have
 * loccitaneStructured populated in their attributes.
 * 
 * Usage:
 *   pnpm tsx scripts/checkLoccitaneStructuredStats.ts
 */

import { prisma } from '../src/lib/db';
import { Prisma } from '@prisma/client';

async function checkStats() {
  try {
    console.log('🔍 Checking L\'Occitane Structured Attributes status...\n');

    // Total active products
    const totalActive = await prisma.product.count({
      where: { isActive: true },
    });

    // Products with loccitaneStructured
    const withStructured = await prisma.product.count({
      where: {
        isActive: true,
        attributes: {
          path: ['loccitaneStructured'],
          not: Prisma.AnyNull,
        },
      },
    });

    // Products with product_details (raw) but no structured
    const withProductDetails = await prisma.product.count({
      where: {
        isActive: true,
        OR: [
          { attributes: { path: ['product_details'], not: Prisma.AnyNull } },
          { attributes: { path: ['productDetails'], not: Prisma.AnyNull } },
        ],
      },
    });

    // Sample products with structured
    const sampleWithStructured = await prisma.product.findMany({
      where: {
        isActive: true,
        attributes: {
          path: ['loccitaneStructured'],
          not: Prisma.AnyNull,
        },
      },
      take: 3,
      select: {
        id: true,
        title: true,
        attributes: true,
      },
    });

    // Sample products with product_details but no structured
    const sampleWithoutStructured = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { attributes: { path: ['product_details'], not: Prisma.AnyNull } },
          { attributes: { path: ['productDetails'], not: Prisma.AnyNull } },
        ],
        NOT: {
          attributes: {
            path: ['loccitaneStructured'],
            not: Prisma.AnyNull,
          },
        },
      },
      take: 3,
      select: {
        id: true,
        title: true,
        attributes: true,
      },
    });

    console.log('='.repeat(60));
    console.log('📊 Statistics');
    console.log('='.repeat(60));
    console.log(`Total active products: ${totalActive}`);
    console.log(`Products with loccitaneStructured: ${withStructured}`);
    console.log(`Products with product_details (raw): ${withProductDetails}`);
    console.log(`Products needing backfill: ${withProductDetails - withStructured}`);
    console.log('');

    if (sampleWithStructured.length > 0) {
      console.log('✅ Sample products WITH loccitaneStructured:');
      console.log('-'.repeat(60));
      for (const product of sampleWithStructured) {
        const attrs = product.attributes as any;
        const structured = attrs?.loccitaneStructured;
        console.log(`\nID: ${product.id}`);
        console.log(`Title: ${product.title}`);
        if (structured) {
          console.log(`  Concerns: ${structured.concerns?.length || 0}`);
          console.log(`  Skin Types: ${structured.skinTypes?.length || 0}`);
          console.log(`  Ingredients: ${structured.canonicalIngredients?.length || 0}`);
          console.log(`  Product Type: ${structured.productType || 'N/A'}`);
        }
      }
      console.log('');
    }

    if (sampleWithoutStructured.length > 0) {
      console.log('⚠️  Sample products WITH product_details BUT NO loccitaneStructured:');
      console.log('-'.repeat(60));
      for (const product of sampleWithoutStructured) {
        const attrs = product.attributes as any;
        console.log(`\nID: ${product.id}`);
        console.log(`Title: ${product.title}`);
        const productDetails = attrs?.product_details || attrs?.productDetails;
        if (productDetails) {
          if (Array.isArray(productDetails)) {
            console.log(`  product_details: Array with ${productDetails.length} items`);
            if (productDetails.length > 0) {
              console.log(`  First item: ${String(productDetails[0]).substring(0, 100)}...`);
            }
          } else if (typeof productDetails === 'object') {
            const keys = Object.keys(productDetails);
            console.log(`  product_details: Object with ${keys.length} keys`);
            if (keys.length > 0) {
              console.log(`  Sample keys: ${keys.slice(0, 5).join(', ')}`);
            }
          } else {
            console.log(`  product_details: ${typeof productDetails}`);
          }
        }
      }
      console.log('');
    }

    console.log('='.repeat(60));
    
    if (withStructured === 0) {
      console.log('❌ No products have loccitaneStructured yet.');
      console.log('   Run: pnpm backfill:loccitane-structured');
    } else if (withStructured < withProductDetails) {
      console.log('⚠️  Some products still need backfill.');
      console.log(`   ${withProductDetails - withStructured} products have product_details but no structured attributes.`);
      console.log('   Run: pnpm backfill:loccitane-structured');
    } else {
      console.log('✅ All products with product_details have structured attributes!');
    }
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error checking stats:', error);
    throw error;
  }
}

checkStats()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

